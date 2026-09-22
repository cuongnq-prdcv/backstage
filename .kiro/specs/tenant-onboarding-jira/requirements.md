# Requirements Document

## Introduction

This feature adds a **tenant onboarding request** flow to the Backstage app, scoped as a
proof-of-concept (POC). A prospective tenant — someone who does **not** yet have an Azure Entra ID
account in the organization — signs in as `guest`, submits an onboarding form in Backstage, and the
backend files a **Jira issue** that a human reviews and approves manually. Creating the Azure
subscription and inviting the tenant into Entra ID remain manual steps performed outside Backstage.

This complements the already-implemented provisioning feature
(`.kiro/specs/tenant-provision-crossplane`): onboarding is what happens *before* a tenant has an
account; provisioning is what an authenticated (Microsoft) user does *after*.

Key decisions:

- **Form in Backstage, Jira as the backend of record.** The form is a Software Template; the
  scaffolder action calls the Jira REST API. Jira is where approval happens, by hand.
- **No database.** Jira is the single source of truth for requests and their status. Lookup is a
  JQL query, not a local table.
- **Lookup by contact email.** Guest is a single shared anonymous identity, so "my requests" is
  defined by the `contactEmail` entered in the form. The Jira issue key is also surfaced after
  submit so it can be bookmarked.
- **Flow separation is enforced, not merely suggested.** The `allow-all` permission policy is
  replaced by a policy that prevents a guest from running the provisioning template.
- **Core Jira issue fields, not Jira Forms.** A Jira Form is always attached to an issue; since
  Backstage already owns the form definition, duplicating it as a Jira form template would create
  two definitions to keep in sync.

## Glossary

| Term | Meaning |
| --- | --- |
| **Backstage_App** | This app (`packages/app` frontend + `packages/backend` backend). |
| **Onboarding_Template** | The new `Template` entity at `templates/tenant-onboarding/template.yaml`, `spec.type: onboarding`, `tags: [onboarding]`. |
| **Provisioning_Template** | The existing `templates/tenant-provisioning-crossplane/template.yaml`, which gains `tags: [provisioning]`. |
| **Onboarding_Action** | The custom scaffolder action `onboarding:create-jira-issue`. |
| **Jira_Client** | The module that talks to Jira Cloud REST API v3 (`lib/jiraClient.ts`). |
| **Onboarding_Request** | One submitted form, represented as exactly one Jira issue. |
| **Email_Label_Hash** | `onb-<first 16 hex chars of sha256(lowercased trimmed contactEmail)>` — a Jira label used as the exact-match lookup key. |
| **Tenant_Label** | `onb-tenant-<tenantName>` — a Jira label used to match duplicates exactly. Safe as a label because `tenantName` is already constrained to `[a-z0-9-]`. |
| **Marker_Label** | The fixed label `tenant-onboarding` present on every Onboarding_Request issue. |
| **Lookup_Endpoint** | `GET /api/tenant-onboarding/requests?email=<email>` in the new backend plugin. |
| **Lookup_Page** | The new frontend page listing a contact's requests. |
| **Flow_Policy** | The custom `PermissionPolicy` in `packages/backend/src/modules/permission/`, replacing `allow-all-policy`. |
| **Guest_Identity** | `user:development/guest` — the entity ref issued by the guest provider. |
| **Microsoft_Identity** | `user:default/<email-local-part>` — the entity ref issued by the repo's custom Microsoft sign-in resolver. |
| `JIRA_BASE_URL` / `JIRA_USER_EMAIL` / `JIRA_API_TOKEN` / `JIRA_PROJECT_KEY` | Jira Cloud site URL / API account email / API token (secret) / target project key. |

## Requirements

### Requirement 1: Onboarding request form

**User Story:** As a prospective tenant without an Entra ID account, I want to submit an onboarding
request from Backstage so that the platform team can create my Azure subscription.

