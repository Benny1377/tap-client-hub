# Contract: Collections Phase 3 Integrations

State: **Draft — review and owner decisions required; not frozen for implementation.**

- Producer: Engineer B (provider adapter, queue/worker, persistence, access policy).
- Consumer: Engineer A (Collections UI and integrated testing).
- Project owner: Tejas Wilavanya.
- Base: Phase 2 backend `53324a7`; latest UI/integration validation branch `codex/collections-phase2-ui-validation` at `dd3472f`.
- Decision basis: Phase 2 owner decisions recorded in `docs/contracts/collections-phase-2-backend.md` and `docs/coordination/CURRENT_WORK.md`.
- Phase 2 evidence: local-only five SQL suites and 68/68 API/database/audit checks pass after applying the documented local contacts-schema workaround; Engineer A reports Owner and Collections-staff browser checks pass. Phase 2 delivery remains disabled. Branch review/merge and unrelated release gates remain open.
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
- Stage 4 produces an internal review/notification candidate only; it never sends a client email. Stage 5 requires an explicit Owner/Admin approval event and remains test-recipient-only in this phase.

## Provider and configuration boundary

Proposed provider: Resend, behind an application-owned adapter so business rules do not depend on Resend-specific response shapes. Existing 2FA and support senders are not Collections sender approval.

Proposed server-only configuration (names are proposals, not yet frozen):

| Setting | Proposed handling |
| --- | --- |
| Provider API key | Prefer a dedicated `COLLECTIONS_RESEND_API_KEY`; reuse of the existing `RESEND_API_KEY` requires explicit owner approval and an access-scope review. Secret manager only; never `NEXT_PUBLIC_*`. |
| Sender / reply-to | Owner-approved, domain-verified values, injected server-side. Do not copy the current 2FA or support identities by assumption. |
| Test recipient | One owner-approved mailbox stored server-side. The UI may show a masked value/status, never a raw secret or a user-editable per-send address. |
| Delivery mode | Effective test mode requires both an explicit non-production deployment gate and an approved server configuration. The database default stays `disabled`; no live value is introduced by this contract. |
| Worker credential | Dedicated machine secret or platform-signed job identity; server-only, rotateable, and independent of user cookies. |

If the provider or configuration values are unset, malformed, unverified, or inconsistent with the environment, fail closed before creating a provider request. Return a stable error or mark the attempt `needs_review`; never fall back to a client email.

## Proposed operations (draft shapes)

Exact paths and schemas require Engineer A/Engineer B review before implementation. Recipient addresses are never accepted in request bodies.

| Operation | Proposed request and response | Access |
| --- | --- | --- |
| `POST /api/collections/automation/run` | Optional `{ "limit": number }` (default 50, max 200). Returns run identifier and counts for claimed, sent, suppressed, needs-review, failed, and remaining attempts. No arbitrary recipient or production as-of-date input. | Machine identity only; never app-user cookie or public/anonymous. |
| `GET /api/collections/deliveries` | Optional invoice/status filters and bounded `limit`/`offset`. Returns sanitized attempt metadata and pagination; no raw recipient, provider payload, key, or full rendered body. | Owner/Admin only. |
| `POST /api/collections/deliveries/{id}/retry` | No recipient/body input. Only a known provider-rejected failure may be retried; uncertain provider outcome is `needs_review`, not blindly retried. Reuses the same invoice/stage idempotency identity. | Owner/Admin only, audited. |

Response money remains decimal strings. All APIs are `no-store`, return stable machine-readable error codes, and do not expose database exception details. Exact pagination, validation, and error schemas will be frozen after review.

## Delivery state, idempotency, and failure semantics

- Reuse and extend the Phase 2 `collection_delivery_attempts` model only through a reviewed forward-only migration if additional state is needed. Current identity is unique per invoice/stage with a unique idempotency key; preserve that invariant.
- Claiming is concurrency-safe (row lock / `SKIP LOCKED` or equivalent). Repeated scheduler invocations cannot produce duplicate sends for one invoice/stage.
- Provider submission occurs outside the database transaction. Persist the attempt transition and sanitized provider message ID/result; never claim database atomicity across the network request.
- A provider acceptance response means **accepted by the provider**, not delivered to or read by the recipient. Bounce/delivery receipts require a separately reviewed webhook contract.
- Retry only known transient/rejected outcomes using the same idempotency key where supported. Timeouts or ambiguous acceptance become `needs_review` unless provider idempotency can safely resolve the outcome.
- Use bounded exponential backoff, a maximum attempt count, and a dead-letter/Owner review state. Final values are pending provider-limit review.
- Do not log API keys, auth headers, verification codes, full HTML/text bodies, raw client email, or customer financial details. Persist recipient hash only where it is sufficient for audit; any raw address retention needs an explicit privacy decision.
- Audit actor is the authenticated Owner/Admin for configuration/retry operations and the service identity for worker transitions. Keep audit records attributable and transactionally tied to database state changes.

## Authentication, access, and privacy

- All user-facing routes resolve identity on the server and enforce Owner/Admin checks independently of the proxy/sidebar.
- The worker rejects missing/invalid machine credentials and cannot be invoked by `anon`, unassigned staff, or a normal authenticated staff cookie.
- Provider credentials are server-only and distinct from user-controlled rule templates. The rules editor cannot set provider, sender, reply-to, test recipient, or delivery mode.
- Escape template substitutions for HTML and produce a plain-text alternative. Allow only an explicit template token list; reject unknown tokens and prevent headers/URLs from being injected through substitutions.
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

## Owner / reviewer decisions required to freeze

| ID | Decision | Recommended default for discussion | Status |
| --- | --- | --- | --- |
| P3-D1 | Provider | Reuse Resend through a new Collections adapter; owner to approve. | Open |
| P3-D2 | API credential | Dedicated Collections key if supported; otherwise explicitly approve reuse of the existing server-only key. | Open |
| P3-D3 | Sender and reply-to identity | Select verified Collections-specific sender/reply-to; do not inherit 2FA/support senders. | Open |
| P3-D4 | Test recipient and test-data policy | One controlled mailbox; synthetic records only; never client data. | Open |
| P3-D5 | Phase 3 delivery scope | Test-only stage 1–3 sends; stage 4 stays internal; stage 5 remains Owner/Admin-approved and test-only. | Open |
| P3-D6 | Schedule / timezone behavior | Reuse the Phase 2 firm timezone, window, weekday, and dynamic ladder settings; choose a job cadence and late-run policy. | Open |
| P3-D7 | Payment links | Exclude unless the owner separately selects a provider and approves a new contract. | Open |
| P3-D8 | Customer opt-out, disclosures, retention, live sending | Resolve with owner/client and appropriate review before any live-send proposal. | Open; live send excluded |

## Approval record

- Project owner: pending.
- Engineer A consumer review: pending.
- Engineer B producer review: pending.
- Approval date: pending.
- Contract Change Requests: none yet.
