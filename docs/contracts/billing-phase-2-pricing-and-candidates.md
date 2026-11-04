# Billing Phase 2: pricing and billable candidates

State: **Owner-approved contract revision with clarifications recorded — awaiting Engineer A's re-acknowledgement; not yet frozen for implementation. Operations adapters remain gated on authoritative schema evidence.**

This document turns the frozen Phase 0 foundation into an implementation-ready Phase 2 boundary. It does not authorize a migration, route, hosted change, or UI implementation. The frozen foundation contract remains controlling where the two documents overlap.

## Purpose and dependency gates

Phase 2 delivers one coherent release: rate cards and effective-dated rates; client-service overrides and bundles; recurring and completion-triggered candidates; candidate pricing/deduplication/lifecycle; atomic draft creation with line provenance; and the server-side issue/void/delete transitions required to keep candidate state correct.

It excludes the Phase 3 workbench and configuration screens, manual payment/reconciliation UI, external delivery, payment processing, bank feeds, and QuickBooks API/OAuth. Phase 2 provides the server-side terms/remittance records and invoice snapshot needed by the issue RPC; Phase 3 presents their settings UI.

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
- A bundle renders as one package `invoice_lines` row with quantity `1` and unit amount equal to the resolved package price. Component candidates remain provenance only: their individual amounts are not shown on the invoice and are never used to recompute the package amount.
- Deleting a linked draft or voiding a linked invoice restores candidates to `open` in the same audited transaction.
- Candidate-linked draft lines cannot change their quantity, unit amount, amount, or provenance. Removing a candidate-linked draft line atomically returns its linked candidates to `open`; ordinary manual draft lines remain editable under the Phase 1 invariants.
- Server authorization, RLS, audit, and database uniqueness/invariants are enforceable boundaries; UI hiding is not authorization.
- A draft invoice has `invoice_number`, `issue_date`, and `due_date` all `null`. The corresponding database columns must become nullable. Draft creation does not accept or require client-supplied values for these fields. The issue RPC assigns the number and firm issue date and calculates the due date from the effective terms in one transaction.

## Proposed data boundary for review

Names below are planning placeholders until the contract is frozen.

| Concern | Proposed records | Required protection |
| --- | --- | --- |
| Rate configuration | `billing_rate_cards`, `billing_rate_card_entries` | Effective-date ranges cannot overlap for the same identity; inactive rows never resolve a price. |
| Client price configuration | `billing_client_service_overrides`, `billing_bundles`, `billing_bundle_components` | Applicability is client/service scoped, date effective, auditable, and cannot mutate historical lines. |
| Candidate lifecycle | `billing_candidates` | Unique source identity, transition checks, dismissal/reopen audit, and no claim of `unpriced` or non-`open` rows. |
| Draft provenance | `billing_candidate_line_links` | One candidate has one active draft claim; a package line may link many candidates; issued provenance is immutable. |
| One-off source configuration | `billing_completion_source_maps` | Explicit allowed Operations source, effective date, editable predicate, audit history, and no retroactive rewrite of generated candidates. Unmapped services are excluded. |
| Billing policy | `billing_action_policy` | One action-policy record; resolver combines authenticated identity, module assignment, and allowed actions. `policy.manage`, `invoices.void`, and `payments.reverse` always resolve to Owner/Admin and cannot be delegated. |
| Terms, billing day, and remittance | `billing_terms_settings`, client/client-service effective overrides, `billing_remittance_settings` | Net 15 and final service-period day are defaults; overrides are effective-dated/audited. A client-service terms override takes precedence over a client override, which takes precedence over the firm default. The issue RPC snapshots remittance text only—never credentials—onto the invoice. |
| Issue sequencing | invoice nullable number migration and an issue-year sequence | The atomic issue RPC assigns `TAP-YYYY-####`; voided numbers are never reused. |

## Candidate lifecycle

| State | Meaning | Allowed transition |
| --- | --- | --- |
| `unpriced` | Source exists but no active price resolved. | Reprice to `open`; dismiss. |
| `open` | Price resolved and available for an atomic draft claim. | Draft, dismiss, reprice. |
| `drafted` | Claimed by one draft through provenance links. | Return to `open` only when that draft is deleted. |
| `dismissed` | Authorized user excluded it with an auditable reason. | Authorized reopen to `open` or `unpriced`, with a non-empty audited reason. |
| `invoiced` | Linked invoice issued. | Correction uses void/reissue, which returns it to `open`. |

