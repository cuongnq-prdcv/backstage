# Implementation Plan: tenant-onboarding-jira

> **For agentic workers:** implement this plan task-by-task, in order. Steps use checkbox
> (`- [ ]`) syntax for tracking. **Do not create git commits** — the human commits manually
> (see Notes).

**Goal:** Let a guest submit a tenant onboarding request in Backstage that lands as a Jira issue for
manual approval, and let them look that request up later by contact email.

**Architecture:** The write path reuses the scaffolder (a `Template` entity plus a custom action), so
no form UI is written. One new backend package holds the Jira client, field mapping, lookup-key
derivation, the action, and a lookup endpoint. One new frontend package holds the lookup page. A
custom permission policy replaces `allow-all-policy` so a guest cannot run the provisioning template.
Jira is the only store — there is no database table.

**Tech Stack:** Backstage new backend system (`@backstage/backend-plugin-api`), new frontend system
(`@backstage/frontend-plugin-api`, `PageBlueprint`), `@backstage/plugin-scaffolder-node`, zod, Jira
Cloud REST API v3, Jest + `@backstage/backend-test-utils` + `fast-check` + `supertest`.

**Spec:** `.kiro/specs/tenant-onboarding-jira/requirements.md` and
`.kiro/specs/tenant-onboarding-jira/design.md`

## Global Constraints

- Jira endpoints: `POST /rest/api/3/issue` to create, `POST /rest/api/3/search/jql` to search.
  `/rest/api/3/search` has been **removed** from Jira Cloud and must never be used. The search
  response paginates with `nextPageToken` and carries **no** `total`.
- The v3 `description` field requires **Atlassian Document Format** (ADF), not plain text.
- Labels on every created issue: `tenant-onboarding`, `onb-<sha256(email)[0..15]>`,
  `onb-tenant-<tenantName>`.
- `tenantName` pattern, identical to the provisioning template:
  `^[a-z0-9]([a-z0-9-]{1,20})[a-z0-9]$`.
- `environment` enum: `dev`, `staging`, `prod`. `location` enum: `japaneast`, `japanwest`,
  `southeastasia`.
- Guest identity is exactly `user:development/guest`. Microsoft identity is
  `user:default/<email-local-part>`.
- Config block `tenantOnboarding.jira` with `${ENV_VAR}` references only: `JIRA_BASE_URL`,
  `JIRA_USER_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY`. `apiToken` is declared
  `@visibility secret`.
- Never log the API token, the Basic auth header, `contactEmail`, `contactName`, or `purpose`.
- No test may perform a network call; the Jira client takes an injected `fetch`.
- Per `AGENTS.md`: scaffold packages with `yarn new`, add dependencies with
  `yarn workspace <pkg> add ...` — never hand-edit `package.json`.

## File Structure

| File | Responsibility |
| --- | --- |
| `plugins/platform-tenant-onboarding-backend/config.d.ts` | Config schema; `apiToken` marked secret |
| `.../src/lib/config.ts` | Read + validate `tenantOnboarding.jira`, fail naming the missing key |
| `.../src/lib/lookupKey.ts` | `emailLabelHash`, `tenantLabel` — pure derivations |
| `.../src/lib/jql.ts` | Build the duplicate-check and lookup JQL strings |
| `.../src/lib/fieldMapping.ts` | Submission → Jira payload (summary, ADF description, labels) |
| `.../src/lib/jiraClient.ts` | HTTP to Jira; injected `fetch`; error translation |
| `.../src/actions/createJiraIssue.ts` | Action `onboarding:create-jira-issue` |
| `.../src/router.ts` | `GET /requests?email=` |
| `.../src/plugin.ts` | Backend plugin `tenant-onboarding` (default export) |
| `.../src/module.ts` | Scaffolder module registering the action (named export) |
| `plugins/platform-tenant-onboarding/src/plugin.tsx` | Frontend plugin + `PageBlueprint` |
| `.../src/api/OnboardingApi.ts` | Typed client for the lookup endpoint |
| `.../src/components/LookupPage.tsx` | Email input, results table, loading/empty/error |
| `templates/tenant-onboarding/template.yaml` | The form |
| `packages/backend/src/modules/permission/flowPolicy.ts` | Guest vs Microsoft permission policy |
| `packages/backend/src/modules/permission/index.ts` | Backend module exporting the policy |

