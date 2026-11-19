# Billing Phase 3 backend additions

Date: 2026-11-19
Branch: `codex/billing-phase3-backend-expansion`
Base: `origin/codex/billing-phase3-design` at `9e51cd8`
Status: implementation prepared locally; not committed, pushed, deployed, or applied to Supabase.

## Owner decisions recorded

- Firm-wide month-end generation creates billable candidates only. It never creates invoice drafts.
- A/R report history remains in Collections. Billing does not add an imported A/R history filter or import A/R report rows.
- Firm signer, address, billing email, and phone are immutable invoice presentation snapshot fields captured at issue.
- Reconciliation/payment workflows remain deferred under the existing Phase 3 contract. The current UI branch contains a Reconciliation tab using manual payment/allocation operations; that UI still needs Engineer A's scope reconciliation before integration.

## Backend and contract changes

- `GET /api/billing/clients/summary?limit=20&cursor=<opaque>` now pages firm clients by name and ID and returns each bounded client summary, including resolved price source, package name, terms, monthly estimate, next candidate date, receivables, and a unique primary contact when one exists.
- `GET /api/billing/invoices/summary` returns `openAmount`, `pastDueAmount`, `billedThisYear`, and Houston `asOf` as server-computed decimal strings.
- `GET /api/billing/candidates/firm-schedule?...&includeRunTotals=true` optionally adds the next three projected dates with server-calculated per-client totals and candidate counts. It reads projection pages and does not persist candidates.
- `POST /api/billing/candidates/generate` accepts `scope:"firm"`, a bounded 365-day window, page size 1–50, and an opaque client-service cursor. It generates only that page's candidates and returns `nextCursor`; retry remains safe through source identity uniqueness.
- Invoice line results include `work`, `source`, and the existing `candidateIds`, sourced from Billing line/candidate records. Manual lines are labeled `manual`; A/R imports are not treated as Billing invoices.
- Presentation settings accept and return `signerName`, `firmAddress`, `billingEmail`, and `firmPhone`. The issue RPC captures all seven presentation fields, including null values, in the immutable invoice snapshot.
- Local seed data now includes explicit source maps and a deterministic synthetic rate card for its active Operations services. The previous empty schedule fixture had no Billing source maps or rates; absence of maps caused an empty projection, and no candidate was needed to explain that fixture result.
- The contract amendment records all approved owner choices and API response shapes.

## Migration

Created with Supabase CLI as:

`20261119143906_billing_phase3_firm_workbench_summary_and_presentation_details.sql`

It exists in both `supabase/migrations/` and the sandbox mirror. It adds four nullable firm presentation columns, a read-only invoice summary RPC, and updates the atomic issue RPC snapshot. The reset harness includes the migration. It has **not** been applied remotely or locally in this handoff.

## Validation status and remaining integration work

- TypeScript check was attempted. It reports one existing environment/dependency resolution error: `lib/collections-pdf-parser.ts` cannot resolve `pdfjs-dist/legacy/build/pdf.mjs` from the available shared `node_modules`. No Billing-specific type error was reported, but this does not replace a complete typecheck in a dependency-complete checkout.
- No test suite, database migration, Preview, or hosted run was executed for this change set.
- Firm presentation forms and invoice rendering were updated here to read, edit, and display the new snapshot fields. Engineer A still needs to wire the UI to firm client pagination, invoice totals, per-run totals, Work/Source fields, and firm generation. The current UI does not request `includeRunTotals` or firm-generation scope.
- Engineer A should remove/defer the new manual reconciliation workflow or obtain a separate owner-approved contract before integrating it; the frozen Phase 3 contract explicitly excludes manual payment/reconciliation workflows.
- After review and integration, apply the migration deliberately to the isolated sandbox, then run the Billing route/matrix and Preview UI checks against the deployed test-fork build. This branch has not been pushed or deployed.
- Pre-production gates remain separate: read-only payroll/EFTPS database access-boundary verification and read-only Operations compatibility verification. No real production rollout is authorized here.
