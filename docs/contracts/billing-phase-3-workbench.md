# Billing Phase 3: workbench and configuration UI

State: **Frozen (owner-approved 2026-11-06; Engineer A acknowledged at `b01cfcc`).** Owner approved the scope boundary on 2026-11-06: manual payment and reconciliation workflows remain out of Phase 3 and require a separate future contract; they are not implicitly assigned to Phase 4. The pricing policy response example was corrected to show the observed `pricing.manage.enabled: true` value before acknowledgement. This revision adds two narrowly scoped read endpoints and one additive invoice-line provenance field requested in Engineer A's review; it does not change persistence or the Phase 2 ledger rules. It consumes the Phase 2 boundary in [Billing Phase 2: pricing and billable candidates](billing-phase-2-pricing-and-candidates.md). UI implementation follows Phase 2 backend closeout and this contract's owner and Engineer A acknowledgement.

## Goal and scope

Deliver the firm-facing Billing workbench in this order:

1. Invoices and billable candidates.
2. What bills next.
3. Clients and prices.
4. Settings and completion-rule configuration.

The sequence is an implementation order, not a data dependency order. Existing Payments and Receivables views remain available and unchanged in this phase except for regression fixes required by integration. Manual payment/reconciliation workflows are explicitly deferred and need a separate approved contract; they are not part of Phase 4 unless that phase is separately amended. Phase 3 also does not add invoice email/PDF delivery, payment processing, bank feeds, or accounting integrations.

## Contract boundaries

- All reads and writes use the Phase 2 `/api/billing/*` endpoints. No UI writes directly to Supabase or Operations tables.
- Phase 2 canonical request/response fields are camelCase. Existing Phase 1 invoice-list, receivables, and ordinary manual-line routes retain their snake_case compatibility shapes. `GET /invoices` adds only the camelCase `candidateIds` array to each legacy snake_case invoice-line object; it retains all prior fields and does not expose the nested link-table payload. A typed client-side view-model adapter may normalize these legacy reads for rendering, but must not silently change server contracts. New candidate/draft flows and explicit issue/void endpoints use their Phase 2 camelCase shapes; do not use the deprecated `POST /invoices/[id]` action adapter.
- Money is received as decimal strings and formatted for display only. The browser does not compute authoritative amounts, balances, taxes, or due dates.
- Every mutation remains server-authorized and audited. UI permission checks control presentation only and never replace server checks.
- Operations remains read-only. Billing may read only the four contracted source tables and fields described in Phase 2; it must not expose Operations secrets or unrelated client-service fields.
- Dates use Houston firm-date semantics (`America/Chicago`) where the endpoint contract specifies business dates. Date-only values must not be shifted by browser timezone conversion.
- Remittance settings contain invoice-facing payment instructions, not bank-login credentials or payment-processing secrets. Only the API fields already frozen in Phase 2 may be edited; a new structured bank field would require a contract change.

## Navigation and screen requirements

### 1. Invoices and billable candidates

Extend the current invoice list/detail view. Keep manual draft creation available to authorized users and add candidate discovery/selection without changing the existing Payments or Receivables workflows.

- Load invoices and receivables using the existing Phase 1 read contracts; use Phase 2 camelCase contracts for new candidate and draft flows.
- Show draft invoice number, issue date, and due date as unset until the issue RPC returns them.
- Candidate selection must include only `open`, priced candidates. `unpriced`, `dismissed`, `drafted`, and `invoiced` candidates are not draftable. Bundle components remain provenance; a bundle is one package invoice line and must never be summed as several billable lines.
- Candidate-backed draft creation calls `POST /api/billing/invoices/from-candidates`; empty/manual draft creation calls `POST /api/billing/invoices`. Do not create a draft from a browser-calculated amount.
- `PATCH /api/billing/invoices/[id]` is memo-only (`{"memo":"Updated note"}`); it cannot change status, invoice number, issue date, or due date. Issue and void use their dedicated endpoints.
- Candidate-linked lines are immutable. Explain the conflict and refresh when the server returns `CANDIDATE_LINKED_LINE_IMMUTABLE`; deleting such a line uses the contracted endpoint and reports returned candidate IDs.
- Issue, delete, and void use the explicit Phase 2 endpoints. Require a non-empty void reason; show the server's conflict when an active payment allocation prevents voiding. Never optimistically mark an invoice issued or voided before server success.
- After mutations, refresh the resource groups named by the API response (or the documented Phase 2 refresh target); do not locally infer candidate state.

