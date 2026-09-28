/**
 * Unit tests for `readTenantOnboardingConfig`.
 *
 * Covers the config defaults and fail-fast validation rules from the design
 * (Requirements 7.1, 7.2, 7.3). Uses `@backstage/backend-test-utils`'
 * `mockServices.rootConfig` to build the `tenantOnboarding.jira` block the
 * reader consumes. No network operation is exercised here.
 */

import { mockServices } from '@backstage/backend-test-utils';
import { JsonObject } from '@backstage/types';
import { readTenantOnboardingConfig } from '../../lib/config';

/** Build a `RootConfigService` from a `tenantOnboarding.jira` block. */
function makeConfig(jira: JsonObject) {
  return mockServices.rootConfig({ data: { tenantOnboarding: { jira } } });
}

describe('readTenantOnboardingConfig', () => {
  const baseValid = {
    baseUrl: 'https://example.atlassian.net',
    email: 'bot@example.com',
    apiToken: 'token-123',
    projectKey: 'ONB',
    webhookSecret: 'hook-secret',
  };

  it('resolves all fields for a fully valid config', () => {
    const config = makeConfig({ ...baseValid });

    expect(readTenantOnboardingConfig(config)).toEqual({
      baseUrl: 'https://example.atlassian.net',
      email: 'bot@example.com',
      apiToken: 'token-123',
      projectKey: 'ONB',
      issueType: 'Task',
      webhookSecret: 'hook-secret',
      doneStatus: 'Done',
    });
  });

  it('defaults issueType to "Task" when absent', () => {
    const config = makeConfig({ ...baseValid });

    expect(readTenantOnboardingConfig(config).issueType).toBe('Task');
  });

  it('uses the configured issueType when supplied', () => {
    const config = makeConfig({ ...baseValid, issueType: 'Story' });

    expect(readTenantOnboardingConfig(config).issueType).toBe('Story');
  });

  it('defaults doneStatus to "Done" when absent', () => {
    const config = makeConfig({ ...baseValid });

    expect(readTenantOnboardingConfig(config).doneStatus).toBe('Done');
  });

  it('uses the configured doneStatus when supplied', () => {
    const config = makeConfig({ ...baseValid, doneStatus: 'Closed' });

    expect(readTenantOnboardingConfig(config).doneStatus).toBe('Closed');
  });

  it('strips a trailing slash from baseUrl', () => {
    const config = makeConfig({
      ...baseValid,
      baseUrl: 'https://example.atlassian.net/',
    });

    expect(readTenantOnboardingConfig(config).baseUrl).toBe(
      'https://example.atlassian.net',
    );
  });

  it.each(['baseUrl', 'email', 'apiToken', 'projectKey', 'webhookSecret'])(
    'fails with a key-naming error when %s is absent',
    key => {
      const jira: JsonObject = { ...baseValid };
      delete jira[key];
      const config = makeConfig(jira);

      expect(() => readTenantOnboardingConfig(config)).toThrow(
        new RegExp(`tenantOnboarding\\.jira\\.${key}`),
      );
    },
  );

  it.each(['baseUrl', 'email', 'apiToken', 'projectKey', 'webhookSecret'])(
    'fails with a key-naming error when %s is empty',
    key => {
      const config = makeConfig({ ...baseValid, [key]: '' });

      expect(() => readTenantOnboardingConfig(config)).toThrow(
        new RegExp(`tenantOnboarding\\.jira\\.${key}`),
      );
    },
  );
});
