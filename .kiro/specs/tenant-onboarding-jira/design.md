# Design Document

## Overview

Tenant onboarding is the flow that runs *before* a tenant has an identity in the organization: a
guest fills in a form in Backstage, the backend files a Jira issue, and a human approves it in Jira.
Creating the Azure subscription and inviting the tenant into Entra ID stay manual.

The feature has five parts:

| # | Part | Requirement |
| --- | --- | --- |
| 1 | Onboarding template (the form) | R1 |
| 2 | Scaffolder action + Jira client (write path) | R2, R3 |
| 3 | Lookup endpoint + lookup page (read path) | R4, R5 |
| 4 | Flow policy replacing allow-all | R6 |
| 5 | Config, secrets, docs | R7 |

The write path reuses the scaffolder machinery already proven by the provisioning feature, so no
form UI has to be written. The only genuinely new logic is the Jira client, the field mapping, the
lookup key derivation, and the permission policy — all four are pure or injectable, hence testable
without network access.

## Module layout

```
plugins/platform-tenant-onboarding-backend/            NEW backend package
  config.d.ts                        tenantOnboarding.jira schema; apiToken @visibility secret
  src/lib/config.ts                  read + validate config, fail fast naming the missing key
  src/lib/jiraClient.ts              Jira Cloud REST v3: createIssue, searchIssues; injected fetch
  src/lib/fieldMapping.ts            7 form fields -> summary + ADF description + labels
  src/lib/lookupKey.ts               email -> Email_Label_Hash (sha256, 16 hex chars)
  src/lib/jql.ts                     build the duplicate-check and lookup JQL strings
  src/actions/createJiraIssue.ts     action onboarding:create-jira-issue
  src/router.ts                      GET /requests
  src/plugin.ts                      backend plugin, pluginId 'tenant-onboarding' (default export)
  src/module.ts                      scaffolder module registering the action (named export)

plugins/platform-tenant-onboarding/                    NEW frontend package
  lookup page: email input + results table + loading/empty/error states

templates/tenant-onboarding/template.yaml              NEW Template entity
packages/backend/src/modules/permission/               NEW Flow_Policy
packages/app/src/modules/nav/                          MODIFIED identity-aware sidebar
templates/tenant-provisioning-crossplane/template.yaml MODIFIED add tags: [provisioning]
packages/backend/src/index.ts                          MODIFIED register new features, drop allow-all
app-config.yaml                                        MODIFIED jira config + catalog location
README.md / .env.example                               MODIFIED new env vars
```

Package names follow the existing convention (`@internal/backstage-plugin-` + directory name), as
with `@internal/backstage-plugin-platform-backend-module-tenant-provisioning-crossplane`.

**Why one backend package holds two backend features.** The action and the router share the Jira
client, the field mapping, and the lookup-key derivation. Splitting them into two packages would
require a third package for the shared code, or duplicated code. They remain two independently
registered features: the plugin is the default export (`backend.add(import('...'))`), the scaffolder
module is a named export added the same way `authModuleMicrosoftProvider` already is.

**Why the policy lives in `packages/backend`.** It governs both flows — onboarding and provisioning
— so it belongs to the backend app rather than to either feature's plugin, mirroring how
`packages/backend/src/modules/auth/` holds the Microsoft provider.

## Research notes (verified against the versions in this repo)

- `scaffolderTemplateConditions.hasTag` and `scaffolderActionConditions.hasActionId` are exported
  from `@backstage/plugin-scaffolder-backend/alpha`, together with
  `createScaffolderTemplateConditionalDecision` / `createScaffolderActionConditionalDecision`.
- Scaffolder permissions available: `templateParameterReadPermission`, `templateStepReadPermission`,
  `actionExecutePermission` (resource-scoped), `taskCreatePermission` (basic), `taskReadPermission`,
  `taskCancelPermission`, `templateManagementPermission`.
