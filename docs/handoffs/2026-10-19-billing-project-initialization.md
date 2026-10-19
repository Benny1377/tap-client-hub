# Handoff: Billing Project Initialization

| Field | Value |
| --- | --- |
| Milestone | Billing planning and initialization |
| Branch | `codex/billing-project-planning` |
| Base | `codex/collections-phase4-backend` at `202cba1` |
| Contract | `docs/contracts/billing-project-foundation.md` — Draft, owner decisions approved |
| Decision | `docs/decisions/2026-10-19-billing-project-foundation.md` — Approved |
| Implementation status | Documentation only |

## Required reading

1. `AGENTS.md`.
2. `docs/coordination/CURRENT_WORK.md` and `docs/coordination/BILLING_PROJECT.md`.
3. Billing decision and foundation contract.
4. Existing Collections Phase 1 and Phase 4 contracts.
5. Target-branch migration, route, UI, and test inventory before writing code.

## Required Phase 0 action

Perform a read-only comparison before implementation: identify exact base commit; inventory Billing tables/functions/routes/UI/types/tests; compare branch ancestry and reusable commits; confirm deterministic forward-only migration order; return path ownership and merge sequence. Do not write code until both engineers accept this plan.

## Safety boundary

The prototype is not production code. A/R Intake never mutates native Billing. No deployment, hosted migration, real client data, real A/R PDF, payment instruction, credential, or bank access is authorized by this handoff.

## Consumer acknowledgement

Confirm target branch/commit, owned paths, contract state, API dependencies, local test setup, and blockers in a dated follow-up handoff or contract review record.
