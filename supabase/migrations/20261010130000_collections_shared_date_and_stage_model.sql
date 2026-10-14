-- Collections review follow-up:
-- 1) Pin audit actor identity for all mutating RPCs.
-- 2) Share firm-local date and invoice balance calculation across Billing and Collections.
-- 3) Infer historical/manual collection ladder stages and expose explainable score parts.
-- Requires 20261010110000_billing_audit_and_receivables.sql and
-- 20261010120000_collections_automation_foundation.sql to be applied first.
begin;

create or replace function tap_hub_project.collections_firm_today()
returns date
language sql stable security definer
set search_path = tap_hub_project, public
as $$
  select (statement_timestamp() at time zone coalesce(
    (select nullif(timezone, '') from collection_settings where id = 'default'),
    'America/Chicago'
  ))::date;
$$;
revoke all on function tap_hub_project.collections_firm_today() from public, anon, authenticated;
grant execute on function tap_hub_project.collections_firm_today() to service_role;

-- Shared ledger math for both Billing and Collections read models.
create or replace function tap_hub_project.get_billing_invoice_balances(p_as_of_date date default null)
returns table (
  invoice_id uuid,
  client_id uuid,
  invoice_number text,
  status text,
  issue_date date,
  due_date date,
  invoice_total numeric(18,2),
  allocated numeric(18,2),
  balance numeric(18,2),
  days_past_due integer,
  aging_bucket text
)
language sql stable security definer
set search_path = tap_hub_project, public
as $$
  with asof as (
    select coalesce(p_as_of_date, collections_firm_today()) as day
  ), totals as (
    select i.id, i.client_id, i.invoice_number, i.status, i.issue_date, i.due_date,
      coalesce(lines.total, 0)::numeric(18,2) as invoice_total,
      coalesce(allocations.total, 0)::numeric(18,2) as allocated
    from invoices i
    left join lateral (
      select sum(l.amount)::numeric(18,2) as total
      from invoice_lines l where l.invoice_id = i.id
    ) lines on true
    left join lateral (
      select sum(a.amount)::numeric(18,2) as total
      from payment_allocations a
      join payments p on p.id = a.payment_id and p.status = 'recorded'
      where a.invoice_id = i.id and a.reversed_at is null
    ) allocations on true
    where i.status = 'issued'
  ), balances as (
    select t.*, greatest(t.invoice_total - t.allocated, 0)::numeric(18,2) as balance,
      case when greatest(t.invoice_total - t.allocated, 0) <= 0 then 0
        else greatest((select day from asof) - t.due_date, 0)::integer end as days_past_due
    from totals t
  )
  select b.id, b.client_id, b.invoice_number, b.status, b.issue_date, b.due_date,
    b.invoice_total, b.allocated, b.balance, b.days_past_due,
    case when b.days_past_due = 0 then 'current' when b.days_past_due <= 30 then '1_30'
      when b.days_past_due <= 60 then '31_60' when b.days_past_due <= 90 then '61_90' else '90_plus' end
  from balances b;
$$;
revoke all on function tap_hub_project.get_billing_invoice_balances(date) from public, anon, authenticated;
grant execute on function tap_hub_project.get_billing_invoice_balances(date) to service_role;