| # | Acceptance Criteria |
| --- | --- |
| 1.1 | THE Backstage_App SHALL provide the Onboarding_Template, registered under `catalog.locations` in `app-config.yaml` with `rules: [allow: [Template]]`. |
| 1.2 | THE Onboarding_Template SHALL collect exactly these fields: `tenantName`, `contactEmail`, `contactName`, `organization`, `environment`, `location`, `purpose` — all required. |
| 1.3 | THE Onboarding_Template SHALL constrain `tenantName` with the pattern `^[a-z0-9]([a-z0-9-]{1,20})[a-z0-9]$`, identical to the Provisioning_Template, so the two flows agree on tenant naming. |
| 1.4 | THE Onboarding_Template SHALL constrain `environment` to `dev`/`staging`/`prod` and `location` to `japaneast`/`japanwest`/`southeastasia`, matching the Provisioning_Template enums. |
| 1.5 | THE Onboarding_Template SHALL declare `contactEmail` with `format: email`, and render `purpose` as a textarea limited to 1000 characters. |
| 1.6 | THE Onboarding_Template SHALL consist of exactly one step invoking the Onboarding_Action, and SHALL NOT invoke any Git, Terraform, Terragrunt, Crossplane, or cloud-provider action. |
| 1.7 | WHEN a submission succeeds, THE Onboarding_Template SHALL display the Jira issue key, a link to the issue, and instructions to keep the key for later lookup. |
| 1.8 | THE Onboarding_Template SHALL be extensible: adding a field SHALL require changes only to the template parameters, the action input type, and the field-mapping module. |

### Requirement 2: File the request as a Jira issue

**User Story:** As a platform operator, I want each request to arrive as a Jira issue so that I can
review and approve it with the tooling my team already uses.

| # | Acceptance Criteria |
| --- | --- |
| 2.1 | THE Backstage_App SHALL register the Onboarding_Action with the scaffolder. |
| 2.2 | WHEN the Onboarding_Action runs, THE Jira_Client SHALL create one issue via `POST /rest/api/3/issue` in the configured `projectKey`, using Basic authentication built from `JIRA_USER_EMAIL` and `JIRA_API_TOKEN`. |
| 2.3 | THE created issue SHALL have summary `[Onboarding] <tenantName> — <organization>` and a description in Atlassian Document Format containing all seven submitted field values. |
| 2.4 | THE created issue SHALL carry the Marker_Label, the Email_Label_Hash, and the Tenant_Label. |
| 2.5 | THE Onboarding_Action SHALL emit outputs `issueKey`, `issueUrl`, `issueId`, and `reusedExisting`. |
| 2.6 | THE Onboarding_Action SHALL validate its inputs before performing any network call, and SHALL reject invalid input without creating an issue. |
| 2.7 | THE Onboarding_Action SHALL NOT create, modify, or delete anything outside Jira — no repository write, no cloud API call. |

### Requirement 3: Suppress duplicate requests

**User Story:** As a tenant who double-clicked submit, I want a single request rather than two
tickets, so the platform team is not confused about which one to act on.

| # | Acceptance Criteria |
| --- | --- |
| 3.1 | BEFORE creating an issue, THE Onboarding_Action SHALL search for an unresolved issue in the configured project carrying the Marker_Label, the same Email_Label_Hash, and the same Tenant_Label — all three matched exactly, so that `acme` never matches `acme-corp`. |
| 3.2 | IF such an issue exists, THEN THE Onboarding_Action SHALL return that issue with `reusedExisting: true` and SHALL NOT create a new issue. |
| 3.3 | IF the search itself fails, THEN THE Onboarding_Action SHALL log a warning and proceed to create a new issue (fail-open), so a failing auxiliary query never blocks a submission. |
| 3.4 | THE search SHALL use `POST /rest/api/3/search/jql`; the removed `/rest/api/3/search` endpoint SHALL NOT be used. |

### Requirement 4: Look up requests by contact email

**User Story:** As a tenant who submitted a request, I want to check its status later without an
account, so that I know whether it has been approved.

