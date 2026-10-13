# TAP Client Hub Contracts

Create a contract before dependent implementation changes any API behavior, persistence rule, access rule, shared type, support integration, or client-visible refresh behavior.

Use `Draft`, `Frozen for implementation`, `Released`, and `Superseded` as contract states.

Collections contracts:

- [Phase 1 Billing ledger](collections-phase-1-billing-ledger.md) — frozen for implementation.
- [Phase 2 backend](collections-phase-2-backend.md) — integrated and locally validated; review/merge closure remains.
- [Phase 3 integrations](collections-phase-3-integrations.md) — draft; owner and producer/consumer decisions remain open.

Collections non-production sandbox decision: `../decisions/2026-10-13-collections-supabase-sandbox.md` (approved in principle; provisioning details pending).

Each module contract must state:

- Capability boundary and exclusions.
- Operations, inputs, outputs, ordering, nullability, defaults, and pagination.
- Authentication, role checks, module access, and server-only boundaries.
- Validation rules, stable errors, retryability, and conflict behavior.
- Refresh, invalidation, and fields a consumer must not recompute.
- Fixtures, tests, environments, limitations, reviewer names, and approval date.

An incompatible change needs a Contract Change Request. The frozen contract remains authoritative until producer and consumer approve the replacement.