Generators return an existing candidate or a stable duplicate result; they never silently overwrite an identity.

## Frozen server boundary

| Capability | Draft server boundary | Initial authorization |
| --- | --- | --- |
| Effective permissions | `GET /api/billing/permissions` | Any authenticated Billing user; response is presentation-only and carries resolved fixed action keys. |
| Rate cards | `GET/POST /api/billing/rate-cards`, `GET/PATCH /api/billing/rate-cards/[id]`, `POST /api/billing/rate-cards/[id]/entries`, `PATCH /api/billing/rate-cards/[id]/entries/[entryId]` | `pricing.view` for reads; `pricing.manage` for writes. |
| Client prices and bundles | `GET /api/billing/client-pricing?clientId=`, `POST/PATCH /api/billing/client-pricing/overrides[/id]`, `GET/POST /api/billing/bundles`, `GET/PATCH /api/billing/bundles/[id]`, `PUT /api/billing/bundles/[id]/components` | `pricing.view` for reads; `pricing.manage` for writes. |
| Terms and remittance | `GET /api/billing/settings/terms`, `PATCH /api/billing/settings/terms`, `POST/PATCH /api/billing/settings/terms/overrides[/id]`, `GET /api/billing/settings/remittance`, `PATCH /api/billing/settings/remittance` | `settings.terms.manage` or `settings.remittance.manage` for writes; Owner/Admin initial defaults. |
| Candidate reads/lifecycle | `GET /api/billing/candidates?clientId=&state=&from=&to=&cursor=`, `POST /api/billing/candidates/[id]/dismiss`, `POST /api/billing/candidates/[id]/reopen`, `POST /api/billing/candidates/[id]/reprice` | `candidates.view` / `candidates.manage`. |
| What bills next | `GET /api/billing/candidates/schedule?from=&to=&clientId=` | `candidates.view`; read-only projection, clearly marked `projected`, never creates or changes candidates. |
| Candidate generation | Audited RPC behind `POST /api/billing/candidates/generate` | `candidates.manage`; client-service/date scoped and idempotent. |
| Draft creation | Audited `create_draft_from_candidates` RPC behind `POST /api/billing/invoices/from-candidates`; empty/manual drafts use `POST /api/billing/invoices` | `invoices.draft.manage`; one transaction claims rows, creates lines/links, and audits. |
| Issue, delete, and void | `POST /api/billing/invoices/[id]/issue`, `DELETE /api/billing/invoices/[id]`, `POST /api/billing/invoices/[id]/void` | `invoices.issue`, `invoices.draft.manage`, and Owner/Admin-only `invoices.void`; all candidate-aware audited RPCs. |

### Transition compatibility

Phase 2 canonical request and response fields use `camelCase`. The existing `POST /api/billing/invoices/[id]` action form remains temporarily as a deprecated compatibility adapter while the Billing UI moves to `/issue` and `/void`. It must call the same authorization checks and candidate-aware audited RPCs; it must not retain a separate mutation implementation. For compatibility with the Phase 1 UI, its response retains the existing Phase 1 `snake_case` serialization (including fields such as `client_id`, `invoice_number`, and `void_reason`); it does not expose the Phase 2 canonical response serializer. The adapter is removed after the UI has moved to the explicit endpoints and a repository search confirms no remaining caller. The explicit endpoints and all other Phase 2 routes use canonical `camelCase`.

Deleting a candidate-linked draft line uses the existing `DELETE /api/billing/invoice-lines` route with the line ID in its request body. On success the response includes `returnedCandidateIds` and `refresh: ["invoice", "candidates", "receivables"]`; the transaction returns those candidates to `open`. `PATCH /api/billing/invoice-lines` for a candidate-linked line returns `409 CANDIDATE_LINKED_LINE_IMMUTABLE`. The database transition remains authoritative; the route response does not replace it.

### Permission response and initial defaults

`GET /api/billing/permissions` returns exactly the normalized role, assigned modules, and the resolved fixed action keys, with no price data:

```json
{
  "role": "staff",
  "modules": ["Billing"],
  "actions": ["billing.view", "pricing.view", "candidates.view", "candidates.manage", "invoices.draft.manage", "invoices.issue", "payments.record", "payments.allocate"]
}
```

