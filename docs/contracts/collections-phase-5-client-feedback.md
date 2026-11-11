# Collections Phase 5: Client Feedback (Ladder Start, Call Notes, Cleared Invoices, Late History, Email Log)

State: **Owner decisions D1–D5 approved 2026-11-10; implementation follow-ups in progress.** This contract does not authorize a hosted migration, production change, real-report import, or live delivery.

- Producer: Engineer B (Collections backend: read model, rules, delivery history, migrations).
- Consumer: Engineer A (Collections UI and integrated testing).
- Source: client feedback on the Sandbox Preview, 2026-11-10 (seven items; the file watcher is deferred, see Exclusions).
- Builds on: [Phase 2 backend](collections-phase-2-backend.md), [Phase 3 source-identity addendum](collections-phase-3-source-identity-addendum.md), [Phase 4 A/R PDF intake](collections-phase-4-ar-pdf-intake.md).
- Design reference: `practiceops_1.html`. Only the late-payment count (item 4) has a design precedent; the other items have no demo equivalent and are built to the existing PracticeOps visual language.
- Baseline commit: `dev` at `d17c305`.

## Capability boundary

In scope:

1. **Ladder start** — the first touch on any invoice is always Friendly (stage 1); later stages follow the configured rules.
2. **Call notes** — notes on the top-15 call list, with an indicator on rows that have notes.
3. **Cleared invoices** — a PDF-sourced invoice missing from a newer approved A/R report is treated as cleared.
4. **Late history** — per client, how many times an invoice went beyond the final escalation deadline, derived from the configured rules.
5. **Email log** — a per-client tab listing how many reminders of each type were sent for each invoice, and when. Message bodies are not stored.
6. **Full dates** — Pipeline invoice dates show the year (frontend only).

Exclusions:

- **File watcher** (automatic report pickup): deferred for a separate discussion; no part of this contract depends on it.
- No change to Billing invoices, payments, allocations, or client records. PDF data still never writes to Billing.
- No live-client email. Delivery stays `disabled`/test-only. No new sender, recipient, or provider configuration.
- No storage of email subjects, bodies, or readable recipient addresses beyond what Phase 3 already retains.

## Item 1 — First touch always starts at Friendly

**Approved change to the Phase 2 rule.** The owner approved replacing catch-up with a Friendly-first policy for all invoices. The next proposed reminder is the earliest eligible step, never a later automatic stage just because its threshold has passed.

Proposed behavior:

- An invoice (canonical collection identity) with no completed stage has `next_stage = 1` (Friendly) whenever it is at least the Friendly threshold past due, regardless of how far past due it is. This applies identically to Billing-sourced and PDF-sourced invoices; the SQL read model and `lib/collections-import-worklist.ts` must agree. A high-balance shortcut must not jump over the Friendly, Professional, or Firm stage.
- Each later stage is proposed only when its `days_past_due` threshold is met and its minimum gap since the prior completed stage has passed. `min_days_since_previous` is an Owner/Admin-editable per-stage ladder-rule field (integer ≥ 0), returned by `GET /api/collections/rules` and accepted by `PATCH /api/collections/rules` through the existing audited configuration transaction. Approved defaults: 7 days for stages 2, 3, and 4; stage 5 keeps its existing threshold and approval gate, with no new gap.
- Stage 4 (Owner escalation) and stage 5 (formal notice) remain human gates; this changes eligibility timing only, not their authorization or approval requirements. Stage 5 is not eligible until its existing threshold is met and an explicit Owner/Admin approval occurs.
- An invoice that already has completed stages keeps its history; nothing is reopened or re-sent.
- `current_stage` must stop being threshold-only for display. Every worklist invoice returns:
  - `completed_stage` (existing), `next_stage` (existing, new semantics above), and
  - `next_stage_eligible_on: "YYYY-MM-DD" | null` — the earliest firm-local date on which `next_stage` is eligible, computed as the later of its threshold date and the prior completed stage date plus its configured gap. It may be before the current firm date when the stage is already eligible; `null` when no later enabled stage exists.
  - `current_stage` is retained for compatibility but is documented as "threshold reached", not "ladder position". The UI must not derive ladder position from thresholds.
- Preview (`POST /api/collections/automation/preview`) and the test runner apply the same rule. A preview can never propose two stages for one invoice on the same run.

Frontend: Pipeline ladder bands, status chips, AR Insights tiers and the call list place each account by its oldest invoice's `completed_stage`/`next_stage`, not by days past due. Accounts that are past a threshold but not yet touched show as "Friendly due" rather than at the later rung.

