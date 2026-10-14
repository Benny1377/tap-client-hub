-- Collections Phase 2 backend foundation.
-- Billing remains the only receivables source. Automation is disabled by default.
begin;

create table if not exists tap_hub_project.collection_settings (
  id text primary key default 'default' check (id = 'default'),
  automation_enabled boolean not null default false,
  delivery_mode text not null default 'disabled' check (delivery_mode in ('disabled', 'test')),
  timezone text not null default 'America/Chicago',
  send_start time not null default time '09:00',
  send_end time not null default time '17:00',
  weekdays_only boolean not null default true,
  minimum_balance numeric(12,2) not null default 50 check (minimum_balance >= 0),
  direct_escalation_threshold numeric(12,2) not null default 5000 check (direct_escalation_threshold >= 0),
  sender_name text,
  reply_to text,
  test_recipient text,
  copy_assignee boolean not null default false,
  include_payment_link boolean not null default false,
  created_by uuid references tap_hub_project.profiles(id),
  updated_by uuid references tap_hub_project.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (send_end > send_start),
  check (delivery_mode <> 'test' or test_recipient is not null)
);

insert into tap_hub_project.collection_settings(id)
values ('default') on conflict (id) do nothing;

create table if not exists tap_hub_project.collection_ladder_rules (
  stage smallint primary key check (stage between 1 and 5),
  label text not null,
  days_past_due integer not null check (days_past_due >= 1),
  automatic boolean not null default false,
  subject_template text not null,
  body_template text not null,
  enabled boolean not null default true,
  created_by uuid references tap_hub_project.profiles(id),
  updated_by uuid references tap_hub_project.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (stage < 4 or automatic = false)
);

insert into tap_hub_project.collection_ladder_rules
  (stage, label, days_past_due, automatic, subject_template, body_template)
values
  (1, 'Friendly', 1, true,
   'Reminder about invoice {invoice_number}',
   'Hello {contact_name},\n\nThis is a friendly reminder that invoice {invoice_number} for {balance} was due on {due_date}. If payment has already been arranged, please disregard this message.\n\nPlease contact our office if you have any questions.'),
  (2, 'Professional', 5, true,
   'Past due: invoice {invoice_number}',
   'Hello {contact_name},\n\nOur records show invoice {invoice_number} for {balance} is {days_past_due} days past due. Please arrange payment or let us know if payment is in progress.\n\nIf there is an issue with the invoice, please contact our office so we can review it.'),
  (3, 'Firm', 15, true,
   'Follow-up required: invoice {invoice_number}',
   'Hello {contact_name},\n\nInvoice {invoice_number} for {balance}, due {due_date}, is now {days_past_due} days past due. Please contact our office to arrange payment or discuss any question about this invoice.'),
  (4, 'Owner escalation', 21, false,
   'Owner review required: invoice {invoice_number}',
   'Internal review only. This action is never sent to the client automatically.'),
  (5, 'Formal notice', 28, false,
   'Formal notice requires approval: invoice {invoice_number}',
   'Draft only. Owner/Admin approval and separately approved wording are required before any notice is sent.')
on conflict (stage) do nothing;

create table if not exists tap_hub_project.collection_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references tap_hub_project.clients(id) on delete restrict,
  invoice_id uuid not null references tap_hub_project.invoices(id) on delete restrict,
  stage smallint not null references tap_hub_project.collection_ladder_rules(stage),
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'sent', 'suppressed', 'needs_review', 'failed')),
  idempotency_key text not null unique,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  provider_message_id text,
  recipient_hash text,
  last_error_code text,
  actor uuid references tap_hub_project.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (invoice_id, stage)
);

create index if not exists idx_collection_delivery_queue
  on tap_hub_project.collection_delivery_attempts(status, next_attempt_at)
  where status in ('queued', 'failed');
create index if not exists idx_collection_delivery_client
  on tap_hub_project.collection_delivery_attempts(client_id, created_at desc);

