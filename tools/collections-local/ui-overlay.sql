-- LOCAL ONLY. Engineer A overlay for browser/API validation on the disposable
-- tools/collections-local stack. Apply after reset.sh; never against hosted data:
--   psql postgresql://postgres:postgres@127.0.0.1:55322/postgres -f tools/collections-local/ui-overlay.sql
--
-- 1) The harness profiles table is a subset. The app's identity lookup
--    (lib/access-server.ts) and 2FA status check also select these columns;
--    without them every signed-in request resolves no identity and returns 401.
alter table tap_hub_project.profiles
  add column if not exists location text,
  add column if not exists allow_edit_client_data boolean not null default false,
  add column if not exists email_2fa_enabled boolean not null default false;

-- 2) Extra fictional profiles so every access level can be exercised.
insert into tap_hub_project.profiles (id, full_name, email, role, modules)
values
  ('00000000-0000-4000-8000-000000000003', 'Local Admin', 'admin@example.invalid', 'admin', '{}'),
  ('00000000-0000-4000-8000-000000000004', 'Local Billing Staff', 'billing@example.invalid', 'staff', '{billing}'),
  ('00000000-0000-4000-8000-000000000005', 'Local Unassigned Staff', 'unassigned@example.invalid', 'staff', '{timesheet}')
on conflict (id) do nothing;

notify pgrst, 'reload schema';
