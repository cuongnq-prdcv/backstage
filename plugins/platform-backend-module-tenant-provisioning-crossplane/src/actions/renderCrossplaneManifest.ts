import {
  LoggerService,
  RootConfigService,
  resolveSafeChildPath,
} from '@backstage/backend-plugin-api';
import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { promises as fs } from 'fs';
import path from 'path';

import { readCrossplaneProvisioningConfig } from '../lib/config';
import { expandComponents } from '../lib/components';
import {
  renderTenantEnvironmentManifest,
  type Environment,
} from '../lib/manifest';
import {
  buildBranchName,
  buildCommitMessage,
  buildPullRequestDescription,
  buildPullRequestTitle,
} from '../lib/naming';
import { buildScaffolderRepoUrl } from '../lib/repoUrl';

/** Input accepted by the `tenant:render-crossplane-manifest` action. */
export interface RenderCrossplaneManifestInput {
  tenantName: string;
  environment: Environment;
  /** Azure region; defaults to config.defaultLocation when omitted. */
  location?: string;
  /** Azure Storage SKU; defaults to config.defaultStorageAccountSkuName when omitted. */
  storageAccountSkuName?: string;
  /** DISABLED — retained for re-enable; accepted but not emitted. */
  selectedComponents?: string[];
}

/**
 * Output produced by the `tenant:render-crossplane-manifest` action — the
 * complete set of values the built-in `publish:github:pull-request` step needs,
 * so that no repository URL, branch, or path literal has to live in the
 * Template (Req 1.6, 4.2, 4.4).
 */
export interface RenderCrossplaneManifestOutput {
  repoUrl: string;
  sourcePath: string;
  targetPath: string;
  manifestPath: string;
  branchName: string;
  targetBranchName: string;
  title: string;
  description: string;
  commitMessage: string;
}

/** Options for constructing the `tenant:render-crossplane-manifest` action. */
export interface CreateRenderCrossplaneManifestActionOptions {
  config: RootConfigService;
  logger: LoggerService;
}

/**
 * Tenant name pattern shared by the input schema and the fail-fast guard.
 * Matches the Crossplane XRD `spec.tenantName` pattern (lowercase RFC1123-style:
 * starts/ends alphanumeric, 3-22 chars, hyphens allowed in the middle), so the
 * rendered `metadata.name` and `spec.tenantName` are always valid for Kubernetes
 * and the XTenantEnvironment XRD.
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
 * Workspace subdirectory the rendered manifest is written into, emitted as the
 * `sourcePath` output.
 *
 * The built-in `publish:github:pull-request` action commits **everything** under
 * its `sourcePath` (it serializes that directory rather than taking a file
 * list), so the manifest gets its own dedicated directory: that is what
 * guarantees the commit contains exactly one file, and keeps any file a future
 * Template step might drop into the workspace out of the tenant's pull request
 * (Req 3.10).
 */
export const SOURCE_DIRECTORY = 'crossplane-pr';

/** File name of the rendered manifest inside {@link SOURCE_DIRECTORY}. */
const MANIFEST_FILE_NAME = 'xr.yaml';

/**
 * Creates the `tenant:render-crossplane-manifest` custom scaffolder action.
 *
 * The action owns the domain logic only: it validates the inputs, reads the
 * `crossplaneProvisioning` config, renders the `XTenantEnvironment` XR manifest
 * into the scaffolder's task workspace, and emits the values the built-in
 * `publish:github:pull-request` step consumes. It performs **no** network
 * operation, handles **no** credential, creates **no** temporary directory of
 * its own, and runs **no** child process (Req 2.1, 2.3, 6.2, 7.1).
 *
 * Validation and config resolution both run before the first write, so a failing
 * step leaves the workspace untouched and emits no output — which in turn means
 * the pull-request step cannot run (Req 8.1-8.4).
 */
