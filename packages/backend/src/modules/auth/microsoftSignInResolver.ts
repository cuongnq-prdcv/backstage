/**
 * Pure derivation helper and custom sign-in resolver for the Microsoft
 * (Azure Entra ID) sign-in provider.
 *
 * The pure helper (`deriveMicrosoftUserRef`) intentionally contains no OAuth,
 * token issuance, or I/O so that the email-to-identity decision can be unit-
 * and property-tested in isolation. The resolver below wires it to Backstage
 * token issuance. See the azure-entraid-login design (Components and
 * Interfaces) for context.
 *
 * Identity model is "trust-the-IdP" (POC): any authenticated in-tenant user is
 * issued `user:default/<email-local-part>` with empty ownership, WITHOUT a
 * catalog lookup. This deliberately differs from the GitHub resolver, which
 * denies sign-in unless a matching catalog `User` entity exists.
 */

import type {
  AuthResolverContext,
  BackstageSignInResult,
  OAuthAuthenticatorResult,
  PassportProfile,
  SignInInfo,
  SignInResolver,
} from '@backstage/plugin-auth-node';

/**
 * The outcome of deriving a Backstage identity from a Microsoft profile email.
 *
 * - `ok`: the email had a non-empty sanitized local-part; `userRef` is the
 *   `user:default/<local-part>` reference.
 * - `no-email`: the profile carried no (usable) email.
 * - `empty-local-part`: the sanitized local-part was empty.
 */
export type DeriveOutcome =
  | { kind: 'ok'; userRef: string }
  | { kind: 'no-email' }
  | { kind: 'empty-local-part' };

/**
 * The character set Backstage permits in an entity name. Any character outside
 * this set is stripped from the derived local-part.
 */
const DISALLOWED_ENTITY_NAME_CHARS = /[^a-z0-9+_.-]/g;

/**
 * Derive a Backstage user reference from a Microsoft profile email.
 *
 * The email is lower-cased, the substring before the first `@` is taken, and
 * any character outside `[a-z0-9+_.-]` is stripped. An identity is derived
 * (`ok`) only when the resulting local-part is non-empty; an absent/empty email
 * yields `no-email` and an empty local-part yields `empty-local-part`.
 *
 * This function is pure: it performs no I/O and depends only on its argument.
 *
 * @param email - The email from the authenticated Microsoft profile.
 * @returns The derivation outcome.
 */
export function deriveMicrosoftUserRef(
  email: string | undefined,
): DeriveOutcome {
  if (!email) {
    return { kind: 'no-email' };
  }

  const localPart = email
    .toLowerCase()
    .split('@')[0]
    .replace(DISALLOWED_ENTITY_NAME_CHARS, '');

  if (localPart.length === 0) {
    return { kind: 'empty-local-part' };
  }

  return { kind: 'ok', userRef: `user:default/${localPart}` };
}

/*
 * ---------------------------------------------------------------------------
 * Custom Microsoft sign-in resolver
 * ---------------------------------------------------------------------------
 *
 * The resolver below wires the pure `deriveMicrosoftUserRef` helper to
 * Backstage token issuance. It implements the trust-the-IdP model from the
 * azure-entraid-login design (Requirement 3):
 *
 *   - email present, non-empty local-part -> issue identity (empty ownership) (3.2, 3.6)
 *   - no email                            -> deny "profile has no email"       (3.4)
 *   - empty local-part                    -> deny "could not derive identity"  (3.5)
 *
 * No catalog lookup is performed. Credential values
 * (`AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` / `AZURE_TENANT_ID`) are never read
 * or logged here; denial messages reference structural reasons only.
 */

/** Denial error emitted when the profile carries no email (3.4). */
export const NO_EMAIL_ERROR = 'profile has no email';
/** Denial error emitted when the sanitized local-part is empty (3.5). */
export const EMPTY_LOCAL_PART_ERROR = 'could not derive identity from email';

/**
 * Selects the best available email-like identifier from a Microsoft profile.
 *
 * Entra ID does not always populate `email` (a mailbox/`mail` attribute is
 * required for that). When it is absent we fall back to the first
 * `emails[]` value and then to `username`, which for the Microsoft strategy
 * carries the userPrincipalName (UPN), e.g. `user@tenant.onmicrosoft.com`. All
 * of these are of the form `local@domain`, so the pure
 * {@link deriveMicrosoftUserRef} helper can derive the local-part from any of
 * them unchanged.
 *
 * This function is pure: it depends only on its argument.
 *
 * @param profile - The authenticated Microsoft profile.
 * @returns The chosen email-like string, or undefined if none is present.
 */
export function selectProfileEmail(
  profile: PassportProfile,
): string | undefined {
  return profile.email || profile.emails?.[0]?.value || profile.username;
}

/**
 * Builds the custom Microsoft sign-in resolver.
 *
 * The returned resolver reads the email from the sign-in result, delegates the
 * derivation to the pure {@link deriveMicrosoftUserRef} helper, and translates
 * the {@link DeriveOutcome} into either an issued Backstage identity (the `ok`
 * case, with empty ownership references per Requirement 3.6) or a distinct
 * denial for each failure case. No identity or session is issued in any deny
 * case.
 *
 * @returns A {@link SignInResolver} for the Microsoft provider.
 */
export function createMicrosoftSignInResolver(): SignInResolver<
  OAuthAuthenticatorResult<PassportProfile>
> {
  return async (
    info: SignInInfo<OAuthAuthenticatorResult<PassportProfile>>,
    context: AuthResolverContext,
  ): Promise<BackstageSignInResult> => {
    const email = selectProfileEmail(info.result.fullProfile);
    const outcome = deriveMicrosoftUserRef(email);

    switch (outcome.kind) {
      case 'ok':
        // Trust-the-IdP: issue an identity derived from the email local-part
        // with empty ownership references, without a catalog lookup (3.2, 3.6).
        return context.issueToken({
          claims: { sub: outcome.userRef, ent: [] },
        });
      case 'no-email':
        // No email in the profile: deny, issue no identity/session (3.4).
        throw new Error(NO_EMAIL_ERROR);
      case 'empty-local-part':
      default:
        // Empty local-part after sanitization: deny, no identity/session (3.5).
        throw new Error(EMPTY_LOCAL_PART_ERROR);
    }
  };
}
