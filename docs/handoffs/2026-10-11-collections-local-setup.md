# Collections local test setup for both developers

This setup runs a disposable Supabase project on each developer's own machine. It loads only a small TAP Hub schema subset and fictional Billing/Collections records. It does not connect to the hosted project. The historical `supabase/seed.sql` and pre-Billing migrations are deliberately excluded: they are not a clean local bootstrap and must not be used as test data.

## Prerequisites

- Check out the same reviewed Phase 2 integration branch on each machine.
- Docker Desktop running.
- Supabase CLI 2.117 or a compatible 2.x release, PostgreSQL `psql`, and Bash.
- Ports 55320 through 55324 available.

## Start from a clean local database

From the repository root:

```sh
bash tools/collections-local/reset.sh --local
bash tools/collections-local/test.sh --local
```

`reset.sh` starts the isolated local Supabase project, resets only its local database, applies the safe schema subset, then the Phase 1/2 Billing and Collections migrations in order through `20261011120000`, and inserts fictional fixtures. Rerunning it discards only this local test database. `test.sh` runs the repository's SQL security, audit, stage, dynamic-configuration, primary-contact selection, and harness-schema regressions against that local database; the write tests roll back their own rows.

The API runs at `http://127.0.0.1:55321` and PostgreSQL at `127.0.0.1:55322`. Optional Supabase services are excluded to reduce the local container footprint; database inspection uses `psql`. The fictional clients are **Example Orchard LLC** and **Sample Harbor Inc** with invoices `LOCAL-001` and `LOCAL-002`. The email addresses use `.invalid` and cannot receive mail.

To inspect local connection information on your own machine, run:

```sh
supabase status --workdir tools/collections-local
```

Keep any displayed local keys in your ignored local environment file. For the app, point `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to this local project. Never copy Preview or Production values into the local test configuration. Each developer owns their own local data; Git shares the schema, fixtures, and commands.

For `.env.local`, use the local API URL and local keys printed by the `supabase status` command above:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<local anon key>
SUPABASE_SERVICE_ROLE_KEY=<local service role key>
```

Do not commit `.env.local`. After creating test users, start the app with `npm run dev` and sign in at `http://localhost:3000/login`; the script writes the five `TEST_*_EMAIL` and `TEST_*_PASSWORD` values to `.env.local` without printing passwords.

The seed includes fictional Owner, Collections staff, Admin, Billing staff, and unassigned staff profiles. The subset includes the profile fields required by the app's identity and 2FA paths. For browser sign-in, add the local URL and keys to ignored `.env.local`, then run:

```sh
node tools/collections-local/create-test-users.mjs
```

This script refuses any API URL except `http://127.0.0.1:55321`, creates Auth users with IDs matching the synthetic profiles, and writes random login passwords only to `.env.local`. Never share those local passwords or point the script at a hosted project.

## Limits of this harness

This subset supports Billing/Collections SQL and API contract checks. It is not a full clone of the Operations database; the sign-in landing page's Timesheet APIs can return 500 because Timesheet tables are intentionally excluded. Billing/Collections browser validation uses real local Auth users and the synthetic profiles provisioned above.

The local harness never sends Collections messages. Automation remains disabled and delivery mode is `disabled`.

## Handoff to Aanan

1. Check out the reviewed integration branch containing this document; do not work from `main`.
2. Run the two commands above on your own machine and record their results.
3. The UI implementation and local browser validation are on `codex/collections-phase2-ui-validation`. Rebase/replay it after the producer updates and consume `GET /api/collections/rules`, which returns the safe ladder display and `firm_timezone`. Each invoice includes server-derived `completed_stage`, `upcoming_stage`, `next_stage`, and `awaiting_approval`; do not infer progression from thresholds alone. Hold and event responses include top-level `invoice_number` (null for client-wide history).
4. Rerun the real local API/database/browser checks after integrating these producer updates: receivables, holds, approvals, a notice recorded after a later hold, reload persistence, audit rows, catch-up, an early explicit higher stage, and firm-timezone date rendering.
5. Review and merge the backend integration first, then the UI branch. Do not merge to `main` until all phase gates and owner decisions are complete and approved.

No production migration, client data, or live credential is needed for these local tests.
