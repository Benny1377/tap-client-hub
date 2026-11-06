# Billing and Collections execution test readiness

Date: 2026-11-06
Status: Phase 3 contract is owner-approved and acknowledged by Engineer A (`b01cfcc`). Screens 1–4 are implemented on `codex/billing-phase3-post-integration-fixes`; this branch is for Engineer A review and is not merged or Preview-tested. This note separates local evidence from the remaining migration-history, Preview, and production gates.

## Baseline evidence

| Area | Evidence available now | Scope limit |
| --- | --- | --- |
| Billing and repository tests | `node --test tests/*.test.mjs`: 145/145 passed on the local dirty Phase 3 worktree; Billing UI data checks 51 and rendering checks 68 pass | Tests used the existing dependency tree through a temporary symlink; no dependencies were installed. |
| Phase 3 UI | Screens 1–4 wired to the frozen Phase 2 API boundary; added coverage for projection, pricing/configuration API call shapes and navigation labels | No live browser/Preview smoke run in this work. |
| Typecheck | No new Phase 3 diagnostics; `tsc --noEmit` reports only the unresolved `pdfjs-dist/legacy/build/pdf.mjs` import in `lib/collections-pdf-parser.ts` | Full typecheck remains red until the unrelated dependency/module-resolution issue is resolved. |
| Sandbox migration mirror | Owner-provided remote history lists 12 applied versions; local mirror now contains all 12 matching versions | The six missing Collections promotion files were recovered from the Collections sandbox-migration worktree. Their destination SHA-256 hashes match those source copies. No migration was applied during this reconciliation. |
| Collections unit/contract tests | 117/117 baseline at `f9c729f`; 118/118 pass with the local harness guard test added in this prep | Separate worktree/branch; not integrated into `dev` by this work. |
| Billing Phase 1/2 authenticated matrices | Engineer A's prior evidence: 37/37 and 89/89 local; hosted Phase 2 93/93 after the skipped checks were rerun | Re-run after UI integration if shared route behavior changes. Full hosted matrix writes permanent synthetic ledger/audit rows; do not repeat casually. |
| Integrated browser checks | Engineer A reports Billing draft 7/7, Payroll/API/UI role checks and Phase 3 reads passed on the test Preview | Reported evidence, not rerun in this work. |
| Collections A/R Preview | Uploaded reports were parsed into reviewable lines; automatic client mapping/approval is not proven by that upload alone | Needs a bounded Preview smoke check with non-production data and explicit expected-match cases. |

## Implemented scope and handoff boundary

- Screen 1 continues the invoice/candidate workbench.
- Screen 2 adds a client-scoped Houston-date projection and a separate explicit candidate-generation action, with created/existing/unpriced/skipped results and skip reasons. The projection now includes enabled recurring and completion-source adapters and remains read-only.
- Screen 3 adds client-service visibility, price overrides, rate-card/entry operations, package bundle creation/editing/components, and cursor-based rate-card and bundle reads.
- Screen 4 adds firm terms and overrides, invoice remittance instructions, effective Billing permission policy editing, completion-source map creation/toggling, and audited manual completion confirmation.
- The Phase 2 server routes already provide the Phase 3 API boundary. This change adds no direct Supabase/Operations browser access and no new API shape.
- Engineer A owns the `dev` integration/merge decision. Do not merge or deploy from this handoff.

## Remaining gates (not code-completion claims)

1. The local sandbox mirror has been reconciled to the 12 versions in the owner-provided remote history. The six Collections promotion files were copied from the dedicated Collections sandbox-migration worktree and verified by matching source/destination SHA-256 hashes. No `db push` was run; rerun `supabase migration list --workdir tools/sandbox --project-ref vuqgxotdccxivjmavsoj` to confirm parity. Do not apply these already-recorded versions again.
2. Run UI role/browser checks on the acknowledged test Preview and record URL, deployed commit, sandbox identity, roles, and results. No Preview/browser check was run in this implementation.
3. The payroll/EFTPS direct-database access-boundary review remains a pre-production gate. Owner-supplied grants/RLS metadata alone do not prove direct-read denial; do not read credential values or change grants as part of this task.
4. The real Operations compatibility run remains a separately approved, read-only pre-production gate. Owner-supplied schema/count evidence identifies text `YYYYMM` periods and table counts, but this implementation did not connect to the Operations project or read data.
5. Aanan retains the `dev` merge decision after end-to-end review. Pushing this review branch does not authorize a `dev` merge or deployment.

## Local repeatable checks

Run commands from the relevant isolated worktree. The reset command is destructive to the disposable local Supabase database at port 55322; confirm that it is local before running. Never point these commands at the shared sandbox, Operations, or production.

Billing, after Phase 3 changes:

```sh
node --test tests/*.test.mjs
bash tools/collections-local/reset.sh --local
node tools/collections-local/create-test-users.mjs
npm run dev
node tools/collections-local/verify-billing-phase1-routes.mjs
node tools/collections-local/verify-billing-phase2-routes.mjs
node tools/collections-local/test-billing-allocation-concurrency.mjs
bash tools/collections-local/test.sh --local
```

