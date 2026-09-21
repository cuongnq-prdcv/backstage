import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  MockErrorApi,
  TestApiProvider,
  mockApis,
  renderInTestApp,
} from '@backstage/test-utils';
import {
  configApiRef,
  discoveryApiRef,
  errorApiRef,
  githubAuthApiRef,
  microsoftAuthApiRef,
  type ProfileInfo,
} from '@backstage/core-plugin-api';
import { AppSignInPage } from './SignInPage';

/**
 * These tests exercise the sign-in page surface for the GitHub provider
 * (Requirement 4). They render the real `AppSignInPage` (which wraps the
 * `@backstage/core-components` `SignInPage`) with a mocked `githubAuthApiRef`
 * so the provider selection and OAuth-start interaction are driven end to end
 * through the actual component, without contacting GitHub.
 *
 * The core-components `SignInPage` common provider drives a selected provider
 * by calling `authApi.getBackstageIdentity({ instantPopup: true })` (the OAuth
 * start), then `authApi.getProfile()`, and finally `props.onSignInSuccess(...)`.
 * On any failure it calls `errorApi.post(...)` and does NOT call
 * `onSignInSuccess`. The tests assert against exactly those observable effects.
 */

const IDENTITY = {
  type: 'user' as const,
  userEntityRef: 'user:default/octocat',
  ownershipEntityRefs: ['user:default/octocat'],
};

const PROFILE: ProfileInfo = {
  email: 'octocat@example.com',
  displayName: 'The Octocat',
};

/**
 * Finds the GitHub provider's sign-in button. Each provider is rendered in its
 * own list item (`<li>`); the GitHub card is the one carrying the descriptive
 * message "Sign in using GitHub", so we scope the button lookup to that card.
 */
async function getGithubSignInButton(): Promise<HTMLElement> {
  const message = await screen.findByText('Sign in using GitHub');
  const card = message.closest('li') as HTMLElement | null;
  if (!card) {
    throw new Error('Could not locate the GitHub provider card');
  }
  return within(card).getByRole('button');
}

/**
 * Builds a mock of the GitHub auth API surface that the sign-in page uses.
 *
 * `getBackstageIdentity` is the OAuth start handler invoked when the GitHub
 * option is selected; the `behavior` controls whether it resolves (success),
 * rejects (failure/cancel/timeout), or resolves undefined (not configured).
 */
function makeGithubAuthApi(behavior: {
  onSelect?: 'success' | 'reject' | 'undefined';
  rejectError?: Error;
}) {
  const { onSelect = 'success', rejectError } = behavior;

  // Called by the provider "loader" on initial render with { optional: true }.
  // Returning undefined keeps the user on the sign-in page (not signed in).
  const getBackstageIdentity = jest.fn(
    async (options?: { optional?: boolean; instantPopup?: boolean }) => {
      // Initial, non-interactive probe: report "not signed in".
      if (options?.optional) {
        return undefined;
      }
      // Interactive selection (instantPopup): this is the OAuth start.
      if (onSelect === 'reject') {
        throw rejectError ?? new Error('Login failed');
      }
      if (onSelect === 'undefined') {
        return undefined;
      }
      return {
        identity: IDENTITY,
        token: 'mock-token',
        expiresInSeconds: 3600,
      };
    },
  );

  const getProfile = jest.fn(async () => PROFILE);

  return {
    getBackstageIdentity,
    getProfile,
    // Remaining SessionApi/OAuthApi/ProfileInfoApi surface, unused by the
    // sign-in click path but present so the object satisfies the apiRef shape.
    getProfileInfo: jest.fn(async () => PROFILE),
    getAccessToken: jest.fn(async () => 'mock-access-token'),
    getIdToken: jest.fn(async () => 'mock-id-token'),
    signIn: jest.fn(async () => {}),
    signOut: jest.fn(async () => {}),
    sessionState$: jest.fn(() => ({
      subscribe: () => ({ unsubscribe: () => {} }),
    })),
  };
}

async function renderSignIn(
  githubApi: ReturnType<typeof makeGithubAuthApi>,
  errorApi: MockErrorApi,
  onSignInSuccess: jest.Mock,
  microsoftApi: ReturnType<typeof makeGithubAuthApi> = makeGithubAuthApi({
    onSelect: 'undefined',
  }),
) {
  // The core-components SignInPage reads `app.title`, and the retained guest
  // provider reads `backend.baseUrl`, via `useApi(configApiRef)` from React
  // context — which `TestApiProvider` supplies, so we control it directly here.
  const configApi = mockApis.config({
    data: {
      app: { title: 'Test App' },
      backend: { baseUrl: 'http://localhost:7007' },
    },
  });

  return renderInTestApp(
    <TestApiProvider
      apis={[
        [configApiRef, configApi],
        [discoveryApiRef, mockApis.discovery()],
        [githubAuthApiRef, githubApi as any],
        [microsoftAuthApiRef, microsoftApi as any],
        [errorApiRef, errorApi],
      ]}
    >
      <AppSignInPage onSignInSuccess={onSignInSuccess} />
    </TestApiProvider>,
  );
}

