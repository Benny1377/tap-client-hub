# TAP Client Hub Handoffs

A handoff is required when one engineer's work is consumed by another engineer or changes a shared boundary.

Record:

- Milestone, branch, base commit, ready commit, and contract status.
- Owned paths and changed behavior.
- Tables, routes, integrations, permissions, and environment variable names only.
- Commands run, results, evidence paths, limitations, and known blockers.
- Consumer actions, refresh behavior, merge order, and rollback notes.

A handoff is not ready until the consumer can reproduce its branch and use its contract without private chat context.

Current Collections local database instructions and the Engineer A validation request are in `2026-10-11-collections-local-setup.md`.

The latest Phase 2 closeout and Phase 3 integration-prep checkpoint is `2026-10-12-collections-phase-3-integration-prep.md`; its linked Phase 3 contract is still a draft and does not authorize provider calls or live sending. The 2026-10-13 update adds local harness/security fixes pending validation and records the client-approved separate Supabase sandbox decision.
