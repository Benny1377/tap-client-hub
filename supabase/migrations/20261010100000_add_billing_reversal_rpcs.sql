begin;

create or replace function tap_hub_project.reverse_payment(
  p_payment_id uuid,
  p_actor uuid,
  p_reason text default null
) returns void
language plpgsql
security definer
set search_path = tap_hub_project, public
as $$
declare
  v_payment payments%rowtype;
  v_active_allocations integer;
begin
  select * into v_payment from payments where id = p_payment_id for update;
  if not found then raise exception 'not_found: payment does not exist' using errcode = 'P0002'; end if;
  if v_payment.status <> 'recorded' then raise exception 'invariant_violation: payment is already reversed' using errcode = 'P0001'; end if;
  select count(*) into v_active_allocations from payment_allocations where payment_id = p_payment_id and reversed_at is null;
  if v_active_allocations > 0 then raise exception 'invariant_violation: reverse active allocations before reversing this payment' using errcode = 'P0001'; end if;
  update payments set status = 'reversed', reversed_by = p_actor, reversed_at = now(), reversal_reason = p_reason where id = p_payment_id;
  insert into audit_log(actor, action, entity, entity_id, detail) values (p_actor, 'reverse', 'payment', p_payment_id::text, jsonb_build_object('reason', p_reason));
end;
$$;

create or replace function tap_hub_project.reverse_payment_allocation(
  p_allocation_id uuid,
  p_actor uuid
) returns void
language plpgsql
security definer
set search_path = tap_hub_project, public
as $$
declare v_allocation payment_allocations%rowtype;
begin
  select * into v_allocation from payment_allocations where id = p_allocation_id for update;
  if not found then raise exception 'not_found: allocation does not exist' using errcode = 'P0002'; end if;
  if v_allocation.reversed_at is not null then raise exception 'invariant_violation: allocation is already reversed' using errcode = 'P0001'; end if;
  update payment_allocations set reversed_at = now() where id = p_allocation_id;
  insert into audit_log(actor, action, entity, entity_id, detail) values (p_actor, 'reverse', 'payment_allocation', p_allocation_id::text, '{}'::jsonb);
end;
$$;

revoke all on function tap_hub_project.reverse_payment(uuid, uuid, text) from public, anon, authenticated;
revoke all on function tap_hub_project.reverse_payment_allocation(uuid, uuid) from public, anon, authenticated;
grant execute on function tap_hub_project.reverse_payment(uuid, uuid, text) to service_role;
grant execute on function tap_hub_project.reverse_payment_allocation(uuid, uuid) to service_role;

commit;
