import {
  LoggerService,
  RootConfigService,
} from '@backstage/backend-plugin-api';
import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { promises as fs } from 'fs';
import path from 'path';

import { readCrossplaneProvisioningConfig } from '../lib/config';
import { expandComponents } from '../lib/components';
import { renderTenantEnvironmentManifest, type Environment } from '../lib/manifest';
import { buildBranchName, buildPullRequestTitle } from '../lib/naming';
import { redact } from '../lib/redact';
import { createWorkspace } from '../lib/workspace';
import {
  CLONE_TIMEOUT_MS,
  PULL_REQUEST_TIMEOUT_MS,
  PUSH_TIMEOUT_MS,
  createGitHelper,
  resolveLiveRepoToken,
} from '../lib/git';

/** Input accepted by the `tenant:provision-crossplane` action. */
export interface TenantProvisionCrossplaneInput {
  tenantName: string;
  environment: Environment;
  /** Azure region; defaults to config.defaultLocation when omitted. */
  location?: string;
  /** Azure Storage SKU; defaults to config.defaultStorageAccountSkuName when omitted. */
  storageAccountSkuName?: string;
  /** DISABLED — retained for re-enable; accepted but not emitted. */
  selectedComponents?: string[];
}

/** Output produced by the `tenant:provision-crossplane` action. */
export interface TenantProvisionCrossplaneOutput {
  pullRequestUrl: string;
  branchName: string;
}

/** Options for constructing the `tenant:provision-crossplane` action. */
export interface CreateTenantProvisionCrossplaneActionOptions {
  config: RootConfigService;
  logger: LoggerService;
}

/**
 * Tenant name pattern shared by the input schema and the fail-fast guard.
 * Matches the Crossplane XRD `spec.tenantName` pattern (lowercase RFC1123-style:
 * starts/ends alphanumeric, 3-22 chars, hyphens allowed in the middle), so the
 * rendered `metadata.name` and `spec.tenantName` are always valid for
 * Kubernetes and the XTenantEnvironment XRD.
 */
const TENANT_NAME_PATTERN = /^[a-z0-9]([a-z0-9-]{1,20})[a-z0-9]$/;

/** The fixed set of valid environments. */
const ENVIRONMENTS = ['dev', 'staging', 'prod'] as const;

/** Supported Azure regions offered by the form (small curated set). */
const LOCATIONS = ['japaneast', 'japanwest', 'southeastasia'] as const;

/** Supported Azure Storage account SKUs. */
const STORAGE_ACCOUNT_SKU_NAMES = [
  'Standard_LRS',
  'Standard_GRS',
  'Standard_RAGRS',
  'Standard_ZRS',
  'Premium_LRS',
] as const;

/**
 * Creates the `tenant:provision-crossplane` custom scaffolder action.
 *
 * Validates inputs and resolves the Azure location/SKU against config defaults
 * entirely in-process before creating any working directory or touching the
 * network (fail-fast, Req 8.1-8.4). It then clones the Crossplane live
 * repository, renders and writes the `XTenantEnvironment` XR manifest at
 * `tenants/<tenant>/<environment>/xr.yaml`, creates a
 * timestamped feature branch, commits exactly that file, pushes it, and opens
 * (or reuses) a pull request, exposing `pullRequestUrl` and `branchName` as
 * outputs (Req 5.4). Every path after the workspace is created runs inside a
 * `try/finally` so the working directory is always cleaned up (Req 6.1, 6.2).
 * All surfaced errors pass through {@link redact} (Req 7.1, 7.3).
 */
