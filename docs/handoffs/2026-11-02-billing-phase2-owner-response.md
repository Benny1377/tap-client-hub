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

The Phase 2 contract records nullable draft number/issue/due dates until issue; request/response examples; decimal-string money; cursor format; permission defaults; candidate lifecycle reasons; canonical issue/void endpoints and the legacy adapter; manual draft creation; atomic issue numbering/date/remittance snapshot; Houston firm-date tests; and the Operations boundary. The owner-provided schema-only export later confirmed text `YYYYMM` period values in the sandbox; Billing normalizes these to `YYYY-MM` without changing Operations. It does not establish hosted schema parity.

## Review gate and open handoff

As recorded on 2026-11-02, this owner-approved contract revision was **not yet frozen**; Engineer A's review and freeze acknowledgement were still pending then. Any Operations schema mismatch must stop adapter work and be resolved with the Operations owner.

Phase 1 owner-side local synthetic SQL, database-invariant, and concurrent-allocation evidence is recorded separately in `docs/handoffs/2026-11-02-billing-phase1-owner-validation.md` on `codex/billing-phase1-validation`. It is not hosted evidence and does not by itself approve merging `codex/billing-phase1-ui` into `dev`; that branch merge remains a separate owner decision after integrated branch review. Phase 1 is not yet push-ready: the owner lint run failed and the owner has not run the authenticated HTTP matrix.

## 2026-11-04 follow-up to Engineer A's freeze review

The owner approved recording the following clarifications in the Phase 2 contract. They clarify the existing Phase 2 scope and do not add a new phase:

- **C1 — casing and compatibility:** New Phase 2 request/response shapes use camelCase. The deprecated `POST /api/billing/invoices/[id]` action adapter continues to serialize the existing Phase 1 snake_case response while invoking the same authorization and audited RPC path; remove it only after the UI cutover and caller search.
- **C2 — candidate-linked lines:** `DELETE /api/billing/invoice-lines` continues to accept the line ID in its body. Deleting a candidate-linked draft line atomically returns its candidates to `open`, and returns `returnedCandidateIds` plus invoice/candidates/receivables refresh targets. `PATCH` of a candidate-linked line returns `409 CANDIDATE_LINKED_LINE_IMMUTABLE`.
- **C3 — terms overrides:** Phase 2 includes `POST /api/billing/settings/terms/overrides` and `PATCH /api/billing/settings/terms/overrides/[id]`. Effective terms resolve client-service override first, then client override, then the firm default.
- **C4 — cursors:** Candidate, rate-card, and bundle list pages use opaque cursors with endpoint-specific sort tuples. Candidates sort by candidate date descending then ID descending; rate cards and bundles sort by name ascending then ID ascending.
- **C5 — generation accounting:** Skipped reasons are `no_map`, `map_disabled`, `source_incomplete`, and `outside_window`. A newly persisted unpriced candidate counts as created (and is separately counted as unpriced), remains ineligible for draft creation, and is included among returned candidate IDs.
- **C6 — permissions:** Collections-only and unassigned sessions receive `403` from `GET /api/billing/permissions`, as well as from Billing price, candidate, schedule, completion-map, and settings endpoints.

### Operations schema dependency — export received 2026-11-05

The owner supplied read-only metadata from the current `tap_hub_project` schema for `client_services`, `services`, `work_periods`, and `period_counts`. An aggregate-only format check confirmed both text `period` columns contain `YYYYMM`. The export confirms the planned adapter fields and relationships. This clears the schema-evidence gate; implementation must normalize `YYYYMM` to `YYYY-MM` without modifying Operations. No row values, credentials, or secrets were shared. This evidence does not authorize hosted migrations.

As of this 2026-11-04 follow-up, the Phase 2 contract was updated but **not yet frozen** pending Engineer A's acknowledgement. The earlier Phase 1 status sentence above is historical and is superseded by the 2026-11-04 owner validation/closeout records; Phase 1 validation has since been completed and recorded separately.

## 2026-11-05 contract freeze recorded

Engineer A's 2026-11-05 message reports acceptance of contract commit `86f65ef` with no objections and confirms C1–C6 are resolved. The reported acknowledgement artifact is `docs/handoffs/2026-11-05-billing-phase2-engineer-a-freeze-acknowledgement.md` on `codex/billing-phase1-ui`, commit `8b4a48e`. The Phase 2 UI-facing boundary—paths, request/response shapes, permission keys, error codes, and cursor rules—is **Frozen** at `86f65ef`. This acknowledgement was recorded from Engineer A's message; that commit/artifact was not available in the local remote-tracking ref at the time of this update.

