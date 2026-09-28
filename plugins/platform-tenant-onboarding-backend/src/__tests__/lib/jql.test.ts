/**
 * Tests for the JQL builders (`buildLookupJql`, `buildDuplicateCheckJql`).
 *
 * See the tenant-onboarding-jira design ("Components and Interfaces" →
 * `lib/jql.ts`) and plan Task 3.
 */

import fc from 'fast-check';
import { buildDuplicateCheckJql, buildLookupJql } from '../../lib/jql';
import { emailLabelHash, tenantLabel } from '../../lib/lookupKey';

describe('buildLookupJql', () => {
  it('matches the exact expected JQL', () => {
    expect(buildLookupJql('ONB', 'onb-0123456789abcdef')).toBe(
      'project = "ONB" AND labels = "tenant-onboarding" AND labels = "onb-0123456789abcdef" ORDER BY created DESC',
    );
  });
});

describe('buildDuplicateCheckJql', () => {
  it('matches the exact expected JQL and contains no summary ~ clause', () => {
    const jql = buildDuplicateCheckJql(
      'ONB',
      'onb-0123456789abcdef',
      'onb-tenant-acme',
    );

    expect(jql).toBe(
      'project = "ONB" AND labels = "tenant-onboarding" AND labels = "onb-0123456789abcdef" AND labels = "onb-tenant-acme" AND resolution = Unresolved',
    );
    expect(jql).not.toMatch(/summary\s*~/);
  });
});

describe('JQL injection safety', () => {
  const emailArb = fc.string();
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

  // Feature: tenant-onboarding-jira, Property: no submitted value can reach
  // the JQL unescaped
  // Validates: Requirements 9.2
  it('the lookup JQL contains only safe characters for any email (Property)', () => {
    fc.assert(
      fc.property(emailArb, email => {
        const jql = buildLookupJql('ONB', emailLabelHash(email));
        expect(jql).toMatch(/^[A-Za-z0-9 ="_.-]+$/);
        expect(jql).not.toMatch(/[()]/);
      }),
      { numRuns: 200 },
    );
  });

  // Feature: tenant-onboarding-jira, Property: no submitted value can reach
  // the JQL unescaped
  // Validates: Requirements 3.1, 9.2
  it('the duplicate-check JQL contains only safe characters for any email/tenantName (Property)', () => {
    fc.assert(
      fc.property(emailArb, tenantNameArb, (email, tenant) => {
        const jql = buildDuplicateCheckJql(
          'ONB',
          emailLabelHash(email),
          tenantLabel(tenant),
        );
        expect(jql).toMatch(/^[A-Za-z0-9 ="_.-]+$/);
        expect(jql).not.toMatch(/[()]/);
      }),
      { numRuns: 200 },
    );
  });
});
