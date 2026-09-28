import { createBackendModule } from '@backstage/backend-plugin-api';
import { policyExtensionPoint } from '@backstage/plugin-permission-node/alpha';
import { TenantFlowPermissionPolicy } from './flowPolicy';

/**
 * Registers {@link TenantFlowPermissionPolicy} as the permission policy,
 * replacing the stock allow-all policy. It governs the guest onboarding vs
 * Microsoft provisioning flow separation.
 */
export const permissionModuleTenantFlowPolicy = createBackendModule({
  pluginId: 'permission',
  moduleId: 'tenant-flow-policy',
  register(reg) {
    reg.registerInit({
      deps: { policy: policyExtensionPoint },
      async init({ policy }) {
        policy.setPolicy(new TenantFlowPermissionPolicy());
      },
    });
  },
});
