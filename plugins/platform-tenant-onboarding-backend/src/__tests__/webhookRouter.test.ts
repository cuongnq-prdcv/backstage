/**
 * Tests for the completion webhook router.
 *
 * The router is exercised offline: both the Jira client and the mailer are
 * injected as fakes (Requirement 6.3). Covers secret rejection, payload
 * validation, the not-done skip, the missing-email 422, the happy-path send,
 * and the two 502 failure modes. No real SMTP or Jira call occurs.
 */

import express from 'express';
import request from 'supertest';
import { mockServices } from '@backstage/backend-test-utils';
import { createWebhookRouter } from '../webhookRouter';
import type { JiraClient } from '../lib/jiraClient';
import type { Mailer } from '../lib/mailer';
import { buildIssuePayload } from '../lib/fieldMapping';

const config = mockServices.rootConfig({
  data: {
    tenantOnboarding: {
      jira: {
        baseUrl: 'https://example.atlassian.net',
        email: 'bot@example.com',
        apiToken: 'token-123',
        projectKey: 'ONB',
        webhookSecret: 'hook-secret',
        doneStatus: 'Done',
      },
      smtp: {
        host: 'sandbox.smtp.mailtrap.io',
        port: '2525',
        user: 'smtp-user',
        password: 'smtp-pass',
        from: 'Onboarding <no-reply@example.com>',
      },
    },
  },
});

const jiraConfig = {
  baseUrl: 'https://example.atlassian.net',
  email: 'bot@example.com',
  apiToken: 'token-123',
  projectKey: 'ONB',
  issueType: 'Task',
  webhookSecret: 'hook-secret',
  doneStatus: 'Done',
};

const submission = {
  tenantName: 'tenant-a',
  contactEmail: 'owner@example.com',
  contactName: 'Acme Owner',
  organization: 'Acme',
  environment: 'prod' as const,
  location: 'japaneast',
  purpose: 'because',
};

/** A Done issue whose description carries the full submission. */
function doneIssue() {
  return {
    status: 'Done',
    description: buildIssuePayload(submission, jiraConfig).fields.description,
  };
}

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

function makeFakeMailer(): { mailer: Mailer; sendCompletion: jest.Mock } {
  const sendCompletion = jest.fn().mockResolvedValue(undefined);
  return { mailer: { sendCompletion }, sendCompletion };
}

async function makeApp(overrides: {
  client?: JiraClient;
  mailer?: Mailer;
} = {}) {
  const client = overrides.client ?? makeFakeClient();
  const { mailer, sendCompletion } =
    overrides.mailer
      ? { mailer: overrides.mailer, sendCompletion: jest.fn() }
      : makeFakeMailer();

  const router = await createWebhookRouter({
    config,
    logger: mockServices.logger.mock(),
    clientFactory: () => client,
    mailerFactory: () => mailer,
  });
  const app = express();
  app.use(router);
  return { app, client, sendCompletion };
}

describe('completion webhook router', () => {
  it('rejects a request with no X-Onboarding-Token with 401', async () => {
    const { app } = await makeApp();

    const res = await request(app)
      .post('/jira-webhook')
      .send({ issue: { key: 'ONB-1' } });

    expect(res.status).toBe(401);
  });

  it('rejects a request with a wrong secret with 401', async () => {
    const { app, client } = await makeApp();

    const res = await request(app)
      .post('/jira-webhook')
      .set('X-Onboarding-Token', 'wrong-secret')
      .send({ issue: { key: 'ONB-1' } });

    expect(res.status).toBe(401);
    expect((client as FakeClient).getIssue).not.toHaveBeenCalled();
  });

  it('does not crash when the secret has a different length (still 401)', async () => {
    const { app } = await makeApp();

    const res = await request(app)
      .post('/jira-webhook')
      .set('X-Onboarding-Token', 'x')
      .send({ issue: { key: 'ONB-1' } });

    expect(res.status).toBe(401);
  });

  it('rejects a body without a string issue.key with 400', async () => {
    const { app } = await makeApp();

    const res = await request(app)
      .post('/jira-webhook')
      .set('X-Onboarding-Token', 'hook-secret')
      .send({ issue: {} });

    expect(res.status).toBe(400);
  });

  it('skips (200) and sends no email when the issue is not Done', async () => {
    const client = makeFakeClient();
    client.getIssue.mockResolvedValue({ status: 'To Do', description: {} });
    const { app, sendCompletion } = await makeApp({ client });

    const res = await request(app)
      .post('/jira-webhook')
      .set('X-Onboarding-Token', 'hook-secret')
      .send({ issue: { key: 'ONB-1' } });

    expect(res.status).toBe(200);
    expect(res.body.skipped).toBe('not-done');
    expect(sendCompletion).not.toHaveBeenCalled();
  });

  it('returns 422 and sends no email when the description has no contact email', async () => {
    const client = makeFakeClient();
    client.getIssue.mockResolvedValue({
      status: 'Done',
      description: { type: 'doc', version: 1, content: [] },
    });
    const { app, sendCompletion } = await makeApp({ client });

    const res = await request(app)
      .post('/jira-webhook')
      .set('X-Onboarding-Token', 'hook-secret')
      .send({ issue: { key: 'ONB-1' } });

    expect(res.status).toBe(422);
    expect(sendCompletion).not.toHaveBeenCalled();
  });

  it('sends the completion email and returns 200 when the issue is Done', async () => {
    const client = makeFakeClient();
    client.getIssue.mockResolvedValue(doneIssue());
    const { mailer, sendCompletion } = makeFakeMailer();

    const router = await createWebhookRouter({
      config,
      logger: mockServices.logger.mock(),
      clientFactory: () => client,
      mailerFactory: () => mailer,
    });
    const app = express();
    app.use(router);

    const res = await request(app)
      .post('/jira-webhook')
      .set('X-Onboarding-Token', 'hook-secret')
      .send({ issue: { key: 'ONB-1' } });

    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(true);
    expect(res.body.issueKey).toBe('ONB-1');
    expect(sendCompletion).toHaveBeenCalledTimes(1);
    const [to, content] = sendCompletion.mock.calls[0];
    expect(to).toBe('owner@example.com');
    expect(content.subject).toContain('tenant-a');
    // The Jira issue URL is derived from baseUrl + key.
    expect(content.text).toContain(
      'https://example.atlassian.net/browse/ONB-1',
    );
  });

  it('returns 502 when the Jira fetch fails', async () => {
    const client = makeFakeClient();
    client.getIssue.mockRejectedValue(new Error('jira down'));
    const { app, sendCompletion } = await makeApp({ client });

    const res = await request(app)
      .post('/jira-webhook')
      .set('X-Onboarding-Token', 'hook-secret')
      .send({ issue: { key: 'ONB-1' } });

    expect(res.status).toBe(502);
    expect(sendCompletion).not.toHaveBeenCalled();
  });

  it('returns 502 when sending the email fails', async () => {
    const client = makeFakeClient();
    client.getIssue.mockResolvedValue(doneIssue());
    const failingMailer: Mailer = {
      sendCompletion: jest.fn().mockRejectedValue(new Error('smtp down')),
    };
    const { app } = await makeApp({ client, mailer: failingMailer });

    const res = await request(app)
      .post('/jira-webhook')
      .set('X-Onboarding-Token', 'hook-secret')
      .send({ issue: { key: 'ONB-1' } });

    expect(res.status).toBe(502);
  });
});
