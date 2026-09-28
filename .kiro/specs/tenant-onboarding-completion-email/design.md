# Design: tenant-onboarding-completion-email

## Overview

When a reviewer moves an onboarding Jira issue to Done, Jira Automation POSTs to a new Backstage
webhook. Backstage authenticates the call with a shared secret, re-fetches the issue from Jira to
confirm it is really Done (never trusting the payload), parses the seven onboarding values back out
of the issue's ADF description, and emails the contact over SMTP (nodemailer) to confirm the tenant
is ready. This is a POC: duplicate emails are accepted, and Mailtrap is the reference SMTP service.

The feature extends the existing backend package `plugins/platform-tenant-onboarding-backend`; it
adds no database and keeps Jira as the only store.

## Flow

```
Jira issue → Done
    │  Jira Automation "Send web request"
    │  POST /api/platform-tenant-onboarding/jira-webhook
    │  header X-Onboarding-Token: <secret>,  body { "issue": { "key": "SCRUM-1" } }
    ▼
webhookRouter
    │ 1. timingSafeEqual(header, webhookSecret)         → mismatch: 401
    │ 2. issue.key is string                            → missing: 400
    │ 3. jiraClient.getIssue(key, ['status','description'])
    │      fetch fails                                   → 502
    │      status.name !≈ doneStatus (ci)               → 200 { skipped:'not-done' }
    │ 4. parseAdfDescription(description) → OnboardingSubmission
    │      contactEmail missing/invalid                 → 422
    │ 5. mailer.sendCompletion(contactEmail,
    │        buildCompletionEmail(submission, issueUrl))
    │      send fails                                    → 502
    ▼
200 { sent: true, issueKey }
```

Every Jira and SMTP call is server-side; no secret reaches the browser.

## File structure

### New

| File | Responsibility |
| --- | --- |
| `src/lib/smtpConfig.ts` | `readSmtpConfig(config): SmtpConfig`; fail naming the missing key. |
| `src/lib/adfParser.ts` | `parseAdfDescription(description: unknown): Partial<OnboardingSubmission>`; symmetric with `buildAdfDescription`. |
| `src/lib/emailContent.ts` | `buildCompletionEmail(sub, issueUrl): { subject, text, html }`. |
| `src/lib/mailer.ts` | `createMailer({ config, transportFactory? }): { sendCompletion(to, content) }`. |
| `src/webhookRouter.ts` | `createWebhookRouter({ config, logger, jiraConfig, clientFactory?, mailerFactory? })`. |
| `src/__tests__/lib/smtpConfig.test.ts` | Reads all keys; missing key throws naming it. |
| `src/__tests__/lib/adfParser.property.test.ts` | Round-trip with `buildAdfDescription`; malformed descriptions. |
| `src/__tests__/lib/emailContent.test.ts` | Contains six values + issueUrl; excludes `purpose`. |
| `src/__tests__/lib/mailer.test.ts` | Injected transport receives from/to/subject; failure translated. |
| `src/__tests__/webhookRouter.test.ts` | 401 / 400 / 200-skip / 422 / 200-sent / 502(Jira) / 502(mail); wrong-length secret does not crash. |

### Modified

| File | Change |
| --- | --- |
| `src/lib/fieldMapping.ts` | Export `FIELD_ORDER` (was internal) so the parser shares the exact label↔key map. |
| `src/lib/jiraClient.ts` | Add `getIssue(key, fields): Promise<{ status: string; description: unknown }>` via `GET /rest/api/3/issue/{key}` (add a `requestGet` helper alongside the POST `request`). |
| `src/lib/config.ts` | Read `webhookSecret` (required) and `doneStatus` (default `Done`) into `JiraConfig`. |
| `config.d.ts` | Declare `webhookSecret` (secret), `doneStatus`, and the `smtp` block (`password` secret). |
| `src/plugin.ts` | Read smtp config; `httpRouter.use(await createWebhookRouter(...))`. |
| `app-config.yaml` | Add `webhookSecret`, `doneStatus`, and `tenantOnboarding.smtp`, all `${ENV_VAR}`. |
| `.env.example`, `README.md` | Add `JIRA_WEBHOOK_SECRET` and `SMTP_*` placeholders + table rows. |
| `package.json` (via `yarn workspace add`) | Add `nodemailer`; dev `@types/nodemailer`. |

**Two routers, one plugin.** `webhookRouter` is separate from the existing `router.ts` because
their auth models differ (shared secret vs Backstage user credential); mixing them risks leaking the
secret path into the lookup path. Same `pluginId`, so both mount under
`/api/platform-tenant-onboarding/`.

## Component contracts

### jiraClient.getIssue

```ts
getIssue(key: string, fields: string[]): Promise<{ status: string; description: unknown }>
// GET /rest/api/3/issue/{key}?fields=status,description
// status = body.fields.status.name (string, '' if absent); description = body.fields.description
// reuses translateError; requestGet mirrors request but method GET, no body
```

### adfParser.parseAdfDescription

