# Contract: Billing Project Foundation

State: **Frozen — project owner confirmed 2026-10-24 after Engineer A's acknowledgement at `efc8be2`.**

- Producer: Billing backend owner (schema, routes/RPCs, access policy, tests).
- Consumer: Billing UI owner; Collections and Client 360 consumers of Billing read models.
- Decision basis: `docs/decisions/2026-10-19-billing-project-foundation.md` and existing Collections/Billing contracts.

## Capability boundary

Billing owns native client pricing, billable candidates, invoices, lines, payments, allocations, receivables, and audit history. Operations owns clients, enrollment, cadence, and completion facts. Collections consumes receivables and never changes native ledger amounts. Client 360 consumes read models and never recomputes balances. A/R Intake retains reviewed external snapshots separately; it can inform Collections but cannot write native Billing data.

Excluded: bank feeds/login storage, payment processing, QuickBooks API/OAuth, tax/interest/late-fee/credit/write-off behavior, client portal, outbound invoice delivery, and `billing_periods` backfill without a new approved decision.

## Invariants

- Store money as database `numeric`; transport decimal strings or integer cents, never JavaScript floating point.
- Issued invoices are immutable; corrections void/reissue. Payments and allocations reverse rather than delete.
- Totals, paid state, balances, and aging are server-derived read models; consumers never recompute them.
- A billable candidate is not an invoice until a user creates or confirms a draft.
- An issued invoice snapshots remittance instructions.
- Remittance settings contain only the payment instructions deliberately intended for the invoice recipient. They never contain banking credentials; their values are not emitted in audit/error logs. Owner/Admin may change them, and the issue RPC reads and snapshots them server-side.
- Native Billing and external A/R Intake remain separate; a matched-source discrepancy blocks Collections action until authorized, audited resolution.
- Multi-row financial mutations use one database transaction/RPC and write audit data in that transaction.
- The database, not only a route, rejects issued-invoice line changes, line amounts that differ from `quantity × unit_amount`, and a void when active payment allocations exist.
- A draft is deleted only by an audited RPC and only if it is unissued, unallocated, and unreferenced by Collections history.

## Identity and permission boundary

Every Billing API resolves authenticated identity and checks module access server-side. Billing pages are client components: `proxy.ts` confirms a session cookie, the shell resolves the viewer through `/api/me`, and no Billing data is rendered without an authorized API response.

| Action | Initial authorization | Configurable? |
| --- | --- | --- |
| View Billing read models | Owner/Admin or assigned Billing/Collections user | Yes, within module access |
| Maintain pricing and billable rules | Owner/Admin or delegated Billing permission | Yes |
| Create/update draft; issue invoice | Owner/Admin or assigned Billing user | Yes |
| Record/allocate payment | Owner/Admin or assigned Billing user | Yes |
| Void invoice; reverse payment/allocation | Owner/Admin | No — reserved server-enforced action |
| Change permission policy | Owner/Admin | No — reserved server-enforced action |

Policy configuration cannot weaken database invariants, RLS, server authentication, immutable audit requirements, or collection approval separation of duties.

The policy is persisted as a single Billing action-policy record following the existing Collections permission-policy pattern. It has only these fixed keys: `billing.view`, `pricing.view`, `pricing.manage`, `candidates.view`, `candidates.manage`, `invoices.draft.manage`, `invoices.issue`, `invoices.void`, `payments.record`, `payments.allocate`, `payments.reverse`, `settings.remittance.manage`, `settings.terms.manage`, and `policy.manage`. The record must not grant `policy.manage`, `invoices.void`, or `payments.reverse`: those fixed keys always resolve to Owner/Admin and the server enforces that restriction. Delegating invoice voids or payment reversals in a later phase requires a new owner decision.

Server-side permission resolution combines authenticated role, assigned modules, and enabled policy actions. `GET /api/billing/permissions` returns the resolved set solely for UI presentation. Billing staff receive price visibility but not `pricing.manage` by default; Owner/Admin may explicitly enable it. Collections-only access excludes every price-bearing field.

