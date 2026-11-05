# Billing Phase 2: Engineer A revalidation of `b630f2a`

| Field | Value |
| --- | --- |
| Date | 2026-11-05 |
| From | Engineer A (Billing UI / workbench) |
| To | Engineer B, project owner |
| Reviews | `codex/billing-phase2-prep` at `b630f2a` (fixes for the findings in `2026-11-05-billing-phase2-engineer-a-validation.md`) |
| Evidence branch | `codex/billing-phase2-matrix` (= `b630f2a` + the matrix and fixture repairs) |
| Scope | Local synthetic harness only (app 3000, API 55321, database 55322). No sandbox, Preview, hosted or Production system was touched. No credentials appear in this record |
| Outcome | **Local matrix passes in full (89/89).** Phase 2 is not yet accepted as complete: the hosted-data items in section 3 are open |

## 1. What was run

Clean `reset.sh --local` (now including `20261105110000_billing_manual_confirmation_guard.sql`), `create-test-users.mjs`, `npm run dev`.

| Check | Result |
| --- | --- |
| `verify-billing-phase2-routes.mjs`, one run per reset | **89/89 passed**, 1 informational line (F3, bundle component amounts) |
| `test.sh --local` | PASS |
| `supabase/tests/billing_phase2_core.sql` | PASS |
| `validate-billing-phase1-invariants.sql` | PASS |
| `test-billing-allocation-concurrency.mjs` | PASS |
| `billing-phase2-operations` and `billing-phase2-serialization` unit tests | 15/15 PASS (`--experimental-strip-types`) |
| `tsc --noEmit` | PASS |

The matrix grew from 87 to 89 checks: B1 and B3 now use the contract's updated examples (with `reason`), B1b asserts that a missing `reason` is 422, and D7 is now an assertion (`422 CONFIRMATION_DATE_FUTURE`) instead of an informational line.

## 2. Findings from the first record

| # | Status | Evidence |
| --- | --- | --- |
| 1 Adapters ignore text `YYYY-MM` periods | Fixed locally | C18, C19 pass |
| 2 Manual confirmation duplicate / future date | Fixed | D6, D7 pass |
| 3 Bundle response shape, audit columns | Fixed | B13 passes |
| 4 Legacy draft PATCH returned 500 | Fixed | E4 passes |
| 5 Malformed UUIDs returned 500 | Fixed | E5 and probes pass |
| 6 `reason` on rate-card create | Resolved on the contract side | B1, B1b, B3 pass |
| 7 `auditId` by timestamp query | Not addressed (Low, code reading) | none |
| 8 `reprice` reopens dismissed candidates | Fixed in code (`CANDIDATE_NOT_OPEN`); not exercised by the matrix | code reading |
| 9 Issue/void RPCs lack in-database role check | Not addressed (Low) | none |

The contract now documents the manual-confirmation and policy endpoints and the extra error codes, and states that `/permissions` is readable by any Billing-assigned user so a revoked `billing.view` still shows as revoked.

## 3. Still open

- **Operations schema export.** Finding 1 is fixed against the local fixture and unit tests. The sandbox period columns are declared text and are empty, so the real format is still unverified. The contract still holds adapter work until the Operations owner supplies the export.
- **Hosted run.** Nothing here ran against the Vercel Preview or the shared sandbox. That needs the Preview URL, four more sandbox accounts, a sandbox variant of the matrix, and approval to create synthetic Operations rows.
- Findings 7 and 9: decide or fix. Finding 8: add a matrix check.
- **Harness fix.** `tools/collections-local/reset.sh` has a hard-coded migration list that did not include `20261105110000`, so a reset silently omitted the new guard until it was added on our branch. Please keep that list in step with new migrations.

## 4. Position

The local backend behaviour now matches the contract on every check we have. Engineer A will accept Phase 2 backend completion once the hosted run passes and the Operations export confirms the period format.
