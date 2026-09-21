# Requirements Document

## Introduction

This feature adds **Microsoft Azure Entra ID** (formerly Azure AD) OAuth sign-in to the Backstage
application, offered alongside the existing `guest` and `github` providers. It is scoped as a
proof-of-concept (POC).

Key decisions:

- **Identity model — trust-the-IdP.** Any user who authenticates successfully within the
  configured tenant is granted a Backstage identity derived from their **email local-part**. A
  matching catalog `User` entity is **not** required to pre-exist. (This is a deliberate
  divergence from the GitHub provider, which denies sign-in unless a `User` entity matches.)
- **Single-tenant.** Sign-in is scoped to one Entra ID directory via `AZURE_TENANT_ID`.
- **Secrets as env references.** Credentials and tenant are `${ENV_VAR}` references in
  `app-config`, never hardcoded — per the repo convention.

## Glossary

| Term | Meaning |
| --- | --- |
| **Backstage_App** | This app (`packages/app` frontend + `packages/backend` backend). |
| **Auth_Backend** | `@backstage/plugin-auth-backend`, which hosts authentication providers. |
| **Microsoft_Provider_Module** | The custom backend module `authModuleMicrosoftProvider` that registers `providerId: 'microsoft'` using `microsoftAuthenticator`. |
| **Entra_ID_App_Registration** | The Azure App Registration issuing `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET`, scoped to `AZURE_TENANT_ID`. |
| **Sign_In_Resolver** | The custom, code-defined resolver mapping an authenticated Microsoft profile to a Backstage identity. |
| **Email_Local_Part** | The portion of the email before the first `@`, lower-cased and sanitized to `[a-z0-9+_.-]`. |
| **Sign_In_Page** | The frontend sign-in page in `packages/app/src/modules/auth`. |
| `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` / `AZURE_TENANT_ID` | Application (client) ID / client secret / directory (tenant) ID. |

## Requirements

### Requirement 1: Register the Microsoft provider in the backend

**User Story:** As a Backstage operator, I want the Microsoft provider registered so the backend
can process Entra ID OAuth sign-in requests.

The Microsoft provider is registered as a custom backend module in the same place and style as the
existing GitHub provider, without disturbing the guest and GitHub registrations.

