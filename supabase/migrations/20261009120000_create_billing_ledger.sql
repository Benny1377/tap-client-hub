-- Collections Phase 1: TAP Hub Billing ledger
-- Forward-only migration. Do not apply until the Phase 1 contract is approved
-- for the target hosted project.

begin;

create table if not exists tap_hub_project.invoices (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references tap_hub_project.clients(id) on delete restrict,
  invoice_number text not null unique,
  status text not null default 'draft' check (status in ('draft', 'issued', 'void')),
  issue_date date not null,
  due_date date not null,
  memo text,
  created_by uuid references tap_hub_project.profiles(id),
  created_at timestamptz not null default now(),
  voided_by uuid references tap_hub_project.profiles(id),
  voided_at timestamptz,
  void_reason text,
  check (due_date >= issue_date),
  check ((status = 'void') = (voided_at is not null))
);

create table if not exists tap_hub_project.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references tap_hub_project.invoices(id) on delete cascade,
  client_service_id uuid references tap_hub_project.client_services(id) on delete restrict,
  period text,
  description text not null,
  quantity numeric(12,4) not null default 1 check (quantity > 0),
  unit_amount numeric(12,2) not null check (unit_amount >= 0),
  amount numeric(12,2) not null check (amount >= 0),
  sort_order integer not null default 0,
  check (period is null or period ~ '^[0-9]{4}-[0-9]{2}$')
);

create table if not exists tap_hub_project.payments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references tap_hub_project.clients(id) on delete restrict,
  received_on date not null,
  amount numeric(12,2) not null check (amount > 0),
  method text not null check (method in ('check', 'ach', 'wire', 'card', 'cash', 'other')),
  reference text,
  status text not null default 'recorded' check (status in ('recorded', 'reversed')),
  created_by uuid references tap_hub_project.profiles(id),
  created_at timestamptz not null default now(),
  reversed_by uuid references tap_hub_project.profiles(id),
  reversed_at timestamptz,
  reversal_reason text,
  check ((status = 'reversed') = (reversed_at is not null))
);

create table if not exists tap_hub_project.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references tap_hub_project.payments(id) on delete restrict,
  invoice_id uuid not null references tap_hub_project.invoices(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  created_by uuid references tap_hub_project.profiles(id),
  created_at timestamptz not null default now(),
  reversed_at timestamptz
);

create table if not exists tap_hub_project.external_account_ids (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('client', 'invoice', 'payment')),
  entity_id uuid not null,
  system text not null,
  external_realm text,
  external_id text not null,
  created_at timestamptz not null default now(),
  unique (system, external_realm, entity_type, external_id)
);

create table if not exists tap_hub_project.collection_holds (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references tap_hub_project.clients(id) on delete restrict,
  invoice_id uuid references tap_hub_project.invoices(id) on delete restrict,
  reason text not null,
  placed_by uuid not null references tap_hub_project.profiles(id),
  placed_at timestamptz not null default now(),
  expires_on date,
  released_by uuid references tap_hub_project.profiles(id),
  released_at timestamptz
);

create table if not exists tap_hub_project.collection_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references tap_hub_project.clients(id) on delete restrict,
  invoice_id uuid references tap_hub_project.invoices(id) on delete restrict,
  event_type text not null check (event_type in (
    'note', 'reminder_logged', 'call_logged', 'promise_to_pay',
    'escalation_requested', 'escalated', 'formal_notice_requested',
    'formal_notice_approved', 'formal_notice_sent', 'hold_placed', 'hold_released'
  )),
  stage integer check (stage between 1 and 5),
  occurred_at timestamptz not null default now(),
  actor uuid references tap_hub_project.profiles(id),
  detail jsonb not null default '{}'::jsonb,
  approves_event_id uuid references tap_hub_project.collection_events(id)
);

create index if not exists idx_invoices_client_status on tap_hub_project.invoices(client_id, status);
create index if not exists idx_invoices_due_date on tap_hub_project.invoices(due_date) where status = 'issued';
create index if not exists idx_invoice_lines_invoice on tap_hub_project.invoice_lines(invoice_id, sort_order);
create index if not exists idx_payments_client_status on tap_hub_project.payments(client_id, status);
create index if not exists idx_allocations_invoice on tap_hub_project.payment_allocations(invoice_id);
create index if not exists idx_allocations_payment on tap_hub_project.payment_allocations(payment_id);
create index if not exists idx_external_ids_entity on tap_hub_project.external_account_ids(entity_type, entity_id);
create index if not exists idx_collection_holds_client on tap_hub_project.collection_holds(client_id, released_at);
create index if not exists idx_collection_events_client on tap_hub_project.collection_events(client_id, occurred_at desc);

-- Financial tables are server-owned. Do not repeat the legacy anon grants.
alter table tap_hub_project.invoices enable row level security;
alter table tap_hub_project.invoice_lines enable row level security;
alter table tap_hub_project.payments enable row level security;
alter table tap_hub_project.payment_allocations enable row level security;
alter table tap_hub_project.external_account_ids enable row level security;
alter table tap_hub_project.collection_holds enable row level security;
alter table tap_hub_project.collection_events enable row level security;

grant usage on schema tap_hub_project to service_role;
grant select, insert, update, delete on
  tap_hub_project.invoices,
  tap_hub_project.invoice_lines,
  tap_hub_project.payments,
  tap_hub_project.payment_allocations,
  tap_hub_project.external_account_ids,
  tap_hub_project.collection_holds,
  tap_hub_project.collection_events
to service_role;

commit;
