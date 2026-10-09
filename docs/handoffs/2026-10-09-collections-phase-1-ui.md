# Handoff: Collections Phase 1 Billing and Collections UI

| Field | Value |
| --- | --- |
| Milestone | Collections Phase 1: UI consumer of the Billing and Collections API |
| Branch | `codex/collections-phase-1-ui` |
| Base commit | `22d7528711ce15b8cebe80c66dc6ef03f6a0d4a4` (`codex/collections-phase-1-billing-ledger`) |
| Contract | `docs/contracts/collections-phase-1-billing-ledger.md` (Frozen). The routes on the base branch were treated as the request/response contract, because the frozen contract outlines operations only. |
| Backend changes | None. Mismatches are listed below for the producer to decide on. |

## Owned paths

- `app/billing/page.tsx`, `app/collections/page.tsx`
- `components/billing/`
- `lib/billing-ui/`
- `tests/billing-ui-data.test.mjs`, `tests/billing-ui-render.test.mjs`, `tests/helpers/load-ts.mjs`
- `app/layout.tsx`: two `NAV_ITEMS` entries only (Billing, Collections)

## Behavior

- **Billing page.** Invoices with their lifecycle:
  - draft: edit, add, edit and remove lines, issue once it has a line;
  - issued: locked; void is Owner/Admin only;
  - void: read-only.

  It also covers payments, allocations, reversals (Owner/Admin only), and receivables.
- **Collections page.** Receivables, holds (place and release are Owner/Admin only), an active-hold banner, the activity log, and the approval queue. Escalation and formal-notice approval are Owner/Admin only and blocked by an active hold.
- **Data flow.**
  - All data goes through `/api/billing/*`, `/api/collections/*`, `/api/me`, and `/api/clients?fields=lite`. The UI makes no Supabase calls and has no QuickBooks, OAuth, or email code; a test enforces this.
  - After every successful mutation, and after every `409`, the page reloads the affected sections from the API.
  - Balances, totals, and days past due are displayed exactly as the server returns them.
- **Permissions.** The UI hides Owner/Admin-only controls from other roles and explains why. The server's `401`, `403`, `404`, `409`, and `422` responses are still shown wherever they occur.

## API contract mismatches (for the producer; backend not changed)

