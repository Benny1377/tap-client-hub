# Handoff: Collections UI, Phase 1 completion and Phase 2

| Field | Value |
| --- | --- |
| Milestone | Collections Phase 1 UI completion and Phase 2 UI (Engineer A track) |
| Branch | `codex/collections-phase-2-ui` |
| Base | `codex/collections-ui` (`50b886a`) = `codex/collections-phase-2-backend` (`0e01c19`) + the Phase 1 UI |
| Contracts consumed | `docs/contracts/collections-phase-1-billing-ledger.md` (Frozen); `docs/contracts/collections-phase-2-backend.md` (Draft) with the response types in `lib/collections-api.ts` |
| Backend changes | None. Requests for the producer are listed below. |
| Supersedes | `docs/handoffs/2026-10-09-collections-phase-1-ui.md`. Its UI-M1 to UI-M10 items are all resolved by `e2df16e` and `0e01c19`. |

## Owned paths

- `app/billing/page.tsx`, `app/collections/page.tsx`
- `components/billing/` (new: `worklist-panels.tsx`)
- `lib/billing-ui/`
- `tests/billing-ui-data.test.mjs`, `tests/billing-ui-render.test.mjs`, `tests/helpers/load-ts.mjs`
- `app/layout.tsx`: the Billing and Collections `NAV_ITEMS` entries only

## Phase 1 completion

- **Firm date.** The Collections page uses the server's firm date (`as_of_date`) for every hold and approval decision. The browser date is a fallback only while the worklist is unavailable. The Billing page shows the receivables `as_of_date`.
- **Invoice required.** Escalation and formal-notice requests must name an invoice. Notes, reminders, calls, and promises to pay may stay client-level. This avoids the client-level stage case listed below.
- **Notice sent.** "Approved notices not yet recorded as sent" lists formal-notice approvals without a matching `formal_notice_sent`.
  - Owner/Admin can record one; it posts `approval_event_id` and a required note on how and when the notice went out.
  - Other roles see the Owner/Admin boundary, and an applicable hold blocks it.
  - The page states that TAP Hub sends nothing.
- **Payments.** Each payment shows the server's `unallocated_amount`, and the allocation picker shows the amount left.
- **Aging.** The Billing receivables panel shows the selected client's `client_aging` totals.
- **Holds.**
  - A hold can apply to the whole client or to one open invoice, and the table shows the scope.
  - Review dates before the firm date are rejected before submitting, matching `place_collection_hold`.
- **Error codes.** API failures keep the server's stable `code`, alongside the HTTP-status classification.
- **History.** The history table shows the invoice and the reminder's ladder stage.

## Phase 2

- **AR insights** (`GET /api/collections/receivables`):
  - open balance, unallocated credit, and net AR estimate;
  - accounts owing, open invoices, and oldest days past due;
  - the five aging buckets;
  - the count of accounts with credit to reconcile.
- **Call list.** Accounts are ordered by the server's priority score. Each row shows:
  - flags: hold, credit to reconcile, contact needs review;
  - the primary contact: name, phone, email;
  - the score breakdown by age band (balance × weight = weighted amount), noting that balances under 21 days add nothing;
  - each open invoice's next ladder step, hold, and below-minimum state.

  It pages 50 accounts at a time, and selecting a client filters the whole page.
- **Automation preview** (`POST /api/collections/automation/preview`):
  - Owner/Admin only; other roles see the boundary and never call the endpoint;
  - optional as-of date;
  - each action shows its step, its outcome (suppressed, reminder candidate, or Owner/Admin review), and the server's reasons and warnings;
  - paged results;
  - a safety note built from the response: automation off, delivery disabled, nothing sent.
- **No new client-side money math.** Every amount is the server's decimal string, formatted only.
- **Stage labels.** These are display defaults, because the rules API is deferred.

## Engineer A review of the Phase 2 contract

**Approved, with one condition.** The 2026-10-10 review points are resolved in `0e01c19`: shared firm date, event-type stages, full-scan preview, response types, and score components. The response types match what the UI consumes.

**Condition:** the stage inference in `get_collections_worklist` must not apply client-level (`invoice_id` null) escalation or formal-notice events to invoices issued or due after the event. Today such an event counts as stage 4 or 5 for every invoice the client ever has, so a later invoice skips the stage 1–3 reminders. The UI now requires an invoice for those requests, but existing or API-created client-level events still trigger it.

## Requests for the producer (not blocking the UI)