create or replace function tap_hub_project.get_billing_receivables(p_client_id uuid default null)
returns jsonb language sql stable security definer
set search_path = tap_hub_project, public as $$
with invoice_rows as (
  select b.* from get_billing_invoice_balances(collections_firm_today()) b
  where p_client_id is null or b.client_id = p_client_id
), payment_balances as (
  select p.id as payment_id, p.client_id, p.amount::numeric(18,2) as amount,
    greatest(p.amount - coalesce(sum(a.amount) filter (where a.reversed_at is null), 0), 0)::numeric(18,2) as remaining
  from payments p left join payment_allocations a on a.payment_id = p.id
  where p.status = 'recorded' and (p_client_id is null or p.client_id = p_client_id)
  group by p.id
), aging as (
  select client_id,
    sum(balance) filter (where aging_bucket = 'current') as current_due,
    sum(balance) filter (where aging_bucket = '1_30') as d1_30,
    sum(balance) filter (where aging_bucket = '31_60') as d31_60,
    sum(balance) filter (where aging_bucket = '61_90') as d61_90,
    sum(balance) filter (where aging_bucket = '90_plus') as d90_plus
  from invoice_rows where balance > 0 group by client_id
), unallocated_clients as (
  select client_id, sum(remaining)::numeric(18,2) as amount
  from payment_balances group by client_id having sum(remaining) > 0
), client_universe as (
  select client_id from aging union select client_id from unallocated_clients
)
select jsonb_build_object(
  'as_of_date', collections_firm_today(),
  'receivables', coalesce((select jsonb_agg(jsonb_build_object(
    'id', invoice_id, 'client_id', client_id, 'invoice_number', invoice_number, 'status', status,
    'issue_date', issue_date, 'due_date', due_date, 'total', invoice_total::text,
    'allocated', allocated::text, 'balance', balance::text, 'days_past_due', days_past_due,
    'aging_bucket', aging_bucket
  ) order by due_date, invoice_number) from invoice_rows), '[]'::jsonb),
  'client_aging', coalesce((select jsonb_agg(jsonb_build_object(
    'client_id', u.client_id, 'current', coalesce(a.current_due, 0)::numeric(18,2)::text,
    '1_30', coalesce(a.d1_30, 0)::numeric(18,2)::text, '31_60', coalesce(a.d31_60, 0)::numeric(18,2)::text,
    '61_90', coalesce(a.d61_90, 0)::numeric(18,2)::text, '90_plus', coalesce(a.d90_plus, 0)::numeric(18,2)::text
  ) order by u.client_id) from client_universe u left join aging a using (client_id)), '[]'::jsonb),
  'unallocated_payment_balances', coalesce((select jsonb_agg(jsonb_build_object(
    'payment_id', payment_id, 'client_id', client_id, 'amount', amount::text, 'unallocated', remaining::text
  ) order by client_id, payment_id) from payment_balances), '[]'::jsonb),
  'unallocated_payments', coalesce((select jsonb_agg(jsonb_build_object('client_id', client_id, 'amount', amount::text) order by client_id) from unallocated_clients), '[]'::jsonb),
  'unallocated_by_client', coalesce((select jsonb_agg(jsonb_build_object('client_id', client_id, 'amount', amount::text) order by client_id) from unallocated_clients), '[]'::jsonb)
);
$$;

create or replace function tap_hub_project.record_collection_event(
  p_client_id uuid, p_invoice_id uuid, p_event_type text, p_actor uuid,
  p_stage integer default null, p_detail jsonb default '{}'::jsonb,
  p_approval_event_id uuid default null
) returns uuid language plpgsql security definer
set search_path = tap_hub_project, public as $$
declare
  v_event_id uuid;
  v_approval collection_events%rowtype;
  v_stage integer := p_stage;
begin
  perform set_config('tap_hub.actor_id', p_actor::text, true);
  perform 1 from clients where id = p_client_id for update;
  if not found then raise exception 'not_found: client does not exist' using errcode = 'P0002'; end if;
  if p_event_type in ('hold_placed', 'hold_released', 'escalated', 'formal_notice_approved') then
    raise exception 'invalid_input: this event type is written only by its dedicated workflow' using errcode = '22023';
  end if;
  if p_event_type not in ('note', 'reminder_logged', 'call_logged', 'promise_to_pay', 'escalation_requested', 'formal_notice_requested', 'formal_notice_sent') then
    raise exception 'invalid_input: unsupported Collections event type' using errcode = '22023';
  end if;
  if p_event_type = 'reminder_logged' then
    if v_stage is not null and v_stage not between 1 and 3 then
      raise exception 'invalid_input: reminder stage must be 1, 2, or 3' using errcode = '22023';
    end if;
    if v_stage is null and p_invoice_id is not null then
      select max(r.stage) into v_stage
      from get_billing_invoice_balances(collections_firm_today()) b
      join collection_ladder_rules r on r.enabled and r.automatic
        and r.days_past_due <= b.days_past_due
      where b.invoice_id = p_invoice_id and b.client_id = p_client_id;
    end if;
  end if;
  if p_event_type in ('escalation_requested', 'formal_notice_requested', 'formal_notice_sent') and exists (
    select 1 from collection_holds h where h.client_id = p_client_id and h.released_at is null
      and (h.expires_on is null or h.expires_on >= collections_firm_today())
      and (h.invoice_id is null or h.invoice_id = p_invoice_id)
  ) then raise exception 'conflict: action blocked by an active Collections hold' using errcode = 'P0001'; end if;
  if p_event_type = 'formal_notice_sent' then
    if p_approval_event_id is null then raise exception 'invalid_input: approved notice event is required' using errcode = '22023'; end if;
    select * into v_approval from collection_events where id = p_approval_event_id for update;
    if not found or v_approval.event_type <> 'formal_notice_approved'
       or v_approval.client_id <> p_client_id or v_approval.invoice_id is distinct from p_invoice_id then
      raise exception 'conflict: matching formal notice approval required' using errcode = 'P0001';
    end if;
    insert into collection_events(client_id, invoice_id, event_type, actor, detail)
    values (p_client_id, p_invoice_id, p_event_type, p_actor,
      coalesce(p_detail, '{}'::jsonb) || jsonb_build_object('approval_event_id', p_approval_event_id))
    returning id into v_event_id;
  else
    insert into collection_events(client_id, invoice_id, event_type, stage, actor, detail)
    values (p_client_id, p_invoice_id, p_event_type, v_stage, p_actor, coalesce(p_detail, '{}'::jsonb))
    returning id into v_event_id;
  end if;
  return v_event_id;
