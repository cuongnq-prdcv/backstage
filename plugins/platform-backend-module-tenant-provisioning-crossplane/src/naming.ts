/**
 * Zero-pads a non-negative integer to the requested width.
 */
function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/**
 * Formats a Date as a `yyyymmdd-hhmmss` timestamp in Coordinated Universal
 * Time (UTC): four-digit year, two-digit zero-padded month (01-12), two-digit
 * zero-padded day (01-31), a hyphen, then two-digit zero-padded hour (00-23),
 * minute (00-59), and second (00-59).
 */
function formatUtcTimestamp(date: Date): string {
  const year = pad(date.getUTCFullYear(), 4);
  const month = pad(date.getUTCMonth() + 1, 2);
  const day = pad(date.getUTCDate(), 2);
  const hours = pad(date.getUTCHours(), 2);
  const minutes = pad(date.getUTCMinutes(), 2);
  const seconds = pad(date.getUTCSeconds(), 2);
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

/**
 * Builds the feature branch name
 * `devops/<tenantName>-<environment>-<yyyymmdd-hhmmss>`, with the timestamp
 * expressed in UTC.
 *
 * Pure: the result depends only on the arguments. The tenant name and
 * environment are assumed to already be validated by the action
 * (`^[A-Za-z0-9-]{1,32}$` and one of `dev`/`staging`/`prod`), so the produced
 * name matches `^devops/[A-Za-z0-9-]{1,32}-(dev|staging|prod)-\d{8}-\d{6}$`.
 */
export function buildBranchName(
  tenantName: string,
  environment: string,
  date: Date,
): string {
  return `devops/${tenantName}-${environment}-${formatUtcTimestamp(date)}`;
}

/**
 * Builds a pull request title that identifies the tenant and environment.
 *
 * Pure: the result depends only on the arguments.
 */
export function buildPullRequestTitle(
  tenantName: string,
  environment: string,
): string {
  return `Provision tenant ${tenantName} (${environment})`;
}
