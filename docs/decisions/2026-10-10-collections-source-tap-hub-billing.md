# Decision: Collections uses TAP Hub Billing; no QuickBooks integration

Status: **Approved by project owner, 2026-10-10.**

## Decision

Collections will read outstanding invoices, allocations, and recorded payments directly from the TAP Hub Billing ledger. QuickBooks is not required for this Collections scope and will not be integrated as a source or synchronization target. Collections will not import a separate aging report or duplicate billing data.

## Rationale

- TAP Hub Billing is the planned system that creates and tracks invoices/payments for this platform.
- Using one authoritative ledger avoids duplicate balances, customer matching, reconciliation, OAuth credentials, and sync failure modes.
- The Phase 0 decision already states: Operations → Billing → Collections → Client 360. Collections must not mutate Billing amounts.

## Boundaries

- This decision covers the source of truth only. It does not approve a provider, sender identity, real-client email delivery, exact ladder copy, or production automation settings.
- Historical AR PDFs may inform requirements and test cases, but are not imported or treated as current state.
- No QuickBooks dependency, credential, token, configuration, webhook, or migration is in scope.
- Exact operational rules and UI/API compatibility remain subject to the Phase 2 contract and Engineer A review.

## Consequences

- Phase 2 backend reads the Phase 1 invoices/payments and derives current receivables server-side.
- Unallocated payments remain visible as reconciliation warnings and are never auto-allocated by Collections.
- Phase 1 integrated validation remains a release prerequisite. The owner reported applying the Phase 1 migration; remote migration state has not been independently verified in this branch.
- `docs/contracts/collections-phase-2-backend.md` contains the draft implementation contract and remaining operational decisions.
