# Contract: Collections Phase 2 Backend

State: **Draft for Engineer A review; implementation is owner-authorized on the Phase 2 branch. Production sending/configuration is not authorized.**

- Producer: Engineer B (billing/collections backend).
- Consumer: Engineer A (Collections UI and integrated testing).
- Owner decision: QuickBooks is **not needed** for this scope; Collections reads TAP Hub Billing as its sole receivables source (2026-10-10).
- Engineer A approval: pending; record compatibility feedback before the contract is frozen.
- Prerequisite for release: Phase 1 ledger migration and UI/backend integration verification.
- Prototype source: owner-provided `practiceops_1.html` and `TAP_Client_Hub_Demo_v14.html`; numbers and demo copy are not production-approved defaults.

## Capability boundary

Phase 2 builds the backend Collections worklist and AR insights read model over the TAP Hub Billing ledger, then adds rule configuration and action preview. The current implementation slice includes the SQL read model and a side-effect-free preview; it does not send email or run scheduled automation. Collections never edits invoice/payment ledger amounts. It must not import the two historic AR PDFs or create an alternate receivables source.

QuickBooks, CSV/aging-report imports, client portal payment processing, and any second AR source are out of scope. No third-party accounting dependency or new accounting credentials are introduced.

## Source of truth and domain behavior

- `invoices`, `invoice_lines`, `payments`, and `payment_allocations` are the only source for current receivables. Include issued invoices only; derive open amount from exact `numeric` totals and active allocations. Draft and void invoices never enter AR.
- `clients` and primary `contacts` provide the client display/contact details. A missing or ambiguous contact/email blocks delivery and appears as a data-quality warning; never guess an address.
- `collection_holds` and `collection_events` provide pause state, manual contacts, promises, requests, and approvals. Active account- or invoice-scoped holds suppress automated actions until released/expired.
- Only recorded payments with active allocations reduce an invoice. Unallocated payments are shown separately as a credit/reconciliation warning; they are not silently allocated or treated as proof a particular invoice is paid. Any client with an unresolved unallocated credit is excluded from automatic delivery pending review.
- Worklist rows are invoice-level so due dates and balances remain traceable. Client/account totals aggregate those rows. This prevents account-level totals from losing the invoice context that drives aging.
- Aging buckets are current/not-due, 1–30, 31–60, 61–90, and 91+ days past due (non-overlapping). The report's as-of date and send windows use the configured firm timezone (prototype: Central time); no hard-coded historical `AR_ASOF` is allowed.
- Priority score for the human call list follows the demo's proposed age weighting: balance × 1.0 through 30 days, 1.3 for 31–60, 1.6 for 61–90, 2.0 for 91–180, 2.4 after 180. Score applies only at/after the first human gate; expose the score components so UI can explain ranking. No predicted recovery amount or AI-generated collection decision is permitted.
- A payment allocation that clears an invoice suppresses future actions for that invoice. Existing jobs are cancelled transactionally where possible, and the worker rechecks balance/hold state immediately before delivery. A provider request already accepted cannot be recalled; the UI must distinguish that boundary.

## Proposed ladder and guardrails

The demo provides these values as starting points, not approved live settings:

| Touch | Prototype threshold | Behavior in Phase 2 | Approval boundary |
| --- | ---: | --- | --- |
| 1 Friendly | 1 day past due | Test-mode reminder candidate | Automatic only when test delivery is explicitly enabled |
| 2 Professional | 5 days past due | Test-mode reminder candidate | Automatic only when test delivery is explicitly enabled |
| 3 Firm | 15 days past due | Test-mode reminder candidate | Automatic only when test delivery is explicitly enabled |
| 4 Owner escalation | 21 days past due | Internal request/queue item; pause client-facing automation | Owner/Admin only |
| 5 Formal notice | 28 days past due | Approval request; no automatic send | Explicit Owner/Admin approval; test-only delivery in this milestone |

Prototype guardrails to expose as configurable settings (not to silently assume as production policy): minimum balance `$50`, direct-owner escalation above `$5,000`, weekdays only, 9:00 a.m.–5:00 p.m. Central time, stop on recorded payment, sender/reply-to, test recipient, and optional assigned-staffer copy. The first-touch body says “due” while its trigger says “1 day past due”; use a neutral editable template until owner/client approves exact copy and timing. Payment links remain off until a Billing-owned payment URL is specified.

The initial migration leaves automation disabled and delivery mode `disabled`. This implementation has no executable email-delivery path. Any later test-recipient delivery must reject an unset/invalid recipient and must make it impossible to target a real client address. No live-client send mode is in scope without separate approval.

