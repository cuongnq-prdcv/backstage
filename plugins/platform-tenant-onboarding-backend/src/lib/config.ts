import type { RootConfigService } from '@backstage/backend-plugin-api';

/**
 * Jira settings read from the `tenantOnboarding.jira` config block.
 */
export interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
  issueType: string;
  webhookSecret: string;
  doneStatus: string;
}

/** Default issue type used when `tenantOnboarding.jira.issueType` is not configured. */
const DEFAULT_ISSUE_TYPE = 'Task';

/** Default Jira status name treated as "completed" when `doneStatus` is not configured. */
const DEFAULT_DONE_STATUS = 'Done';

/** Reads a required string key, throwing a config error naming the key when absent or empty. */
function readRequiredString(config: RootConfigService, key: string): string {
  const value = config.getOptionalString(key);
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing required config value '${key}'`);
  }
  return value;
}

/**
 * Reads and validates the `tenantOnboarding.jira` config block.
 *
 * - `baseUrl`, `email`, `apiToken`, `projectKey`, and `webhookSecret` are
 *   required; each throws an error naming the missing key when absent or empty
 *   (Req 7.3, 5.4).
 * - `issueType` defaults to `Task` and `doneStatus` defaults to `Done` when absent.
 * - A trailing `/` on `baseUrl` is stripped, so callers building URLs never
 *   produce a double slash.
 *
 * Values come from `${ENV_VAR}` references in app-config, never literals
 * (Req 7.1).
 */
export function readTenantOnboardingConfig(
  config: RootConfigService,
): JiraConfig {
  const baseUrl = readRequiredString(
    config,
    'tenantOnboarding.jira.baseUrl',
  ).replace(/\/+$/, '');
  const email = readRequiredString(config, 'tenantOnboarding.jira.email');
  const apiToken = readRequiredString(
    config,
    'tenantOnboarding.jira.apiToken',
  );
  const projectKey = readRequiredString(
    config,
    'tenantOnboarding.jira.projectKey',
  );
  const issueType =
    config.getOptionalString('tenantOnboarding.jira.issueType') ??
    DEFAULT_ISSUE_TYPE;
  const webhookSecret = readRequiredString(
    config,
    'tenantOnboarding.jira.webhookSecret',
  );
  const doneStatus =
    config.getOptionalString('tenantOnboarding.jira.doneStatus') ??
    DEFAULT_DONE_STATUS;

  return {
    baseUrl,
    email,
    apiToken,
    projectKey,
    issueType,
    webhookSecret,
    doneStatus,
  };
}
