# Billing Phase 2: Engineer A acknowledgement of the refined contract

| Field | Value |
| --- | --- |
| Date | 2026-11-02 |
| From | Engineer A (Billing UI / workbench) |
| To | Engineer B, project owner |
| Accepts | `docs/contracts/billing-phase-2-pricing-and-candidates.md` and the decision and register updates on `codex/billing-phase2-prep` at `b25eda9`, **subject to the conditions in section 2** |
| Follows | `docs/handoffs/2026-10-29-billing-phase2-engineer-a-review.md` (`196298b`) |
| Scope | Documentation only. No Phase 2 migration, route or UI exists on any branch yet; this acknowledgement authorizes none |

## 1. Position

Engineer A accepts the Phase 2 scope and the refined rules. The 15 items in the 2026-10-29 review are resolved as follows.

| # | Item | State at `b25eda9` |
| --- | --- | --- |
| 1 | Numbering and the issue step | Resolved: nullable number migration, issue-year sequence, issue RPC with remittance snapshot |
| 2 | Void and delete candidate-aware | Resolved: audited RPCs restore candidates in the same transaction |
| 3 | Permission policy | Resolved in part: policy record, resolver and `GET /api/billing/permissions` added. Response fields and role defaults open (condition 4) |
| 4 | Terms and dates | Resolved in part: terms and remittance tables, issue date at issue, due date from terms. Draft date columns open (condition 1) |
| 5 | "What bills next" read | Resolved: read-only projection endpoint, marked projected |
| 6 | Endpoints and errors | Resolved in part: paths and nine error codes added. Request and response bodies open (condition 3) |
| 7 | Money in responses | Resolved for new endpoints (decimal strings); Phase 1 routes out of scope |
| 8 | Collections-only access | Resolved: 403 on every pricing, candidate, schedule, map and settings endpoint |
| 9 | Bundle lines | Resolved: one package line, quantity 1, unit amount equal to the package price |
| 10 | Editing candidate-linked lines | Resolved: snapshot lines immutable; removing one reopens its candidates |
| 11 | Firm date | Resolved: `America/Chicago` from `collection_settings.timezone`. Month-end and daylight-saving tests open (condition 6) |
| 12 | Hosted Operations schema | Open (condition 5) |
| 13 | Generation scope and idempotency | Resolved: 365-day window, idempotent, disabling a map stops future generation only |
| 14 | Dismiss and reopen | Resolved in part: dismissal reason required (422). Whether a reopen needs a reason is open (condition 6) |
| 15 | Provenance immutability | Resolved: database rules, not routes alone |

## 2. Conditions before the contract is frozen

1. **Draft dates and number.** `invoices.issue_date` and `due_date` are `not null` today and `POST /api/billing/invoices` requires a number and both dates. The contract says the issue date is set at issue and drafts carry no number. State that drafts have no issue date, due date or number until issue (columns nullable, the "due on or after issue" rule applying once both exist), and that the create route stops requiring them.
2. **Old issue and void calls.** The Phase 1 UI calls `POST /api/billing/invoices/[id]` with an `action` field. The new paths are `/issue` and `/void`. State whether the old form is kept during the transition or removed when Phase 2 ships.
3. **Request and response shapes.** For every endpoint in the "Frozen server boundary" table: request body, response body, a synthetic example, and the candidate cursor format. Engineer A will not build against paths and error codes alone.
4. **Permissions response and role defaults.** The fields `GET /api/billing/permissions` returns, and the default action set for Owner, Admin, Billing staff, Collections-only staff and unassigned staff. Billing staff must not get `pricing.manage` by default (frozen decision).
5. **Hosted Operations schema.** Confirm the source adapters are written against a schema export of `client_services`, `services`, `work_periods` and `period_counts`, not only the local fixture in `tools/collections-local`, and that the Phase 2 migrations create or alter no Operations tables.
6. **Small items.** Whether reopening a dismissed candidate needs a reason, and firm-date tests near month end and across a daylight-saving change in the evidence table.

The contract can be marked frozen once these are written in. Engineer A will then record a short freeze note and start Phase 3 planning against the published examples.

## 3. What Engineer A's UI will change when Phase 2 lands

Recorded now so Engineer B can see the consumer impact. None of this is built.

- **Draft creation.** The "New draft invoice" form drops the invoice number and issue and due dates. A draft is created from selected candidates (`POST /api/billing/invoices/from-candidates`); a manual empty draft stays possible only if condition 1 allows it.
- **Issue, void and delete.** The UI moves to the new paths. After issue the screen shows the number the server assigned. Void keeps the required reason and the existing "payments still applied" warning.
- **Line editing.** Candidate-linked lines show as locked with a "remove" action that explains the candidates return to `open`. Manual lines stay editable under the Phase 1 rules.
- **New errors.** Plain wording for the nine new codes, added to the existing error map.
- **Permissions.** Controls are shown from `GET /api/billing/permissions` for presentation only; the server stays the authority.
- **Money.** New responses are decimal strings; the UI formats them and does no arithmetic. Phase 1 responses (numbers) continue to format as they do now.
- **Phase 3 screens** (What bills next, Clients & prices, Settings, completion-rule configuration) are not started and wait on the frozen shapes.

## 4. Not covered here

Engineer B's own Phase 1 matrix and the concurrent-allocation evidence, and the merge of `codex/billing-phase1-ui` into `dev`, are tracked in `docs/handoffs/2026-10-29-billing-phase1-engineer-a-acceptance.md`.
