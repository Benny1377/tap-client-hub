# Billing Phase 2 owner decisions and review response

Date: 2026-11-02  
Branch: `codex/billing-phase2-prep`  
Contract: `docs/contracts/billing-phase-2-pricing-and-candidates.md`

## Owner decisions recorded

- Keep the legacy `POST /api/billing/invoices/[id]` action adapter temporarily during UI migration. It must call the same authorization and audited RPC path as the canonical `/issue` and `/void` routes; remove it after UI cutover and a repository caller search.
- Reopening a dismissed candidate requires a non-empty reason and audit record.
- Use the reviewed Phase 2 scope as one phase; do not split candidate/rate-card/recurring work from the one-off dependency.
- Keep completion-source maps dynamic, modular, firm-configurable, and editable over time; do not seed actual client mappings from demo content.
- Use Net 15 by default, with an effective-dated override path; the billing date is the final service-period day unless configured otherwise.
- Firm timezone is Houston, Texas (`America/Chicago`), including firm-date, month-end, and DST calculations.
- Remittance/bank details are entered in Billing settings and copied as a non-secret snapshot when the invoice is issued. Never place credentials or payment-processing secrets in the remittance snapshot.
- Billing permissions are resolved server-side. Billing staff do not receive `pricing.manage` by default; an Owner/Admin may grant other delegable actions. `policy.manage`, `invoices.void`, and `payments.reverse` remain Owner/Admin-only and cannot be delegated through policy.
- Collections-only and unassigned users receive `403` for Billing prices, candidates, completion maps, and settings.
- A/R PDF intake remains an independently viewable/audited source; Billing candidate generation does not consume imported PDF rows as Operations facts.

## Contract additions made

The Phase 2 contract now records nullable draft number/issue/due dates until issue; synthetic request/response examples; decimal-string money; cursor format; permissions response/default action keys; candidate dismissal/reopen reasons; canonical issue/void endpoints and the temporary legacy adapter; manual empty-draft creation; the issue RPC's atomic number/date/remittance snapshot behavior; Houston firm-date tests; and the Operations schema boundary. For period storage, the selected adapter assumption is integer `YYYYMM`: later repository fixes `6fc91c9` and `d104262` explicitly convert to that format for database compatibility, while the checked-in DDL `docs/datamodel/tap_client_hub_schema_v7_lean.sql` (SHA-256 `6b2c49b84281a17282ba347c39ccdcc8a5d3a4f58428ed3a18e43f0807b29aa8`, last changed in `9c394d2` on 2026-07-08) still says text `YYYY-MM`. Billing normalizes it to `YYYY-MM` at its boundary and does not alter Operations columns. This is repository-based evidence only; no client data or hosted schema was accessed. Before implementation, Engineer B records the assumption and confirms no newer Operations schema artifact supersedes it. Phase 2 may read the named Operations tables but may not alter Operations schema or rows.

## Review gate and open handoff

This is an owner-approved contract revision, **not yet frozen**. Engineer A must review this exact branch revision and record the Phase 2 freeze acknowledgement before implementation uses it as the frozen contract. If implementation uncovers a mismatch with the verified Operations schema, stop the adapter work and resolve it with the Operations owner.

Phase 1 owner-side local synthetic SQL, database-invariant, and concurrent-allocation evidence is recorded separately in `docs/handoffs/2026-11-02-billing-phase1-owner-validation.md` on `codex/billing-phase1-validation`. It is not hosted evidence and does not by itself approve merging `codex/billing-phase1-ui` into `dev`; that branch merge remains a separate owner decision after integrated branch review. Phase 1 is not yet push-ready: the owner lint run failed and the owner has not run the authenticated HTTP matrix.

## 2026-11-04 follow-up to Engineer A's freeze review

The owner approved recording the following clarifications in the Phase 2 contract. They clarify the existing Phase 2 scope and do not add a new phase:

- **C1 — casing and compatibility:** New Phase 2 request/response shapes use camelCase. The deprecated `POST /api/billing/invoices/[id]` action adapter continues to serialize the existing Phase 1 snake_case response while invoking the same authorization and audited RPC path; remove it only after the UI cutover and caller search.
- **C2 — candidate-linked lines:** `DELETE /api/billing/invoice-lines` continues to accept the line ID in its body. Deleting a candidate-linked draft line atomically returns its candidates to `open`, and returns `returnedCandidateIds` plus invoice/candidates/receivables refresh targets. `PATCH` of a candidate-linked line returns `409 CANDIDATE_LINKED_LINE_IMMUTABLE`.
- **C3 — terms overrides:** Phase 2 includes `POST /api/billing/settings/terms/overrides` and `PATCH /api/billing/settings/terms/overrides/[id]`. Effective terms resolve client-service override first, then client override, then the firm default.
- **C4 — cursors:** Candidate, rate-card, and bundle list pages use opaque cursors with endpoint-specific sort tuples. Candidates sort by candidate date descending then ID descending; rate cards and bundles sort by name ascending then ID ascending.
- **C5 — generation accounting:** Skipped reasons are `no_map`, `map_disabled`, `source_incomplete`, and `outside_window`. A newly persisted unpriced candidate counts as created (and is separately counted as unpriced), remains ineligible for draft creation, and is included among returned candidate IDs.
- **C6 — permissions:** Collections-only and unassigned sessions receive `403` from `GET /api/billing/permissions`, as well as from Billing price, candidate, schedule, completion-map, and settings endpoints.

### Operations schema dependency — unresolved

Engineer A reports a read-only check of the shared sandbox found `work_periods.period` and `period_counts.period` are text, while later repository fixes use integer `YYYYMM`; the checked-in schema reference also documents text `YYYY-MM`. The sandbox's schema export does not establish the authoritative Operations schema. This supersedes the earlier repository-based integer assumption for implementation: no Operations adapter work starts until the Operations owner provides a schema-only export for `client_services`, `services`, `work_periods`, and `period_counts`, including column names, database types, nullability, and relevant keys/constraints. Do not send or include table rows, credentials, or secrets. Once received, record its source/date and verify the adapter fields before choosing normalization. Billing-owned Phase 2 work remains separate from this adapter gate, subject to Engineer A's freeze re-acknowledgement of the updated contract.

The Phase 2 contract is updated but **not frozen** until Engineer A acknowledges this exact revision. The earlier Phase 1 status sentence above is historical and is superseded by the 2026-11-04 owner validation/closeout records; Phase 1 validation has since been completed and recorded separately.
