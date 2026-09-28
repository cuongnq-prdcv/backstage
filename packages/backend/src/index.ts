/*
 * Hi!
 *
 * Note that this is an EXAMPLE Backstage backend. Please check the README.
 *
 * Happy hacking!
 */

import { createBackend } from '@backstage/backend-defaults';
import { authModuleMicrosoftProvider } from './modules/auth';
import { permissionModuleTenantFlowPolicy } from './modules/permission';
import { scaffolderModuleTenantOnboarding } from '@internal/backstage-plugin-platform-tenant-onboarding-backend';

const backend = createBackend();

backend.add(import('@backstage/plugin-app-backend'));
backend.add(import('@backstage/plugin-proxy-backend'));

// scaffolder plugin
backend.add(import('@backstage/plugin-scaffolder-backend'));
backend.add(import('@backstage/plugin-scaffolder-backend-module-github'));
backend.add(
  import('@backstage/plugin-scaffolder-backend-module-notifications'),
);
// Onboarding scaffolder action (onboarding:create-jira-issue).
backend.add(scaffolderModuleTenantOnboarding);

// techdocs plugin
backend.add(import('@backstage/plugin-techdocs-backend'));

// auth plugin
backend.add(import('@backstage/plugin-auth-backend'));
// See https://backstage.io/docs/backend-system/building-backends/migrating#the-auth-plugin
backend.add(import('@backstage/plugin-auth-backend-module-guest-provider'));
// See https://backstage.io/docs/auth/guest/provider
// Custom Microsoft (Azure Entra ID) OAuth provider with a code-defined
// trust-the-IdP sign-in resolver (azure-entraid-login design).
backend.add(authModuleMicrosoftProvider);

// catalog plugin
backend.add(import('@backstage/plugin-catalog-backend'));
backend.add(
  import('@backstage/plugin-catalog-backend-module-scaffolder-entity-model'),
);

// See https://backstage.io/docs/features/software-catalog/configuration#subscribing-to-catalog-errors
backend.add(import('@backstage/plugin-catalog-backend-module-logs'));

// permission plugin
backend.add(import('@backstage/plugin-permission-backend'));
// Custom flow policy replacing allow-all: separates the guest onboarding flow
// from the Microsoft provisioning flow (a guest cannot run the provisioning
// template). See modules/permission/flowPolicy.ts.
backend.add(permissionModuleTenantFlowPolicy);

// search plugin
backend.add(import('@backstage/plugin-search-backend'));

// search engine
// See https://backstage.io/docs/features/search/search-engines
backend.add(import('@backstage/plugin-search-backend-module-pg'));

// search collators
backend.add(import('@backstage/plugin-search-backend-module-catalog'));
backend.add(import('@backstage/plugin-search-backend-module-techdocs'));

// kubernetes plugin
backend.add(import('@backstage/plugin-kubernetes-backend'));

// user settings plugin
backend.add(import('@backstage/plugin-user-settings-backend'));

// notifications and signals plugins
backend.add(import('@backstage/plugin-notifications-backend'));
backend.add(import('@backstage/plugin-signals-backend'));

// mcp actions plugin
backend.add(import('@backstage/plugin-mcp-actions-backend'));

backend.add(import('@internal/backstage-plugin-platform-backend-module-tenant-provisioning-crossplane'));
// Onboarding request-lookup HTTP plugin (GET /api/platform-tenant-onboarding/requests).
backend.add(import('@internal/backstage-plugin-platform-tenant-onboarding-backend'));
backend.start();
