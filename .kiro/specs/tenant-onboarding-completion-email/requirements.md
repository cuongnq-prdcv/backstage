# Requirements: tenant-onboarding-completion-email

## Introduction

This feature closes the onboarding loop. In the existing onboarding feature
(`.kiro/specs/tenant-onboarding-jira`) a guest submits a request that becomes a **Jira issue** a
human reviews. After the reviewer manually creates the Azure subscription and invites the contact
into Entra ID, they move the Jira issue to **Done**. This feature reacts to that transition: Jira
Automation calls a new Backstage webhook, Backstage verifies the issue with Jira, reads the seven
onboarding values back out of the issue description, and emails the contact to tell them their
tenant is ready and what to do next.

It complements — and depends on — the onboarding feature: onboarding is the *request*; this is the
*completion notification*. It is deliberately a proof-of-concept (POC): duplicate emails are
accepted (no idempotency), and Mailtrap is the reference SMTP service for testing.

## Glossary

| Term | Meaning |
| --- | --- |
| **Onboarding_Issue** | The Jira issue created by the onboarding scaffolder action, whose description (ADF) holds the seven onboarding values and whose labels include `tenant-onboarding`. |
| **Completion_Webhook** | The new Backstage endpoint `POST /api/platform-tenant-onboarding/send-mail`, called by Jira Automation when an issue transitions to Done. |
| **Webhook_Secret** | The shared secret (`JIRA_WEBHOOK_SECRET`) Jira Automation sends in the `X-Onboarding-Token` header and Backstage matches. |
| **Completion_Email** | The email sent to the contact confirming subscription creation + Entra ID invitation and the next step. |
| **Done_Status** | The Jira status name that means "completed", configurable (`tenantOnboarding.jira.doneStatus`, default `Done`). |
| **Smtp_Config** | The `tenantOnboarding.smtp` config block (host, port, user, password, from, secure). |

## Requirements

### Requirement 1 — Completion webhook endpoint

**User Story:** As the platform team, I want Jira to notify Backstage when an onboarding issue is
Done, so that the contact is emailed automatically without me sending mail by hand.

| # | Acceptance Criterion |
| --- | --- |
| 1.1 | THE Completion_Webhook SHALL be exposed at `POST /api/platform-tenant-onboarding/send-mail`. |
| 1.2 | THE Completion_Webhook SHALL NOT require a Backstage user credential (the caller is Jira, not a signed-in user). |
| 1.3 | WHEN the `X-Onboarding-Token` header is absent or does not equal the Webhook_Secret, THE Completion_Webhook SHALL respond `401` and take no further action. |
| 1.4 | THE Completion_Webhook SHALL compare the header to the Webhook_Secret with a constant-time comparison. |
| 1.5 | WHEN the request body does not contain a string `issue.key`, THE Completion_Webhook SHALL respond `400` and take no further action. |

### Requirement 2 — Verify the issue before acting

**User Story:** As the platform team, I want Backstage to confirm the issue is really Done with
Jira, so that a forged or stale webhook cannot trigger an email.

| # | Acceptance Criterion |
| --- | --- |
| 2.1 | THE Completion_Webhook SHALL fetch the issue from Jira via `GET /rest/api/3/issue/{key}?fields=status,description` rather than trusting the webhook payload. |
| 2.2 | WHEN the fetched status name does not equal the Done_Status (case-insensitive), THE Completion_Webhook SHALL respond `200` with a skipped marker and send no email. |
| 2.3 | WHEN the Jira fetch fails, THE Completion_Webhook SHALL respond `502` and send no email. |

### Requirement 3 — Recover the onboarding values from the issue

**User Story:** As the platform team, I want the email built from the request's own data, so that it
names the right tenant and reaches the right person.

| # | Acceptance Criterion |
| --- | --- |
| 3.1 | THE system SHALL parse the issue's ADF description back into the seven onboarding fields, symmetric with how the onboarding action wrote them. |
| 3.2 | THE parser SHALL round-trip: parsing the output of the onboarding description builder SHALL reproduce the original seven values. |
| 3.3 | WHEN the parsed `contactEmail` is missing or not a valid email, THE Completion_Webhook SHALL respond `422` and send no email. |

### Requirement 4 — Send the completion email

**User Story:** As a tenant contact, I want an email confirming my tenant is ready and telling me
what to do next, so that I can proceed to provisioning.

| # | Acceptance Criterion |
| --- | --- |
| 4.1 | THE Completion_Email SHALL be sent over SMTP (nodemailer) to the parsed `contactEmail`, using the Smtp_Config transport and `from`. |
| 4.2 | THE Completion_Email subject and body SHALL include `tenantName`, `contactName`, `organization`, `environment`, `location`, and the Jira issue URL. |
| 4.3 | THE Completion_Email SHALL NOT include `purpose` (an internal reviewer note). |
| 4.4 | WHEN the email is sent successfully, THE Completion_Webhook SHALL respond `200` with a sent marker and the issue key. |
| 4.5 | WHEN sending fails, THE Completion_Webhook SHALL respond `502`. |
| 4.6 | FOR this POC, THE system SHALL NOT deduplicate: each Done webhook SHALL send one email, duplicates accepted. |

### Requirement 5 — Configuration

**User Story:** As an operator, I want SMTP and webhook settings supplied by environment, so that no
secret is committed.

| # | Acceptance Criterion |
| --- | --- |
| 5.1 | THE config SHALL add `tenantOnboarding.jira.webhookSecret` and an optional `tenantOnboarding.jira.doneStatus` (default `Done`). |
| 5.2 | THE config SHALL add `tenantOnboarding.smtp` with `host`, `port`, `user`, `password`, `from`, and optional `secure` (default false). |
| 5.3 | THE config schema SHALL mark `apiToken`, `webhookSecret`, and `smtp.password` as `@visibility secret`. |
| 5.4 | ALL config values SHALL be `${ENV_VAR}` references; `webhookSecret` and every required `smtp` key SHALL be mandatory — a missing key SHALL fail fast naming the key. |

### Requirement 6 — Safety and non-disclosure

| # | Acceptance Criterion |
| --- | --- |
| 6.1 | THE system SHALL NOT log the Webhook_Secret, SMTP password, `contactEmail`, `contactName`, `purpose`, or email body. |
| 6.2 | THE Completion_Webhook SHALL send only to the address read from the verified issue, never to an address taken from the webhook payload. |
| 6.3 | NO automated test SHALL perform a real SMTP or Jira network call; the Jira `fetch` and the SMTP transport SHALL be injected. |

### Requirement 7 — Manual verification

| # | Acceptance Criterion |
| --- | --- |
| 7.1 | Manual verification SHALL confirm that transitioning an Onboarding_Issue to Done triggers exactly one Completion_Email in Mailtrap containing the expected values, and that a request with a wrong/absent `X-Onboarding-Token` is rejected with 401. |

## Out of scope

- Idempotency / dedupe of emails (POC accepts duplicates).
- Automated Azure subscription creation and automated Entra ID invitation (still manual).
- Any database or persisted store (Jira remains the only store).
- In-app Backstage notifications (this feature sends external email only).
