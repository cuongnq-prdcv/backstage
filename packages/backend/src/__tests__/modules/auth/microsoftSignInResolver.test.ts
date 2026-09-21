import fc from 'fast-check';
import type {
  AuthResolverContext,
  BackstageSignInResult,
  OAuthAuthenticatorResult,
  PassportProfile,
  SignInInfo,
} from '@backstage/plugin-auth-node';
import {
  EMPTY_LOCAL_PART_ERROR,
  NO_EMAIL_ERROR,
  createMicrosoftSignInResolver,
  deriveMicrosoftUserRef,
  selectProfileEmail,
} from '../../../modules/auth/microsoftSignInResolver';

/**
 * Tests for the Microsoft sign-in derivation helper and resolver.
 *
 * - Property tests target the pure `deriveMicrosoftUserRef` helper (Properties
 *   1 and 2 from the azure-entraid-login design).
 * - Example unit tests pin concrete derivations (Req 3.2–3.5).
 * - Resolver tests exercise the issue/deny wiring with a mocked context
 *   (Req 3.2, 3.4, 3.5, 3.6).
 *
 * All fixtures use placeholder emails (e.g. jane.doe@example.com); never real
 * individuals.
 */

const ALLOWED = 'abcdefghijklmnopqrstuvwxyz0123456789+_.-';
const ALLOWED_UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Local-part characters that survive sanitization (lower-cased allowed set). */
const localPartArb = fc.string({
  unit: fc.constantFrom(...ALLOWED.split('')),
  minLength: 1,
  maxLength: 20,
});

/** Arbitrary email-ish strings including mixed case and out-of-set chars. */
const emailArb = fc.string({ minLength: 0, maxLength: 40 });

