# Billing Phase 2: Engineer A freeze review

| Field | Value |
| --- | --- |
| Date | 2026-11-04 |
| From | Engineer A (Billing UI / workbench) |
| To | Engineer B, project owner |
| Reviews | `docs/contracts/billing-phase-2-pricing-and-candidates.md` and `docs/handoffs/2026-11-02-billing-phase2-owner-response.md` on `codex/billing-phase2-prep` at `7ed3193` |
| Follows | `docs/handoffs/2026-11-02-billing-phase2-engineer-a-acknowledgement.md` (`78161ad`) |
| Scope | Documentation only. No Phase 2 migration, route or UI is built or authorized by this review |

## 1. Position

The six conditions in the 2026-11-02 acknowledgement are addressed in `7ed3193`. Engineer A **accepts the revision as the Phase 2 contract and will treat the endpoint paths, request and response shapes, permission keys and error codes as frozen**, with two things recorded below:

- section 3: one gate that blocks the Operations adapter work, though not the freeze of the UI-facing contract;
- section 4: six clarifications to write into the contract. None changes a path or a rule; each removes a guess the UI would otherwise make.

If Engineer B and the owner prefer to hold the freeze until section 4 is written in, Engineer A has no objection. Phase 3 UI work starts from the published examples once the freeze is recorded.

## 2. The six conditions

| # | Condition | State at `7ed3193` |
| --- | --- | --- |
| 1 | Draft number and dates | Closed. Nullable columns, `POST /api/billing/invoices` takes only `clientId` and optional `memo`, issue assigns number and dates |
| 2 | Old issue and void calls | Closed, with clarification C1: the adapter's response shape |
| 3 | Request and response shapes | Closed for the listed endpoints. Clarifications C2, C3, C4 and C5 cover gaps |
| 4 | Permissions response and defaults | Closed, with clarification C6 |
| 5 | Hosted Operations schema | **Open: see section 3** |
| 6 | Reopen reason, firm-date tests | Closed. Reopen needs a non-empty audited reason; month-end, leap-year and daylight-saving cases are listed |

## 3. Gate: Operations period column type

The contract says to treat `work_periods.period` and `period_counts.period` as integer `YYYYMM`, based on the repository API fixes `6fc91c9` and `d104262`.

Engineer A read the shared sandbox's REST schema (read-only; no row was read or written, and the tables are empty) on 2026-11-04. The sandbox declares both columns as **text**, not integer. The sandbox was built from the owner's schema export, so this conflicts with the repository fixes, which say a database column expected an integer.

Neither source is shown to match the hosted Operations database. Engineer A therefore asks for:

1. a schema export of `work_periods`, `period_counts`, `client_services` and `services` from the Operations owner, with the actual column types, recorded in the handoff;
2. Phase 2 adapter work held until that is done, as the contract already says for any mismatch.

This does not change any UI-facing shape, since Billing normalizes to `YYYY-MM` either way.

## 4. Clarifications to write into the contract

| # | Clarification |
| --- | --- |
| C1 | **Shape convention and the legacy adapter.** Phase 1 routes use snake_case (`client_id`, `invoice_number`, `void_reason`). Phase 2 examples use camelCase. Please state that Phase 2 routes are camelCase, and say what the deprecated `POST /invoices/[id]` adapter returns: today's snake_case body, or the canonical camelCase body. The current UI reads snake_case, so a camelCase adapter response would force a UI change before the cutover it exists to avoid |
| C2 | **Removing a candidate-linked line.** The rules say removing one returns its candidates to `open`, but no endpoint is named. State that the existing `DELETE /api/billing/invoice-lines` route does this, that it returns `returnedCandidateIds` and a refresh target, and that `PATCH` on such a line returns `CANDIDATE_LINKED_LINE_IMMUTABLE` |
| C3 | **Client and client-service terms overrides.** The data boundary lists effective-dated overrides, and `GET /settings/terms` returns an `overrides` array, but no endpoint writes one. Add the endpoint or say it is deferred and name the phase |
| C4 | **Paging for every list.** The cursor format is given for candidates. Say the rate-card and bundle lists use the same opaque cursor and name their sort order |
| C5 | **Generate `skipped`.** List the reasons a service is skipped (for example no map, disabled map, source not complete, outside the window) and say whether an unpriced candidate counts as `created` |
| C6 | **Permissions endpoint for non-Billing users.** It is for "any authenticated Billing user". Confirm that Collections-only and unassigned sessions get `403` there as on the other endpoints, so the UI shows no Billing controls |

## 5. What Engineer A does next

- On the freeze record from Engineer B and the owner: Phase 3 planning against the published examples, in this order: Invoices (draft from candidates, issue, void, line rules), What bills next, Clients & prices, then Settings and completion-rule configuration.
- No Phase 3 screen or Phase 2 route is started before that record. Phase 2 server work remains Engineer B's.
- The UI changes listed in section 3 of the 2026-11-02 acknowledgement still apply, plus the camelCase and nullable-draft changes in C1.

## 6. Not covered

Engineer B's own run of the Phase 1 HTTP matrix, hosted Phase 1 behavior, and the sandbox A/R Preview validation are tracked elsewhere (`docs/handoffs/2026-11-04-billing-phase1-engineer-a-closeout.md`).
