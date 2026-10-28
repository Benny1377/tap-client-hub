# TAP Client Hub Current Work

## Current Collections status (updated 2026-10-18)

- The owner reports Phase 4's revised A/R PDF intake contract has Engineer A approval. The approved decisions are recorded in `docs/contracts/collections-phase-4-ar-pdf-intake.md` and `docs/contracts/collections-phase-3-source-identity-addendum.md`.
- Phase 4 backend review fixes are pushed at `2ccdd6c` on `codex/collections-phase4-backend`. Engineer A's integrated rerun and a Vercel preview PDF-worker smoke check remain before backend/UI sign-off. No hosted migration or real PDF import has occurred.
- Phase 1/2 and delivery-disabled Phase 3 are treated as complete for now. Provider-backed test sending remains deferred to the end of delivery; live sending is not authorized.
- Phase 4 includes private PDF storage, upload/review/approval/access-audit APIs, explicit client linking, stale-snapshot guards, source-aware holds/events/history, and PDF-selected worklist/preview data. Follow-up review status is in `docs/handoffs/2026-10-18-collections-phase4-backend.md`.
- Use synthetic fixtures only. The owner's supplied real AR PDFs must remain out of Git, screenshots, test databases, and shared non-production environments. Hosted migrations remain deferred.

## Billing project planning (initialized 2026-10-19)

