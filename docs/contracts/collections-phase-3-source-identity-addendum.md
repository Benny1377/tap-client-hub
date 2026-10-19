# Collections Phase 3 Addendum: Source-Aware Collection Identity

Status: **Approved as part of the Phase 4 contract on 2026-10-18.** This forward-only change must ship with the Phase 4 import backend and its UI/type integration. The source of requirements is [Collections Phase 4: QuickBooks A/R PDF Intake](collections-phase-4-ar-pdf-intake.md).

- Delivery attempts, holds, events, approvals, notice-sent records, stage progression, and `last_delivery` resolve by immutable `canonical_collection_identity`, not the currently selected balance source.
- Existing history is backfilled as `billing:<invoice_id>`. A PDF-only identity starts as `pdf_import:<source_invoice_id>`. A link made before any history uses Billing identity. A later link adds an alias without rewriting history. Two independently active histories block action pending explicit reconciliation.
- Attempt uniqueness and idempotency are shared across aliases per stage. Switching selected source cannot create a second reminder for a completed stage.
- Worklist, preview, and delivery history expose nullable Billing/PDF IDs, source, stable row key, canonical identity, source batch/date, and discrepancy state. `GET /api/collections/deliveries` filters by both `invoice_id` and `source_invoice_id`.
- A mismatch or stale snapshot blocks preview/action with `SOURCE_DISCREPANCY_BLOCKED`; the UI shows the selected source and calculation.
- Phase 3 test delivery remains synthetic-only and delivery-disabled by default; this addendum does not authorize live sends.
