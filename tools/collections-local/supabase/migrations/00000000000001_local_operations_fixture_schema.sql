-- Local-only Operations shape required by the Billing Phase 2 synthetic harness.
-- This migration is intentionally confined to tools/collections-local.
begin;

create table if not exists tap_hub_project.services (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  active boolean not null default true,
  tracking text not null check (tracking in ('stage', 'count', 'manual'))
);

alter table tap_hub_project.client_services
  add column if not exists service_id uuid references tap_hub_project.services(id),
  add column if not exists active boolean not null default true,
  add column if not exists frequency text;

create table if not exists tap_hub_project.work_periods (
  id uuid primary key default gen_random_uuid(),
  client_service_id uuid not null references tap_hub_project.client_services(id) on delete cascade,
  period text not null check (period ~ '^[0-9]{4}-[0-9]{2}$'),
  stage text not null check (stage in ('not_started', 'in_progress', 'done')),
  done_at timestamptz,
  unique (client_service_id, period),
  check ((stage = 'done') = (done_at is not null))
);

create table if not exists tap_hub_project.period_counts (
  client_service_id uuid not null references tap_hub_project.client_services(id) on delete cascade,
  period text not null check (period ~ '^[0-9]{4}-[0-9]{2}$'),
  processed integer not null default 0 check (processed >= 0),
  expected integer check (expected is null or expected >= 0),
  primary key (client_service_id, period)
);

create index if not exists local_client_services_active_service_idx
  on tap_hub_project.client_services(service_id) where active;

commit;