Owner and Admin resolve all fixed actions, including `policy.manage`, `invoices.void`, and `payments.reverse`. Assigned Billing staff default to `billing.view`, `pricing.view`, `candidates.view`, `candidates.manage`, `invoices.draft.manage`, `invoices.issue`, `payments.record`, and `payments.allocate`; `pricing.manage` is not enabled by default. Owner/Admin may grant other delegable actions through the policy record, except the three fixed Owner/Admin-only actions. Collections-only and unassigned users receive `403` from this endpoint and all Phase 2 price/candidate/settings endpoints. A user assigned both Billing and Collections follows the Billing policy for Billing endpoints. The server recomputes every action; this response is not an authorization token.

### Request and response shapes (synthetic examples)

All paths below are relative to `/api/billing`. UUIDs, client labels, prices, and dates are synthetic. All monetary values are decimal strings. Omitted optional fields are server defaults; unknown or client-derived monetary fields are rejected. `GET` requests have no body. Success response bodies are shown; all failures use `{ "error": "...", "code": "..." }` with the status table below.

Shared resource examples:

```json
{
  "rateCard": {"id":"rc_01","name":"Standard","currency":"USD","active":true,"effectiveFrom":"2026-11-01","effectiveTo":null},
  "rateEntry": {"id":"re_01","serviceCode":"TAX","unit":"return","unitAmount":"125.00","effectiveFrom":"2026-11-01","effectiveTo":null},
  "override": {"id":"ov_01","clientServiceId":"cs_01","unitAmount":"115.00","effectiveFrom":"2026-11-01","effectiveTo":null,"reason":"Approved client rate"},
  "bundle": {"id":"bu_01","name":"Monthly package","clientId":"client_01","unitAmount":"300.00","effectiveFrom":"2026-11-01","effectiveTo":null,"components":[{"clientServiceId":"cs_01"},{"clientServiceId":"cs_02"}]},
  "candidate": {"id":"ca_01","clientId":"client_01","clientServiceId":"cs_01","state":"open","candidateType":"recurring","candidateDate":"2026-11-30","description":"Monthly bookkeeping","unitAmount":"125.00","source":{"adapter":"schedule","identity":"cs_01:2026-11"}},
  "draft": {"id":"inv_01","clientId":"client_01","status":"draft","invoiceNumber":null,"issueDate":null,"dueDate":null,"lines":[{"id":"line_01","description":"Monthly bookkeeping","quantity":"1.0000","unitAmount":"125.00","amount":"125.00","candidateIds":["ca_01"]}]}
}
```

