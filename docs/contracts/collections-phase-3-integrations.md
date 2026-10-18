# Contract: Collections Phase 3 Integrations

State: **Approved for test-only implementation. Delivery-disabled backend/UI integration was signed off on 2026-10-18; provider-backed test sending is still gated. This addendum pins retry/run response shapes and reason codes before any test send.**

- Producer: Engineer B (provider adapter, queue/worker, persistence, access policy).
- Consumer: Engineer A (Collections UI and integrated testing).
- Project owner: Tejas Wilavanya.
- Base: Phase 2 backend `53324a7`; latest UI/integration validation branch `codex/collections-phase2-ui-validation` at `dd3472f`.
- Decision basis: Phase 2 owner decisions recorded in `docs/contracts/collections-phase-2-backend.md` and `docs/coordination/CURRENT_WORK.md`.
- Phase 2 evidence: prior integrated UI/backend validation passed five SQL suites and 68/68 API/database/audit checks. Engineer A's latest report on `cc862c4` adds a clean no-workaround run, Contacts browser/primary-selection checks, and S1 access matrix 12/12. Delivery remained disabled; no provider call or hosted migration occurred. Branch review/merge and release gates remain open.
- Environment: the client approved creating a separate Supabase sandbox project for non-production integration verification. It is not provisioned yet; see `docs/decisions/2026-10-13-collections-supabase-sandbox.md`. This does not authorize production data copies, provider setup, or live sending.

## Capability boundary

This draft defines the next Collections slice for outbound email integration and safe delivery orchestration. It prepares a provider adapter, delivery queue/worker, test-mode routing, and Owner/Admin delivery history. The only proposed provider is Resend because the application already uses it for account and support email; that reuse is not yet approved for Collections.

The initial implementation target is **test-only delivery**, not live-client email. Default state remains `automation_enabled = false` and `delivery_mode = disabled`. No setting, UI action, deployment variable, or provider response may silently enable production sending. A later live-send capability requires a separate approved contract and explicit owner/client release decision.

In scope, subject to contract approval:

- A server-only email-provider adapter, with a mock/fake adapter as the default for automated tests.
- A protected worker that claims eligible queued attempts, rechecks current invoice balance, stage history, holds, contact quality, and guardrails, then sends only when every test-mode gate is satisfied.
- Test-mode recipient rewriting to one server-configured test mailbox. No request field or client-provided value may select a recipient.
- Delivery-attempt state, idempotency, sanitized provider outcomes, and an Owner/Admin-only history view.
- Stage 1–3 reminder candidates in test mode. Stage 4 remains internal and never sends a client message. Stage 5 remains a human approval gate and, if included in the test slice, can only produce a test-recipient message after explicit Owner/Admin approval.
- A dry-run path that reuses the Phase 2 preview and remains side-effect free.

Explicitly excluded:

- Live email to client addresses, live mode flags, or production scheduling.
- QuickBooks, a second receivables source, or historical AR imports.
- Payment processing, automated allocation, or a payment-link provider. Payment links need a separate decision and contract change if requested.
- Letters, attachments, SMS, client-portal messages, and provider webhooks unless added through an approved Contract Change Request.
- Storing provider credentials, raw message bodies, or customer secrets in Git, browser storage, audit payloads, or ordinary logs.

## Source of truth and send eligibility

