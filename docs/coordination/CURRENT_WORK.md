# TAP Client Hub Current Work

Last updated: 2026-10-06 Asia Kolkata

Updated by: Claude Code (Collections Phase 0)

## Shared baseline

- Stable branch: `main`
- Fetched production baseline: `210a08a2c02215f523acd511c1fb696ac551d393` (re-fetched 2026-10-06; unchanged)
- Verified Vercel deployment: NOT VERIFIED
- Active milestones:
  - M0 Stable ownership;
  - Collections Phase 0 (read-only discovery), complete pending review.
- Overall status: In progress

## Active branches

| Branch | Owner | Scope | Base commit | Status | Merge gate |
| --- | --- | --- | --- | --- | --- |
| `codex/tap-hub-delivery-playbook` | Codex documentation setup | Initial delivery playbook and coordination structure | `210a08a2c02215f523acd511c1fb696ac551d393` | Ready for review | Project-owner approval |
| `codex/collections-phase-0` | Claude Code | Collections Phase 0 discovery: decision record, Draft Phase 1 contract, handoff. Documentation only. | `c259a6edf871b43a0aa2ad0d11cb73dfd8f82653` (stacked on the playbook branch) | Ready for review | Playbook branch merged first; project-owner approval |

## Dependencies and blockers

| ID | Requester | Owner | Needed item | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| COL-DEP-01 | Collections Phase 1 | Engineer B, with project-owner approval | Approved read-only hosted Supabase inspection: `billing_periods` shape, row count, RLS and grants; `clients.id` type; `audit_log` shape. The checkout has no linked project configuration. | BLOCKED | `docs/decisions/2026-10-06-collections-billing-source-of-truth.md` |
| COL-DEP-02 | Collections Phase 1 | Project owner | Choose one forward-only migration location | BLOCKED | `PROJECT_INTRO.md` open operating decisions |
| COL-DEP-03 | Collections Phase 1 | Project owner | Approval for `npm install`, needed for lint, typecheck, build, and the access regression suite | BLOCKED | `docs/handoffs/2026-10-06-collections-phase-0.md` |
| COL-DEP-04 | Collections Phase 1 | Engineer B | Resolve the unsigned `tap_demo_user` identity fallback on `/api/` routes before Owner/Admin-only financial approvals ship. Code-read finding only, not verified live. | BLOCKED | Contract risk R1 |
| COL-DEP-05 | Collections Phase 1 | Engineer A and Engineer B | Review and freeze the Draft Phase 1 contract | NOT RUN | `docs/contracts/collections-phase-1-billing-ledger.md` |

## Merge queue

| Order | Branch | Owner | Required before merge | Status |
| --- | --- | --- | --- | --- |
| 1 | `codex/tap-hub-delivery-playbook` | Codex documentation setup | Project-owner review | Waiting |
| 2 | `codex/collections-phase-0` | Claude Code | Merge of order 1; project-owner review | Waiting |

## Next coordination event

Review the Collections Phase 1 Draft contract and clear COL-DEP-01 to COL-DEP-04 before any Phase 1 branch starts. Update this file from actual Git and environment evidence before beginning parallel work. Do not fill fields from memory or chat alone.
