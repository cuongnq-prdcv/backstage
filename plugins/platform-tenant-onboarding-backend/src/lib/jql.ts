import { MARKER_LABEL } from './lookupKey';

/**
 * Builds the fixed JQL used by the lookup endpoint: every issue carrying the
 * marker label and the given email label, newest first.
 *
 * Every value embedded here is a label produced by `lib/lookupKey.ts`
 * (hexadecimal for the email hash, `[a-z0-9-]` for a tenant label), so no
 * submitted value can alter the JQL's syntax.
 */
export function buildLookupJql(projectKey: string, emailHash: string): string {
  return `project = "${projectKey}" AND labels = "${MARKER_LABEL}" AND labels = "${emailHash}" ORDER BY created DESC`;
}

/**
 * Builds the fixed JQL used by the duplicate check before creating an issue:
 * the lookup criteria narrowed to the same tenant label and left unresolved.
 *
 * Matching the tenant by label rather than `summary ~ "<tenantName>"` is
 * deliberate: the `~` operator matches loosely, so `acme` would collide with
 * `acme-corp` and the action would reuse the wrong issue.
 */
export function buildDuplicateCheckJql(
  projectKey: string,
  emailHash: string,
  tenantLabelValue: string,
): string {
  return `project = "${projectKey}" AND labels = "${MARKER_LABEL}" AND labels = "${emailHash}" AND labels = "${tenantLabelValue}" AND resolution = Unresolved`;
}
