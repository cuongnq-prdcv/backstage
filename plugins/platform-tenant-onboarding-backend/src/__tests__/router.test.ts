/**
 * Tests for the tenant-onboarding lookup router (`GET /requests`).
 *
 * Uses supertest against an Express app built from `createRouter` with a mocked
 * httpAuth and a fake Jira client. No network operation occurs.
 */

import { mockServices } from '@backstage/backend-test-utils';
import express from 'express';
import request from 'supertest';
import { createRouter } from '../router';
import type { JiraClient } from '../lib/jiraClient';
import { buildLookupJql } from '../lib/jql';
import { emailLabelHash } from '../lib/lookupKey';

const config = mockServices.rootConfig({
  data: {
    tenantOnboarding: {
      jira: {
        baseUrl: 'https://example.atlassian.net',
        email: 'bot@example.com',
        apiToken: 'token-123',
        projectKey: 'ONB',
        webhookSecret: 'hook-secret',
      },
    },
  },
});

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

async function makeApp(client: JiraClient) {
  const router = await createRouter({
    config,
    logger: mockServices.logger.mock(),
    httpAuth: mockServices.httpAuth(),
    clientFactory: () => client,
  });
  const app = express();
  app.use(router);
  return app;
}

describe('GET /requests', () => {
  it('returns 400 when email is missing, without calling Jira', async () => {
    const client = makeFakeClient();
    const app = await makeApp(client);

    const response = await request(app).get('/requests');

    expect(response.status).toBe(400);
    expect(client.searchIssues).not.toHaveBeenCalled();
  });

  it('returns 400 for a malformed email, without calling Jira', async () => {
    const client = makeFakeClient();
    const app = await makeApp(client);

    const response = await request(app).get('/requests').query({
      email: 'not-an-email',
    });

    expect(response.status).toBe(400);
    expect(client.searchIssues).not.toHaveBeenCalled();
  });

  it('returns the mapped requests for a valid email', async () => {
    const client = makeFakeClient();
    client.searchIssues.mockResolvedValue([
      {
        issueKey: 'ONB-1',
        summary: '[Onboarding] acme — Acme',
        status: 'To Do',
        created: '2026-09-22T10:00:00.000+0000',
        url: 'https://example.atlassian.net/browse/ONB-1',
      },
    ]);
    const app = await makeApp(client);

    const response = await request(app).get('/requests').query({
      email: 'owner@example.com',
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      {
        issueKey: 'ONB-1',
        summary: '[Onboarding] acme — Acme',
        status: 'To Do',
        created: '2026-09-22T10:00:00.000+0000',
        url: 'https://example.atlassian.net/browse/ONB-1',
      },
    ]);

    expect(client.searchIssues).toHaveBeenCalledWith(
      buildLookupJql('ONB', emailLabelHash('owner@example.com')),
      ['summary', 'status', 'created', 'labels'],
      50,
    );
  });

  it('returns 502 when Jira fails, and not an empty list', async () => {
    const client = makeFakeClient();
    client.searchIssues.mockRejectedValue(new Error('Jira unavailable'));
    const app = await makeApp(client);

    const response = await request(app).get('/requests').query({
      email: 'owner@example.com',
    });

    expect(response.status).toBe(502);
    expect(response.body).not.toEqual([]);
  });

  it('ignores caller-supplied jql, project, and maxResults', async () => {
    const client = makeFakeClient();
    client.searchIssues.mockResolvedValue([]);
    const app = await makeApp(client);

    await request(app).get('/requests').query({
      email: 'owner@example.com',
      jql: 'project = "SECRET"',
      project: 'SECRET',
      maxResults: '9999',
    });

    expect(client.searchIssues).toHaveBeenCalledWith(
      buildLookupJql('ONB', emailLabelHash('owner@example.com')),
      ['summary', 'status', 'created', 'labels'],
      50,
    );
  });
});
