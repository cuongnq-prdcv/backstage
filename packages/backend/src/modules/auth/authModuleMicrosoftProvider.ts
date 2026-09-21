/**
 * Custom Microsoft (Azure Entra ID) authentication provider backend module.
 *
 * This module registers the Microsoft OAuth provider with the Auth Backend
 * using a code-defined sign-in resolver (the azure-entraid-login design). It
 * targets `pluginId: 'auth'`, `providerId: 'microsoft'`, builds the provider
 * with {@link createOAuthProviderFactory} + {@link microsoftAuthenticator}, and
 * supplies the custom resolver from {@link createMicrosoftSignInResolver}.
 *
 * The resolver implements the POC "trust-the-IdP" model: it derives the
 * Backstage identity from the profile email local-part and issues a token
 * without a catalog lookup, so this module needs no catalog dependency (unlike
 * the GitHub provider module).
 *
 * Credential values (`AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` /
 * `AZURE_TENANT_ID`) are never read or logged in this module; they are resolved
 * by the provider factory from `app-config` `${...}` references.
 */

import { createBackendModule } from '@backstage/backend-plugin-api';
import {
  authProvidersExtensionPoint,
  createOAuthProviderFactory,
} from '@backstage/plugin-auth-node';
import { microsoftAuthenticator } from '@backstage/plugin-auth-backend-module-microsoft-provider';
import { createMicrosoftSignInResolver } from './microsoftSignInResolver';

/**
 * Backend module that registers the Microsoft provider (`providerId:
 * 'microsoft'`) with the Auth Backend, wired to the custom sign-in resolver.
 */
export const authModuleMicrosoftProvider = createBackendModule({
  pluginId: 'auth',
  moduleId: 'microsoft-provider',
  register(reg) {
    reg.registerInit({
      deps: {
        providers: authProvidersExtensionPoint,
      },
      async init({ providers }) {
        providers.registerProvider({
          providerId: 'microsoft',
          factory: createOAuthProviderFactory({
            authenticator: microsoftAuthenticator,
            signInResolver: createMicrosoftSignInResolver(),
          }),
        });
      },
    });
  },
});
