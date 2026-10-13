# TAP Client Hub Current Work

Last updated: 2026-10-13 Asia Kolkata

Updated by: Codex (Phase 3 prep and independent Phase 2 follow-ups)

## Shared baseline

- Stable branch: `main`
- Fetched production baseline: `210a08a2c02215f523acd511c1fb696ac551d393` (re-fetched 2026-10-06; unchanged)
- Verified Vercel deployment: NOT VERIFIED
- Active milestones:
  - M0 Stable ownership;
  - Collections Phase 0 (read-only discovery), complete.
  - Collections Phase 1 ledger and Phase 2 Collections features, integrated local validation complete; joint branch review/merge and release gates remain.
  - Collections Phase 3 email integration, contract draft/prep in progress; no provider or live delivery is authorized.
- Overall status: Phase 2 backend `codex/collections-phase2-integration` at `53324a7` and UI/integration branch `codex/collections-phase2-ui-validation` at `dd3472f` are locally integrated and validated. Engineer A reports a clean local reset, five SQL suites, 68/68 API/database/audit checks, and Owner/Collections-staff browser flows. A fresh local rerun also passed 68/68 after the documented local-only H4 schema workaround. Automation remains off and delivery mode disabled. This is feature/test completion, not formal merge or production release. Review and merge backend first, then UI; hosted migrations remain deferred until explicit release approval. Harness gaps H4/H5 and separate security finding S1 remain documented; COL-DEP-10 and COL-DEP-12 remain owner actions.

## Current checkpoint (2026-10-13)

- Phase 2 scope is complete and integrated-test verified. The UI branch head is `dd3472f` (not the earlier `64f1c1e` reference); it contains the UI-C/UI-D fixes and latest validation record. Backend head is `53324a7`.
- Phase 2 is awaiting joint review/sign-off and its agreed backend-then-UI merge sequence. No Phase 2 or Phase 3 changes are pushed by this prep.
- A review branch now includes fixes for H4/H5/H6 (complete local Contacts schema and firm-local seed dates) and S1 (authenticated Clients-module gate on service-role-backed `GET /api/contacts`). Fresh reset, regression, and browser validation remain pending; do not call S1 closed until the access matrix passes.
- The client approved creating a separate Supabase sandbox project. Provisioning is not done; organization, owner, region, project name, billing, membership, and data policy details remain to be confirmed. No production data copy, hosted migration, provider calls, or live delivery is included.
- Phase 3 contract and handoff remain drafts on `codex/collections-phase3-contract`; provider-dependent implementation waits for owner decisions and Engineer A/B review. Delivery is disabled.

## Active branches