## Item 2 — Notes on the top-15 call list

The existing events API already supports notes: `POST /api/collections/events` with `event_type: "note"` (account- or invoice-scoped, audited) and `GET /api/collections/events?client_id=`. No new write path is needed.

Requested backend additions (additive, read-only):

- `GET /api/collections/events` accepts optional `client_id` (UUID), `event_type` (one of the existing event types), and `limit` (1–200, default 50) / `offset` (0–100,000, default 0). If `client_id` is omitted, the endpoint returns a cross-client page for the approval queue and activity history; if supplied, it filters to that client. Results sort by `occurred_at DESC, id DESC`; response is `{ events, pagination: { limit, offset, total } }`.
- A malformed or empty supplied `client_id`, invalid `event_type`, invalid `limit`, and invalid `offset` return 422 with `INVALID_CLIENT_ID`, `INVALID_EVENT_TYPE`, `INVALID_LIMIT`, and `INVALID_OFFSET`; omission of `client_id` is valid. Access errors remain 401 `UNAUTHENTICATED` / 403 `FORBIDDEN`, read errors return 500 `READ_FAILED`.
- `GET /api/collections/receivables` returns per account `note_count: number` and `last_note_at: string | null` (ISO timestamp). Counts include all note events for that client, whether account- or invoice-scoped, so the indicator needs no per-row request.

Frontend: each of the top-15 call rows gets a notes button showing an indicator (count) when `note_count > 0`; opening it lists that client's notes (author, firm-local date/time, text) and offers an add-note form. Notes are free text, 1–2,000 characters, trimmed; the server is authoritative for length. Access is Owner/Admin and staff with Collections access; Billing-only and unassigned staff are forbidden. Notes are internal and never included in client-facing email.

## Item 3 — Absent from a newer report means cleared

Current behavior (defect): the worklist takes each imported invoice's latest approved row across all approved reports, so an invoice that disappears from a newer report keeps its old row and stays on the call list.

Proposed behavior:

- When a detail/summary pair with as-of date `D` is approved, every **PDF-sourced** identity whose latest approved row has an as-of date earlier than `D` and which is absent from the newly approved detail report is marked **cleared**: `cleared_as_of = D`, `cleared_by_batch_id`, recorded in the same approval transaction with an audit entry per identity (counts and IDs only, no customer names in the audit detail).
- Clearing is allowed only when the approver explicitly confirms `complete_report_confirmed: true` if `would_clear.count > 0`. The server recomputes the impact inside the same approval transaction; the confirmation is recorded in the batch audit. The approval preview returns the count and total balance plus a paginated affected-row drilldown for review. Partial/filtered exports must not be declared complete.
- Identity continuity across reports: after the customer is matched to one TAP Hub client, auto-match may reuse a prior `source_invoice_id` only when exactly one invoice in an earlier approved detail report has the exact same client, invoice number, and transaction date. Balance, due date, or aging changes do not change this identity key. If the invoice number or transaction date differs, if the exact key matches multiple prior identities, or if the identity has already been used by another row in the current report, leave the row for manual identity review. If no prior row shares either key value, create a new identity. Never guess across a partial or ambiguous match. A carried identity retains its canonical identity and stage/hold/event/delivery history.
- A cleared invoice leaves the worklist, call list, preview, and future test delivery. Queued/needs-review attempts are suppressed with reason `SOURCE_CLEARED`; accepted attempts and history remain unchanged. Delivery claim/retry must check cleared state atomically before claiming. An already in-flight provider request cannot be recalled; approval must surface that condition rather than claim that it was suppressed.
- Billing-linked identities are **not** cleared by a PDF; the Billing ledger remains the source of truth for them.
- **Out-of-order safety:** approving a report with an as-of date earlier than the newest approved report clears nothing and does not reopen anything.
- **Reappearance:** if the same canonical identity appears in a later approved report, it reopens with its stage history intact, and the reopen is audited. Completed stages are not reset or sent again.
- **Test-only delivery for report-only rows:** stages 1–4 may be claimed only from an approved, unblocked, uncleared PDF identity, and only when its TAP Hub client is explicitly synthetic, automation is enabled, and delivery mode is `test`. The message goes only to the configured test recipient. Non-synthetic Clients/Operations data is always refused with `SYNTHETIC_DATA_REQUIRED`; this does not authorize live customer email.
- **Approval preview:** the paired-approval reconciliation result adds `would_clear: { count, total_balance }` so the approver sees the effect before it happens. The UI shows this in the approval box.
- Receivables summary adds `cleared_since_previous_report: { count, total_balance, as_of }`.

