import { SignInPage, type IdentityProviders } from '@backstage/core-components';
import {
  githubAuthApiRef,
  microsoftAuthApiRef,
} from '@backstage/core-plugin-api';
import type { SignInPageProps } from '@backstage/plugin-app-react';

/**
 * Sign-in providers presented on the sign-in page.
 *
 * GitHub and Microsoft (Azure Entra ID) are offered as selectable OAuth options
 * (wired to `githubAuthApiRef` / `microsoftAuthApiRef`), and guest is retained
 * so local development keeps working without credentials.
 */
const providers: IdentityProviders = [
  'guest',
  {
    id: 'github-auth-provider',
    title: 'GitHub',
    message: 'Sign in using GitHub',
    apiRef: githubAuthApiRef,
  },
  {
    id: 'microsoft-auth-provider',
    title: 'Microsoft',
    message: 'Sign in using Azure Entra ID',
    apiRef: microsoftAuthApiRef,
  },
];

/**
 * The sign-in page component rendered by the app's sign-in extension. Presents
 * GitHub, Microsoft, and guest as selectable providers before authentication.
 */
export function AppSignInPage(props: SignInPageProps) {
  return <SignInPage {...props} providers={providers} />;
}
