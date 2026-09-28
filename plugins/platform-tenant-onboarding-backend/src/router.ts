import type {
  HttpAuthService,
  LoggerService,
  RootConfigService,
} from '@backstage/backend-plugin-api';
import express from 'express';
import Router from 'express-promise-router';
import { readTenantOnboardingConfig } from './lib/config';
import { buildLookupJql } from './lib/jql';
import { emailLabelHash } from './lib/lookupKey';
import type { JiraClientOptions } from './lib/jiraClient';
import { createJiraClient } from './lib/jiraClient';

/** Options for constructing the tenant-onboarding lookup router. */
export interface CreateRouterOptions {
  config: RootConfigService;
  logger: LoggerService;
  httpAuth: HttpAuthService;
  clientFactory?: (
    options: JiraClientOptions,
  ) => ReturnType<typeof createJiraClient>;
}

/** The fields the lookup requests from Jira, and the result cap. */
const LOOKUP_FIELDS = ['summary', 'status', 'created', 'labels'];
const LOOKUP_MAX_RESULTS = 50;

/** Minimal email shape check; the value is only ever hashed, never interpolated into JQL. */
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Creates the router exposing `GET /requests?email=` — looks up onboarding
 * requests in Jira by contact email, via a JQL query built entirely on the
 * server. Caller-supplied JQL, project, or result-count parameters are ignored.
 */
export async function createRouter({
  config,
  logger,
  httpAuth,
  clientFactory = createJiraClient,
}: CreateRouterOptions): Promise<express.Router> {
  const jiraConfig = readTenantOnboardingConfig(config);
  const client = clientFactory({ config: jiraConfig });

  const router = Router();
  router.use(express.json());

  router.get('/requests', async (req, res) => {
    // Require a Backstage user credential (guest satisfies this); unauthenticated
    // callers are rejected.
    await httpAuth.credentials(req, { allow: ['user'] });

    const email = req.query.email;
    if (typeof email !== 'string' || !EMAIL_PATTERN.test(email)) {
      res.status(400).json({ error: 'A valid "email" query parameter is required' });
      return;
    }

    const jql = buildLookupJql(jiraConfig.projectKey, emailLabelHash(email));

    try {
      const requests = await client.searchIssues(
        jql,
        LOOKUP_FIELDS,
        LOOKUP_MAX_RESULTS,
      );
      res.json(requests);
    } catch (error) {
      logger.warn(
        `Onboarding request lookup failed: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
      res.status(502).json({
        error: 'Unable to reach Jira to look up requests; try again later',
      });
    }
  });

  return router;
}
