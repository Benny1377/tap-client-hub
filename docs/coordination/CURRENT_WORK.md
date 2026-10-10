# TAP Client Hub Current Work

Last updated: 2026-10-10 Asia Kolkata

Updated by: Codex (Collections Phase 2 backend)

## Shared baseline

- Stable branch: `main`
- Fetched production baseline: `210a08a2c02215f523acd511c1fb696ac551d393` (re-fetched 2026-10-06; unchanged)
- Verified Vercel deployment: NOT VERIFIED
- Active milestones:
  - M0 Stable ownership;
  - Collections Phase 0 (read-only discovery), complete.
  - Collections Phase 1 (Billing ledger), backend review fixes pushed; integrated UI validation remains open.
  - Collections Phase 2 (Billing-backed Collections automation), backend implementation in progress; QuickBooks explicitly out of scope.
- Overall status: The project owner reports applying migrations `20261010110000_billing_audit_and_receivables.sql` and `20261010120000_collections_automation_foundation.sql`; neither report has been independently verified from this branch. New forward-only migration `20261010130000_collections_shared_date_and_stage_model.sql` is local and unverified. Phase 1 UI/backend integration and release validation remain open. Phase 2 code remains on its feature branch; no production email delivery is authorized.

## Active branches

| Branch | Owner | Scope | Base commit | Status | Merge gate |
| --- | --- | --- | --- | --- | --- |
| `codex/tap-hub-delivery-playbook` | Codex documentation setup | Initial delivery playbook and coordination structure | `210a08a2c02215f523acd511c1fb696ac551d393` | Ready for review | Project-owner approval |
| `codex/collections-phase-0` | Claude Code | Collections Phase 0 discovery, hosted schema evidence, decision record, frozen Phase 1 contract, handoff. Documentation only. | `c259a6edf871b43a0aa2ad0d11cb73dfd8f82653` (stacked on the playbook branch) | Complete | Project-owner review |
| `codex/collections-phase-1-billing-ledger` | Codex | Phase 1 Billing ledger and backend review fixes. | `ded69a3` | Backend fixes pushed at `e2df16e`; owner reports migration applied; UI integration validation pending | Review handoff `docs/handoffs/2026-10-10-collections-phase-1-review-fixes.md`; integrated UI/backend validation and release gates |
| `codex/collections-phase-2-backend` | Codex | Billing-backed Collections read model and safe automation backend. | `e2df16e` (`codex/collections-phase-1-billing-ledger`) | Base implementation pushed at `292de5c`; developer review fixes in progress locally; Engineer A contract review pending | Engineer A API review, Phase 1 integrated release gates, Phase 2 non-production database/UI validation |

## Dependencies and blockers

| ID | Requester | Owner | Needed item | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| COL-DEP-01 | Collections Phase 1 | Engineer B, with project-owner approval | Approved read-only hosted Supabase inspection | COMPLETE | `docs/decisions/2026-10-06-collections-billing-source-of-truth.md` |
| COL-DEP-02 | Collections Phase 1 | Project owner | Choose one forward-only migration location | COMPLETE: `supabase/migrations/` | `docs/decisions/2026-10-06-collections-billing-source-of-truth.md` |
| COL-DEP-03 | Collections Phase 1 | Project owner | Approval for `npm install`, needed for lint, typecheck, build, and the access regression suite | COMPLETE | Dependencies are installed in this checkout. |
| COL-DEP-04 | Collections Phase 1 | Project owner + Engineer B | Resolve unauthenticated client reads and retire the exposed shared Supabase Auth password before privileged APIs ship. | Code-side identity fixes are pushed; Supabase password reset/session review remains OWNER ACTION REQUIRED | `docs/handoffs/2026-10-10-collections-phase-1-review-fixes.md`; `docs/decisions/2026-10-10-supabase-shared-password-rotation.md` |
| COL-DEP-05 | Collections Phase 1 | Engineer A and Engineer B | Review and freeze the Phase 1 contract | COMPLETE: frozen 2026-10-09 | `docs/contracts/collections-phase-1-billing-ledger.md` |
| COL-DEP-06 | Collections Phase 2 | Project owner | Confirm the system of record and whether QuickBooks is required. | COMPLETE: TAP Hub Billing only; QuickBooks not needed | `docs/decisions/2026-10-10-collections-source-tap-hub-billing.md` |
| COL-DEP-07 | Collections Phase 2 | Engineer A | Review consumer-facing contract/API shape before UI wiring. | OPEN | `docs/contracts/collections-phase-2-backend.md` |
| COL-DEP-08 | Collections Phase 2 | Engineer A + Engineer B | Complete Phase 1 integrated UI/backend validation before Phase 2 release. | OPEN | Phase 1 handoff and test evidence |
| COL-DEP-09 | Collections Phase 2 | Project owner + client | Confirm ladder copy/timing, limits, sender/test recipient, contact selection, and production-send approval. | OPEN; production sending disabled | Phase 2 contract, open decisions |
| COL-DEP-10 | Collections Phase 1 | Project owner | Rotate the exposed shared Supabase Auth password for affected users and review existing sessions. | OWNER ACTION REQUIRED before Phase 1 sign-off; application hash guard does not block direct Supabase Auth login | `docs/decisions/2026-10-10-supabase-shared-password-rotation.md` |
| COL-DEP-11 | Collections Phase 2 | Engineer A + Engineer B | Validate migrations through `20261010130000` and the Billing/Collections UI flow in non-production. | OPEN; no non-production database available in this task | `supabase/tests/collections_phase1_security_and_audit.sql`; `supabase/tests/collections_phase1_audit_actor.sql` |

## Merge queue

| Order | Branch | Owner | Required before merge | Status |
| --- | --- | --- | --- | --- |
| 1 | `codex/tap-hub-delivery-playbook` | Codex documentation setup | Project-owner review | Waiting |
| 2 | `codex/collections-phase-0` | Claude Code | Merge of order 1; project-owner review | Waiting |

## Next coordination event

Complete Phase 1 by integrating the UI branch and recording end-to-end validation evidence. The owner reports migrations through `20261010120000` applied, but the hosted migration state is not independently verified. Retire the exposed shared Supabase Auth credential before release. Phase 2 backend work uses TAP Hub Billing only; QuickBooks is explicitly out of scope. Review and validate migration `20261010130000` only in non-production, obtain Engineer A contract approval, and complete Phase 1 release gates before Phase 2 release. Production email delivery remains disabled pending separate owner/client approval. Do not merge to `main` until all planned phases and their gates are complete.
