# Contract: Collections Phase 1 Billing Ledger

State: **Draft**. Not frozen for implementation.

- Producer: Engineer B (routes, Supabase, access policy, migrations).
- Consumer: Engineer A (Billing and Collections UI).
- Reviewers and approval date: NOT YET REVIEWED.
- Decision basis: `docs/decisions/2026-10-06-collections-billing-source-of-truth.md`.

## Capability boundary

In scope:

- A TAP Hub Billing ledger: invoices, invoice lines, payments, and payment allocations.
- Collections state derived from that ledger: holds and an append-only event log.
- External ID storage for a later QuickBooks phase.
- Audit records for every ledger and Collections mutation.

Excluded:

- QuickBooks sync, OAuth, webhooks, or tokens.
- Automated email or letter delivery to clients.
- Online payment processing.
- Changes to or backfill of `billing_periods`.
- Client 360 UI.
- Tax, interest, or late-fee calculation.

## Required entities

Field lists are proposals. Final column types depend on the hosted schema inspection; in particular, `client_id` must match the hosted `clients.id` type. Money is `numeric(12,2)` in USD and is never handled as a JavaScript float.

| Entity | Purpose | Key fields | Invariants |
| --- | --- | --- | --- |
| `invoices` | What a client is billed | `id`, `client_id`, `invoice_number` (unique), `status` (`draft`, `issued`, `void`), `issue_date`, `due_date`, `memo`, `created_by`, `created_at`, `voided_by`, `voided_at`, `void_reason` | Lines are editable only in `draft`. An issued invoice is corrected by voiding it and reissuing, never by editing it. Paid state is derived from allocations, not stored. |
| `invoice_lines` | What makes up an invoice | `id`, `invoice_id`, `client_service_id` (nullable), `period` (`YYYY-MM`, matching `work_periods.period`), `description`, `quantity`, `unit_amount`, `amount`, `sort_order` | `amount = quantity × unit_amount`, rounded half-up to cents. The invoice total is the sum of its lines. |
| `payments` | Money received | `id`, `client_id`, `received_on`, `amount` (> 0), `method` (`check`, `ach`, `wire`, `card`, `cash`, `other`), `reference`, `status` (`recorded`, `reversed`), `reversed_by`, `reversed_at`, `reversal_reason`, `created_by` | A payment is reversed, never deleted. |
| `payment_allocations` | How a payment pays invoices | `id`, `payment_id`, `invoice_id`, `amount` (> 0), `created_by`, `created_at`, `reversed_at` | The payment and invoice belong to the same client. Total active allocations never exceed the payment amount or the invoice total. No allocation to a `void` or `draft` invoice. These rules are enforced in the database, not only in the UI. |
| `external_account_ids` | Mapping for later sync | `id`, `entity_type` (`client`, `invoice`, `payment`), `entity_id`, `system` (for example `quickbooks_online`), `external_realm`, `external_id`, `created_at` | Unique on (`system`, `external_realm`, `entity_type`, `external_id`). Stores identifiers only, never tokens, secrets, or credentials. |
| `collection_holds` | Pause Collections activity | `id`, `client_id`, `invoice_id` (nullable), `reason`, `placed_by`, `placed_at`, `expires_on`, `released_by`, `released_at` | An active hold blocks escalation and formal notices for its scope. |
| `collection_events` | Collections history | `id`, `client_id`, `invoice_id` (nullable), `event_type`, `stage`, `occurred_at`, `actor`, `detail` (jsonb), `approves_event_id` (nullable) | Append-only. Event types: `note`, `reminder_logged`, `call_logged`, `promise_to_pay`, `escalation_requested`, `escalated`, `formal_notice_requested`, `formal_notice_approved`, `formal_notice_sent`, `hold_placed`, `hold_released`. |
| Audit records | Who changed what | `actor`, `action`, `entity`, `entity_id`, `before`, `after`, `at` | Written in the same transaction as the mutation. The target table (the existing `audit_log` or a dedicated ledger audit table) is decided after the hosted `audit_log` shape is inspected. |

These are derived read models, never stored balances:

- `invoice_balances`: total, allocated, balance, days past due.
- `client_receivables_aging`: current, 1-30, 31-60, 61-90, and 90+ days.

Consumers must display these values and must not recompute them.

## Operations (outline; inputs and outputs are frozen at contract review)

