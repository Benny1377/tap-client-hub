# Handoff: Collections Phase 2 Backend

| Field | Value |
| --- | --- |
| Milestone | Collections Phase 2 backend (Billing-backed receivables read model and side-effect-free action preview) |
| Branch | `codex/collections-phase-2-backend` |
| Base commit | `e2df16e` (`codex/collections-phase-1-billing-ledger`) |
| Ready commit | Not committed; local working branch |
| Contract status | `docs/contracts/collections-phase-2-backend.md`: owner-authorized scope, Engineer A review pending |
| Source decision | `docs/decisions/2026-10-10-collections-source-tap-hub-billing.md`: owner-approved |

## Accepted scope

The project owner decided QuickBooks is not needed; Collections reads TAP Hub Billing directly. The backend prepares a reviewable interface ahead of UI wiring. This local slice implements the SQL read model, `GET /api/collections/receivables`, and `POST /api/collections/automation/preview`. It does not send messages, mutate invoices/payments, run a scheduler, or import historical reports.

## Product reference

The owner-provided demo illustrates AR Insights, a priority call list, invoice-level aging, a configurable five-step ladder (1/5/15-day automatic candidate touches, 21-day Owner/Admin escalation, 28-day formal-notice approval), holds, and a send-window/test-mode configuration. The sample values and wording are prototype data, not approved production defaults. First-touch timing/copy conflict in the demo and must be reconciled before live delivery.

## Safety boundaries

- No QuickBooks integration, AR import, credentials, or production configuration.
- Automation is disabled and delivery mode is `disabled`; preview returns `delivery_performed: false`. No provider or outbound message path exists in this milestone.
- Unallocated payments remain a reconciliation warning; Collections does not allocate funds.
- Phase 1 integrated validation remains a release prerequisite. The project owner reports applying Phase 1 migration `20261010110000_billing_audit_and_receivables.sql` and Phase 2 migration `20261010120000_collections_automation_foundation.sql`; this branch has not queried the hosted database to verify either report. No migration was run by this task.

## Owner/consumer actions before release

1. Engineer A reviews the new API response contract and confirms UI needs/compatibility.
2. Project owner/client approve exact ladder copy, thresholds, first-touch semantics, sender, send window, test recipient, and contact-selection rules.
3. Validate the database migration/RLS/idempotency and complete the integrated UI/backend tests in a non-production environment.
4. Production email delivery requires a separate explicit approval, verified sender configuration, observability, and disable/rollback plan.

## Implemented API behavior

- Receivables access uses the existing Billing-or-Collections read authorization, enforces UUID/date/pagination bounds, calls the database read-model RPC, and returns `no-store` responses with decimal amounts represented by the SQL function as strings.
- Preview is Owner/Admin-only and side-effect-free. It returns candidate actions and suppression reasons (active hold, unallocated-credit review, contact quality, and minimum balance); it is intentionally limited to the first 200 accounts until cursor pagination is added.
- The migration's invoice amount and allocation totals are calculated in separate aggregates to avoid row multiplication when an invoice has multiple lines and multiple payments.
- Rules CRUD, scheduled worker, provider delivery, delivery history, and integrated UI/database validation remain deferred.

## Branch state

This branch is a local worktree, not committed or pushed. It is based on Phase 1 `e2df16e` so it includes the pushed billing backend fixes. Do not merge it to `main`; follow the project's all-phases merge gate.
