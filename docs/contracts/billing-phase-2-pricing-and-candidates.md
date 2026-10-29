# Billing Phase 2: pricing and billable candidates

State: **Draft preparation — not approved for implementation.**

This document turns the frozen Phase 0 foundation into an implementation-ready Phase 2 boundary. It does not authorize a migration, route, hosted change, or UI implementation. The frozen foundation contract remains controlling where the two documents overlap.

## Purpose and dependency gates

Phase 2 delivers one coherent release: rate cards and effective-dated rates; client-service overrides and bundles; recurring and completion-triggered candidates; candidate pricing/deduplication/lifecycle; and atomic draft creation with line provenance.

It excludes the Phase 3 workbench, remittance settings, manual payment/reconciliation UI, external delivery, payment processing, bank feeds, and QuickBooks API/OAuth.

| Gate | Owner | Required state before implementation |
| --- | --- | --- |
| Phase 1 native-ledger release evidence | Engineer B + Engineer A | Local migration, authorization, RLS, audit, API, and UI integration evidence accepted. `73f4d2a` is a backend handoff, not yet a release claim. |
| Dynamic completion-source configuration | Engineer B | Phase 2 persists an editable, audited client-service map. It starts empty for unmapped services; it is not hard-coded from the demo or seeded from real client data. |
| Contract freeze | Both engineers + project owner | Schema, endpoint shapes, policy actions, and error codes accepted before UI/API implementation. |
| Fixture consumption | Engineer B | The Phase 1 synthetic Operations fixtures are used by candidate tests; no real Operations, payment, or A/R data is used. |

## Non-negotiable rules

- Billing owns native prices, candidate state, draft provenance, and ledger values. Collections and Client 360 consume read models only.
- Store money as database `numeric`; transport decimal strings or integer cents; never calculate money with JavaScript floating point.
- A candidate is not an invoice. Only the draft-creation transaction may claim `open` candidates.
- Candidate identity is database-unique: `client_service_id` + candidate type + schedule-occurrence key or Operations completion-event identifier.
- Resolve price at candidate date: active client bundle; active client-service override; active matching rate-card entry. No match becomes `unpriced` and cannot become a draft.
- Draft lines snapshot resolved price and provenance. Later price changes never rewrite drafts or issued invoices.
- Bundle lines retain every component candidate through a junction relation.
- Deleting a linked draft or voiding a linked invoice restores candidates to `open` in the same audited transaction.
- Server authorization, RLS, audit, and database uniqueness/invariants are enforceable boundaries; UI hiding is not authorization.

## Proposed data boundary for review

Names below are planning placeholders until the contract is frozen.

| Concern | Proposed records | Required protection |
| --- | --- | --- |
| Rate configuration | `billing_rate_cards`, `billing_rate_card_entries` | Effective-date ranges cannot overlap for the same identity; inactive rows never resolve a price. |
| Client price configuration | `billing_client_service_overrides`, `billing_bundles`, `billing_bundle_components` | Applicability is client/service scoped, date effective, auditable, and cannot mutate historical lines. |
| Candidate lifecycle | `billing_candidates` | Unique source identity, transition checks, dismissal/reopen audit, and no claim of `unpriced` or non-`open` rows. |
| Draft provenance | `billing_candidate_line_links` | One candidate has one active draft claim; a package line may link many candidates; issued provenance is immutable. |
| One-off source configuration | `billing_completion_source_maps` | Explicit allowed Operations source, effective date, editable predicate, audit history, and no retroactive rewrite of generated candidates. Unmapped services are excluded. |

## Candidate lifecycle

| State | Meaning | Allowed transition |
| --- | --- | --- |
| `unpriced` | Source exists but no active price resolved. | Reprice to `open`; dismiss. |
| `open` | Price resolved and available for an atomic draft claim. | Draft, dismiss, reprice. |
| `drafted` | Claimed by one draft through provenance links. | Return to `open` only when that draft is deleted. |
| `dismissed` | Authorized user excluded it with an auditable reason. | Authorized reopen to `open` or `unpriced`. |
| `invoiced` | Linked invoice issued. | Correction uses void/reissue, which returns it to `open`. |

Generators return an existing candidate or a stable duplicate result; they never silently overwrite an identity.

## Draft API boundary to freeze