| # | Acceptance Criteria |
| --- | --- |
| 1.1 | THE Backstage_App SHALL register the Microsoft_Provider_Module with the Auth_Backend in `packages/backend/src/index.ts`. |
| 1.2 | THE Backstage_App SHALL retain the existing guest and GitHub provider registrations alongside it. |
| 1.3 | WHEN the backend starts, THE Auth_Backend SHALL expose a `microsoft` provider endpoint that responds to authentication requests. |
| 1.4 | IF any of `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, or `AZURE_TENANT_ID` is unset, THEN THE Auth_Backend SHALL fail to start the Microsoft provider and surface an error identifying the missing variable. |
| 1.5 | THE Microsoft_Provider_Module SHALL NOT read or log the values of `AZURE_*`; the provider factory resolves them from config. |

### Requirement 2: Configure the provider with environment-referenced values

**User Story:** As a Backstage operator, I want the provider configured through environment
variables so no secrets live in source control and sign-in is scoped to a single tenant.

| # | Acceptance Criteria |
| --- | --- |
| 2.1 | THE Backstage_App SHALL define a `microsoft` block under `auth.providers` in `app-config.yaml`, with fields nested under a `development` key. |
| 2.2 | The literal values SHALL be `clientId: ${AZURE_CLIENT_ID}`, `clientSecret: ${AZURE_CLIENT_SECRET}`, `tenantId: ${AZURE_TENANT_ID}`. |
| 2.3 | THE Backstage_App SHALL define an equivalent `microsoft` block in `app-config.production.yaml` under a `production` key. |
| 2.4 | No `app-config*` file SHALL contain literal Azure values; only `${...}` references SHALL appear. |
| 2.5 | THE Backstage_App SHALL retain the existing `guest` and `github` blocks in both files. |
| 2.6 | IF a `${AZURE_*}` reference cannot be resolved, THEN THE Auth_Backend SHALL surface a configuration error rather than start with an empty value. |

### Requirement 3: Resolve identities from the email local-part (trust-the-IdP)

**User Story:** As a POC user, I want a Backstage identity derived from my email so I can sign in
without a pre-existing catalog `User` entity.

The resolver is intentionally custom (not a built-in), because the built-in Microsoft resolvers
deny sign-in when no matching `User` entity exists — the opposite of what this POC needs.

| # | Acceptance Criteria |
| --- | --- |
| 3.1 | THE Sign_In_Resolver SHALL be code-defined in the Microsoft_Provider_Module, NOT via `app-config` `signIn.resolvers`. |
| 3.2 | WHEN authentication succeeds and the profile contains an email, THE Sign_In_Resolver SHALL issue an identity `user:default/<Email_Local_Part>` WITHOUT requiring a matching catalog `User` entity. |
| 3.3 | THE Email_Local_Part SHALL be the substring before the first `@`, lower-cased, sanitized to `[a-z0-9+_.-]`. |
| 3.4 | IF the profile has no email, THEN THE Sign_In_Resolver SHALL deny sign-in (no identity/session) and return an error indicating the profile has no email. |
| 3.5 | IF the sanitized local-part is empty, THEN THE Sign_In_Resolver SHALL deny sign-in (no identity/session) and return an error indicating the identity could not be derived. |
| 3.6 | THE issued identity SHALL carry empty ownership references (no group/ownership claims) for the POC. |

### Requirement 4: Provide Microsoft sign-in on the frontend

**User Story:** As a user, I want a Microsoft option on the sign-in page so I can authenticate with
my Entra ID account.

| # | Acceptance Criteria |
| --- | --- |
| 4.1 | THE Sign_In_Page SHALL present the Microsoft provider (wired to `microsoftAuthApiRef`) as a selectable option, visible before authentication. |
| 4.2 | THE Sign_In_Page SHALL retain the existing guest and GitHub options. |
| 4.3 | WHEN the user selects Microsoft, THE Sign_In_Page SHALL start the Entra ID OAuth flow. |
| 4.4 | WHEN authentication succeeds and the resolver issues an identity, THE Backstage_App SHALL grant a session and display the authenticated view. |
| 4.5 | IF the OAuth flow fails/cancels OR the resolver denies, THEN THE Backstage_App SHALL deny the session, return to the Sign_In_Page, and display a sign-in error. |

### Requirement 5: Document the environment variables in the README

**User Story:** As a developer setting up the app, I want the variables documented so I can
configure sign-in without reading source code.

| # | Acceptance Criteria |
| --- | --- |
| 5.1 | THE README Environment variables table SHALL have an `AZURE_CLIENT_ID` row (all three columns) whose Purpose states it identifies the Entra_ID_App_Registration for Microsoft sign-in. |
| 5.2 | THE README table SHALL have an `AZURE_CLIENT_SECRET` row (all three columns) whose Purpose states it authenticates the Entra_ID_App_Registration. |
| 5.3 | THE README table SHALL have an `AZURE_TENANT_ID` row (all three columns) whose Purpose states it scopes sign-in to a single Entra ID tenant. |
| 5.4 | THE README SHALL state the three values come from an Azure Entra ID App Registration. |
| 5.5 | THE README "do not commit real values" note SHALL cover `AZURE_CLIENT_SECRET`. |

## Non-Goals (POC scope)

These are explicitly out of scope for this iteration and form the natural upgrade path:

- No Microsoft Graph organizational ingestion (users/groups sync into the catalog).
- No group/ownership resolution — issued identities carry empty ownership references.
- No deny-on-no-match model (GitHub-style); a catalog `User` entity is not required.
- No multi-tenant / `common` sign-in; scoped to a single tenant via `AZURE_TENANT_ID`.
- No change to the permission policy (stays allow-all).

> The custom resolver is the single place a later iteration would add catalog lookup and ownership
> resolution.