end; $$;

create or replace function tap_hub_project.approve_collection_event(
  p_event_id uuid, p_event_type text, p_actor uuid, p_detail jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer
set search_path = tap_hub_project, public as $$
declare v_source collection_events%rowtype; v_event_id uuid;
begin
  perform set_config('tap_hub.actor_id', p_actor::text, true);
  select * into v_source from collection_events where id = p_event_id;
  if not found then raise exception 'not_found: source event does not exist' using errcode = 'P0002'; end if;
  perform 1 from clients where id = v_source.client_id for update;
  select * into v_source from collection_events where id = p_event_id for update;
  if (v_source.event_type = 'escalation_requested' and p_event_type <> 'escalated')
     or (v_source.event_type = 'formal_notice_requested' and p_event_type <> 'formal_notice_approved')
     or v_source.event_type not in ('escalation_requested', 'formal_notice_requested') then
    raise exception 'conflict: approval event does not match a pending request' using errcode = 'P0001';
  end if;
  if exists (select 1 from collection_events where approves_event_id = p_event_id) then
    raise exception 'conflict: source request has already been approved' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from collection_holds h where h.client_id = v_source.client_id and h.released_at is null
      and (h.expires_on is null or h.expires_on >= collections_firm_today())
      and (h.invoice_id is null or h.invoice_id = v_source.invoice_id)
  ) then raise exception 'conflict: action blocked by an active Collections hold' using errcode = 'P0001'; end if;
  insert into collection_events(client_id, invoice_id, event_type, actor, detail, approves_event_id)
  values (v_source.client_id, v_source.invoice_id, p_event_type, p_actor, coalesce(p_detail, '{}'::jsonb), p_event_id)
  returning id into v_event_id;
  return v_event_id;
end; $$;

create or replace function tap_hub_project.place_collection_hold(
  p_client_id uuid, p_invoice_id uuid, p_reason text, p_actor uuid, p_expires_on date
) returns uuid language plpgsql security definer
set search_path = tap_hub_project, public as $$
declare v_hold_id uuid;
begin
  perform set_config('tap_hub.actor_id', p_actor::text, true);
  perform 1 from clients where id = p_client_id for update;
  if not found then raise exception 'not_found: client does not exist' using errcode = 'P0002'; end if;
  if p_expires_on is not null and p_expires_on < collections_firm_today() then
    raise exception 'invalid_input: hold expiry cannot be in the past' using errcode = '22023';
  end if;
  if p_invoice_id is not null and not exists(select 1 from invoices where id = p_invoice_id and client_id = p_client_id) then
    raise exception 'invalid_input: hold invoice must belong to the selected client' using errcode = '22023';
  end if;
  insert into collection_holds(client_id, invoice_id, reason, placed_by, expires_on)
  values (p_client_id, p_invoice_id, p_reason, p_actor, p_expires_on) returning id into v_hold_id;
  insert into collection_events(client_id, invoice_id, event_type, actor, detail)
  values (p_client_id, p_invoice_id, 'hold_placed', p_actor, jsonb_build_object('hold_id', v_hold_id, 'reason', p_reason, 'expires_on', p_expires_on));
  return v_hold_id;
