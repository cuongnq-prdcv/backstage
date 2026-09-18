import {
  coreServices,
  createBackendModule,
} from '@backstage/backend-plugin-api';
import { scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node';

import { createTenantProvisionCrossplaneAction } from './actions/tenantProvisionCrossplane';

export const platformModuleTenantProvisioningCrossplane = createBackendModule({
  pluginId: 'scaffolder',
  moduleId: 'tenant-provisioning-crossplane',
  register(reg) {
    reg.registerInit({
      deps: {
        scaffolder: scaffolderActionsExtensionPoint,
        config: coreServices.rootConfig,
        logger: coreServices.logger,
      },
      async init({ scaffolder, config, logger }) {
        scaffolder.addActions(
          createTenantProvisionCrossplaneAction({ config, logger }),
        );
      },
    });
  },
});
