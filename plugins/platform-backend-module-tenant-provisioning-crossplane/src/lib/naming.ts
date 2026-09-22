/**
 * Builds the feature branch name `devops/<tenantName>-<environment>`.
 *
 * Pure: the result depends only on the arguments, and is **deterministic** —
 * the same tenant and environment always produce the same branch name. That is
 * deliberate: the Template opens the pull request with the built-in action's
 * `update: true`, so re-provisioning a tenant/environment updates the one open
 * pull request instead of creating a new branch and a duplicate pull request per
 * submission (Req 4.1, 5.2).
 *
 * The tenant name and environment are assumed to already be validated by the
 * action (`^[a-z0-9]([a-z0-9-]{1,20})[a-z0-9]$` and one of
 * `dev`/`staging`/`prod`), so the produced name matches
 * `^devops/[a-z0-9-]{3,22}-(dev|staging|prod)$`.
 */
export function buildBranchName(
  tenantName: string,
  environment: string,
): string {
  return `devops/${tenantName}-${environment}`;
}

/**
 * Builds a pull request title that identifies the tenant and environment
 * (Req 5.3).
 *
 * Pure: the result depends only on the arguments.
 */
export function buildPullRequestTitle(
  tenantName: string,
  environment: string,
): string {
  return `Provision tenant ${tenantName} (${environment})`;
}

/**
 * Builds the commit message for the rendered manifest. Includes both the tenant
 * name and the environment being provisioned (Req 4.3).
 *
 * Pure: the result depends only on the arguments.
 */
export function buildCommitMessage(
  tenantName: string,
  environment: string,
): string {
  return `Provision tenant ${tenantName} (${environment})`;
}

/** Values summarised in the pull request body. */
export interface PullRequestDescriptionInput {
  tenantName: string;
  environment: string;
  location: string;
  storageAccountSkuName: string;
  manifestPath: string;
}

/**
 * Builds the pull request body. `description` is a required input of the
 * built-in `publish:github:pull-request` action, and summarising the rendered
 * values lets a reviewer see the requested change without opening the diff.
 *
 * Pure: the result depends only on the arguments.
 */
export function buildPullRequestDescription(
  input: PullRequestDescriptionInput,
): string {
  const {
    tenantName,
    environment,
    location,
    storageAccountSkuName,
    manifestPath,
  } = input;

  return [
    `Provision the \`XTenantEnvironment\` for tenant **${tenantName}** in **${environment}**.`,
    '',
    `- Tenant: \`${tenantName}\``,
    `- Environment: \`${environment}\``,
    `- Location: \`${location}\``,
    `- Storage account SKU: \`${storageAccountSkuName}\``,
    `- Manifest: \`${manifestPath}\``,
    '',
    'Opened by the Backstage tenant-provisioning-crossplane template.',
  ].join('\n');
}