| # | Acceptance Criteria |
| --- | --- |
| 4.1 | THE Backstage_App SHALL expose the Lookup_Endpoint, requiring a valid `email` query parameter. |
| 4.2 | THE Lookup_Endpoint SHALL construct its JQL entirely server-side from the configured `projectKey`, the Marker_Label, and the Email_Label_Hash derived from the `email` parameter; it SHALL NOT accept a caller-supplied JQL, filter, or project. |
| 4.3 | THE Lookup_Endpoint SHALL request only the fields `summary`, `status`, `created`, `labels`, cap results at 50, and order by creation date descending. |
| 4.4 | THE Lookup_Endpoint SHALL respond with a list of `{ issueKey, summary, status, created, url }`. |
| 4.5 | IF `email` is missing or not a valid email, THEN THE Lookup_Endpoint SHALL respond 400 without calling Jira. |
| 4.6 | IF Jira is unreachable or returns an error, THEN THE Lookup_Endpoint SHALL respond 502 and SHALL NOT respond with an empty result list. |
| 4.7 | THE Lookup_Endpoint SHALL require a Backstage user credential; Guest_Identity SHALL satisfy it, and unauthenticated callers SHALL be rejected. |

### Requirement 5: Lookup page and identity-aware navigation

**User Story:** As a guest user, I want a page in Backstage where I can find my request, so I do not
need access to Jira.

| # | Acceptance Criteria |
| --- | --- |
| 5.1 | THE Backstage_App SHALL provide the Lookup_Page with an email input, a submit control, and a results table. |
| 5.2 | THE Lookup_Page SHALL render distinct loading, empty, and error states, and SHALL NOT render the empty state when the lookup failed. |
| 5.3 | THE Lookup_Page SHALL reach the Lookup_Endpoint through the Backstage discovery and fetch APIs, and SHALL NOT contain a Jira URL or credential. |
| 5.4 | WHEN the signed-in identity is Guest_Identity, THE Backstage_App SHALL surface onboarding navigation (create request, look up requests). |
| 5.5 | WHEN the signed-in identity is a Microsoft_Identity, THE Backstage_App SHALL surface provisioning navigation instead. |

### Requirement 6: Enforce flow separation

**User Story:** As a platform owner, I want guests to be unable to trigger infrastructure
provisioning, so that an anonymous visitor cannot open pull requests against the live repository or
cause Azure spend.

| # | Acceptance Criteria |
| --- | --- |
| 6.1 | THE Backstage_App SHALL replace `@backstage/plugin-permission-backend-module-allow-all-policy` with the Flow_Policy. |
| 6.2 | THE Flow_Policy SHALL classify the requesting user as guest exactly when the user entity ref equals Guest_Identity. |
| 6.3 | FOR Guest_Identity, THE Flow_Policy SHALL restrict `catalog.entity.read` so that `Template` entities are visible only when `spec.type` is `onboarding`, while non-`Template` entities stay readable. |
| 6.4 | FOR Guest_Identity, THE Flow_Policy SHALL restrict `scaffolder.template.parameter.read` and `scaffolder.template.step.read` to templates tagged `onboarding`. |
| 6.5 | FOR Guest_Identity, THE Flow_Policy SHALL restrict `scaffolder.action.execute` to the Onboarding_Action, so that a guest-triggered provisioning task fails at its first step and produces no pull request. |
| 6.6 | FOR a Microsoft_Identity, THE Flow_Policy SHALL allow the permissions in 6.3–6.5, preserving today's provisioning behaviour. |
| 6.7 | THE Flow_Policy SHALL return an allow decision for every permission it does not explicitly govern, so unrelated app functionality is unaffected. |
| 6.8 | THE Provisioning_Template SHALL be tagged `provisioning`. |

### Requirement 7: Configuration and secret handling

**User Story:** As a Backstage operator, I want Jira credentials supplied through the environment so
that no secret is committed and misconfiguration fails loudly.