| Branch | Owner | Scope | Base commit | Status | Merge gate |
| --- | --- | --- | --- | --- | --- |
| `codex/tap-hub-delivery-playbook` | Codex documentation setup | Initial delivery playbook and coordination structure | `210a08a2c02215f523acd511c1fb696ac551d393` | Ready for review | Project-owner approval |
| `codex/collections-phase-0` | Claude Code | Collections Phase 0 discovery, hosted schema evidence, decision record, frozen Phase 1 contract, handoff. Documentation only. | `c259a6edf871b43a0aa2ad0d11cb73dfd8f82653` (stacked on the playbook branch) | Complete | Project-owner review |
| `codex/collections-phase-1-billing-ledger` | Codex | Phase 1 Billing ledger and backend review fixes. | `ded69a3` | Backend fixes pushed at `e2df16e`; owner reports migration applied; UI integration validation pending | Review handoff `docs/handoffs/2026-10-10-collections-phase-1-review-fixes.md`; integrated UI/backend validation and release gates |
| `codex/collections-ui` | Claude Code (Engineer A track) | Billing and Collections UI for Phase 1, continuing into Phase 2 on top of the Phase 2 backend. Replaces `codex/collections-phase-1-ui` (8438039), which was based on the older ledger head. No backend changes. | `0e01c19` (`codex/collections-phase-2-backend`) | Phase 1 UI ready for review; Phase 2 UI not started | Phase 2 backend merged first; Engineer A contract approval; non-production database and browser validation |
| `codex/collections-phase-2-ui` | Claude Code (Engineer A track) | Phase 1 UI completion (firm date, invoice-scoped requests, notice-sent recording, payment remaining amounts, client aging, hold scope) and Phase 2 UI (AR insights, priority call list, automation preview). No backend changes. | `50b886a` (`codex/collections-ui`) | Ready for review; Engineer A approval of the Phase 2 contract recorded with one condition | Phase 2 backend merged first; client-level stage fix; password rotation; non-production database and browser validation |
| `codex/collections-phase-2-backend` | Codex | Billing-backed Collections read model and safe automation backend. | `e2df16e` (`codex/collections-phase-1-billing-ledger`) | Base implementation pushed at `292de5c`; developer review fixes in progress locally; Engineer A contract review pending | Engineer A API review, Phase 1 integrated release gates, Phase 2 non-production database/UI validation |
| `codex/collections-phase2-integration` | Codex | Phase 2 backend, local harness, dynamic Owner/Admin rules, and remembered primary-contact selection. | `0e01c19` (`origin/codex/collections-phase-2-backend`) | Pushed at `53324a7`; integrated SQL/API/database/audit/browser validation PASS on the UI branch; hosted DB untouched | Joint review/sign-off, then merge backend before UI; no hosted migration yet |
| `codex/collections-phase2-ui-validation` | Engineer A + Codex | Phase 1/2 UI, browser validation, contract/timezone updates, configurable rules editor, local verification. | `3bec72a` (`codex/collections-phase2-integration`) | Latest remote `dd3472f` (contains integration `53324a7`); 5 SQL suites, 68/68 API/DB/audit, Owner/Collections-staff browser pass | Joint review/sign-off; merge after backend integration; H4/H5 remain harness improvements |
| `codex/collections-phase3-contract` | Codex prep | Phase 3 contract/prep, sandbox decision record, independent S1 auth fix, local harness H4/H5/H6 fixes. No provider integration. | `dd3472f` (`codex/collections-phase2-ui-validation`) | Contact API contract test passes; full SQL/reset/browser validation pending; no provider integration | Review S1 access policy; clean local harness reset and Contacts browser pass; owner decisions P3-D1–D8 for provider-dependent work |

## Dependencies and blockers