The owner approved requiring an explicit "this is a complete report" confirmation whenever `would_clear.count > 0`. A filtered or partial QuickBooks export must not be approved as complete.

## Item 4 — Times late beyond the final escalation deadline

Definition: for each client, count distinct invoices with dated evidence that days past due **exceeded the current final enabled ladder stage's `days_past_due`** during the approved 12-month look-back window:

- Billing invoices: still open beyond the threshold on the firm date, or fully settled after the threshold date based on recorded payment/allocation effective dates. Current balance alone is not evidence that a previously paid invoice crossed the threshold. If the ledger cannot establish the settlement date, do not count it as a historical crossing.
- PDF-sourced invoices: any approved report snapshot (including the last snapshot before clearing) showing days past due beyond the final threshold.

Each invoice counts at most once per client and canonical identity. The value is computed at read time from the current rules, so changing the final threshold recalculates it retroactively; the UI must identify the threshold used and that the metric is recomputed under current rules. Approved report dates and firm-local payment/allocation dates determine whether evidence falls in the window. The look-back window is 12 months.

The existing `direct_escalation_threshold` setting remains in place: it still drives the high-balance worklist metric and the guarded internal stage-4 test-escalation path, even though the Phase 5 automatic preview no longer bypasses the configured ladder.

`GET /api/collections/receivables` returns per account:

- `late_beyond_final_count: number`
- `late_beyond_final: { stage: number, label: string, days_past_due: number, window_months: number | null }` — the rule used, so the UI can explain the number.

Frontend: a new column in Pipeline → Who's where, following the demo's late-payment marker (`N×`, amber from 3, red from 5, with the rule shown on hover, e.g. "past Formal notice (28 days), last 12 months"). Colour is never the only signal; the number is always shown.

## Item 5 — Email log (counts and dates, not content)

The client wants, per client and invoice, how many Friendly, Professional, Firm, etc. emails were sent and when. Phase 3 already stores the needed facts per attempt (client, invoice/source identity, stage, status, timestamps). **No email content is stored or exposed.**

Note: attempts are unique per `(canonical_collection_identity, stage)`, so per invoice each stage is sent at most once; counts are meaningful per client (summed over invoices) and as the number of stages reached per invoice.

Requested backend additions:

- `GET /api/collections/deliveries` accepts `client_id` (UUID) in addition to the existing filters.
- New `GET /api/collections/deliveries/summary?client_id=&limit=&offset=` requires `client_id`, paginates the per-invoice list (limit 1–200, default 50; offset 0–100,000), and returns:

```json
{
  "client_id": "uuid",
  "delivery_mode": "disabled|test",
  "stages": [{ "stage": 1, "label": "Friendly", "accepted_count": 3, "last_accepted_at": "ISO" }],
  "invoices": [{
    "row_key": "collection:…", "invoice_id": "uuid|null", "source_invoice_id": "uuid|null",
    "invoice_number": "string", "source": "billing|pdf_import",
    "accepted": [{ "stage": 1, "label": "Friendly", "accepted_at": "ISO", "mode": "disabled|test" }],
    "not_accepted": [{ "stage": 2, "status": "queued|sending|suppressed|failed|needs_review", "reason_code": "string|null" }],
    "formal_notice": { "recorded_count": 0, "last_recorded_at": "ISO|null" }
  }],
  "pagination": { "limit": 50, "offset": 0, "total_invoices": 0 }
}
```

- `accepted` means the provider accepted the request, not that it reached a mailbox. In test mode, the UI must clearly label acceptance as test-recipient delivery and must not imply the customer received it. Queued, sending, failed, suppressed, and needs-review attempts are reported separately and never counted as accepted. Stage 4 is internal and never shown as an email. Stage 5 formal notices are represented only by their `formal_notice_sent` event, not by a test-email attempt. Stage labels come from current rules.
- Response includes only status, reason code, and timestamps—never email content, recipient address, or provider identifiers. Access: Owner/Admin and staff assigned the Collections module; Billing-only and unassigned staff are forbidden.
- Errors: missing/malformed `client_id` (`INVALID_CLIENT_ID`, 422), invalid paging (`INVALID_LIMIT` / `INVALID_OFFSET`, 422), unauthenticated (`UNAUTHENTICATED`, 401), forbidden (`FORBIDDEN`, 403), and read failure (`DELIVERY_SUMMARY_FAILED`, 500); bodies `{ error, code }`; `no-store`.

