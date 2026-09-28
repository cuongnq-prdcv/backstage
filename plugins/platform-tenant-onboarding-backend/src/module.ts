import {
  coreServices,
  createBackendModule,
} from '@backstage/backend-plugin-api';
import { scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node';
import { createJiraIssueAction } from './actions/createJiraIssue';

/**
 * Registers the `onboarding:create-jira-issue` scaffolder action.
 *
 * @public
 */
export const scaffolderModuleTenantOnboarding = createBackendModule({
  pluginId: 'scaffolder',
  moduleId: 'tenant-onboarding',
  register(reg) {
    reg.registerInit({
      deps: {
        scaffolder: scaffolderActionsExtensionPoint,
        config: coreServices.rootConfig,
        logger: coreServices.logger,
      },
      async init({ scaffolder, config, logger }) {
        scaffolder.addActions(createJiraIssueAction({ config, logger }));
      },
    });
  },
});