-- Automation configuration and delivery metadata are never directly accessible
-- to anon/authenticated clients. Server routes use the service-role client.
alter table tap_hub_project.collection_settings enable row level security;
alter table tap_hub_project.collection_ladder_rules enable row level security;
alter table tap_hub_project.collection_delivery_attempts enable row level security;
revoke all on tap_hub_project.collection_settings from anon, authenticated;
revoke all on tap_hub_project.collection_ladder_rules from anon, authenticated;
revoke all on tap_hub_project.collection_delivery_attempts from anon, authenticated;
grant all on tap_hub_project.collection_settings to service_role;
grant all on tap_hub_project.collection_ladder_rules to service_role;
grant all on tap_hub_project.collection_delivery_attempts to service_role;

drop trigger if exists audit_collection_settings on tap_hub_project.collection_settings;
create trigger audit_collection_settings after insert or update or delete on tap_hub_project.collection_settings
  for each row execute function tap_hub_project.audit_billing_row();
drop trigger if exists audit_collection_ladder_rules on tap_hub_project.collection_ladder_rules;
create trigger audit_collection_ladder_rules after insert or update or delete on tap_hub_project.collection_ladder_rules
  for each row execute function tap_hub_project.audit_billing_row();
drop trigger if exists audit_collection_delivery_attempts on tap_hub_project.collection_delivery_attempts;
create trigger audit_collection_delivery_attempts after insert or update or delete on tap_hub_project.collection_delivery_attempts
  for each row execute function tap_hub_project.audit_billing_row();

