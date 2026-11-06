# TAB-HUB shared Supabase sandbox baseline

| Field | Value |
| --- | --- |
| Date | 2026-10-30 |
| Branch | `codex/billing-sandbox-baseline` |
| Base | `codex/billing-phase1-ui` at `196298b` |
| Sandbox project | `vuqgxotdccxivjmavsoj` |
| Scope | Hosted sandbox preparation only; no production access, deployment, reset, or data import |

## Observed state

The owner ran `supabase migration list --linked` and `supabase db push --dry-run`
from the dedicated `tools/sandbox` CLI work directory. The remote migration
history was empty and the dry run listed exactly one migration:
`20261030000000_hardened_tab_hub_baseline.sql`.

The owner then approved and ran the forward-only push. Supabase reported:
`Applying migration 20261030000000_hardened_tab_hub_baseline.sql...` followed
by `Finished supabase db push.` No legacy migration, seed, reset, application
data import, Auth-user import, or storage change was included in that command.

## Safety decisions

- TAB-HUB owns the dedicated `tap_hub_project` schema. Other internal projects must use separate schemas and must not create application tables in `public`.
- The shared sandbox is forward-only. `supabase db reset --linked`, seed-all commands, and destructive schema drops are prohibited.
- Historical `007_insert_credentials.sql` is a no-op on this branch. It contains no credential material and must never restore historical values.
- The historical `tap_hub_schema.sql` is a structural reference, not a deployable hosted baseline: its broad grants to `anon` and `authenticated` are not acceptable for the shared sandbox. A hardened bootstrap must revoke broad access, enable RLS before application access, and grant only the minimum necessary privileges.
- Existing Operations tables remain owned by Operations. Billing Phase 2 reads their agreed shape; it does not create or alter them.

## Post-bootstrap validation gates

1. Confirm `supabase migration list --workdir tools/sandbox --linked` records the single applied baseline and no unexpected migration.
2. Verify `tap_hub_project` is the only TAB-HUB application schema and that browser roles cannot access it until reviewed, feature-specific access is granted.
3. Record a schema/grant inventory in the validation handoff before creating test fixtures.
4. Promote only reviewed, forward-only Billing or Collections schema migrations into `tools/sandbox/supabase/migrations/`; never rerun legacy history against this sandbox.

## A/R report data boundary

The owner authorizes the two supplied historic A/R reports for restricted internal sandbox use. They remain outside Git, chat, screenshots, application logs, and public buckets. They enter only through the A/R Intake path as source-provenanced external snapshots and never create or alter native Billing invoices, payments, allocations, candidates, rates, or pricing.

The reports cannot replace Phase 2 Operations evidence: recurring and completion-driven candidate tests still require client-service enrollment, cadence, work-period, count-threshold, or authorized manual-completion records.

## A/R Intake source readiness

The owner supplied two historic reports for restricted, internal sandbox use.
They were inspected read-only without copying text, values, or client identity
into this repository:

- `AR 08282026.pdf` is a 15-page, machine-readable detail report. It has the
  field categories required for reviewed invoice intake: client identity,
  invoice reference, invoice/due dates, balances, aging buckets, and an as-of
  date.
- `AR Summary.pdf` is a 3-page, machine-readable aggregate report. It has
  amount, aging, and as-of-date information but no detected invoice or client
  identity fields; it is cross-check evidence only.

The detailed report is therefore the only permitted invoice-row source. The
summary may be associated only through the existing same-as-of-date
summary/detail reconciliation flow. Neither report is a Billing fixture or a
ledger writeback source. No PDF has been uploaded to Storage and no report row
has been inserted into the sandbox by this preparation work.

The schema-only bootstrap intentionally did not create the Supabase Storage
bucket. The reviewed application routes require a private
`collections-ar-pdfs` bucket, so the pending forward migration
`20261030010000_collections_ar_private_bucket.sql` creates that bucket with a
25 MB PDF limit and a `service_role`-only object policy. It must pass a dry run
and receive separate owner approval before application. The migration does not
upload either report.

The owner approved the one-migration dry run and Supabase reported successful
application of `20261030010000_collections_ar_private_bucket.sql`. The bucket
is empty. The next prerequisite is a single authenticated sandbox Owner profile
for the reviewed UI/API flow; direct table inserts remain prohibited for report
intake.

## Current blocker

The empty remote cannot yet receive the historical migration list directly because that list assumes a pre-existing baseline schema and the canonical baseline needs hardening. Compatibility review also found that later historical migrations expect legacy columns absent from both checked-in schema references, and one migration contains profile-specific backfill behavior. Reconstructing a bootstrap by guesswork would be unsafe.

## Approved bootstrap design

The owner supplied a schema-only export at
`supabase/.temp/tap_hub_project_schema.sql`, SHA-256
`c51426a55ce743a59dcbcb23dbc1eb78c9e772b9338d1b1425f87cfa22d16e72`.
It contains 2,388 lines and no `INSERT` or `COPY` statements.

`tools/sandbox/build-hardened-baseline.sh` creates a one-time, data-free
bootstrap migration from that exact export. It removes every source `GRANT`
statement and appends a deny-by-default privilege boundary: `anon` and
`authenticated` receive no schema, table, sequence, or function access, while
`service_role` remains server-only. `tools/sandbox/verify-hardened-baseline.sh`
is the static gate before review.

This is intentionally a separate sandbox migration history. It does not claim
that the legacy production-oriented migrations were executed on the sandbox.
After the initial approved baseline is applied, each approved Billing or
Collections schema change must be promoted as a new forward-only sandbox
migration and recorded in the validation handoff.