Primary endpoints: existing `GET /api/billing/invoices?client_id=` and `GET /api/billing/receivables`; Phase 2 `POST /api/billing/invoices`, `POST /api/billing/invoices/from-candidates`, `PATCH/DELETE /api/billing/invoices/[id]`, `POST /api/billing/invoices/[id]/issue`, `POST /api/billing/invoices/[id]/void`, `GET /api/billing/candidates`, and `POST /api/billing/candidates/[id]/dismiss|reopen|reprice`; plus `/api/billing/invoice-lines`. Do not assume a standalone invoice-detail GET exists; select from the loaded list and refetch it after a mutation.

Candidate-linked invoice lines include the additive `candidateIds` array; only active provenance links are returned. Example legacy response fragment: `{"id":"inv_01","invoice_lines":[{"id":"line_01","description":"Monthly bookkeeping","candidateIds":["ca_01"]}]}`. A line with a non-empty array is locked against edits. After deletion or void, the refreshed response is authoritative.

For candidate-linked line removal, send `DELETE /api/billing/invoice-lines` with JSON body `{"id":"<line UUID>"}`. The API also accepts a query ID for compatibility, but Phase 3 follows the frozen request example.

### 2. What bills next

Present a date-window projection of expected recurring and configured completion candidates.

- Use `GET /api/billing/candidates/schedule?from=&to=&clientId=`. Label results as **Projected** and clearly state that viewing them does not create candidates or invoices.
- Support client and Houston-date-window filters within the Phase 2 maximum window. Preserve server ordering and decimal-string values.
- Provide a separate, clearly named user action to generate candidates using `POST /api/billing/candidates/generate`. This is a write, requires `candidates.manage`, and must never be triggered by loading, filtering, or refreshing the projection.
- Show generated/existing/unpriced/skipped totals and the server-provided skip reasons. Explain that an unpriced candidate was captured but cannot be drafted until priced.
- After generation, refetch candidates and invoices. `candidateIds` identifies newly created rows; it is not a refresh instruction. A repeated request is safe under the endpoint's source-identity idempotency contract.

### 3. Clients and prices

Provide client-scoped price visibility and administration for rate cards, client-service overrides, and bundles.

- Rate-card and bundle lists use the Phase 2 cursor as an opaque value; rate cards and bundles sort by `name ASC, id ASC`. Never construct or decode cursors in the UI.
- Client pricing loads through `GET /api/billing/client-pricing?clientId=`. Do not infer a price from a display label or calculate a competing resolution; the server's price resolver remains authoritative.
- Bundle editing shows component client services but presents the bundle as one package price. Changing components or rates does not rewrite existing candidates, drafts, or issued invoices.
- Price visibility is limited to Owner/Admin and Billing-assigned users with `pricing.view`. Billing staff do not receive `pricing.manage` by default. Write controls require the resolved `pricing.manage` action; otherwise show the view-only state.
- Use decimal strings for all amount inputs. Show effective dates and server validation for overlapping ranges. Require a reason on every mutation that the Phase 2 API requires one.

Primary endpoints: `/api/billing/rate-cards`, `/api/billing/rate-cards/[id]`, `/api/billing/rate-cards/[id]/entries[/entryId]`, `/api/billing/client-pricing?clientId=`, `/api/billing/client-pricing/overrides[/id]`, and `/api/billing/bundles[/id]` including `PUT /api/billing/bundles/[id]/components`.