end; $$;

create or replace function tap_hub_project.release_collection_hold(p_hold_id uuid, p_actor uuid)
returns uuid language plpgsql security definer
set search_path = tap_hub_project, public as $$
declare v_hold collection_holds%rowtype;
begin
  perform set_config('tap_hub.actor_id', p_actor::text, true);
  select * into v_hold from collection_holds where id = p_hold_id;
  if not found then raise exception 'conflict: active hold does not exist' using errcode = 'P0001'; end if;
  perform 1 from clients where id = v_hold.client_id for update;
  select * into v_hold from collection_holds where id = p_hold_id for update;
  if not found or v_hold.released_at is not null then raise exception 'conflict: active hold does not exist' using errcode = 'P0001'; end if;
  update collection_holds set released_by = p_actor, released_at = now() where id = p_hold_id;
  insert into collection_events(client_id, invoice_id, event_type, actor, detail)
  values (v_hold.client_id, v_hold.invoice_id, 'hold_released', p_actor, jsonb_build_object('hold_id', p_hold_id, 'reason', v_hold.reason));
  return p_hold_id;
end; $$;

create or replace function tap_hub_project.reverse_payment(p_payment_id uuid, p_actor uuid, p_reason text default null)
returns void language plpgsql security definer
set search_path = tap_hub_project, public as $$
declare v_payment payments%rowtype;
begin
  perform set_config('tap_hub.actor_id', p_actor::text, true);
  select * into v_payment from payments where id = p_payment_id for update;
  if not found then raise exception 'not_found: payment does not exist' using errcode = 'P0002'; end if;
  if v_payment.status <> 'recorded' then raise exception 'invariant_violation: payment is already reversed' using errcode = 'P0001'; end if;
  if exists(select 1 from payment_allocations where payment_id = p_payment_id and reversed_at is null) then
    raise exception 'invariant_violation: reverse active allocations before reversing this payment' using errcode = 'P0001';
  end if;
  update payments set status = 'reversed', reversed_by = p_actor, reversed_at = now(), reversal_reason = p_reason where id = p_payment_id;
end; $$;

create or replace function tap_hub_project.reverse_payment_allocation(p_allocation_id uuid, p_actor uuid)
returns void language plpgsql security definer
set search_path = tap_hub_project, public as $$
declare v_allocation payment_allocations%rowtype;
begin
  perform set_config('tap_hub.actor_id', p_actor::text, true);
  select * into v_allocation from payment_allocations where id = p_allocation_id for update;
  if not found then raise exception 'not_found: allocation does not exist' using errcode = 'P0002'; end if;
  if v_allocation.reversed_at is not null then raise exception 'invariant_violation: allocation is already reversed' using errcode = 'P0001'; end if;
  update payment_allocations set reversed_at = now(), reversed_by = p_actor where id = p_allocation_id;
end; $$;

