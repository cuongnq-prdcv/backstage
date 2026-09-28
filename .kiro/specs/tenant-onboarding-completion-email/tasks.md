# Implementation Plan: tenant-onboarding-completion-email

> **For agentic workers:** implement this plan task-by-task, in order. Steps use checkbox
> (`- [ ]`) syntax for tracking. **Do not create git commits** — the human commits manually.

**Goal:** When an onboarding Jira issue transitions to Done, a Jira Automation webhook makes
Backstage verify the issue, parse its onboarding values, and email the contact that their tenant is
ready.

**Architecture:** Extend `plugins/platform-tenant-onboarding-backend` with a second, shared-secret
router; add SMTP config + a nodemailer mailer; add `jiraClient.getIssue` and an ADF parser symmetric
with the existing description builder. Jira stays the only store; no dedupe (POC).

**Tech Stack:** Backstage new backend system, `express-promise-router`, `nodemailer`, zod (existing),
Jira Cloud REST API v3, `crypto.timingSafeEqual`, Jest + `@backstage/backend-test-utils` +
`fast-check` + `supertest`.

**Spec:** `.kiro/specs/tenant-onboarding-completion-email/requirements.md` and `design.md`

## Global Constraints

- Never log the webhook secret, SMTP password, `contactEmail`, `contactName`, `purpose`, or email body.
- No test performs a real SMTP or Jira call; the Jira `fetch` and the SMTP transport are injected.
- Verify the issue via `GET /rest/api/3/issue/{key}` — never trust the webhook payload's status.
- The recipient address comes only from the verified issue's parsed description.
- `webhookSecret` and all required `smtp` keys are mandatory; missing → fail fast naming the key.
- Add dependencies with `yarn workspace @internal/backstage-plugin-platform-tenant-onboarding-backend add ...`,
  never by hand-editing `package.json`.
- Run package tests with `CI=true` and a `timeout` to avoid Jest watch-mode hangs.

## Tasks

- [x] 1. SMTP config + schema
  - [x] 1.1 Write failing tests in `src/__tests__/lib/smtpConfig.test.ts` (reads all keys; missing key throws naming it; port coerced to number, NaN rejected).
  - [x] 1.2 Implement `src/lib/smtpConfig.ts` — `readSmtpConfig(config): SmtpConfig`.
  - [x] 1.3 Extend `config.d.ts` with `smtp` block (password secret) and `jira.webhookSecret` (secret) + `jira.doneStatus`.
  - [x] 1.4 Extend `src/lib/config.ts` to read `webhookSecret` (required) and `doneStatus` (default `Done`).
  - [x] 1.5 Run tests — green.
    - config + smtpConfig: 2 suites / 30 tests. Fallout: `webhookSecret` now required, so the mock
      configs in `createJiraIssue`, `router`, `module`, `jiraClient`, `fieldMapping` tests were
      updated. Full package 10 suites / 74 tests; `tsc` 0; package lint 0.
  - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 2. Export FIELD_ORDER + ADF parser
  - [x] 2.1 Export `FIELD_ORDER` from `src/lib/fieldMapping.ts` (no behaviour change).
  - [x] 2.2 Write failing property test `src/__tests__/lib/adfParser.property.test.ts` — round-trip against `buildAdfDescription`; malformed/empty descriptions yield a partial, never throw.
  - [x] 2.3 Implement `src/lib/adfParser.ts` — `parseAdfDescription(description: unknown): Partial<OnboardingSubmission>`.
  - [x] 2.4 Run tests — green.
    - adfParser 5/5 (round-trip 200 runs). Parser walks paragraph→text and splits on the first
      `": "`, so values containing `": "` or newlines round-trip. Fixed a union-indexed-write `tsc`
      error with a `Record<string,string>` cast (sound at runtime). Package 11 suites / 79; tsc/lint 0.
  - _Requirements: 3.1, 3.2_

- [x] 3. Email content
  - [x] 3.1 Write failing tests `src/__tests__/lib/emailContent.test.ts` — subject + body include tenantName/contactName/organization/environment/location/issueUrl; exclude `purpose`.
  - [x] 3.2 Implement `src/lib/emailContent.ts` — `buildCompletionEmail(sub, issueUrl)`.
  - [x] 3.3 Run tests — green.
    - emailContent 4/4. Body is English (per review), HTML-escapes all submitted values. tsc/lint 0.
  - _Requirements: 4.2, 4.3_

- [x] 4. Mailer
  - [x] 4.1 Add `nodemailer` (+ dev `@types/nodemailer`) to the package.
  - [x] 4.2 Write failing tests `src/__tests__/lib/mailer.test.ts` — injected transport receives from/to/subject/text/html; transport error → `Failed to send onboarding email` (no detail).
  - [x] 4.3 Implement `src/lib/mailer.ts` — `createMailer({ config, transportFactory? })`.
  - [x] 4.4 Run tests — green.
    - mailer 3/3 (error assertion checks the safe message leaks no SMTP detail/credentials). tsc/lint 0.
  - _Requirements: 4.1, 6.1_