| Endpoint | Request (query/body) | Synthetic success response |
| --- | --- | --- |
| `GET /permissions` | none | `{"role":"staff","modules":["Billing"],"actions":["billing.view","pricing.view","candidates.view","candidates.manage","invoices.draft.manage","invoices.issue","payments.record","payments.allocate"]}` (default Billing-staff actions; `pricing.manage` is excluded unless Owner/Admin grants it) |
| `GET /rate-cards` | query: `active`, `cursor`, `limit` (limit default 50, max 100) | `{"items":[{"id":"rc_01","name":"Standard","currency":"USD","active":true}],"nextCursor":null}` |
| `POST /rate-cards` | `{"name":"Standard","currency":"USD","effectiveFrom":"2026-11-01"}` | `201 {"rateCard":{"id":"rc_01","name":"Standard","currency":"USD","active":true,"effectiveFrom":"2026-11-01","effectiveTo":null}}` |
| `GET /rate-cards/rc_01` | none | `{"rateCard":{"id":"rc_01","name":"Standard","currency":"USD","active":true},"entries":[]}` |
| `PATCH /rate-cards/rc_01` | `{"name":"Standard 2027","active":true,"reason":"Annual refresh"}` | `{"rateCard":{"id":"rc_01","name":"Standard 2027","currency":"USD","active":true}}` |
| `POST /rate-cards/rc_01/entries` | `{"serviceCode":"TAX","unit":"return","unitAmount":"125.00","effectiveFrom":"2026-11-01"}` | `201 {"entry":{"id":"re_01","serviceCode":"TAX","unit":"return","unitAmount":"125.00","effectiveFrom":"2026-11-01","effectiveTo":null}}` |
| `PATCH /rate-cards/rc_01/entries/re_01` | `{"unitAmount":"130.00","effectiveTo":"2027-10-31","reason":"Annual update"}` | `{"entry":{"id":"re_01","unitAmount":"130.00","effectiveTo":"2027-10-31"}}` |
| `GET /client-pricing?clientId=client_01` | none | `{"clientId":"client_01","overrides":[{"id":"ov_01","clientServiceId":"cs_01","unitAmount":"115.00","effectiveFrom":"2026-11-01","effectiveTo":null}],"bundles":[]}` |
| `POST /client-pricing/overrides` | `{"clientServiceId":"cs_01","unitAmount":"115.00","effectiveFrom":"2026-11-01","reason":"Approved client rate"}` | `201 {"override":{"id":"ov_01","clientServiceId":"cs_01","unitAmount":"115.00","effectiveFrom":"2026-11-01","effectiveTo":null}}` |
| `PATCH /client-pricing/overrides/ov_01` | `{"unitAmount":"120.00","effectiveTo":"2027-10-31","reason":"Renewal"}` | `{"override":{"id":"ov_01","unitAmount":"120.00","effectiveTo":"2027-10-31"}}` |
| `GET /bundles` | query: `clientId`, `active`, `cursor`, `limit` | `{"items":[{"id":"bu_01","name":"Monthly package","clientId":"client_01","unitAmount":"300.00","components":[{"clientServiceId":"cs_01"}]}],"nextCursor":null}` |
| `POST /bundles` | `{"name":"Monthly package","clientId":"client_01","unitAmount":"300.00","effectiveFrom":"2026-11-01","reason":"Package setup"}` | `201 {"bundle":{"id":"bu_01","name":"Monthly package","clientId":"client_01","unitAmount":"300.00","effectiveFrom":"2026-11-01","effectiveTo":null,"components":[]}}` |
| `GET /bundles/bu_01` | none | `{"bundle":{"id":"bu_01","name":"Monthly package","clientId":"client_01","unitAmount":"300.00","components":[{"clientServiceId":"cs_01"}]}}` |
| `PATCH /bundles/bu_01` | `{"name":"Monthly package 2027","unitAmount":"315.00","effectiveTo":"2027-10-31","reason":"Annual update"}` | `{"bundle":{"id":"bu_01","name":"Monthly package 2027","unitAmount":"315.00","effectiveTo":"2027-10-31"}}` |
| `PUT /bundles/bu_01/components` | `{"components":[{"clientServiceId":"cs_01"},{"clientServiceId":"cs_02"}],"reason":"Scope update"}` | `{"bundleId":"bu_01","components":[{"clientServiceId":"cs_01"},{"clientServiceId":"cs_02"}]}` |
| `GET /settings/terms` | none | `{"defaultNetDays":15,"billingDay":"service_period_end","timezone":"America/Chicago","overrides":[]}` |
| `PATCH /settings/terms` | `{"defaultNetDays":15,"billingDay":"service_period_end","reason":"Approved settings"}` | `{"defaultNetDays":15,"billingDay":"service_period_end","timezone":"America/Chicago","updatedAt":"2026-11-02T12:00:00Z"}` |
| `POST /settings/terms/overrides` | `{"clientId":"client_01","clientServiceId":null,"netDays":30,"effectiveFrom":"2026-11-01","reason":"Approved client terms"}` | `201 {"override":{"id":"to_01","clientId":"client_01","clientServiceId":null,"netDays":30,"effectiveFrom":"2026-11-01","effectiveTo":null}}` |
| `PATCH /settings/terms/overrides/to_01` | `{"netDays":30,"effectiveTo":"2027-10-31","reason":"Renewal"}` | `{"override":{"id":"to_01","netDays":30,"effectiveTo":"2027-10-31"}}` |
| `GET /settings/remittance` | none | `{"remittance":{"payeeName":"TAP Associates, LLC","address":"100 Example St, Houston, TX","instructions":"Include invoice number"}}` |
| `PATCH /settings/remittance` | `{"payeeName":"TAP Associates, LLC","address":"100 Example St, Houston, TX","instructions":"Include invoice number","reason":"Corrected address"}` | `{"remittance":{"payeeName":"TAP Associates, LLC","address":"100 Example St, Houston, TX","instructions":"Include invoice number"},"updatedAt":"2026-11-02T12:00:00Z"}` |
| `GET /candidates?clientId=client_01&state=open&from=2026-11-01&to=2026-11-30&limit=50&cursor=...` | none | `{"items":[{"id":"ca_01","clientId":"client_01","clientServiceId":"cs_01","state":"open","candidateType":"recurring","candidateDate":"2026-11-30","description":"Monthly bookkeeping","unitAmount":"125.00"}],"nextCursor":null}` |
| `POST /candidates/ca_01/dismiss` | `{"reason":"Client requested hold"}` | `{"candidate":{"id":"ca_01","state":"dismissed"},"auditId":"audit_01"}` |
| `POST /candidates/ca_01/reopen` | `{"reason":"Hold resolved; service completed"}` | `{"candidate":{"id":"ca_01","state":"open"},"auditId":"audit_02"}` |
| `POST /candidates/ca_01/reprice` | `{"reason":"Rate correction"}` | `{"candidate":{"id":"ca_01","state":"open","unitAmount":"130.00"}}` |
| `GET /candidates/schedule?from=2026-11-01&to=2026-11-30&clientId=client_01` | none | `{"projection":"projected","items":[{"clientServiceId":"cs_01","candidateDate":"2026-11-30","description":"Monthly bookkeeping","unitAmount":"125.00"}]}` |
| `POST /candidates/generate` | `{"clientServiceIds":["cs_01"],"from":"2026-11-01","to":"2026-11-30"}` | `{"created":2,"unpriced":1,"existing":1,"skipped":4,"skippedByReason":{"no_map":1,"map_disabled":1,"source_incomplete":1,"outside_window":1},"candidateIds":["ca_01","ca_02"]}` |
| `GET /completion-source-maps` | query: `clientServiceId`, `includeEnded` | `{"items":[{"id":"map_01","clientServiceId":"cs_01","adapter":"work_period_done","predicate":{"stage":"done"},"effectiveFrom":"2026-11-01","effectiveTo":null,"enabled":true}]}` |
| `POST /completion-source-maps` | `{"clientServiceId":"cs_01","adapter":"work_period_done","predicate":{"stage":"done"},"identityFields":["client_service_id","period"],"candidateDateRule":"period_end","effectiveFrom":"2026-11-01","reason":"Configured by firm"}` | `201 {"map":{"id":"map_01","clientServiceId":"cs_01","adapter":"work_period_done","predicate":{"stage":"done"},"identityFields":["client_service_id","period"],"candidateDateRule":"period_end","effectiveFrom":"2026-11-01","effectiveTo":null,"enabled":true}}` |
| `PATCH /completion-source-maps/map_01` | `{"enabled":false,"effectiveTo":"2026-11-30","reason":"Service rule retired"}` | `{"map":{"id":"map_01","enabled":false,"effectiveTo":"2026-11-30"}}` |
| `POST /invoices/from-candidates` | `{"candidateIds":["ca_01"],"memo":"November services"}` | `201 {"invoice":{"id":"inv_01","status":"draft","invoiceNumber":null,"issueDate":null,"dueDate":null,"lines":[{"id":"line_01","description":"Monthly bookkeeping","quantity":"1.0000","unitAmount":"125.00","amount":"125.00","candidateIds":["ca_01"]}]},"refresh":["candidates","invoice","receivables"]}` |
| `POST /invoices` | `{"clientId":"client_01","memo":"Manual adjustment"}` | `201 {"invoice":{"id":"inv_02","clientId":"client_01","status":"draft","invoiceNumber":null,"issueDate":null,"dueDate":null,"memo":"Manual adjustment","lines":[]},"refresh":["invoice","receivables"]}` |
| `POST /invoices/inv_01/issue` | `{}` | `{"invoice":{"id":"inv_01","status":"issued","invoiceNumber":"TAP-2026-0001","issueDate":"2026-11-02","dueDate":"2026-11-17","remittanceSnapshot":{"payeeName":"TAP Associates, LLC","address":"100 Example St, Houston, TX","instructions":"Include invoice number"}},"refresh":["invoice","candidates","receivables"]}` |
| `POST /invoices/inv_01/void` | `{"reason":"Duplicate service entry"}` | `{"invoice":{"id":"inv_01","status":"void","voidReason":"Duplicate service entry"},"returnedCandidateIds":["ca_01"],"refresh":["invoice","candidates","receivables"]}` |
| `DELETE /invoices/inv_01` | no body | `{"deleted":true,"returnedCandidateIds":["ca_01"],"refresh":["candidates","receivables"]}` |
| `DELETE /invoice-lines` | `{"id":"line_01"}` | `{"deleted":true,"returnedCandidateIds":["ca_01"],"refresh":["invoice","candidates","receivables"]}` |
| `PATCH /invoice-lines` for candidate-linked line | `{"id":"line_01","description":"Corrected label"}` | `409 {"error":"Candidate-linked invoice lines cannot be edited","code":"CANDIDATE_LINKED_LINE_IMMUTABLE"}` |
| Deprecated `POST /invoices/inv_01` | `{"action":"issue"}` or `{"action":"void","reason":"Duplicate service entry"}` | Existing Phase 1 `snake_case` response serialization; invokes the same canonical authorization and RPC path. |