- Billing remains the sole source for invoice amounts, payment allocations, and open balances. Collections must not mutate those ledger values.
- The current Phase 2 worklist, rule configuration, holds, and event history remain authoritative. A delivery job must not recompute invoice balances or stage progression in the browser.
- Only issued invoices with a positive balance can be considered. Draft, void, fully paid, or otherwise ineligible invoices are suppressed.
- Recheck the ledger-derived balance, active holds, unallocated-credit review, unique primary contact/email, minimum balance, enabled rule, firm timezone/window, weekday rule, and stage/approval state immediately before claiming and immediately before provider submission.
- A payment, hold, changed stage, ambiguous/missing contact, or newly invalid rule discovered before send suppresses the attempt and records a stable reason.
- The test recipient receives synthetic fixture content only. Rewriting the `To` address is not enough if a message body still contains production client names, balances, or other client data. No hosted/real-client data may be sent through a provider in the test phase.
- Stage 4 produces an internal Owner-escalation notification only; it never sends a client email. In this test phase, any email notification remains restricted to the approved test mailbox and synthetic content. Stage 5 requires an explicit Owner/Admin approval event and remains test-recipient-only in this phase.

## Provider and configuration boundary

Proposed provider: Resend, behind an application-owned adapter so business rules do not depend on Resend-specific response shapes. Existing 2FA and support senders are not Collections sender approval.

Proposed server-only configuration (names are proposals, not yet frozen):

| Setting | Proposed handling |
| --- | --- |
| Provider API key | Engineer B owns configuring the available Resend test API key in server-only secret storage for test mode; prefer a dedicated `COLLECTIONS_RESEND_API_KEY`. This is Resend's server-side authorization secret; never `NEXT_PUBLIC_*`, Git, or chat. Any reuse of a production/shared key requires a separate access-scope review and owner approval. |
| Sender / reply-to | Use the recommended Collections-specific, verified business-domain sender and reply-to defaults, selected/configured by Engineer B and confirmed against domain verification before provider tests. Do not use the temporary Gmail test recipient as sender or inherit 2FA/support identities by assumption. |
| Test recipient | One owner-approved mailbox stored server-side. The UI may show a masked value/status, never a raw secret or a user-editable per-send address. |
| Delivery mode | Effective test mode requires both an explicit non-production deployment gate and an approved server configuration. The database default stays `disabled`; no live value is introduced by this contract. |
| Worker credential | Dedicated machine secret or platform-signed job identity; server-only, rotateable, and independent of user cookies. |

If the provider or configuration values are unset, malformed, unverified, or inconsistent with the environment, fail closed before creating a provider request. Return a stable error or mark the attempt `needs_review`; never fall back to a client email.

## Proposed operations (draft shapes)

Exact paths and schemas require Engineer A/Engineer B review before implementation. Recipient addresses are never accepted in request bodies.

| Operation | Proposed request and response | Access |
| --- | --- | --- |
| `POST /api/collections/automation/run` | Optional `{ "limit": number }` (default 50, max 200). On success returns exactly `{ run_id, claimed, accepted, suppressed, needs_review, failed, remaining }`; `run_id` is a UUID and all counts are non-negative integers. `claimed` counts attempts atomically moved to `sending`; outcome counts are subsequent outcomes for this run; `remaining` counts worklist candidates beyond this run's batch limit. No arbitrary recipient or production as-of-date input. | Machine identity only; never app-user cookie or public/anonymous. |
| `GET /api/collections/deliveries` | Query filters: `invoice_id` (optional UUID), `source_invoice_id` (optional UUID), `status` (optional single allowed status), `limit` (default 50, max 200), and `offset` (default 0, min 0). If both identities are supplied, both filters apply. Returns `{ items: DeliveryAttemptSummary[], pagination: { limit, offset, total } }`, ordered by `created_at DESC, attempt_id DESC`. Exact item fields are defined below; no raw recipient, provider payload, key, or full rendered body. | Owner/Admin only. |
| `GET /api/collections/delivery-status` | Returns effective mode, readiness, stable missing-configuration codes, and a masked test address; never returns credentials or full addresses. | Owner/Admin only. |
| `POST /api/collections/automation/pause` | Empty request body; atomically turns automation off, writes an actor-attributed audit record, and returns the same `CollectionsDeliveryStatusResponse` shape as `GET /delivery-status`. There is no unpause operation; re-enabling requires explicit server/deployment configuration. | Owner/Admin only. |
| `POST /api/collections/automation/test-run` | Owner/Admin “Run test now” using the current server-side preview, synthetic fixtures only, and the configured test mailbox. No recipient/body/as-of-date override. On success returns exactly the run response shape above. If invoked outside the firm send window, return HTTP 409 `{ error, code: "OUTSIDE_SEND_WINDOW" }` before creating attempts. | Owner/Admin only; test mode and all safety gates required. |
| `POST /api/collections/deliveries/{id}/retry` | No recipient/body input. Only a known provider-rejected failure may be retried; uncertain provider outcome is `needs_review`, not blindly retried. Reuses the same invoice/stage idempotency identity. A successful queue action returns HTTP 202 `{ attempt_id, status: "queued" }`. | Owner/Admin only, audited. |

