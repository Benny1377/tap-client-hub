# TAP Client Hub Handoffs

- [Billing project initialization](2026-10-19-billing-project-initialization.md)
- [Billing Phase 1 invariants and fixtures](2026-10-24-billing-phase1-invariants-and-fixtures.md)
- [Collections Phase 4 backend handoff](2026-10-18-collections-phase4-backend.md)

A handoff is required when one engineer's work is consumed by another engineer or changes a shared boundary.

Record:

- Milestone, branch, base commit, ready commit, and contract status.
- Owned paths and changed behavior.
- Tables, routes, integrations, permissions, and environment variable names only.
- Commands run, results, evidence paths, limitations, and known blockers.
- Consumer actions, refresh behavior, merge order, and rollback notes.

A handoff is not ready until the consumer can reproduce its branch and use its contract without private chat context.

Current Collections local database instructions and the Engineer A validation request are in `2026-10-11-collections-local-setup.md`.
