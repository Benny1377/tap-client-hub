# Collections Phase 4: QuickBooks A/R PDF Intake (Preparation Draft)

State: **Owner decisions recorded on 2026-10-18: PDF-only invoices may enter Collections using an immutable import identity without a Billing invoice match; every imported customer must be explicitly linked to a TAP Hub client before becoming actionable. Revised backend/API contract is in progress and still needs Engineer A/B review before freeze.**

Owner: Project owner (Tejas Wilavanya)
Proposed producer: Engineer B (upload, extraction, validation, persistence, access policy)
Proposed consumer: Engineer A (upload/review/reconciliation UI)

## Objective

Prepare an auditable intake path for QuickBooks Accounts Receivable PDF reports. The owner selected PDFs as the intended upload format and confirmed that an approved PDF import may provide input to Collections actions. Imported records remain a separate, traceable source; intake and approval must not silently write to or overwrite the Billing ledger. Source selection and conflict handling follow the owner decisions below.

Uploading or parsing a PDF must not create or edit Billing invoices, payments, allocations, or client records. Once a batch is reviewed and approved, eligible imported receivables may feed Collections according to the final source-selection contract. Collection events and their source snapshot must remain auditable.

## Sample layout observations

The supplied samples include two report shapes:

- An A/R Aging QuickZoom detail report (15 pages) with columns for transaction type, date, transaction number, P.O. number, name, terms, due date, aging, and open balance.
- An A/R Aging Summary report (3 pages) that presents aggregated aging rather than the same transaction-level detail.

Both are Intuit PDFs produced via Microsoft Print to PDF. The sample files contain business/customer financial information and must stay out of source control, fixtures, screenshots, external AI services, and shared non-production environments. Use newly generated synthetic PDFs for development and regression tests.

## Proposed capability boundary

In scope for a first intake slice, subject to contract approval:

