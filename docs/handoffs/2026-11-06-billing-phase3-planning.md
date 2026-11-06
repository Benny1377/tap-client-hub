# Billing Phase 3 planning and readiness

| Field | Value |
| --- | --- |
| Date | 2026-11-06 |
| Planning branch | `codex/billing-phase3-planning` |
| Base | `codex/billing-phase2-prep` at `d9cd4a6` |
| Status | Planning artifacts only; no Phase 3 UI or API implementation started |
| Contract | Draft: `docs/contracts/billing-phase-3-workbench.md` |
| Phase 2 gate | Preview hosted validation is recorded at `5735e7e`; the run passed 90 checks and skipped 3 because Collections staff credentials were rejected. Owner reset the Collections staff password and verified sign-in; rerun of the three skipped checks is pending before Phase 2 closeout. |

## Owner scope decision

On 2026-11-06, the owner approved keeping manual payment/reconciliation workflows out of Phase 3. The existing Payments and Receivables views stay as-is except for integration regression fixes. Manual payment/reconciliation has no assigned delivery phase and needs its own approved contract; it is not silently included in Phase 4.

## Verified repository inventory

- The current Billing page at `app/billing/page.tsx` exposes Invoices, Payments, and Receivables. It does not yet provide the Phase 3 candidate, schedule, pricing, or Billing settings workbench.
- Phase 2 endpoints exist in `app/api/billing/[...path]/route.ts` and the explicit invoice routes. The frozen Phase 2 contract supplies the endpoint examples, role actions, stable errors, cursors, money serialization, and refresh behavior; Phase 3 should consume those shapes rather than add a parallel server boundary.
- The invoice list, receivables, and ordinary manual invoice-line routes retain Phase 1 snake_case shapes. New Phase 2 flows are camelCase. A UI-only normalization layer is appropriate for shared presentation models; API serializers should not be changed as incidental UI work.
- The Operations adapter selects the explicit fields `id`, `client_id`, `active`, `frequency`, `financials_month`, and joined `services(code,name,tracking)`. It does not select the credential-bearing `client_services` fields visible in the schema export. Billing remains read-only toward Operations.

## Owner-provided external evidence (not independently rerun here)

- The owner supplied the actual Operations schema-only export and an aggregate-only period format result: `work_periods.period` and `period_counts.period` are text using `YYYYMM`; 2,181 and 2 rows respectively. The supplied constraints confirm the expected service foreign keys and `(client_service_id, period)` uniqueness. Billing normalizes `YYYYMM` to `YYYY-MM`.
- The owner supplied CLI output showing sandbox migrations `20261105110000` and `20261106100000` applied, with both versions matching local and remote migration history.
- Engineer A's hosted Preview validation is recorded at `docs/handoffs/2026-11-06-billing-phase2-preview-validation.md` on `codex/billing-phase2-matrix` at `5735e7e`. It reports deployment `27217c1` (Phase 2 backend `d9cd4a6`, UI draft change, and matrix tooling), sandbox identity `vuqgxotdccxivjmavsoj.supabase.co`, a successful P0 database-write confirmation, 90/90 run checks passed, and a Billing-staff browser smoke pass. A3, A4, and D8 were skipped because `collections@test.com` could not sign in. The owner reports resetting that account's password; those three checks still need to be rerun and recorded before Phase 2 closeout.
- Owner confirms the app's `Owner / Admin` role is one shared account role, so a separate Owner account is not required for this matrix.
- The owner confirmed the Vercel Preview Build Command is `npm run build` and the deployment logs show no Supabase migration step. At repository commit `f9c729f`, no checked-in migration automation was found; the only workflow is an upstream sync. Migrations are applied deliberately.
- The Preview matrix saw zero pre-existing Operations source rows in the TAB-HUB sandbox. The owner's reported 2,181 `work_periods` and 2 `period_counts` rows therefore belong to another database/schema or project not yet identified. The matrix validated `YYYYMM` using tagged synthetic Operations rows, not the reported real rows.
- The owner inspected the test Vercel project's Build Command (`npm run build`) and deployment logs, which show no Supabase migration step. At repository commit `f9c729f`, the only workflow is the hourly upstream sync and there is no checked-in migration-push command. This confirms deliberate migration application for the inspected Preview/deployment path; other Vercel projects or external deployment hooks are outside this check.

## Screen readiness and ownership

| Order | Work area | Existing server boundary | UI readiness / notes |
| --- | --- | --- | --- |
| 1 | Invoices and billable candidates | Phase 1 invoice/receivable reads; Phase 2 candidate list/lifecycle, manual and candidate draft creation, explicit issue/void/delete, line operations | Extend the existing invoice tab. Replace legacy action calls with explicit `/issue` and `/void`; support nullable draft fields and candidate provenance. Preserve the existing Payments and Receivables screens. |
| 2 | What bills next | Read-only `GET /candidates/schedule`; explicit `POST /candidates/generate` | Keep projection and generation separate. Loading/filtering must never persist candidates. |
| 3 | Clients and prices | Rate cards, entries, client overrides, bundles/components | Use opaque server cursors and server price resolution. Bundle is displayed as one package charge. `pricing.manage` is not a Billing staff default. |
| 4 | Settings and completion rules | Terms/remittance, terms overrides, permission policy, completion-source maps, manual confirmations | Dynamic and effective-dated; no client-specific demo maps are hard-coded. Protect remittance fields and the fixed Owner/Admin-only policy actions. |

Engineer A owns the Billing UI and UI tests. Engineer B owns backend/API changes if an accepted Phase 2 boundary defect is found. Both engineers own integration and cross-role verification.

## Contract-independent preparation completed

- Mapped each planned screen to the already-published Phase 2 endpoints and permissions.
- Identified the current/legacy payload normalization boundary so the UI can preserve compatibility without changing server contracts.
- Prepared role, state-transition, idempotency, cursor, timezone, amount-format, accessibility, and error-state acceptance coverage in the Phase 3 contract.
- Confirmed that no new owner-level business decision is evident from this inventory. The contract still needs Engineer A review and owner approval before it is frozen.

## Remaining gates and next actions

1. Engineer A reruns only the three skipped hosted checks (A3, A4, D8) using the owner-verified Collections staff account, then updates the Phase 2 validation record. No new synthetic client is needed for those checks.
2. Rotate all test-account passwords after the rerun because credentials were shared in chat. Keep any replacement credentials in an ignored local secret file or a secure channel, never in repository documents.
3. Record Phase 2 closeout after the three checks pass. The distinct Owner test is not a separate role requirement because the app models Owner/Admin as one role.
4. Engineer A reviews this Phase 3 contract against the frozen Phase 2 shapes; both engineers and the owner record the freeze before UI implementation begins.
5. Begin Phase 3 UI implementation in the listed order, on an implementation branch/worktree distinct from Phase 2 validation. No further owner scope decision is currently needed.

This planning handoff makes no new hosted database writes, account changes, deployment, migration execution, or UI implementation. Hosted checks and sandbox writes are documented from Engineer A's validation record; they were not rerun as part of this planning update.