## Candidate, price, and invoice defaults

- A billable candidate is uniquely identified by `client_service_id`, candidate type, and a schedule-occurrence key or Operations completion-event ID. The database rejects a duplicate identity.
- Candidate states are `unpriced`, `open`, `drafted`, `dismissed`, and `invoiced`. Dismissal records a reason and an authorized reopen. The create-draft RPC claims selected `open` candidates atomically. Deleting a linked draft or voiding a linked invoice returns its candidates to `open`.
- Candidate-to-line provenance is a junction relation, rather than a single foreign key, so one package line can represent multiple candidates while retaining each candidate's audit trail.
- Resolve price for the candidate date in this order: active client bundle; active client-service override; active matching rate-card entry; otherwise mark the candidate `unpriced` and block invoice creation.
- A recurring candidate uses its service-period end as candidate date; a one-off uses its configured completion date. An `open` candidate can be repriced by current effective rules, but the create-draft RPC copies the resolved amount and provenance immutably to its line. Later price changes never rewrite that draft or an issued invoice. A bundle renders as one package line while its components remain linked through the provenance junction.
- Drafts have no invoice number. The issue RPC allocates `TAP-YYYY-####` by issue-date year, resets the sequence annually, and never reuses a voided number. Existing local drafts with provisional numbers are migrated to null.
- Default terms are Net 15 with a client-level override. Recurring billing defaults to the final calendar day of the configured service period, with a client/service override. The firm date/timezone is Houston, Texas (`America/Chicago`) from `collection_settings.timezone`. One-off billing starts only after its configured completion event.

## Operations sources and reconciliation scope

- Active `client_services`, joined to `services`, supply service enrollment and cadence. Billing rules derive recurring schedules; `work_periods` (`stage = done`, `done_at`), `period_counts`, or explicit manual confirmation can supply configured one-off completion evidence.
- An unmapped one-off service produces no candidate. The client-specific source map remains required before its Phase 2 implementation.
- Manual reconciliation is UI over native payment/allocation APIs. A future suggestion endpoint is read-only and no new deposit entity is introduced.
- Invoice void requires a non-empty reason. `GET /api/billing/invoices` supports status, client, and date filters.

## Phased delivery

| Phase | Outcome | Required evidence |
| --- | --- | --- |
| 0 — Integration baseline | Use `codex/security-fixes` at `6859607`; reconcile ancestry, migrations, APIs, UI, and tests; assign path ownership | Shared inventory and accepted merge/implementation sequence; no duplicate work |
| 1 — Native ledger release | Validate existing invoice/payment/allocation/audit/receivables foundation | Local synthetic schema/RPC/API/access/audit/RLS evidence |
| 2 — Pricing and candidates | Rate card, overrides/bundles, effective dates, recurring schedules, and configured one-off completion triggers in one delivery | Frozen API contract, synthetic Operations fixtures, and candidate source/amount evidence |
| 3 — Workbench and reconciliation | Draft-to-issue UI, remittance settings, manual payment/reconciliation | UI → API → database → reload and role-session evidence |
| 4 — Deferred integrations | Consider delivery, processor/bank feed, portal, QuickBooks API separately | New approved contract |

## API, refresh, and validation

- Every error response is `{ error: string, code: UPPER_SNAKE_CASE }`; the HTTP status remains authoritative (`401`, `403`, `404`, `409`, `422`, or `500`) and `code` is the stable machine-readable reason.
- Refetch the affected candidate, invoice, client receivables, and aging after every mutation. No optimistic balance arithmetic.
- Source-aware Collections payloads identify `billing` or `pdf_import`; native Billing writes never accept a PDF row as a ledger record.
- Use synthetic local fixtures only. Never use real A/R PDFs, bank data, payment data, or credentials in fixtures, screenshots, or shared environments.
- Hosted migrations, production writes, client communication, and live payment/bank integrations need separate project-owner approval.