1. **Invoice numbers in list responses.** Include `invoice_number` in the hold and event list responses. The UI can only name invoices that are still open (from the worklist); holds and events on paid invoices show the raw id.
2. **Recording a notice as sent during a hold.** `record_collection_event` refuses `formal_notice_sent` while a hold applies. If a notice already went out before the hold was placed, staff cannot record that fact. Please confirm this is intended, or allow recording a past send.
3. **Rules endpoint.** Add `GET /api/collections/rules` (deferred in the contract), so the UI can show the configured ladder labels and thresholds instead of defaults.

## Commands and results

Commit: this branch on `50b886a`. Environment: local, Node `v22.14.0`, dependencies from `npm ci`.

| Command | Result |
| --- | --- |
| `node tests/billing-ui-data.test.mjs` | PASS (38 checks) |
| `node tests/billing-ui-render.test.mjs` | PASS (45 checks) |
| Mutation checks: notice recording open to all roles; preview open to all roles; no invoice requirement | Each FAILS as expected; restored and PASS |
| `npx tsc --noEmit` | PASS |
| `npx eslint` on the UI files and tests | PASS |
| `npm run lint` (full repo) | 587 problems, identical to the base `50b886a`; none in UI files |
| `npm run build` | PASS; `/billing` and `/collections` built |
| `npm run test:support`, `regression-access-policy`, `collections-route-access`, `collections-phase1-contract`, `collections-phase1-review`, `collections-phase-2-backend-contract` | PASS |
| `client-card-iss-008-009-011`, `client-slideover-renditions`, `contact-profile-actions.contract`, `support-resend-delivery` | FAIL; these fail identically on `origin/main` and are unrelated |
| SQL tests (`supabase/tests/*.sql`) | NOT RUN: no non-production database |
| Browser and responsive review; persistence (UI → API → row → audit → reload) | BLOCKED: no non-production environment in this checkout |

## Browser test, 2026-10-10

**Setup.**
- The real app ran under `next dev` in the built-in browser.
- A temporary in-browser mock of the `0e01c19` routes stood in for the API, because no non-production database exists.
- That mock is local only: it lives in `dev-mock/`, excluded from git and not committed. The real routes and SQL were not exercised.
- Roles tested: Owner, Billing-only staff, Collections-only staff, and staff with neither module, plus a mid-session permission change (403).
- Viewports: desktop and 375px.

**Twelve UI bugs were found and fixed.** Each fix has a unit or render test and was re-checked in the browser.

| # | Bug | Fix |
| --- | --- | --- |
| 1 | The draft and line edit forms reset to pre-save values after a save, so a second save could wipe data. | Edit forms keep saved values (`resetOnSuccess={false}`) and remount when the saved record changes. |
| 2 | The shell header showed the Clients title on `/billing` and `/collections`. | Added `PAGE_TITLES` entries and removed the duplicate in-page headings. |
| 3 | Input ids were duplicated across forms on one page. | Ids are scoped per form with `useId`. |
| 4 | Every conflict showed a generic headline plus raw text such as `invariant_violation: …`. | Stable error codes map to plain-language headlines, and internal prefixes are stripped. |
| 5 | Drafts read "Issued <date>". | Drafts read "Issue date <date>". |
| 6 | Overdue invoices with no next stage read "Up to date". | They now read "Ladder complete — follow up manually", or "Not due yet". |
| 7 | "Reverse payment" was offered while allocations were still active, and allocation reversal took one click. | The page explains that allocations must be reversed first, and allocation reversal has a confirm step. |
| 8 | Holds on a single invoice were not flagged in the activity form. | Held invoices are named before a request is tried. |
| 9 | The hold banner repeated the client name. | One entry per client, listing that client's hold scopes. |
| 10 | Paging the call list reloaded holds and activity, and invoice names were lost on later pages. | The worklist has its own loader, and invoice names come from all issued invoices. |
| 11 | Summary cards stacked one per row on a phone. | A grid with a 100px minimum fits two per row at 375px. |
| 12 | A React warning came from mixing `border` with `borderColor`. | Inputs use border longhands; the warning no longer appears. |

**Backend findings from the same test** (reported to the producer):
- Unapproved escalation and formal-notice requests count as completed ladder stages.
- Error messages carry internal prefixes.
- Open question: whether a 21+ day invoice with no reminders should start at stage 1.

## Release gates still open (not UI work)

- The producer fixes the client-level stage inference (the condition above).
- The owner rotates the exposed shared Supabase password and reviews sessions (COL-DEP-10).
- Hosted migration state is verified. The owner reports `20261010110000` and `20261010120000` applied. `20261010130000`, which carries the Phase 1 audit-actor and shared-date fixes, is not applied, so Phase 1 depends on it.
- One non-production run: apply migrations through `20261010130000`, run the SQL tests, then validate this UI end to end in a browser.
- Merge order: `codex/collections-phase-2-backend`, then `codex/collections-phase-2-ui`, under the project's all-phases gate.
