# Collections Phase 4: QuickBooks A/R PDF Intake

Status: **Base scope frozen for implementation by owner and Engineer A on 2026-10-18.** The owner-approved automation amendment dated 2026-11-04 is implemented on `codex/collections-ar-auto-matching` and awaits engineering review before integration sign-off. This contract does not authorize a hosted migration, production import, or live delivery.

## Source and row identity

The initial supported exports are the A/R Aging QuickZoom detail report and the A/R Aging Summary report. The detail layout carries transaction type/date/number, PO number, customer, terms, due date, aging, and open balance; it supplies invoice-level rows. The summary layout is aggregate cross-check evidence only. Unknown layouts and uncertain fields remain in human review. Supplied real reports are sensitive and must never be copied into Git, fixtures, screenshots, external AI services, or shared test environments.

- QuickBooks A/R PDFs may be the only receivables source at launch. An approved detail report can feed Collections, but PDF data never creates or mutates Billing invoices, payments, credits, allocations, or client records.
- Every imported customer must be linked to an existing TAP Hub client before action. Client creation, if needed, uses the normal audited Add Client flow. See the owner-approved automation amendment below: only unique exact normalized name matches may be staged automatically; no fuzzy match or automatic client creation is allowed.
- PDF-only invoices have a generated, stable `source_invoice_id`; invoice numbers are not global keys. An imported identity persists across reviewed report revisions, with each revision and source page/row retained.
- Worklist, preview, and delivery-history rows carry `invoice_id: string | null`, `source_invoice_id: string | null`, `source`, `row_key`, `canonical_collection_identity`, `source_batch_id`, `source_as_of`, and `discrepancy_status`.
- Exactly one logical invoice appears in the worklist/preview under the selected source. A PDF-selected Billing match reports both invoice IDs. Source changes share stage completion, attempts, holds, approvals, and `last_delivery` through one canonical identity.
- An unlinked PDF invoice starts as `pdf_import:<source_invoice_id>`; a Billing invoice starts as `billing:<invoice_id>`. Linking before any attempt/event/hold adopts the Billing identity. Once activity exists, identity stays fixed and linking adds the other alias. If both identities already have separate histories, block the link/actions for separately reviewed reconciliation. Linking cannot reopen a stage or bypass holds/approval.

## Review, reconciliation, and safety

- Treat every PDF as an untrusted dated snapshot. Only reviewed QuickBooks A/R Aging Summary and A/R Aging QuickZoom detail layouts are recognized; unknown layouts or uncertain fields stay in review. Detail rows drive invoice-level intake; summary reports cross-check detail totals for the same as-of date.
- Summary/detail cross-check API: `POST /api/collections/imports/{summary_batch_id}/cross-check` accepts `{ detail_batch_id, summary_total, note }`, requires the same as-of date and reviewed detail rows, and returns both totals, difference, and `matched | mismatch`. A same-date summary report must match the selected detail batch before that detail batch can be approved. The summary total is reviewer-confirmed from the source PDF; the system does not guess financial values from layout text.
- Preserve the original PDF in private Supabase Storage and retain it at least one complete financial year. Audit upload, parse, review, correction, approval, view/download, source selection, calculation, and supersession. Do not configure auto-deletion until fiscal-year boundaries and any longer retention are confirmed.
- If parsing cannot determine `report_type` or `source_as_of`, a reviewer may correct the header before invoice-level review begins via `PATCH /api/collections/imports/{batch_id}/metadata` with `{ report_type: "aging_summary" | "aging_detail", source_as_of: "YYYY-MM-DD", confirmed: true }`. Both values are explicitly confirmed from the PDF; the original and corrected values are audited atomically. Only batches in `needs_review` with no reviewed invoice rows can be corrected. The correction does not approve the batch, and the correcting reviewer cannot approve that batch.
- Full-file duplicates are idempotent. Exact repeated rows are not double-counted. For partial/corrected reports, preserve provenance and additional non-conflicting information; conflicting values require an explicit decision. Never silently overwrite a prior accepted value.
- An invoice with a Billing match is compared against the Billing open balance. Show the arithmetic. Any difference blocks collection actions until a user with the configurable `approve` permission explicitly selects the source/value and records a reconciliation note. Owner/Admin have this permission by default and may delegate it through the permission policy. A Billing payment, allocation, credit, reversal, or other balance change on or after the PDF as-of calendar date (firm timezone) automatically re-blocks the matched row and records old/new math. The PDF contains a date, not a generation timestamp, so same-day changes are conservatively treated as potentially newer than the snapshot and require review.
- Delivery preview and test delivery both suppress a linked Billing invoice while the latest approved/blocked snapshot for any linked PDF identity remains discrepancy-blocked. The test runner checks before creating/reopening an attempt, and the database claim repeats the check as a second guard; a source-state read failure fails closed.
- Owner/Admin alone may edit the dynamic role/action permission policy. Configured permissions cannot override the rule that a batch uploader or corrector cannot approve that same batch.
- Preserve complete report fields and calculations for future billing metrics. This phase does not write back into Billing. No real client reports or values are permitted in synthetic tests or shared test environments. Phase 3 provider delivery remains separately disabled/test-only.

