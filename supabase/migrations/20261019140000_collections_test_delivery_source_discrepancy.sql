-- Defense in depth: recheck imported-source discrepancy state transactionally
-- at the database claim boundary, even if the application pre-check is bypassed.
begin;

create or replace function tap_hub_project.claim_collection_test_delivery(
  p_attempt_id uuid, p_actor uuid default null
) returns text language plpgsql security definer
set search_path = tap_hub_project, public as $$
declare
  v_attempt collection_delivery_attempts%rowtype;
  v_invoice invoices%rowtype;
  v_client clients%rowtype;
  v_settings collection_settings%rowtype;
  v_rule collection_ladder_rules%rowtype;
  v_balance numeric(12,2);
  v_unallocated numeric(12,2);
  v_context jsonb;
  v_primary_count integer;
  v_email_count integer;
  v_today date;
  v_local_time time;
begin
  select * into v_attempt from collection_delivery_attempts where id = p_attempt_id for update;
  if not found or v_attempt.status <> 'queued' then return 'ATTEMPT_ALREADY_EXISTS'; end if;
  if v_attempt.stage not between 1 and 5 then return 'APPROVAL_REQUIRED'; end if;
  select * into v_settings from collection_settings where id = 'default';
  if not found or not v_settings.automation_enabled or v_settings.delivery_mode <> 'test' then return 'DELIVERY_DISABLED'; end if;
  select * into v_invoice from invoices where id = v_attempt.invoice_id for update;
  if not found or v_invoice.status <> 'issued' then return 'INVOICE_NOT_ELIGIBLE'; end if;
  select * into v_client from clients where id = v_attempt.client_id;
  if not found then return 'INVOICE_NOT_ELIGIBLE'; end if;
  if not v_client.is_synthetic or not v_invoice.is_synthetic then return 'SYNTHETIC_DATA_REQUIRED'; end if;

  -- For linked Billing invoices, the most recent approved/blocked snapshot for
  -- any linked PDF identity is authoritative. Any still-blocked identity stops
  -- delivery. This mirrors the runner's pre-check and fails closed on SQL errors.
  if exists (
    select 1
    from (
      select distinct on (i.source_invoice_id) i.discrepancy_status
      from collection_source_invoice_identities s
      join collection_import_invoices i using (source_invoice_id)
      where s.linked_invoice_id = v_attempt.invoice_id
        and i.review_status in ('approved', 'blocked')
      order by i.source_invoice_id, i.updated_at desc, i.created_at desc, i.id desc
    ) as latest_snapshots
    where latest_snapshots.discrepancy_status = 'blocked'
  ) then return 'SOURCE_DISCREPANCY_BLOCKED'; end if;

  select * into v_rule from collection_ladder_rules where stage = v_attempt.stage;
  if not found or not v_rule.enabled or (v_attempt.stage <= 3 and not v_rule.automatic)
    or (v_attempt.stage >= 4 and v_rule.automatic) then return 'RULE_DISABLED'; end if;

  select coalesce(sum(l.amount), 0) - coalesce((
    select sum(a.amount) from payment_allocations a join payments p on p.id = a.payment_id
    where a.invoice_id = v_invoice.id and p.status = 'recorded' and a.reversed_at is null
  ), 0) into v_balance
  from invoice_lines l where l.invoice_id = v_invoice.id;
  if v_balance <= 0 or v_balance < v_settings.minimum_balance then return 'BELOW_MINIMUM_BALANCE'; end if;
  if exists(select 1 from collection_holds h where h.client_id = v_invoice.client_id and h.released_at is null
    and (h.expires_on is null or h.expires_on >= collections_firm_today())
    and (h.invoice_id is null or h.invoice_id = v_invoice.id)) then return 'ACTIVE_HOLD'; end if;
  select coalesce(sum(p.amount - coalesce(a.used, 0)), 0) into v_unallocated
  from payments p left join lateral (
    select sum(pa.amount) as used from payment_allocations pa
    where pa.payment_id = p.id and pa.reversed_at is null
  ) a on true where p.client_id = v_invoice.client_id and p.status = 'recorded';
  if v_attempt.stage <= 3 then
    if v_unallocated > 0 then return 'UNALLOCATED_CREDIT_REVIEW'; end if;
    select count(*) filter (where is_primary), count(*) filter (where is_primary and email is not null and btrim(email) <> '')
      into v_primary_count, v_email_count from contacts where client_id = v_invoice.client_id and category = 'client';
    if v_primary_count <> 1 then return 'CONTACT_REVIEW_REQUIRED'; end if;
    if v_email_count <> 1 then return 'EMAIL_CONTACT_MISSING'; end if;
  end if;
  v_today := (now() at time zone v_settings.timezone)::date;
  v_local_time := (now() at time zone v_settings.timezone)::time;
  if v_local_time < v_settings.send_start or v_local_time >= v_settings.send_end
    or (v_settings.weekdays_only and extract(isodow from v_today) in (6, 7)) then return 'OUTSIDE_SEND_WINDOW'; end if;
  if v_attempt.stage < 5 then
    v_context := collections_invoice_stage_context(v_invoice.client_id, v_invoice.id, v_invoice.due_date, v_today);
    if v_attempt.stage = 4 and v_balance >= v_settings.direct_escalation_threshold
      and coalesce((v_context->>'completed_stage')::integer, 0) < 4
      and (v_context->>'awaiting_approval') is null then
      null; -- Approved direct-escalation preview path.
    elsif (v_context->>'next_stage') is distinct from v_attempt.stage::text then
      return 'STAGE_NOT_DUE';
    end if;
  elsif not exists(select 1 from collection_events e where e.invoice_id = v_invoice.id and e.event_type = 'formal_notice_approved')
    or exists(select 1 from collection_events e where e.invoice_id = v_invoice.id and e.event_type = 'formal_notice_sent') then
    return 'APPROVAL_REQUIRED';
  end if;
  perform set_config('tap_hub.actor_id', coalesce(p_actor::text, ''), true);
  update collection_delivery_attempts set status = 'sending', attempt_count = attempt_count + 1,
    actor = p_actor, reason_code = null, updated_at = now()
    where id = p_attempt_id and status = 'queued';
  if not found then return 'ATTEMPT_ALREADY_EXISTS'; end if;
  return null;
end;
$$;
revoke all on function tap_hub_project.claim_collection_test_delivery(uuid, uuid) from public, anon, authenticated;
grant execute on function tap_hub_project.claim_collection_test_delivery(uuid, uuid) to service_role;

commit;