create or replace function tap_hub_project.get_collections_worklist(
  p_client_id uuid default null,
  p_as_of_date date default null,
  p_limit integer default 100,
  p_offset integer default 0
) returns jsonb
language sql stable security definer
set search_path = tap_hub_project, public
as $$
with settings as (
  select * from collection_settings where id = 'default'
), asof as (
  select coalesce(p_as_of_date, (now() at time zone coalesce((select timezone from settings), 'America/Chicago'))::date) as day,
         coalesce((select minimum_balance from settings), 50::numeric) as minimum_balance,
         coalesce((select direct_escalation_threshold from settings), 5000::numeric) as direct_escalation_threshold
), invoice_amounts as (
  select i.id as invoice_id, i.client_id, i.invoice_number, i.status, i.issue_date, i.due_date,
         coalesce(lines.invoice_total, 0)::numeric(12,2) as invoice_total,
         coalesce(allocations.allocated, 0)::numeric(12,2) as allocated
  from invoices i
  left join lateral (
    select sum(il.amount)::numeric(12,2) as invoice_total
    from invoice_lines il where il.invoice_id = i.id
  ) lines on true
  left join lateral (
    select sum(pa.amount)::numeric(12,2) as allocated
    from payment_allocations pa
    join payments p on p.id = pa.payment_id and p.status = 'recorded'
    where pa.invoice_id = i.id and pa.reversed_at is null
  ) allocations on true
  where i.status = 'issued'
), invoice_balances as (
  select ia.*, (ia.invoice_total - ia.allocated)::numeric(12,2) as balance,
         greatest((select day from asof) - ia.due_date, 0) as days_past_due
  from invoice_amounts ia
  where ia.invoice_total - ia.allocated > 0
), unallocated as (
  select p.client_id,
         sum(p.amount - coalesce(pa.used, 0))::numeric(12,2) as amount
  from payments p
  left join lateral (
    select sum(a.amount) as used from payment_allocations a
    where a.payment_id = p.id and a.reversed_at is null
  ) pa on true
  where p.status = 'recorded'
  group by p.client_id
  having sum(p.amount - coalesce(pa.used, 0)) > 0
), contacts as (
  select c.client_id,
         count(*) filter (where c.category = 'client' and c.is_primary)::integer as primary_count,
         max(c.name) filter (where c.category = 'client' and c.is_primary) as contact_name,
         max(c.email) filter (where c.category = 'client' and c.is_primary) as contact_email,
         max(c.phone) filter (where c.category = 'client' and c.is_primary) as contact_phone
  from tap_hub_project.contacts c
  group by c.client_id
), per_invoice as (
  select ib.*,
         exists (
           select 1 from collection_holds h
           where h.client_id = ib.client_id and h.released_at is null
             and (h.expires_on is null or h.expires_on >= (select day from asof))
             and (h.invoice_id is null or h.invoice_id = ib.invoice_id)
         ) as on_hold,
         coalesce((select max(e.stage) from collection_events e
           where e.invoice_id = ib.invoice_id
             and e.event_type in ('reminder_logged','escalation_requested','escalated','formal_notice_requested','formal_notice_approved','formal_notice_sent')), 0) as last_stage,
         (select max(d.stage) from collection_delivery_attempts d
           where d.invoice_id = ib.invoice_id and d.status = 'sent') as last_delivery_stage
  from invoice_balances ib
), invoice_actions as (
  select pi.*,
         greatest(pi.last_stage, coalesce(pi.last_delivery_stage, 0)) as completed_stage,
         coalesce((select max(r.stage) from collection_ladder_rules r
           where r.enabled and r.days_past_due <= pi.days_past_due), 0) as current_stage,
         (select min(r.stage) from collection_ladder_rules r
           where r.enabled and r.stage > greatest(pi.last_stage, coalesce(pi.last_delivery_stage, 0))
             and r.days_past_due <= pi.days_past_due) as next_stage
  from per_invoice pi
), account_rows as (
  select c.id as client_id, c.name as client_name,
         coalesce(ct.primary_count,0) as primary_contact_count,
         ct.contact_name, ct.contact_email, ct.contact_phone,
         coalesce(u.amount,0)::numeric(12,2) as unallocated_credit,
         coalesce(bool_or(ia.on_hold), false) as on_hold,
         count(ia.invoice_id)::integer as open_invoice_count,
         coalesce(sum(ia.balance),0)::numeric(14,2) as gross_open_balance,
         coalesce(sum(ia.balance) filter (where ia.days_past_due = 0),0)::numeric(14,2) as current_balance,
         coalesce(sum(ia.balance) filter (where ia.days_past_due between 1 and 30),0)::numeric(14,2) as days_1_30,
         coalesce(sum(ia.balance) filter (where ia.days_past_due between 31 and 60),0)::numeric(14,2) as days_31_60,
         coalesce(sum(ia.balance) filter (where ia.days_past_due between 61 and 90),0)::numeric(14,2) as days_61_90,
         coalesce(sum(ia.balance) filter (where ia.days_past_due > 90),0)::numeric(14,2) as days_over_90,
         coalesce(max(ia.days_past_due),0)::integer as oldest_days_past_due,
         coalesce(sum(ia.balance * case
           when ia.days_past_due between 21 and 30 then 1.0
           when ia.days_past_due between 31 and 60 then 1.3
           when ia.days_past_due between 61 and 90 then 1.6
           when ia.days_past_due between 91 and 180 then 2.0
           when ia.days_past_due > 180 then 2.4
           else 0 end),0)::numeric(16,2) as call_priority_score,
         coalesce(max(ia.balance) filter (where ia.balance >= (select direct_escalation_threshold from asof)),0)::numeric(12,2) as largest_high_balance_invoice,
         coalesce(jsonb_agg(jsonb_build_object(
           'invoice_id', ia.invoice_id,
           'invoice_number', ia.invoice_number,
           'issue_date', ia.issue_date,
           'due_date', ia.due_date,
           'invoice_total', ia.invoice_total::text,
           'allocated', ia.allocated::text,
           'balance', ia.balance::text,
           'days_past_due', ia.days_past_due,
           'current_stage', ia.current_stage,
           'next_stage', ia.next_stage,
           'on_hold', ia.on_hold,
           'credit_review_required', coalesce(u.amount,0) > 0,
           'contact_review_required', coalesce(ct.primary_count,0) <> 1 or nullif(trim(coalesce(ct.contact_email,'')), '') is null,
           'below_minimum', ia.balance < (select minimum_balance from asof)
         ) order by ia.due_date, ia.invoice_number) filter (where ia.invoice_id is not null), '[]'::jsonb) as invoices
  from clients c
  left join contacts ct on ct.client_id = c.id
  left join unallocated u on u.client_id = c.id
  left join invoice_actions ia on ia.client_id = c.id
  where c.status = 'active' and (p_client_id is null or c.id = p_client_id)
  group by c.id, c.name, ct.primary_count, ct.contact_name, ct.contact_email, ct.contact_phone, u.amount
), filtered_accounts as (
  select * from account_rows where open_invoice_count > 0 or unallocated_credit > 0
), summary as (
  select coalesce(sum(gross_open_balance),0)::numeric(16,2) as gross_open,
         coalesce(sum(unallocated_credit),0)::numeric(16,2) as unallocated,
         coalesce(sum(current_balance),0)::numeric(16,2) as current_due,
         coalesce(sum(days_1_30),0)::numeric(16,2) as b1,
         coalesce(sum(days_31_60),0)::numeric(16,2) as b2,
         coalesce(sum(days_61_90),0)::numeric(16,2) as b3,
         coalesce(sum(days_over_90),0)::numeric(16,2) as b4,
         coalesce(sum(open_invoice_count),0)::integer as invoice_count,
         count(*) filter (where gross_open_balance > 0)::integer as owing_accounts,
         count(*) filter (where unallocated_credit > 0)::integer as credit_review_accounts,
         count(*) filter (where open_invoice_count >= 3)::integer as chronic_accounts,
         coalesce(max(oldest_days_past_due),0)::integer as oldest_days
  from filtered_accounts
), page_accounts as (
  select * from filtered_accounts
  order by call_priority_score desc, gross_open_balance desc, client_name asc
  limit greatest(1, least(coalesce(p_limit,100),200))
  offset greatest(coalesce(p_offset,0),0)
)
select jsonb_build_object(
  'as_of_date', (select day from asof),
  'currency', 'USD',
  'summary', jsonb_build_object(
    'gross_open_balance', (select gross_open::text from summary),
    'unallocated_credit', (select unallocated::text from summary),
    'net_ar_estimate', ((select gross_open - unallocated from summary))::text,
    'aging', jsonb_build_object('current', (select current_due::text from summary), 'days_1_30', (select b1::text from summary), 'days_31_60', (select b2::text from summary), 'days_61_90', (select b3::text from summary), 'days_over_90', (select b4::text from summary)),
    'open_invoice_count', (select invoice_count from summary),
    'owing_accounts', (select owing_accounts from summary),
    'credit_review_accounts', (select credit_review_accounts from summary),
    'chronic_accounts', (select chronic_accounts from summary),
    'oldest_days_past_due', (select oldest_days from summary)
  ),
  'accounts', coalesce((select jsonb_agg(jsonb_build_object(
    'client_id', p.client_id,
    'client_name', p.client_name,
    'contact_name', p.contact_name,
    'contact_email', p.contact_email,
    'contact_phone', p.contact_phone,
    'primary_contact_count', p.primary_contact_count,
    'gross_open_balance', p.gross_open_balance::text,
    'unallocated_credit', p.unallocated_credit::text,
    'net_ar_estimate', (p.gross_open_balance-p.unallocated_credit)::text,
    'open_invoice_count', p.open_invoice_count,
    'oldest_days_past_due', p.oldest_days_past_due,
    'aging', jsonb_build_object('current',p.current_balance::text,'days_1_30',p.days_1_30::text,'days_31_60',p.days_31_60::text,'days_61_90',p.days_61_90::text,'days_over_90',p.days_over_90::text),
    'call_priority_score', p.call_priority_score::text,
    'on_hold', p.on_hold,
    'credit_review_required', p.unallocated_credit > 0,
    'contact_review_required', p.primary_contact_count <> 1 or nullif(trim(coalesce(p.contact_email,'')), '') is null,
    'largest_high_balance_invoice', p.largest_high_balance_invoice::text,
    'invoices', p.invoices
  ) order by p.call_priority_score desc,p.gross_open_balance desc,p.client_name) from page_accounts p), '[]'::jsonb),
  'pagination', jsonb_build_object('limit', greatest(1,least(coalesce(p_limit,100),200)), 'offset', greatest(coalesce(p_offset,0),0), 'total_accounts', (select count(*) from filtered_accounts))
);
$$;

revoke all on function tap_hub_project.get_collections_worklist(uuid,date,integer,integer) from public, anon, authenticated;
grant execute on function tap_hub_project.get_collections_worklist(uuid,date,integer,integer) to service_role;

commit;
