# 2026-10-19 Billing Project Foundation

Status: **Approved**. Named approver: Project owner (Tejas Wilavanya), 2026-10-19.

## Context and evidence

The canonical prototype design reference is `dev-mock/design/practiceops.html`, SHA-256 `4b795a36c34fb4664e2d5567dbdf422ef612216b2fb45dbc9515e11fbd293595`. It models the intended workflow—rate cards, client pricing and bundles, recurring and completion-triggered one-off work, draft/issued invoices, deposits/allocations, reconciliation, and derived receivables—but it is not durable or authorized implementation. The owner confirmed that the locally named `practiceops_1.html` refers to this same design source; the canonical path and hash above govern Phase 0 references.

The selected integration baseline is `codex/security-fixes` at `6859607`. It contains the Phase 4 backend history and the integrated PracticeOps/Phase 4 UI history. `codex/billing-project-planning` merges cleanly into it. Branch presence does not establish a hosted migration or production release.

## Decision

1. Billing pricing supports a firm rate card, effective-dated client overrides, fixed bundles, and modular service rules.
2. Recurring work becomes a billable candidate on its configured schedule. A one-off candidate appears only after its configured Operations completion event.
3. Owners/Admins manage a configurable permission policy. `policy.manage`, `invoices.void`, and `payments.reverse` always resolve to Owner/Admin, cannot be granted to staff through the policy record, and are enforced server-side. Any future delegation of invoice voids or payment reversals requires a new owner decision. Policy cannot bypass server authorization, ledger invariants, audit writes, or separation-of-duties rules.
4. Firm remittance settings are client-facing invoice payment instructions, never banking credentials or bank-login data. Issued invoices snapshot their instructions; later changes affect future drafts only.
5. A/R Intake is a separate, reviewable source. It retains source provenance, client linking, invoice identity, balance, and reconciliation status. It may feed Collections but never creates or mutates native Billing invoices, payments, allocations, credits, or client records.
6. The Billing foundation uses the route error envelope `{ error: string, code: UPPER_SNAKE_CASE }`. HTTP status is authoritative for the category; `code` is the stable machine-readable reason.
7. Effective Billing permissions are calculated server-side from authenticated identity, assigned module(s), and a database-backed Billing action policy. Owner/Admin alone administer that policy. The UI receives the effective permissions for presentation but never authorizes an action.
8. Price data is visible only to Owner/Admin and users assigned the Billing module. Collections-only access may read receivables but not rate cards, overrides, bundles, or price/margin details.
9. A billable candidate has a database-enforced source identity: client service, candidate type, and either a schedule occurrence or a source completion event. Duplicate candidates are rejected, not silently merged.
10. Price resolution is deterministic: active client bundle first; otherwise active client-service override; otherwise active matching rate-card entry; otherwise the candidate is `unpriced` and cannot be invoiced.
11. Invoice numbers use `TAP-YYYY-####`, allocated sequentially by the issue RPC. The default is Net 15, with a client-level terms override. Recurring candidates use the final calendar day of their configured service period by default, with a client/service override; one-off candidates wait for confirmed completion.
12. Draft deletion is allowed only through an audited RPC for an unissued, unallocated, unreferenced draft. Issuing is an atomic RPC that validates the draft, allocates/locks its number, snapshots approved remittance instructions, writes audit history, and issues the invoice.
13. Pricing, recurring candidates, and one-off candidates remain one Phase 2 delivery. The one-off implementation may begin only when its service-to-completion-event map is defined.
14. The owner approves the Phase 0 gap resolutions below:
    - The canonical firm timezone is **Houston, Texas**; the valid IANA identifier is `America/Chicago`. Billing reuses `collection_settings.timezone` and labels it Houston in user-facing settings.
    - Billing staff can view price information but do not receive `pricing.manage` by default. Owner/Admin explicitly grants it through the Billing action policy.
    - A candidate returns to `open` when its linked draft is deleted or its invoice is voided. An authorized user may dismiss it with a reason and later reopen it.
    - Billing uses active `client_services` joined to `services` for enrollment/cadence. Recurring candidates derive from Billing rules; one-off evidence is configured from `work_periods`, `period_counts`, or explicit manual confirmation. An unmapped one-off service produces no candidate.
    - Manual reconciliation remains UI over native payment/allocation APIs, with an optional read-only suggestion endpoint and no new deposit entity. Void reason is required; invoice list filters include status, client, and date.
    - The canonical prototype reference is `dev-mock/design/practiceops.html`, SHA-256 `4b795a36c34fb4664e2d5567dbdf422ef612216b2fb45dbc9515e11fbd293595`. It remains an untracked workflow reference, not a versioned contract source.

## Consequences

- Reuse and validate the existing native ledger before adding new Billing migrations or routes.
- Pricing history, invoice totals, allocations, and audit history require forward-only migrations and database-enforced invariants.
- Database rules—not route checks alone—must prevent changes to issued lines, mismatched line amounts, and voiding an invoice with active allocations. Decimal calculations belong in database numeric logic.
- Net 15 is a commercial due-date policy, not a security mechanism. Remittance content is intentionally client-visible only when printed on an invoice; it must contain no bank-login credential, be changed only by authorized users, be audit logged without exposing values in logs, and be stored/retrieved only through server-side access controls.
- `America/Chicago` is the standards-compliant timezone identifier for Houston. It is not a Chicago-location decision; Texas firm-date behavior uses the Houston/Central time zone.
- Bank feeds, payment processing, QuickBooks API/OAuth, taxes, interest, late fees, client portal, and outbound invoice delivery remain deferred.

## Follow-up

| Item | Owner | Revisit trigger |
| --- | --- | --- |
| Freeze the Billing foundation contract | Engineer A and Engineer B | Consumer review of the initialization handoff |
| Define client-specific service-to-completion-event rules | Project owner with client | Before billable-candidate implementation |
| Add synthetic Operations service, schedule, and completion fixtures to the local harness | Engineer B | Before Phase 2 validation |
| Decide delivery, processor, and bank-feed integrations | Project owner | After manual Billing/reconciliation release |