The machine worker also returns HTTP 409 `{ error, code: "OUTSIDE_SEND_WINDOW" }` before creating attempts when run outside the configured firm window. Response money remains decimal strings. All APIs are `no-store`, return stable machine-readable error codes, and do not expose database exception details. `OUTSIDE_SEND_WINDOW` is distinct from `RULE_DISABLED`, which means the stage/rule is disabled.

## Delivery state, idempotency, and failure semantics

- Reuse and extend the Phase 2 `collection_delivery_attempts` model only through a reviewed forward-only migration. For PDF intake, the forward migration makes `invoice_id` nullable and adds `source` (`billing` or `pdf_import`) and nullable `source_invoice_id`. Billing attempts require `source=billing`, `invoice_id` non-null, `source_invoice_id` null; PDF-sourced attempts require `source=pdf_import`, `source_invoice_id` non-null, and may have `invoice_id` null or set when linked to Billing. Attempt identity is `(source, source invoice identity, stage)`: Billing uses `invoice_id`; PDF-sourced uses `source_invoice_id` even when the imported receivable is matched to a Billing invoice. Preserve a unique idempotency key per attempt identity.
- Claiming is concurrency-safe (row lock / `SKIP LOCKED` or equivalent). Repeated scheduler invocations cannot produce duplicate sends for one invoice/stage.
- Provider submission occurs outside the database transaction. Persist the attempt transition and sanitized provider message ID/result; never claim database atomicity across the network request.
- A provider acceptance response means **accepted by the provider**, not delivered to or read by the recipient. Bounce/delivery receipts require a separately reviewed webhook contract.
- Retry only known transient/rejected outcomes using the same idempotency key where supported. Timeouts or ambiguous acceptance become `needs_review` unless provider idempotency can safely resolve the outcome.
- [Resend's idempotency documentation](https://resend.com/docs/dashboard/emails/idempotency-keys) documents same-key/same-payload retries as idempotent for 24 hours. It does not specify whether 429/5xx responses are cached and replayed; therefore implementation must keep the key and payload stable to avoid duplicates and must not infer provider behavior from a mock. Persist only a SHA-256 fingerprint of the exact request payload. If a retry would change the payload, do not call the provider; mark the attempt `needs_review` with `PROVIDER_PAYLOAD_CHANGED`. Retryable failures may be retried only within 23 hours of attempt creation, leaving a safety buffer before provider key expiry; older failures remain non-retryable and require review. Treat timeout/malformed acceptance as `needs_review`.
- Use bounded exponential backoff, a maximum attempt count, and a dead-letter/Owner review state. Final values are pending provider-limit review.
- Do not log API keys, auth headers, verification codes, full HTML/text bodies, raw client email, or customer financial details. Persist recipient hash only where it is sufficient for audit; any raw address retention needs an explicit privacy decision.
- Audit actor is the authenticated Owner/Admin for configuration/retry operations and the service identity for worker transitions. Keep audit records attributable and transactionally tied to database state changes.

## Authentication, access, and privacy

- All user-facing routes resolve identity on the server and enforce Owner/Admin checks independently of the proxy/sidebar.
- The worker rejects missing/invalid machine credentials and cannot be invoked by `anon`, unassigned staff, or a normal authenticated staff cookie.
- Provider credentials are server-only and distinct from user-controlled rule templates. The rules editor cannot set provider, sender, reply-to, test recipient, or delivery mode.
- Treat editable body templates as plain text: HTML-escape the template text and each substitution before wrapping it in the application's minimal email markup; produce a plain-text alternative. Allow only an explicit token list; reject unknown tokens and prevent headers/URLs from being injected through substitutions. Stage 4's subject and first body heading are fixed as `Internal Owner-escalation notice — TEST`, independent of the configurable template.
- Test mode may contact only the approved test mailbox and only with synthetic fixture data. Live-client data disclosure to an external processor is outside this draft.
- Separate legal/compliance review must approve customer-facing copy, required disclosures, opt-out/consent behavior, retention, and applicable jurisdictional controls before any live-send contract is considered.

## Refresh and UI behavior

- Phase 2 preview remains the source for candidate actions and never sends.
- The Owner/Admin delivery-history view shows invoice number, stage, firm-local attempt time, status, and sanitized reason. It does not expose provider internals or raw recipient data.
- After a retry or configuration change, refetch server state; do not optimistically change balances, stage progression, or delivery status.
- Staff roles do not get retry, delivery-configuration, recipient, or provider controls. Collections/Billing read access does not grant send authority.

## Validation and release gates

Required before Phase 3 can be released in test mode:

1. Unit tests for provider payloads, template escaping, token allowlist, test-recipient rewriting, and fail-closed configuration.
2. Mock-provider tests for accepted, rejected, rate-limited, timeout/unknown, and malformed responses; no real provider key required.
3. Concurrency/idempotency tests for repeated runs, simultaneous workers, retry, and ambiguous provider outcome.
4. State-recheck tests where a payment, hold, contact ambiguity, rule change, or stage approval changes between queue and send.
5. Access tests for Owner, Admin, assigned Billing/Collections staff, unassigned staff, anonymous callers, and invalid/missing machine credentials.
6. Local synthetic fixture run with delivery disabled and zero provider calls; optional provider sandbox/send test only after a test recipient and credential are separately approved.
7. UI → route → queue/attempt → audit → reload verification, plus lint, typecheck, build, SQL/RLS, support, and regression suites.
8. Verify that a missing test recipient, key, sender, or disabled flag produces zero provider requests and zero customer-address fallback.

Production/live send remains a separate gate: owner/client approval of provider, sender/reply-to, message copy, contact/consent rules, test evidence, monitoring, disable/rollback plan, migration target, and actual deployment configuration. No production migration or send is authorized by this draft.

## Owner decision record

| ID | Decision | Recommended default for discussion | Status |
| --- | --- | --- | --- |
| P3-D1 | Provider | Reuse Resend through a new Collections adapter. | Owner approved 2026-10-14 |
| P3-D2 | API credential | Engineer B configures the available Resend test API key in server-only secrets; prefer a dedicated Collections key; no production/shared key reuse without separate approval. | Owner delegated test-key configuration to Engineer B 2026-10-14 |
| P3-D3 | Sender and reply-to identity | Use a Collections-specific, verified business-domain sender/reply-to; Engineer B selects/configures the verified values. Never use the temporary Gmail test recipient as sender or inherit 2FA/support identities by assumption. | Owner approved the recommended default 2026-10-14; exact verified address to be selected by Engineer B |
| P3-D4 | Test recipient and test-data policy | `tej.privatework@gmail.com` is the temporary test mailbox; synthetic records only; never client data. Revisit the mailbox before broader testing/live-send planning. | Owner approved temporary recipient 2026-10-14 |
| P3-D5 | Phase 3 delivery scope | Test-only stage 1–3 sends; stage 4 creates an internal Owner-escalation notification but no client email; stage 5 remains Owner/Admin-approved and test-recipient-only. | Owner approved scope 2026-10-14; email still disabled pending implementation gates |
| P3-D6 | Schedule / timezone behavior | Dynamic rules decide which actions are due; scheduler runs around 9:00 AM `America/Chicago` (Houston local time), subject to configured firm weekdays/windows. A missed run is handled on the next eligible scheduled run, with no duplicate invoice/stage attempt. | Owner approved 2026-10-14 |
| P3-D7 | Payment links | Collections will not create or own a payment-link provider and will not include payment URLs in reminder emails in the initial test-only scope. Billing owns the modular firm invoice/payment URL setting; any later inclusion in Collections emails requires a contract change. | Owner approved default 2026-10-14 |
| P3-D8 | Customer opt-out, disclosures, retention, live sending | Keep live sending excluded. Resolve customer opt-out/consent, disclosures, retention, and required review before proposing live send. | Owner approved defaults 2026-10-14; live send excluded |

## Engineer A review answers (proposed contract details)

These answer the consumer/API questions raised in the UI review. They remain subject to Engineer A/B approval and local implementation tests; they do not enable delivery.

1. **Delivery history response.** `GET /api/collections/deliveries` returns `{ items, pagination: { limit, offset, total } }`. Filters are named `invoice_id`, `source_invoice_id`, `status`, `limit`, and `offset`; if both identity filters are supplied, both apply. The stable order is `created_at DESC, attempt_id DESC`. Each item returns only `attempt_id`, nullable `invoice_id`, nullable `source_invoice_id`, `source`, stable `row_key`, `invoice_number`, `client_id`, `source_batch_id`, `source_as_of`, `discrepancy_status`, `stage`, `status`, `reason_code`, `reason_text`, `attempt_count`, `retryable`, `created_at`, `updated_at`, `next_attempt_at`, and `accepted_at`. `row_key` is `billing:<invoice_id>` for Billing-sourced rows and `pdf_import:<source_invoice_id>` for PDF-sourced rows. Do not return client email, recipient hash, provider message ID, provider payload, secret/config values, or message body. `reason_text` is generated from stable codes below, not copied from provider errors. A reviewed forward-only migration must align the database status/`sent_at` naming to `accepted`/`accepted_at`; do not rewrite an existing migration.

   Statuses and plain wording:

   | Status | UI wording | Meaning |
   | --- | --- | --- |
   | `queued` | Waiting to send | Eligible work is waiting for a worker. |
   | `sending` | Sending | A worker currently owns the attempt. |
   | `accepted` | Accepted by email provider | Provider accepted the request; this does not prove delivery or reading. |
   | `suppressed` | Not sent | A current policy/data guard prevented the send. |
   | `needs_review` | Needs review | Outcome is uncertain or requires human action; never blindly retry. |
   | `failed` | Failed | Provider rejected or a known failure occurred. Retry only when `retryable=true`. |

   Use `accepted` consistently instead of `sent`; stage progression counts `accepted`, never a claim of delivery. Retry is true only for known transient failures with attempts remaining (for example `PROVIDER_RATE_LIMITED` or `PROVIDER_TEMPORARY_FAILURE`) and while the attempt is younger than 23 hours. It is false for accepted, queued, sending, suppressed, needs-review, permanent rejection, unknown outcome, expired idempotency window, and exhausted attempts.

   Stable reason codes and UI wording:

   | Code | Plain wording |
   | --- | --- |
   | `ACTIVE_HOLD` | On hold; no email sent. |
   | `UNALLOCATED_CREDIT_REVIEW` | Credit/payment needs review. |
   | `CONTACT_REVIEW_REQUIRED` | Choose one primary contact with an email. |
   | `EMAIL_CONTACT_MISSING` | No client email is available. |
   | `BELOW_MINIMUM_BALANCE` | Balance is below the configured minimum. |
   | `RULE_DISABLED` | This reminder stage is turned off. |
   | `APPROVAL_REQUIRED` | Owner/Admin approval is required. |
   | `ATTEMPT_ALREADY_EXISTS` | This invoice stage already has an attempt. |
   | `DELIVERY_DISABLED` | Email delivery is disabled. |
   | `PROVIDER_KEY_MISSING` | Email provider is not configured. |
   | `SENDER_NOT_VERIFIED` | Sender address is not verified. |
   | `TEST_RECIPIENT_MISSING` | Test mailbox is not configured. |
   | `SYNTHETIC_DATA_REQUIRED` | This test send requires a synthetic fixture. |
   | `PROVIDER_RATE_LIMITED` | Email provider is temporarily rate-limiting requests. |
   | `PROVIDER_TEMPORARY_FAILURE` | Email provider temporarily failed. |
   | `PROVIDER_REJECTED` | Email provider rejected the request. |
   | `PROVIDER_OUTCOME_UNKNOWN` | Provider outcome is unknown; review before retrying. |
   | `ATTEMPT_LIMIT_REACHED` | Retry limit reached. |
   | `STAGE_NOT_DUE` | This reminder stage is not due yet. |
   | `INVOICE_NOT_ELIGIBLE` | This invoice is not open and eligible for collection. |
   | `OUTSIDE_SEND_WINDOW` | Outside the firm's configured send window. |
   | `PROVIDER_PAYLOAD_CHANGED` | Message content changed since the prior attempt; review required. |
   | `SOURCE_DISCREPANCY_BLOCKED` | Imported balance differs from Billing; review required. |

2. **Delivery status endpoint.** `GET /api/collections/delivery-status` returns `{ mode: "disabled" | "test", automation_enabled: boolean, test_ready: boolean, missing: MissingDeliverySetting[], test_recipient_masked: string | null }`. `test_ready` is true only when test mode is explicitly configured, the test key is present, sender/reply-to are verified, a test mailbox is set, and the active environment is allowlisted as non-production. `missing` uses stable codes including `DELIVERY_DISABLED`, `AUTOMATION_PAUSED`, `PROVIDER_KEY_MISSING`, `SENDER_NOT_VERIFIED`, `REPLY_TO_MISSING`, `TEST_RECIPIENT_MISSING`, and `ENVIRONMENT_NOT_ALLOWLISTED`. Never reveal the secret or full mailbox. This reports readiness; it does not start sending.

3. **Manual vs scheduled trigger.** Owner approved an Owner/Admin “Run test now” via `POST /api/collections/automation/test-run`; it uses the current preview and server state, accepts no recipient, body, or arbitrary as-of date, and works only when every test-mode/synthetic-data gate passes. Keep the machine-authenticated background endpoint separate. Test runs are manually initiated; no hosted scheduler is enabled during local-only work. A scheduler may later run once each configured weekday at 9:00 AM `America/Chicago`; after a missed run, process eligible items at the next scheduled run, with one attempt per invoice/stage.

4. **Reminder history and accepted state.** A stage 1–3 test email accepted by the provider records the attempt as `accepted` and creates exactly one `reminder_logged` event with its stage and `delivery_attempt_id`. Stage context treats that attempt/event as one completed stage, not two; retries or replay cannot create duplicate events. Do not write `reminder_logged` when queued, suppressed, failed, or outcome-unknown.

5. **Stage 5 test notice.** A test notice sent to the test mailbox does **not** create `formal_notice_sent` and does not satisfy the formal-notice stage. Keep the current manual “Record notice sent” action for an actual separately approved notice sent to the client, linked to its approval event; it remains Owner/Admin-only and duplicate recording is rejected. Stage 5 test attempts stay visible only as test delivery attempts.

6. **Stage 4 notification.** Stage 4 is an internal Owner-escalation notification, not a customer email. During test phase, send synthetic content only to the configured test mailbox. Its subject and first body heading are the fixed text `Internal Owner-escalation notice — TEST`; configurable stage copy may follow but cannot replace that label. Do not address client contacts. The in-app review item remains available whether email is configured or not.

7. **Template placeholders.** The initial allowlist is `{contact_name}`, `{invoice_number}`, `{balance}`, `{due_date}`, and `{days_past_due}`. Unknown tokens in `PATCH /api/collections/rules` return HTTP 422 with `TEMPLATE_TOKEN_INVALID`; missing or invalid required values fail closed before queueing. The body template and substitutions are both escaped as HTML text; only application-owned fixed markup is emitted. Never permit placeholders in headers, recipient, URLs, or provider configuration.

8. **Sanitized worklist last touch and source identity (Phase 4 addendum).** Every worklist invoice and preview item carries nullable `invoice_id`, nullable `source_invoice_id`, and a stable `row_key`, plus `source`, `source_batch_id`, `source_as_of`, and `discrepancy_status`. Billing source uses `invoice_id` and null `source_invoice_id`; PDF source uses `source_invoice_id` and may also carry `invoice_id` when matched to Billing. `row_key` is `billing:<invoice_id>` for Billing source and `pdf_import:<source_invoice_id>` for PDF source. A PDF-selected value always reports `source=pdf_import`; its attempts key on `source_invoice_id`, not `invoice_id`. Add nullable `last_delivery` `{ stage, status, occurred_at }`; it is keyed by the same source identity and contains no recipient, provider ID, body, or raw error. It is readable by all roles that already have Collections worklist read access. It reflects the latest automated delivery attempt; manual event history remains in the existing events interface. An attempt suppressed by an unresolved PDF/Billing discrepancy uses `SOURCE_DISCREPANCY_BLOCKED` and the wording above.

9. **Synthetic-only enforcement.** Local and any future shared non-production environment use a separate project and synthetic seed only—no production clone or real client AR report/contact/financial data. Mark seeded fixture clients/invoices as synthetic and require that marker for every provider-backed test send. This marker/gate is not implemented yet and is a prerequisite to any provider-backed test run. The worker also requires an allowlisted non-production environment/project, test mode, the server-configured test mailbox, and synthetic-only rendered content; otherwise it fails closed with `SYNTHETIC_DATA_REQUIRED` or a configuration code. A test-recipient rewrite alone is not sufficient. Keep this gate disabled in production.

10. **Pause control.** The Owner/Admin pause switch calls `POST /api/collections/automation/pause` with no request body. The endpoint atomically turns automation **off only**, records the actor in the audit log, and returns the same response shape as `GET /api/collections/delivery-status`. There is no unpause operation; re-enabling requires an explicit server/deployment configuration change and cannot be done from the UI/API. A server-side environment kill switch also overrides the database setting. Default remains off.

11. **Preview deduplication.** Every preview item includes nullable `delivery_attempt: { attempt_id, status, reason_code, retryable, updated_at }`. Accepted, queued, sending, and needs-review attempts are not proposed as new sends. Failed attempts are offered only through explicit retry when `retryable=true`, reusing the same source/stage idempotency identity. Suppressed attempts may be re-evaluated only after their guard clears, without allowing a second provider acceptance for the same source invoice/stage.

## Approval record

- Project owner: P3-D1–D8 and the Owner/Admin “Run test now” trigger approved on 2026-10-14.
- Engineer A consumer review: contract approved on `4549344` (2026-10-14); backend/UI integration signed off on 2026-10-18 at UI `83e2e21` against backend `af2a52e`, with delivery disabled. This response/reason-code addendum and the source-identity forward migration/UI change require joint review before implementation.
- Backend implementation: owner implementation commit `af2a52e`; follow-up hardening and contract addendum are in progress. Provider-backed test sending is not approved.
- Approval date: initial contract 2026-10-14; delivery-disabled integration 2026-10-18.
- Contract Change Requests: none yet.
