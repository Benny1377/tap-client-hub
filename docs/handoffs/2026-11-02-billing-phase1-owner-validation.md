# Billing Phase 1 owner-side validation

Updated: 2026-11-04 (owner authenticated matrix run)
Branch: `codex/billing-phase1-validation`
Scope: disposable local synthetic Supabase harness only; no hosted environment or real client data.

## Evidence matrix

| Area | Result | Evidence / boundary |
| --- | --- | --- |
| Local Billing and Collections SQL regressions | PASS | `bash tools/collections-local/test.sh --local` — all six SQL checks passed, including Phase 1 security/audit, Phase 2 stage/configuration, and Phase 4 intake regressions. |
| Billing database invariants | PASS | `psql ... -f tools/collections-local/validate-billing-phase1-invariants.sql` — run against local port `55322`; function reports `billing phase 1 database invariants: PASS`. Validator runs its checks in a rolled-back transaction. |
| Concurrent payment allocation | PASS | `node tools/collections-local/test-billing-allocation-concurrency.mjs` — two concurrent `$75.00` allocations raced against a `$100.00` invoice; one accepted, one rejected, active allocation total `$75.00`. Test is fixed to the local test DB and cleans up its synthetic rows. |
| Static access/API contracts | PASS | On exact integrated `origin/codex/billing-phase1-ui` at `78161ad`: access-policy regression, 13/13 API contract assertions, nested route-access checks, and Phase 1 contract/review checks passed. These are code-level tests, not authenticated HTTP integration. |
| Billing UI tests | PASS | On `78161ad`: UI data checks (48), import tests (33), and render checks (66) passed. |
| Typecheck / production build | PASS | `npx tsc --noEmit` and `npm run build` passed on the integrated `78161ad` worktree. |
| Support regression suite | PASS | `npm run test:support` passed: 88 + 18 + 13 assertions. |
| Lint | PASS on changed files; repository-wide baseline FAIL | ESLint on every changed code file in `origin/codex/billing-phase1-ui` relative to `6859607` passed. `npm run lint` still reports 568 problems (470 errors, 98 warnings) across the full repository. Six errors are in Billing API files unchanged from the base; the remaining findings are outside this branch's diff. No lint fixes were applied. |
| Dynamic authenticated Phase 1 API/auth matrix | PASS — 37/37 | Owner ran `node tools/collections-local/verify-billing-phase1-routes.mjs` against the local app on port `3000`, local Supabase API `55321`, and local database `55322`, from `codex/collections-ar-auto-matching` at `f9c729f`. Owner output: 37 passed, 0 failed. Covers signed-out/role access, invoice line math and invariants, draft deletion, void/payment allocation rules, anon RLS, and audit rows. The runner leaves synthetic `LOCAL-V*` test records in the disposable local database; no hosted data was used. |
| Hosted migration / hosted behavior | NOT RUN | No hosted schema, credentials, or services were accessed. |
| Phase 3 delivery validators | NOT RUN | Explicitly outside this Phase 1 local validation; Engineer A also notes they are not covered. |

Dependency install note: `npm ci --ignore-scripts` used the committed lockfile in isolated worktrees. npm reported 18 dependency advisories (16 moderate, 1 high, 1 critical); no audit fix or dependency update was run.

## Fixture corrections needed for new invariants

The latest Phase 1 invariant correctly rejects adding or changing invoice lines after issue. Three existing local SQL fixtures were stale: they created issued invoices and then inserted lines. Their setup now follows `draft -> add lines -> issue`. The Phase 4 stale-snapshot fixture now uses a valid payment allocation as the post-report Billing mutation, preserving its intended test without relying on an invalid issued-line edit. These are test-fixture corrections only; no production source, migration, or hosted data was changed.

## Merge / release position

This completes the owner-side local evidence for BILL-DEP-03. Changed-file lint, typecheck, build, local SQL, concurrent allocation, static contract/UI tests, and the authenticated HTTP matrix pass in the recorded local evidence. The repository-wide lint baseline remains failing outside the changed Billing files. Engineer A's 2026-11-04 closeout reports `codex/billing-phase1-ui` merged into `dev` at `10fe781`; the authenticated matrix reported here was run separately against the local integrated code tree at `f9c729f`. No hosted or Vercel Preview behavior is claimed by this local matrix. Preview/sandbox verification is a separate environment check, not an outstanding authenticated-matrix gap.
