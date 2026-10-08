# Decision: Collections Phase 2 QuickBooks scope

Status: Proposed; owner approval required.

The Phase 1 contract explicitly defers QuickBooks synchronization, OAuth, webhooks, tokens, and credentials. Phase 2 therefore begins with a contract and sandbox discovery rather than production integration.

TAP Hub Billing remains the source of truth for Collections operations. QuickBooks should initially be treated as an external accounting system whose identifiers and synchronization observations are stored through the Phase 1 external-ID boundary. No sync direction, field authority, or automatic mutation is approved yet.

This decision prevents an accounting integration from silently changing invoices, payments, or escalation state before the owner approves the reconciliation and approval model.