- `policyExtensionPoint` is exported from `@backstage/plugin-permission-node/alpha`.
- Catalog permission rules available: `hasAnnotation`, `hasLabel`, `hasMetadata`, `hasSpec`,
  `isEntityKind`, `isEntityOwner`. **There is no `hasTag` rule**, so template filtering keys on
  `spec.type` (a scalar) rather than on `metadata.tags`.
- The guest provider issues `user:development/guest`, and refuses to operate outside
  `NODE_ENV=development` unless `dangerouslyAllowOutsideDevelopment` is set. The repo's Microsoft
  resolver issues `user:default/<email-local-part>`. The two namespaces make identity classification
  a single string comparison.
- **Jira Cloud:** `GET /rest/api/3/search` has been removed; `/rest/api/3/search/jql` replaces it and
  paginates with `nextPageToken` — there is no `startAt` and no `total`. Issue creation is
  `POST /rest/api/3/issue`; the v3 `description` field requires Atlassian Document Format, not plain
  text.
- **Jira Forms:** forms exist only in association with an issue ("form-on-issue association"), and
  creating an issue with a form requires fetching form/field IDs plus an `form` request parameter
  that Atlassian documents as *Experimental*. Not used; see Design Decisions.
- Test tooling already present: `@backstage/backend-test-utils` (`mockServices`), `fast-check`,
  `supertest` (in `packages/backend`). Existing action tests build the action context by hand with a
  `jest.fn()` `output` collector and `mockServices.logger.mock()`, then call `action.handler(ctx)`.

## Architecture

```
guest ──> Backstage: Onboarding_Template form
              │ scaffolder task
              v
        onboarding:create-jira-issue
              │  1. validate input
              │  2. search open duplicate (JQL)        ──> Jira /rest/api/3/search/jql
              │  3. create issue if none               ──> Jira /rest/api/3/issue
              v
        outputs: issueKey, issueUrl, issueId, reusedExisting
              │
              v
        result screen: issue link + key to bookmark

guest ──> Lookup_Page ──> GET /api/platform-tenant-onboarding/requests?email=
                              │ JQL fixed server-side
                              v
                          Jira /rest/api/3/search/jql ──> [{issueKey, summary, status, created, url}]

human reviewer ──> approves in Jira ──> (manual) Azure subscription ──> (manual) Entra ID invite
```

Every Jira call is server-side, so the API token never reaches the browser and no proxy endpoint,
CSP, or CORS change is needed.

### Labels and the lookup key

Every issue carries three labels:

| Label | Value | Purpose |
| --- | --- | --- |
| Marker | `tenant-onboarding` | Identifies onboarding requests |
| Email key | `onb-<sha256(email.trim().toLowerCase()).hex.slice(0,16)>` | Exact-match lookup by contact |
| Tenant key | `onb-tenant-<tenantName>` | Exact-match duplicate detection |

Labels give exact JQL matching without depending on text indexing or on any custom field existing in
the project, so the POC runs against a freshly created Jira project. Both derived labels are
constrained character sets — hexadecimal for the email key, `[a-z0-9-]` for the tenant key (already
enforced by the `tenantName` pattern) — so no submitted value can influence JQL syntax (R9.2). The
email key is hashed rather than literal so the project's label list does not expose the set of
contact emails; the full email still appears in the issue description for reviewers.

Matching the tenant by label rather than by `summary ~ "<tenantName>"` is deliberate: the `~`
operator matches loosely, so `acme` would collide with `acme-corp` and the action would reuse the
wrong issue.

### Flow policy

Classification: `isGuest = user.info.userEntityRef === 'user:development/guest'`.

| Permission | Guest | Microsoft |
| --- | --- | --- |
| `catalog.entity.read` | conditional: `anyOf[ not isEntityKind(['template']), hasSpec(type=onboarding) ]` | allow |
| `scaffolder.template.parameter.read`, `scaffolder.template.step.read` | conditional: `hasTag('onboarding')` | allow |
| `scaffolder.action.execute` | conditional: `hasActionId('onboarding:create-jira-issue')` | allow |
| `scaffolder.task.create` | allow | allow |
| everything else | allow | allow |