## Proposed API surface for frontend handoff

All routes are server-authorized. Exact response schemas and stable errors must be recorded in the handoff and covered by route tests.

| Endpoint | Purpose | Access |
| --- | --- | --- |
| `GET /api/collections/receivables` | Implemented: summary, invoice rows, client aggregates, aging, holds, credit-review flags, contact gaps, and priority sort | Billing or Collections module; Owner/Admin always |
| `POST /api/collections/automation/preview` | Implemented: side-effect-free proposed actions using a supplied/as-of date | Owner/Admin |
| `GET /api/collections/rules` | Deferred: current ladder and guardrail settings (never secrets) | Owner/Admin read; safe display subset requires Engineer A review |
| `PATCH /api/collections/rules` | Deferred: update approved thresholds, wording, and test settings | Owner/Admin only; audited transaction |
| `POST /api/collections/automation/run` | Deferred: protected scheduled job; no worker/provider send exists in this branch yet | Machine secret, not an app-user cookie |
| `GET /api/collections/deliveries` | Deferred: delivery attempts and suppression/failure history | Owner/Admin |

The API returns money as decimal strings, never JavaScript floating-point numbers. Pagination, sorting, and filter limits are server-enforced. Responses are `no-store`. A stable error code accompanies every failure.

## Persistence and atomicity

- Rules/templates, delivery attempts/outbox, and idempotency state persist in PostgreSQL under `tap_hub_project`; no client-controlled browser state is authoritative.
- An outbox row is unique per invoice and ladder stage. Retry updates the same row and never creates a second message. Delivery status is one of `queued`, `sending`, `sent`, `suppressed`, `needs_review`, or `failed`.
- Claiming due work is concurrency-safe (`FOR UPDATE SKIP LOCKED` or equivalent). Recheck payment, active hold, stage history, recipient quality, configured send window, minimum balance, and test-mode constraints at claim/send time.
- Outbox state changes and corresponding `collection_events`/`audit_log` evidence commit atomically when database-only. Provider sends occur outside DB transactions; provider message IDs and sanitized errors are retained, never tokens or full message bodies containing client PII.
- Tables have RLS enabled and no `anon`/`authenticated` direct access; service-role-only RPCs mediate reads/writes. App routes enforce role/module checks independently.

## Security, approval, and communication boundaries

- Only Owner/Admin can change rules, sender details, delivery mode, test recipient, or resolve data-quality/approval gates.
- The current preview has no send side effect. A future test worker must route only to the configured test recipient; the customer's real email must never be used by it.
- Stage 4 is internal only. Stage 5 requires a matching explicit Owner/Admin approval event and still routes only to the test recipient.
- Manual Collections notes, calls, holds, and promise-to-pay continue to use the Phase 1 endpoints and audit transaction boundaries.
- No payment allocation, write-off, invoice edit, void, reversal, or external notice action occurs as an effect of automation.

## Dependencies and unresolved review items

1. Engineer A must review the route and response contracts before UI wiring; requested changes become a Contract Change Request.
2. Project owner/client must approve exact reminder wording, first-touch semantics, send window/timezone, thresholds, minimum amount, and direct-escalation behavior before considering production delivery.
3. Project owner must provide an approved test recipient and confirm verified sender/reply-to configuration through the secret-safe environment workflow. Until then, preview only.
4. The behavior for a client with more than one primary contact remains fail-closed until contact-selection rules are agreed.
5. Phase 1 must pass integrated UI/backend and database verification before this milestone is released.

## Validation gates

- Exact numeric read-model tests for aging boundaries, partial allocations, reversals, draft/void invoices, credits, and client aggregation.
- Rule tests at days 0/1/4/5/14/15/20/21/27/28, timezone boundaries, weekends, minimum amount, escalation threshold, and missing/ambiguous contacts.
- Concurrency/idempotency tests prove two workers cannot send duplicate stage messages and payment/hold changes suppress queued work.
- Authorization tests cover Owner/Admin, Billing-only, Collections-only, unassigned staff, managers, anonymous requests, and machine-secret failure.
- Test-mode integration proves all recipients are redirected to the configured test address and no customer address can be targeted; provider failure and retry cases are covered.
- Full UI-to-API-to-database-to-audit-to-reload flow is verified by Engineer A in an approved non-production environment. No live-client email is used as a test.
- Lint, typecheck, build, access regression, API contract tests, SQL policy tests, and the documented Phase 1 suite pass before release.

This contract remains a draft until Engineer A has reviewed the consumer-facing API and the owner/client has approved operational rules. Production email delivery remains a separately gated change.
