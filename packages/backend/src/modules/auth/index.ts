/**
 * Public interface of the backend `auth` module.
 *
 * Currently exposes the custom Microsoft (Azure Entra ID) OAuth provider with
 * its code-defined, trust-the-IdP sign-in resolver (azure-entraid-login design).
 */
export { authModuleMicrosoftProvider } from './authModuleMicrosoftProvider';