export function createRenderCrossplaneManifestAction(
  options: CreateRenderCrossplaneManifestActionOptions,
) {
  const { config } = options;

  return createTemplateAction({
    id: 'tenant:render-crossplane-manifest',
    description:
      "Renders a tenant's XTenantEnvironment XR manifest into the task workspace and emits the inputs for publish:github:pull-request.",
    supportsDryRun: true,
    schema: {
      input: {
        tenantName: z =>
          z
            .string()
            .regex(
              TENANT_NAME_PATTERN,
              'tenantName must match ^[a-z0-9]([a-z0-9-]{1,20})[a-z0-9]$',
            )
            .describe(
              'Tenant identifier; must match ^[a-z0-9]([a-z0-9-]{1,20})[a-z0-9]$ (lowercase, 3-22 chars)',
            ),
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
        repoUrl: z =>
          z
            .string()
            .describe(
              'Crossplane live repo in publish:github:pull-request form: <host>?owner=..&repo=..',
            ),
        sourcePath: z =>
          z
            .string()
            .describe(
              'Workspace subdirectory holding the rendered manifest, for the pull-request step sourcePath',
            ),
        targetPath: z =>
          z
            .string()
            .describe(
              'Live repo subdirectory the manifest is applied to: tenants/<tenant>/<environment>',
            ),
        manifestPath: z =>
          z
            .string()
            .describe(
              'Full path of the manifest within the live repo, for display purposes',
            ),
        branchName: z =>
          z.string().describe('Feature branch: devops/<tenant>-<environment>'),
        targetBranchName: z =>
          z
            .string()
            .describe('Base branch of the live repo the pull request targets'),
        title: z => z.string().describe('Pull request title'),
        description: z => z.string().describe('Pull request body'),
        commitMessage: z => z.string().describe('Commit message'),
      },
    },
    async handler(ctx) {
      const {
        tenantName,
        environment,
        location,
        storageAccountSkuName,
        selectedComponents,
      } = ctx.input;
      const selected = selectedComponents ?? [];

      // --- Fail-fast validation (before any write, Req 8.1-8.4) -------------

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
      // any write.
      const provisioningConfig = readCrossplaneProvisioningConfig(config);

      // Expand the selection against the allowed set; unknown selected names
      // fail here (Req 9.6). DISABLED — retained: the result is intentionally
      // not emitted into the manifest while components are off.
      const components = expandComponents(
        selected,
        provisioningConfig.allowedComponents,
      );

      // Derive the pull-request step's repoUrl from config, so the live repo
      // URL never appears in the Template (Req 1.6, 1.9).
      const repoUrl = buildScaffolderRepoUrl(provisioningConfig.liveRepoUrl);

      // Resolve the Azure fields, falling back to the configured defaults when
      // the action input omits them (Req 1.5).
      const resolvedLocation = location ?? provisioningConfig.defaultLocation;
      const resolvedStorageAccountSkuName =
        storageAccountSkuName ??
        provisioningConfig.defaultStorageAccountSkuName;

      // Confine the write to the scaffolder's task workspace; a path that would
      // escape it is rejected before any I/O (Req 3.7, 6.3, 7.4, 7.5).
      const targetFilePath = resolveSafeChildPath(
        ctx.workspacePath,
        path.posix.join(SOURCE_DIRECTORY, MANIFEST_FILE_NAME),
      );

      const contents = renderTenantEnvironmentManifest({
        tenantName,
        environment,
        apiVersion: provisioningConfig.apiVersion,
        kind: provisioningConfig.kind,
        location: resolvedLocation,
        storageAccountSkuName: resolvedStorageAccountSkuName,
        // DISABLED — retained: expansion result passed for wiring, not emitted.
        components,
      });

      try {
        await fs.mkdir(path.dirname(targetFilePath), { recursive: true });
        await fs.writeFile(targetFilePath, contents, 'utf8');
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err ?? '');
        throw new Error(
          `Failed to write the tenant XTenantEnvironment manifest: ${detail}`,
        );
      }

      const targetPath = path.posix.join('tenants', tenantName, environment);
      const manifestPath = path.posix.join(targetPath, MANIFEST_FILE_NAME);

      // Emit the pull-request step's inputs (Req 4.1-4.4, 5.3).
      ctx.output('repoUrl', repoUrl);
      ctx.output('sourcePath', SOURCE_DIRECTORY);
      ctx.output('targetPath', targetPath);
      ctx.output('manifestPath', manifestPath);
      ctx.output('branchName', buildBranchName(tenantName, environment));
      ctx.output('targetBranchName', provisioningConfig.liveRepoBranch);
      ctx.output('title', buildPullRequestTitle(tenantName, environment));
      ctx.output(
        'description',
        buildPullRequestDescription({
          tenantName,
          environment,
          location: resolvedLocation,
          storageAccountSkuName: resolvedStorageAccountSkuName,
          manifestPath,
        }),
      );
      ctx.output('commitMessage', buildCommitMessage(tenantName, environment));
    },
  });
}
