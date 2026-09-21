# Implementation Plan: Azure Entra ID Login

## Overview

This plan implements Microsoft Azure Entra ID OAuth sign-in for the Backstage app alongside the
existing `guest` and `github` providers. Implementation is in **TypeScript** (matching the
existing monorepo), mirroring the established custom GitHub provider pattern
(`authModuleGithubProvider.ts` + `githubSignInResolver.ts` + `SignInPage.tsx`).

Identity model is **trust-the-IdP** (POC): any authenticated in-tenant user is issued
`user:default/<email-local-part>` with empty ownership, without a catalog lookup.

The work is sequenced so the pure derivation helper `deriveMicrosoftUserRef` and its property
tests come first, then the custom resolver that wires the helper to token issuance, then the
provider registration in the backend, then `app-config` blocks, then the frontend option, and
finally README docs. Each step ends by integrating into the running backend/frontend so there is
no orphaned code.

Verification uses the project scripts (AGENTS.md / `package.json`): `yarn tsc` (typecheck),
`yarn workspace backend test`, `yarn workspace app test`, and `yarn lint`.

## File Structure

| File | New/Modified | Responsibility |
| --- | --- | --- |
| `packages/backend/src/microsoftSignInResolver.ts` | New | Pure `deriveMicrosoftUserRef` helper + the sign-in resolver wiring it to `ctx.issueToken` |
| `packages/backend/src/microsoftSignInResolver.test.ts` | New | Property + unit tests for the helper/resolver |
| `packages/backend/src/authModuleMicrosoftProvider.ts` | New | Backend module registering `providerId: 'microsoft'` with the custom resolver |
| `packages/backend/src/authModuleMicrosoftProvider.test.ts` | New | Module smoke test |
| `packages/backend/src/index.ts` | Modified | `backend.add(authModuleMicrosoftProvider)` after the GitHub line |
| `packages/backend/package.json` | Modified | Add `@backstage/plugin-auth-backend-module-microsoft-provider` |
| `app-config.yaml` | Modified | `auth.providers.microsoft.development` block |
| `app-config.production.yaml` | Modified | `auth.providers.microsoft.production` block |
| `packages/app/src/modules/auth/SignInPage.tsx` | Modified | Add the Microsoft provider entry |
| `packages/app/src/modules/auth/SignInPage.test.tsx` | Modified | Assert all three options present |
| `README.md` | Modified | Add three `AZURE_*` env-var rows + secret note |

## Tasks

