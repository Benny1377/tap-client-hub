# Collections Phase 1 Backend Review Fixes

Updated: 2026-10-10 (Asia/Kolkata)
Branch: `codex/collections-phase-1-billing-ledger`
Base inspected: `ded69a3`
Status: implementation changes are local and uncommitted; no production migration was run.

## Implemented in this checkout

- Added `20261010110000_billing_audit_and_receivables.sql`:
  - transactional row-level audit triggers cover invoices, invoice lines, payments, allocations, external IDs, holds, and Collections events;
  - transaction-scoped RPCs lock the client and atomically record events, approve requests, and create/release holds with matching timeline events;
  - unique indexes prevent duplicate approvals and duplicate formal-notice-sent records;
  - a server-side numeric read model returns invoice balances, per-client aging buckets, per-payment unallocated amounts, and per-client unallocated totals;
  - draft invoice/line deletion RPCs preserve actor identity and enforce lifecycle checks.
- API changes call the new read/mutation RPCs, return missing-hold as 409, expose `formal_notice_sent` only to Owner/Admin with a matching approval, and add stable error codes to changed paths while preserving `{ error }` for the UI.
- The clients GET route now requires an authenticated, active profile with a module assignment (or a power-user role); its unauthenticated service-role read path is closed.
- Retired the application demo-session fallback and added a hash guard to the application's sign-in route; this does not block direct Supabase Auth `signInWithPassword` calls. The project owner must reset affected Supabase Auth passwords and review sessions before sign-off; see `docs/decisions/2026-10-10-supabase-shared-password-rotation.md`. Auth identity resolution no longer trusts demo cookies.
- Added `tests/collections-phase1-review.test.mjs` and `supabase/tests/collections_phase1_security_and_audit.sql`; updated access-policy regression assertions for the retired demo path.

## Validation evidence

| Check | Result | Notes |
| --- | --- | --- |
| `npx tsc --noEmit` | PASS | No type errors. |
| `node tests/collections-phase1-review.test.mjs` | PASS | Static migration/API contract assertions only. |
| `node tests/regression-access-policy.mjs` | PASS | Updated access regression. |
| `git diff --check` | PASS | No whitespace errors. |
| `npm run test:support` | PASS | 119 assertions across the three support suites. |
| `npm run build` | PASS | Next.js production build and route generation complete. |
| Focused ESLint on auth/access files | PASS, 0 errors | Broader changed-file ESLint reports legacy `any`/unused-variable findings in the large existing routes and existing test/page code; no repo-wide lint pass is claimed. |
| SQL parser / PostgreSQL migration execution | BLOCKED | Docker daemon unavailable in this checkout. This migration has not been applied to production or verified against a disposable database. |
| Hosted anon-key, ledger-invariant, and concurrency tests | NOT RUN | No approved non-production database was supplied. Static assertions are not runtime proof. |
| Integrated UI end-to-end | NOT RUN | Requires the UI branch plus non-production database with this migration. |

## Required before Phase 1 sign-off

1. Review and execute the new migration against local/disposable Postgres first. Do not use production as a test target.
2. Run the SQL assertions in `supabase/tests/collections_phase1_security_and_audit.sql`; exercise over-allocation, cross-client allocation, duplicate approval, hold blocking, and deletion of both referenced and unreferenced drafts.
3. Integrate the UI branch against non-production data. Confirm advance-payment-only clients appear in `unallocated_by_client` and each payment exposes its own remaining amount.
4. Project owner must retire the exposed credential in Supabase Auth for all affected accounts and review/revoke sessions as appropriate. The app route hash check is only defense-in-depth and cannot stop direct Supabase Auth login.
5. Complete Preview behavior and Phase 1 sign-off. This handoff does not authorize merge to `main` or production migration.

## Architectural note

Auditing uses database row triggers rather than separate application audit RPC calls. A trigger executes in the same transaction as the mutation, covers direct writes and RPC writes uniformly, and rolls back with failed changes. Dedicated RPCs handle multi-row atomicity and race protection for holds/events and constrained deletion. This changes the internal mechanism, not the contract requirement that persisted mutations be audited transactionally.
