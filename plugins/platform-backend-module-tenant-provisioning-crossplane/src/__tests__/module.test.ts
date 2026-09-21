/**
 * Registration + fail-fast tests for the tenant-provisioning-crossplane module.
 *
 * - The module builds an action whose id is exactly `tenant:provision-crossplane`
 *   and hands it to the scaffolder actions registry on startup (Req 1.1, 1.2).
 * - The module attaches to the `scaffolder` plugin so the action reaches the
 *   real registry (Req 1.1, 1.2).
 * - Fail-fast: invalid input is rejected with no side effects (Property 4).
 *
 * No git/network/crossplane operation is exercised: building the action is
 * pure, the extension point is a capturing mock, and the git collaborator is
 * mocked with spies asserted never-called.
 */

import type { BackendFeature } from '@backstage/backend-plugin-api';
import { mockServices, startTestBackend } from '@backstage/backend-test-utils';
import { scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node';
import fc from 'fast-check';

type ModuleRegistrationsFeature = BackendFeature & {
  getRegistrations(): Array<{ pluginId: string; moduleId: string }>;
};

// Mock the network-touching collaborator so we can assert it is never reached
// on invalid input, and so backend startup never touches the network.
const gitHelperMock = {
  clone: jest.fn(),
  localBranchOrRemoteExists: jest.fn(),
  createBranchCommitPush: jest.fn(),
  findOpenPullRequest: jest.fn(),
  createPullRequest: jest.fn(),
};
const createGitHelperMock = jest.fn(() => gitHelperMock);
const resolveLiveRepoTokenMock = jest.fn(async () => 'fake-token');

jest.mock('../lib/git', () => ({
  __esModule: true,
  CLONE_TIMEOUT_MS: 120_000,
  PUSH_TIMEOUT_MS: 60_000,
  PULL_REQUEST_TIMEOUT_MS: 60_000,
  createGitHelper: (...args: unknown[]) => createGitHelperMock(...(args as [])),
  resolveLiveRepoToken: (...args: unknown[]) =>
    resolveLiveRepoTokenMock(...(args as [])),
}));

import platformModuleTenantProvisioningCrossplane from '../index';
import { platformModuleTenantProvisioningCrossplane as namedModule } from '../module';
import { createTenantProvisionCrossplaneAction } from '../actions/tenantProvisionCrossplane';

const validConfig = mockServices.rootConfig({
  data: {
    crossplaneProvisioning: {
      liveRepoUrl: 'https://github.com/example/hello-crossplane-aws',
    },
  },
});

describe('tenant-provisioning-crossplane module registration', () => {
  beforeEach(() => jest.clearAllMocks());

  it('builds an action whose id is exactly "tenant:provision-crossplane" (Req 1.1)', () => {
    const action = createTenantProvisionCrossplaneAction({
      config: validConfig,
      logger: mockServices.logger.mock(),
    });
    expect(action.id).toBe('tenant:provision-crossplane');
  });

  it('registers the action with the scaffolder registry on startup (Req 1.1, 1.2)', async () => {
    const addedActions: Array<{ id: string }> = [];
    const addActions = jest.fn((...actions: Array<{ id: string }>) => {
      addedActions.push(...actions);
    });

    await startTestBackend({
      extensionPoints: [[scaffolderActionsExtensionPoint, { addActions }]],
      features: [platformModuleTenantProvisioningCrossplane],
    });

    expect(addActions).toHaveBeenCalled();
    expect(addedActions.map(a => a.id)).toContain('tenant:provision-crossplane');
  });

  it('attaches to the scaffolder plugin (Req 1.1, 1.2)', () => {
    const registrations = (
      namedModule as ModuleRegistrationsFeature
    ).getRegistrations();
    expect(registrations[0].pluginId).toBe('scaffolder');
    expect(registrations[0].moduleId).toBe('tenant-provisioning-crossplane');
  });
});

describe('fail-fast input validation (Property 4)', () => {
  // Feature: tenant-provision-crossplane, Property 4: Invalid input is rejected
  // with no side effects
  // Validates: Requirements 1.4, 8.1, 8.2, 8.3, 8.4
  it('rejects invalid tenantName/environment without touching git (Property 4)', async () => {
    const invalidTenant = fc
      .string({ maxLength: 40 })
      .filter(s => !/^[a-z0-9]([a-z0-9-]{1,20})[a-z0-9]$/.test(s));
    const invalidEnv = fc
      .string({ maxLength: 12 })
      .filter(s => !['dev', 'staging', 'prod'].includes(s));

    await fc.assert(
      fc.asyncProperty(invalidTenant, invalidEnv, async (tenant, env) => {
        jest.clearAllMocks();
        const action = createTenantProvisionCrossplaneAction({
          config: validConfig,
          logger: mockServices.logger.mock(),
        });

        const ctx = {
          input: { tenantName: tenant, environment: env },
          workspacePath: undefined,
          output: jest.fn(),
          logger: mockServices.logger.mock(),
        } as any;

        await expect(action.handler(ctx)).rejects.toThrow();

        // No side effects: git never resolved/constructed, no output.
        expect(resolveLiveRepoTokenMock).not.toHaveBeenCalled();
        expect(createGitHelperMock).not.toHaveBeenCalled();
        expect(gitHelperMock.clone).not.toHaveBeenCalled();
        expect(ctx.output).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });
});