- [ ] 1. Add the Microsoft provider dependency
  - [ ] 1.1 Add `@backstage/plugin-auth-backend-module-microsoft-provider` to the backend workspace
    - Run `yarn workspace backend add @backstage/plugin-auth-backend-module-microsoft-provider` (pinned to a version compatible with the repo's `@backstage/*` versions), so `microsoftAuthenticator` is available. Do not edit `package.json` by hand.
    - Run `yarn tsc` to confirm the workspace still typechecks.
    - _Requirements: 1.1_

- [ ] 2. Implement the pure derivation helper
  - [ ] 2.1 Create `deriveMicrosoftUserRef` and the `DeriveOutcome` type
    - In `packages/backend/src/microsoftSignInResolver.ts`, export the `DeriveOutcome` union (`{ kind: 'ok'; userRef: string } | { kind: 'no-email' } | { kind: 'empty-local-part' }`) and a pure function `deriveMicrosoftUserRef(email: string | undefined): DeriveOutcome`.
    - Return `no-email` when the email is absent/empty; otherwise take the substring before the first `@`, lower-case it, strip characters outside `[a-z0-9+_.-]`; return `empty-local-part` if the result is empty, else `ok` with `userRef = 'user:default/' + <local-part>`.
    - Keep the function pure — no OAuth, no token issuance, no I/O.
    - _Requirements: 3.2, 3.3, 3.4, 3.5_

  - [ ] 2.2 Write the property test for outcome by input
    - In `microsoftSignInResolver.test.ts`, use `fast-check` with at least 100 iterations (`fc.assert(..., { numRuns: 100 })`).
    - Generate emails including `undefined`, no-`@`, mixed case, empty local-part, and characters outside `[a-z0-9+_.-]`; assert the outcome kind matches the rules and that `ok` yields a `userRef` matching `user:default/[a-z0-9+_.-]+`.
    - Tag with comment: `Feature: azure-entraid-login, Property 1: Outcome determined by email presence and sanitized local-part`.
    - Use placeholder emails only (e.g. `jane.doe@example.com`), never real people.
    - **Property 1: Outcome determined by email presence and sanitized local-part**
    - **Validates: Requirements 3.2, 3.3, 3.4, 3.5**

  - [ ] 2.3 Write the property test for case-insensitivity and determinism
    - Use `fast-check` with at least 100 iterations.
    - Assert that permuting only the letter-case of the input does not change the outcome kind, `ok` outcomes produce the same lower-cased `userRef`, and two calls with equal inputs yield equal outcomes.
    - Tag with comment: `Feature: azure-entraid-login, Property 2: Derivation is case-insensitive and deterministic`.
    - **Property 2: Derivation is case-insensitive and deterministic**
    - **Validates: Requirements 3.2, 3.3**

  - [ ] 2.4 Write example unit tests for the derivation
    - Assert `jane.doe@example.com` → `{ kind: 'ok', userRef: 'user:default/jane.doe' }`; `Jane.Doe@Example.com` → same lower-cased ref; `alice@example.com` → `user:default/alice`; `undefined`/empty → `no-email`; a degenerate email (e.g. `@example.com`) → `empty-local-part`.
    - _Requirements: 3.2, 3.3, 3.4, 3.5_

- [ ] 3. Implement the custom sign-in resolver
  - [ ] 3.1 Build the resolver wiring `deriveMicrosoftUserRef` to token issuance
    - In `microsoftSignInResolver.ts`, export a factory (e.g. `createMicrosoftSignInResolver`) returning a `SignInResolver` `(info, ctx)` that reads `email` from the Microsoft profile, calls `deriveMicrosoftUserRef`, and for `ok` issues an identity via `ctx.issueToken` with `userEntityRef` and **empty** ownership references; for `no-email` and `empty-local-part` throws a distinct denial error (no identity/session issued).
    - Denial messages: `no-email` → "profile has no email"; `empty-local-part` → "could not derive identity from email". Never log `AZURE_*` values; messages reference variable names only.
    - _Requirements: 3.1, 3.2, 3.4, 3.5, 3.6_

  - [ ] 3.2 Write unit tests for the resolver's issue and deny paths
    - With a mocked `ctx`: `ok` issues an identity for the derived ref with empty ownership (3.2, 3.6); a profile with no email denies with the "profile has no email" error (3.4); a degenerate email denies with the "could not derive identity" error (3.5). Assert no token is issued on deny paths.
    - _Requirements: 3.2, 3.4, 3.5, 3.6_

- [ ] 4. Register the Microsoft provider in the backend
  - [ ] 4.1 Create `authModuleMicrosoftProvider.ts`
    - Mirror `authModuleGithubProvider.ts`: `createBackendModule` with `pluginId: 'auth'`, `moduleId: 'microsoft-provider'`, registering `providerId: 'microsoft'` via `createOAuthProviderFactory({ authenticator: microsoftAuthenticator, signInResolver: createMicrosoftSignInResolver() })`.
    - Do NOT read or log `AZURE_*` values (factory resolves them from config). No catalog dependency is needed.
    - _Requirements: 1.1, 1.5, 3.1_

  - [ ] 4.2 Wire the module into `packages/backend/src/index.ts`
    - Import `authModuleMicrosoftProvider` and `backend.add(...)` it immediately after the existing `backend.add(authModuleGithubProvider)` line. Retain all existing auth/guest/github registrations unchanged.
    - _Requirements: 1.1, 1.2_

  - [ ] 4.3 Write the module smoke test
    - In `authModuleMicrosoftProvider.test.ts` (mirroring `authModuleGithubProvider.test.ts`), assert the module registers `providerId: 'microsoft'` with `pluginId: 'auth'` and that init does not throw.
    - _Requirements: 1.1_

- [ ] 5. Configure the provider in app-config
  - [ ] 5.1 Add the `microsoft` development block in `app-config.yaml`
    - Under `auth.providers`, add a `microsoft.development` block with `clientId: ${AZURE_CLIENT_ID}`, `clientSecret: ${AZURE_CLIENT_SECRET}`, `tenantId: ${AZURE_TENANT_ID}`. Retain the existing `guest` and `github` blocks. Omit `signIn.resolvers` (the code resolver takes priority). Use only `${...}` references — no literal values.
    - _Requirements: 2.1, 2.2, 2.4, 2.5_

  - [ ] 5.2 Add the `microsoft` production block in `app-config.production.yaml`
    - Add a `microsoft.production` block with the same three `${AZURE_*}` fields; retain the `guest` and `github` blocks. Use only `${...}` references.
    - _Requirements: 2.3, 2.4, 2.5_

  - [ ] 5.3 Write config-shape and no-literal-value tests
    - Parse both config files; assert the `microsoft` blocks exist under the correct environment keys, that the three fields are exactly `${AZURE_CLIENT_ID}`/`${AZURE_CLIENT_SECRET}`/`${AZURE_TENANT_ID}`, and that `guest` and `github` blocks are retained (2.1, 2.2, 2.3, 2.5).
    - Scan all `app-config*` files and assert the Azure fields match only the `${...}` reference form with no literal value (2.4).
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [ ] 6. Checkpoint - Ensure backend build and tests pass
  - Run `yarn tsc`, `yarn workspace backend test`, and `yarn lint`. Ensure all pass; ask the user if questions arise.

- [ ] 7. Add the Microsoft sign-in option to the frontend
  - [ ] 7.1 Add the Microsoft provider entry in `SignInPage.tsx`
    - Import `microsoftAuthApiRef` from `@backstage/core-plugin-api` and append a third entry to the `providers` array: `{ id: 'microsoft-auth-provider', title: 'Microsoft', message: 'Sign in using Azure Entra ID', apiRef: microsoftAuthApiRef }`. Retain the `guest` and `github` entries. `index.ts` (`SignInPageBlueprint`) is unchanged.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [ ] 7.2 Extend `SignInPage.test.tsx`
    - Extend the existing test to assert all three options (guest, GitHub, Microsoft) are present and selectable, keeping the existing GitHub/guest assertions.
    - _Requirements: 4.1, 4.2_

- [ ] 8. Document the environment variables
  - [ ] 8.1 Update the README Environment variables section
    - Add rows for `AZURE_CLIENT_ID` (Purpose: identifies the Entra ID App Registration for Microsoft sign-in), `AZURE_CLIENT_SECRET` (Purpose: authenticates the App Registration), and `AZURE_TENANT_ID` (Purpose: scopes sign-in to a single tenant), each with all three columns (Variable, Purpose, Used in) populated and Used in listing `app-config.yaml`, `app-config.production.yaml`.
    - State that the three values come from an Azure Entra ID App Registration, and extend the existing "never commit real values" note to cover `AZURE_CLIENT_SECRET`.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [ ] 9. Final checkpoint - Ensure all tests pass
  - Run `yarn tsc`, `yarn workspace backend test`, `yarn workspace app test`, and `yarn lint`. Ensure all pass; ask the user if questions arise.

## Notes

- Property tests (2.2, 2.3) target the pure `deriveMicrosoftUserRef` helper only; the rest is
  covered by unit/example, module smoke, config-shape, and render tests per the design's Testing
  Strategy.
- The custom code resolver is the primary path, so `signIn.resolvers` is omitted from the
  `app-config` `microsoft` blocks — the resolver decision lives in one place (task 3.1).
- Trust-the-IdP: no catalog lookup, empty ownership references (task 3.1). Upgrading to catalog
  lookup/ownership later happens in this one file.
- No test performs a live Entra ID OAuth exchange or uses real credentials (AGENTS.md + Non-Goals).
- Never log or commit `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` / `AZURE_TENANT_ID`; config uses
  `${...}` references only.
- Manual Azure setup (outside code): create a single-tenant App Registration, set Redirect URI
  `http://localhost:7007/api/auth/microsoft/handler/frame`, create a client secret, and place the
  three values in a local `.env` (gitignored).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "5.1", "5.2", "8.1"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "3.1", "5.3"] },
    { "id": 3, "tasks": ["3.2", "4.1"] },
    { "id": 4, "tasks": ["4.2", "4.3", "7.1"] },
    { "id": 5, "tasks": ["6", "7.2"] },
    { "id": 6, "tasks": ["9"] }
  ]
}
```
