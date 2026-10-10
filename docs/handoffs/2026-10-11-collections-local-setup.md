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

`reset.sh` starts the isolated local Supabase project, resets only its local database, applies the safe schema subset, then the Phase 1/2 Billing and Collections migrations in order through `20261011100000`, and inserts fictional fixtures. Rerunning it discards only this local test database. `test.sh` runs the repository's SQL security, audit, and stage regressions against that local database; the write tests roll back their own rows.

The API runs at `http://127.0.0.1:55321` and PostgreSQL at `127.0.0.1:55322`. Optional Supabase services are excluded to reduce the local container footprint; database inspection uses `psql`. The fictional clients are **Example Orchard LLC** and **Sample Harbor Inc** with invoices `LOCAL-001` and `LOCAL-002`. The email addresses use `.invalid` and cannot receive mail.

To inspect local connection information on your own machine, run:

```sh
supabase status --workdir tools/collections-local
```

Keep any displayed local keys in your ignored local environment file. For the app, point `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to this local project. Never copy Preview or Production values into the local test configuration. Each developer owns their own local data; Git shares the schema, fixtures, and commands.

## Limits of this harness

This subset supports Billing/Collections SQL and API contract checks. It is not a full clone of the Operations database. Browser testing still requires local Auth users whose IDs match active `tap_hub_project.profiles` rows, plus the app's normal local-only sign-in configuration. The producer and Aanan must confirm those login and UI-to-API-to-database flows before sign-off. A passing SQL suite alone does not establish that integrated gate.

The local harness never sends Collections messages. Automation remains disabled and delivery mode is `disabled`.

## Handoff to Aanan

1. Check out the reviewed integration branch containing this document; do not work from `main`.
2. Run the two commands above on your own machine and record their results.
3. Wire the UI to `GET /api/collections/rules`, which returns `{ rules: [{ stage, label, days_past_due, automatic, enabled }] }`. Hold and event responses now include top-level `invoice_number` (null for client-wide history).
4. Exercise the real local API and database for Owner/Admin and restricted staff: receivables, holds, approvals, a notice recorded after a later hold, reload persistence, audit rows, and stage catch-up. Record any mismatch with request/response shape and the relevant local SQL evidence. The UI's previous mock browser pass is not this gate.
5. Send the final UI commit and test evidence for joint review. Do not merge or push to `main` until every phase is complete and approved.

No production migration, client data, or live credential is needed for these local tests.