`scaffolder.task.create` is a basic permission with no resource attached, so it cannot distinguish
which template a task belongs to and cannot carry the separation. The enforceable boundary is
`scaffolder.action.execute`: a guest who calls the API directly can still create a task for the
provisioning template, but the task fails at its first step and no pull request is opened.

The `catalog.entity.read` condition is what removes the provisioning template from the guest's
view — verified behaviour of catalog filtering, unlike the scaffolder "Create" page, which was not
confirmed to filter templates by permission.

## Components and Interfaces

### `lib/config.ts`

```ts
interface JiraConfig {
  baseUrl: string;      // https://<site>.atlassian.net
  email: string;
  apiToken: string;     // secret
  projectKey: string;
  issueType: string;    // default 'Task'
}
function readTenantOnboardingConfig(config: RootConfigService): JiraConfig;
```

Throws naming the absent key (R7.3). Pattern mirrors `readCrossplaneProvisioningConfig`.

### `lib/jiraClient.ts`

```ts
interface JiraClientOptions { config: JiraConfig; fetchImpl?: typeof fetch; timeoutMs?: number }
interface CreatedIssue { id: string; key: string; url: string }
interface IssueSummary { issueKey: string; summary: string; status: string; created: string; url: string }

interface JiraClient {
  createIssue(payload: JiraIssuePayload): Promise<CreatedIssue>;
  searchIssues(jql: string, fields: string[], maxResults: number): Promise<IssueSummary[]>;
}
```

Basic auth from `email:apiToken`; `AbortSignal.timeout(timeoutMs)` defaulting to 10s; response errors
translated per Requirement 8. `fetchImpl` injection is what keeps tests offline (R9.1).

### `lib/fieldMapping.ts`

```ts
interface OnboardingSubmission {
  tenantName: string; contactEmail: string; contactName: string;
  organization: string; environment: 'dev' | 'staging' | 'prod';
  location: string; purpose: string;
}
function buildIssuePayload(s: OnboardingSubmission, cfg: JiraConfig): JiraIssuePayload;
```

Produces `summary`, an ADF `description` listing all seven values, and the three labels described
under "Labels and the lookup key". This is the single place a new field is added (R1.8).

### `lib/jql.ts`

```ts
function buildDuplicateCheckJql(projectKey: string, emailHash: string, tenantLabel: string): string;
function buildLookupJql(projectKey: string, emailHash: string): string;
```

Lookup: `project = "<key>" AND labels = "tenant-onboarding" AND labels = "<emailHash>" ORDER BY created DESC`.
Duplicate check: the same plus `AND labels = "<tenantLabel>" AND resolution = Unresolved`.

### `actions/createJiraIssue.ts`

Factory `createJiraIssueAction({ config, logger, fetchImpl? })` returning a `createTemplateAction`
with id `onboarding:create-jira-issue`. Sequence: validate → duplicate check (fail-open on error,
R3.3) → create → emit `issueKey`, `issueUrl`, `issueId`, `reusedExisting`. Logs project key, issue
key, and `reusedExisting` only (R7.5).

### `router.ts`

`GET /requests?email=` → validate (400 on missing/invalid) → `buildLookupJql` → `searchIssues(fields:
['summary','status','created','labels'], maxResults: 50)` → map to the response list. Jira failure →
502 (R4.6). Guarded with `httpAuth` `credentials: { allow: ['user'] }`, which guest tokens satisfy.

### Frontend lookup page

Email `TextField`, submit button, `Table` from `@backstage/core-components`, three explicit states.
Backend reached via `discoveryApi` + `fetchApi`. The empty state is never used to represent a failed
lookup, because "you have no requests" is a wrong answer that makes people submit again.

### Sidebar

Reads `identityApi.getBackstageIdentity()`; `user:development/guest` sees onboarding entries, any
other identity sees provisioning entries.

## Error Handling

