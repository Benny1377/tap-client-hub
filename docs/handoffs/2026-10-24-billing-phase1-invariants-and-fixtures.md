# Billing Phase 1: database invariants and local Operations fixtures

| Field | Value |
| --- | --- |
| Date | 2026-10-24 |
| From | Engineer B (Billing backend) |
| To | Engineer A (Billing workbench) |
| Branch | `codex/billing-phase1-validation` |
| Base | `codex/security-fixes` at `6859607`, merged with the frozen Billing planning branch |
| Scope | Local synthetic validation and database protections; no hosted migration, production access, or external provider work |

## Delivered changes

- Forward-only migration `20261020100000_billing_ledger_database_invariants.sql` enforces three ledger rules in PostgreSQL: issued invoice lines cannot change, `amount` must equal `round(quantity × unit_amount, 2)`, and an issued invoice with active allocations cannot be voided.
- The invoice-line API now calculates amount with decimal-string integer arithmetic, supports the schema's four-decimal quantity precision, and maps database invariant failures to `409` responses.
- The local reset seeds issued invoices by creating their lines while draft first, then issuing them.
- The local-only Operations fixture schema and seed data add active service enrollment, recurring cadence, completed/not-completed `work_periods`, and completed/pending `period_counts`. They are confined to `tools/collections-local` and do not alter hosted schema state.

## Local evidence

1. `bash tools/collections-local/reset.sh --local` completed against the disposable local stack.
2. `psql ... -f tools/collections-local/validate-billing-phase1-invariants.sql` passed. The probe proves direct database writes cannot bypass the amount, issued-line, or active-allocation void invariants.
3. `node tests/collections-phase1-review.test.mjs` and `node tests/collections-phase-2-backend-contract.test.mjs` passed.
4. Targeted lint passed for both changed Billing routes.

## Remaining validation limitation

The full `npm run typecheck` reaches an existing repository-level failure: no declaration is available for `pdfjs-dist/legacy/build/pdf.mjs` in `lib/collections-pdf-parser.ts`. The changed Billing files produced no TypeScript errors before that unrelated failure. This handoff is not a Phase 1 release claim until the agreed local API/access/audit matrix is rerun and the repository-level typecheck blocker is resolved or formally waived.

## Engineer A impact

No new Phase 3 endpoint shape is introduced. Existing line mutations continue to use the same request fields, but amount is now server-derived from `quantity` and `unit_amount`; clients must never submit or calculate it. A `409` with `LINE_INVARIANT_VIOLATION` or `ACTIVE_PAYMENT_ALLOCATION` is a conflict state to display and refetch.
