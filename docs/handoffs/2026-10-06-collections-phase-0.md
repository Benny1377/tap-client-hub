# Handoff: Collections Phase 0 Discovery

| Field | Value |
| --- | --- |
| Milestone | Collections Phase 0: read-only discovery and documentation |
| Branch | `codex/collections-phase-0` |
| Base commit | `c259a6edf871b43a0aa2ad0d11cb73dfd8f82653` (`codex/tap-hub-delivery-playbook`, which is `origin/main` `210a08a` plus documentation only) |
| Ready commit | The commit that adds this file on `codex/collections-phase-0` |
| Contract status | `docs/contracts/collections-phase-1-billing-ledger.md`: Draft |
| Decision | `docs/decisions/2026-10-06-collections-billing-source-of-truth.md`: Approved |

## Owned paths and changed behavior

The branch changes documentation only:

- `docs/decisions/2026-10-06-collections-billing-source-of-truth.md`
- `docs/contracts/collections-phase-1-billing-ledger.md`
- `docs/handoffs/2026-10-06-collections-phase-0.md`
- `docs/coordination/CURRENT_WORK.md`

There are no changes to application code, migrations, data, dependencies, or environments.

## Boundaries referenced

- Tables:
  - `billing_periods`, `audit_log`, `clients`, `client_services`, `work_periods`;
  - proposed Phase 1 tables listed in the contract.
- Code paths:
  - `lib/access-policy.ts`, `lib/access-server.ts`, `proxy.ts`;
  - `app/layout.tsx` (`NAV_ITEMS`), `app/users/page.tsx` (`MODULES_LIST`);
  - `app/api/credentials/route.ts` (server enforcement pattern).
- Environment variable names only: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. No values were read.

## Commands and results

Commit: `c259a6e` plus the uncommitted Phase 0 documents. Environment: local checkout, Node `v22.14.0`, no `node_modules`.

| Command | Result |
| --- | --- |
| `git diff --check` | PASS (recorded at commit time) |
| `node tests/manager-user-edit.test.mjs` | PASS |
| `node --experimental-strip-types tests/contacts-route-access.test.mjs` | PASS. Plain `node` fails only because it cannot load `.ts` files. |
| Ad hoc read-only probe of `lib/access-policy.ts` (`effectiveModules`, `canAccessPathname`) | PASS. Owner/Admin get `Billing`. `["Collections"]` is dropped for staff. `/billing/invoices` is denied for Owner, Admin, and staff with Billing; only exact `/billing` is allowed. |
| `node tests/regression-access-policy.mjs` | BLOCKED: needs the `typescript` package; dependencies are not installed. |
| `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run test:support` | NOT RUN: no dependencies installed, and no application code changed. |
| Hosted Supabase schema, RLS, and row inspection | BLOCKED: no linked project configuration in the checkout, and no approval for production reads. |

## Limitations and blockers

- Live production state is unverified: the `billing_periods` shape and row count, the `clients.id` type, the `audit_log` shape, RLS, and grants.
- The Vercel deployment of `main` is unverified.
- Phase 1 needs a migration location decision, approved hosted inspection, approval for `npm install`, and resolution of contract risk R1 (unsigned identity cookie).
- This branch is stacked on `codex/tap-hub-delivery-playbook`, which must merge first.

## Consumer actions

1. The producer and consumer review the Draft contract, set reviewer names and the approval date, and freeze it before Phase 1 code starts.
2. The project owner approves the hosted read-only inspection and the migration location.
3. Rollback: revert the documentation commit. No runtime effect.