describe('AppSignInPage (GitHub sign-in surface)', () => {
  it('presents a selectable GitHub sign-in option before authentication (4.1)', async () => {
    const githubApi = makeGithubAuthApi({ onSelect: 'success' });
    const errorApi = new MockErrorApi({ collect: true });
    const onSignInSuccess = jest.fn();

    await renderSignIn(githubApi, errorApi, onSignInSuccess);

    // The GitHub provider card (title "GitHub") is visible as a distinct,
    // selectable option, with its descriptive message and a sign-in action.
    await waitFor(() => {
      expect(screen.getByText('GitHub')).toBeInTheDocument();
    });
    expect(screen.getByText('Sign in using GitHub')).toBeInTheDocument();

    // No session has been established simply by rendering the page.
    expect(onSignInSuccess).not.toHaveBeenCalled();
  });

  it('starts the GitHub OAuth flow when the GitHub option is selected (4.2)', async () => {
    const githubApi = makeGithubAuthApi({ onSelect: 'success' });
    const errorApi = new MockErrorApi({ collect: true });
    const onSignInSuccess = jest.fn();
    const user = userEvent.setup();

    await renderSignIn(githubApi, errorApi, onSignInSuccess);

    // Find the GitHub provider card and click its sign-in button.
    const signInButton = await getGithubSignInButton();
    await user.click(signInButton);

    // Selecting GitHub triggers the OAuth start handler (interactive, with a
    // popup) rather than only the passive optional probe.
    await waitFor(() => {
      expect(githubApi.getBackstageIdentity).toHaveBeenCalledWith(
        expect.objectContaining({ instantPopup: true }),
      );
    });

    // A successful flow issues the session exactly once.
    await waitFor(() => {
      expect(onSignInSuccess).toHaveBeenCalledTimes(1);
    });
    expect(errorApi.getErrors()).toHaveLength(0);
  });

  it('returns to the sign-in page with an error and no session when the flow fails/cancels/times out (4.4)', async () => {
    const githubApi = makeGithubAuthApi({
      onSelect: 'reject',
      rejectError: new Error('Popup closed by user'),
    });
    const errorApi = new MockErrorApi({ collect: true });
    const onSignInSuccess = jest.fn();
    const user = userEvent.setup();

    await renderSignIn(githubApi, errorApi, onSignInSuccess);

    const signInButton = await getGithubSignInButton();
    await user.click(signInButton);

    // A failed/cancelled/timed-out flow surfaces an error...
    await waitFor(() => {
      expect(errorApi.getErrors().length).toBeGreaterThan(0);
    });

    // ...establishes no session (onSignInSuccess never called)...
    expect(onSignInSuccess).not.toHaveBeenCalled();

    // ...and keeps the user on the sign-in page (GitHub option still shown).
    expect(screen.getByText('GitHub')).toBeInTheDocument();
  });

  it('denies the session and surfaces "identity could not be resolved" on a resolver denial (4.5)', async () => {
    const githubApi = makeGithubAuthApi({
      onSelect: 'reject',
      rejectError: new Error('identity could not be resolved'),
    });
    const errorApi = new MockErrorApi({ collect: true });
    const onSignInSuccess = jest.fn();
    const user = userEvent.setup();

    await renderSignIn(githubApi, errorApi, onSignInSuccess);

    const signInButton = await getGithubSignInButton();
    await user.click(signInButton);

    // The resolver denial is surfaced to the user as a posted error whose
    // cause carries the "identity could not be resolved" message.
    const denial = await waitFor(() => {
      const errors = errorApi.getErrors();
      expect(errors.length).toBeGreaterThan(0);
      return errors;
    });

    const serialized = denial
      .map(e => `${e.error?.message ?? ''} ${(e.error as any)?.cause?.message ?? ''}`)
      .join(' | ');
    expect(serialized).toMatch(/identity could not be resolved/i);

    // No session is established on a resolver denial.
    expect(onSignInSuccess).not.toHaveBeenCalled();
  });
});

describe('AppSignInPage (all providers present)', () => {
  it('presents guest, GitHub, and Microsoft as selectable options before authentication (4.1, 4.2)', async () => {
    const githubApi = makeGithubAuthApi({ onSelect: 'undefined' });
    const microsoftApi = makeGithubAuthApi({ onSelect: 'undefined' });
    const errorApi = new MockErrorApi({ collect: true });
    const onSignInSuccess = jest.fn();

    await renderSignIn(githubApi, errorApi, onSignInSuccess, microsoftApi);

    // All three provider cards are visible before authentication (4.1, 4.2).
    await waitFor(() => {
      expect(screen.getByText('GitHub')).toBeInTheDocument();
    });
    expect(screen.getByText('Sign in using GitHub')).toBeInTheDocument();
    expect(screen.getByText('Microsoft')).toBeInTheDocument();
    expect(
      screen.getByText('Sign in using Azure Entra ID'),
    ).toBeInTheDocument();
    // The retained guest provider card is also present (its title is "Guest").
    expect(screen.getByText('Guest')).toBeInTheDocument();

    // Rendering alone establishes no session.
    expect(onSignInSuccess).not.toHaveBeenCalled();
  });

  it('starts the Microsoft OAuth flow when the Microsoft option is selected (4.2)', async () => {
    const githubApi = makeGithubAuthApi({ onSelect: 'undefined' });
    const microsoftApi = makeGithubAuthApi({ onSelect: 'success' });
    const errorApi = new MockErrorApi({ collect: true });
    const onSignInSuccess = jest.fn();
    const user = userEvent.setup();

    await renderSignIn(githubApi, errorApi, onSignInSuccess, microsoftApi);

    // Scope the button lookup to the Microsoft provider card.
    const message = await screen.findByText('Sign in using Azure Entra ID');
    const card = message.closest('li') as HTMLElement | null;
    if (!card) {
      throw new Error('Could not locate the Microsoft provider card');
    }
    await user.click(within(card).getByRole('button'));

    // Selecting Microsoft triggers the interactive OAuth start.
    await waitFor(() => {
      expect(microsoftApi.getBackstageIdentity).toHaveBeenCalledWith(
        expect.objectContaining({ instantPopup: true }),
      );
    });
    await waitFor(() => {
      expect(onSignInSuccess).toHaveBeenCalledTimes(1);
    });
  });
});
