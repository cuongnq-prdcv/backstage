import { RootConfigService } from '@backstage/backend-plugin-api';

/**
 * Resolved configuration for the `tenant:provision-crossplane` action, read
 * from the `crossplaneProvisioning` app-config block.
 */
export interface CrossplaneProvisioningConfig {
  /** crossplaneProvisioning.liveRepoUrl (<- ${CROSSPLANE_LIVE_REPO_URL}); required, non-empty. */
  liveRepoUrl: string;
  /** crossplaneProvisioning.liveRepoBranch (<- ${CROSSPLANE_LIVE_REPO_BRANCH}); defaults to `main`. */
  liveRepoBranch: string;
  /** crossplaneProvisioning.apiVersion; defaults to `platform.hello-crossplane.io/v1alpha1`. */
  apiVersion: string;
  /** crossplaneProvisioning.kind; defaults to `TenantEnvironment`. */
  kind: string;
  /** crossplaneProvisioning.components; the Allowed_Components; defaults to `['table', 'repository']`. */
  allowedComponents: string[];
}

/** Default base branch used when `crossplaneProvisioning.liveRepoBranch` is not configured. */
const DEFAULT_LIVE_REPO_BRANCH = 'main';

/** Default `apiVersion` used when `crossplaneProvisioning.apiVersion` is not configured. */
const DEFAULT_API_VERSION = 'platform.hello-crossplane.io/v1alpha1';

/** Default `kind` used when `crossplaneProvisioning.kind` is not configured. */
const DEFAULT_KIND = 'TenantEnvironment';

/** Default Allowed_Components used when `crossplaneProvisioning.components` is not configured. */
const DEFAULT_ALLOWED_COMPONENTS = ['table', 'repository'];

/** Pattern every allowed component name must match. */
const COMPONENT_NAME_PATTERN = /^[a-z0-9_]+$/;

/** Maximum number of entries permitted in the Allowed_Components set. */
const MAX_ALLOWED_COMPONENTS = 100;

/**
 * Reads and validates the `crossplaneProvisioning` config block.
 *
 * - `liveRepoUrl`, `liveRepoBranch`, `apiVersion`, and `kind` are read via
 *   `getOptionalString`; `components` via `getOptionalStringArray`.
 * - `liveRepoBranch` defaults to `main` when absent (Req 1.7).
 * - `apiVersion`/`kind` default to their Crossplane values when absent (Req 1.11).
 * - `components` defaults to `['table', 'repository']` when absent (Req 1.10).
 * - Throws a config error naming the key when `liveRepoUrl` is absent or empty (Req 1.8).
 * - Rejects an allowed name not matching `^[a-z0-9_]+$` (Req 9.7) and an allowed-set
 *   larger than 100 entries (Req 9.8), before returning.
 *
 * Values come from `${ENV_VAR}` references, never literals (Req 1.9).
 */
export function readCrossplaneProvisioningConfig(
  config: RootConfigService,
): CrossplaneProvisioningConfig {
  const liveRepoUrl = config.getOptionalString(
    'crossplaneProvisioning.liveRepoUrl',
  );
  const liveRepoBranch =
    config.getOptionalString('crossplaneProvisioning.liveRepoBranch') ??
    DEFAULT_LIVE_REPO_BRANCH;
  const apiVersion =
    config.getOptionalString('crossplaneProvisioning.apiVersion') ??
    DEFAULT_API_VERSION;
  const kind =
    config.getOptionalString('crossplaneProvisioning.kind') ?? DEFAULT_KIND;
  const allowedComponents =
    config.getOptionalStringArray('crossplaneProvisioning.components') ?? [
      ...DEFAULT_ALLOWED_COMPONENTS,
    ];

  if (liveRepoUrl === undefined || liveRepoUrl.length === 0) {
    throw new Error(
      "Missing required config value 'crossplaneProvisioning.liveRepoUrl' (CROSSPLANE_LIVE_REPO_URL)",
    );
  }

  if (allowedComponents.length > MAX_ALLOWED_COMPONENTS) {
    throw new Error(
      `Config value 'crossplaneProvisioning.components' has ${allowedComponents.length} entries, which exceeds the allowed maximum of ${MAX_ALLOWED_COMPONENTS}`,
    );
  }

  for (const name of allowedComponents) {
    if (!COMPONENT_NAME_PATTERN.test(name)) {
      throw new Error(
        `Config value 'crossplaneProvisioning.components' contains an invalid component name '${name}'; component names must match ${COMPONENT_NAME_PATTERN}`,
      );
    }
  }

  return {
    liveRepoUrl,
    liveRepoBranch,
    apiVersion,
    kind,
    allowedComponents,
  };
}
