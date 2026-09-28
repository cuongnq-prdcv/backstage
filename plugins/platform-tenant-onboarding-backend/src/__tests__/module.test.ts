/**
 * Registration tests for the tenant-onboarding scaffolder module.
 *
 * Verifies the module attaches to the `scaffolder` plugin and registers an
 * action whose id is exactly `onboarding:create-jira-issue`. No network
 * operation is exercised.
 */

import type { BackendFeature } from '@backstage/backend-plugin-api';
import { mockServices, startTestBackend } from '@backstage/backend-test-utils';
import { scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node';

import { scaffolderModuleTenantOnboarding } from '../module';

type ModuleRegistrationsFeature = BackendFeature & {
  getRegistrations(): Array<{ pluginId: string; moduleId: string }>;
};

const validConfig = mockServices.rootConfig({
  data: {
    tenantOnboarding: {
      jira: {
        baseUrl: 'https://example.atlassian.net',
        email: 'bot@example.com',
        apiToken: 'token-123',
        projectKey: 'ONB',
        webhookSecret: 'hook-secret',
      },
    },
  },
});

describe('tenant-onboarding module registration', () => {
  it('registers onboarding:create-jira-issue with the scaffolder registry', async () => {
    const addedActions: Array<{ id: string }> = [];
    const addActions = jest.fn((...actions: Array<{ id: string }>) => {
      addedActions.push(...actions);
    });

    await startTestBackend({
      extensionPoints: [[scaffolderActionsExtensionPoint, { addActions }]],
      features: [
        scaffolderModuleTenantOnboarding,
        mockServices.rootConfig.factory({ data: validConfig.get() }),
      ],
    });

    expect(addActions).toHaveBeenCalled();
    expect(addedActions.map(a => a.id)).toContain(
      'onboarding:create-jira-issue',
    );
  });

  it('attaches to the scaffolder plugin', () => {
    const registrations = (
      scaffolderModuleTenantOnboarding as ModuleRegistrationsFeature
    ).getRegistrations();
    expect(registrations[0].pluginId).toBe('scaffolder');
    expect(registrations[0].moduleId).toBe('tenant-onboarding');
  });
});
