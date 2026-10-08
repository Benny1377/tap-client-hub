# Contract: Collections Phase 2 QuickBooks Integration

State: Draft for review. No implementation or production configuration is authorized by this document.

## Purpose

Phase 2 evaluates whether TAP Hub should exchange billing identifiers and ledger status with QuickBooks Online. TAP Hub remains the operational source of truth for Collections; QuickBooks is an external accounting system and synchronization target unless the owner approves a different policy.

## Scope under review

- OAuth connection and token lifecycle.
- External IDs for clients, invoices, and payments.
- Idempotent export of approved invoices and recorded payments.
- Import of QuickBooks identifiers and non-destructive status observations.
- Retry, reconciliation, and error reporting.
- Owner/Admin-only connection and sync controls.

## Explicitly excluded until approved

- Automatic invoice creation from QuickBooks.
- Automatic payment mutation from QuickBooks.
- Deletion or void propagation without owner approval.
- Client-facing email or letter delivery.
- Storing QuickBooks tokens in ordinary application tables or the password vault.

## Required decisions before implementation

1. Authoritative system per entity and field.
2. Whether sync is one-way or bidirectional.
3. QuickBooks company/realm selection and multi-company behavior.
4. Token storage and rotation mechanism.
5. Retry/idempotency keys and reconciliation schedule.
6. Owner approval requirements for voids, reversals, and conflicts.

## Contract dependencies

- Phase 1 `external_account_ids` table.
- Phase 1 invoice/payment lifecycle and audit records.
- Owner/Admin access policy.
- A secrets-safe token storage decision.
- A sandbox QuickBooks company for integration tests.

## Acceptance gates

- No duplicate external records after retries.
- Tokens never appear in logs, client responses, or ordinary tables.
- Sync cannot bypass TAP Hub approval boundaries.
- Conflicts are visible and recoverable without destructive overwrites.
- Sandbox integration tests pass before any production connection.
