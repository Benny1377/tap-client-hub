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