All paginated list endpoints use the same opaque base64url-encoded JSON-tuple cursor mechanism; the tuple fields are specific to each endpoint's fixed sort. Candidate pages sort by `candidateDate DESC, id DESC`; rate-card and bundle lists sort by `name ASC, id ASC`. A cursor contains the final row's sort values and ID. The next request must pass the exact cursor returned by the prior response. Clients must not parse or construct cursors. For example, a candidate cursor may decode to `{"candidateDate":"2026-11-30","id":"ca_01"}`, while a rate-card or bundle cursor may decode to `{"name":"Monthly package","id":"bu_01"}`. Encoding is not an authorization mechanism and the server validates cursor shape against the endpoint.

Draft creation through the candidate endpoint creates the same nullable draft shape as a manual draft. `POST /api/billing/invoices` creates an empty/manual draft from a valid `clientId` and optional `memo`; it creates no lines and returns `invoiceNumber`, `issueDate`, and `dueDate` as `null` until issue. The request does not accept client-supplied totals or those server-assigned fields.

Collections-only and unassigned sessions receive `403` from `GET /api/billing/permissions` and every pricing, candidate, schedule, completion-map, and Billing-settings endpoint; they do not receive redacted price-shaped payloads. Every money value in a new Phase 2 response is a decimal string (for example, `"125.00"`), never a JSON number. Existing Phase 1 response formatting remains unchanged during the compatibility period; all new Phase 2 response shapes are camelCase.

