# Contract: Collections Phase 2 Backend

State: **Engineer A approved conditionally on stage-history corrections; implementation updates are prepared on the Phase 2 backend branch. Production sending/configuration is not authorized.**

- Producer: Engineer B (billing/collections backend).
- Consumer: Engineer A (Collections UI and integrated testing).
- Owner decision: QuickBooks is **not needed** for this scope; Collections reads TAP Hub Billing as its sole receivables source (2026-10-10).
- Engineer A approval: conditional; pending requests must not count as completed stages, and client-level escalation/notice history must not affect invoices that were not yet due on the event's firm-local date. Regression coverage is in `supabase/tests/collections_phase2_stage_regressions.sql`.
- Prerequisite for release: Phase 1 ledger migration and UI/backend integration verification.
- Migration order: `20261010110000_billing_audit_and_receivables.sql` → `20261010120000_collections_automation_foundation.sql` → `20261010130000_collections_shared_date_and_stage_model.sql` → `20261010140000_collections_stage_and_api_corrections.sql` → `20261011100000_collections_catch_up_policy.sql`.
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
- Both Billing and Collections read models use the same `get_billing_invoice_balances` SQL function for invoice totals, active allocations, open balances, and days past due, and `collections_firm_today()` for the firm's date. Hold activity/expiry validation uses that same firm date, so the Billing/Collections boundaries cannot diverge because of UTC versus Central date rollover.
- Aging buckets are current/not-due, 1–30, 31–60, 61–90, and 91+ days past due (non-overlapping). The report's as-of date and send windows use the configured firm timezone (prototype: Central time); no hard-coded historical `AR_ASOF` is allowed.
- Priority score for the human call list is zero before day 21. At/after the first human gate, apply balance × 1.0 to 21–30 days, 1.3 for 31–60, 1.6 for 61–90, 2.0 for 91–180, and 2.4 after 180. Return each band's balance, multiplier, and weighted contribution so the UI can explain ranking. No predicted recovery amount or AI-generated collection decision is permitted.
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

Reminder history is invoice-aware. A `reminder_logged` event with explicit `stage` must use stage 1, 2, or 3. If the UI omits it, the database records the highest enabled automatic ladder stage eligible for that invoice on the firm's date at logging time. For legacy reminder events without a stage, the worklist derives the equivalent stage from the event's timestamp in the configured firm timezone. Only approved/completed escalation (`escalated`) counts as stage 4; only approved/sent formal notice counts as stage 5. An unapproved request is surfaced as `awaiting_approval` and blocks proposing later stages. New escalation/formal-notice requests require an invoice. Legacy client-level escalation/notice events apply only to invoices whose due date was on or before the event's firm-local date. Account-level reminders continue to apply to each eligible invoice at its own due-date age.

The owner approved reminder catch-up: if earlier reminders were missed, the next proposed reminder is the highest enabled automatic stage currently due. The worklist does not skip the Owner escalation or formal-notice approval gates.

Prototype guardrails to expose as configurable settings (not to silently assume as production policy): minimum balance `$50`, direct-owner escalation above `$5,000`, weekdays only, 9:00 a.m.–5:00 p.m. Central time, stop on recorded payment, sender/reply-to, test recipient, and optional assigned-staffer copy. The first-touch body says “due” while its trigger says “1 day past due”; use a neutral editable template until owner/client approves exact copy and timing. Payment links remain off until a Billing-owned payment URL is specified.

The initial migration leaves automation disabled and delivery mode `disabled`. This implementation has no executable email-delivery path. Any later test-recipient delivery must reject an unset/invalid recipient and must make it impossible to target a real client address. No live-client send mode is in scope without separate approval.

## Proposed API surface for frontend handoff

All routes are server-authorized. Exact response schemas and stable errors must be recorded in the handoff and covered by route tests.

