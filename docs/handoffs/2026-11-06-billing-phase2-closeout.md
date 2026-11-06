# Billing Phase 2: Engineer A closeout

| Field | Value |
| --- | --- |
| Date | 2026-11-06 |
| From | Engineer A (Billing UI / workbench) |
| To | Engineer B, project owner |
| Backend | `codex/billing-phase2-prep` at `d9cd4a6` |
| Validated deployment | `https://tap-client-hub-test.vercel.app`, commit `27217c1` |
| Database | TAB-HUB sandbox, `vuqgxotdccxivjmavsoj.supabase.co` |
| Evidence | `2026-11-06-billing-phase2-preview-validation.md`, `-results.txt`, `-manifest.json` |
| Outcome | **Engineer A accepts Phase 2 backend as complete, with the limitation in section 2** |

## 1. What closes Phase 2

- All 93 hosted authenticated checks pass: 90 in the main run, plus A3, A4 and D8 in a separate rerun after the Collections account was reset.
- Billing-staff browser smoke on the deployment passed, including creating a draft through the UI.
- Local at the same code: Phase 2 matrix 89/89, Phase 1 matrix 37/37, `test.sh --local`, concurrency test, 50/50 unit tests, `tsc`.
- Findings 1 to 5 and 8 from the first validation are fixed, and finding 6 is resolved on the contract side. Findings 7 and 9 are addressed in `d9cd4a6`, by Engineer B's account and SQL tests; the matrix does not test them directly. Finding 8 was checked by code reading only.
- The two extension endpoints and the extra error codes are in the Phase 2 contract.
- No migration automation found on `dev` at `f9c729f`; migrations are applied deliberately.
- The test harness pins writes to the sandbox and restores temporary settings on failure. After the hosted run, policy and remittance matched their snapshot exactly.

## 2. Limitation: no real Operations rows were tested

**The hosted run found zero pre-existing Operations source rows in the TAB-HUB sandbox.** `work_periods`, `period_counts`, `client_services` and `services` in `tap_hub_project` all held 0 rows before the run.

- The `YYYYMM` checks (C18, C19) used **tagged synthetic rows**, written in the format the owner confirmed.
- The reported 2,181 `work_periods` and 2 `period_counts` rows were **not** read or tested. They belong to a database, schema or project not yet identified.
- So this closeout proves Billing handles text `YYYYMM` in the shape the owner described. It does not prove behaviour against real Operations data: real period values, unusual stages, or data volume.

This must be repeated against real-shaped Operations data before any production rollout.

## 3. Other limits

- The deployed commit is inferred, not read from the Vercel page: Vercel's completed deployment on `27217c1`, the fork's single Phase 2 push, and the live bundle.
- Migration state in the sandbox is as confirmed by Engineer B, with the behaviour exercised by the matrix.
- Not exercised: concurrent claims and issue sequencing on hosted infrastructure, firm dates at midnight and daylight-saving changes, the harness restore on SIGINT/SIGTERM, and forced failures of its two sandbox pin checks.
- Owner and Admin ran as one account. The owner confirms they are one role.

## 4. Test accounts

All four test passwords were rotated after the rerun, because they had been shared in chat. Each change went through the app's own change-password route. Afterwards each new password signed in and each old one was refused. The new values are kept only in Engineer A's git-ignored local env file and appear in no document or chat. The owner can reset any account if needed.

## 5. Not part of this closeout

- Phase 2 is **not merged to `dev`**. That is a separate decision. `codex/billing-phase2-matrix` carries the matrices, records and harness commits after `d9cd4a6`.
- Sandbox rows from the run remain and cannot be removed. The synthetic client now holds a terms override, so a repeat of the full matrix needs a new client.
- Separate security issue found while reviewing Phase 3: see section 4 of `2026-11-06-billing-phase3-engineer-a-contract-review.md`.

## 6. Phase 3

Phase 2 closeout removes one gate. Phase 3 screen work stays blocked until the contract is acknowledged by both engineers and the owner. Engineer A's review requests changes first.
