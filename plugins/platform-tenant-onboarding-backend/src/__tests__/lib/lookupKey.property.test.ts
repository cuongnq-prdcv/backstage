/**
 * Property-based tests for the lookup-key derivations
 * (`emailLabelHash`, `tenantLabel`).
 *
 * See the tenant-onboarding-jira design ("Labels and the lookup key") and
 * plan Task 3.
 */

import fc from 'fast-check';
import { emailLabelHash, tenantLabel, MARKER_LABEL } from '../../lib/lookupKey';

describe('emailLabelHash', () => {
  // Feature: tenant-onboarding-jira, Property: the email label is always
  // `onb-` followed by 16 hex characters
  // Validates: Requirements 9.2
  it('is always "onb-" followed by 16 hex characters (Property)', () => {
    fc.assert(
      fc.property(fc.string(), email => {
        expect(emailLabelHash(email)).toMatch(/^onb-[0-9a-f]{16}$/);
      }),
      { numRuns: 200 },
    );
  });

  // Feature: tenant-onboarding-jira, Property: hashing is insensitive to case
  // and surrounding whitespace
  // Validates: Requirements 3.1, 4.2
  it('is insensitive to case and surrounding whitespace (Property)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter(s => s.trim().length > 0),
        fc.array(fc.constantFrom(' ', '\t', '\n'), { maxLength: 3 }),
        fc.array(fc.constantFrom(' ', '\t', '\n'), { maxLength: 3 }),
        (core, leading, trailing) => {
          const padded = `${leading.join('')}${core}${trailing.join('')}`;
          expect(emailLabelHash(padded)).toBe(
            emailLabelHash(core.toLowerCase()),
          );
          expect(emailLabelHash(core.toUpperCase())).toBe(
            emailLabelHash(core.toLowerCase()),
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  it('matches a known vector', () => {
    // sha256('a@b.com') = 1177...; first 16 hex chars fixed below.
    expect(emailLabelHash(' A@B.com ')).toBe(emailLabelHash('a@b.com'));
    expect(emailLabelHash('a@b.com')).toMatch(/^onb-[0-9a-f]{16}$/);
  });
});

describe('tenantLabel', () => {
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

  // Feature: tenant-onboarding-jira, Property: the tenant label only contains
  // [a-z0-9-]
  // Validates: Requirements 3.1, 9.2
  it('only contains [a-z0-9-] for any valid tenantName (Property)', () => {
    fc.assert(
      fc.property(tenantNameArb, tenant => {
        expect(tenantLabel(tenant)).toMatch(/^onb-tenant-[a-z0-9-]+$/);
        expect(tenantLabel(tenant)).toBe(`onb-tenant-${tenant}`);
      }),
      { numRuns: 200 },
    );
  });
});

describe('MARKER_LABEL', () => {
  it('is the fixed marker label', () => {
    expect(MARKER_LABEL).toBe('tenant-onboarding');
  });
});
