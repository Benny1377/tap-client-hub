# Collections Phase 5: Client Feedback (Ladder Start, Call Notes, Cleared Invoices, Late History, Email Log)

State: **Draft — proposed by Engineer A from client feedback received 2026-11-10; awaiting owner decisions (below) and Engineer B review.** This contract does not authorize a hosted migration, production change, real-report import, or live delivery.

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

**Change request against an owner-approved rule.** Phase 2 records the owner-approved *catch-up* policy: "if earlier reminders were missed, the next proposed reminder is the highest enabled automatic stage currently due." The client now asks for the opposite on first contact. This item supersedes catch-up only after the owner confirms it (decision D1).

Proposed behavior:

- An invoice (canonical collection identity) with no completed stage has `next_stage = 1` (Friendly) whenever it is at least the Friendly threshold past due, regardless of how far past due it is. This applies identically to Billing-sourced and PDF-sourced invoices; the SQL read model and `lib/collections-import-worklist.ts` must agree.
- Each later automatic stage (2, 3) is proposed only when **both** its `days_past_due` threshold is met **and** a minimum gap has passed since the previous completed stage. The gap is a new, Owner/Admin-editable per-stage rule field `min_days_since_previous` (integer ≥ 0; proposed defaults in D2). It is returned by `GET /api/collections/rules` and accepted by `PATCH /api/collections/rules` with the existing audit transaction.
- Stage 4 (Owner escalation) and stage 5 (formal notice) remain human gates. They become eligible only after stage 3 is completed and the stage 4/5 gap has passed, in addition to their thresholds. Their approval rules are unchanged.
- An invoice that already has completed stages keeps its history; nothing is reopened or re-sent.
- `current_stage` must stop being threshold-only for display. Every worklist invoice returns:
  - `completed_stage` (existing), `next_stage` (existing, new semantics above), and
  - `next_stage_eligible_on: "YYYY-MM-DD" | null` — the firm-date on which `next_stage` becomes eligible (threshold and gap both met); `null` when nothing further is proposed.
  - `current_stage` is retained for compatibility but is documented as "threshold reached", not "ladder position". The UI must not derive ladder position from thresholds.
- Preview (`POST /api/collections/automation/preview`) and the test runner apply the same rule. A preview can never propose two stages for one invoice on the same run.

Frontend: Pipeline ladder bands, status chips, AR Insights tiers and the call list place each account by its oldest invoice's `completed_stage`/`next_stage`, not by days past due. Accounts that are past a threshold but not yet touched show as "Friendly due" rather than at the later rung.

## Item 2 — Notes on the top-15 call list

The existing events API already supports notes: `POST /api/collections/events` with `event_type: "note"` (account- or invoice-scoped, audited) and `GET /api/collections/events?client_id=`. No new write path is needed.

Requested backend additions (additive, read-only):

- `GET /api/collections/events` accepts `event_type` (one of the existing types) and `limit` (1–200, default 50) / `offset` (0–100,000) so the UI can page a client's notes without loading 500 mixed events. Response adds `pagination: { limit, offset, total }`.
- `GET /api/collections/receivables` returns per account `note_count: number` and `last_note_at: string | null` (ISO timestamp), so the call list can show the indicator without one request per row.

Frontend: each of the top-15 call rows gets a notes button showing an indicator (count) when `note_count > 0`; opening it lists that client's notes (author, firm-local date/time, text) and offers an add-note form. Notes are free text, 1–2,000 characters, trimmed; the server is authoritative for length. Access follows the existing events rules (Owner/Admin and staff with Collections or Billing module access). Notes are internal and never included in client-facing email.

## Item 3 — Absent from a newer report means cleared

Current behavior (defect): the worklist takes each imported invoice's latest approved row across all approved reports, so an invoice that disappears from a newer report keeps its old row and stays on the call list.

Proposed behavior:

- When a detail/summary pair with as-of date `D` is approved, every **PDF-sourced** identity whose latest approved row has an as-of date earlier than `D` and which is absent from the newly approved detail report is marked **cleared**: `cleared_as_of = D`, `cleared_by_batch_id`, recorded in the same approval transaction with an audit entry per identity (counts and IDs only, no customer names in the audit detail).
- A cleared invoice leaves the worklist, the call list, preview, and test delivery. Queued/unsent attempts for it are suppressed with reason `SOURCE_CLEARED`; an already provider-accepted message is not recalled.
- Billing-linked identities are **not** cleared by a PDF; the Billing ledger remains the source of truth for them.
- **Out-of-order safety:** approving a report with an as-of date earlier than the newest approved report clears nothing and does not reopen anything.
- **Reappearance:** if a cleared identity appears in a later approved report, it reopens with its stage history intact, and the reopen is audited.
- **Approval preview:** the paired-approval reconciliation result adds `would_clear: { count, total_balance }` so the approver sees the effect before it happens. The UI shows this in the approval box.
- Receivables summary adds `cleared_since_previous_report: { count, total_balance, as_of }`.

Risk requiring a decision (D3): a filtered or partial QuickBooks export would clear every customer it omits. Options: (a) clear automatically on approval, relying on the `would_clear` preview; (b) require the approver to tick an explicit "this is a complete report" confirmation when `would_clear.count > 0`. Engineer A recommends (b).

## Item 4 — Times late beyond the final escalation deadline

Definition: for each client, count the invoices whose days past due **exceeded the final enabled ladder stage's `days_past_due`** at any point, observed through either source:

- Billing invoices: paid/cleared after, or still open beyond, the final threshold (firm-date arithmetic, the shared balance function).
- PDF-sourced invoices: any approved report snapshot (including the last snapshot before clearing) showing days past due beyond the final threshold.