| Endpoint | Purpose | Access |
| --- | --- | --- |
| `GET /api/collections/receivables` | Implemented: summary, invoice rows, client aggregates, aging, holds, credit-review flags, contact gaps, and priority sort | Billing or Collections module; Owner/Admin always |
| `POST /api/collections/automation/preview` | Implemented: side-effect-free proposed actions using a supplied/as-of date; scans all accounts in stable pages and paginates the returned actions | Owner/Admin |
| `GET /api/collections/rules` | Current ladder display subset: `stage`, `label`, `days_past_due`, `automatic`, `enabled` (no templates/secrets) | Billing/Collections read access |
| `PATCH /api/collections/rules` | Deferred: update approved thresholds, wording, and test settings | Owner/Admin only; audited transaction |
| `POST /api/collections/automation/run` | Deferred: protected scheduled job; no worker/provider send exists in this branch yet | Machine secret, not an app-user cookie |
| `GET /api/collections/deliveries` | Deferred: delivery attempts and suppression/failure history | Owner/Admin |

Exact TypeScript success/error response contracts are in `lib/collections-api.ts`. Receivables accepts `client_id?`, `as_of_date?`, `limit?` (default 100, 1–200), and `offset?` (default 0, max 100,000); its `pagination` object returns `limit`, `offset`, and `total_accounts`. Preview accepts JSON `{ as_of_date?, limit?, offset? }` (same limit/offset bounds), scans the account set in stable 200-account database pages rather than stopping at the top 200 priority rows, then returns a page of actions and `{ limit, offset, total_actions, has_more }`. Money is decimal strings, responses are `no-store`, and every error has a stable `code`.

Collections event and hold list/write responses include top-level `invoice_number` (null for account-level history). Database exception prefixes are not exposed to callers; API errors retain stable machine-readable `code` values with readable `error` text. `formal_notice_sent` records an already-sent notice; it is not a send operation. A current hold does not prevent recording this historical fact, but the event must reference a matching approval and include a note recording when/how the send occurred.

Error codes: receivables returns `UNAUTHENTICATED` (401), `FORBIDDEN` (403), `INVALID_CLIENT_ID`, `INVALID_AS_OF_DATE`, `INVALID_LIMIT`, or `INVALID_OFFSET` (422), and `COLLECTIONS_READ_MODEL_FAILED` (500). Preview returns `UNAUTHENTICATED` (401), `FORBIDDEN` (403), `INVALID_JSON` (400), `INVALID_INPUT`, `INVALID_AS_OF_DATE`, `INVALID_LIMIT`, or `INVALID_OFFSET` (422), and `PREVIEW_READ_FAILED` (500). Error bodies are `{ "error": string, "code": string }`.

## Persistence and atomicity

- Rules/templates, delivery attempts/outbox, and idempotency state persist in PostgreSQL under `tap_hub_project`; no client-controlled browser state is authoritative.
- An outbox row is unique per invoice and ladder stage. Retry updates the same row and never creates a second message. Delivery status is one of `queued`, `sending`, `sent`, `suppressed`, `needs_review`, or `failed`.
- Claiming due work is concurrency-safe (`FOR UPDATE SKIP LOCKED` or equivalent). Recheck payment, active hold, stage history, recipient quality, configured send window, minimum balance, and test-mode constraints at claim/send time.
- Outbox state changes and corresponding `collection_events`/`audit_log` evidence commit atomically when database-only. Provider sends occur outside DB transactions; provider message IDs and sanitized errors are retained, never tokens or full message bodies containing client PII.
- Tables have RLS enabled and no `anon`/`authenticated` direct access; service-role-only RPCs mediate reads/writes. App routes enforce role/module checks independently.

## Security, approval, and communication boundaries

- Only Owner/Admin can change rules, sender details, delivery mode, test recipient, or resolve data-quality/approval gates.
- The receivables endpoint intentionally exposes the selected primary contact's name, email, and phone only to Owner/Admin and staff assigned Billing or Collections. This is an operational Collections data boundary, not a general directory API. Phone-only clients remain on the human call list; preview actions retain the available phone number for internal follow-up, while missing/ambiguous email suppresses client-facing reminder candidates but not internal calls or Owner escalation review.
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

The conditional stage-history correction and the added safe rules display are pending Engineer A re-review before the contract can be treated as fully frozen. Production email delivery remains a separately gated change.