- Billing planning is isolated on `codex/billing-project-planning`. Its Phase 0 foundation is frozen as of 2026-10-24 after Engineer A accepted `7ecaee6` without objection (`efc8be2`).
- The next Billing dependencies are BILL-DEP-03 (Engineer B's local Phase 1 authorization/RLS/audit/migration validation) and BILL-DEP-06 (synthetic Operations fixtures before Phase 2 validation). BILL-DEP-02 remains open only for the one-off portion of Phase 2.
- Artifacts: `docs/decisions/2026-10-19-billing-project-foundation.md`, `docs/contracts/billing-project-foundation.md`, `docs/coordination/BILLING_PROJECT.md`, and `docs/handoffs/2026-10-19-billing-project-initialization.md`.

Last updated: 2026-10-24 Asia Kolkata

Updated by: Codex (Phase 4 backend review fixes; Billing Phase 0 freeze)

## Shared baseline

- Stable branch: `main`
- Fetched production baseline: `210a08a2c02215f523acd511c1fb696ac551d393` (re-fetched 2026-10-06; unchanged)
- Verified Vercel deployment: NOT VERIFIED
- Active milestones:
  - M0 Stable ownership;
  - Collections Phase 0 (read-only discovery), complete.
  - Collections Phase 1 (Billing ledger), backend review fixes pushed; integrated UI validation remains open.
  - Collections Phase 2 backend, synthetic local harness, and UI/API/database validation, in progress; QuickBooks explicitly out of scope.
- Overall status: Backend integration `3bec72a` restores the reviewed `20261010140000` migration and regression test, adds the owner-approved reminder catch-up migration `20261011100000`, and adds an isolated synthetic Supabase harness. Engineer A's pushed validation branch `codex/collections-phase2-ui-validation` (`3013b12`) includes the Phase 1/2 UI, local Auth setup, fixes from a real browser pass, and a reported passing end-to-end check against backend `3bec72a`. Producer follow-ups H1/H2/T1/A1/A2 are implemented locally in the integration and UI-validation worktrees; all SQL, UI unit/render, type, lint, and build checks pass. The browser/API/database pass must be rerun against these changes before the updated integration is complete. Hosted migration state remains unverified. No production email delivery is authorized.

## Active branches

| Branch | Owner | Scope | Base commit | Status | Merge gate |
| --- | --- | --- | --- | --- | --- |
| `codex/tap-hub-delivery-playbook` | Codex documentation setup | Initial delivery playbook and coordination structure | `210a08a2c02215f523acd511c1fb696ac551d393` | Ready for review | Project-owner approval |
| `codex/collections-phase-0` | Claude Code | Collections Phase 0 discovery, hosted schema evidence, decision record, frozen Phase 1 contract, handoff. Documentation only. | `c259a6edf871b43a0aa2ad0d11cb73dfd8f82653` (stacked on the playbook branch) | Complete | Project-owner review |
| `codex/collections-phase-1-billing-ledger` | Codex | Phase 1 Billing ledger and backend review fixes. | `ded69a3` | Backend fixes pushed at `e2df16e`; owner reports migration applied; UI integration validation pending | Review handoff `docs/handoffs/2026-10-10-collections-phase-1-review-fixes.md`; integrated UI/backend validation and release gates |
| `codex/collections-ui` | Claude Code (Engineer A track) | Billing and Collections UI for Phase 1, continuing into Phase 2 on top of the Phase 2 backend. Replaces `codex/collections-phase-1-ui` (8438039), which was based on the older ledger head. No backend changes. | `0e01c19` (`codex/collections-phase-2-backend`) | Phase 1 UI ready for review; Phase 2 UI not started | Phase 2 backend merged first; Engineer A contract approval; non-production database and browser validation |
| `codex/collections-phase-2-ui` | Claude Code (Engineer A track) | Phase 1 UI completion (firm date, invoice-scoped requests, notice-sent recording, payment remaining amounts, client aging, hold scope) and Phase 2 UI (AR insights, priority call list, automation preview). No backend changes. | `50b886a` (`codex/collections-ui`) | Ready for review; Engineer A approval of the Phase 2 contract recorded with one condition | Phase 2 backend merged first; client-level stage fix; password rotation; non-production database and browser validation |
| `codex/collections-phase-2-backend` | Codex | Billing-backed Collections read model and safe automation backend. | `e2df16e` (`codex/collections-phase-1-billing-ledger`) | Base implementation pushed at `292de5c`; developer review fixes in progress locally; Engineer A contract review pending | Engineer A API review, Phase 1 integrated release gates, Phase 2 non-production database/UI validation |
| `codex/collections-phase2-integration` | Codex | Phase 2 backend, local harness, dynamic Owner/Admin rules, and remembered primary-contact selection. | `0e01c19` (`origin/codex/collections-phase-2-backend`) | Pushed at `53324a7`; local SQL/API-contract/type/lint/build checks pass; hosted DB untouched | Engineer A contract review and integrated rerun; no main merge or hosted migration yet |
| `codex/collections-phase2-ui-validation` | Engineer A + Codex | Phase 1/2 UI, browser validation, contract/timezone updates, and configurable rules editor. | `3bec72a` (`codex/collections-phase2-integration`) | Pushed `64f1c1e` (backend through `53324a7`); Engineer A integrated rerun PASS on 2026-10-11: SQL suites, 68/68 API/DB/audit, browser; UI fixes UI-C/UI-D plus contact-review label committed on top | Producer review of H4/H5 (harness), H6/A3 (low); S1 owner decision; joint sign-off |

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
| COL-DEP-08 | Collections Phase 2 | Engineer A + Engineer B | Complete Phase 1 integrated UI/backend validation before Phase 2 release. | OPEN | Phase 1 handoff and test evidence |
| COL-DEP-09 | Collections Phase 2 | Project owner + client | Confirm ladder copy/timing, limits, sender/test recipient, contact selection, and production-send approval. | Owner decisions recorded: ladder/guardrails remain rule-driven; default to primary contact and pause for ambiguous contact until an authorized editor selects and saves one; Owner/Admin approval for owner-level stages; sender/test recipient and any real sending deferred to integrations. Production sending remains disabled. | Phase 2 contract and current owner decision |
| COL-DEP-10 | Collections Phase 1 | Project owner | Rotate the exposed shared Supabase Auth password for affected users and review existing sessions. | OWNER ACTION REQUIRED before Phase 1 sign-off; application hash guard does not block direct Supabase Auth login | `docs/decisions/2026-10-10-supabase-shared-password-rotation.md` |
| COL-DEP-11 | Collections Phase 2 | Engineer A + Engineer B | Validate Billing/Collections in non-production. | Engineer A integrated rerun PASS on backend `53324a7` (68/68 API/DB/audit, browser incl. rules editor, firm timezone, early higher stage, contact pause); harness gaps H4/H5 pending; joint review open | `docs/handoffs/2026-10-11-collections-phase2-ui-validation.md`; `docs/handoffs/2026-10-11-collections-local-setup.md` |
| COL-DEP-12 | TAP Hub repository | Project owner | Review tracked historical credential-bearing migration source and determine credential rotation/history cleanup actions before broader branch sharing. | OWNER ACTION REQUIRED; excluded from local test setup; no credential values copied | `supabase/migrations/007_insert_credentials.sql` |
| COL-DEP-13 | Collections Phase 2 | Engineer A + Engineer B | Incorporate local identity/Auth harness, shared stage types and server-derived progression, firm-timezone display, configurable Owner/Admin rules, and remembered primary-contact selection. | Pushed through `53324a7`; Engineer A integrated rerun PASS. Contact-selection browser path blocked locally by H4/H5 (API path validated). Hosted DB remains untouched. | Updated local setup handoff; migrations `20261011110000` and `20261011120000`; rules route and UI rules panel |

## Merge queue

| Order | Branch | Owner | Required before merge | Status |
| --- | --- | --- | --- | --- |
| 1 | `codex/tap-hub-delivery-playbook` | Codex documentation setup | Project-owner review | Waiting |
| 2 | `codex/collections-phase-0` | Claude Code | Merge of order 1; project-owner review | Waiting |

## Next coordination event

Review and publish the local profile/Auth/schema/type/stage/timezone producer updates, then have Engineer A rerun the integrated suites and browser pass against the updated backend contract. Review the two feature branches jointly and preserve merge order: backend integration first, then UI branch. Hosted migration state must be confirmed through the approved read-only process before deployment. The deferred credential-material review and shared-password rotation remain owner actions. Phase 2 uses TAP Hub Billing only; QuickBooks is out of scope. Production email delivery remains disabled pending separate owner/client approval. Do not merge to `main` until all planned phases and their gates are complete.