- [x] 5. jiraClient.getIssue
  - [x] 5.1 Write failing tests in `src/__tests__/lib/jiraClient.test.ts` — GET `/rest/api/3/issue/{key}?fields=status,description`, maps status.name + description, 404/timeout translated.
  - [x] 5.2 Implement `getIssue` + a `requestGet` helper in `src/lib/jiraClient.ts`.
  - [x] 5.3 Run tests — green.
    - jiraClient 13/13 (4 new getIssue cases). Fallout: `FakeClient` in `createJiraIssue`/`router`
      tests gained a `getIssue` stub. Package 13 suites / 90; tsc/lint 0.
  - _Requirements: 2.1, 2.3_

- [x] 6. Webhook router
  - [x] 6.1 Write failing tests `src/__tests__/webhookRouter.test.ts` (supertest, injected fake Jira client + fake mailer): 401 wrong/absent secret, 400 missing key, 200 skip when status ≠ done, 422 missing/invalid email, 200 sent when Done (mailer gets correct to+subject), 502 on Jira failure, 502 on mail failure, wrong-length secret does not crash.
  - [x] 6.2 Implement `src/webhookRouter.ts` — `createWebhookRouter(...)` with `crypto.timingSafeEqual`, `getIssue` verify, `parseAdfDescription`, `EMAIL_PATTERN` validation, mailer send; log only `{ issueKey, outcome }`.
  - [x] 6.3 Run tests — green.
    - webhookRouter 9/9. Package 14 suites / 99 tests; tsc/lint 0.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 3.3, 4.1, 4.4, 4.5, 4.6, 6.1, 6.2_

- [x] 7. Wire config, plugin, docs, checkpoint
  - [x] 7.1 Wire `createWebhookRouter` in `src/plugin.ts` (read smtp config; mount router).
    - Also added `httpRouter.addAuthPolicy({ path: '/jira-webhook', allow: 'unauthenticated' })` so
      Jira (which has no Backstage credential) reaches the handler; the shared secret guards it.
  - [x] 7.2 Add `webhookSecret`, `doneStatus`, and `tenantOnboarding.smtp` to `app-config.yaml` (all `${ENV_VAR}`).
  - [x] 7.3 Add `JIRA_WEBHOOK_SECRET` + `SMTP_*` rows to README and placeholders to `.env.example`.
  - [x] 7.4 Verify: `backstage-cli config:check --lax`, `yarn tsc`, `yarn lint:all`, `yarn test:all` — all green.
    - `config:check --lax` (placeholder JIRA_WEBHOOK_SECRET/SMTP_* env): exit 0. `tsc`: 0. `lint:all`: 0.
      `test:all`: **31 suites / 207 tests passed** across 5 projects, exit 0 — no regression.
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 6.3_

- [x] 8. Manual verification (needs Mailtrap + Jira Automation)
  - [x] 8.1 Create a Mailtrap sandbox inbox; put `SMTP_*` + `SMTP_FROM` and a random `JIRA_WEBHOOK_SECRET` in `.env`.
  - [x] 8.2 Create a Jira Automation rule: trigger "Issue transitioned" (To status = Done); action "Send web request" → `POST <public-url>/api/platform-tenant-onboarding/jira-webhook`, header `X-Onboarding-Token: <secret>`, body `{"issue":{"key":"{{issue.key}}"}}`. Jira Cloud cannot reach `localhost`, so a `cloudflared` quick tunnel exposed `:7007` publicly.
  - [x] 8.3 Moved SCRUM-1 to Done → email landed in Mailtrap. Backend log:
    `Onboarding webhook: completion email sent for SCRUM-1`, HTTP 200, with
    `userAgent="Automation for Jira AC app/1.0;..."` — confirming the call came from real Jira
    Automation, not the earlier curl simulations. SCRUM-2 was also verified the same way.
  - [x] 8.4 Wrong/absent `X-Onboarding-Token` → 401 (seen repeatedly in the backend log); not-done
    issue → 200 `{skipped:'not-done'}` with no email; missing `issue.key` → 400.
  - _Requirements: 7.1_

## Notes

- **No commits in this plan** — the human commits manually.
- **Bottom-up order:** pure libs (config, parser, email, mailer) → `getIssue` → router → wiring, so
  each task consumes the previous signatures; nothing in the running app changes until Task 7.
- **No dedupe by design** (POC). A `onb-notified` label is the natural upgrade if duplicates matter.
- **doneStatus is configurable** because the "Done" status name depends on the Jira project's
  workflow (the reference project SCRUM shows "To Do"/"Done").

## Task Dependency Graph

```
1 (smtp config) ─┐
2 (adf parser) ──┤
3 (email) ───────┤
4 (mailer) ──────┤
5 (getIssue) ────┴──> 6 (webhook router) ──> 7 (wire + checkpoint) ──> 8 (manual)
```

Tasks 1–5 are independent of each other and may be done in any order.
