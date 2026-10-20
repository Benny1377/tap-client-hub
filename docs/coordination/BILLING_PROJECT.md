# TAB-HUB Billing Project Register

Status: **Initialized for planning** on 2026-10-19. This register authorizes no implementation, migration, deployment, commit, or external change.

## Source-of-truth order

1. Approved decisions and frozen Billing contracts.
2. Forward-only migrations and database invariants.
3. Server routes/RPCs and access policy.
4. Billing UI and read models.
5. `practiceops_1.html` prototype behavior where it does not conflict with the above.

## Verified starting state

| Item | Evidence | Classification |
| --- | --- | --- |
| Prototype | Local `practiceops_1.html` | Workflow reference only |
| Integration baseline | `codex/security-fixes` at `6859607` contains the Phase 4 backend history and integrated UI history; the Billing planning branch merges cleanly | Selected Phase 0 base; hosted/release state remains unverified |
| A/R Intake | Phase 4 contract keeps approved PDF data separate from the native ledger | Collections source, not Billing writeback |

## Approved decisions

- Rate card, client override, bundle, and effective-date pricing.
- Configurable recurring and service-completion candidate triggers.
- Owner/Admin-managed permission policy with non-bypassable security and ledger controls.
- `TAP-YYYY-####` issue-RPC numbering, Net 15 default terms with client override, recurring billing on the final configured service-period day with client/service override.
- Firm date/timezone is Houston, Texas (`America/Chicago`) through the existing `collection_settings.timezone` setting.
- Firm remittance instructions snapshot at invoice issuance; no bank credentials, and no values in audit/error logs.
- Reviewed, source-provenanced A/R Intake distinct from native Billing.

## Work lanes

| Lane | Proposed owner | Scope | Handoff gate |
| --- | --- | --- | --- |
| Integration baseline | Engineer B | Reconcile ancestry and reusable schema/routes/tests | Both engineers accept inventory and merge sequence |
| Ledger/access | Engineer B | Phase 1 schema/RPC/RLS/audit/access validation | Backend handoff with synthetic evidence |
| Pricing/candidates | Engineer B | Phase 2 data model and API | Frozen API contract before UI work |
| Workbench | Engineer A | Phase 3 pricing/candidate/invoice/payment/remittance UI | UI/API compatibility handoff |
| Cross-module validation | Engineer A + Engineer B | Billing ↔ Collections ↔ Client 360 consistency | Integrated local UI/API/database evidence |

## Dependencies

| ID | Owner | Status | Requirement |
| --- | --- | --- | --- |
| BILL-DEP-01 | Both engineers | Approved | Use `codex/security-fixes` at `6859607`; record exact UI ancestry in the Phase 0 review before implementation |
| BILL-DEP-02 | Project owner + client | Open | Define service-to-completion-event configuration before the one-off portion of the single Phase 2 delivery |
| BILL-DEP-03 | Engineer B | Open | Verify authorization, RLS, audit, and migrations locally before Phase 1 release claim |
| BILL-DEP-04 | Engineer A + Engineer B | Pending acknowledgement | Owner approved every Phase 0 gap resolution on 2026-10-20; Engineer A records final freeze acknowledgement |
| BILL-DEP-05 | Project owner | Deferred | Any hosted migration, production write, provider, processor, or bank feed |
| BILL-DEP-06 | Engineer B | Open | Add synthetic Operations service, schedule, and completion fixtures before Phase 2 validation |

## Operating rules

- Use isolated feature branches/worktrees with one implementation owner per path.
- Do not duplicate migrations, routes, or UI before Phase 0 proves them absent from the selected base.
- Use synthetic local Supabase data only, recording command, commit, environment, result, and limitation.
- A phase is complete only after contract, handoff, and relevant integrated validation—not when code is merely written.