| Operation | Allowed roles |
| --- | --- |
| Create or update a draft invoice | Owner/Admin and users assigned Billing |
| Issue an invoice | Owner/Admin and users assigned Billing |
| Void an invoice | Owner/Admin only (proposed) |
| Record a payment | Owner/Admin and users assigned Billing |
| Allocate a payment | Owner/Admin and users assigned Billing |
| Reverse a payment or allocation | Owner/Admin only (proposed) |
| List invoices, payments, and balances | Owner/Admin and users assigned Billing or Collections |
| Log a Collections note, reminder, call, or promise to pay | Owner/Admin and users assigned Collections |
| Request escalation or a formal notice | Owner/Admin and users assigned Collections |
| Escalate, or approve a formal notice | **Owner/Admin only** |
| Place or release a hold | Owner/Admin only (proposed) |

Ledger writes that touch more than one row run inside a single Postgres function (RPC) so that the invariants and the audit write commit atomically. The Supabase JS client cannot do multi-statement transactions.

## Authentication and approval boundaries

- Every route calls `resolveAccessIdentity()` and checks access on the server. The pattern is `app/api/credentials/route.ts:15-21`.
- Owner/Admin-only actions check `isPowerUser(identity.role)` on the server. Being assigned the Billing or Collections module never grants them.
- Managers are not power users and receive no escalation or approval authority.
- New tables enable RLS and grant nothing to `anon`. Writes go only through server routes.
- Project-owner approval is required for:
  - the migration and its target project;
  - any production write or backfill;
  - Vercel or Supabase configuration changes;
  - sending any formal notice or other client communication.

  Phase 1 records that a notice was approved or sent. It does not send anything.

## Validation, errors, and refresh

- Stable errors: `401 unauthenticated`, `403 forbidden`, `404 not_found`, `409 invariant_violation` (over-allocation, edit of an issued invoice, action blocked by a hold), and `422 invalid_input`.
- A `409` is not retryable without changed input.
- After any ledger mutation, consumers refetch the affected invoice, the client balances, and the aging. No optimistic balance math.
- Fixtures, test files, environments, and limitations are not yet defined. They are required before the contract moves to `Frozen for implementation`.

## Phase 1 implementation risks

| ID | Risk | Required handling |
| --- | --- | --- |
| R1 | `proxy.ts` treats `/api/` as public. `resolveAccessIdentity()` also accepts the unsigned `tap_demo_user` cookie and resolves it to a profile by full name (`lib/access-server.ts:40-42`, `71-74`). From reading the code, that could give a caller another user's role, including Owner. Not exploited or verified live. | Resolve and test this before any Owner/Admin-only financial action ships. Track it separately as a security fix. |
| R2 | The hosted shapes of `billing_periods`, `clients.id` (`uuid` vs `text`), and `audit_log` are unknown. | Approved read-only hosted inspection before the migration is drafted. |
| R3 | No forward-only migration location has been chosen; four exist. | Project-owner decision before the migration is drafted. Do not add a fifth location. |
| R4 | Migration 006 granted full DML to `anon`, and that pattern may be copied. | Enable RLS, grant nothing to `anon`, and test a forbidden write with the anon key. |
| R5 | Concurrent allocations could over-allocate. | Enforce in the database under row locks; add a concurrency test. |
| R6 | Nested `/billing/*` and `/collections/*` routes are denied for all roles. | Add prefix matching in `moduleForPathname()` with regression tests. |
| R7 | Registering a module exposes it to Owner/Admin immediately, including a half-built page. | Register Collections in the same change that ships its page. |
| R8 | Floating-point money errors. | Use `numeric` in the database and strings or integer cents in API payloads; test rounding. |
| R9 | `audit_log` has two conflicting shapes and no application writer. | Choose the audit target after inspection; write audits inside the ledger RPC. |
| R10 | `tests/regression-access-policy.mjs` needs `typescript`, and dependencies are not installed. | Approve `npm install` before Phase 1 validation. |

## Phase 1 validation requirements

Validation follows `docs/quality/TESTING_PROTOCOL.md`, with each result recorded as `PASS`, `FAIL`, `BLOCKED`, `DEFERRED`, or `NOT RUN`:

1. Access policy:
   - Owner and Admin can reach Billing and Collections, including nested routes.
   - Assigned staff can reach only their assigned module.
   - Unassigned staff and managers get 403 on page and API.
   - Collections assignment is no longer dropped.
2. Approval boundary: escalation and formal-notice approval return 403 for staff and managers who have the Collections module, and succeed for Owner/Admin.
3. Ledger invariants:
   - over-allocation, a cross-client allocation, an edit of an issued invoice, and an allocation to a void invoice each return 409;
   - a concurrent allocation test leaves no over-allocation.
4. Persistence: UI input, API response, database row, the audit row, reload, and rollback, for one invoice, payment, allocation, and Collections event.
5. RLS: the anon key cannot select or write any new table.
6. Release checks: `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run test:support`, and the access regression suite.
