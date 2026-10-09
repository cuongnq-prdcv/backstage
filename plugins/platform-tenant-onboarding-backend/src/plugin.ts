import {
  coreServices,
  createBackendPlugin,
} from '@backstage/backend-plugin-api';
import { createRouter } from './router';
import { createWebhookRouter } from './webhookRouter';

/**
 * The `tenant-onboarding` backend plugin: exposes the request-lookup HTTP
 * endpoint and the Jira completion webhook. The scaffolder action lives in the
 * separate `scaffolder`-scoped module registered from `module.ts`.
 *
 * @public
 */
export const platformTenantOnboardingPlugin = createBackendPlugin({
  pluginId: 'platform-tenant-onboarding',
  register(env) {
    env.registerInit({
      deps: {
        config: coreServices.rootConfig,
        logger: coreServices.logger,
        httpAuth: coreServices.httpAuth,
        httpRouter: coreServices.httpRouter,
      },
      async init({ config, logger, httpAuth, httpRouter }) {
        httpRouter.use(await createRouter({ config, logger, httpAuth }));
        httpRouter.use(await createWebhookRouter({ config, logger, httpAuth }));
        // The Jira completion webhook is called by Jira Automation, which has no
        // Backstage user credential; it authenticates with the shared secret in
        // its own handler, so exempt just this path from the default auth policy.
        // httpRouter.addAuthPolicy({
        //   path: '/send-mail',
        //   allow: 'unauthenticated',
        // });
      },
    });
  },
});
