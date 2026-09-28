import {
  createApiRef,
  type DiscoveryApi,
  type FetchApi,
} from '@backstage/core-plugin-api';

/** One onboarding request, as returned by the lookup endpoint. */
export interface OnboardingRequestSummary {
  issueKey: string;
  summary: string;
  status: string;
  created: string;
  url: string;
}

/** Client for the tenant-onboarding request-lookup endpoint. */
export interface OnboardingApi {
  listRequests(email: string): Promise<OnboardingRequestSummary[]>;
}

/** API ref other extensions resolve to reach {@link OnboardingApi}. */
export const onboardingApiRef = createApiRef<OnboardingApi>({
  id: 'plugin.tenant-onboarding.service',
});

/**
 * Default {@link OnboardingApi} backed by the backend plugin at
 * `/api/platform-tenant-onboarding`. The email is URL-encoded; the backend
 * builds the JQL, so the client never sends a query expression.
 */
export class DefaultOnboardingApi implements OnboardingApi {
  private readonly discoveryApi: DiscoveryApi;
  private readonly fetchApi: FetchApi;

  constructor(options: { discoveryApi: DiscoveryApi; fetchApi: FetchApi }) {
    this.discoveryApi = options.discoveryApi;
    this.fetchApi = options.fetchApi;
  }

  async listRequests(email: string): Promise<OnboardingRequestSummary[]> {
    const baseUrl = await this.discoveryApi.getBaseUrl(
      'platform-tenant-onboarding',
    );
    const url = `${baseUrl}/requests?email=${encodeURIComponent(email)}`;

    const response = await this.fetchApi.fetch(url);
    if (!response.ok) {
      throw new Error(
        `Failed to look up onboarding requests (HTTP ${response.status})`,
      );
    }

    return (await response.json()) as OnboardingRequestSummary[];
  }
}
