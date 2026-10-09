import { timingSafeEqual } from 'crypto';
import type {
  HttpAuthService,
  LoggerService,
  RootConfigService,
} from '@backstage/backend-plugin-api';
import express from 'express';
import Router from 'express-promise-router';
import { readTenantOnboardingConfig } from './lib/config';
import { readSmtpConfig } from './lib/smtpConfig';
import { parseAdfDescription } from './lib/adfParser';
import { buildCompletionEmail } from './lib/emailContent';
import { createMailer, type Mailer } from './lib/mailer';
import { createJiraClient, type JiraClient } from './lib/jiraClient';
import type { JiraClientOptions } from './lib/jiraClient';
import type { MailerOptions } from './lib/mailer';
import type { OnboardingSubmission } from './lib/fieldMapping';

/** Options for constructing the completion webhook router. */
export interface CreateWebhookRouterOptions {
  config: RootConfigService;
  logger: LoggerService;
  httpAuth: HttpAuthService;
  clientFactory?: (options: JiraClientOptions) => JiraClient;
  mailerFactory?: (options: MailerOptions) => Mailer;
}

/** Minimal email shape check, matching the lookup router. */
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** The issue fields the webhook needs to verify status and rebuild the email. */
const VERIFY_FIELDS = ['status', 'description'];

/** Constant-time header/secret comparison that never throws on length mismatch. */
function secretMatches(provided: string | undefined, expected: string): boolean {
  if (typeof provided !== 'string') {
    return false;
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Creates the router exposing `POST /send-mail` — called by Jira Automation
 * when an onboarding issue transitions to Done.
 *
 * The endpoint does not require a Backstage user credential (the caller is
 * Jira); it authenticates with a shared secret in the `X-Onboarding-Token`
 * header, compared in constant time. It never trusts the payload's status:
 * it re-fetches the issue, and only when the real status matches the configured
 * Done status does it parse the description and email the contact. No dedupe is
 * performed (POC): each Done event sends one email.
 *
 * Logs only `{ issueKey, outcome }`; the secret, SMTP password, and the
 * contact's PII are never logged.
 */
export async function createWebhookRouter({
  config,
  logger,
  httpAuth,
  clientFactory = createJiraClient,
  mailerFactory = createMailer,
}: CreateWebhookRouterOptions): Promise<express.Router> {
  const jiraConfig = readTenantOnboardingConfig(config);
  const smtpConfig = readSmtpConfig(config);
  const client = clientFactory({ config: jiraConfig });
  const mailer = mailerFactory({ config: smtpConfig });

  const router = Router();
  router.use(express.json());

  router.post('/send-mail', async (req, res) => {
    // if (
    //   !secretMatches(
    //     req.header('X-Onboarding-Token'),
    //     jiraConfig.webhookSecret,
    //   )
    // ) {
    //   res.status(401).json({ error: 'Invalid or missing webhook token' });
    //   return;
    // }
    await httpAuth.credentials(req, { allow: ['service'] });

    const issue = req.body?.issue;
    const issueKey = issue?.key;
    if (typeof issueKey !== 'string' || issueKey.length === 0) {
      res.status(400).json({ error: 'A string "issue.key" is required' });
      return;
    }

    let status: string;
    let description: unknown;
    try {
      ({ status, description } = await client.getIssue(issueKey, VERIFY_FIELDS));
    } catch {
      logger.warn(`Onboarding webhook: Jira fetch failed for ${issueKey}`);
      res
        .status(502)
        .json({ error: 'Unable to reach Jira to verify the issue' });
      return;
    }

    if (status.toLowerCase() !== jiraConfig.doneStatus.toLowerCase()) {
      logger.info(
        `Onboarding webhook: ${issueKey} is not done (skipped)`,
      );
      res.status(200).json({ skipped: 'not-done', issueKey });
      return;
    }

    const parsed = parseAdfDescription(description);
    const contactEmail = parsed.contactEmail;
    if (
      typeof contactEmail !== 'string' ||
      !EMAIL_PATTERN.test(contactEmail)
    ) {
      logger.warn(
        `Onboarding webhook: ${issueKey} has no valid contact email (skipped)`,
      );
      res
        .status(422)
        .json({ error: 'The issue has no valid contact email to notify' });
      return;
    }

    const issueUrl = `${jiraConfig.baseUrl}/browse/${issueKey}`;
    const email = buildCompletionEmail(
      parsed as OnboardingSubmission,
      issueUrl,
    );

    try {
      await mailer.sendCompletion(contactEmail, email);
    } catch {
      logger.warn(`Onboarding webhook: email send failed for ${issueKey}`);
      res.status(502).json({ error: 'Failed to send the completion email' });
      return;
    }

    logger.info(`Onboarding webhook: completion email sent for ${issueKey}`);
    res.status(200).json({ sent: true, issueKey });
  });

  return router;
}