export function createTenantProvisionCrossplaneAction(
  options: CreateTenantProvisionCrossplaneActionOptions,
) {
  const { config } = options;

  return createTemplateAction({
    id: 'tenant:provision-crossplane',
    description:
      'Renders/updates a tenant XTenantEnvironment XR manifest in the Crossplane live repo and opens a pull request.',
    schema: {
      input: {
        tenantName: z =>
          z
            .string()
            .regex(
              TENANT_NAME_PATTERN,
              'tenantName must match ^[a-z0-9]([a-z0-9-]{1,20})[a-z0-9]$',
            )
            .describe('Tenant identifier; must match ^[a-z0-9]([a-z0-9-]{1,20})[a-z0-9]$ (lowercase, 3-22 chars)'),
        environment: z =>
          z
            .enum(ENVIRONMENTS)
            .describe('Deployment environment: one of dev, staging, prod'),
        location: z =>
          z
            .enum(LOCATIONS)
            .optional()
            .describe(
              'Azure region for spec.location; defaults to the configured defaultLocation when omitted',
            ),
        storageAccountSkuName: z =>
          z
            .enum(STORAGE_ACCOUNT_SKU_NAMES)
            .optional()
            .describe(
              'Azure Storage SKU for spec.storageAccountSkuName; defaults to the configured defaultStorageAccountSkuName when omitted',
            ),
        selectedComponents: z =>
          z
            .array(z.string())
            .optional()
            .describe('DISABLED — retained; accepted but not emitted'),
      },
      output: {
        pullRequestUrl: z =>
          z.string().describe('URL of the created or reused pull request'),
        branchName: z =>
          z.string().describe('The devops/... feature branch that was pushed'),
      },
    },
    async handler(ctx) {
      const executionStart = new Date();
      const { tenantName, environment, location, storageAccountSkuName, selectedComponents } =
        ctx.input;
      const selected = selectedComponents ?? [];

      // --- Fail-fast validation (before any side effect, Req 8.1-8.4) --------

      if (
        typeof tenantName !== 'string' ||
        !TENANT_NAME_PATTERN.test(tenantName)
      ) {
        throw new Error(
          `Invalid input 'tenantName': must match ^[a-z0-9]([a-z0-9-]{1,20})[a-z0-9]$`,
        );
      }
      if (!ENVIRONMENTS.includes(environment)) {
        throw new Error(
          `Invalid input 'environment': must be one of ${ENVIRONMENTS.join(
            ', ',
          )}`,
        );
      }

      // Read and validate config (missing/empty liveRepoUrl, invalid allowed
      // component names, oversized allowed-set all fail here) — still before
      // any workspace/clone.
      const provisioningConfig = readCrossplaneProvisioningConfig(config);

      // Expand the selection against the allowed set; unknown selected names
      // fail here (Req 9.6), before any workspace/clone.
      const components = expandComponents(
        selected,
        provisioningConfig.allowedComponents,
      );

      // Resolve the token before creating the workspace so an auth-config
      // problem fails fast too. The token is never logged.
      const token = await resolveLiveRepoToken(
        config,
        provisioningConfig.liveRepoUrl,
      );
      const secrets = [token];

      // --- Side-effecting phase (workspace created; cleanup in finally) ------

      const baseDir = ctx.workspacePath || undefined;
      const workspace = await createWorkspace({
        baseDir,
        tenantName,
        environment,
        secrets,
      });

      try {
        const gitHelper = createGitHelper({
          url: provisioningConfig.liveRepoUrl,
          token,
        });

        // Clone the live repo at the base branch into the workspace (Req 2.1).
        await gitHelper.clone({
          url: provisioningConfig.liveRepoUrl,
          ref: provisioningConfig.liveRepoBranch,
          dir: workspace.root,
          timeoutMs: CLONE_TIMEOUT_MS,
        });

        // Compute the confined target path
        // tenants/<tenant>/<env>/xr.yaml (Req 3.4, 3.7).
        const relativeTarget = path.join(
          'tenants',
          tenantName,
          environment,
          'xr.yaml',
        );
        const targetPath = workspace.resolveWithin(relativeTarget);

        // Resolve the Azure fields, falling back to the configured defaults
        // when the action input omits them (Req 1.5).
        const resolvedLocation = location ?? provisioningConfig.defaultLocation;
        const resolvedStorageAccountSkuName =
          storageAccountSkuName ??
          provisioningConfig.defaultStorageAccountSkuName;

        // Render and write the manifest, creating parent folders and
        // overwriting an existing file (Req 3.1-3.6, 3.8).
        const contents = renderTenantEnvironmentManifest({
          tenantName,
          environment,
          apiVersion: provisioningConfig.apiVersion,
          kind: provisioningConfig.kind,
          compositionName: provisioningConfig.compositionName,
          location: resolvedLocation,
          storageAccountSkuName: resolvedStorageAccountSkuName,
          // DISABLED — retained: expansion result passed for wiring, not emitted.
          components,
        });
        try {
          await fs.mkdir(path.dirname(targetPath), { recursive: true });
          await fs.writeFile(targetPath, contents, 'utf8');
        } catch (err) {
          throw new Error(
            `Failed to write the tenant XTenantEnvironment manifest: ${redact(
              String((err as Error).message ?? err),
              secrets,
            )}`,
          );
        }

        // Build the feature branch name and fail if it already exists locally
        // or on the remote, before committing (Req 4.2, 4.4).
        const branchName = buildBranchName(
          tenantName,
          environment,
          executionStart,
        );
        if (await gitHelper.localBranchOrRemoteExists(branchName)) {
          throw new Error(
            `Feature branch '${branchName}' already exists in the Crossplane live repository`,
          );
        }

        // Commit exactly the rendered file with a tenant+env message and push
        // the feature branch (Req 4.1, 4.3, 5.1, 5.7).
        const commitMessage = `Provision tenant ${tenantName} (${environment})`;
        await gitHelper.createBranchCommitPush({
          branch: branchName,
          baseBranch: provisioningConfig.liveRepoBranch,
          filePath: targetPath,
          message: commitMessage,
          timeoutMs: PUSH_TIMEOUT_MS,
        });

        // Open a pull request from the feature branch toward the base branch,
        // reusing an already-open PR instead of creating a duplicate (Req 5.2,
        // 5.6, 5.8).
        const { url: pullRequestUrl } = await gitHelper.createPullRequest({
          head: branchName,
          base: provisioningConfig.liveRepoBranch,
          title: buildPullRequestTitle(tenantName, environment),
          timeoutMs: PULL_REQUEST_TIMEOUT_MS,
        });

        // Expose the outputs (Req 5.4).
        ctx.output('pullRequestUrl', pullRequestUrl);
        ctx.output('branchName', branchName);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error ?? '');
        throw new Error(redact(message, secrets));
      } finally {
        await workspace.cleanup();
      }
    },
  });
}
