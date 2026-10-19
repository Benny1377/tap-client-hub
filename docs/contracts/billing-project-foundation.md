# Contract: Billing Project Foundation

State: **Draft — owner decisions approved 2026-10-19; freeze after Engineer A and Engineer B review.**

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
- Native Billing and external A/R Intake remain separate; a matched-source discrepancy blocks Collections action until authorized, audited resolution.
- Multi-row financial mutations use one database transaction/RPC and write audit data in that transaction.

## Permission boundary

Every page and API resolves authenticated identity and checks module access server-side.

| Action | Initial authorization | Configurable? |
| --- | --- | --- |
| View Billing read models | Owner/Admin or assigned Billing/Collections user | Yes, within module access |
| Maintain pricing and billable rules | Owner/Admin or delegated Billing permission | Yes |
| Create/update draft; issue invoice | Owner/Admin or assigned Billing user | Yes |
| Record/allocate payment | Owner/Admin or assigned Billing user | Yes |
| Void invoice; reverse payment/allocation | Owner/Admin | Not initially delegated |
| Change permission policy | Owner/Admin | No |

Policy configuration cannot weaken database invariants, RLS, server authentication, immutable audit requirements, or collection approval separation of duties.

## Phased delivery

| Phase | Outcome | Required evidence |
| --- | --- | --- |
| 0 — Integration baseline | Reconcile target branch, ancestry, migrations, APIs, UI, and tests; assign path ownership | Shared inventory and accepted merge/implementation sequence; no duplicate work |
| 1 — Native ledger release | Validate existing invoice/payment/allocation/audit/receivables foundation | Local synthetic schema/RPC/API/access/audit/RLS evidence |
| 2 — Pricing and candidates | Rate card, overrides/bundles, effective dates, configurable trigger map, candidate review | Frozen API contract and candidate source/amount evidence |
| 3 — Workbench and reconciliation | Draft-to-issue UI, remittance settings, manual payment/reconciliation | UI → API → database → reload and role-session evidence |
| 4 — Deferred integrations | Consider delivery, processor/bank feed, portal, QuickBooks API separately | New approved contract |

## API, refresh, and validation

- Mutations return stable `401 unauthenticated`, `403 forbidden`, `404 not_found`, `409 invariant_violation`, or `422 invalid_input` errors.
- Refetch the affected candidate, invoice, client receivables, and aging after every mutation. No optimistic balance arithmetic.
- Source-aware Collections payloads identify `billing` or `pdf_import`; native Billing writes never accept a PDF row as a ledger record.
- Use synthetic local fixtures only. Never use real A/R PDFs, bank data, payment data, or credentials in fixtures, screenshots, or shared environments.
- Hosted migrations, production writes, client communication, and live payment/bank integrations need separate project-owner approval.
