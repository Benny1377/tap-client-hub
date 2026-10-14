# TAP Client Hub Contracts

Create a contract before dependent implementation changes any API behavior, persistence rule, access rule, shared type, support integration, or client-visible refresh behavior.

Use `Draft`, `Frozen for implementation`, `Released`, and `Superseded` as contract states.

Each module contract must state:

- Capability boundary and exclusions.
- Operations, inputs, outputs, ordering, nullability, defaults, and pagination.
- Authentication, role checks, module access, and server-only boundaries.
- Validation rules, stable errors, retryability, and conflict behavior.
- Refresh, invalidation, and fields a consumer must not recompute.
- Fixtures, tests, environments, limitations, reviewer names, and approval date.

An incompatible change needs a Contract Change Request. The frozen contract remains authoritative until producer and consumer approve the replacement.