Walks `doc.content[].content[].text` looking for `"<Label>: <value>"`, maps `<Label>` → key via the
shared `FIELD_ORDER`, and takes everything after the first `": "` as the value. Returns a `Partial`
(absent fields simply missing). Enum values are returned as raw strings; the router validates
`contactEmail` and does not coerce the enums (the email just echoes them).

Round-trip test: `parseAdfDescription(buildAdfDescription(sub))` deep-equals `sub` for arbitrary
valid submissions (fast-check).

### emailContent.buildCompletionEmail

```ts
buildCompletionEmail(sub: OnboardingSubmission, issueUrl: string): { subject; text; html }
// subject: `[Onboarding] Tenant ${sub.tenantName} đã sẵn sàng`
// body: greet contactName; confirm subscription for tenant (organization/environment/location)
//   created and email invited to Entra ID; next step: sign in to Backstage with Microsoft and run
//   the provisioning template with this tenantName; link to issueUrl.
// MUST NOT include sub.purpose.
```

### mailer.createMailer

```ts
createMailer({ config: SmtpConfig, transportFactory = nodemailer.createTransport }): {
  sendCompletion(to: string, content: { subject; text; html }): Promise<void>
}
// transport = transportFactory({ host, port, secure, auth: { user, pass } })
// sendMail({ from: config.from, to, subject, text, html })
// on error → throw new Error('Failed to send onboarding email') (no SMTP/secret detail)
```

### webhookRouter

Response contract exactly as in the Flow diagram. Secret comparison uses `crypto.timingSafeEqual`
wrapped in try/catch (differing lengths throw; treat as mismatch → 401). Logs only
`{ issueKey, outcome }` where outcome ∈ `sent | skipped | rejected | error`.

## Config

```yaml
tenantOnboarding:
  jira:
    baseUrl: ${JIRA_BASE_URL}
    email: ${JIRA_USER_EMAIL}
    apiToken: ${JIRA_API_TOKEN}      # secret
    projectKey: ${JIRA_PROJECT_KEY}
    issueType: Task
    webhookSecret: ${JIRA_WEBHOOK_SECRET}   # secret; required
    doneStatus: Done                        # optional; default Done
  smtp:
    host: ${SMTP_HOST}
    port: ${SMTP_PORT}
    user: ${SMTP_USER}
    password: ${SMTP_PASSWORD}       # secret
    from: ${SMTP_FROM}
    secure: false                    # optional; default false
```

`port` arrives as a string from env; `readSmtpConfig` coerces to number and rejects NaN.

## Testing strategy

- Pure libs first, TDD (RED before GREEN): `smtpConfig`, `adfParser`, `emailContent`, `mailer`.
- `jiraClient.getIssue`: extend `jiraClient.test.ts` — GET URL + fields query, status/description
  mapping, 404 and timeout translation.
- `webhookRouter.test.ts`: supertest with an injected fake Jira client and fake mailer.
- No test touches real SMTP or Jira; the Jira `fetch` and the SMTP transport are injected.
- Repo checkpoint at the end: `config:check --lax`, `yarn tsc`, `yarn lint:all`, `yarn test:all`.

## Design decisions

**Verify with Jira, don't trust the payload.** A webhook body can be forged or replayed; a cheap
`GET issue` confirms the real status and yields the authoritative description to build the email
from. It also means the recipient address comes from the verified issue, not the caller.

**No idempotency (POC).** Accepted per product decision: each Done event sends one email; a
re-transition or Jira retry may send duplicates. A `onb-notified` label could be added later if
dedupe becomes required.

**Parse ADF rather than add custom fields.** The onboarding action already writes the seven values
into the ADF description. Reversing that (sharing `FIELD_ORDER`) avoids adding Jira custom fields or
a second source of truth; the round-trip test guards the two halves against drift.

**Shared secret over HMAC.** Sufficient for a POC and simple to configure in Jira Automation's
"Send web request" (a static header). Constant-time comparison mitigates timing attacks; HMAC with
replay protection is the upgrade if this leaves POC.

**SMTP via nodemailer + Mailtrap.** nodemailer speaks plain SMTP, so switching from Mailtrap to
Gmail/SendGrid/SES later is a `.env` change with no code change. Mailtrap needs no domain
verification and traps mail in a sandbox inbox, the simplest thing to test against.

## Manual steps (outside code)

1. Mailtrap: create a sandbox inbox, copy host/port/user/pass into `.env` (`SMTP_*`), set `SMTP_FROM`.
2. Set `JIRA_WEBHOOK_SECRET` to a random string in `.env`.
3. Jira Automation rule: trigger "Issue transitioned to Done"; action "Send web request" →
   `POST <backstage-url>/api/platform-tenant-onboarding/jira-webhook`, header
   `X-Onboarding-Token: <JIRA_WEBHOOK_SECRET>`, body `{"issue":{"key":"{{issue.key}}"}}`.
4. Move an onboarding issue to Done and confirm one email lands in Mailtrap.
