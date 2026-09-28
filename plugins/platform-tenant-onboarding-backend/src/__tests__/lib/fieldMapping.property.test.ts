/**
 * Property and unit tests for mapping an onboarding submission to the Jira
 * issue payload.
 *
 * The mapping is pure: these tests perform no Jira or network operation.
 */

import fc from 'fast-check';
import {
  buildIssuePayload,
  type AdfDocument,
  type OnboardingSubmission,
} from '../../lib/fieldMapping';
import { emailLabelHash, MARKER_LABEL, tenantLabel } from '../../lib/lookupKey';

const config = {
  baseUrl: 'https://example.atlassian.net',
  email: 'bot@example.com',
  apiToken: 'secret-token',
  projectKey: 'ONB',
  issueType: 'Task',
  webhookSecret: 'hook-secret',
  doneStatus: 'Done',
};

const tenantNameArb = fc
  .tuple(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
    fc
      .array(
        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')),
        { minLength: 1, maxLength: 20 },
      )
      .map(chars => chars.join('')),
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
  )
  .map(([first, mid, last]) => `${first}${mid}${last}`);

const submissionArb: fc.Arbitrary<OnboardingSubmission> = fc.record({
  tenantName: tenantNameArb,
  contactEmail: fc.emailAddress(),
  contactName: fc.string(),
  organization: fc.string(),
  environment: fc.constantFrom('dev', 'staging', 'prod'),
  location: fc.constantFrom('japaneast', 'japanwest', 'southeastasia'),
  purpose: fc.string(),
});

function flattenAdf(description: AdfDocument): string {
  return description.content
    .flatMap(node => {
      const content = node.content;
      return Array.isArray(content)
        ? content.filter(
            (child): child is { type: 'text'; text: string } =>
              typeof child === 'object' &&
              child !== null &&
              child.type === 'text' &&
              typeof child.text === 'string',
          )
        : [];
    })
    .map(node => node.text)
    .join('\n');
}

describe('buildIssuePayload', () => {
  // Feature: tenant-onboarding-jira, Property: every valid submission maps to
  // a well-formed ADF description containing all seven fields
  // Validates: Requirements 1.8, 2.3, 9.3
  it('maps every valid submission to ADF containing all seven values (Property)', () => {
    fc.assert(
      fc.property(submissionArb, submission => {
        const payload = buildIssuePayload(submission, config);
        const description = payload.fields.description;
        const flattened = flattenAdf(description);

        expect(description).toEqual(
          expect.objectContaining({ type: 'doc', version: 1 }),
        );
        expect(description.content.length).toBe(7);
        expect(description.content.every(node => typeof node.type === 'string')).toBe(
          true,
        );

        for (const value of Object.values(submission)) {
          expect(flattened).toContain(value);
        }
      }),
      { numRuns: 200 },
    );
  });

  // Feature: tenant-onboarding-jira, Property: labels are stable and contain
  // exactly the marker, email lookup key, and tenant duplicate key
  // Validates: Requirements 2.4, 9.3
  it('emits exactly the three expected labels in stable order (Property)', () => {
    fc.assert(
      fc.property(submissionArb, submission => {
        const payload = buildIssuePayload(submission, config);

        expect(payload.fields.labels).toEqual([
          MARKER_LABEL,
          emailLabelHash(submission.contactEmail),
          tenantLabel(submission.tenantName),
        ]);
      }),
      { numRuns: 200 },
    );
  });

  it('builds the expected summary and Jira project fields', () => {
    const submission: OnboardingSubmission = {
      tenantName: 'acme',
      contactEmail: 'owner@example.com',
      contactName: 'Acme Owner',
      organization: 'Acme Corporation',
      environment: 'dev',
      location: 'japaneast',
      purpose: 'Initial platform onboarding',
    };

    const payload = buildIssuePayload(submission, {
      ...config,
      projectKey: 'TENANT',
      issueType: 'Story',
    });

    expect(payload.fields.summary).toBe(
      '[Onboarding] acme — Acme Corporation',
    );
    expect(payload.fields.project.key).toBe('TENANT');
    expect(payload.fields.issuetype.name).toBe('Story');
  });

  it('creates paragraph text nodes for each labeled field', () => {
    const submission: OnboardingSubmission = {
      tenantName: 'acme',
      contactEmail: 'owner@example.com',
      contactName: 'Acme Owner',
      organization: 'Acme Corporation',
      environment: 'prod',
      location: 'southeastasia',
      purpose: 'Production workload',
    };

    const description = buildIssuePayload(submission, config).fields.description;

    expect(description).toEqual({
      type: 'doc',
      version: 1,
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Tenant name: acme' }] },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Contact email: owner@example.com' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Contact name: Acme Owner' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Organization: Acme Corporation' }],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'Environment: prod' }] },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Location: southeastasia' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Purpose: Production workload' }],
        },
      ],
    });
  });
});
