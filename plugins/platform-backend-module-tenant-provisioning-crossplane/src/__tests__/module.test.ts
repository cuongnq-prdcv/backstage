/**
 * Registration tests for the tenant-provisioning-crossplane module.
 *
 * - The module builds an action whose id is exactly
 *   `tenant:render-crossplane-manifest` and hands it to the scaffolder actions
 *   registry on startup (Req 1.1, 1.2).
 * - The module attaches to the `scaffolder` plugin so the action reaches the
 *   real registry (Req 1.1, 1.2).
 *
 * No git/network/crossplane operation is exercised: the action no longer contains
 * any, so building and registering it is inert.
 */

import type { BackendFeature } from '@backstage/backend-plugin-api';
import { mockServices, startTestBackend } from '@backstage/backend-test-utils';
import { scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node';

import platformModuleTenantProvisioningCrossplane from '../index';
import { platformModuleTenantProvisioningCrossplane as namedModule } from '../module';
import { createRenderCrossplaneManifestAction } from '../actions/renderCrossplaneManifest';

type ModuleRegistrationsFeature = BackendFeature & {
  getRegistrations(): Array<{ pluginId: string; moduleId: string }>;
};

const validConfig = mockServices.rootConfig({
  data: {
    crossplaneProvisioning: {
      liveRepoUrl: 'https://github.com/example/adp-gitops-tenants',
    },
  },
});

describe('tenant-provisioning-crossplane module registration', () => {
  beforeEach(() => jest.clearAllMocks());

  it('builds an action whose id is exactly "tenant:render-crossplane-manifest" (Req 1.1)', () => {
    const action = createRenderCrossplaneManifestAction({
      config: validConfig,
      logger: mockServices.logger.mock(),
    });
    expect(action.id).toBe('tenant:render-crossplane-manifest');
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
    expect(addedActions.map(a => a.id)).toContain(
      'tenant:render-crossplane-manifest',
    );
  });

  it('attaches to the scaffolder plugin (Req 1.1, 1.2)', () => {
    const registrations = (
      namedModule as ModuleRegistrationsFeature
    ).getRegistrations();
    expect(registrations[0].pluginId).toBe('scaffolder');
    expect(registrations[0].moduleId).toBe('tenant-provisioning-crossplane');
  });
});