Every error remains `{ error, code }`. Draft creation returns a complete server-calculated draft, lines, linked candidate identifiers, and refresh targets. It accepts no client-calculated amount.

| Code | HTTP status | Meaning |
| --- | --- | --- |
| `CANDIDATE_NOT_OPEN` | 409 | Candidate is already drafted, invoiced, dismissed, or otherwise unavailable. |
| `CANDIDATE_UNPRICED` | 409 | Candidate has no current valid price and cannot be drafted. |
| `CANDIDATE_LINKED_LINE_IMMUTABLE` | 409 | Any PATCH mutation of a candidate-linked line is refused; remove it through DELETE to return candidates to open. |
| `CANDIDATE_DISMISS_REASON_REQUIRED` | 422 | Dismissal reason is empty. |
| `CANDIDATE_REOPEN_REASON_REQUIRED` | 422 | Reopen reason is empty. |
| `INVALID_CURSOR` | 422 | A list cursor is malformed or does not match that endpoint's supported ordering. |
| `EFFECTIVE_DATE_OVERLAP` | 409 | A pricing, terms, bundle, or completion-map range overlaps the same identity. |
| `INVALID_COMPLETION_SOURCE_MAP` | 422 | Adapter, predicate, date rule, or stable identity is not in the bounded schema. |
| `GENERATION_WINDOW_INVALID` | 422 | Generation or schedule window is malformed or exceeds the permitted maximum. |
| `DRAFT_CANDIDATE_LINK_REQUIRED` | 409 | A candidate-linked line/delete transition would break provenance. |
| `ISSUE_PRECONDITION_FAILED` | 409 | Draft has no valid lines, unresolved candidate state, or another issue-time invariant failure. |

