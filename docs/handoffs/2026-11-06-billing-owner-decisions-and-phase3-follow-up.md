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
- This Operations project is distinct from the TAB-HUB sandbox `vuqgxotdccxivjmavsoj.supabase.co`. Engineer A's Phase 2 Preview report said that sandbox had no pre-existing Operations source rows, so tagged synthetic rows were used for the hosted checks. The owner later reported 93/93 hosted checks after rerunning the three previously skipped checks; this work did not independently rerun the Preview.

## Changes on this branch

- The policy read now returns all 11 delegable actions with effective role sets and enabled state, including defaults for absent rows. Stored rows override defaults. Owner/Admin-only actions are never included.
- The Phase 3 workbench contract and review-resolution handoff now match the accepted decisions and current Operations evidence.
- Focused policy serialization tests cover the full action set, defaults, and an explicit revocation.

## Validation and limits

- `node --test tests/billing-phase2-serialization.test.mjs`: 9/9 passed.
- Targeted ESLint for the changed Billing route, access helper, contract test: passed.
- `git diff --check`: passed before commit.
- Full TypeScript check is not clean because the existing unrelated `lib/collections-pdf-parser.ts` import cannot resolve `pdfjs-dist/legacy/build/pdf.mjs` in this checkout. This is recorded, not silently treated as a Billing failure or fixed here.
- No hosted code, migration, database, Preview, or production checks were run by this change.

## Engineer A actions

1. Review this branch and `codex/payroll-credential-fields-ui` independently against the Phase 3 contract and security finding.
2. On the Preview, verify Payroll-field hiding and update behavior for Owner/Admin, Payroll staff, Billing-only, and Collections-only users; confirm unauthorized UI sessions do not receive or submit credential fields. Hosted evidence remains pending.
3. Record hosted verification and close any contract/API concerns. Do not put test credentials or client data into the handoff.
4. Choose and own the Phase 2/Phase 3 integration point and `dev` merge only after end-to-end checks. The owner has explicitly left that decision to Engineer A; this handoff does not merge anything.

## Related implementation branch

`codex/payroll-credential-fields-ui` is based on Engineer A's `codex/billing-phase2-matrix` at `4ee043f`; it contains the UI mitigation and tests, and includes the previously reviewed payroll API fix (`1c771fb`) and Preview matrix (`7d202fd`) in its history. See the same-named owner-decision handoff on that branch for its files and validation.