describe('deriveMicrosoftUserRef - Property 1: Outcome determined by email presence and sanitized local-part', () => {
  // Feature: azure-entraid-login, Property 1: Outcome determined by email presence and sanitized local-part
  // Validates: Requirements 3.2, 3.3, 3.4, 3.5

  it('undefined/empty email yields no-email', () => {
    fc.assert(
      fc.property(fc.constantFrom(undefined, ''), email => {
        expect(deriveMicrosoftUserRef(email).kind).toBe('no-email');
      }),
      { numRuns: 100 },
    );
  });

  it('yields no-email for empty and empty-local-part for @-leading emails', () => {
    // Partition inputs so each assertion is unconditional (one expected value
    // per generated case), avoiding conditional expects.
    fc.assert(
      fc.property(fc.constantFrom('', '@', '@example.com', '@a@b'), email => {
        const expected =
          email.length === 0 ? 'no-email' : 'empty-local-part';
        expect(deriveMicrosoftUserRef(email).kind).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  it('ok: a sanitized-safe local-part always yields user:default/<local-part>', () => {
    fc.assert(
      fc.property(localPartArb, local => {
        expect(deriveMicrosoftUserRef(`${local}@example.com`)).toEqual({
          kind: 'ok',
          userRef: `user:default/${local}`,
        });
      }),
      { numRuns: 100 },
    );
  });

  it('ok: the derived userRef always matches the entity-name character set', () => {
    fc.assert(
      fc.property(localPartArb, local => {
        const outcome = deriveMicrosoftUserRef(`${local}@example.com`);
        expect(outcome).toEqual({
          kind: 'ok',
          userRef: expect.stringMatching(/^user:default\/[a-z0-9+_.-]+$/),
        });
      }),
      { numRuns: 100 },
    );
  });
});

describe('deriveMicrosoftUserRef - Property 2: Derivation is case-insensitive and deterministic', () => {
  // Feature: azure-entraid-login, Property 2: Derivation is case-insensitive and deterministic
  // Validates: Requirements 3.2, 3.3

  it('changing only the letter-case of the input does not change the outcome', () => {
    fc.assert(
      fc.property(
        fc.string({
          unit: fc.constantFrom(
            ...ALLOWED.split(''),
            ...ALLOWED_UPPER.split(''),
          ),
          minLength: 1,
          maxLength: 20,
        }),
        raw => {
          const email = `${raw}@example.com`;
          const lower = deriveMicrosoftUserRef(email.toLowerCase());
          const upper = deriveMicrosoftUserRef(email.toUpperCase());
          // Case only differs, so the full outcomes must be equal.
          expect(lower).toEqual(upper);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('is deterministic: equal inputs yield equal outcomes', () => {
    fc.assert(
      fc.property(emailArb, email => {
        expect(deriveMicrosoftUserRef(email)).toEqual(
          deriveMicrosoftUserRef(email),
        );
      }),
      { numRuns: 100 },
    );
  });
});

describe('deriveMicrosoftUserRef - example derivations', () => {
  it.each([
    ['jane.doe@example.com', 'user:default/jane.doe'],
    ['Jane.Doe@Example.com', 'user:default/jane.doe'],
    ['alice@example.com', 'user:default/alice'],
  ])('derives %s -> %s (Req 3.2, 3.3)', (email, userRef) => {
    const outcome = deriveMicrosoftUserRef(email);
    expect(outcome).toEqual({ kind: 'ok', userRef });
  });

  it.each([undefined, ''])('yields no-email for %p (Req 3.4)', email => {
    expect(deriveMicrosoftUserRef(email as string | undefined)).toEqual({
      kind: 'no-email',
    });
  });

  it('yields empty-local-part for an email with no usable local-part (Req 3.5)', () => {
    expect(deriveMicrosoftUserRef('@example.com')).toEqual({
      kind: 'empty-local-part',
    });
  });
});

describe('selectProfileEmail - email source with UPN fallback', () => {
  it('prefers profile.email when present', () => {
    expect(
      selectProfileEmail({
        email: 'jane.doe@example.com',
        emails: [{ value: 'other@example.com' }],
        username: 'upn@tenant.onmicrosoft.com',
      } as any),
    ).toBe('jane.doe@example.com');
  });

  it('falls back to emails[0].value when email is absent', () => {
    expect(
      selectProfileEmail({
        emails: [{ value: 'list@example.com' }],
        username: 'upn@tenant.onmicrosoft.com',
      } as any),
    ).toBe('list@example.com');
  });

  it('falls back to username (UPN) when no email fields are present', () => {
    expect(
      selectProfileEmail({
        username: 'upn@tenant.onmicrosoft.com',
      } as any),
    ).toBe('upn@tenant.onmicrosoft.com');
  });

  it('returns undefined when nothing usable is present', () => {
    expect(selectProfileEmail({} as any)).toBeUndefined();
  });
});

/**
 * Builds a minimal `SignInInfo` carrying just the email the resolver reads from
 * `info.result.fullProfile.email`.
 */
function makeSignInInfo(
  email: string | undefined,
): SignInInfo<OAuthAuthenticatorResult<PassportProfile>> {
  return {
    result: { fullProfile: { email } },
  } as unknown as SignInInfo<OAuthAuthenticatorResult<PassportProfile>>;
}

const ISSUED_IDENTITY = {
  token: 'issued-backstage-token',
} as unknown as BackstageSignInResult;

/** Mocked context whose `issueToken` records calls and returns the sentinel. */
function makeContext(): {
  context: AuthResolverContext;
  issueToken: jest.Mock;
} {
  const issueToken = jest.fn().mockResolvedValue(ISSUED_IDENTITY);
  const context = { issueToken } as unknown as AuthResolverContext;
  return { context, issueToken };
}

describe('createMicrosoftSignInResolver - issue and deny paths', () => {
  it('issues an identity from the email local-part with empty ownership (Req 3.2, 3.6)', async () => {
    const resolver = createMicrosoftSignInResolver();
    const { context, issueToken } = makeContext();

    const result = await resolver(
      makeSignInInfo('jane.doe@example.com'),
      context,
    );

    expect(issueToken).toHaveBeenCalledTimes(1);
    expect(issueToken).toHaveBeenCalledWith({
      claims: { sub: 'user:default/jane.doe', ent: [] },
    });
    expect(result).toBe(ISSUED_IDENTITY);
  });

  it('denies with the no-email error and issues no identity (Req 3.4)', async () => {
    const resolver = createMicrosoftSignInResolver();
    const { context, issueToken } = makeContext();

    await expect(
      resolver(makeSignInInfo(undefined), context),
    ).rejects.toThrow(NO_EMAIL_ERROR);

    expect(issueToken).not.toHaveBeenCalled();
  });

  it('denies with the empty-local-part error and issues no identity (Req 3.5)', async () => {
    const resolver = createMicrosoftSignInResolver();
    const { context, issueToken } = makeContext();

    await expect(
      resolver(makeSignInInfo('@example.com'), context),
    ).rejects.toThrow(EMPTY_LOCAL_PART_ERROR);

    expect(issueToken).not.toHaveBeenCalled();
  });
});
