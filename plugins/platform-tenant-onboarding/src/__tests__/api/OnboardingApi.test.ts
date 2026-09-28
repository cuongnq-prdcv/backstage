/**
 * Tests for the onboarding lookup API client.
 *
 * Uses stub discovery and fetch APIs; no real network request occurs.
 */

import { DefaultOnboardingApi } from '../../api/OnboardingApi';

function makeApi(fetchImpl: jest.Mock) {
  const discoveryApi = {
    getBaseUrl: jest
      .fn()
      .mockResolvedValue('http://localhost:7007/api/platform-tenant-onboarding'),
  };
  const fetchApi = { fetch: fetchImpl };
  return new DefaultOnboardingApi({
    discoveryApi: discoveryApi as any,
    fetchApi: fetchApi as any,
  });
}

describe('DefaultOnboardingApi', () => {
  it('requests the lookup endpoint with the URL-encoded email and returns the parsed list', async () => {
    const rows = [
      {
        issueKey: 'ONB-1',
        summary: '[Onboarding] acme — Acme',
        status: 'To Do',
        created: '2026-09-22T10:00:00.000+0000',
        url: 'https://example.atlassian.net/browse/ONB-1',
      },
    ];
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(rows),
    });
    const api = makeApi(fetchImpl);

    await expect(api.listRequests('a@b.com')).resolves.toEqual(rows);

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:7007/api/platform-tenant-onboarding/requests?email=a%40b.com',
    );
  });

  it('rejects with a lookup-failed error on a non-ok response', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: jest.fn().mockResolvedValue({ error: 'bad gateway' }),
    });
    const api = makeApi(fetchImpl);

    await expect(api.listRequests('a@b.com')).rejects.toThrow(/look ?up/i);
  });
});
