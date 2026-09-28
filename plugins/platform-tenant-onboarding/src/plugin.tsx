import {
  ApiBlueprint,
  createFrontendPlugin,
  PageBlueprint,
} from '@backstage/frontend-plugin-api';
import {
  createApiFactory,
  discoveryApiRef,
  fetchApiRef,
} from '@backstage/core-plugin-api';
import { DefaultOnboardingApi, onboardingApiRef } from './api/OnboardingApi';

/**
 * Registers the {@link OnboardingApi} implementation.
 */
export const onboardingApi = ApiBlueprint.make({
  name: 'onboarding',
  params: defineParams =>
    defineParams(
      createApiFactory({
        api: onboardingApiRef,
        deps: { discoveryApi: discoveryApiRef, fetchApi: fetchApiRef },
        factory: ({ discoveryApi, fetchApi }) =>
          new DefaultOnboardingApi({ discoveryApi, fetchApi }),
      }),
    ),
});

/**
 * The "My onboarding requests" lookup page. Its `title` makes it appear as a
 * sidebar nav item, which the app's sidebar filters by identity (Task 14).
 */
export const lookupPage = PageBlueprint.make({
  params: {
    path: '/tenant-onboarding/requests',
    title: 'Onboarding requests',
    loader: () =>
      import('./components/LookupPage').then(m => <m.LookupPage />),
  },
});

export const platformTenantOnboardingPlugin = createFrontendPlugin({
  pluginId: 'platform-tenant-onboarding',
  extensions: [onboardingApi, lookupPage],
});
