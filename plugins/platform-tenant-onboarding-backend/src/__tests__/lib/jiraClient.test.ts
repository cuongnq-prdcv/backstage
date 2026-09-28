/**
 * Offline tests for the Jira Cloud REST client.
 *
 * The client receives an injected fetch implementation in every test. No test
 * can reach the network or depend on a Jira trial account.
 */

import type { JiraIssuePayload } from '../../lib/fieldMapping';
import {
  createJiraClient,
  type JiraClientOptions,
} from '../../lib/jiraClient';

const config = {
  baseUrl: 'https://example.atlassian.net',
  email: 'bot@example.com',
  apiToken: 'token-123',
  projectKey: 'ONB',
  issueType: 'Task',
  webhookSecret: 'hook-secret',
  doneStatus: 'Done',
};

const payload: JiraIssuePayload = {
  fields: {
    project: { key: 'ONB' },
    issuetype: { name: 'Task' },
    summary: '[Onboarding] acme — Acme',
    description: { type: 'doc', version: 1, content: [] },
    labels: ['tenant-onboarding', 'onb-0123456789abcdef', 'onb-tenant-acme'],
  },
};

function makeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
  } as unknown as Response;
}

function mockFetch(): jest.MockedFunction<typeof fetch> {
  return jest.fn() as jest.MockedFunction<typeof fetch>;
}

function makeClient(
  fetchImpl: jest.MockedFunction<typeof fetch>,
  overrides: Partial<JiraClientOptions> = {},
) {
  return createJiraClient({ config, fetchImpl, ...overrides });
}