create or replace function tap_hub_project.get_collections_worklist(
  p_client_id uuid, p_as_of_date date, p_limit integer, p_offset integer, p_sort_order text
) returns jsonb language sql stable security definer
set search_path = tap_hub_project, public as $$
with settings as (
  select * from collection_settings where id = 'default'
), asof as (
  select coalesce(p_as_of_date, collections_firm_today()) as day,
    coalesce((select minimum_balance from settings), 50::numeric) as minimum_balance,
    coalesce((select direct_escalation_threshold from settings), 5000::numeric) as direct_escalation_threshold,
    coalesce((select nullif(timezone, '') from settings), 'America/Chicago') as timezone
), invoice_balances as (
  select b.* from get_billing_invoice_balances((select day from asof)) b
  where (p_client_id is null or b.client_id = p_client_id) and b.balance > 0
), unallocated as (
  select p.client_id, sum(p.amount - coalesce(pa.used, 0))::numeric(18,2) as amount
  from payments p
  left join lateral (
    select sum(a.amount) as used from payment_allocations a
    where a.payment_id = p.id and a.reversed_at is null
  ) pa on true
  where p.status = 'recorded' and (p_client_id is null or p.client_id = p_client_id)
  group by p.client_id having sum(p.amount - coalesce(pa.used, 0)) > 0
), contacts as (
  select c.client_id,
    count(*) filter (where c.category = 'client' and c.is_primary)::integer as primary_count,
    max(c.name) filter (where c.category = 'client' and c.is_primary) as contact_name,
    max(c.email) filter (where c.category = 'client' and c.is_primary) as contact_email,
    max(c.phone) filter (where c.category = 'client' and c.is_primary) as contact_phone
  from tap_hub_project.contacts c group by c.client_id
), per_invoice as (
  select b.*,
    exists(select 1 from collection_holds h where h.client_id = b.client_id and h.released_at is null
      and (h.expires_on is null or h.expires_on >= (select day from asof))
      and (h.invoice_id is null or h.invoice_id = b.invoice_id)) as on_hold,
    coalesce((select max(case
      when e.event_type in ('escalation_requested','escalated') then 4
      when e.event_type in ('formal_notice_requested','formal_notice_approved','formal_notice_sent') then 5
      when e.event_type = 'reminder_logged' then least(coalesce(e.stage,
        (select max(r.stage) from collection_ladder_rules r
         where r.enabled and r.automatic
           and r.days_past_due <= greatest((e.occurred_at at time zone (select timezone from asof))::date - b.due_date, 0))), 3)
      else null end)
      from collection_events e where e.client_id = b.client_id
        and (e.invoice_id is null or e.invoice_id = b.invoice_id)
        and (e.occurred_at at time zone (select timezone from asof))::date <= (select day from asof)), 0) as last_stage,
    (select max(d.stage) from collection_delivery_attempts d where d.invoice_id = b.invoice_id and d.status = 'sent') as last_delivery_stage
  from invoice_balances b
), actions as (
  select pi.*,
    greatest(pi.last_stage, coalesce(pi.last_delivery_stage, 0)) as completed_stage,
    coalesce((select max(r.stage) from collection_ladder_rules r where r.enabled and r.days_past_due <= pi.days_past_due), 0) as current_stage,
    (select min(r.stage) from collection_ladder_rules r
     where r.enabled and r.stage > greatest(pi.last_stage, coalesce(pi.last_delivery_stage, 0))
       and r.days_past_due <= pi.days_past_due) as next_stage
  from per_invoice pi
), account_rows as (
  select c.id as client_id, c.name as client_name,
    coalesce(ct.primary_count,0) as primary_contact_count, ct.contact_name, ct.contact_email, ct.contact_phone,
    coalesce(u.amount,0)::numeric(18,2) as unallocated_credit,
    coalesce(bool_or(a.on_hold),false) as on_hold,
    count(a.invoice_id)::integer as open_invoice_count,
    coalesce(sum(a.balance),0)::numeric(18,2) as gross_open_balance,
    coalesce(sum(a.balance) filter(where a.aging_bucket='current'),0)::numeric(18,2) as current_balance,
    coalesce(sum(a.balance) filter(where a.aging_bucket='1_30'),0)::numeric(18,2) as days_1_30,
    coalesce(sum(a.balance) filter(where a.aging_bucket='31_60'),0)::numeric(18,2) as days_31_60,
    coalesce(sum(a.balance) filter(where a.aging_bucket='61_90'),0)::numeric(18,2) as days_61_90,
    coalesce(sum(a.balance) filter(where a.aging_bucket='90_plus'),0)::numeric(18,2) as days_over_90,
    coalesce(sum(a.balance) filter(where a.days_past_due between 21 and 30),0)::numeric(18,2) as score_21_30,
    coalesce(sum(a.balance) filter(where a.days_past_due between 31 and 60),0)::numeric(18,2) as score_31_60,
    coalesce(sum(a.balance) filter(where a.days_past_due between 61 and 90),0)::numeric(18,2) as score_61_90,
    coalesce(sum(a.balance) filter(where a.days_past_due between 91 and 180),0)::numeric(18,2) as score_91_180,
    coalesce(sum(a.balance) filter(where a.days_past_due > 180),0)::numeric(18,2) as score_over_180,
    coalesce(max(a.days_past_due),0)::integer as oldest_days_past_due,
    coalesce(sum(a.balance * case when a.days_past_due between 21 and 30 then 1.0
      when a.days_past_due between 31 and 60 then 1.3 when a.days_past_due between 61 and 90 then 1.6
      when a.days_past_due between 91 and 180 then 2.0 when a.days_past_due > 180 then 2.4 else 0 end),0)::numeric(18,2) as call_priority_score,
    coalesce(max(a.balance) filter(where a.balance >= (select direct_escalation_threshold from asof)),0)::numeric(18,2) as largest_high_balance_invoice,
    coalesce(jsonb_agg(jsonb_build_object(
      'invoice_id',a.invoice_id,'invoice_number',a.invoice_number,'issue_date',a.issue_date,'due_date',a.due_date,
      'invoice_total',a.invoice_total::text,'allocated',a.allocated::text,'balance',a.balance::text,
      'days_past_due',a.days_past_due,'current_stage',a.current_stage,'next_stage',a.next_stage,
      'on_hold',a.on_hold,'credit_review_required',coalesce(u.amount,0)>0,
      'contact_review_required',coalesce(ct.primary_count,0)<>1 or nullif(trim(coalesce(ct.contact_email,'')),'') is null,
      'below_minimum',a.balance < (select minimum_balance from asof)
    ) order by a.due_date,a.invoice_number) filter(where a.invoice_id is not null),'[]'::jsonb) as invoices
  from clients c left join contacts ct on ct.client_id=c.id left join unallocated u on u.client_id=c.id
  left join actions a on a.client_id=c.id
  where c.status='active' and (p_client_id is null or c.id=p_client_id)
  group by c.id,c.name,ct.primary_count,ct.contact_name,ct.contact_email,ct.contact_phone,u.amount
), filtered_accounts as (
  select * from account_rows where open_invoice_count>0 or unallocated_credit>0
), summary as (
  select coalesce(sum(gross_open_balance),0)::numeric(18,2) as gross_open,
    coalesce(sum(unallocated_credit),0)::numeric(18,2) as unallocated,
    coalesce(sum(current_balance),0)::numeric(18,2) as current_due,
    coalesce(sum(days_1_30),0)::numeric(18,2) as b1,coalesce(sum(days_31_60),0)::numeric(18,2) as b2,
    coalesce(sum(days_61_90),0)::numeric(18,2) as b3,coalesce(sum(days_over_90),0)::numeric(18,2) as b4,
    coalesce(sum(open_invoice_count),0)::integer as invoice_count,
    count(*) filter(where gross_open_balance>0)::integer as owing_accounts,
    count(*) filter(where unallocated_credit>0)::integer as credit_review_accounts,
    count(*) filter(where open_invoice_count>=3)::integer as chronic_accounts,
    coalesce(max(oldest_days_past_due),0)::integer as oldest_days
  from filtered_accounts
), page_accounts as (
  select * from filtered_accounts
  order by case when p_sort_order='stable' then client_id::text end,
    case when p_sort_order<>'stable' then call_priority_score end desc,
    case when p_sort_order<>'stable' then gross_open_balance end desc,client_name,client_id
  limit greatest(1,least(coalesce(p_limit,100),200)) offset greatest(coalesce(p_offset,0),0)
)
select jsonb_build_object(
  'as_of_date',(select day from asof),'currency','USD',
  'summary',jsonb_build_object('gross_open_balance',(select gross_open::text from summary),
    'unallocated_credit',(select unallocated::text from summary),
    'net_ar_estimate',((select gross_open-unallocated from summary))::text,
    'aging',jsonb_build_object('current',(select current_due::text from summary),'days_1_30',(select b1::text from summary),
      'days_31_60',(select b2::text from summary),'days_61_90',(select b3::text from summary),'days_over_90',(select b4::text from summary)),
    'open_invoice_count',(select invoice_count from summary),'owing_accounts',(select owing_accounts from summary),
    'credit_review_accounts',(select credit_review_accounts from summary),'chronic_accounts',(select chronic_accounts from summary),
    'oldest_days_past_due',(select oldest_days from summary)),
  'accounts',coalesce((select jsonb_agg(jsonb_build_object(
    'client_id',p.client_id,'client_name',p.client_name,'contact_name',p.contact_name,'contact_email',p.contact_email,
    'contact_phone',p.contact_phone,'primary_contact_count',p.primary_contact_count,
    'gross_open_balance',p.gross_open_balance::text,'unallocated_credit',p.unallocated_credit::text,
    'net_ar_estimate',(p.gross_open_balance-p.unallocated_credit)::text,'open_invoice_count',p.open_invoice_count,
    'oldest_days_past_due',p.oldest_days_past_due,
    'aging',jsonb_build_object('current',p.current_balance::text,'days_1_30',p.days_1_30::text,
      'days_31_60',p.days_31_60::text,'days_61_90',p.days_61_90::text,'days_over_90',p.days_over_90::text),
    'call_priority_score',p.call_priority_score::text,
    'priority_score_components',jsonb_build_object(
      '21_30',jsonb_build_object('balance',p.score_21_30::text,'weight','1.0','weighted_amount',p.score_21_30::text),
      '31_60',jsonb_build_object('balance',p.score_31_60::text,'weight','1.3','weighted_amount',(p.score_31_60*1.3)::numeric(18,2)::text),
      '61_90',jsonb_build_object('balance',p.score_61_90::text,'weight','1.6','weighted_amount',(p.score_61_90*1.6)::numeric(18,2)::text),
      '91_180',jsonb_build_object('balance',p.score_91_180::text,'weight','2.0','weighted_amount',(p.score_91_180*2.0)::numeric(18,2)::text),
      'over_180',jsonb_build_object('balance',p.score_over_180::text,'weight','2.4','weighted_amount',(p.score_over_180*2.4)::numeric(18,2)::text),
      'score_zero_before_days_past_due',21),
    'on_hold',p.on_hold,'credit_review_required',p.unallocated_credit>0,
    'contact_review_required',p.primary_contact_count<>1 or nullif(trim(coalesce(p.contact_email,'')),'') is null,
    'largest_high_balance_invoice',p.largest_high_balance_invoice::text,'invoices',p.invoices
  ) order by case when p_sort_order='stable' then p.client_id::text end,
    case when p_sort_order<>'stable' then p.call_priority_score end desc,
    case when p_sort_order<>'stable' then p.gross_open_balance end desc,p.client_name,p.client_id)
  from page_accounts p),'[]'::jsonb),
  'pagination',jsonb_build_object('limit',greatest(1,least(coalesce(p_limit,100),200)),
    'offset',greatest(coalesce(p_offset,0),0),'total_accounts',(select count(*) from filtered_accounts))
);
$$;

