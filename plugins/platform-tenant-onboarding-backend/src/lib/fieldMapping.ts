import type { JiraConfig } from './config';
import { emailLabelHash, MARKER_LABEL, tenantLabel } from './lookupKey';

/** The seven fields collected by the onboarding template. */
export interface OnboardingSubmission {
  tenantName: string;
  contactEmail: string;
  contactName: string;
  organization: string;
  environment: 'dev' | 'staging' | 'prod';
  location: string;
  purpose: string;
}

/** An Atlassian Document Format node (loosely typed for this POC). */
export interface AdfNode {
  type: string;
  [key: string]: unknown;
}

/** The document sent as a Jira issue's `description` field (ADF, v3 API). */
export interface AdfDocument {
  type: 'doc';
  version: 1;
  content: AdfNode[];
}

/** The body sent to `POST /rest/api/3/issue`. */
export interface JiraIssuePayload {
  fields: {
    project: { key: string };
    issuetype: { name: string };
    summary: string;
    description: AdfDocument;
    labels: string[];
  };
}

/**
 * The stable order and human-readable labels used in the ADF description.
 * Adding a future onboarding field means adding one entry here and to
 * `OnboardingSubmission`; the ADF construction itself does not change.
 *
 * Exported so `adfParser` can reverse the exact same label↔key mapping,
 * keeping the description builder and parser from drifting apart.
 */
export const FIELD_ORDER: ReadonlyArray<{
  key: keyof OnboardingSubmission;
  label: string;
}> = [
  { key: 'tenantName', label: 'Tenant name' },
  { key: 'contactEmail', label: 'Contact email' },
  { key: 'contactName', label: 'Contact name' },
  { key: 'organization', label: 'Organization' },
  { key: 'environment', label: 'Environment' },
  { key: 'location', label: 'Location' },
  { key: 'purpose', label: 'Purpose' },
];

function buildAdfDescription(submission: OnboardingSubmission): AdfDocument {
  return {
    type: 'doc',
    version: 1,
    content: FIELD_ORDER.map(({ key, label }) => ({
      type: 'paragraph',
      content: [{
        type: 'text',
        text: `${label}: ${submission[key]}`,
      }],
    })),
  };
}

/**
 * Maps a submitted onboarding form to a Jira issue payload: summary, an ADF
 * description containing all seven values, and the three fixed labels.
 *
 * Jira Cloud REST API v3 requires the description to be Atlassian Document
 * Format rather than a plain string. The payload deliberately uses only core
 * Jira fields; it does not require Jira Forms or per-field custom fields.
 */
export function buildIssuePayload(
  submission: OnboardingSubmission,
  cfg: JiraConfig,
): JiraIssuePayload {
  return {
    fields: {
      project: { key: cfg.projectKey },
      issuetype: { name: cfg.issueType },
      summary: `[Onboarding] ${submission.tenantName} — ${submission.organization}`,
      description: buildAdfDescription(submission),
      labels: [
        MARKER_LABEL,
        emailLabelHash(submission.contactEmail),
        tenantLabel(submission.tenantName),
      ],
    },
  };
}
