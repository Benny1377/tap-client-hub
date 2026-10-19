# 2026-10-19 Billing Project Foundation

Status: **Approved**. Named approver: Project owner (Tejas Wilavanya), 2026-10-19.

## Context and evidence

`practiceops_1.html` models the intended workflow—rate cards, client pricing and bundles, recurring and completion-triggered one-off work, draft/issued invoices, deposits/allocations, reconciliation, and derived receivables—but it is not durable or authorized implementation.

The selected integration baseline, `codex/collections-phase4-backend`, contains native Billing ledger/UI/API work and Collections Phase 4 A/R PDF Intake work. Branch presence does not establish a hosted migration or production release.

## Decision

1. Billing pricing supports a firm rate card, effective-dated client overrides, fixed bundles, and modular service rules.
2. Recurring work becomes a billable candidate on its configured schedule. A one-off candidate appears only after its configured Operations completion event.
3. Owners/Admins manage a configurable permission policy. Initial void/reversal authority remains Owner/Admin-only. Policy cannot bypass server authorization, ledger invariants, audit writes, or separation-of-duties rules.
4. Firm remittance settings are client-facing invoice payment instructions, never banking credentials or bank-login data. Issued invoices snapshot their instructions; later changes affect future drafts only.
5. A/R Intake is a separate, reviewable source. It retains source provenance, client linking, invoice identity, balance, and reconciliation status. It may feed Collections but never creates or mutates native Billing invoices, payments, allocations, credits, or client records.

## Consequences

- Reuse and validate the existing native ledger before adding new Billing migrations or routes.
- Pricing history, invoice totals, allocations, and audit history require forward-only migrations and database-enforced invariants.
- Bank feeds, payment processing, QuickBooks API/OAuth, taxes, interest, late fees, client portal, and outbound invoice delivery remain deferred.

## Follow-up

| Item | Owner | Revisit trigger |
| --- | --- | --- |
| Freeze the Billing foundation contract | Engineer A and Engineer B | Consumer review of the initialization handoff |
| Define client-specific service-to-completion-event rules | Project owner with client | Before billable-candidate implementation |
| Decide delivery, processor, and bank-feed integrations | Project owner | After manual Billing/reconciliation release |
