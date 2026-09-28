/**
 * Tests for the onboarding lookup page.
 *
 * The page is rendered through renderInTestApp with a fake OnboardingApi. The
 * key behaviour under test is that the empty state and the error state are
 * distinct — a failed lookup must never render "you have no requests".
 */

import { renderInTestApp, TestApiProvider } from '@backstage/frontend-test-utils';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { onboardingApiRef, type OnboardingApi } from '../../api/OnboardingApi';
import { LookupPage } from '../../components/LookupPage';

function makeApi(listRequests: jest.Mock): OnboardingApi {
  return { listRequests } as unknown as OnboardingApi;
}

async function renderPage(api: OnboardingApi) {
  await renderInTestApp(
    <TestApiProvider apis={[[onboardingApiRef, api]]}>
      <LookupPage />
    </TestApiProvider>,
  );
}

async function submitEmail(email: string) {
  const input = screen.getByLabelText(/email/i);
  await userEvent.clear(input);
  await userEvent.type(input, email);
  fireEvent.click(screen.getByRole('button', { name: /look ?up|search|find/i }));
}

describe('LookupPage', () => {
  it('shows the email field and no results table initially', async () => {
    await renderPage(makeApi(jest.fn()));

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('renders a row per request on success', async () => {
    const api = makeApi(
      jest.fn().mockResolvedValue([
        {
          issueKey: 'ONB-1',
          summary: '[Onboarding] acme — Acme',
          status: 'In Progress',
          created: '2026-09-22T10:00:00.000+0000',
          url: 'https://example.atlassian.net/browse/ONB-1',
        },
      ]),
    );
    await renderPage(api);

    await submitEmail('owner@example.com');

    await waitFor(() => {
      expect(screen.getByText('ONB-1')).toBeInTheDocument();
    });
    expect(screen.getByText('In Progress')).toBeInTheDocument();
  });

  it('shows the empty state when the result is an empty list', async () => {
    const api = makeApi(jest.fn().mockResolvedValue([]));
    await renderPage(api);

    await submitEmail('owner@example.com');

    await waitFor(() => {
      expect(screen.getByText('No requests found')).toBeInTheDocument();
    });
  });

  it('shows an error state — not the empty state — when the lookup fails', async () => {
    const api = makeApi(
      jest.fn().mockRejectedValue(new Error('Failed to look up onboarding requests')),
    );
    await renderPage(api);

    await submitEmail('owner@example.com');

    await waitFor(() => {
      expect(screen.getAllByText(/failed to look up/i).length).toBeGreaterThan(0);
    });
    expect(screen.queryByText('No requests found')).not.toBeInTheDocument();
  });

  it('shows a progress indicator while the lookup is pending', async () => {
    let resolve!: (value: never[]) => void;
    const api = makeApi(
      jest.fn().mockReturnValue(
        new Promise<never[]>(res => {
          resolve = res;
        }),
      ),
    );
    await renderPage(api);

    await submitEmail('owner@example.com');

    expect(await screen.findByRole('progressbar')).toBeInTheDocument();
    resolve([]);
  });
});
