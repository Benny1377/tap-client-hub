# TAP Client Hub Collaboration Protocol

## Ownership

| Track | Default owner | Review partner |
| --- | --- | --- |
| Product workflows, pages, components, accessibility | Engineer A | Engineer B for contract use |
| Routes, Supabase, access policy, integrations, migrations | Engineer B | Engineer A for user-visible compatibility |
| Shared API and data contract | Producer drafts | Consumer approves before dependent work |
| Production promotion and client communication | Project owner | Both engineers provide evidence |

One engineer edits a shared or contested file at a time. A cross-boundary change starts with a dependency request or module contract.

## Branches

- `main` is the production baseline. Do not develop directly on it.
- Start every change from a freshly fetched `origin/main`.
- Use `codex/<scope>` for AI-assisted work and a scoped feature branch for human work.
- Do not merge, deploy, alter remotes, or force-push without explicit project-owner approval.
- Resolve conflicts on the feature branch, not on `main`.

## Approval boundaries

Explicit approval is required before dependency installation, credential or environment access, production queries, database mutations, migrations, commits, pushes, merges, deployments, remote configuration changes, and client communication.

Require a second confirmation immediately before bulk or irreversible production writes.

## Incident flow

1. Preserve the report and reproduce safely.
2. Trace UI, API, authorization, data, and external integration behavior.
3. Obtain the minimum approved live evidence needed to establish root cause.
4. Record the proposed fix, blast radius, validation, and rollback.
5. Change only after approval; retest in the affected environment.

## Evidence vocabulary

- `PASS`: executed against the stated commit and environment.
- `FAIL`: executed and did not meet the expected result.
- `BLOCKED`: cannot run because a named dependency is unavailable.
- `DEFERRED`: intentionally postponed with owner and revisit point.
- `NOT RUN`: no qualifying execution exists.
