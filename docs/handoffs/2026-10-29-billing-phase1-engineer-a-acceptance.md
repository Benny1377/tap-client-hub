# Billing Phase 1: Engineer A acceptance

| Field | Value |
| --- | --- |
| Date | 2026-10-29 |
| From | Engineer A (Billing UI / workbench) |
| To | Engineer B, project owner |
| Responds to | `docs/handoffs/2026-10-24-billing-phase1-invariants-and-fixtures.md` on `codex/billing-phase1-validation` at `73f4d2a` |
| UI evidence | `codex/billing-phase1-ui` at `0e20241`: restyle (`08b97e5`, `ea7ac12`), Phase 1 backend merged, UI follow-ups (`0e20241`) |
| Scope | Local synthetic harness only. No hosted Supabase, production data, provider or deployment |
| Outcome | **Engineer A accepts the Phase 1 backend handoff** with the limitations in section 4. BILL-DEP-03 closes when Engineer B records the matrix in section 3 as his own |

## 1. What was checked and how

Everything ran against a clean local reset (`reset.sh` with the `73f4d2a` migration list and seed, then `create-test-users.mjs`), with the app on the merged tree. Ports on the local harness were moved to 583xx for this machine because Windows reserved the 553xx range; that change is not committed.

| Check | Result |
| --- | --- |
| `validate-billing-phase1-invariants.sql` (rolled-back transaction) | PASS |
| Independent route matrix, 37 checks (section 2) | 37/37 |
| `validate-phase2.mjs` (ledger and Collections through real routes) | 68/68 |
| `validate-phase4.mjs` (A/R report intake) | 38/38 |
| Unit and source-contract tests | 115/115 |
| `tsc --noEmit` and `eslint` on changed files | Clean |
| UI in a browser, Owner and Billing-staff sessions | See section 2 |

The earlier regression in `779a8fb` (deleting a draft invoice that has lines failed because the new line trigger fired during the cascade) was reported and fixed in `73f4d2a`. It now has a validator case and passes on the routes (D1 below).

## 2. Independent route matrix (37 checks)

- **Access:** signed-out reads and writes return 401. Staff with no Billing or Collections module cannot read the ledger (403). Collections staff can read invoices but cannot create one (403). Billing staff create drafts, add lines, issue, record payments and allocate. Billing staff cannot void or reverse (403).
- **Line amounts:** the amount is derived on the server, a client-sent `amount` is ignored, `1.2345 × 10.00` gives `12.35`, `3 × 0.15` gives `0.45`. A quantity or amount beyond the columns returns 422 `AMOUNT_OUT_OF_RANGE`. A zero quantity returns 422.
- **Immutability:** adding, editing or deleting a line on an issued invoice returns 409 through the routes, and direct database writes are rejected by the new triggers (edit of an issued line, insert on an issued invoice, a draft line whose amount differs from `quantity × unit_amount`).
- **Draft delete:** deleting a draft with lines succeeds and removes the lines. Deleting an issued invoice through the route is refused.
- **Void:** void without a reason or with a blank reason returns 422 `VOID_REASON_REQUIRED`. A void with an active allocation returns 409 `ACTIVE_PAYMENT_ALLOCATION`. After Admin reverses the allocation the void succeeds with its reason stored. Allocating to a void invoice returns 409.
- **RLS:** the anon key cannot read `invoices`, `invoice_lines`, `payments` or `payment_allocations` and cannot write invoices (all 401).
- **Audit:** audit rows exist for the invoice lifecycle and the void reason is recorded.

Browser checks on the merged UI:

- **Billing staff:** the three tabs render, void is not offered (the page says it needs Owner/Admin), a draft can be created, a line with quantity `1.2345` and unit `10.00` is saved at `$12.35`, and a five-decimal quantity is refused before any request with a plain message.
- **Owner:** a blank void reason is refused before the request. A void on an invoice with a payment applied shows a warning first, then the server's refusal with plain wording, and the invoice stays issued.
- **Not checked in a browser:** the Collections-only and unassigned roles (checked at API level only, A3 to A5 above), and a phone-width layout.

## 3. Matrix for Engineer B to record as his own

BILL-DEP-03 is Engineer B's item. The checks in section 2 were written by Engineer A to give an independent second view; they do not replace Engineer B's recorded authorization, RLS, audit and migration matrix. The script is local and not committed; Engineer A will share it on request.

## 4. Limitations and what was not covered

1. **Concurrency.** Two allocations to one invoice at the same moment were not rerun. The Phase 1 contract's concurrency risk (R5) should be evidenced by Engineer B.
2. **Collections delivery.** The Phase 3 delivery validators were not rerun.
3. **Hosted.** Nothing was run against hosted Supabase, and the hosted schema, grants and RLS (including the older `006` grants) remain unverified.
4. **Money in responses.** Route responses return the database `numeric` columns as JSON numbers (for example `amount: 12.35`), not strings. The UI formats them without arithmetic, but the foundation contract says transport decimal strings or integer cents. Existing Phase 1 routes are unchanged by this acceptance; new Phase 2 endpoints should return strings (see the Phase 2 review).
5. **`pdfjs-dist` typecheck.** The error reported in the Phase 1 handoff does not reproduce on this machine: `tsc --noEmit` passes on the merged tree. It may depend on the local `node_modules`.
6. **Typecheck and lint scope.** Lint was run on the changed files only; the repository still has many unrelated lint errors.

## 5. UI changes made for Phase 1 (on `codex/billing-phase1-ui`)

- Line quantity validates to four decimals and the column size limits; unit amount to two decimals and its limit.
- Plain wording for `LINE_INVARIANT_VIOLATION`, `ACTIVE_PAYMENT_ALLOCATION`, `VOID_REASON_REQUIRED` and `AMOUNT_OUT_OF_RANGE`.
- The void control warns when payments are still applied. The void reason was already required in the form.
- Tests added for the validation, the wording and the void warning. The UI sends no line amount and computes no balance.

## 6. Branches

`codex/billing-phase1-ui` is built from the restyle branch with `73f4d2a` merged, so it carries the UI and Phase 1 backend together. `codex/billing-phase2-prep` was cut from `73f4d2a` and does not contain the restyle or the UI follow-ups. Merge order into the shared base is for Engineer B and the owner to decide; nothing here has been pushed to `dev` or `main`.
