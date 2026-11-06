# TAB-HUB shared sandbox tooling

This directory owns the **one-time hosted-sandbox bootstrap**, separate from
the repository's legacy migration history. The remote sandbox begins empty;
replaying that history is unsafe because it assumes an older, unavailable
baseline and includes historical credential-seed behavior.

## Contract

- Target schema: `tap_hub_project` only.
- Source: an owner-provided, schema-only dump whose SHA-256 is pinned in the
  build script. The dump is ignored and never committed.
- Generated SQL: schema definitions and RLS policy definitions only; no rows,
  Auth users, storage objects, credentials, or browser-role grants.
- Access: `anon` and `authenticated` receive no privileges at bootstrap.
  `service_role` access is for server-side work only. A future reviewed feature
  migration must explicitly grant any client-facing access.
- Safety: never use `db reset --linked`, schema drops, or seed-all commands on
  the shared sandbox.

## Review workflow

1. Generate: `bash tools/sandbox/build-hardened-baseline.sh`.
2. Verify: `bash tools/sandbox/verify-hardened-baseline.sh`.
3. Review the generated SQL and approve it as the sandbox baseline.
4. Link the dedicated CLI work directory with
   `supabase link --workdir tools/sandbox --project-ref <sandbox-project-ref>`.
5. Run `supabase db push --workdir tools/sandbox --dry-run` and inspect the
   exact one-migration plan.
6. The owner explicitly approves the remote write. Only then run
   `supabase db push --workdir tools/sandbox`.

The generated migration is ignored until review approves its exact contents.
After initial application, each approved Billing or Collections schema change
must be promoted as a new, forward-only sandbox migration and recorded in the
sandbox validation handoff.

`20261030010000_collections_ar_private_bucket.sql` is the first such migration.
It creates the private Storage bucket required by the existing A/R Intake
routes. It creates no report object, seed data, or browser-role policy.

## Applied feature-migration mirror

The migration directory also mirrors forward-only Collections and Billing
promotions already recorded in the shared sandbox history. This includes the
Collections A/R intake migrations `20261104100000` through `20261104150000`,
the review-state guard `20261104160000`, and Billing migrations `20261105100000`,
`20261105110000`, and `20261106100000`. These files exist to keep local
migration history aligned with the hosted sandbox; they are not pending work
and must not be applied a second time. Before any future sandbox migration,
inspect `supabase migration list --workdir tools/sandbox --project-ref
<sandbox-project-ref>` and the `db push --dry-run` plan. Stop if any remote
version is missing locally or if the plan includes an already-applied version.
