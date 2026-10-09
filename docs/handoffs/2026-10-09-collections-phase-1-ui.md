# Handoff: Collections Phase 1 Billing and Collections UI

| Field | Value |
| --- | --- |
| Milestone | Collections Phase 1: UI consumer of the Billing and Collections API |
| Branch | `codex/collections-phase-1-ui` |
| Base commit | `b3ee47b` (`codex/collections-phase-1-billing-ledger`). First built on `22d7528`; rebased 2026-10-10 after the backend fixes. |
| Contract | `docs/contracts/collections-phase-1-billing-ledger.md` (Frozen). The routes on the base branch were treated as the request/response contract, because the frozen contract outlines operations only. |
| Backend changes | None from this branch. Mismatches are listed below for the producer. |

## Owned paths

- `app/billing/page.tsx`, `app/collections/page.tsx`
- `components/billing/`
- `lib/billing-ui/`
- `tests/billing-ui-data.test.mjs`, `tests/billing-ui-render.test.mjs`, `tests/helpers/load-ts.mjs`
- `app/layout.tsx`: two `NAV_ITEMS` entries only (Billing, Collections)

## Behavior

- **Billing page.** Invoices with their lifecycle:
  - draft: edit, add, edit and remove lines, issue once it has a line, delete the draft;
  - issued: locked; void is Owner/Admin only;
  - void: read-only.

  It also covers payments, allocations, reversals (Owner/Admin only), and receivables with the server's aging bucket.
- **Collections page.**
  - Receivables, the activity log, and the approval queue.
  - Holds: place and release are Owner/Admin only. A hold is shown as active, expired, or released.
  - A hold banner that names the hold's scope (client or invoice).
  - Escalation and formal-notice approval are Owner/Admin only. They are blocked while a hold is in force, using the server's rule: unreleased, the review date not passed, and client-wide or the same invoice.
- **Data flow.**
  - All data goes through `/api/billing/*`, `/api/collections/*`, `/api/me`, and `/api/clients?fields=lite`. The UI makes no Supabase calls and has no QuickBooks, OAuth, or email code; a test enforces this.
  - After every successful mutation, and after every `409`, the page reloads the affected sections from the API.
  - Balances, totals, days past due, and aging buckets are displayed exactly as the server returns them.
- **Permissions.** The UI hides Owner/Admin-only controls from other roles and explains why. The server's `401`, `403`, `404`, `409`, and `422` responses are still shown wherever they occur.

## API contract mismatches: status as of backend `b3ee47b`

| ID | Severity | Mismatch | Status at `b3ee47b` |
| --- | --- | --- | --- |
| UI-M1 | High | The payment and allocation routes rejected valid amounts (19.99, 1.13, 4.35, 0.29, 0.07) because of float math. | **Fixed** (`ce73c09`): the amount is validated as a string and passed through. |
| UI-M2 | High | Collections routes used the Billing module. | **Fixed** (`ce73c09`): `requireLedgerReadAccess` (Billing or Collections) on lists; `requireCollectionsAccess` for logging events. |
| UI-M3 | High | No audit records were written. | **Open, partly fixed** (`12ee5fd`). Only payment reversal and allocation reversal write `audit_log`. These still write no audit: <ul><li>invoice create, update, issue, void, and delete;</li><li>line add, update, and delete;</li><li>recording a payment;</li><li>`allocate_payment`;</li><li>placing and releasing holds;</li><li>Collections events and approvals.</li></ul> Validation requirement 4 still cannot pass. |
| UI-M4 | Medium | `hold_placed` and `hold_released` could be logged as free-form events. | **Fixed** (`ce73c09`). The hold routes still do not log hold events (minor). |
| UI-M5 | Medium | `formal_notice_sent` is accepted by no route. | **Open.** |
| UI-M6 | Medium | Approval did not check its source event or the hold's scope and expiry. | **Fixed** (`b3ee47b`). Requests are also refused during a hold. The duplicate-approval check is check-then-insert, not atomic (minor). |
| UI-M7 | Medium | Receivables are not the contract read models. | **Open, partly fixed** (`b3ee47b`): issued invoices only, plus a per-row `aging_bucket`. Still JavaScript `Number` math, no per-client aging totals, and no unallocated amount on payments. |
| UI-M8 | Low | Error codes are inconsistent. | **Open, partly fixed** (`ce73c09`): allocation `invalid_input` now returns `422`. Releasing a missing hold still returns `404`; bodies still have no stable code. |
| UI-M9 | Low | Payment reversal could race an allocation. | **Fixed** (`12ee5fd`): `reverse_payment` locks the payment row. |
| UI-M10 | Low | Drafts could not be discarded. | **Fixed, with gaps** (`b3ee47b`): `DELETE /api/billing/invoices/[id]`. It returns `{ deleted: true }` for a non-draft without deleting anything. A draft referenced by a hold or event fails the `on delete restrict` foreign key and returns `500`, not `409`. The delete is not audited. |

## Outside this branch's scope

- `app/users/page.tsx` `MODULES_LIST`: **fixed** in `ce73c09`; Collections is now assignable.
- `GET /api/clients` uses the service-role client with no identity check. Because `proxy.ts` treats `/api/` as public, the code suggests any caller can read active clients. Not verified live. **Open.**

## Commands and results

Commit: this branch on `b3ee47b`. Environment: local, Node `v22.14.0`, dependencies from `npm ci`.

| Command | Result |
| --- | --- |
| `node tests/billing-ui-data.test.mjs` | PASS (24 checks) |
| `node tests/billing-ui-render.test.mjs` | PASS (26 checks) |
| Mutation checks: void for every role; holds never active; hold expiry ignored | Each FAILS as expected; restored and PASS |
| `npx tsc --noEmit` | PASS |
| `npx eslint` on all new files | PASS |
| `npm run lint` (full repo) | 590 problems on 2026-10-09, identical to the base branch; none in new files. The `app/layout.tsx:202` error predates this branch. |
| `npm run build` | PASS; `/billing` and `/collections` built |
| `npm run test:support` | PASS |
| `node --experimental-strip-types tests/collections-route-access.test.mjs` | PASS |
| `node tests/collections-phase1-contract.test.mjs` | PASS |
| `node tests/regression-access-policy.mjs` | FAIL on the existing demo-password assertion. It fails the same way on the base branch and is unrelated to this change. |
| Responsive manual review in a browser | BLOCKED: there is no Supabase environment in this checkout, and `.env` files were not read or created. |
| Persistence (UI → API → row → audit → reload) | BLOCKED: no approved environment, and most mutations still write no audit (UI-M3). |

## Consumer and producer actions

1. Producer: finish UI-M3 (audit every mutation), and fix the UI-M10 delete gaps.
2. Producer: decide UI-M5, UI-M7, and UI-M8, or record them as deferred with an owner.
3. Producer: add database tests for the ledger invariants, concurrency, and the anon-key RLS check. Confirm whether the three Phase 1 migrations are applied to the hosted project.
4. Project owner: approve a non-production environment for browser and persistence validation.
5. Merge order: `codex/collections-phase-1-billing-ledger` first, then this branch.
6. Rollback: revert this branch's commits. They add two routes and two nav entries and change no backend or data.