## Tasks

- [x] 1. Scaffold the backend package and stub the modules
  - Ran `backstage-cli new --select backend-plugin --option pluginId=platform-tenant-onboarding
    --license UNLICENSED` → `plugins/platform-tenant-onboarding-backend/`, package
    `@internal/backstage-plugin-platform-tenant-onboarding-backend`, **`pluginId: 'platform-tenant-onboarding'`**
    (not `tenant-onboarding` — the scaffolder derives the HTTP path from this, so the lookup
    endpoint is `/api/platform-tenant-onboarding/requests`, not `/api/tenant-onboarding/requests`
    as an earlier draft of this plan assumed. Task 8, Task 12/13, and Task 16 below use the
    corrected path).
  - Removed the generated `TodoListService` sample (`src/services/`, its tests, and the sample
    `dev/index.ts` catalog mock) — not part of this feature.
  - Runtime deps: `@backstage/backend-plugin-api`, `@backstage/plugin-scaffolder-node`, `express`,
    `express-promise-router`, `zod`, `@backstage/errors`, `@backstage/types` (the last two came
    from the generated `router.ts`/`plugin.ts` and are still used).
    **Correction to this plan:** `express-promise-router` was missing from the dependency list
    above; it is required by `router.ts` and has been added.
  - Dev deps: `@backstage/backend-test-utils`, `@backstage/plugin-scaffolder-backend`, `fast-check`,
    `@backstage/backend-defaults` (needed only by `dev/index.ts`'s local harness).
  - Added `"configSchema": "config.d.ts"` to `package.json` and created a stub `config.d.ts`.
  - Stub files created, each throwing `not implemented (Task N)` or `NotYetImplemented` until their
    task lands: `src/lib/config.ts`, `src/lib/lookupKey.ts`, `src/lib/jql.ts`,
    `src/lib/fieldMapping.ts`, `src/lib/jiraClient.ts`, `src/actions/createJiraIssue.ts`,
    `src/router.ts`, `src/plugin.ts`, `src/module.ts`.
  - `createJiraIssueAction`'s stub schema uses the scaffolder's per-field
    `{ fieldName: z => ZodType }` shape (confirmed against
    `renderCrossplaneManifest.ts`) — **not** a single `z.object({...})` passed to `schema.input`,
    which does not typecheck against `createTemplateAction`.
  - `src/index.ts` exports `platformTenantOnboardingPlugin` as default and
    `scaffolderModuleTenantOnboarding` as a named export.
  - Verified: `yarn tsc` (root) — 0 errors. `yarn workspace @internal/backstage-plugin-platform-tenant-onboarding-backend lint` — clean.
  - _Requirements: 2.1, 4.1_

- [x] 2. Implement config reading and the config schema
  - [x] 2.1 Write the failing tests in `src/__tests__/lib/config.test.ts`
  - [x] 2.2 Implement `readTenantOnboardingConfig(config: RootConfigService): JiraConfig`
  - [x] 2.3 Add `config.d.ts`
  - [x] 2.4 Run the tests and confirm they pass — 12/12 green
    (`CI=true yarn workspace @internal/backstage-plugin-platform-tenant-onboarding-backend test --testPathPatterns config.test.ts`;
    `CI=true` is required — the package's `test` script watches by default when
    run in a terminal and otherwise hangs.)
  - _Requirements: 7.1, 7.2, 7.3_

- [x] 3. Implement the lookup-key derivations and JQL builders
  - [x] 3.1 Write the failing tests in `src/__tests__/lib/lookupKey.property.test.ts`
  - [x] 3.2 Implement `src/lib/lookupKey.ts`
  - [x] 3.3 Write the failing tests in `src/__tests__/lib/jql.test.ts`
    (Correction: the "safe characters" regex must be `/^[A-Za-z0-9 ="_.-]+$/` —
    a literal `-` inside a character class must be first/last/escaped, not
    between `_` and `.`, or the regex itself fails to compile.)
  - [x] 3.4 Implement `src/lib/jql.ts` with `buildLookupJql` and `buildDuplicateCheckJql`
  - [x] 3.5 Run the tests and confirm they pass — 5/5 (lookupKey) + 4/4 (jql) green
  - _Requirements: 3.1, 3.4, 4.2, 4.3, 9.2_

- [x] 4. Implement the field mapping to a Jira payload
  - [x] 4.1 Write the failing tests in `src/__tests__/lib/fieldMapping.property.test.ts`
    - Added 4 tests: 2 property tests with 200 runs each, plus summary/project/issue-type and exact
      ADF paragraph/text-node shape tests.
    - RED verified: all 4 tests failed against the `not implemented (Task 4)` stub.
  - [x] 4.2 Implement `src/lib/fieldMapping.ts`
    - Added the extensible `FIELD_ORDER` list, ADF `{ type: 'doc', version: 1 }` root, seven
      paragraph/text nodes, `[Onboarding] <tenantName> — <organization>` summary, configured
      project/issue type fields, and labels `[tenant-onboarding, email hash, tenant label]`.
  - [x] 4.3 Run the tests and confirm they pass
    - Targeted: 4/4 passed.
    - Package: 4 suites / 25 tests passed with `timeout 120 env CI=true ... test --runInBand`.
    - Typecheck: `timeout 120 yarn tsc` exited 0.
    - Lint: `timeout 120 yarn workspace @internal/backstage-plugin-platform-tenant-onboarding-backend lint` exited 0.
  - _Requirements: 1.8, 2.3, 2.4, 9.3_

- [x] 5. Implement the Jira client
  - [x] 5.1 Write the failing tests in `src/__tests__/lib/jiraClient.test.ts`
    - Added 9 offline tests covering issue creation, v3 JQL search, Basic auth, request body/URL,
      401/403/400/404/429/500, timeout, no retry, and credential redaction.
    - RED verified: all 9 tests failed against the `not implemented (Task 5)` stub.
    - Jest 30 typing correction: use a `mockFetch()` helper cast to
      `jest.MockedFunction<typeof fetch>`; `jest.fn<typeof fetch>()` accepts 0 or 2 generic args,
      not one.
  - [x] 5.2 Implement `src/lib/jiraClient.ts`
    - `createJiraClient({ config, fetchImpl = fetch, timeoutMs = 10_000 })` with injected fetch,
      `POST /rest/api/3/issue`, `POST /rest/api/3/search/jql`, Basic auth, JSON headers, and
      `AbortSignal.timeout`.
    - Safe error translation: 401/403 credentials, 400 field names only, 404 project/endpoint,
      429 rate limit without retry, 5xx temporary outage, abort timeout. Credentials and response
      values are never interpolated into errors.
  - [x] 5.3 Run the tests and confirm they pass
    - Targeted Jira client: 9/9 passed.
    - Full package: 5 suites / 34 tests passed.
    - Typecheck: `timeout 120 yarn tsc` exited 0.
    - Lint: `timeout 120 yarn workspace @internal/backstage-plugin-platform-tenant-onboarding-backend lint` exited 0.
    - All test commands use `timeout` and `CI=true` to avoid Jest watch-mode hangs.
  - _Requirements: 2.2, 3.4, 4.3, 4.4, 7.4, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 9.1, 9.4_

- [x] 6. Checkpoint — all library tests green
  - `yarn tsc` (root): exit 0.
  - Full package: 5 suites / 34 tests passed
    (`timeout 120 env CI=true yarn workspace @internal/backstage-plugin-platform-tenant-onboarding-backend test --runInBand`).

- [x] 7. Implement the scaffolder action and register it
  - [x] 7.1 Write the failing tests in `src/__tests__/actions/createJiraIssue.test.ts`
    - 6 tests: action id, create-when-no-duplicate (+ JQL uses the three labels), reuse-existing,
      fail-open on search error, invalid-input-before-any-call, and no PII in logs. RED verified.
  - [x] 7.2 Implement `src/actions/createJiraIssue.ts`
    - zod input schema + hand validation (`tenantName` pattern, email, `environment`/`location`
      enums, non-empty strings) before any Jira call; duplicate check via
      `buildDuplicateCheckJql` wrapped in try/catch (fail-open); reuse vs create; outputs
      `issueKey`/`issueUrl`/`issueId`/`reusedExisting`.
    - Uses `ctx.logger` (task-scoped) and logs only `{ projectKey, issueKey/reusedExisting }` — never
      `contactEmail`, `contactName`, or `purpose`.
  - [x] 7.3 Implement `src/module.ts` — already created in Task 1; verified action id and wiring.
  - [x] 7.4 Write `src/__tests__/module.test.ts` — asserts the action id `onboarding:create-jira-issue`
    and that the module attaches to the `scaffolder` plugin.
  - [x] 7.5 Run the tests and confirm they pass
    - Targeted action+module: 8/8 passed.
    - Full package: 7 suites / 42 tests passed.
    - Typecheck: `yarn tsc` exit 0. Lint: package lint exit 0.
  - _Requirements: 2.1, 2.5, 2.6, 2.7, 3.1, 3.2, 3.3, 7.5_

- [x] 8. Implement the lookup endpoint and the backend plugin
  - [x] 8.1 Write the failing tests in `src/__tests__/router.test.ts`
    - 5 supertest cases: 400 missing email, 400 malformed email (no Jira call), 200 mapped list,
      502 on Jira failure (not an empty list), and caller-supplied jql/project/maxResults ignored.
      RED verified.
  - [x] 8.2 Implement `src/router.ts`
    - `GET /requests`: `httpAuth.credentials(req, { allow: ['user'] })`, email validation (400),
      server-built `buildLookupJql`, fixed fields `['summary','status','created','labels']` and
      `maxResults: 50`; Jira error → 502 with a non-empty error body.
  - [x] 8.3 Implement `src/plugin.ts` — created in Task 1; deps rootConfig/logger/httpAuth/httpRouter,
    `httpRouter.use(await createRouter(...))`, default-exported from `src/index.ts`.
  - [x] 8.4 Run the tests and confirm they pass
    - Targeted router: 5/5 passed.
    - Full package: 8 suites / 47 tests passed.
    - Typecheck: `yarn tsc` exit 0. Lint: package lint exit 0.
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 9.6_

- [x] 9. Wire the backend, configuration, and documentation
  - [x] 9.1 Register both features in `packages/backend/src/index.ts`
    - Added `scaffolderModuleTenantOnboarding` (named import) next to the scaffolder module lines,
      and the plugin `import('@internal/backstage-plugin-platform-tenant-onboarding-backend')` near
      the provisioning plugin. The workspace dependency was already added in Task 1.
  - [x] 9.2 Add the `tenantOnboarding.jira` block to `app-config.yaml` (near `crossplaneProvisioning`),
    all values `${ENV_VAR}` references, `issueType: Task` default, with a convention comment.
  - [x] 9.3 Document the four new env vars — added `JIRA_*` rows to the README table and placeholder
    entries to `.env.example` (no real values).
  - [x] 9.4 Verify the config schema
    - `backstage-cli config:check --lax --config app-config.yaml` (with placeholder `JIRA_*` env)
      loaded cleanly — the `tenantOnboarding.jira` block validates and no unknown key is reported.
    - Backend lint exit 0; `yarn tsc` exit 0.
  - _Requirements: 7.1, 7.2, 7.3, 7.6_

- [x] 10. Add the onboarding template and register its location
  - [x] 10.1 Write the failing test in `src/__tests__/template.test.ts`
    - 9 assertions: kind/type/tag, the seven required fields, `tenantName` pattern, environment/
      location enums, email/textarea widgets, single `createJiraIssue` step, field forwarding, no
      infra action, and Jira issue on the result screen. RED verified.
    - Path correction: `REPO_ROOT` is `../../../..` from `src/__tests__/` (package sits two levels
      under the repo root), matching the provisioning template test.
  - [x] 10.2 Write `templates/tenant-onboarding/template.yaml` — seven fields, single camelCase
    `createJiraIssue` step, result links/text pointing at the Jira issue and the lookup page.
  - [x] 10.3 Register the location in `app-config.yaml` under `catalog.locations`.
  - [x] 10.4 Run the test and confirm it passes
    - Template: 9/9 passed. Full package: 9 suites / 56 tests passed.
    - `config:check --lax` still loads cleanly with the new location.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

- [x] 11. Implement the flow permission policy
  - [x] 11.1 Write the failing tests in `packages/backend/src/__tests__/modules/permission/flowPolicy.test.ts`
    - 11 cases: guest gets CONDITIONAL for catalog.entity.read (IS_ENTITY_KIND + HAS_SPEC + onboarding),
      template param/step read (HAS_TAG onboarding), action.execute (HAS_ACTION_ID
      onboarding:create-jira-issue), ALLOW for unrelated; Microsoft ALLOW for all; no-user ALLOW.
      RED verified.
    - Assertion correction: serialized rule names are UPPER_SNAKE (`HAS_TAG`, `HAS_ACTION_ID`,
      `IS_ENTITY_KIND`, `HAS_SPEC`), not the camelCase factory names.
  - [x] 11.2 Implement `packages/backend/src/modules/permission/flowPolicy.ts` — `TenantFlowPermissionPolicy`
    with `isGuest` on `user.info.userEntityRef`, ALLOW for non-guest, and the three conditional
    branches (catalog / template read / action execute). Verified imports:
    `catalogConditions`+`createCatalogConditionalDecision` (`plugin-catalog-backend/alpha`),
    `RESOURCE_TYPE_CATALOG_ENTITY` (`plugin-catalog-common/alpha`), scaffolder permissions and
    `RESOURCE_TYPE_*` (`plugin-scaffolder-common/alpha`), scaffolder condition factories
    (`plugin-scaffolder-backend/alpha`).
  - [x] 11.3 Implement `packages/backend/src/modules/permission/index.ts` —
    `permissionModuleTenantFlowPolicy`, `pluginId: 'permission'`, deps `policyExtensionPoint`,
    `policy.setPolicy(new TenantFlowPermissionPolicy())`.
  - [x] 11.4 Swap the policy in `packages/backend/src/index.ts` — removed the allow-all import/add,
    added `permissionModuleTenantFlowPolicy`, and ran
    `yarn workspace backend remove @backstage/plugin-permission-backend-module-allow-all-policy`.
    Added deps `@backstage/plugin-scaffolder-common` and `@backstage/plugin-catalog-common`.
  - [x] 11.5 Added `tags: [provisioning]` to the provisioning template and extended its test.
  - [x] 11.6 Run the tests and confirm they pass
    - Flow policy: 11/11. Provisioning template (with tag): 10/10.
    - Full backend suite: 4 suites / 40 tests passed. Backend lint exit 0. `yarn tsc` exit 0.
    - `config:check --lax` still loads cleanly after removing allow-all from `index.ts`.
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 9.5_

- [x] 12. Scaffold the frontend package and its API client
  - [x] 12.1 Scaffolded via `backstage-cli new --select frontend-plugin --option pluginId=platform-tenant-onboarding`
    → `plugins/platform-tenant-onboarding/`. Removed the generated Todo sample. Added
    `@backstage/core-plugin-api`.
  - [x] 12.2 Write the failing tests in `src/__tests__/api/OnboardingApi.test.ts` — URL-encoded email
    request against `/api/platform-tenant-onboarding/requests`, and a lookup-failed error on non-ok.
    RED verified.
  - [x] 12.3 Implement `src/api/OnboardingApi.ts` — `OnboardingRequestSummary`, `OnboardingApi`,
    `onboardingApiRef`, `DefaultOnboardingApi` from `discoveryApiRef` + `fetchApiRef`, URL-encoding
    the email.
    - Also rewrote `src/plugin.tsx` to the new frontend system: an `ApiBlueprint` registering
      `DefaultOnboardingApi`. **`ApiBlueprint.make` requires the callback form**
      `params: defineParams => defineParams(createApiFactory({...}))`, not a bare factory.
  - [x] 12.4 Run the tests and confirm they pass
    - API client: 2/2 passed. `yarn tsc` exit 0. Frontend lint exit 0.
  - _Requirements: 5.3_

- [x] 13. Implement the lookup page
  - [x] 13.1 Write the failing tests in `src/__tests__/components/LookupPage.test.tsx`
    - 5 cases: initial (field, no table), success rows, empty state, error-not-empty, and a pending
      progress indicator. RED verified.
    - Assertion corrections: match the exact `No requests found` title (the Header subtitle also
      contains "onboarding requests"); `ResponseErrorPanel` renders the message in multiple nodes so
      use `getAllByText`; the progress indicator is awaited with `findByRole('progressbar')`.
  - [x] 13.2 Implement `src/components/LookupPage.tsx` — `idle | loading | success | error` state
    machine so an empty `success` and an `error` render distinctly (EmptyState vs ResponseErrorPanel);
    email `TextField` (with `aria-label`), Look up button, and a `Table` of Key/Summary/Status/Created.
    Added `@material-ui/core@^4`.
  - [x] 13.3 Implement the page extension in `src/plugin.tsx` — `PageBlueprint` at
    `/tenant-onboarding/requests` titled "Onboarding requests", plus the API blueprint.
  - [x] 13.4 Wire it into the app — added the workspace dep and the plugin to `packages/app/src/App.tsx`
    `features`.
  - [x] 13.5 Run the tests and confirm they pass
    - Page: 5/5. Frontend package: 2 suites / 7 tests passed. `yarn tsc` exit 0. Frontend lint exit 0.
  - _Requirements: 5.1, 5.2, 5.3, 9.6_

- [x] 14. Make the sidebar identity-aware
  - [x] 14.1 Write the tests in `packages/app/src/__tests__/modules/nav/Sidebar.test.tsx`
    - The flow decision is extracted into the pure `selectFlowNavItems(userEntityRef)` and tested
      directly: guest → onboarding entries, Microsoft → provisioning entry, unknown → none.
    - Design note: an earlier attempt asserted on the rendered `SidebarItem` DOM (by text, then by
      `href`), but its output depends on sidebar open-state context and pulls in the notifications/
      search APIs, so the behaviour is asserted on the pure function instead; full-sidebar rendering
      is left to the Task 16 manual check.
  - [x] 14.2 Modify `packages/app/src/modules/nav/Sidebar.tsx`
    - `AppSidebar` reads the identity via `identityApiRef` + `useEffect`/`useState` (no new
      `react-use` dependency), renders neither flow while loading, then maps `selectFlowNavItems`
      to `SidebarItem`s. `SidebarContent` (the `NavContentBlueprint`) delegates to `AppSidebar`.
    - The `navItems` parameter is typed `any` at this single framework boundary (its blueprint type
      is a function type that does not index cleanly).
  - [x] 14.3 Run the tests and confirm they pass
    - Sidebar: 5/5 (3 pure + earlier smoke, trimmed to the pure suite). Full app: 3 suites / 9 tests
      passed. `yarn tsc` exit 0. App lint exit 0.
  - _Requirements: 5.4, 5.5_

- [x] 15. Checkpoint — whole repo green
  - `yarn tsc` — exit 0.
  - `yarn lint:all` — exit 0. (Fixed: `platform-tenant-onboarding-backend` was missing a `yaml`
    devDependency used by `template.test.ts`; `lint:all` caught it via `no-undeclared-imports`
    where the per-package lint had not.)
  - `yarn test:all` — 26 suites / 164 tests passed across 5 projects, exit 0. No regression from
    replacing `allow-all-policy` (the provisioning and auth suites still pass).

- [ ] 16. Manual verification against a real Jira project
  - Prerequisites in Jira Cloud: a project exists, its key is in `JIRA_PROJECT_KEY`, and the issue type
    named in `issueType` (default `Task`) exists in that project. Create an API token and put the four
    variables in `.env`.
  - [ ] 16.1 `yarn start`, sign in as guest, open the onboarding template, submit a request → the
    result screen shows an issue key and link; the issue exists in Jira with the three labels and a
    description containing all seven values.
  - [ ] 16.2 Submit the same tenant name and email again → the same issue key comes back and no second
    issue appears in Jira.
  - [ ] 16.3 Open `/tenant-onboarding/requests`, enter the contact email → the request is listed with
    its current status. Change the issue's status in Jira and re-run the lookup → the new status shows.
  - [ ] 16.4 Still as guest, confirm the provisioning template is not listed. Then call the scaffolder
    API directly to start a provisioning task and confirm it fails at the first step with no pull
    request created.
  - [ ] 16.5 Sign in with Microsoft and run the provisioning template end to end → a pull request is
    opened as before. **This is the regression check for replacing `allow-all-policy`.**
  - [ ] 16.6 Stop the Jira connection (revoke the token or point `JIRA_BASE_URL` at an unreachable
    host) and confirm the lookup page shows an error state, not an empty list.
  - _Requirements: 9.7_

## Notes

- **No commits in this plan.** The human commits manually, so no task ends with a `git commit` step.
  This deviates from the writing-plans default of frequent commits, at the human's explicit request.
- **Bottom-up order is deliberate.** Pure modules (config, lookup key, JQL, field mapping) come first
  because everything else consumes their exact signatures; the Jira client follows; the action and
  router are assembled last. Tasks 1–8 touch only the new backend package, so nothing in the running
  app changes until Task 9.
- **Task 11 is the risky one.** Replacing `allow-all-policy` changes authorization for the whole app.
  It is deliberately placed after the onboarding flow works, so that if something regresses the cause
  is unambiguous. Task 16.5 is its regression check.
- **Fail-open is intentional** in the duplicate check (Task 7.2): a failing auxiliary search must not
  block a submission.
- **Never use `/rest/api/3/search`** — removed from Jira Cloud. Task 5.1 asserts this.
- Jira free-trial expiry only affects Task 16. Every automated test uses an injected `fetch`.

## Task Dependency Graph

```
1 (scaffold)
├── 2 (config) ──┐
├── 3 (keys/JQL) ─┤
└── 4 (mapping) ──┴──> 5 (Jira client) ──> 6 (checkpoint)
                                            ├──> 7 (action + module) ──┐
                                            └──> 8 (router + plugin) ──┴──> 9 (wire backend)
                                                                              │
                                                              10 (template) <─┘
                                                                              │
                                                              11 (policy) <───┘
                                                                              │
                                        12 (frontend api) ──> 13 (page) <─────┘
                                                                │
                                                              14 (sidebar)
                                                                │
                                                              15 (repo green) ──> 16 (manual)
```

Tasks 2, 3, and 4 are independent of each other and can be done in any order (or in parallel).
Task 12 can start any time after Task 8 defines the response shape.
