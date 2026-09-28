import type {
  LoggerService,
  RootConfigService,
} from '@backstage/backend-plugin-api';
import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { readTenantOnboardingConfig } from '../lib/config';
import {
  buildIssuePayload,
  type OnboardingSubmission,
} from '../lib/fieldMapping';
import {
  buildDuplicateCheckJql,
} from '../lib/jql';
import {
  createJiraClient,
  type JiraClientOptions,
} from '../lib/jiraClient';
import { emailLabelHash, tenantLabel } from '../lib/lookupKey';

/** Output produced by the `onboarding:create-jira-issue` action. */
export interface CreateJiraIssueOutput {
  issueKey: string;
  issueUrl: string;
  issueId: string;
  reusedExisting: boolean;
}

/** Options for constructing the `onboarding:create-jira-issue` action. */
export interface CreateJiraIssueActionOptions {
  config: RootConfigService;
  logger: LoggerService;
  clientFactory?: (
    options: JiraClientOptions,
  ) => ReturnType<typeof createJiraClient>;
}

/** Tenant name pattern shared with the provisioning template (RFC1123-style). */
const TENANT_NAME_PATTERN = /^[a-z0-9]([a-z0-9-]{1,20})[a-z0-9]$/;

/** The fixed set of valid environments. */
const ENVIRONMENTS = ['dev', 'staging', 'prod'] as const;

/** Supported Azure regions offered by the form. */
const LOCATIONS = ['japaneast', 'japanwest', 'southeastasia'] as const;

/**
 * The fields the lookup response and duplicate check request from Jira.
 * `maxResults` for the duplicate check is 1 — the presence of any match is all
 * that matters.
 */
const DUPLICATE_CHECK_FIELDS = ['summary', 'status', 'created', 'labels'];

/**
 * Validates the raw action input and narrows it to an `OnboardingSubmission`.
 * Runs before any Jira call so that invalid input never produces a side effect
 * (Req 2.6).
 */
function parseSubmission(input: unknown): OnboardingSubmission {
  const record = (input ?? {}) as Record<string, unknown>;

  const tenantName = record.tenantName;
  if (typeof tenantName !== 'string' || !TENANT_NAME_PATTERN.test(tenantName)) {
    throw new Error(
      `Invalid input 'tenantName': must match ^[a-z0-9]([a-z0-9-]{1,20})[a-z0-9]$`,
    );
  }

  const contactEmail = record.contactEmail;
  if (typeof contactEmail !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail)) {
    throw new Error(`Invalid input 'contactEmail': must be a valid email`);
  }

  const environment = record.environment;
  if (
    typeof environment !== 'string' ||
    !ENVIRONMENTS.includes(environment as (typeof ENVIRONMENTS)[number])
  ) {
    throw new Error(
      `Invalid input 'environment': must be one of ${ENVIRONMENTS.join(', ')}`,
    );
  }

  const location = record.location;
  if (
    typeof location !== 'string' ||
    !LOCATIONS.includes(location as (typeof LOCATIONS)[number])
  ) {
    throw new Error(
      `Invalid input 'location': must be one of ${LOCATIONS.join(', ')}`,
    );
  }

  for (const key of ['contactName', 'organization', 'purpose'] as const) {
    if (typeof record[key] !== 'string' || (record[key] as string).length === 0) {
      throw new Error(`Invalid input '${key}': must be a non-empty string`);
    }
  }

  return {
    tenantName,
    contactEmail,
    contactName: record.contactName as string,
    organization: record.organization as string,
    environment: environment as OnboardingSubmission['environment'],
    location,
    purpose: record.purpose as string,
  };
}

/**
 * Creates the `onboarding:create-jira-issue` scaffolder action: validates the
 * submitted onboarding form, checks for an existing unresolved request from the
 * same tenant/email (fail-open on search error, Req 3.3), and files a new Jira
 * issue when none exists.
 *
 * Only non-personal values (project key, issue key, `reusedExisting`) are
 * logged (Req 7.5). The input schema is enforced both here and by the zod
 * schema below.
 */
export function createJiraIssueAction(options: CreateJiraIssueActionOptions) {
  const { config, clientFactory = createJiraClient } = options;

  return createTemplateAction({
    id: 'onboarding:create-jira-issue',
    schema: {
      input: {
        tenantName: z => z.string(),
        contactEmail: z => z.string(),
        contactName: z => z.string(),
        organization: z => z.string(),
        environment: z => z.enum(ENVIRONMENTS),
        location: z => z.string(),
        purpose: z => z.string(),
      },
      output: {
        issueKey: z => z.string(),
        issueUrl: z => z.string(),
        issueId: z => z.string(),
        reusedExisting: z => z.boolean(),
      },
    },
    async handler(ctx) {
      const submission = parseSubmission(ctx.input);

      const jiraConfig = readTenantOnboardingConfig(config);
      const client = clientFactory({ config: jiraConfig });

      const emailHash = emailLabelHash(submission.contactEmail);
      const tenantLabelValue = tenantLabel(submission.tenantName);

      // Duplicate check — fail-open: a failing auxiliary search must not block a
      // submission, so on error we log a warning and create the issue anyway.
      let existing;
      try {
        const matches = await client.searchIssues(
          buildDuplicateCheckJql(
            jiraConfig.projectKey,
            emailHash,
            tenantLabelValue,
          ),
          DUPLICATE_CHECK_FIELDS,
          1,
        );
        existing = matches[0];
      } catch (error) {
        ctx.logger.warn(
          `Onboarding duplicate check failed; creating a new issue. Reason: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        );
      }

      if (existing) {
        ctx.output('issueKey', existing.issueKey);
        ctx.output('issueUrl', existing.url);
        ctx.output('issueId', '');
        ctx.output('reusedExisting', true);
        ctx.logger.info(
          `Reused existing onboarding issue ${existing.issueKey} in project ${jiraConfig.projectKey}`,
        );
        return;
      }

      const created = await client.createIssue(
        buildIssuePayload(submission, jiraConfig),
      );

      ctx.output('issueKey', created.key);
      ctx.output('issueUrl', created.url);
      ctx.output('issueId', created.id);
      ctx.output('reusedExisting', false);
      ctx.logger.info(
        `Created onboarding issue ${created.key} in project ${jiraConfig.projectKey}`,
      );
    },
  });
}