The workbench also uses read-only `GET /api/billing/client-services?clientId=<UUID>`, authorized when the caller has either `pricing.view` or `candidates.view`. It returns only `{items:[{id,active,frequency,serviceCode,serviceName}]}` from Operations; a valid client with no service assignments returns an empty list. Example: `{"items":[{"id":"cs_01","active":true,"frequency":"Monthly","serviceCode":"FIN","serviceName":"Bookkeeping"}]}`. Invalid or missing `clientId` returns `422 INVALID_INPUT`; source read failures return `500 BILLING_READ_FAILED`. It must never return payroll passwords, EFTPS credentials, or any other Operations columns.

### 4. Settings and completion-rule configuration

Group firm defaults, effective-dated terms overrides, remittance instructions, action policy, and completion-source maps under Settings. Keep unrelated Collections settings out of this area.

- Load effective actions from `GET /api/billing/permissions`. Gate each read/write control by its documented action. Owner/Admin-only actions remain non-delegable even if the UI is manipulated.
- Load current values before showing the policy editor with `GET /api/billing/permissions/policy`. This read is Owner/Admin-only (`policy.manage`) and returns all 11 delegable actions, applying the server defaults where no row is stored. A current response can look like `{"policies":[{"actionKey":"billing.view","allowedRoles":["manager","staff","offshore"],"enabled":true},{"actionKey":"pricing.manage","allowedRoles":[],"enabled":true}]}`. `allowedRoles` contains only delegable roles (`manager`, `staff`, `offshore`), so the returned policy can be submitted unchanged to `PATCH /api/billing/permissions/policy`. Owner/Admin privileges are inherent and cannot be granted or revoked through these rows; `policy.manage`, `invoices.void`, and `payments.reverse` remain fixed Owner/Admin-only actions and are excluded. Missing rows use the same defaults as the server-side resolver. Billing staff, Collections-only, and unassigned users receive `403 FORBIDDEN`.
- Terms UI reads/writes `GET/PATCH /api/billing/settings/terms` and `POST/PATCH /api/billing/settings/terms/overrides[/id]`. Display Net 15 and the configured service-period billing day; make clear that a service-level override takes precedence over a client override, then the firm default.
- Remittance UI reads/writes `GET/PATCH /api/billing/settings/remittance`. Show a save confirmation, but never log or include remittance values in analytics, errors, or telemetry. Issued invoice remittance is the immutable server snapshot, not a live view of the current settings.
- Completion rules are dynamic per client service and effective date. Use `GET/POST/PATCH /api/billing/completion-source-maps`; offer only the bounded adapters and predicate/date-rule combinations the server accepts. Do not hard-code a client or service mapping from the demo. Explain that a rule change applies to future not-yet-generated occurrences and does not rewrite existing candidates or invoices.
- Manual confirmation is available only to users with `candidates.manage`; it requires the contract's idempotency key, service, date, source note, and reason. A replay with the same idempotency key returns the existing confirmation (`200`, `created:false`); a conflicting duplicate returns `409 DUPLICATE_RESOURCE` and is not a new confirmation.
- Policy editing uses `PATCH /api/billing/permissions/policy` and is Owner/Admin-only. Clearly distinguish delegated staff actions from the fixed Owner/Admin-only actions `policy.manage`, `invoices.void`, and `payments.reverse`.

### Endpoint behavior clarifications from Engineer A review