The schema-evidence dependency is cleared for the sandbox-exported shape summarized above. Adapter implementation and validation are still in progress; hosted database changes remain outside this freeze.

## 2026-11-05 implementation checkpoint

Implementation is prepared on the isolated branch `codex/billing-phase2-prep` in the Billing Phase 2 worktree. No merge or hosted migration was performed.

The current uncommitted implementation adds Billing-owned pricing, bundle, terms/remittance, policy, candidate, and provenance records; private RLS/service-role grants; effective-date overlap guards; numeric price resolution; and transactional draft-from-candidates, issue, void, candidate-release, and draft-delete RPCs. Issue assigns `TAP-YYYY-####`, uses the Houston firm date, resolves client-service terms before client terms before Net 15, and snapshots only configured remittance text. New explicit issue/void endpoints and the candidate creation endpoint call the RPCs. The legacy invoice action route now delegates to those RPCs. Candidate-linked line edits are rejected in both route and database trigger. The local reset script includes the new migration.

`supabase/tests/billing_phase2_core.sql` is a synthetic transaction/rollback test for rate resolution and overlap rejection; nullable draft fields; client-service-over-client terms precedence; remittance snapshot; atomic issue/void; non-reused numbers; candidate re-draft and release; package line quantity/amount/provenance; line removal; and deletion of a draft containing a line. It also checks 30/31-day month ends, leap February, and spring/fall Houston DST transitions. It passed when streamed with the migration inside one outer transaction that was rolled back. `tsc --noEmit` reports no errors in the changed Billing files; the repository-wide check remains blocked by the pre-existing missing `pdfjs-dist/legacy/build/pdf.mjs` declaration in `lib/collections-pdf-parser.ts`. `git diff --check` passes.

Manual confirmation and permission editing are implemented as two documented contract amendments: `POST /api/billing/candidates/manual-confirmations` and `PATCH /api/billing/permissions/policy`. The first uses a stable UUID idempotency key and writes audited Billing-owned provenance/candidate rows. The second changes only submitted delegable policies; the route and RPC both refuse `policy.manage`, `invoices.void`, and `payments.reverse`. Disabled policy rows explicitly revoke default staff actions. These additions are outside Engineer A's acknowledgement of frozen revision `86f65ef`; the amendments require Engineer A's review before Phase 3 UI depends on them.

The manual-confirmation route returns 201 when created, 200 for an identical retry, 409 for an idempotency-key mismatch or missing active source map, and 422 for invalid input. The policy route is Owner/Admin-only and records actor/reason; attempts to delegate fixed Owner/Admin actions fail at the database boundary as well as at HTTP validation.

Final local validation on 2026-11-05:

- The Phase 2 migration plus `supabase/tests/billing_phase2_core.sql` passed against local port `55322`, streamed as one outer transaction and rolled back. A follow-up catalog check confirmed `billing_rate_cards` was absent, verifying the migration did not persist.
- `tsc --noEmit` passed.
- Targeted ESLint passed for the new Phase 2 routes/helpers and modified line, invoice, payment, allocation, and permissions routes. Unrelated legacy Billing routes were not part of this targeted lint run.
- `tests/billing-phase2-serialization.test.mjs` passed 3/3. The existing Billing/Collections UI test set passed 35/35.
- `git diff --check` passed.
- Payment-record and payment-allocation writes now enforce `payments.record` and `payments.allocate`; the read-only permissions endpoint remains available to any authenticated Billing-module user even if their effective action list is empty.

Not yet complete: no authenticated Phase 2 HTTP route matrix was run, no synthetic Operations-adapter route test against local fixtures was run, and no Engineer A implementation review/acceptance has been recorded. Phase 1's 37/37 matrix does not cover these new endpoints. The new manual-confirmation and policy-edit contract amendments also remain outside Engineer A's acknowledgement of frozen revision `86f65ef`. The migration has not been applied persistently to local, shared sandbox, Preview, or production.

This is a validated implementation handoff, not yet an accepted or hosted Phase 2 release. The remaining gates above must close before claiming Phase 2 backend completion.