Frontend: a new **Email log** tab in Collections. A client picker/list, then per invoice a row of stage chips (`Friendly · 3 Nov 2026`, `Professional · 10 Nov 2026`, …) and a per-client total per stage. Unsent attempts show their status and readable reason. While delivery is disabled the tab shows an empty state explaining that no reminders have been sent.

## Item 6 — Full dates with year (frontend only)

The Who's where invoice table shows "Issued" as day and month only. All Pipeline dates (issued, due, last touch) show day, month, and year in the firm timezone. No backend change.

## Owner decisions required

| # | Decision | Engineer A proposal |
| --- | --- | --- |
| D1 | Replace the Phase 2 catch-up policy with "first touch is always Friendly" for all invoices (Billing and PDF)? | **Owner approved** — first touch is Friendly regardless of age; no completed stage is reset. |
| D2 | Default minimum gaps between stages | **Owner approved** — 7 days for 1→2, 2→3, and 3→4; stage 5 unchanged and approval-gated. |
| D3 | Clearing on approval: automatic, or with an explicit "complete report" confirmation when anything would clear? | **Owner approved** — require explicit confirmation whenever `would_clear.count > 0`. |
| D4 | Late-history window | **Owner approved** — rolling 12 months, computed from dated source evidence under current rules. |
| D5 | Email log visibility | **Owner approved** — Owner/Admin and Collections-module staff; counts/statuses/dates only. |

## Persistence and atomicity

- New rule column `collection_ladder_rules.min_days_since_previous` (forward migration; 7 for stages 2–4, 0 for stages 1 and 5), audited through the existing rules PATCH.
- Clearing state lives on the PDF identity (`cleared_as_of`, `cleared_by_batch_id`, `reopened_at`, `reopened_by_batch_id`) and is written in the paired-approval transaction. Confirmation, clearing, attempt suppression, audit, and both report approvals are atomic; any failure rolls back the approval. Delivery claim and retry functions reject cleared identities.
- Add indexes for approved PDF snapshot lookup by canonical identity/as-of date and note summary / delivery summary access paths. Keep functions in the private `tap_hub_project` schema, with execute grants restricted to `service_role`; route handlers enforce user/module access.
- Late history and email-log summaries are read-only computations; no denormalized counters unless performance requires them, in which case they must be recomputable from source rows.
- RLS stays enabled with service-role-only access; app routes enforce role/module checks independently.

## Fields the consumer must not recompute

`next_stage`, `next_stage_eligible_on`, `completed_stage`, cleared state and `would_clear`, `late_beyond_final_count`, `note_count`/`last_note_at`, and email-log `accepted_count`. The UI only formats these values.

## Shared interaction and error behavior

Same as Phase 2–4: `{ error, code }` bodies, stable codes, decimal-string money, firm-timezone (`America/Chicago`) date-only values that never shift in the browser, loading/empty/error states, keyboard access, and no customer names or contact details in logs or telemetry.

## Fixtures, tests, and environments

- Local synthetic harness (`tools/collections-local`) only, then the Sandbox Preview after owner authorization. No real A/R reports in fixtures, Git, or screenshots.
- Backend tests: first-touch and gap rules at threshold boundaries (Friendly-only first proposal for invoices at 1, 30, 90 days past due; no same-run double proposal); clearing (absent, incomplete-report refusal, out-of-order, Billing-linked untouched, reappearance, queued suppression, in-flight attempt handling, rollback on failure, `would_clear` accuracy); late-history counts when the final threshold changes, including paid-before/after-threshold cases and unprovable settlement dates; delivery-summary counts excluding non-accepted statuses, marking test-mode acceptance, page boundaries, and access for Owner/Admin, Collections-only, Billing-only, and unassigned users.
- Frontend tests: ladder placement from `completed_stage`/`next_stage`; notes indicator and add/list; `would_clear` shown in the approval box; late column colours and text; email log grouping and empty state; dates with year.
- Integrated acceptance by Engineer A on synthetic data with delivery disabled; Preview results record URL, deployed commit, sandbox identity, commands, results, and limitations.

## Release boundary

Apply migrations to the shared Sandbox only after local synthetic review and owner authorization. Production remains untouched. No scheduler, provider-backed send, or real-client delivery is enabled by this phase.

## Review

- Engineer A (consumer): author, 2026-11-10.
- Engineer B (producer): review pending.
- Owner: D1–D5 approved 2026-11-10.
