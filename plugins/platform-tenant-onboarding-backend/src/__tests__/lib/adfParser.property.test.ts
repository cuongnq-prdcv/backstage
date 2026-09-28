/**
 * Property + unit tests for `parseAdfDescription`.
 *
 * The parser is the inverse of `buildAdfDescription` (via `buildIssuePayload`):
 * parsing the description an onboarding issue was built with must reproduce the
 * original seven values (Requirement 3.2). Malformed or empty descriptions must
 * yield a partial result and never throw (Requirement 3.1). No network is used.
 */

import fc from 'fast-check';
import type { OnboardingSubmission } from '../../lib/fieldMapping';
import { buildIssuePayload } from '../../lib/fieldMapping';
import { parseAdfDescription } from '../../lib/adfParser';
import type { JiraConfig } from '../../lib/config';

const config: JiraConfig = {
  baseUrl: 'https://example.atlassian.net',
  email: 'bot@example.com',
  apiToken: 'token-123',
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

describe('parseAdfDescription', () => {
  // Property: parsing the description an issue was built with reproduces the
  // original seven values. Validates Requirement 3.2.
  it('round-trips every valid submission built by buildIssuePayload (Property)', () => {
    fc.assert(
      fc.property(submissionArb, submission => {
        const description = buildIssuePayload(submission, config).fields
          .description;

        expect(parseAdfDescription(description)).toEqual(submission);
      }),
      { numRuns: 200 },
    );
  });

  it('returns an empty object for a non-object description', () => {
    expect(parseAdfDescription(undefined)).toEqual({});
    expect(parseAdfDescription(null)).toEqual({});
    expect(parseAdfDescription('not adf')).toEqual({});
    expect(parseAdfDescription(42)).toEqual({});
  });

  it('returns an empty object for a doc with no content', () => {
    expect(parseAdfDescription({ type: 'doc', version: 1 })).toEqual({});
    expect(
      parseAdfDescription({ type: 'doc', version: 1, content: [] }),
    ).toEqual({});
  });

  it('parses only the recognised labels and ignores foreign paragraphs', () => {
    const description = {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Tenant name: acme' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Some unrelated note' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Contact email: a@b.co' }],
        },
      ],
    };

    expect(parseAdfDescription(description)).toEqual({
      tenantName: 'acme',
      contactEmail: 'a@b.co',
    });
  });

  it('keeps a value that itself contains ": "', () => {
    const description = {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Purpose: reason: with colon' }],
        },
      ],
    };

    expect(parseAdfDescription(description)).toEqual({
      purpose: 'reason: with colon',
    });
  });
});
