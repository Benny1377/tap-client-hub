# Billing integration follow-up after `dev` merge

Date: 2026-11-06  
Base: `dev` at `166eb6e`  
Status: Engineer A reports the integration and hosted checks complete. The two contract/API follow-ups and one UI effect cleanup are implemented locally on `codex/billing-phase3-post-integration-fixes`; pending Engineer A contract acknowledgement. No deployment, migration, Operations read, or merge was performed by this follow-up.

## Integration evidence reported by Engineer A

- Integrated commit: `166eb6e`; `main` remains untouched. Engineer A owns the `dev` integration and final merge decision after end-to-end testing.
- Hosted TAB-HUB sandbox checks: `6bba06b` payroll API 36/36, Phase 3 reads 13/13, Collections-only refusals 4/4, and payroll fields in browser sessions 13/13; `3a3028d` Billing draft browser flow 7/7 after fixing the blank draft detail heading.
- Integrated local checks: Phase 1 37/37, Phase 2 89/89, 141/141 unit tests, SQL checks, and TypeScript check passed per Engineer A.
- The full hosted Phase 2 matrix was not repeated because it creates permanent rows. Hosted evidence and limitations are in `2026-11-06-billing-integration-preview-validation.md` and its adjacent result file.
- Payroll/EFTPS rotation remains on hold at the owner's direction. Before production, the database-level sensitive-column boundary and a real Operations compatibility check remain required.

## Follow-up decisions and changes

1. **Policy GET -> PATCH round trip.** The policy read now filters `allowedRoles` to the same delegable allow-list the write accepts: `manager`, `staff`, `offshore`. Owner/Admin privileges are inherent and cannot be granted via these records. Therefore, the returned full policy can be submitted unchanged. The contract example and tests reflect this.
2. **Real-shaped Operations check.** Phase 3 Preview acceptance remains synthetic. Before production approval, run a separately recorded, read-only compatibility check from an isolated Preview against the identified Operations project, with Operations-owner approval and a bounded approved service. Verify only the adapter's permitted columns/joins across `client_services`, `services`, `work_periods`, and `period_counts`, actual `YYYYMM` parsing, and completion eligibility via the read-only schedule/projection. Record schema, aggregate counts, period format, and pass/fail only; do not write to Operations or put client PII/credential values in the record. Run after Preview acceptance and before production rollout.
3. **Collections guard migration.** The owner previously reported CLI migration history showing `20261104160000_collections_guard_auto_match_review_state` present in both local and remote sandbox lists after applying it, so the available owner evidence says it was applied. This follow-up did not query the linked database. On the integrated `dev` tree, the file exists under root `supabase/migrations` but not under the dedicated `tools/sandbox/supabase/migrations` directory; this is local migration-directory drift to reconcile before using that CLI workdir for the next migration. Engineer A should confirm remote history in his environment and restore the dedicated local mirror if needed.
4. **Effect dependency cleanup.** The `mayViewPayrollCredentials` dependency has been removed from the unrelated 1099-count effect and added to the client sync effect. A permission change now triggers credential-state synchronization even when the current client has not changed.

## Local verification

- `node --test tests/billing-phase2-serialization.test.mjs tests/billing-phase3-api-contracts.test.mjs tests/payroll-credential-access.test.mjs`: 15/15 passed.
- Targeted ESLint for the changed Billing helper/route and tests passed. ESLint on `client-slideover.tsx` still reports the existing component-wide backlog (204 errors, 28 warnings); no new hook-dependency diagnostic was reported at the edited effects.
- `tsc --noEmit` remains blocked in this checkout by the existing missing `pdfjs-dist/legacy/build/pdf.mjs` dependency. Engineer A separately reports a clean TypeScript check on the integrated environment.
- No connection to the Operations project or TAB-HUB hosted database was made for this change.
