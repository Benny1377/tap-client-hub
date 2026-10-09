# TAP Client Hub Current Work

Last updated: 2026-10-09 Asia Kolkata

Updated by: Claude Code (Collections Phase 1 UI)

## Shared baseline

- Stable branch: `main`
- Fetched production baseline: `210a08a2c02215f523acd511c1fb696ac551d393` (re-fetched 2026-10-06; unchanged)
- Verified Vercel deployment: NOT VERIFIED
- Active milestones:
  - M0 Stable ownership;
  - Collections Phase 0 (read-only discovery), complete.
  - Collections Phase 1 (Billing ledger), initialized.
- Overall status: Phase 1 initialized; implementation pending security review.

## Active branches

| Branch | Owner | Scope | Base commit | Status | Merge gate |
| --- | --- | --- | --- | --- | --- |
| `codex/tap-hub-delivery-playbook` | Codex documentation setup | Initial delivery playbook and coordination structure | `210a08a2c02215f523acd511c1fb696ac551d393` | Ready for review | Project-owner approval |
| `codex/collections-phase-0` | Claude Code | Collections Phase 0 discovery, hosted schema evidence, decision record, frozen Phase 1 contract, handoff. Documentation only. | `c259a6edf871b43a0aa2ad0d11cb73dfd8f82653` (stacked on the playbook branch) | Complete | Project-owner review |
| `codex/collections-phase-1-billing-ledger` | Codex | Phase 1 Billing ledger implementation, beginning with R1 identity security review and contract validation. | `e953197` (`codex/collections-phase-0`) | Initialized | Security review and Phase 1 contract validation |
| `codex/collections-phase-1-ui` | Claude Code (Engineer A track) | Phase 1 Billing and Collections UI consuming the existing API. No backend changes. API mismatches UI-M1 to UI-M10 reported for the producer. | `22d7528` (`codex/collections-phase-1-billing-ledger`) | Ready for review | Ledger branch merged first; UI-M1 to UI-M3 decided; browser validation in an approved environment |

## Dependencies and blockers

| ID | Requester | Owner | Needed item | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| COL-DEP-01 | Collections Phase 1 | Engineer B, with project-owner approval | Approved read-only hosted Supabase inspection | COMPLETE | `docs/decisions/2026-10-06-collections-billing-source-of-truth.md` |
| COL-DEP-02 | Collections Phase 1 | Project owner | Choose one forward-only migration location | COMPLETE: `supabase/migrations/` | `docs/decisions/2026-10-06-collections-billing-source-of-truth.md` |
| COL-DEP-03 | Collections Phase 1 | Project owner | Approval for `npm install`, needed for lint, typecheck, build, and the access regression suite | BLOCKED | `docs/handoffs/2026-10-06-collections-phase-0.md` |
| COL-DEP-04 | Collections Phase 1 | Engineer B | Resolve the unsigned `tap_demo_user` identity fallback on `/api/` routes before Owner/Admin-only financial approvals ship. Code-read finding only, not verified live. | BLOCKED | Contract risk R1 |
| COL-DEP-05 | Collections Phase 1 | Engineer A and Engineer B | Review and freeze the Phase 1 contract | COMPLETE: frozen 2026-10-09 | `docs/contracts/collections-phase-1-billing-ledger.md` |

## Merge queue

| Order | Branch | Owner | Required before merge | Status |
| --- | --- | --- | --- | --- |
| 1 | `codex/tap-hub-delivery-playbook` | Codex documentation setup | Project-owner review | Waiting |
| 2 | `codex/collections-phase-0` | Claude Code | Merge of order 1; project-owner review | Waiting |

## Next coordination event

Begin Phase 1 only after the security-risk R1 review and dependency-installation approval. Update this file from actual Git and environment evidence before beginning parallel implementation.
