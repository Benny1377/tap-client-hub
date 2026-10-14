# TAP Client Hub Implementation Plan

## M0 Stable ownership

Outcome: the team can identify the deployed baseline, source-of-truth order, owners, approval boundaries, and active work without relying on chat history.

Evidence: `CURRENT_WORK.md` references a fetched `origin/main` SHA and current branch state.

## M1 Live incident response

Outcome: a reported production issue has a verified root cause before any mutation.

Required evidence: reproduction or approved read-only production evidence, root-cause statement, scoped fix, retest, and rollback note.

## M2 Workflow change

Outcome: a client or staff workflow changes without breaking shared modules.

Required evidence: acceptance scenario, frozen contract when an API or persisted behavior changes, focused regression coverage, and responsive manual validation.

## M3 Data or schema change

Outcome: a database correction is forward-only, narrowly targeted, reversible where possible, and verified against the intended environment.

Required evidence: migration decision, target set, rollback plan, explicit production approval, and post-change reload check.

## M4 Shared support integration

Outcome: external applications can use the v1 support API without crossing app boundaries.

Required evidence: contract review, app-isolation tests, server-only secret configuration, and integration verification without secret disclosure.

## Release gate

A change may be proposed for `main` only after the scoped diff is reviewed, relevant automated checks are recorded, environment-dependent checks are identified, the rollback path is known, and the project owner approves promotion.
