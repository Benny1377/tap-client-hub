# Billing Phase 2: Engineer A freeze acknowledgement

| Field | Value |
| --- | --- |
| Date | 2026-11-05 |
| From | Engineer A (Billing UI / workbench) |
| To | Engineer B, project owner |
| Accepts | `docs/contracts/billing-phase-2-pricing-and-candidates.md` and `docs/handoffs/2026-11-02-billing-phase2-owner-response.md` on `codex/billing-phase2-prep` at **`86f65ef`** |
| Follows | `docs/handoffs/2026-11-04-billing-phase2-engineer-a-freeze-review.md` (`33794e2`) |
| Scope | Documentation only. No Phase 2 migration, route or UI is built or authorized by this acknowledgement |

## 1. Position

Engineer A accepts the exact revision `86f65ef` as the Phase 2 contract. Paths, request and response shapes, camelCase field names, permission keys, error codes and cursor rules in it are **frozen for the UI-facing boundary**. The contract can be marked frozen when Engineer B and the owner record it.

One gate stays open and is not cleared by this acknowledgement: **Operations adapter work remains blocked** until the Operations owner supplies the schema-only export described in section 3.

## 2. The six clarifications from the freeze review

All six are written into the contract at `86f65ef` as requested.

| # | Clarification | State |
| --- | --- | --- |
| C1 | Casing and the legacy adapter | Closed. Phase 2 is camelCase. The deprecated `POST /invoices/[id]` adapter keeps the Phase 1 snake_case response, so the current UI needs no change before the cutover |
| C2 | Removing a candidate-linked line | Closed. `DELETE /invoice-lines` with the id in the body returns `returnedCandidateIds` and refresh targets; `PATCH` returns 409 `CANDIDATE_LINKED_LINE_IMMUTABLE` |
| C3 | Terms overrides | Closed. `POST /settings/terms/overrides` and `PATCH /settings/terms/overrides/[id]`, with client-service over client over firm-default precedence |
| C4 | Paging | Closed. One opaque cursor mechanism; candidates sort by date then id descending, rate cards and bundles by name then id ascending |
| C5 | Generate accounting | Closed. Skip reasons `no_map`, `map_disabled`, `source_incomplete`, `outside_window`; an unpriced candidate counts as created and is also counted as `unpriced` |
| C6 | Permissions for non-Billing sessions | Closed. Collections-only and unassigned sessions get 403 from `GET /permissions` |

## 3. Still open: Operations schema

The contract now records, correctly, that the integer `YYYYMM` assumption is superseded and that no Operations adapter work starts until the Operations owner supplies a schema-only export of `client_services`, `services`, `work_periods` and `period_counts` (column names, types, nullability, keys, constraints; no rows, credentials or secrets). Engineer A agrees. This does not change any UI-facing shape.

## 4. What Engineer A does next

Phase 3 planning against the published examples, in this order: Invoices (draft from candidates, issue, void, line rules), What bills next, Clients & prices, then Settings and completion-rule configuration. Engineer A starts no screen until the freeze is recorded and the matching endpoint exists to build and test against. Phase 2 server work stays with Engineer B.

UI changes that follow from the frozen contract and are not yet built:

- the new-draft form drops the invoice number and dates and creates through `POST /invoices` (`clientId`, optional `memo`) or from candidates;
- issue and void move to `/issue` and `/void`, and the screen shows the number the server assigns;
- candidate-linked lines are locked, with a remove action that explains the candidates return to `open`;
- plain wording for the eleven new error codes;
- controls shown from `GET /permissions`, for presentation only.

## 5. Not covered here

Hosted behavior, the sandbox A/R Preview validation, and the Phase 3 delivery validators are tracked elsewhere. Phase 1 closeout is in `docs/handoffs/2026-11-04-billing-phase1-engineer-a-closeout.md`; Engineer B's own matrix run is recorded in his 2026-11-02 owner validation record (`8f3f952`).
