-- Phase 1 review fixes: transaction-local audit coverage, approval uniqueness,
-- and exact-numeric receivables read model. Apply only after review.
begin;

alter table tap_hub_project.invoices
  add column if not exists updated_by uuid references tap_hub_project.profiles(id);
alter table tap_hub_project.invoice_lines
  add column if not exists created_by uuid references tap_hub_project.profiles(id),
  add column if not exists updated_by uuid references tap_hub_project.profiles(id);
alter table tap_hub_project.payment_allocations
  add column if not exists reversed_by uuid references tap_hub_project.profiles(id);
alter table tap_hub_project.external_account_ids
  add column if not exists created_by uuid references tap_hub_project.profiles(id);

create unique index if not exists uq_collection_events_approves_event
  on tap_hub_project.collection_events(approves_event_id)
  where approves_event_id is not null;
create unique index if not exists uq_collection_events_notice_sent_approval
  on tap_hub_project.collection_events ((detail->>'approval_event_id'))
  where event_type = 'formal_notice_sent' and detail ? 'approval_event_id';

create or replace function tap_hub_project.audit_billing_row()
returns trigger language plpgsql security definer
set search_path = tap_hub_project, public
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_actor uuid;
  v_id text;
  v_entity text := tg_table_name;
begin
  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
  v_id := coalesce(v_new->>'id', v_old->>'id');
  v_actor := coalesce(
    nullif(current_setting('tap_hub.actor_id', true), '')::uuid,
    nullif(coalesce(v_new, v_old)->>'actor', '')::uuid,
    nullif(coalesce(v_new, v_old)->>'updated_by', '')::uuid,
    nullif(coalesce(v_new, v_old)->>'created_by', '')::uuid,
    nullif(coalesce(v_new, v_old)->>'placed_by', '')::uuid,
    nullif(coalesce(v_new, v_old)->>'released_by', '')::uuid,
    nullif(coalesce(v_new, v_old)->>'voided_by', '')::uuid,
    nullif(coalesce(v_new, v_old)->>'reversed_by', '')::uuid
  );
  insert into tap_hub_project.audit_log(actor, action, entity, entity_id, detail)
  values (
    v_actor,
    lower(tg_op),
    v_entity,
    v_id,
    jsonb_build_object('old', v_old, 'new', v_new)
  );
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

drop trigger if exists billing_audit_invoices on tap_hub_project.invoices;
create trigger billing_audit_invoices after insert or update or delete on tap_hub_project.invoices
  for each row execute function tap_hub_project.audit_billing_row();
drop trigger if exists billing_audit_invoice_lines on tap_hub_project.invoice_lines;
create trigger billing_audit_invoice_lines after insert or update or delete on tap_hub_project.invoice_lines
  for each row execute function tap_hub_project.audit_billing_row();
drop trigger if exists billing_audit_payments on tap_hub_project.payments;
create trigger billing_audit_payments after insert or update or delete on tap_hub_project.payments
  for each row execute function tap_hub_project.audit_billing_row();
drop trigger if exists billing_audit_payment_allocations on tap_hub_project.payment_allocations;
create trigger billing_audit_payment_allocations after insert or update or delete on tap_hub_project.payment_allocations
  for each row execute function tap_hub_project.audit_billing_row();
drop trigger if exists billing_audit_collection_holds on tap_hub_project.collection_holds;
create trigger billing_audit_collection_holds after insert or update or delete on tap_hub_project.collection_holds
  for each row execute function tap_hub_project.audit_billing_row();
drop trigger if exists billing_audit_collection_events on tap_hub_project.collection_events;
create trigger billing_audit_collection_events after insert or update or delete on tap_hub_project.collection_events
  for each row execute function tap_hub_project.audit_billing_row();
drop trigger if exists billing_audit_external_account_ids on tap_hub_project.external_account_ids;
create trigger billing_audit_external_account_ids after insert or update or delete on tap_hub_project.external_account_ids
  for each row execute function tap_hub_project.audit_billing_row();

