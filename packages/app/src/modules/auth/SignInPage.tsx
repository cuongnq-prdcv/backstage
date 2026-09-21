import { SignInPage, type IdentityProviders } from '@backstage/core-components';
import { microsoftAuthApiRef } from '@backstage/core-plugin-api';
import type { SignInPageProps } from '@backstage/plugin-app-react';

/**
 * Sign-in providers presented on the sign-in page.
 *
 * Microsoft (Azure Entra ID) is offered as a selectable OAuth option (wired to
 * `microsoftAuthApiRef`), and guest is retained so local development keeps
 * working without credentials.
 */
const providers: IdentityProviders = [
  'guest',
  {
    id: 'microsoft-auth-provider',
    title: 'Microsoft',
    message: 'Sign in using Azure Entra ID',
    apiRef: microsoftAuthApiRef,
  },
];

/**
 * The sign-in page component rendered by the app's sign-in extension. Presents
 * Microsoft and guest as selectable providers before authentication.
 */
export function AppSignInPage(props: SignInPageProps) {
  return <SignInPage {...props} providers={providers} />;
}
