# Collections Phase 4: QuickBooks A/R PDF Intake (Preparation Draft)

State: **Preparation draft; owner decisions recorded 2026-10-17. Engineering A/B review and final confirmation of fiscal-year/longer-retention policy remain before freeze.**

Owner: Project owner (Tejas Wilavanya)
Proposed producer: Engineer B (upload, extraction, validation, persistence, access policy)
Proposed consumer: Engineer A (upload/review/reconciliation UI)

## Objective

Prepare an auditable intake path for QuickBooks Accounts Receivable PDF reports. The owner selected PDFs as the intended upload format and confirmed that an approved PDF import may provide input to Collections actions. Imported records remain a separate, traceable source; intake and approval must not silently write to or overwrite the Billing ledger. The source-selection and conflict rules below still need to be frozen.

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
- Detect full-file and row-level duplicates. Preserve provenance for repeated rows; do not double-count exact duplicates. On partial duplicates, record and use additional non-conflicting rows/fields after review; conflicting values for the same identity/field require an explicit resolution rather than silent overwrite.
- Keep every upload, parse result, reviewer correction, approval, access, source selection, calculation, and later supersession auditable.
- Make upload/review/approval permissions configurable by the client rather than hard-coded. Enforce every configured permission server-side and for Storage access, audit permission changes, and prevent a user's configuration from granting themself unauthorized access.

Explicitly out of scope for the first intake slice unless a separate contract is approved:

- Silently overwriting Billing or automatically reconciling imported values into the Billing ledger.
- Automatically creating or mutating Billing invoices, payments, allocations, credits, write-offs, holds, or manual collection events from extracted rows.
- Automated email delivery based on imported balances.
- QuickBooks API/OAuth/webhook integration, direct QuickBooks account access, or unattended polling.
- Importing the supplied real reports into local or shared test databases.

## Interim safe behavior while source/conflict decisions remain open

Treat an uploaded PDF as an **untrusted, dated snapshot** until its batch has been reviewed and approved. Owner approved using PDFs as input to Collections actions. When an imported value conflicts with Billing, surface the discrepancy to an authorized user and block that invoice from collection actions until the user resolves which value/source applies. Once resolved, the selected source/value may feed the collection action; never silently choose a winner. Do not write the selected value back to Billing.

This is a proposed fail-closed default pending the remaining owner decision; it is not yet the final source-resolution rule.

## Owner decision record and remaining decisions

Decisions recorded from the owner on 2026-10-17:

1. **PDF use:** An approved PDF batch may provide input to Collections actions. It remains a separate, source-attributed dataset and does not itself update Billing.
2. **Discrepancies:** Surface differences between the PDF and Billing to the user. Block the affected invoice from collection actions until an authorized user resolves the discrepancy; after resolution, the selected value/source may feed the action. Never choose silently.
3. **Matching:** Use approved stable identifiers (proposed client code plus invoice number). Ambiguous matches require human review; no name-only automatic matching.
4. **Summary/detail:** Use detail rows for invoice-level intake and the summary report as a cross-check when available. Pair by as-of date; disagreements must be shown and reviewed, not normalized away.
5. **Dates/aging:** Use the report's as-of date when clear and reviewer-confirm it when uncertain. Preserve reported aging and calculate a comparison using due date and the firm's Houston timezone; show the math and flag differences.
6. **Duplicates/corrections:** Detect full-file and partial/row duplicates. Preserve provenance, avoid double counting, and record/use additional non-conflicting information. Conflicting values need explicit review. Corrected reports are new, auditable versions that supersede rather than erase history.
7. **Permissions:** Keep role/action permissions dynamic and client-configurable. Initial default is Collections staff upload/review and Owner/Admin approval, but an authorized Owner/Admin should be able to change the policy. Enforce server-side and audit changes.
8. **Storage/audit:** Retain original PDFs for future audits in a proposed private Supabase Storage bucket and record access. Keep them for at least one complete financial year. Do not auto-delete until the client's fiscal-year boundary and any longer retention requirement are confirmed.
9. **Credits/negative/zero:** Represent these visibly and show the calculation math. Do not silently apply credits or create accounting entries.
10. **Billing/future metrics:** Preserve the full source fields, calculations, source identity, row/page provenance, and audit trail so the information can be tracked in Billing and metrics in a future phase. The first intake slice does not write to the Billing ledger; any such write path needs its own contract.

Remaining contract-review items:

- Engineering A/B review the discrepancy-resolution flow, field/source selection, source attribution on later collection actions, and the configurable permission model.
- Confirm the client's fiscal-year boundary and whether any longer retention requirement applies before configuring automatic deletion. Until then, retain indefinitely rather than auto-delete early.
- Engineering A/B review the storage/RLS/audit design, duplicate merge semantics, and proposed source-resolution behavior.

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

Phase 4 is ready for Engineering A/B contract review. After they review discrepancy resolution, dynamic authorization, Storage/audit, and retention, confirm the fiscal-year boundary/any longer retention rule before configuring deletion. Then freeze the source/reconciliation contract, define APIs and private Storage lifecycle, and create synthetic fixtures. Keep the supplied real PDFs out of Git, fixtures, screenshots, external AI services, and shared non-production environments.