Generation and projection accept a maximum 365-calendar-day window, calculated in the firm timezone. Re-running generation for the same scope returns the same source-identity candidates unchanged and reports `created`, `existing`, and `skipped` counts plus identifiers. A skipped source is reported with one of these reasons: `no_map`, `map_disabled`, `source_incomplete`, or `outside_window`. A newly persisted unpriced candidate counts in `created` (and in the `unpriced` count), because the source event was captured; it remains state `unpriced` and cannot be claimed into a draft until priced. The response includes candidate IDs for all newly persisted candidates, including unpriced ones. Disabling a map stops future generation only; it never rewrites an existing candidate.

The issue date is the firm date at the time of the issue RPC. Due date is server-calculated from the resolved client terms (Net 15 default). Recurring candidate date is the final calendar day of its configured service period unless a client/service override applies. The firm date/timezone is Houston, Texas, represented by `America/Chicago` in `collection_settings.timezone`.

Firm-date validation covers: month-end for 30-day and 31-day months; February in leap and non-leap years; the last service-period day across the spring-forward and fall-back daylight-saving transitions in `America/Chicago`; and due-date addition across a DST boundary. All business dates are date-only values derived in the firm timezone, never the browser timezone.

The issue RPC validates the draft, assigns its annual number, transitions linked candidates to `invoiced`, snapshots current approved remittance instructions, and writes audit history in one transaction. The void and draft-delete RPCs restore linked candidates to `open` in that same transaction. Database rules make issued provenance immutable; routes alone are insufficient.

## Dynamic one-off completion-source configuration

### Operations schema boundary

**Authoritative schema gate recorded 2026-11-04; this supersedes the integer `YYYYMM` implementation assumption in the historical paragraph immediately below.** Engineer A's read-only inspection of the shared sandbox reports `work_periods.period` and `period_counts.period` are text. The checked-in schema reference declares text `YYYY-MM`, while later repository fixes use integer `YYYYMM`; the sandbox schema export is not proof of the authoritative Operations schema. These sources conflict, and neither establishes the hosted Operations column types. Adapter implementation is blocked until the Operations owner supplies a schema-only export for `client_services`, `services`, `work_periods`, and `period_counts` showing actual column names, database types, nullability, and relevant keys/constraints. No rows, credentials, or secrets are requested. Do not guess a type, alter Operations schema, or write adapter code against either conflicting representation. After the export is reviewed, record its source and date and normalize the verified period representation to Billing's `YYYY-MM` read-model format. Verify the other source fields used by adapters against that same export; any mismatch blocks adapter work until resolved with the Operations owner.

The source adapter contract targets the Operations records `client_services`, `services`, `work_periods`, and `period_counts`. The checked-in schema reference `docs/datamodel/tap_client_hub_schema_v7_lean.sql` (SHA-256 `6b2c49b84281a17282ba347c39ccdcc8a5d3a4f58428ed3a18e43f0807b29aa8`, last changed by `9c394d2` on 2026-07-08) describes their fields and constraints, but is stale on period storage: it declares `work_periods.period` and `period_counts.period` as text `YYYY-MM`. Later repository fixes `6fc91c9` and `d104262` explicitly convert these API values to integer `YYYYMM` for database compatibility, and the current API handlers and static regression test use that representation. **Phase 2 adapter choice:** treat the existing Operations period columns as integer `YYYYMM`; normalize to `YYYY-MM` inside Billing candidate/read-model contracts. Do not alter Operations columns. The date format choice is based on repository runtime compatibility evidence, not a live hosted schema inspection. Before implementation, Engineer B records this assumption and hash in the handoff and confirms no newer schema artifact supersedes it; any observed mismatch blocks adapters rather than prompting an Operations schema change. The checked-in DDL documents `services.tracking` as `stage|count`, `work_periods.stage` values including `done` (with `done_by`/`done_at`), `period_counts.processed` and optional `expected`, and `client_services.frequency`/`active`. Count-trigger rules must compare `processed` against the firm's configured threshold; `expected` is descriptive source data, not an implicit billing rule. Frequency occurrences must be derived deterministically from the persisted `client_services.frequency` enum, never from UI display labels. The local synthetic fixture is for values and behavior tests only. Phase 2 may read these Operations tables: it creates or alters no Operations table, column, trigger, policy, or row. Billing configuration, candidates, and provenance live only in Billing-owned records.

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