describe('JiraClient.createIssue', () => {
  it('POSTs to the Jira v3 issue endpoint with JSON and Basic auth', async () => {
    const fetchImpl = mockFetch()
      .mockResolvedValue(makeResponse(201, { id: '10001', key: 'ONB-1' }));
    const client = makeClient(fetchImpl);

    await expect(client.createIssue(payload)).resolves.toEqual({
      id: '10001',
      key: 'ONB-1',
      url: 'https://example.atlassian.net/browse/ONB-1',
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://example.atlassian.net/rest/api/3/issue');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({
      Authorization: `Basic ${Buffer.from('bot@example.com:token-123').toString('base64')}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    });
    expect(JSON.parse(String(init?.body))).toEqual(payload);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('JiraClient.searchIssues', () => {
  it('POSTs to /rest/api/3/search/jql and maps issue summaries', async () => {
    const fetchImpl = mockFetch().mockResolvedValue(
      makeResponse(200, {
        issues: [
          {
            id: '10001',
            key: 'ONB-1',
            fields: {
              summary: '[Onboarding] acme — Acme',
              status: { name: 'In Progress' },
              created: '2026-09-22T10:00:00.000+0000',
            },
          },
        ],
      }),
    );
    const client = makeClient(fetchImpl);

    await expect(
      client.searchIssues(
        'project = "ONB" ORDER BY created DESC',
        ['summary', 'status', 'created', 'labels'],
        50,
      ),
    ).resolves.toEqual([
      {
        issueKey: 'ONB-1',
        summary: '[Onboarding] acme — Acme',
        status: 'In Progress',
        created: '2026-09-22T10:00:00.000+0000',
        url: 'https://example.atlassian.net/browse/ONB-1',
      },
    ]);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://example.atlassian.net/rest/api/3/search/jql');
    expect(url).not.toContain('/rest/api/3/search?');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      jql: 'project = "ONB" ORDER BY created DESC',
      fields: ['summary', 'status', 'created', 'labels'],
      maxResults: 50,
    });
  });
});

describe('JiraClient.getIssue', () => {
  it('GETs /rest/api/3/issue/{key} with the fields query and Basic auth', async () => {
    const description = {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Tenant name: acme' }],
        },
      ],
    };
    const fetchImpl = mockFetch().mockResolvedValue(
      makeResponse(200, {
        key: 'ONB-1',
        fields: { status: { name: 'Done' }, description },
      }),
    );
    const client = makeClient(fetchImpl);

    await expect(
      client.getIssue('ONB-1', ['status', 'description']),
    ).resolves.toEqual({ status: 'Done', description });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      'https://example.atlassian.net/rest/api/3/issue/ONB-1?fields=status%2Cdescription',
    );
    expect(init?.method).toBe('GET');
    expect(init?.headers).toEqual({
      Authorization: `Basic ${Buffer.from('bot@example.com:token-123').toString('base64')}`,
      Accept: 'application/json',
    });
    expect(init?.body).toBeUndefined();
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('returns an empty status when the field is absent', async () => {
    const fetchImpl = mockFetch().mockResolvedValue(
      makeResponse(200, { key: 'ONB-1', fields: {} }),
    );
    const client = makeClient(fetchImpl);

    await expect(client.getIssue('ONB-1', ['status'])).resolves.toEqual({
      status: '',
      description: undefined,
    });
  });

  it('maps HTTP 404 to a project-or-endpoint error', async () => {
    const fetchImpl = mockFetch().mockResolvedValue(
      makeResponse(404, { message: 'not found' }),
    );
    const client = makeClient(fetchImpl);

    await expect(
      client.getIssue('ONB-404', ['status', 'description']),
    ).rejects.toThrow(/project|endpoint/i);
  });

  it('maps an aborted request to a timeout error', async () => {
    const aborted = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const fetchImpl = mockFetch().mockRejectedValue(aborted);
    const client = makeClient(fetchImpl, { timeoutMs: 10 });

    await expect(
      client.getIssue('ONB-1', ['status']),
    ).rejects.toThrow(/timed out|timeout/i);
  });
});

describe('JiraClient error handling', () => {
  it.each([401, 403])(
    'maps HTTP %i to a credential error without leaking secrets',
    async status => {
      const fetchImpl = mockFetch().mockResolvedValue(
        makeResponse(status, {
          errorMessages: ['token-123 for bot@example.com is invalid'],
        }),
      );
      const client = makeClient(fetchImpl);

      const error = await client.createIssue(payload).catch(caught => caught);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/credential|authorization/i);
      expect((error as Error).message).not.toContain('token-123');
      expect((error as Error).message).not.toContain('bot@example.com');
      expect((error as Error).message).not.toContain('Basic ');
    },
  );

  it('maps HTTP 400 and exposes only offending field names', async () => {
    const fetchImpl = mockFetch().mockResolvedValue(
      makeResponse(400, {
        errors: {
          issuetype: 'Issue type is not valid for this project',
        },
        errorMessages: ['token-123 for bot@example.com is invalid'],
      }),
    );
    const client = makeClient(fetchImpl);

    const error = await client.createIssue(payload).catch(caught => caught);
    expect((error as Error).message).toContain('issuetype');
    expect((error as Error).message).not.toContain('token-123');
    expect((error as Error).message).not.toContain('bot@example.com');
    expect((error as Error).message).not.toContain('Basic ');
  });

  it('maps HTTP 404 to a project-or-endpoint error', async () => {
    const fetchImpl = mockFetch()
      .mockResolvedValue(makeResponse(404, { message: 'not found' }));
    const client = makeClient(fetchImpl);

    await expect(client.createIssue(payload)).rejects.toThrow(
      /project|endpoint/i,
    );
  });

  it('maps HTTP 429 without retrying', async () => {
    const fetchImpl = mockFetch()
      .mockResolvedValue(makeResponse(429, { message: 'slow down' }));
    const client = makeClient(fetchImpl);

    await expect(client.createIssue(payload)).rejects.toThrow(/rate limit/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('maps HTTP 500 to a temporary failure', async () => {
    const fetchImpl = mockFetch()
      .mockResolvedValue(makeResponse(500, { message: 'internal error' }));
    const client = makeClient(fetchImpl);

    await expect(client.createIssue(payload)).rejects.toThrow(/temporary/i);
  });

  it('maps an aborted request to a timeout error', async () => {
    const aborted = Object.assign(new Error('aborted'), {
      name: 'AbortError',
    });
    const fetchImpl = mockFetch().mockRejectedValue(aborted);
    const client = makeClient(fetchImpl, { timeoutMs: 10 });

    await expect(client.createIssue(payload)).rejects.toThrow(/timed out|timeout/i);
  });
});