| Capability | Draft server boundary | Initial authorization |
| --- | --- | --- |
| Pricing reads | `GET /api/billing/rate-cards`, `GET /api/billing/client-pricing` | `pricing.view`; Collections-only responses exclude price-bearing fields. |
| Pricing writes | `POST/PATCH /api/billing/pricing/...` | `pricing.manage`. |
| Candidate reads/lifecycle | `GET /api/billing/candidates`, `POST /api/billing/candidates/[id]/dismiss`, `POST /api/billing/candidates/[id]/reopen` | `candidates.view` / `candidates.manage`. |
| Candidate generation | Audited RPC behind `POST /api/billing/candidates/generate` | `candidates.manage`; client-service/date scoped and idempotent. |
| Draft creation | Audited `create_draft_from_candidates` RPC behind `POST /api/billing/invoices/from-candidates` | `invoices.draft.manage`; one transaction claims rows, creates lines/links, and audits. |

Every error remains `{ error, code }`. Draft creation returns a complete server-calculated draft, lines, linked candidate identifiers, and refresh targets. It accepts no client-calculated amount. `CANDIDATE_NOT_OPEN` and `CANDIDATE_UNPRICED` are `409` conflicts.

## Dynamic one-off completion-source configuration

The owner approves a **dynamic, modular configuration model**. The firm can add or change a completion rule as services are onboarded; Phase 2 must not hard-code a source map from this demo or any initial client list.

Each configuration record is owned by an authorized Billing administrator and has an effective start date, optional effective end date, enabled state, creator/updater audit actor, and a change reason. An edit applies only to future, not-yet-generated occurrences. It never rewrites an existing candidate, draft line, invoice, or provenance link.

The configuration UI belongs with the Phase 3 Billing workbench. Phase 2 must nevertheless provide the server data model, read/write contract, validation, and synthetic fixtures so that UI can be added without a schema rewrite.

The permitted source adapters are deliberately bounded to Operations facts shown by the demo: service cadence/schedule occurrence, `work_periods` that reach `done`, `period_counts` that meet a configured threshold, and audited manual confirmation. A configuration chooses one adapter and declares its predicate; it cannot execute arbitrary queries or inspect unrelated Operations data.

| Client service | Billing service | Operations source adapter | Completion predicate | Occurrence/event identifier | Candidate date rule | Effective dates / reason |
| --- | --- | --- | --- | --- | --- | --- |
| _configured by firm_ | _configured by firm_ | schedule, done work period, count threshold, or manual confirmation | _validated configuration_ | _stable source identity_ | service-period end, completion date, or configured rule | _required_ |

An unmapped or disabled service produces no candidate. Manual confirmation must identify its authorized actor, source note, and effective date; it cannot create a duplicate candidate.

### Dynamic configuration API to freeze

`GET /api/billing/completion-source-maps` returns current and historical map records according to `candidates.view`. `POST/PATCH /api/billing/completion-source-maps` requires `candidates.manage`, validates the allowed adapter/predicate schema, records the actor and reason, and returns the effective configuration. A change never silently regenerates candidates; generation remains an explicit audited operation.

The demo is a workflow reference, not production configuration. Its examples—recurring Financials/Payroll/Sales Tax, filing completion, 1099 counts, service cadence, and Operations `Done` status—inform the allowed adapter types above without prescribing any client's actual rule.

## Configuration checklist for the firm

When the firm starts using Billing, an authorized Billing administrator completes this configuration for each one-off billable client service:

| Client service | Billing service | Operations evidence source | Completion predicate | Occurrence/event identifier | Candidate date | Notes/exclusions |
| --- | --- | --- | --- | --- | --- | --- |
| _configured by firm_ | _configured by firm_ | allowed adapter | validated rule | stable identity | date rule | effective dates and change reason |

## Evidence and ownership

| Layer | Required local synthetic evidence |
| --- | --- |
| Database | Effective-date non-overlap, source deduplication, transitions, concurrent draft claim, provenance, void/delete return behavior, RLS, audit actor. |
| API | Authentication, action-policy matrix, Collections price redaction, error/status mappings, decimal formatting, idempotent generation, no client totals. |
| Fixtures | Recurring service, precedence cases, completed/incomplete one-off sources, unmapped service. |
| UI | Owner, delegated Billing staff, Billing staff without pricing manage, Collections-only, and unassigned sessions after endpoint freeze. |
| Cross-module | Native issued-ledger rows flow to Collections; Collections never reads candidate configuration or writes Billing values. |

Engineer B owns migrations, billing APIs, access/audit code, and local fixtures. Engineer A owns Billing UI and UI tests, including the later Phase 3 configuration screens, but does not implement against draft shapes. Both engineers own the contract, handoff, and integrated validation.

No hosted migration, production write, provider, bank, payment, or credential-bearing system is in scope.