Run the authenticated HTTP scripts against the same local app after reset and test-user setup. Check the exact Phase 2 matrix filename in the worktree before execution; do not assume it exists on a different branch. Add/re-run the Phase 3 UI suite and build/typecheck after each screen slice.

Collections, on `codex/collections-ar-auto-matching`:

```sh
node --test tests/*.test.mjs
```

Before changing Collections code, inspect that branch's `tools/collections-local/reset.sh`, `test.sh`, and handoff for its migration cutoff and commands. Its reset is also disposable-local-only. Then exercise the Collections role/security and A/R intake SQL tests, import parse/review tests, and auto-match/duplicate safety tests listed there. Keep the PDF originals out of Git and shared test artifacts.

Preparation caught and repaired one stale harness gap in that Collections worktree: its reset omitted `20261104160000_collections_guard_auto_match_review_state.sql`, so a local clean reset could not validate the current auto-match review-state race guard. The reset now applies it, and `test.sh` now runs `collections_phase4_auto_match_guard.sql`, which checks the RPC exists, is callable only by `service_role`, and retains the row/batch guard. These changes are local and uncommitted on the Collections branch; no database reset was run.

## Phase 3 acceptance tests to execute as screens are implemented

1. **Invoices and candidates:** role visibility (Owner/Admin, Billing staff, Collections-only, unassigned, signed out); draft creation from manual and candidate sources; candidate grouping and provenance; draft edit/delete; candidate release/reopen behavior; issue/void actions and reason/error handling; totals, decimal-string formatting, pagination/cursors, loading/empty/error states. Verify candidate-linked lines stay immutable and that refresh targets are honored.
2. **What bills next:** projection is read-only; generation requires explicit client/service scope; source-map missing/disabled/incomplete/out-of-window counts are visible; duplicate generation is idempotent; Houston business dates, month-end and DST boundaries; generation results refresh both candidates and invoices.
3. **Clients and prices:** client-service projection exposes only the contract's five fields; rate cards/entries, overrides and bundles use server-resolved prices; overlaps and invalid effective windows render actionable errors; cursor paging/sort order and permission denial are tested; bundles display as one package charge while preserving component provenance.
4. **Settings and completion rules:** policy GET is safe to render and save unchanged; only delegable roles are configurable; fixed Owner/Admin actions remain unavailable; settings full-replacement behavior, terms/remittance validation and source-map effective dates; manual confirmation duplicate/idempotency and audit reason; no credentials or private Operations fields enter Billing responses.
5. **Cross-screen regressions:** preserve current Payments/Receivables behavior; payroll/EFTPS fields remain Owner/Admin and Payroll-only; Collections-only access remains restricted; responsive layout, keyboard operation, accessible names, and confirmation/error messages.

Each screen should have focused component/form tests, API contract tests for consumed shapes, and one role-aware browser smoke path. Keep money/date/permissions logic in tested helpers rather than duplicating calculations in components.

## Preview gates (explicitly separate from local)

- Deploy only the acknowledged/integrated test branch to the separate TAB-HUB Preview project; record its URL and deployed commit.
- Use only the TAB-HUB sandbox, with synthetic client and Operations rows. Do not use the real Operations project for write tests.
- Keep the hosted Phase 3 read checker read-only. It must require an explicit expected Preview hostname and reject any Supabase host other than `vuqgxotdccxivjmavsoj.supabase.co`.
- Run the browser checks with Owner/Admin, Billing staff, Collections-only, and unassigned accounts. Put credentials in an ignored secret file; never paste them into chat or commit them.
- Do not rerun write-heavy Phase 2 hosted matrices without a newly authorized synthetic client and an updated manifest/cleanup expectation. Issued invoices and audit records are intentionally permanent.
- Before production only: separately review direct database access to sensitive payroll/EFTPS columns and perform an Operations-owner-approved, read-only real-shaped adapter compatibility check. Those are not Phase 3 Preview acceptance and are not authorized by this note.

## Safe checker correction prepared

`tools/billing-preview/verify-billing-phase3-reads.mjs` previously attempted a policy `PATCH` while calling itself read-only. It now validates the effective policy/allowed-role response without saving it, pins to the explicit Preview host and the TAB-HUB sandbox host, and checks that the policy table is unchanged. `tests/billing-phase3-preview-readonly.test.mjs` protects those properties. The checker has not been run against a hosted environment here.

## Completion definition

Phase 3 is ready for Engineer A's end-to-end review when all four screens pass their focused tests, the complete Billing and Collections local suites pass on the integrated tree, typecheck/build and role-aware Preview smoke pass on the recorded commit, and any deviations are documented. Collections production rollout and the deferred real-Operations/database-security gates remain separate approvals; passing these tests does not authorize production deployment.