| # | Acceptance Criteria |
| --- | --- |
| 7.1 | THE Backstage_App SHALL read Jira settings from a `tenantOnboarding.jira` block in `app-config.yaml` whose values are `${ENV_VAR}` references: `baseUrl`, `email`, `apiToken`, `projectKey`, and optional `issueType` (default `Task`). |
| 7.2 | THE new backend package SHALL declare this block in a `config.d.ts`, marking `apiToken` with `@visibility secret`. |
| 7.3 | IF any required Jira setting is absent, THEN the failure SHALL name the missing configuration key. |
| 7.4 | THE Backstage_App SHALL NOT log `JIRA_API_TOKEN`, the Basic authentication header, or any derivative of them, in any log level or error message. |
| 7.5 | THE Backstage_App SHALL NOT log `contactEmail`, `contactName`, or `purpose`; operational logs SHALL be limited to non-personal values such as project key, issue key, and `reusedExisting`. |
| 7.6 | THE new environment variables SHALL be documented in `README.md` and added to `.env.example` with placeholder values only. |

### Requirement 8: Error handling

**User Story:** As a tenant or operator hitting a failure, I want a message that tells me what went
wrong, so that I am not left guessing between a typo and an outage.

| # | Acceptance Criteria |
| --- | --- |
| 8.1 | WHEN Jira responds 401 or 403, THE Backstage_App SHALL report a credential/authorization failure. |
| 8.2 | WHEN Jira responds 400, THE Backstage_App SHALL surface the offending field names from the Jira error body (for example an `issueType` absent from the project). |
| 8.3 | WHEN Jira responds 404, THE Backstage_App SHALL report that the project or endpoint does not exist. |
| 8.4 | WHEN Jira responds 429, THE Backstage_App SHALL report rate limiting and SHALL NOT retry automatically. |
| 8.5 | WHEN Jira responds 5xx or does not respond, THE Backstage_App SHALL report a transient failure; every Jira request SHALL carry a timeout so no scaffolder task hangs indefinitely. |
| 8.6 | No error message surfaced to a user or written to a log SHALL contain credential material. |

### Requirement 9: Testing

**User Story:** As a maintainer, I want the suite to pass without network access, so that tests keep
working after the Jira trial expires.

| # | Acceptance Criteria |
| --- | --- |
| 9.1 | No test SHALL perform a network call; the Jira_Client SHALL accept an injected `fetch` implementation. |
| 9.2 | THE suite SHALL include a property test asserting that for every email input the email-derived lookup key embedded in JQL consists only of hexadecimal characters, and that for every accepted `tenantName` the Tenant_Label consists only of `[a-z0-9-]` — demonstrating that no submitted value can alter JQL syntax. |
| 9.3 | THE suite SHALL include a property test asserting that every valid submission maps to a well-formed description containing all seven field values. |
| 9.4 | THE suite SHALL cover each Jira failure branch of Requirement 8, including an assertion that credential material never appears in the resulting message. |
| 9.5 | THE suite SHALL cover the Flow_Policy for both identities across the permissions in Requirement 6, asserting both allow and restricted outcomes. |
| 9.6 | THE suite SHALL cover the Lookup_Endpoint responses of Requirement 4 and the Lookup_Page states of 5.2. |
| 9.7 | Manual verification SHALL confirm, before the feature is considered done, that a guest can submit and look up a request, that a guest cannot open the Provisioning_Template, and that a Microsoft user can still complete provisioning. |

## Out of scope

The following are deliberately excluded from this POC:

- Automated Azure subscription creation and automated Entra ID invitation (steps 2 and 3 of the
  onboarding diagram) — performed manually after approval.
- Any Jira webhook or polling that pushes status changes back into Backstage.
- Notifications or email to the requester.
- A database table for requests; pagination beyond the first 50 results.
- Jira Forms API and per-field Jira custom fields.
- Defences against email enumeration on the Lookup_Page.

## Known limitations

- **Lookup is as secret as an email address.** Anyone who knows a contact email can see that
  contact's requests, and emails can be guessed. This follows directly from identifying requests by
  email while the submitter is anonymous.
- **Guest sign-in is development-only.** The guest provider refuses to operate outside
  `NODE_ENV=development` unless `auth.providers.guest.dangerouslyAllowOutsideDevelopment` is set.
  Running this flow in a real environment therefore requires revisiting how a user without an
  account is identified, rather than enabling that flag.