- Upload and retain a report as an immutable source artifact with uploader, upload time, file hash, report type, and report as-of date where confidently extracted.
- Store source PDFs in a private Supabase Storage bucket (subject to Engineering B's storage/RLS design review), and audit upload, view, and download access. Retain them for at least one complete financial year; do not configure automatic deletion until the client's fiscal-year boundary and any longer retention requirement are confirmed.
- Recognize only the reviewed A/R Aging Summary and A/R Aging QuickZoom detail layouts; reject or route unknown layouts to manual review instead of guessing.
- Extract into a reviewable staging batch. Preserve source page/row references, original parsed values, all report fields, and extensible raw extraction data so a reviewer can trace discrepancies and future metrics back to the PDF. Do not discard fields only because the first UI does not display them.
- Validate required fields, dates, currency/amount formatting, duplicate rows, report totals, and consistency between a detail report and its summary when both are uploaded for the same as-of date.
- Match report customers/invoices to TAP Hub records only with approved stable identifiers (initial candidate: client code plus invoice number); never auto-match by customer name alone. Ambiguous or missing matches require human review.
- Provide a side-by-side comparison against TAP Hub Billing, with explicit differences and a reviewer decision for each unresolved conflict.
- After batch approval, expose eligible, source-attributed receivables to the Collections worklist/preview and existing rule evaluation. This does not authorize live email delivery; Phase 3 delivery remains disabled and test-only until separately released.
- Every worklist invoice, preview item, and delivery-history item carries `invoice_id: string | null`, `source_invoice_id: string | null`, `source: "billing" | "pdf_import"`, `row_key: string`, `canonical_collection_identity: string`, `source_batch_id: string | null`, `source_as_of: string | null` (ISO date), and `discrepancy_status: "none" | "blocked" | "resolved"`. Billing-sourced rows use the Billing `invoice_id`, null `source_invoice_id`; PDF-sourced rows use `source_invoice_id` and also carry `invoice_id` if linked to Billing. `row_key` is `collection:<canonical_collection_identity>`. A linked Billing/PDF invoice has canonical identity `billing:<invoice_id>` regardless of which balance source is selected; a PDF-only invoice uses `pdf_import:<source_invoice_id>`. `source` and source IDs describe the currently selected value and its provenance. For PDF-sourced rows, `source_batch_id` and `source_as_of` identify the selected approved batch and report date. `blocked` means no collection action or delivery attempt may proceed until a user resolves the issue; `resolved` means an authorized user explicitly selected a source/value; `none` means no unresolved discrepancy was detected.
- A logical invoice appears exactly once in the worklist and preview, under its currently selected source. Changing a linked invoice from Billing value to PDF value does not create another row or a new stage history. Stage completion, attempts, and `last_delivery` share the canonical collection identity across both aliases. A PDF-selected balance always reports `source=pdf_import`; if linked, both `invoice_id` and `source_invoice_id` are populated. Its attempt is deduplicated by the linked invoice's canonical `billing:<invoice_id>` identity, not by the current source ID.
- Delivery history supports both `invoice_id` and `source_invoice_id` query filters. A discrepancy-blocked attempt uses reason code `SOURCE_DISCREPANCY_BLOCKED` with UI text: “Imported balance differs from Billing; review required.”
- The Phase 3 delivery model/API requires a reviewed forward-only migration before Phase 4 integration: `collection_delivery_attempts.invoice_id` becomes nullable and gains `source` plus nullable `source_invoice_id`; uniqueness and idempotency use `canonical_collection_identity` plus stage. The same forward migration adds source-aware invoice identity to `collection_holds` and `collection_events`: nullable `invoice_id`, `source`, nullable `source_invoice_id`, with exactly one action target (`billing` + `invoice_id`, or `pdf_import` + `source_invoice_id`). Existing rows migrate as Billing-sourced, and their stage/hold/event history is preserved. Phase 3 shared types and UI changes ship with the migration.
- Hold, event, approval, and “Record notice sent” APIs accept the invoice target as either `{ source: "billing", invoice_id }` or `{ source: "pdf_import", source_invoice_id }`, with exactly one identity. Approval and notice-record calls retain their event/approval IDs and the server verifies that they resolve to the same canonical collection identity. These source-aware identities support PDF-only invoices for holds, reminders, formal-notice approval/sent history, and stage progression. For linked invoices, the service resolves both aliases to the same canonical identity so source changes cannot bypass a hold, approval, completed stage, or prior delivery.
- Detect full-file and row-level duplicates. Preserve provenance for repeated rows; do not double-count exact duplicates. On partial duplicates, record and use additional non-conflicting rows/fields after review; conflicting values for the same identity/field require an explicit resolution rather than silent overwrite.
- Keep every upload, parse result, reviewer correction, approval, access, source selection, calculation, and later supersession auditable.
- Make upload/review/approval permissions configurable by the client rather than hard-coded. Owner/Admin only may edit the permission policy. Enforce every configured permission server-side and for Storage access, audit permission changes, and prevent a user's configuration from granting themself unauthorized access. Irrespective of configurable roles, an actor who uploaded or corrected a batch cannot approve that batch.

Explicitly out of scope for the first intake slice unless a separate contract is approved:

- Silently overwriting Billing or automatically reconciling imported values into the Billing ledger.
- Automatically creating or mutating Billing invoices, payments, allocations, credits, write-offs, holds, or manual collection events from extracted rows.
- Automated email delivery based on imported balances.
- QuickBooks API/OAuth/webhook integration, direct QuickBooks account access, or unattended polling.
- Importing the supplied real reports into local or shared test databases.

## Source and conflict behavior approved by the owner

Treat an uploaded PDF as an **untrusted, dated snapshot** until its batch has been reviewed and approved. Owner approved using PDFs as input to Collections actions. When an imported value conflicts with Billing, surface the discrepancy to an authorized user and block that invoice from collection actions until the user resolves which value/source applies. Once resolved, the selected source/value may feed the collection action; never silently choose a winner. Do not write the selected value back to Billing.

This is the approved fail-closed source-resolution rule, not an open owner decision. The behavior for a PDF invoice with no matching Billing invoice is tracked separately below.

## Stale PDF snapshot rule

An approved batch is still a dated snapshot, not a live Billing balance. If Billing records a payment allocation, credit, reversal, or other balance-changing ledger event for a matched invoice after the end of `source_as_of` in the firm's timezone, automatically set that invoice's `discrepancy_status` to `blocked` and return it to **needs review**. Until an authorized reviewer reconciles the newer Billing activity with the imported snapshot and explicitly resolves the discrepancy, the invoice is excluded from collection actions and no new delivery attempt may be created. Show the before/after amounts and calculation that caused the block. Approval of the original batch does not override this later stale-snapshot block.

## PDF invoices absent from Billing — owner decision recorded; customer linkage open

An approved PDF invoice that has no matching Billing invoice may enter Collections. It remains a separate imported receivable and must never be materialized as a Billing invoice. The stable identity is a generated `source_invoice_id` assigned during staging and retained across corrected/superseding report versions once a reviewer has confirmed the row identity. Before that confirmation, the row remains in review and is ineligible for collection actions.

The delivery attempt and stage uniqueness key is `(canonical_collection_identity, stage)`. A linked Billing/PDF invoice always uses `billing:<invoice_id>` for deduplication, stage context, attempts, and `last_delivery`, even when `source=pdf_import` is selected. A PDF-only invoice uses `pdf_import:<source_invoice_id>`. `source_invoice_id` is immutable and independent of batch version; `source_batch_id` points to the currently approved snapshot. Worklist, preview, history, holds, collection events, and duplicate prevention resolve to the same canonical identity. Each logical invoice appears once under its selected source. Import-only invoice numbers are not globally unique and must not be used as a key by themselves. Exact file duplicates are idempotent; partial/corrected reports update the source invoice only through explicit review, preserve all source-row provenance, and never erase history.

The owner clarified on 2026-10-18 that QuickBooks may be the only source of invoice/receivables data at launch; therefore an invoice does not need a Billing match. The stable invoice identity and attempt keys above are approved contract direction.

Customer-linkage decision (owner approved 2026-10-18): every imported customer must be explicitly linked to an existing TAP Hub client before any collection action. A reviewer may select the existing client or create one through the normal Add client flow; either path is explicit and audited. Customer-name-only matching is prohibited, and upload/parsing never creates a client automatically. Until linked, the imported customer and its invoices remain in review and are not actionable. This avoids duplicating contacts, primary-contact email, holds, permissions, and delivery history in a separate import-only customer model.

## Owner decision record and remaining decisions

Owner decisions:

1. **PDF use:** An approved PDF batch may provide input to Collections actions. It remains a separate, source-attributed dataset and does not itself update Billing.
2. **Discrepancies:** Surface differences between the PDF and Billing to the user. Block the affected invoice from collection actions until an authorized user resolves the discrepancy; after resolution, the selected value/source may feed the action. Never choose silently.
3. **Matching:** Use approved stable identifiers (proposed client code plus invoice number). Ambiguous matches require human review; no name-only automatic matching.
4. **Summary/detail:** Use detail rows for invoice-level intake and the summary report as a cross-check when available. Pair by as-of date; disagreements must be shown and reviewed, not normalized away.
5. **Dates/aging:** Use the report's as-of date when clear and reviewer-confirm it when uncertain. Preserve reported aging and calculate a comparison using due date and the firm's Houston timezone; show the math and flag differences.
6. **Duplicates/corrections:** Detect full-file and partial/row duplicates. Preserve provenance, avoid double counting, and record/use additional non-conflicting information. Conflicting values need explicit review. Corrected reports are new, auditable versions that supersede rather than erase history.
7. **Permissions:** Keep role/action permissions dynamic and client-configurable. Initial default is Collections staff upload/review and Owner/Admin approval. Only Owner/Admin may edit the permission policy; every change is server-enforced and audited. No actor who uploaded or corrected a batch may approve that same batch, regardless of any configurable permission grant.
8. **Storage/audit:** Retain original PDFs for future audits in a proposed private Supabase Storage bucket and record access. Keep them for at least one complete financial year. Do not auto-delete until the client's fiscal-year boundary and any longer retention requirement are confirmed.
9. **Credits/negative/zero:** Represent these visibly and show the calculation math. Do not silently apply credits or create accounting entries.
10. **Billing/future metrics:** Preserve the full source fields, calculations, source identity, row/page provenance, and audit trail so the information can be tracked in Billing and metrics in a future phase. The first intake slice does not write to the Billing ledger; any such write path needs its own contract.
11. **Imported customer linkage (approved 2026-10-18):** An imported customer must be explicitly linked to a TAP Hub client before becoming actionable. A reviewer can select an existing client or create one through the normal Add client flow; actions are audited, with no name-only matching and no automatic client creation during import.

Remaining contract-review items:

- Engineering A/B review the source identity and import-only attempt flow, source-switch deduplication, PDF-only holds/events/stage progression, stale-snapshot re-blocking, source fields on the wire, uploader/corrector approval prohibition, storage/RLS/audit design, and duplicate merge semantics. The Phase 3 migration, shared types, delivery history filters, source-aware APIs, and UI row keys must ship together.
- Engineering A/B review of the revised contract remains required before freeze.
- The owner approved retention for at least one complete financial year. Confirm the exact fiscal-year boundary and any longer requirement before configuring automatic deletion; until then retain indefinitely rather than auto-delete early.

## Proposed validation gates

- Synthetic report fixtures cover both observed layouts, multiple pages, duplicate rows, missing identifiers, bad dates, negative/zero balances, and OCR/text-extraction failures.
- Tests prove full and partial duplicate handling preserves provenance and additional non-conflicting information without double-counting, and conflicts cannot silently overwrite accepted values.
- Validate summary totals against detail totals when reports are paired; report exact differences without silently normalizing them away.
- Re-uploading the same file is idempotent; a partial duplicate records additional data with provenance; a corrected file creates a traceable superseding batch rather than overwriting history.
- Ambiguous client/invoice matches, unknown layouts, and failed total checks remain blocked until reviewed.
- Configurable role rules, RLS/Storage access, access audit attribution, retention/deletion, and data export behavior are tested before any shared sandbox use.
- Integration tests prove that upload and approval do not mutate Billing unless a separately approved ledger-write path is later added.
- Phase 4 must not enable any Phase 3 provider delivery. Synthetic-only gates and the delivery-off default remain in force.

## Readiness and handoff

Phase 4 is not ready to freeze until Engineering A/B approves the revised contract. PDF-only invoices without a Billing match are allowed under the approved import-identity direction, but their customers must be explicitly linked to TAP Hub clients before they become actionable. The owner has approved at least one complete financial year of retention; do not configure deletion until the fiscal-year boundary and any longer requirement are confirmed. After approval, define APIs and private Storage lifecycle, then create synthetic fixtures. Keep the supplied real PDFs out of Git, fixtures, screenshots, external AI services, and shared non-production environments.
