import { createHash } from 'crypto';

/**
 * The fixed label present on every onboarding-request issue.
 */
export const MARKER_LABEL = 'tenant-onboarding';

/**
 * Derives the exact-match lookup label for a contact email:
 * `onb-<first 16 hex chars of sha256(lowercased, trimmed email)>`.
 *
 * Hashing (rather than embedding the email literally) keeps the label from
 * exposing the set of contact emails in the Jira project's label list, and
 * guarantees the label — and therefore the JQL literal built from it — is
 * always exactly 16 hex characters, regardless of what was submitted.
 */
export function emailLabelHash(email: string): string {
  const normalized = email.trim().toLowerCase();
  const digest = createHash('sha256').update(normalized).digest('hex');
  return `onb-${digest.slice(0, 16)}`;
}

/**
 * Derives the exact-match duplicate-detection label for a tenant name:
 * `onb-tenant-<tenantName>`.
 *
 * `tenantName` is already constrained by the template's pattern to
 * `[a-z0-9-]`, so this label is always safe to embed in JQL without
 * quoting concerns.
 */
export function tenantLabel(tenantName: string): string {
  return `onb-tenant-${tenantName}`;
}
