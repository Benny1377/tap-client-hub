# Billing owner decisions and Payroll-field follow-up

Date: 2026-11-06  
Status: UI mitigation and focused tests are ready for Engineer A review. Hosted verification remains pending. No merge to `dev` is authorized by this handoff.

## Owner decisions and evidence

- The owner has explicitly put rotation of Payroll/EFTPS credentials on hold. This is a temporary owner decision, not a security finding that rotation is unnecessary.
- Engineer A owns the `dev` integration/merge decision and has final say after end-to-end testing. Do not merge this or Phase 2 into `dev` until Engineer A chooses the integration point after full checks.
- Owner-supplied metadata for Operations project `https://ibbrvqbgniuvqvazasgr.supabase.co`: schema `tap_hub_project`; `client_services` 1,281 rows, `services` 8, `work_periods` 2,181, `period_counts` 2. The `period` columns are text and aggregate validation reports `YYYYMM` for all 2,181 and 2 rows. No client rows or secrets were read by this work.
- Owner-supplied database metadata says `anon` and `authenticated` have table/column grants for `client_services`, `payroll_password`, and `eftps`; RLS is enabled but not forced; no SELECT/ALL policies were returned. No grants/policies were changed and no direct-read exploit was reproduced here. The database boundary still needs an explicit security review before production; hiding fields in the UI is defense in depth, not authorization.
- The Operations project is distinct from the TAB-HUB sandbox `vuqgxotdccxivjmavsoj.supabase.co`. The Phase 2 Preview used tagged synthetic Operations rows because the sandbox had no pre-existing source rows. Engineer A reports 93/93 hosted Phase 2 checks after rerunning the three previously skipped checks; not independently rerun by this branch.

## Implementation

- `lib/payroll-credentials.ts` centralizes whether a user may view/edit Payroll credential fields (Owner/Admin or Payroll module).
- `components/client-modal.tsx` and `components/client-slideover.tsx` hide the Payroll PIN and EFTPS controls when the viewer lacks access and omit those fields from save/autosave payloads.
- `tests/payroll-credential-access.test.mjs` checks allowed and denied roles/modules.
- This branch includes Engineer A's previously reviewed API payroll-field filtering (`1c771fb`) and Preview verification tooling (`7d202fd`) in its base history; it does not claim hosted verification of the UI mitigation.

## Validation and remaining work

- `node --test tests/payroll-credential-access.test.mjs`: 2/2 passed.
- Billing/Collections UI tests: 34/34 passed.
- Targeted ESLint for the new helper and its test passed. Broader component lint reports pre-existing issues; this branch does not claim repo-wide lint is clean.
- Full TypeScript check remains blocked by the existing unrelated `pdfjs-dist/legacy/build/pdf.mjs` resolution error.
- Engineer A: review this branch, test the field visibility and submitted payloads on the Preview for Owner/Admin, Payroll, Billing-only, and Collections-only roles, and record hosted evidence. Separately decide the database grants/policies boundary before production; do not infer safety from the UI hiding.
- Engineer A owns the eventual integration point and `dev` merge after his end-to-end tests. Owner has explicitly assigned him the final say; this branch does not merge itself.
