# Billing owner decisions and Phase 3 follow-up

Date: 2026-11-06  
Status: Owner decisions recorded; implementation is on this branch and the payroll-field UI branch. Engineer A review and hosted verification remain pending. No merge to `dev` is authorized by this handoff.

## Owner decisions and source evidence

- The owner approves Engineer A's Phase 3 proposals: `GET /api/billing/permissions/policy` returns the effective values for all 11 delegable actions; missing rows resolve to server defaults. The fixed actions (`policy.manage`, `invoices.void`, `payments.reverse`) are Owner/Admin-only and excluded from delegation.
- Phase 3 contract wording is updated for memo-only `PATCH /invoices/[id]`, candidate-generation refresh behavior, duplicate manual-confirmation replay versus conflict, generic `INVALID_INPUT`, 403 behavior, and optional response IDs/refresh targets.
- Engineer A owns the `dev` integration/merge decision and has final say after end-to-end testing. Do not merge Phase 2 or these follow-ups to `dev` until Engineer A chooses the integration point after full checks.
- Payroll/EFTPS credential rotation is explicitly on hold per the owner. This is not a conclusion that rotation is unnecessary; it is the current owner decision.
- The owner identifies `https://ibbrvqbgniuvqvazasgr.supabase.co` as the Operations project. Owner-supplied schema-only and aggregate results report `tap_hub_project.client_services` = 1,281 rows, `services` = 8, `work_periods` = 2,181, and `period_counts` = 2. Both period columns are `text`; aggregate validation reports all period values as `YYYYMM`. Billing normalizes this to `YYYY-MM`.
- Owner-supplied privilege/RLS checks report grants for `anon` and `authenticated` on `client_services` and on `payroll_password`/`eftps`, RLS enabled but not forced, and no SELECT/ALL policies. These are metadata results only: no client rows or credential values were read, no direct-read exploit was reproduced, and no grants/policies were changed. API field filtering is not a substitute for reviewing the database boundary.
- The owner subsequently ran a read-only query in the Operations project context and reported `current_user = authenticated` with `visible_client_service_rows = 0`. This establishes zero rows visible to that database role under the current RLS context, without reading credential values. It is not an authenticated browser/PostgREST test, does not establish that every production access path is safe, and does not change the prior no-grants/no-policy-changes status. Credential rotation remains on hold by owner decision.
- This Operations project is distinct from the TAB-HUB sandbox `vuqgxotdccxivjmavsoj.supabase.co`. Engineer A's Phase 2 Preview report said that sandbox had no pre-existing Operations source rows, so tagged synthetic rows were used for the hosted checks. The owner later reported 93/93 hosted checks after rerunning the three previously skipped checks; this work did not independently rerun the Preview.
- On 2026-11-06 the owner approved the four Phase 3 design additions: server-computed totals, a bounded firm-wide read-only projection, a richer per-client summary, and firm presentation metadata. TAP invoice numbering remains fixed; sending/delivery and manual payment/reconciliation remain out of scope. The detailed proposed request/response shapes are in `docs/contracts/billing-phase-3-workbench.md` and require Engineer A review before UI integration.

## Changes on this branch

- The policy read now returns all 11 delegable actions with effective role sets and enabled state, including defaults for absent rows. Stored rows override defaults. Owner/Admin-only actions are never included.
- The Phase 3 workbench contract and review-resolution handoff now match the accepted decisions and current Operations evidence.
- Focused policy serialization tests cover the full action set, defaults, and an explicit revocation.
- The owner-approved Phase 3 additions are implemented on this branch: client summary with server-calculated cents and explicit completeness indicators, bounded firm-wide read-only schedule projection with opaque pagination, and audited Owner/Admin-managed firm presentation settings. The presentation migration is mirrored in the sandbox migration directory and included in the local reset sequence; it has not been applied to the shared sandbox.
- The client summary never returns other clients, reports an incomplete monthly total rather than implying a full amount when an assignment is unpriced or bundle frequency/pricing cannot be normalized, and calculates bundle package prices once. The firm schedule is projection-only and excludes source events that already have persisted candidates; those remain accessible through the Candidates list.
- A read-only hosted Phase 3 checker now covers the new permission gates, response shapes, decimal totals, opaque pagination, payroll/EFTPS field-name absence, and verifies that candidate rows do not change. It has not yet been run against a deployed build.
- Follow-up to Engineer A's review of `18d639e`: firm-schedule SQL now fetches one row beyond the bounded requested page (including limits below 100), so `hasMore` and the continuation cursor are accurate. The client-summary bundle rows have an explicit type, removing the reported `unit_amount`/`name` inference errors. Monthly totals now annualize recognized Operations frequencies (including `Bi-Weekly`) using integer cents; unknown or unpriced assignments make completeness false. Aging buckets preserve signed credit balances.
- Follow-up to Engineer A's build review of `87237b2`: monetary cents now use safe integer arithmetic compatible with the repository's ES2017 target (no BigInt literals), and bundle rows are constructed field-by-field with an explicit return type. The owner-provided sandbox migration list confirms `20261106110000` is applied, so paging is corrected in the new forward-only `20261107140000_billing_firm_schedule_paging.sql` migration rather than relying on edits to applied history. The two Collections migrations `20261107120000` and `20261107130000` are also shown applied in that owner-provided list.

## Validation and limits

