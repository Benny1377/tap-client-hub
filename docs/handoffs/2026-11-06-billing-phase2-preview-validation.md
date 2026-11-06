# Billing Phase 2: Engineer A hosted Preview validation

| Field | Value |
| --- | --- |
| Date | 2026-11-06 |
| From | Engineer A (Billing UI / workbench) |
| To | Engineer B, project owner |
| Deployment | `https://tap-client-hub-test.vercel.app` (Vercel project `tap-client-hub-test`, test fork `AananChopra/tap-client-hub-test`) |
| Deployed commit | `27217c1` (= Phase 2 backend `d9cd4a6` + UI draft change `c6b9f5a` + matrix tooling) |
| Database | TAB-HUB sandbox, `vuqgxotdccxivjmavsoj.supabase.co`, schema `tap_hub_project` |
| Harness | `tools/billing-preview/verify-billing-phase2-preview.mjs` at `327bbc5` |
| Synthetic client | `c11dd6b4-8026-4ef1-a0aa-8d07c7ea36a2` |
| Outcome | **90 of 90 run checks passed, 3 skipped.** Phase 2 is not closed until the 3 skipped checks run (section 4) |

Full output: `2026-11-06-billing-phase2-preview-results.txt`. Every row added: `2026-11-06-billing-phase2-preview-manifest.json`. No credentials appear in either.

## 1. Gates confirmed before writing

| Gate | Evidence |
| --- | --- |
| Deployed commit | Vercel reports a completed deployment on `27217c1`. The fork's history shows Phase 2 has only ever existed there as that one push; its only other branch, `dev`, has no Phase 2 routes. The live bundle contains the `c6b9f5a` draft wording and not the old invoice-number field. This is inferred from those facts: Engineer A could not open the Vercel deployment page itself |
| Connected to the sandbox | Read-only: the deployment's remittance `updatedAt` equals the sandbox row (P-1). After the first write: a rate card created over HTTP is visible in the sandbox (P0) |
| Synthetic data | The client's name is `SYNTHETIC Billing Matrix 2026-11-06`; the harness refuses a client without "synthetic" or "test" in its name. All Operations rows are tagged by service code (`P2<tag>-*`) |
| Migrations | `20261105100000`, `20261105110000`, `20261106100000` confirmed by Engineer B. The matrix exercises their behaviour (D6, D7) |

## 2. Harness safeguards requested

| Request | Implementation | Proof |
| --- | --- | --- |
| Pin writes to the intended sandbox | The env file host must equal `BILLING_SANDBOX_HOST`; P-1 blocks any write unless the deployment reads that database; a failed P0 aborts the run. The guards refuse a missing or non-https URL, a missing write flag, a bad client id and a host mismatch | Each refusal except P-1/P0 exercised with fake values; P-1 and P0 passed on the hosted run but their failure paths were not forced |
| Restore temporary settings on failure | Policy and remittance are snapshotted before any write and restored from the snapshot by direct service-role writes in a `finally` block and on SIGINT/SIGTERM, then verified (Z1, Z2) | Forced crash locally right after the policy grant: run aborted, Z1 and Z2 passed. Signal path not exercised |

The earlier harness restored only at the end of a successful run and would have left `pricing.manage` as `[]` and an extra `candidates.manage` row. Both are now restored exactly. Hosted run after restore: `pricing.manage` `["owner","admin"]`, the 3 original policy rows, remittance empty as before.

## 3. Results

| Group | Result |
| --- | --- |
| Preflight and pinning (P-1, P0) | PASS |
| A access and permissions | PASS, except A3 and A4 for Collections-only (skipped) |
| B pricing, terms, remittance | PASS |
| C maps, generation, candidates, including real `YYYYMM` text periods (C18, C19) | PASS |
| D manual confirmation | PASS, except D8 (skipped) |
| E drafts, issue, void, delete, database rejection of a linked-line edit | PASS |
| F bundles | PASS |
| G policy editor | PASS |
| H audit, anon denied, no reused numbers | PASS |
| Z exact restore | PASS |

Informational: F3 each bundle component candidate carries the full package price (300.00, 300.00), as recorded earlier. The UI must count a bundle once.

UI smoke as Billing staff, in a real browser on the deployment: sign-in, `/billing` loads, drafts show "Draft" and "—", issued and void invoices show their numbers, the new-draft form asks only for a memo, a draft was created through the form, its detail page shows "Invoice number and dates are assigned when the invoice is issued.", issue is blocked until a line exists, no console errors. Recorded in the manifest as `uiSmokeDraftInvoice`.

Same code locally: Phase 2 matrix 89/89, Phase 1 matrix 37/37, `test.sh --local` PASS, concurrency PASS, 50/50 unit tests, `tsc` PASS, Preview harness 93/93 on the local stack.

## 4. Not covered

- **A3 and A4 Collections-only, D8.** `collections@test.com` exists and is confirmed, but the supplied password is rejected ("Invalid login credentials"; last sign-in: never). These checks need no fresh client and are 403 checks, so they can run alone once the sign-in works.
- **Owner as a distinct account.** No Owner credential was supplied; `admin@test.com` (role `admin`) ran as both Owner and Admin. Owner-only behaviour distinct from Admin was not exercised, and "Owner" in the check names and audit evidence means this Admin account.
- **Real Operations data.** Sandbox `work_periods`, `period_counts`, `client_services` and `services` in `tap_hub_project` held 0 rows before this run, against the 2,181 and 2 reported. The `YYYYMM` result here comes from synthetic rows in the confirmed format, not from those rows.
- Concurrent draft claims and issue sequencing, on hosted infrastructure.
- Firm-date boundaries around midnight and daylight-saving changes.
- The restore on SIGINT/SIGTERM, and forced failures of P-1 and P0.

## 5. Sandbox state after the run

- The synthetic client now holds a terms override, so a repeat of the full matrix needs a new synthetic client.
- 4 draft, 1 issued and 1 void invoices, and 1 payment with a reversed allocation, remain. They cannot be removed (issued invoices and audit rows are immutable), as agreed.
- The restore writes used the service-role key directly, not the app, so their audit rows (if any) will not carry a test user as actor. This was not checked.

## 6. `dev` migration automation

None found at `f9c729f`. The only workflow is `sync-upstream.yml` (hourly upstream sync, no Supabase or migration step), the build is `next build`, and `vercel.json` adds no step. Migrations are applied deliberately, as Engineer A's Vercel log review also found.

## 7. Position

The hosted Phase 2 matrix passes on everything it ran. Engineer A will record closeout once the 3 Collections-only checks pass. No Phase 3 screen work starts before closeout and the three-way Phase 3 acknowledgement.
