import { createBackend } from '@backstage/backend-defaults';
import { mockServices } from '@backstage/backend-test-utils';

// Development harness for this plugin. Start with `yarn start` in this
// package directory, then:
//
//   curl 'http://localhost:7007/api/platform-tenant-onboarding/requests?email=a@b.com'
//
// Real Jira credentials must be supplied via app-config (see
// tenantOnboarding.jira.*) for requests to succeed.

const backend = createBackend();

// Mocking auth/httpAuth allows calling the plugin API without a real
// sign-in flow during local development.
backend.add(mockServices.auth.factory());
backend.add(mockServices.httpAuth.factory());

backend.add(import('../src'));

backend.start();
