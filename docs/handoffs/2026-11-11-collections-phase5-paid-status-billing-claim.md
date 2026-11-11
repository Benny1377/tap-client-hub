# Collections Phase 5: paid A/R balances and Billing test-claim handoff

| Field | Value |
|---|---|
| From / To | Engineer B → Aanan (Engineer A) |
| Branch | `codex/collections-phase5-review-fixes` |
| Base | `471ea5b` (`fix(collections): close phase 5 backend review gaps`) |
| Scope | A/R zero-balance status plus the Billing-only test-delivery claim fix |
| Delivery | Disabled outside the local fake-provider tests; no real messages sent |

## What changed

### Approved A/R zero balance is now a paid state

- A PDF invoice with an approved snapshot balance of zero (or less) is returned as `collection_status: "paid"`, with `paid_as_of` set to that report's as-of date.
- Paid rows remain visible in the invoice detail, but have no next/upcoming ladder stage and are excluded from open balances, aging, open-invoice counts, and the active ladder.
- A later approved snapshot with a positive balance makes it open/actionable again. Missing or unreadable balances are not treated as paid.
- Billing-led rows continue to use the Billing balance and do not claim an A/R `paid_as_of` date. This is a Collections read-model status; it does not write to or alter the Billing ledger.

### Billing test-delivery claim blocker fixed

Aanan found that `claim_collection_test_delivery` attempted to lock a row in `collection_source_invoice_identities` before routing Billing attempts to the existing Billing claim function. Billing-only invoices have no such row, so the claim returned `INVOICE_NOT_ELIGIBLE` and the test send was suppressed.

Forward migration `20261111125830_collections_test_delivery_billing_claim_dispatch.sql` now routes a queued Billing attempt with no identity row to the existing Billing eligibility function. When a Billing identity row exists, the previous identity lock and cleared-state checks still run. The PDF claim continues through its source-identity checks. The final contact-email validation remains in front of both paths.

Regression coverage claims and accepts a Billing attempt without an identity row, verifies its `reminder_logged` event uses the Billing identity, and keeps the existing PDF-only delivery test. The worker harness was also corrected: its seed invoice's next eligible reminder is Friendly (stage 1), not stage 3.

## Validation completed locally

- Clean disposable local Supabase reset replayed the migrations, including the new forward migration.
- All 10 Billing/Collections SQL suites pass.
- `node --test tests/*.test.mjs`: 196/196 pass.
- Worker SQL check: Billing invoice has no identity row; claim returns `null`, state becomes `sending`, and acceptance/event assertions pass.
- `git diff --check` passes.
- Typecheck is currently blocked in this isolated worktree because its available dependency tree lacks `pdfjs-dist/legacy/build/pdf.mjs`. The production build could not run with a temporary `node_modules` symlink because Next/Turbopack rejects dependencies symlinked outside the worktree root. Run typecheck/build from a dependency-complete checkout before integration.
- No hosted Sandbox or production migration was applied. No provider was contacted; the SQL regression uses a fake provider message ID and rolls back.

## Aanan: remaining checks and decisions

1. Pull this branch/commit and run `node tools/collections-local/validate-phase3-delivery.mjs` with the local fake-Resend harness. Confirm a Billing-only Friendly attempt reaches the fake provider and is accepted, and confirm PDF-only behavior remains unchanged.
2. In the prior report, `D2`, `D4`, `D5`, and `SF1` still failed. Re-run them and report whether they now pass; this patch directly targets the Billing claim path, but does not claim those provider/retry checks are fixed.
3. Do not enable live delivery. Real sender/domain verification, Resend credentials, recipient approval, and the pre-production checks remain separate gates.
4. The operations-data reconciliation remains outside this branch: 20 Collections accounts without contacts and 19 not Operations-linked were reported. Do not invent or infer missing contact data.

## Sandbox migration ordering and impact

`20261111125830` must be applied after `20261111115029_collections_phase5_delivery_and_relink_safety.sql`; it is a forward migration and expects that function chain. The earlier migration is not applied to the Sandbox per the latest review. It also backfills relinked A/R-only clients by deactivating their old source records and recording name aliases (Aanan noted 101 relink audit rows, including D'Souza). Review that backfill and its impact before applying either migration. Nothing here authorizes a Sandbox or production database change.

## Merge / handoff order

1. Aanan reruns the fake-provider validation and reports the four outstanding IDs above.
2. Resolve any provider-test failures and jointly review this branch.
3. Apply Sandbox migrations only after the owner reviews the `20261111115029` backfill and authorizes the sequence.
4. Keep live delivery disabled until the separate operator/domain/Resend readiness gates are complete.
