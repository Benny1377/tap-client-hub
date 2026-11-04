# Billing Phase 1: Engineer A closeout acknowledgement

| Field | Value |
| --- | --- |
| Date | 2026-11-04 |
| From | Engineer A (Billing UI / workbench) |
| To | Engineer B, project owner |
| Closes | Engineer A's side of Phase 1 (BILL-DEP-03 cross-check) |
| Builds on | `docs/handoffs/2026-10-29-billing-phase1-engineer-a-acceptance.md` and `docs/handoffs/2026-11-02-billing-phase1-owner-validation.md` (`9ab70b5`) |
| Evidence tree | `codex/billing-phase1-ui`: `ae208d2` (matrix script), plus `9ab70b5` (owner validation) and `b871c6e` (sandbox baseline) merged |
| Scope | Local synthetic harness only. No hosted Supabase, sandbox, Preview or Production was touched for this acknowledgement |

## 1. Position

Engineer A acknowledges the Phase 1 backend and the owner-side validation record, and closes Engineer A's side of Phase 1. Two items in the 2026-10-29 acceptance are now closed by Engineer B's work:

| 2026-10-29 limitation | State |
| --- | --- |
| Concurrent allocations (R5) | Closed by `test-billing-allocation-concurrency.mjs` (`9ab70b5`): two $75.00 allocations against a $100.00 invoice, one accepted, one rejected, $75.00 active. Rerun by Engineer A on the merged tree: PASS |
| Stale SQL fixtures | Closed by the three fixture corrections in `9ab70b5`. Rerun by Engineer A: `test.sh --local` passes all six SQL checks on the merged tree |

## 2. Committed matrix result

`tools/collections-local/verify-billing-phase1-routes.mjs` at `ae208d2`, on the default local ports (app 3000, API 55321, database 55322), after a clean `reset.sh --local` and `create-test-users.mjs`, no overrides:

- **37/37 passed**, no failures. Repeated after a second clean reset: 37/37.
- It is authenticated HTTP against the running app (sign-in as Owner, Admin, Billing, Collections and unassigned staff), plus anon-key RLS checks and direct-database trigger checks.
- **It leaves synthetic rows**: after one run, 1 `LOCAL-V*` invoice (void), 3 lines, 1 payment (reversed), 1 allocation (reversed) and audit rows. `reset.sh --local` removes them all.
- This replaces the earlier 196298b / 583xx run as the documented result.

On the merged tree (`1839ed3`): `tsc --noEmit` clean, Billing UI tests pass, SQL regressions and the concurrency test pass.

## 3. What this does not close

1. **Engineer B's own run of the HTTP matrix.** The owner validation record lists the authenticated matrix as not run by the owner. The script is committed; BILL-DEP-03 is Engineer B's to record.
2. **Hosted behaviour.** Nothing here was run on the sandbox, a Vercel Preview or Production. The sandbox baseline (`b871c6e`) is integrated on the branch as files only; Engineer A has not applied it, verified its migration state or bucket, provisioned a sandbox Owner or run the A/R upload and parse flow. The matrix script refuses any target that is not the local harness, so it cannot be pointed at the sandbox.
3. **Phase 3 delivery validators** were not rerun.
4. **Money in responses.** Phase 1 routes still return `numeric` columns as JSON numbers. Phase 2 endpoints are to return decimal strings.
5. **Repository-wide lint** has a failing baseline outside Billing (568 problems per the owner record).

## 4. Merge position

- **Technically clean.** `codex/billing-phase1-ui` merges into `origin/dev` with no conflicts (checked with a tree-only merge; nothing was merged into `dev`).
- **Not authorized.** The owner validation record does not approve the merge, and neither does this acknowledgement. Engineer A has merged nothing into `dev` or `main`.
- **Open before it:** the owner's decision to merge; confirmation that `dev` does not auto-apply migrations to a hosted database; and the owner's decision on `main`, which is 14 commits apart from `dev` with conflicts in `lib/access-server.ts` and two test files.

## 5. Phase 2

Unchanged from `docs/handoffs/2026-11-02-billing-phase2-engineer-a-acknowledgement.md`: the contract is accepted subject to its six conditions, and no Phase 3 workbench screen is started until the endpoint shapes are frozen.
