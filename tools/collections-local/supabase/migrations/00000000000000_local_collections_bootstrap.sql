-- Local Collections test boundary only. The production TAP Hub schema has
-- older, non-reproducible history and must never be replaced by this subset.
create schema if not exists tap_hub_project;
grant usage on schema tap_hub_project to service_role;

create table tap_hub_project.profiles (
  id uuid primary key,
  full_name text not null,
  email text,
  role text not null,
  active boolean not null default true,
  modules text[] not null default '{}',
  can_manage_users boolean not null default false
);

create table tap_hub_project.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null default 'business',
  status text not null default 'active'
);

create table tap_hub_project.client_services (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references tap_hub_project.clients(id)
);

create table tap_hub_project.contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references tap_hub_project.clients(id),
  category text not null default 'client',
  is_primary boolean not null default false,
  name text,
  email text,
  phone text
);

create table tap_hub_project.audit_log (
  id bigint generated always as identity primary key,
  actor uuid,
  action text,
  entity text,
  entity_id text,
  detail jsonb,
  at timestamptz not null default now()
);

grant all on all tables in schema tap_hub_project to service_role;
grant all on all sequences in schema tap_hub_project to service_role;