create or replace function tap_hub_project.record_collection_event(
  p_client_id uuid, p_invoice_id uuid, p_event_type text, p_actor uuid,
  p_stage integer default null, p_detail jsonb default '{}'::jsonb,
  p_approval_event_id uuid default null
) returns uuid language plpgsql security definer
set search_path = tap_hub_project, public as $$
declare v_event_id uuid; v_approval collection_events%rowtype;
begin
  perform 1 from clients where id = p_client_id for update;
  if not found then raise exception 'not_found: client does not exist' using errcode = 'P0002'; end if;
  if p_event_type in ('hold_placed', 'hold_released', 'escalated', 'formal_notice_approved') then
    raise exception 'invalid_input: this event type is written only by its dedicated workflow' using errcode = '22023';
  end if;
  if p_event_type not in ('note', 'reminder_logged', 'call_logged', 'promise_to_pay', 'escalation_requested', 'formal_notice_requested', 'formal_notice_sent') then
    raise exception 'invalid_input: unsupported Collections event type' using errcode = '22023';
  end if;
  if p_event_type in ('escalation_requested', 'formal_notice_requested', 'formal_notice_sent') and exists (
    select 1 from collection_holds h where h.client_id = p_client_id and h.released_at is null
      and (h.expires_on is null or h.expires_on >= current_date)
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
    values (p_client_id, p_invoice_id, p_event_type, p_stage, p_actor, coalesce(p_detail, '{}'::jsonb))
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
      and (h.expires_on is null or h.expires_on >= current_date)
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
  perform 1 from clients where id = p_client_id for update;
  if not found then raise exception 'not_found: client does not exist' using errcode = 'P0002'; end if;
  if p_expires_on is not null and p_expires_on < current_date then
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

revoke all on function tap_hub_project.record_collection_event(uuid, uuid, text, uuid, integer, jsonb, uuid) from public, anon, authenticated;
revoke all on function tap_hub_project.approve_collection_event(uuid, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function tap_hub_project.place_collection_hold(uuid, uuid, text, uuid, date) from public, anon, authenticated;
revoke all on function tap_hub_project.release_collection_hold(uuid, uuid) from public, anon, authenticated;
grant execute on function tap_hub_project.record_collection_event(uuid, uuid, text, uuid, integer, jsonb, uuid) to service_role;
grant execute on function tap_hub_project.approve_collection_event(uuid, text, uuid, jsonb) to service_role;
grant execute on function tap_hub_project.place_collection_hold(uuid, uuid, text, uuid, date) to service_role;
grant execute on function tap_hub_project.release_collection_hold(uuid, uuid) to service_role;

-- Replace the earlier reversal procedures: the row trigger now writes the
-- audit record in the same transaction and captures the authenticated actor.
create or replace function tap_hub_project.reverse_payment(
  p_payment_id uuid, p_actor uuid, p_reason text default null
) returns void language plpgsql security definer
set search_path = tap_hub_project, public as $$
declare v_payment payments%rowtype;
begin
  select * into v_payment from payments where id = p_payment_id for update;
  if not found then raise exception 'not_found: payment does not exist' using errcode = 'P0002'; end if;
  if v_payment.status <> 'recorded' then raise exception 'invariant_violation: payment is already reversed' using errcode = 'P0001'; end if;
  if exists(select 1 from payment_allocations where payment_id = p_payment_id and reversed_at is null) then
    raise exception 'invariant_violation: reverse active allocations before reversing this payment' using errcode = 'P0001';
  end if;
  update payments set status = 'reversed', reversed_by = p_actor, reversed_at = now(), reversal_reason = p_reason where id = p_payment_id;
end; $$;

create or replace function tap_hub_project.delete_draft_invoice(p_invoice_id uuid, p_actor uuid)
returns boolean language plpgsql security definer
set search_path = tap_hub_project, public as $$
declare v_invoice invoices%rowtype;
begin
  select * into v_invoice from invoices where id = p_invoice_id for update;
  if not found then raise exception 'not_found: invoice does not exist' using errcode = 'P0002'; end if;
  if v_invoice.status <> 'draft' then raise exception 'conflict: only draft invoices can be deleted' using errcode = 'P0001'; end if;
  perform set_config('tap_hub.actor_id', p_actor::text, true);
  delete from invoices where id = p_invoice_id;
  return true;
end; $$;

create or replace function tap_hub_project.delete_draft_invoice_line(p_line_id uuid, p_actor uuid)
returns boolean language plpgsql security definer
set search_path = tap_hub_project, public as $$
declare v_line invoice_lines%rowtype; v_invoice invoices%rowtype;
begin
  select * into v_line from invoice_lines where id = p_line_id for update;
  if not found then raise exception 'not_found: invoice line does not exist' using errcode = 'P0002'; end if;
  select * into v_invoice from invoices where id = v_line.invoice_id for update;
  if not found or v_invoice.status <> 'draft' then raise exception 'conflict: invoice lines can only be deleted while invoice is draft' using errcode = 'P0001'; end if;
  perform set_config('tap_hub.actor_id', p_actor::text, true);
  delete from invoice_lines where id = p_line_id;
  return true;
end; $$;

revoke all on function tap_hub_project.delete_draft_invoice(uuid, uuid) from public, anon, authenticated;
revoke all on function tap_hub_project.delete_draft_invoice_line(uuid, uuid) from public, anon, authenticated;
grant execute on function tap_hub_project.delete_draft_invoice(uuid, uuid) to service_role;
grant execute on function tap_hub_project.delete_draft_invoice_line(uuid, uuid) to service_role;

create or replace function tap_hub_project.reverse_payment_allocation(
  p_allocation_id uuid, p_actor uuid
) returns void language plpgsql security definer
set search_path = tap_hub_project, public as $$
declare v_allocation payment_allocations%rowtype;
begin
  select * into v_allocation from payment_allocations where id = p_allocation_id for update;
  if not found then raise exception 'not_found: allocation does not exist' using errcode = 'P0002'; end if;
  if v_allocation.reversed_at is not null then raise exception 'invariant_violation: allocation is already reversed' using errcode = 'P0001'; end if;
  update payment_allocations set reversed_at = now(), reversed_by = p_actor where id = p_allocation_id;
end; $$;

revoke all on function tap_hub_project.reverse_payment(uuid, uuid, text) from public, anon, authenticated;
revoke all on function tap_hub_project.reverse_payment_allocation(uuid, uuid) from public, anon, authenticated;
grant execute on function tap_hub_project.reverse_payment(uuid, uuid, text) to service_role;
grant execute on function tap_hub_project.reverse_payment_allocation(uuid, uuid) to service_role;

create or replace function tap_hub_project.get_billing_receivables(p_client_id uuid default null)
returns jsonb language sql stable security definer
set search_path = tap_hub_project, public as $$
with invoice_totals as (
  select i.id, i.client_id, i.invoice_number, i.status, i.issue_date, i.due_date,
    coalesce((select sum(l.amount) from invoice_lines l where l.invoice_id = i.id), 0)::numeric(18,2) as total,
    coalesce((select sum(a.amount) from payment_allocations a where a.invoice_id = i.id and a.reversed_at is null), 0)::numeric(18,2) as allocated
  from invoices i
  where i.status = 'issued' and (p_client_id is null or i.client_id = p_client_id)
), invoice_rows as (
  select it.*, greatest(it.total - it.allocated, 0)::numeric(18,2) as balance,
    case when greatest(it.total - it.allocated, 0) = 0 then 0 else greatest(current_date - it.due_date, 0) end as days_past_due
  from invoice_totals it
), payment_balances as (
  select p.id as payment_id, p.client_id, p.amount::numeric(18,2) as amount,
    greatest(p.amount - coalesce(sum(a.amount) filter (where a.reversed_at is null), 0), 0)::numeric(18,2) as remaining
  from payments p left join payment_allocations a on a.payment_id = p.id
  where p.status = 'recorded' and (p_client_id is null or p.client_id = p_client_id)
  group by p.id
), aging as (
  select client_id,
    sum(balance) filter (where days_past_due = 0) as current_due,
    sum(balance) filter (where days_past_due between 1 and 30) as d1_30,
    sum(balance) filter (where days_past_due between 31 and 60) as d31_60,
    sum(balance) filter (where days_past_due between 61 and 90) as d61_90,
    sum(balance) filter (where days_past_due > 90) as d90_plus
  from invoice_rows group by client_id
), unallocated_clients as (
  select client_id, sum(remaining)::numeric(18,2) as amount from payment_balances group by client_id
), client_universe as (
  select client_id from aging union select client_id from unallocated_clients
)
select jsonb_build_object(
  'receivables', coalesce((select jsonb_agg(jsonb_build_object(
    'id', id, 'client_id', client_id, 'invoice_number', invoice_number, 'status', status,
    'issue_date', issue_date, 'due_date', due_date, 'total', total::text,
    'allocated', allocated::text, 'balance', balance::text,
    'days_past_due', days_past_due,
    'aging_bucket', case when days_past_due = 0 then 'current' when days_past_due <= 30 then '1_30' when days_past_due <= 60 then '31_60' when days_past_due <= 90 then '61_90' else '90_plus' end
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
); $$;

revoke all on function tap_hub_project.get_billing_receivables(uuid) from public, anon, authenticated;
grant execute on function tap_hub_project.get_billing_receivables(uuid) to service_role;

commit;