- `node --test tests/billing-phase2-serialization.test.mjs`: 9/9 passed.
- `bash tools/collections-local/reset.sh --local` followed by `bash tools/collections-local/test.sh --local`: local Billing/Collections SQL suite passes, including short-page cursor continuation.
- `node --test tests/*.test.mjs`: 151/151 passed using the main checkout's existing TypeScript runtime through a temporary Node loader; no dependency installation or source checkout changes were made for this workaround. Focused monthly-amount and Phase 3 contract tests are included.
- `node --check tools/billing-preview/verify-billing-phase3-reads.mjs`, targeted ESLint for the changed route/helper, `git diff --check`, and an exact comparison of the root/sandbox presentation migration copies all pass.
- A full worktree `tsc` run is not established because this isolated worktree has no `node_modules`; no dependencies were installed. The reported ES2017 BigInt and bundle inference issues are addressed, but this is not represented as a successful full typecheck.
- No hosted code, migration, database, Preview, or production checks were run by this change. The Operations check is still a gate: the owner-provided authenticated-role query returned zero visible `client_services` rows, while the adapter needs an approved bounded read through the actual runtime source connection. The runtime access boundary and payroll/EFTPS direct-read path have not been independently verified here.
- The read-only authenticated-role row-count result above was supplied by the owner; this branch did not connect to or query the Operations project.

## Engineer A actions

1. Review this branch and `codex/payroll-credential-fields-ui` independently against the Phase 3 contract and security finding.
2. On the Preview, verify Payroll-field hiding and update behavior for Owner/Admin, Payroll staff, Billing-only, and Collections-only users; confirm unauthorized UI sessions do not receive or submit credential fields. Hosted evidence remains pending.
3. Apply `20261107140000_billing_firm_schedule_paging.sql` to the TAB-HUB sandbox, then deploy this branch and run `tools/billing-preview/verify-billing-phase3-reads.mjs`. Record the Preview URL, deployed commit, results, and any blockers. Do not put test credentials or client data into the handoff.
4. Choose and own the Phase 2/Phase 3 integration point and `dev` merge only after end-to-end checks. The owner has explicitly left that decision to Engineer A; this handoff does not merge anything.
5. Review the owner-approved Phase 3 design-scope amendment and its endpoint shapes before implementation/UI integration.

## Related implementation branch

`codex/payroll-credential-fields-ui` is based on Engineer A's `codex/billing-phase2-matrix` at `4ee043f`; it contains the UI mitigation and tests, and includes the previously reviewed payroll API fix (`1c771fb`) and Preview matrix (`7d202fd`) in its history. See the same-named owner-decision handoff on that branch for its files and validation.

## 2026-11-07 follow-up

Engineer A reports commit `8a0b486` passes the full typecheck/build and the Phase 3 read-only Preview check 23/23. The Preview pagination probe returned all 30 unique rows at limits 1, 7, and 50, confirming the sandbox has `20261107140000_billing_firm_schedule_paging.sql`. No work has been merged to `dev` or `main`. Engineer A's final hosted workbench check is still pending on the follow-up to `616890c`; the client “What bills next” first-100-item defect was fixed there and needs the final hosted rerun.

Owner decisions for the Phase 3 amendment:

- At invoice issue, atomically snapshot `{firmName,tagline,invoiceFooter}` beside the remittance snapshot. Draft previews may use live settings; issued invoice rendering uses the immutable saved snapshot. Existing issued invoices are not rewritten.
- Quarterly recurring schedule dates remain January, April, July, and October month ends.
- Bi-Weekly remains a supported annualized frequency for monthly estimates (26 occurrences/year), but no billing dates are inferred without an Operations anchor. Generation reports it as source-incomplete; the schedule does not invent dates.
- The owner approved cleanup of the synthetic Billing data listed by Engineer A, but it must wait until the final hosted Billing check is complete. Preserve immutable ledger/audit evidence and Collections data; Engineer A should provide the exact manifest/tagged targets before a scoped cleanup is prepared. No shared-sandbox rows have been deleted by this branch.

Local implementation follow-up on `codex/billing-phase3-post-integration-fixes` (included in this reviewed push):

- Client summary Operations reads now batch client-service IDs and candidate-price RPC calls run with a concurrency cap of eight to reduce the prior N+1 latency risk.
- The transactional firm-schedule SQL test now checks the random-ID row across both pages, avoiding an order-dependent assertion.
- Forward migration `20261107150120_billing_issue_presentation_snapshot.sql` adds the issue-time presentation snapshot and a database guard against changing it after issue. The root migration, sandbox mirror, reset entry and invoice serializer/type/test are included. The migration has not been applied to the shared sandbox.
- Local focused route, serializer, and Phase 3 contract tests: 31/31 passed. `node --test tests/*.test.mjs`: 156/156 passed. `bash tools/collections-local/reset.sh --local`, `bash tools/collections-local/test.sh --local`, and `psql postgresql://postgres:postgres@127.0.0.1:55322/postgres -X -v ON_ERROR_STOP=1 -f tools/collections-local/validate-billing-phase1-invariants.sql` all passed, including issue snapshot creation and post-issue immutability. `git diff --check` passes.
- `npm run typecheck` reports no errors in changed Billing files; the only error in this checkout remains the pre-existing missing `pdfjs-dist/legacy/build/pdf.mjs` declaration. A production build was attempted but is unverified: Next/Turbopack rejected the temporary out-of-worktree `node_modules` symlink used to expose the existing checkout dependencies. That link was removed; no dependency was installed.
- Do not represent the local follow-up as Preview-tested or as a Phase 3 closeout. Engineer A must review the contract amendment, deploy the matching code/migration to the test Preview, and complete the final hosted workbench check.