| ID | Severity | Mismatch | Evidence | UI handling today |
| --- | --- | --- | --- | --- |
| UI-M1 | High | Valid amounts are rejected. The payment and allocation routes check decimals with float math, so amounts such as 19.99, 1.13, 4.35, 0.29, and 0.07 return `422 amount must be positive and have at most two decimals`. | `app/api/billing/payments/route.ts:29`, `app/api/billing/allocations/route.ts:17`. Reproduced with Node using the same expression. | The UI accepts these amounts and shows the server's 422. Users cannot record such payments until the route is fixed. |
| UI-M2 | High | Collections access uses the Billing module. Every `/api/collections/*` route, and every list route, calls `requireBillingAccess()`. Staff assigned only Collections get 403 everywhere, and staff assigned only Billing can log Collections activity and request escalations. The contract gives these operations to "users assigned Collections" (list: "Billing or Collections"). | `lib/billing-access.ts`, `app/api/collections/events/route.ts`, `app/api/collections/holds/route.ts` | The Collections page shows the 403 per section. Owner/Admin are unaffected. |
| UI-M3 | High | No audit records are written. `writeBillingAudit` and the `record_billing_audit` RPC exist, but no route calls them, so no ledger or Collections mutation is audited. Phase 1 validation requirement 4 (the audit row) cannot pass. | `grep writeBillingAudit` / `record_billing_audit` under `app/` finds no callers. | None possible in the UI. |
| UI-M4 | Medium | Hold events can be forged. `POST /api/collections/events` accepts `hold_placed` and `hold_released` from Billing-module staff without changing any hold. The hold routes do not log those events either. | `app/api/collections/events/route.ts:26` | The UI never offers these types; holds use the dedicated Owner/Admin controls. |
| UI-M5 | Medium | `formal_notice_sent` is a contract event type, but no route accepts it. | events `allowed` set; approve route accepts only `escalated` and `formal_notice_approved` | Not offered. |
| UI-M6 | Medium | Approval does not check its source event. `POST /api/collections/events/approve` does not verify that the source is a matching request (`escalation_requested` → `escalated`, `formal_notice_requested` → `formal_notice_approved`) or that it has not already been approved. Its hold check is client-wide (it ignores the invoice scope) and ignores `expires_on`. | `app/api/collections/events/approve/route.ts` | The UI offers only the matching approval and hides approved requests. It treats any unreleased hold as blocking, matching the server. |
| UI-M7 | Medium | Receivables are not the contract read models. They are computed in the route with JavaScript `Number` math (R8), include **draft** invoices with days past due, and have no `client_receivables_aging` buckets. Payments carry no unallocated amount. | `app/api/billing/receivables/route.ts` | Shows the route's rows as returned. The Collections page filters to issued invoices. It shows no aging buckets or unallocated amounts, because computing them would be client-side balance math. |
| UI-M8 | Low | Errors are not stable codes. Bodies are `{ error: <message> }`. Allocation `invalid_input` errors map to `409`, not `422`. Releasing a missing hold returns `404` where the other routes return `409`. An invalid JSON body returns `400`. | the allocation, hold, and all POST routes | Classified by HTTP status; the server message is shown. |
| UI-M9 | Low | Reversal can race allocation. Payment reversal counts active allocations and then updates the payment, outside the `allocate_payment` row lock. A concurrent allocation can leave a reversed payment with an active allocation. | `app/api/billing/payments/[id]/route.ts` | None possible in the UI. |
| UI-M10 | Low | Drafts cannot be discarded: there is no delete or void for draft invoices. | invoices routes | Drafts stay listed. |

## Outside this branch's scope (not changed)

- `app/users/page.tsx` `MODULES_LIST` has no `Collections`, so the module cannot be assigned through Users & Access.
- `GET /api/clients` uses the service-role client and has no identity check. Because `proxy.ts` treats `/api/` as public, the code suggests any caller can read active clients. The UI uses `?fields=lite` for client names. Not verified live.

## Commands and results

Commit: working tree on `22d7528` plus this branch's changes. Environment: local, Node `v22.14.0`, dependencies from `npm ci`.

| Command | Result |
| --- | --- |
| `node tests/billing-ui-data.test.mjs` | PASS (23 checks) |
| `node tests/billing-ui-render.test.mjs` | PASS (25 checks) |
| Mutation check: void allowed for every role, holds never active | FAIL as expected; restored and PASS |
| `npx tsc --noEmit` | PASS |
| `npx eslint` on all new files | PASS |
| `npm run lint` (full repo) | 590 problems, identical to the base branch; none in new files. The `app/layout.tsx:202` error predates this branch. |
| `npm run build` | PASS; `/billing` and `/collections` built |
| `npm run test:support` | PASS |
| `node --experimental-strip-types tests/collections-route-access.test.mjs` | PASS |
| `node tests/collections-phase1-contract.test.mjs` | PASS |
| `node tests/regression-access-policy.mjs` | FAIL on the existing demo-password assertion. It fails the same way on the base branch and is unrelated to this change. |
| Responsive manual review in a browser | BLOCKED: there is no Supabase environment in this checkout, and `.env` files were not read or created. |
| Persistence (UI → API → row → audit → reload) | BLOCKED: no approved environment, and audit writes are missing (UI-M3). |

## Consumer and producer actions

1. Producer: decide UI-M1 to UI-M3 before release. UI-M1 blocks normal payment entry.
2. Producer: decide UI-M4 to UI-M10, or record them as deferred with an owner.
3. Project owner: approve a non-production environment for browser and persistence validation.
4. Merge order: `codex/collections-phase-1-billing-ledger` first, then this branch.
5. Rollback: revert this branch's commit. It adds two routes and two nav entries and changes no backend or data.
