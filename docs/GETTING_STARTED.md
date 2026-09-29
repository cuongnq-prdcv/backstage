# Getting Started

Install, run, and (optionally) test the Jira onboarding-completion webhook locally.

Steps 4–5 (Cloudflare tunnel + Jira rule) are only needed for the "issue Done → email" flow.

## 1. Prerequisites

- **Node.js 22 or 24** (`node -v`).
- **Yarn**: just run `corepack enable` once — the repo pins the right Yarn version automatically, no manual install.
- A Jira Cloud site (free plan works). A Mailtrap account only for the email flow.

## 2. Install & configure

```sh
yarn install
cp .env.example .env      # then fill in values (see below)
```

Fill `.env`:

| Variable | Where to get it |
| --- | --- |
| `JIRA_BASE_URL` / `JIRA_USER_EMAIL` / `JIRA_API_TOKEN` / `JIRA_PROJECT_KEY` | Jira site + an API token from https://id.atlassian.com/manage-profile/security/api-tokens |
| `JIRA_WEBHOOK_SECRET` | You invent it: `openssl rand -hex 32` (same value used in the Jira rule, Step 5) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` | Mailtrap → Email Testing → Inbox → SMTP Settings |

> All of the above are required to boot — the backend fails fast if any is missing.

## 3. Run

```sh
yarn start:env
```

> Use `start:env`, **not** `start` — it loads `.env`. Frontend: http://localhost:3000, backend: http://localhost:7007. Sign in as **Guest**.

Core check: **Create… → Tenant Onboarding** → submit → a Jira issue is created; **My onboarding requests** lists it by email. (No tunnel needed for this.)

## 4. Cloudflare tunnel (for the Jira webhook)

Jira Cloud can't reach `localhost`, so expose the backend publicly.

Install once:

```sh
mkdir -p ~/local/bin
curl -sL -o ~/local/bin/cloudflared \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
chmod +x ~/local/bin/cloudflared
```

Run (backend must be up on :7007; use a separate terminal):

```sh
~/local/bin/cloudflared tunnel --url http://localhost:7007
```

It prints `https://<random>.trycloudflare.com`. **This URL changes every restart** — re-paste it into the Jira rule each time.

## 5. Jira Automation rule (issue Done → email)

Project settings → Automation → Create rule:

- **Trigger:** Issue transitioned → **To status = Done**
- **Condition** (recommended): Labels *contains* `tenant-onboarding`
- **Action:** Send web request
  - URL: `https://<random>.trycloudflare.com/api/platform-tenant-onboarding/jira-webhook`
  - Method: `POST`, Body: Custom data → `{"issue":{"key":"{{issue.key}}"}}`
  - Headers: `Content-Type: application/json` and `X-Onboarding-Token: <JIRA_WEBHOOK_SECRET>`

Test: submit a request → move that issue to **Done** → an email lands in Mailtrap.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Backend crash: `Missing required config value 'tenantOnboarding.jira.webhookSecret'` | You ran `yarn start` instead of `yarn start:env`, or `.env` is incomplete. |
| Webhook returns `401` | `X-Onboarding-Token` ≠ `JIRA_WEBHOOK_SECRET`. |
| Webhook returns `200 {"skipped":"not-done"}` | Issue status isn't `Done` (set `tenantOnboarding.jira.doneStatus` if your workflow differs). |
| Jira audit log shows a connection error | Tunnel down or stale URL — restart `cloudflared`, update the rule URL. |

See [README.md](../README.md) for the full env-variable table and plugin list.