- After candidate generation, refetch candidates and invoices. The response's `candidateIds` identifies newly created rows only; it is not a refresh instruction.
- Projection and generation require an explicit client or client-service scope. Never run an all-client projection or generation.
- `PATCH /api/billing/settings/remittance` is a full replacement. Send all three fields (`payeeName`, `address`, `instructions`) every time; omitted fields are cleared to null.
- Use the server's `{error,code}` response. `INVALID_INPUT` is a generic validation code; use client-side validation for field placement and show server error text as a summary. Do not expect one server error per form field.
- Manual-confirmation replay with HTTP 200 and `created:false` means the same idempotency key returned the existing confirmation. HTTP 409 `DUPLICATE_RESOURCE` means a different confirmation already exists for that client service/date and is a conflict.
- A bundle candidate carries the full package price on each component candidate. Group these by the client-specific bundle and candidate date; selecting a package selects the whole group. Never sum component candidate amounts as separate charges.
- Collections-only users may read the invoice ledger but do not see Billing candidate/pricing panels. `GET /api/billing/permissions` returns 403 to Collections-only and unassigned users. Invoice-list access remains available to Collections even if `billing.view` is revoked; this legacy ledger-read rule does not grant candidate or pricing access.
- Date-only values use the Houston firm calendar (Central time, `America/Chicago`) and must not shift across browser timezones. Phase 3 acceptance remains synthetic. Before production approval, run a separately recorded, read-only compatibility check from an isolated Preview against the identified Operations project: verify the adapter's permitted columns and joins for `client_services`, `services`, `work_periods`, and `period_counts`; confirm actual `YYYYMM` period parsing and completion eligibility through the bounded read-only schedule/projection path for an Operations-owner-approved service; record only schema, aggregate counts, period format, and pass/fail evidence (no client PII or credential values). Do not write to Operations. This gate runs after Preview acceptance and before any production rollout, with Operations-owner approval for the read-only connection and test scope.

## Shared interaction and error behavior

- Support loading, empty, stale, and retryable error states for every screen; errors use the Phase 2 `{error, code}` shape.
- Keep user-entered form state when a non-destructive validation or network error occurs. On `403`, explain that access is unavailable and preserve the current form state; on `404`, return to the relevant list; on `409`, explain the conflict and refetch affected resources; on `422 INVALID_INPUT`, show the server validation message and field-level client validation where the field is known. Error codes are stable categories, not field identifiers. Do not expose raw database messages.
- Preserve keyboard operation, visible focus, labels for inputs, table headers, status text that is not color-only, and confirmation for destructive invoice/rule actions.
- Use opaque cursors and server-returned IDs or refresh targets where the response includes them. Do not optimistically advance candidate/invoice state or fabricate a success when a request times out.
- Keep the current A/R PDF intake in Collections. It is not a Billing candidate source, and Phase 3 must not import or write back A/R report rows.

## Acceptance evidence

Engineer A owns UI implementation and UI tests; Engineer B owns API/database contract fixes. Integrated acceptance must cover:

1. Owner/Admin, default Billing staff, delegated Billing staff without `pricing.manage`, Collections-only, and unassigned users; hidden controls and direct API calls both respect server authorization.
2. Manual draft, candidate-backed draft, candidate line immutability/removal, delete-draft candidate return, issue numbering/date/terms/remittance snapshot, and void reason/payment-allocation conflict.
3. Projection reads are side-effect free; only the explicit Generate action persists candidates; duplicate generation does not duplicate; all four skip reasons and unpriced results are legible.
4. Rate-card/client override/bundle precedence, bundle single-line display, effective-date overlap errors, cursor pagination, and immutable historical amounts.
5. Terms precedence, remittance edit/snapshot behavior, completion-map effective dates, manual-confirmation idempotency, and protected permission actions.
6. Houston firm dates at month-end/DST, decimal-string display, empty/error/loading states, keyboard/accessibility checks, and no sensitive Operations/remittance values in logs.
7. `GET /api/billing/permissions/policy` blocks every non-Owner/Admin role and returns the current full policy without mutation; `GET /api/billing/client-services` allows Billing `pricing.view` or `candidates.view` only and returns exactly the five documented fields.
8. Invoice-list candidate provenance includes active candidate IDs on each line without changing legacy snake_case fields or exposing the junction table.

Phase 3 is ready for handoff when the consumer acknowledges the contract, the Phase 2 endpoints are accepted as complete, each screen's API exists on the shared integration commit, and the integrated UI/API tests pass on synthetic data. Preview results must record URL, deployed commit, sandbox identity, test command, result, and limitations. This contract does not authorize production rollout or external payment/delivery integrations.