| Condition | Behaviour |
| --- | --- |
| Missing/invalid config | Fail fast naming the key (R7.3) |
| Invalid action input | Reject before any network call (R2.6) |
| Jira 401/403 | Credential/authorization failure — covers an expired trial or rotated token |
| Jira 400 | Surface offending field names from the Jira error body |
| Jira 404 | Project or endpoint does not exist |
| Jira 429 | Report rate limiting; no automatic retry |
| Jira 5xx / timeout | Transient failure; bounded by the request timeout |
| Duplicate-check failure | Warn and continue creating (fail-open) |
| Lookup failure | 502 from the endpoint; error state in the UI, never the empty state |

No message or log line contains credential material (R8.6, R7.4); no message or log line contains
`contactEmail`, `contactName`, or `purpose` (R7.5).

## Testing Strategy

Offline by construction: the Jira client takes an injected `fetch`.

| Unit | Tests |
| --- | --- |
| `lib/lookupKey.ts`, `lib/jql.ts` | Property: for every email, the label literal in the JQL is hexadecimal only (R9.2); stable hashing across case and surrounding whitespace |
| `lib/fieldMapping.ts` | Property: every valid submission yields well-formed ADF containing all seven values (R9.3) |
| `lib/config.ts` | Each missing key names itself |
| `lib/jiraClient.ts` | Fake fetch: correct URL/method/body/auth header; each failure branch of R8; assertion that the token never appears in a message |
| `actions/createJiraIssue.ts` | `mockServices` + hand-built context (existing pattern): happy path outputs, `reusedExisting`, fail-open on search error, invalid input performs no call |
| `router.ts` | `supertest`: 400 on missing/invalid email, 502 on Jira error, mapped list on success |
| Flow policy | Direct `policy.handle()` calls for both identities across the R6 table, asserting allow and conditional outcomes with their conditions |
| Lookup page | `renderInTestApp` with a mocked API: loading, empty, error; error state is not the empty state |

**Manual verification (R9.7)**, required because replacing allow-all is a silent-regression risk:
guest submits and the issue appears in Jira; lookup by that email returns it; guest cannot open the
provisioning template; a Microsoft user still completes provisioning and opens a pull request.

## Design Decisions and Trade-offs

**Jira as the only store, no database.** The requested capability is "keep the request and check its
status later" — Jira already holds both, and holds them more accurately than a mirror would. A local
table would introduce a synchronisation problem whose classic failure is a row reading `pending`
while the issue is already `done`. Cost accepted: requests do not appear in the Backstage catalog or
database, and lookup depends on Jira being reachable. A table becomes justified when Backstage needs
state Jira does not have — subscription created, Entra ID invited — which is the next phase.

**Core issue fields rather than Jira Forms or custom fields.** Backstage already owns the form
definition in `template.yaml`. Adding a Jira form template would mean two form definitions to keep in
sync by hand, which fails quietly when one side gains a field; and the issue-with-form API parameter
is marked Experimental by Atlassian. Per-field Jira custom fields (the natural upgrade if reviewers
later need to filter or report per field) would tie the POC to seven manually created custom field
IDs. Either upgrade is confined to `fieldMapping.ts`.

**Asymmetric permission policy.** The direction worth enforcing is guest → provisioning, because it
opens pull requests against the live repository and leads to Azure spend. A Microsoft user filing an
onboarding request produces at worst a stray ticket, so no rule is written for it; navigation handles
that direction. Writing both directions would double the policy surface for no reduction in risk.

**Hashed email in a label instead of a custom field or free-text search.** Exact JQL matching with no
Jira configuration prerequisites, no possibility of a submitted value altering JQL syntax, and no
email list exposed in the project's label settings. The tenant is matched by its own label for the
same reason — `summary ~` would let `acme` collide with `acme-corp`. Cost: the labels are not
human-readable, mitigated by the email being present in the description.

**Duplicate check fails open.** A failing auxiliary query degrades into a possible duplicate ticket
rather than into a blocked submission. The inverse choice would turn a minor annoyance into an outage
of the feature's only purpose.

**No pagination.** The replacement Jira search endpoint returns `nextPageToken` instead of a total,
and a tenant has a handful of requests, not fifty. The 50-result cap is stated rather than paged.