## Owner decision record

1. Approved A/R PDFs as input to Collections. They remain a separate source and do not write into Billing.
2. Surface source discrepancies to the user, block the affected invoice, and allow collection actions only after an explicit, audited resolution.
3. Use the approved report layouts and human review; do not infer values when extraction is uncertain. This is amended only by the conservative automation rules below.
4. Preserve useful additional fields from partial duplicates, but require explicit review for conflicting values.
5. Keep import permissions dynamic and client-configurable; Owner/Admin alone edit the policy. The uploader/corrector separation-of-duties rule cannot be overridden.
6. Store original PDFs privately, audit access, and retain them for at least one financial year; no automatic deletion until the fiscal-year boundary and any longer retention are settled.
7. Show the math behind source comparisons and aging differences.
8. Preserve report data and calculations for future Billing metrics; this phase does not write to the Billing ledger.
9. Explicitly link each imported customer to a TAP Hub client before the invoice becomes actionable. No fuzzy matching or client creation. This is amended only by the conservative exact-match staging below.
10. For discrepancy resolution, require the configurable `approve` permission (Owner/Admin by default); Owner/Admin may delegate through the permission policy. This is stricter than report review because it selects the balance used for collection actions.
11. The PDF provides an as-of date, not a generation timestamp. Conservatively treat Billing changes on that date or later, in the firm's timezone, as stale and require review.

The final two items document implementation clarifications added during backend review. The reviewer-confirmed metadata correction endpoint is an implementation detail added to make the existing human-review rule actionable; Engineer A should confirm its UI wiring before Phase 4 integration sign-off.

## Owner-approved automation amendment — 2026-11-04

The owner approved safe automatic reading and mapping so staff do not have to classify every clearly recognizable line by hand. The parser may automatically classify only explicit QuickBooks detail column headers and explicit report-total rows. Rows from a recognized summary report may be marked as evidence-only because the summary supplies aggregate cross-check values, never invoice candidates. It may extract an invoice candidate only from a recognized A/R Aging detail layout when the transaction type, invoice number, transaction date, customer, due date, aging, and open balance all map unambiguously to their report columns. Column positions from the PDF are retained to avoid shifting fields when optional cells are blank.

An authorized reviewer may apply high-confidence candidates in bounded batches only when the normalized full customer name resolves to exactly one active TAP Hub client. This creates staged A/R review entries and an audit record; it does not approve the report, link a Billing invoice, create a client, or place anything on the Collections call list. A different Owner/Admin must still approve the report. Missing fields, unsupported transaction types, ambiguous/duplicate client names, unknown layouts, and all other low-confidence rows remain for manual review. Summary reports are never used for invoice candidates. The matcher performs no fuzzy matching and sends no financial data to external AI services. The owner-accepted approval gate is the separate report approval after the high-confidence results and unresolved rows have been reviewed.

## Phase 3 forward migration included with the source-aware change

`collection_delivery_attempts.invoice_id` becomes nullable and gains `source`, `source_invoice_id`, and `canonical_collection_identity`; uniqueness is `(canonical_collection_identity, stage)`. Holds and events carry the source identity and canonical key, with exactly one direct target. Existing records remain Billing-sourced. Hold, event, approval, and notice-record APIs accept `{ source: "billing", invoice_id }` or `{ source: "pdf_import", source_invoice_id }`. Delivery history supports the `source_invoice_id` filter. Discrepancy blocks use `SOURCE_DISCREPANCY_BLOCKED`.

## Release boundary

Apply migrations only after local synthetic reset and review. The auto-match route requires forward migration `20261104160000_collections_guard_auto_match_review_state.sql`; this code branch has not applied it to the sandbox. No hosted database has been changed by this implementation. No real AR PDFs are committed or used for tests. Do not enable an automatic scheduler or provider-backed send as part of Phase 4.
