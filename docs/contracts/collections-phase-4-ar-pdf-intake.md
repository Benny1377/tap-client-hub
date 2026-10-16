# Collections Phase 4: QuickBooks A/R PDF Intake (Preparation Draft)

State: **Preparation draft only — source-of-truth and reconciliation decisions are not frozen.**

Owner: Project owner (Tejas Wilavanya)
Proposed producer: Engineer B (upload, extraction, validation, persistence, access policy)
Proposed consumer: Engineer A (upload/review/reconciliation UI)

## Objective

Prepare an auditable intake path for QuickBooks Accounts Receivable PDF reports. The owner selected PDFs as the intended upload format. That selects the file format, but does **not** yet decide whether an imported report or TAP Hub Billing is authoritative for a balance, nor how conflicts affect Collections actions.

Phase 4 must keep imported reports separate from the Billing ledger until those decisions are approved. Uploading or parsing a PDF must not create or edit invoices, payments, allocations, client records, or collection events.

## Sample layout observations

The supplied samples include two report shapes:

- An A/R Aging QuickZoom detail report (15 pages) with columns for transaction type, date, transaction number, P.O. number, name, terms, due date, aging, and open balance.
- An A/R Aging Summary report (3 pages) that presents aggregated aging rather than the same transaction-level detail.

Both are Intuit PDFs produced via Microsoft Print to PDF. The sample files contain business/customer financial information and must stay out of source control, fixtures, screenshots, external AI services, and shared non-production environments. Use newly generated synthetic PDFs for development and regression tests.

## Proposed capability boundary

In scope for a first intake slice, subject to contract approval:

- Upload and retain a report as an immutable source artifact with uploader, upload time, file hash, report type, and report as-of date where confidently extracted.
- Recognize only the reviewed A/R Aging Summary and A/R Aging QuickZoom detail layouts; reject or route unknown layouts to manual review instead of guessing.
- Extract into a reviewable staging batch. Preserve source page/row references and original parsed values so a reviewer can trace discrepancies back to the PDF.
- Validate required fields, dates, currency/amount formatting, duplicate rows, report totals, and consistency between a detail report and its summary when both are uploaded for the same as-of date.
- Match report customers/invoices to TAP Hub records only with approved stable identifiers; ambiguous or missing matches require human review.
- Provide a side-by-side comparison against TAP Hub Billing, with explicit differences and a reviewer decision for each unresolved conflict.
- Keep every upload, parse result, reviewer correction, approval, and later supersession auditable.

Explicitly out of scope until separately approved:

- Treating a PDF as an authoritative ledger or silently overwriting Billing.
- Automatically creating invoices, payments, allocations, credits, write-offs, holds, or collection events from extracted rows.
- Automated email delivery based on imported balances.
- QuickBooks API/OAuth/webhook integration, direct QuickBooks account access, or unattended polling.
- Importing the supplied real reports into local or shared test databases.

## Safe default before the source decision

Treat the PDF as an **untrusted, dated snapshot for comparison only**. Do not make it eligible for collection worklists, reminders, escalation, or balance calculations. TAP Hub Billing remains the operational source for existing Collections behavior until the owner approves a new source-resolution contract. If a PDF disagrees with Billing, show the discrepancy and stop; do not choose a winner automatically.

This is a containment default, not a final source-of-truth decision.

## Required decisions before implementation is frozen

1. **Authority by field:** Which system owns customer identity, invoice identity, open balance, due date, credits, and aging? Could authority differ by field or by client?
2. **Conflict policy:** When the PDF and Billing disagree, should the user accept a PDF snapshot for Collections, correct Billing, or leave the invoice blocked pending investigation? Who may decide?
3. **Invoice matching:** Which PDF fields are reliable keys (for example invoice number plus client code)? How should QuickBooks customer names map to TAP Hub clients, including aliases and duplicate names?
4. **Summary/detail pairing:** Must both report types be uploaded for the same as-of date? If they disagree on totals, is the whole batch blocked or can valid detail rows proceed?
5. **Report date and aging:** Which printed date defines the snapshot's as-of date? Should aging be imported as reported or recomputed from due date, and which business timezone applies?
6. **Corrections and re-imports:** How should a corrected report, repeated file, changed report date, or previously approved batch be identified and superseded without duplicating rows?
7. **Roles and approval:** Who can upload, correct parsed fields, resolve matches, approve a batch, and expose accepted rows to Collections?
8. **Retention and privacy:** How long are source PDFs and extracted values retained, and who can download them? Confirm storage location, encryption, deletion, and audit requirements.
9. **Credits and negative/zero balances:** How are unapplied cash, credit balances, voids, and zero balances represented when the report's summary and detail layouts differ?
10. **Accepted data semantics:** If PDFs become authoritative for Collections, is that a read-only snapshot source, or does an approved reconciliation update the TAP Hub ledger? The latter requires a separate ledger-write contract.

## Proposed validation gates

- Synthetic report fixtures cover both observed layouts, multiple pages, duplicate rows, missing identifiers, bad dates, negative/zero balances, and OCR/text-extraction failures.
- Validate summary totals against detail totals when reports are paired; report exact differences without silently normalizing them away.
- Re-uploading the same file is idempotent; a corrected file creates a traceable superseding batch rather than overwriting history.
- Ambiguous client/invoice matches, unknown layouts, and failed total checks remain blocked until reviewed.
- Role matrix, RLS/storage access, audit attribution, retention, and data export behavior are tested before any shared sandbox use.
- Integration tests prove that upload and approval do not mutate Billing unless a separately approved ledger-write path is later added.
- Phase 4 must not enable any Phase 3 provider delivery. Synthetic-only gates and the delivery-off default remain in force.

## Readiness and handoff

Phase 4 is ready for contract review, not implementation. First resolve the ten owner decisions above, then freeze a source/reconciliation contract, define APIs and storage lifecycle, and create synthetic fixtures. Keep the original PDFs local and read-only; do not check them into Git.