Each invoice counts at most once. The value is computed at read time from the current rules, so changing the final threshold recalculates it (dynamic, per the client's request). The look-back window is a decision (D4); the demo uses the last 12 months.

`GET /api/collections/receivables` returns per account:

- `late_beyond_final_count: number`
- `late_beyond_final: { stage: number, label: string, days_past_due: number, window_months: number | null }` — the rule used, so the UI can explain the number.

Frontend: a new column in Pipeline → Who's where, following the demo's late-payment marker (`N×`, amber from 3, red from 5, with the rule shown on hover, e.g. "past Formal notice (28 days), last 12 months"). Colour is never the only signal; the number is always shown.

## Item 5 — Email log (counts and dates, not content)

The client wants, per client and invoice, how many Friendly, Professional, Firm, etc. emails were sent and when. Phase 3 already stores the needed facts per attempt (client, invoice/source identity, stage, status, timestamps). **No email content is stored or exposed.**

Note: attempts are unique per `(canonical_collection_identity, stage)`, so per invoice each stage is sent at most once; counts are meaningful per client (summed over invoices) and as the number of stages reached per invoice.

Requested backend additions:

- `GET /api/collections/deliveries` accepts `client_id` (UUID) in addition to the existing filters.
- New `GET /api/collections/deliveries/summary?client_id=` returning:

```json
{
  "client_id": "uuid",
  "stages": [{ "stage": 1, "label": "Friendly", "sent_count": 3, "last_sent_at": "ISO" }],
  "invoices": [{
    "row_key": "collection:…", "invoice_id": "uuid|null", "source_invoice_id": "uuid|null",
    "invoice_number": "string", "source": "billing|pdf_import",
    "sent": [{ "stage": 1, "label": "Friendly", "sent_at": "ISO" }],
    "not_sent": [{ "stage": 2, "status": "suppressed|failed|needs_review|queued", "reason_code": "string|null" }]
  }],
  "formal_notices_recorded": 0
}
```

- "Sent" means status `accepted` (provider accepted). Queued, failed, suppressed, and needs-review attempts are reported separately and never counted as sent. Stage 5 recorded via `formal_notice_sent` events is counted in `formal_notices_recorded`; stage 4 is internal and is never shown as an email. Stage labels come from the current rules.
- Access: same as `GET /api/collections/deliveries` today (Owner/Admin). Whether Collections staff may also see the log is decision D5.
- Errors: `INVALID_CLIENT_ID` (422), `UNAUTHENTICATED` (401), `FORBIDDEN` (403), `DELIVERY_SUMMARY_FAILED` (500); bodies `{ error, code }`; `no-store`.

Frontend: a new **Email log** tab in Collections. A client picker/list, then per invoice a row of stage chips (`Friendly · 3 Nov 2026`, `Professional · 10 Nov 2026`, …) and a per-client total per stage. Unsent attempts show their status and readable reason. While delivery is disabled the tab shows an empty state explaining that no reminders have been sent.

## Item 6 — Full dates with year (frontend only)

The Who's where invoice table shows "Issued" as day and month only. All Pipeline dates (issued, due, last touch) show day, month, and year in the firm timezone. No backend change.

## Owner decisions required

| # | Decision | Engineer A proposal |
| --- | --- | --- |
| D1 | Replace the Phase 2 catch-up policy with "first touch is always Friendly" for all invoices (Billing and PDF)? | Yes |
| D2 | Default minimum gaps between stages | 7 days between stages 1→2 and 2→3; 7 days before stage 4; stage 5 unchanged (approval-gated) |
| D3 | Clearing on approval: automatic, or with an explicit "complete report" confirmation when anything would clear? | Explicit confirmation |
| D4 | Late-history window | Last 12 months (matches the demo) |
| D5 | Email log visibility | Owner/Admin plus staff with Collections module access (counts and dates only) |

## Persistence and atomicity

- New rule column `collection_ladder_rules.min_days_since_previous` (forward migration, default per D2, audited through the existing rules PATCH).
- Clearing state lives on the PDF identity (e.g. `collection_source_invoice_identities.cleared_as_of`, `cleared_by_batch_id`, `reopened_at`) and is written in the paired-approval transaction. Any failure rolls back the approval.
- Late history and email-log summaries are read-only computations; no denormalized counters unless performance requires them, in which case they must be recomputable from source rows.
- RLS stays enabled with service-role-only access; app routes enforce role/module checks independently.

## Fields the consumer must not recompute

`next_stage`, `next_stage_eligible_on`, `completed_stage`, cleared state and `would_clear`, `late_beyond_final_count`, `note_count`/`last_note_at`, and email-log `sent_count`. The UI only formats these values.

## Shared interaction and error behavior

Same as Phase 2–4: `{ error, code }` bodies, stable codes, decimal-string money, firm-timezone (`America/Chicago`) date-only values that never shift in the browser, loading/empty/error states, keyboard access, and no customer names or contact details in logs or telemetry.

## Fixtures, tests, and environments

- Local synthetic harness (`tools/collections-local`) only, then the Sandbox Preview after owner authorization. No real A/R reports in fixtures, Git, or screenshots.
- Backend tests: first-touch and gap rules at threshold boundaries (Friendly-only first proposal for invoices at 1, 30, 90 days past due; no same-run double proposal); clearing (absent, out-of-order, Billing-linked untouched, reappearance, rollback on failure, `would_clear` accuracy); late-history counts when the final threshold changes; delivery-summary counts excluding non-accepted statuses; access for Owner/Admin, Collections-only, Billing-only, and unassigned users.
- Frontend tests: ladder placement from `completed_stage`/`next_stage`; notes indicator and add/list; `would_clear` shown in the approval box; late column colours and text; email log grouping and empty state; dates with year.
- Integrated acceptance by Engineer A on synthetic data with delivery disabled; Preview results record URL, deployed commit, sandbox identity, commands, results, and limitations.

## Release boundary

Apply migrations to the shared Sandbox only after local synthetic review and owner authorization. Production remains untouched. No scheduler, provider-backed send, or real-client delivery is enabled by this phase.

## Review

- Engineer A (consumer): author, 2026-11-10.
- Engineer B (producer): pending.
- Owner: pending decisions D1–D5.
