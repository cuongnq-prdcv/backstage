/**
 * Property-based test for `redact` (secret redaction).
 *
 * See the tenant-provision-crossplane design ("Testing Strategy" →
 * Property-based tests, Property 5).
 */

import fc from 'fast-check';

import { redact, REDACTION_PLACEHOLDER } from '../redact';

describe('redact: secret redaction', () => {
  // Feature: tenant-provision-crossplane, Property 5: Secret redaction is total and content-preserving
  // Validates: Requirements 7.3, 7.1
  it('removes every occurrence of the secret and preserves the rest (Property 5)', () => {
    // A non-empty secret plus surrounding non-secret fragments that do NOT
    // contain the secret, interleaved with the secret at random positions.
    // Exclude secrets that are a substring of the placeholder itself: after
    // substitution the placeholder would legitimately contain them, which the
    // `includes` assertion cannot distinguish (a test-only degenerate case, not
    // a redaction failure).
    const scenario = fc
      .string({ minLength: 1, maxLength: 24 })
      .filter(secret => !REDACTION_PLACEHOLDER.includes(secret))
      .chain(secret =>
        fc
          .array(
            fc.string({ maxLength: 20 }).filter(frag => !frag.includes(secret)),
            { minLength: 1, maxLength: 6 },
          )
          .map(fragments => ({ secret, fragments })),
      );

    fc.assert(
      fc.property(scenario, ({ secret, fragments }) => {
        const message = fragments.join(secret);
        const result = redact(message, [secret]);

        // No occurrence of the secret survives.
        expect(result.includes(secret)).toBe(false);

        // The non-secret fragments are preserved, joined by the placeholder.
        expect(result).toBe(fragments.join(REDACTION_PLACEHOLDER));
      }),
      { numRuns: 200 },
    );
  });

  it('ignores empty secrets and leaves the message unchanged', () => {
    expect(redact('hello world', [''])).toBe('hello world');
    expect(redact('hello world', [])).toBe('hello world');
  });
});