create or replace function tap_hub_project.get_collections_worklist(
  p_client_id uuid default null,p_as_of_date date default null,p_limit integer default 100,p_offset integer default 0
) returns jsonb language sql stable security definer
set search_path = tap_hub_project, public
as $$ select get_collections_worklist(p_client_id,p_as_of_date,p_limit,p_offset,'priority'); $$;

revoke all on function tap_hub_project.get_billing_receivables(uuid) from public, anon, authenticated;
grant execute on function tap_hub_project.get_billing_receivables(uuid) to service_role;
revoke all on function tap_hub_project.get_collections_worklist(uuid,date,integer,integer,text) from public, anon, authenticated;
grant execute on function tap_hub_project.get_collections_worklist(uuid,date,integer,integer,text) to service_role;
revoke all on function tap_hub_project.get_collections_worklist(uuid,date,integer,integer) from public, anon, authenticated;
grant execute on function tap_hub_project.get_collections_worklist(uuid,date,integer,integer) to service_role;
revoke all on function tap_hub_project.record_collection_event(uuid,uuid,text,uuid,integer,jsonb,uuid) from public, anon, authenticated;
revoke all on function tap_hub_project.approve_collection_event(uuid,text,uuid,jsonb) from public, anon, authenticated;
revoke all on function tap_hub_project.place_collection_hold(uuid,uuid,text,uuid,date) from public, anon, authenticated;
revoke all on function tap_hub_project.release_collection_hold(uuid,uuid) from public, anon, authenticated;
revoke all on function tap_hub_project.reverse_payment(uuid,uuid,text) from public, anon, authenticated;
revoke all on function tap_hub_project.reverse_payment_allocation(uuid,uuid) from public, anon, authenticated;
grant execute on function tap_hub_project.record_collection_event(uuid,uuid,text,uuid,integer,jsonb,uuid) to service_role;
grant execute on function tap_hub_project.approve_collection_event(uuid,text,uuid,jsonb) to service_role;
grant execute on function tap_hub_project.place_collection_hold(uuid,uuid,text,uuid,date) to service_role;
grant execute on function tap_hub_project.release_collection_hold(uuid,uuid) to service_role;
grant execute on function tap_hub_project.reverse_payment(uuid,uuid,text) to service_role;
grant execute on function tap_hub_project.reverse_payment_allocation(uuid,uuid) to service_role;

commit;