| ID | Requester | Owner | Needed item | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| COL-DEP-01 | Collections Phase 1 | Engineer B, with project-owner approval | Approved read-only hosted Supabase inspection | COMPLETE | `docs/decisions/2026-10-06-collections-billing-source-of-truth.md` |
| COL-DEP-02 | Collections Phase 1 | Project owner | Choose one forward-only migration location | COMPLETE: `supabase/migrations/` | `docs/decisions/2026-10-06-collections-billing-source-of-truth.md` |
| COL-DEP-03 | Collections Phase 1 | Project owner | Approval for `npm install`, needed for lint, typecheck, build, and the access regression suite | COMPLETE | Dependencies are installed in this checkout. |
| COL-DEP-04 | Collections Phase 1 | Project owner + Engineer B | Resolve unauthenticated client reads and retire the exposed shared Supabase Auth password before privileged APIs ship. | Code-side identity fixes are pushed; Supabase password reset/session review remains OWNER ACTION REQUIRED | `docs/handoffs/2026-10-10-collections-phase-1-review-fixes.md`; `docs/decisions/2026-10-10-supabase-shared-password-rotation.md` |
| COL-DEP-05 | Collections Phase 1 | Engineer A and Engineer B | Review and freeze the Phase 1 contract | COMPLETE: frozen 2026-10-09 | `docs/contracts/collections-phase-1-billing-ledger.md` |
| COL-DEP-06 | Collections Phase 2 | Project owner | Confirm the system of record and whether QuickBooks is required. | COMPLETE: TAP Hub Billing only; QuickBooks not needed | `docs/decisions/2026-10-10-collections-source-tap-hub-billing.md` |
| COL-DEP-07 | Collections Phase 2 | Engineer A | Review consumer-facing contract/API shape before UI wiring. | Reviewed against `53324a7`: rules/settings/firm timezone, completed/upcoming stage, contact selection consumed by the UI; low findings A3/A4 | `docs/handoffs/2026-10-11-collections-phase2-ui-validation.md` |
| COL-DEP-08 | Collections Phase 2 | Engineer A + Engineer B | Complete Phase 1 integrated UI/backend validation before Phase 2 release. | Integrated validation PASS; joint review/sign-off and merge closure remain | Phase 2 closeout in `docs/handoffs/2026-10-12-collections-phase-3-integration-prep.md` |
| COL-DEP-09 | Collections Phase 2 | Project owner + client | Confirm ladder copy/timing, limits, sender/test recipient, contact selection, and production-send approval. | Owner decisions recorded: ladder/guardrails remain rule-driven; default to primary contact and pause for ambiguous contact until an authorized editor selects and saves one; Owner/Admin approval for owner-level stages; sender/test recipient and any real sending deferred to integrations. Production sending remains disabled. | Phase 2 contract and current owner decision |
| COL-DEP-10 | Collections Phase 1 | Project owner | Rotate the exposed shared Supabase Auth password for affected users and review existing sessions. | OWNER ACTION REQUIRED before Phase 1 sign-off; application hash guard does not block direct Supabase Auth login | `docs/decisions/2026-10-10-supabase-shared-password-rotation.md` |
| COL-DEP-11 | Collections Phase 2 | Engineer A + Engineer B | Validate Billing/Collections in non-production. | Prior integrated run PASS: five SQL suites, 68/68 API/DB/audit, Owner and Collections-staff browser flows. Follow-up harness/security fixes are in review branch; rerun pending. | `docs/handoffs/2026-10-11-collections-phase2-ui-validation.md`; `docs/handoffs/2026-10-12-collections-phase-3-integration-prep.md` |
| COL-DEP-12 | TAP Hub repository | Project owner | Review tracked historical credential-bearing migration source and determine credential rotation/history cleanup actions before broader branch sharing. | OWNER ACTION REQUIRED; excluded from local test setup; no credential values copied | `supabase/migrations/007_insert_credentials.sql` |
| COL-DEP-13 | Collections Phase 2 | Engineer A + Engineer B | Incorporate local identity/Auth harness, shared stage types and server-derived progression, firm-timezone display, configurable Owner/Admin rules, and remembered primary-contact selection. | Pushed through `53324a7`; integrated rerun PASS. H4/H5/H6 harness fixes and S1 Contacts read gate are now proposed in the prep branch; validation pending. Hosted DB remains untouched. | Phase 2 handoff and current Phase 3 prep handoff |

## Merge queue

| Order | Branch | Owner | Required before merge | Status |
| --- | --- | --- | --- | --- |
| 1 | `codex/tap-hub-delivery-playbook` | Codex documentation setup | Project-owner review | Waiting |
| 2 | `codex/collections-phase-0` | Claude Code | Merge of order 1; project-owner review | Waiting |

## Next coordination event

Complete joint review/sign-off of Phase 2 and merge in the agreed order: backend integration first, then UI branch. Resolve the separate S1 anonymous Contacts API exposure before release. In parallel, review the Phase 3 draft, record owner decisions P3-D1–D8, and obtain Engineer A/B contract approval before implementation. Address H4/H5 harness gaps as Phase 3 prep. Hosted migrations remain deferred until integrated review and explicit release approval; shared-password rotation and historical credential migration review remain owner actions. Phase 2 uses TAP Hub Billing only; QuickBooks is out of scope. Production email delivery remains disabled. Do not merge to `main` until planned phase gates and separate security decisions are complete.
