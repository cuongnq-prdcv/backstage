/**
 * Tests for the `onboarding:create-jira-issue` action.
 *
 * The action is exercised with a fake Jira client and a hand-built action
 * context (the same pattern as the provisioning plugin's action tests). No
 * network operation occurs.
 */

import { mockServices } from '@backstage/backend-test-utils';
import { createJiraIssueAction } from '../../actions/createJiraIssue';
import type { JiraClient } from '../../lib/jiraClient';
import { emailLabelHash, MARKER_LABEL, tenantLabel } from '../../lib/lookupKey';

const config = mockServices.rootConfig({
  data: {
    tenantOnboarding: {
      jira: {
        baseUrl: 'https://example.atlassian.net',
        email: 'bot@example.com',
        apiToken: 'token-123',
        projectKey: 'ONB',
        issueType: 'Task',
        webhookSecret: 'hook-secret',
      },
    },
  },
});

const validInput = {
  tenantName: 'acme',
  contactEmail: 'owner@example.com',
  contactName: 'Acme Owner',
  organization: 'Acme Corporation',
  environment: 'dev' as const,
  location: 'japaneast',
  purpose: 'Initial onboarding',
};

interface FakeClient extends JiraClient {
  createIssue: jest.MockedFunction<JiraClient['createIssue']>;
  searchIssues: jest.MockedFunction<JiraClient['searchIssues']>;
  getIssue: jest.MockedFunction<JiraClient['getIssue']>;
}

function makeFakeClient(): FakeClient {
  return {
    createIssue: jest.fn(),
    searchIssues: jest.fn(),
    getIssue: jest.fn(),
  } as FakeClient;
}

function makeContext(input: Record<string, unknown>) {
  const outputs: Record<string, unknown> = {};
  const logger = mockServices.logger.mock();
  return {
    ctx: {
      input,
      output: jest.fn((key: string, value: unknown) => {
        outputs[key] = value;
      }),
      logger,
    } as any,
    outputs,
    logger,
  };
}

function makeAction(client: JiraClient) {
  return createJiraIssueAction({
    config,
    logger: mockServices.logger.mock(),
    clientFactory: () => client,
  });
}

describe('onboarding:create-jira-issue', () => {
  beforeEach(() => jest.clearAllMocks());

  it('has the expected action id', () => {
    expect(makeAction(makeFakeClient()).id).toBe(
      'onboarding:create-jira-issue',
    );
  });

  it('creates a new issue when no duplicate exists', async () => {
    const client = makeFakeClient();
    client.searchIssues.mockResolvedValue([]);
    client.createIssue.mockResolvedValue({
      id: '10001',
      key: 'ONB-1',
      url: 'https://example.atlassian.net/browse/ONB-1',
    });

    const { ctx, outputs } = makeContext(validInput);
    await makeAction(client).handler(ctx);

    expect(client.createIssue).toHaveBeenCalledTimes(1);
    expect(outputs).toEqual({
      issueKey: 'ONB-1',
      issueUrl: 'https://example.atlassian.net/browse/ONB-1',
      issueId: '10001',
      reusedExisting: false,
    });

    // The duplicate check queried by the three exact labels.
    const jql = client.searchIssues.mock.calls[0][0];
    expect(jql).toContain(`labels = "${MARKER_LABEL}"`);
    expect(jql).toContain(`labels = "${emailLabelHash(validInput.contactEmail)}"`);
    expect(jql).toContain(`labels = "${tenantLabel(validInput.tenantName)}"`);
  });

  it('reuses an existing unresolved issue instead of creating a duplicate', async () => {
    const client = makeFakeClient();
    client.searchIssues.mockResolvedValue([
      {
        issueKey: 'ONB-7',
        summary: '[Onboarding] acme — Acme Corporation',
        status: 'To Do',
        created: '2026-09-20T00:00:00.000+0000',
        url: 'https://example.atlassian.net/browse/ONB-7',
      },
    ]);

    const { ctx, outputs } = makeContext(validInput);
    await makeAction(client).handler(ctx);

    expect(client.createIssue).not.toHaveBeenCalled();
    expect(outputs).toEqual({
      issueKey: 'ONB-7',
      issueUrl: 'https://example.atlassian.net/browse/ONB-7',
      issueId: '',
      reusedExisting: true,
    });
  });

  it('fails open: still creates the issue when the duplicate check errors', async () => {
    const client = makeFakeClient();
    client.searchIssues.mockRejectedValue(new Error('search unavailable'));
    client.createIssue.mockResolvedValue({
      id: '10002',
      key: 'ONB-2',
      url: 'https://example.atlassian.net/browse/ONB-2',
    });

    const { ctx, outputs, logger } = makeContext(validInput);
    await makeAction(client).handler(ctx);

    expect(client.createIssue).toHaveBeenCalledTimes(1);
    expect(outputs.issueKey).toBe('ONB-2');
    expect(outputs.reusedExisting).toBe(false);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('rejects invalid input before any Jira call', async () => {
    const client = makeFakeClient();
    const { ctx } = makeContext({ ...validInput, tenantName: 'A' });

    await expect(makeAction(client).handler(ctx)).rejects.toThrow(
      /tenantName/,
    );
    expect(client.searchIssues).not.toHaveBeenCalled();
    expect(client.createIssue).not.toHaveBeenCalled();
  });

  it('never logs contactEmail, contactName, or purpose', async () => {
    const client = makeFakeClient();
    client.searchIssues.mockResolvedValue([]);
    client.createIssue.mockResolvedValue({
      id: '10003',
      key: 'ONB-3',
      url: 'https://example.atlassian.net/browse/ONB-3',
    });

    const { ctx, logger } = makeContext(validInput);
    await makeAction(client).handler(ctx);

    const logged = [
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls,
      ...logger.debug.mock.calls,
      ...logger.error.mock.calls,
    ]
      .flat()
      .map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
      .join('\n');

    expect(logged).not.toContain(validInput.contactEmail);
    expect(logged).not.toContain(validInput.contactName);
    expect(logged).not.toContain(validInput.purpose);
  });
});
