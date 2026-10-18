-- Replace ambiguous delivery claim/context reasons without rewriting history.
begin;

alter table tap_hub_project.collection_delivery_attempts
  add column if not exists payload_fingerprint text;

-- Resend requires a retried idempotency key to carry the same request body.
-- Store only a SHA-256 digest, never the rendered message or financial values.
create or replace function tap_hub_project.record_collection_test_payload_fingerprint(
  p_attempt_id uuid, p_fingerprint text, p_actor uuid default null
) returns boolean language plpgsql security definer
set search_path = tap_hub_project, public as $$
declare v_attempt collection_delivery_attempts%rowtype;
begin
  if p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_input: payload fingerprint must be a lowercase SHA-256 digest' using errcode = '22023';
  end if;
  select * into v_attempt from collection_delivery_attempts where id = p_attempt_id for update;
  if not found or v_attempt.status <> 'sending' then return false; end if;
  perform set_config('tap_hub.actor_id', coalesce(p_actor::text, ''), true);
  if v_attempt.payload_fingerprint is null then
    update collection_delivery_attempts set payload_fingerprint = p_fingerprint, actor = p_actor, updated_at = now()
      where id = p_attempt_id and status = 'sending' and payload_fingerprint is null;
    return found;
  end if;
  return v_attempt.payload_fingerprint = p_fingerprint;
end;
$$;
revoke all on function tap_hub_project.record_collection_test_payload_fingerprint(uuid, text, uuid) from public, anon, authenticated;
grant execute on function tap_hub_project.record_collection_test_payload_fingerprint(uuid, text, uuid) to service_role;

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

create or replace function tap_hub_project.get_collection_test_message_context(p_attempt_id uuid)
returns jsonb language plpgsql security definer
set search_path = tap_hub_project, public as $$
declare
  v_attempt collection_delivery_attempts%rowtype;
  v_invoice invoices%rowtype;
  v_client clients%rowtype;
  v_settings collection_settings%rowtype;
  v_balance numeric(12,2);
  v_primary integer;
  v_email integer;
  v_today date;
  v_local_time time;
begin
  select * into v_attempt from collection_delivery_attempts where id = p_attempt_id;
  if not found or v_attempt.status <> 'sending' then return jsonb_build_object('eligible', false, 'reason_code', 'ATTEMPT_ALREADY_EXISTS'); end if;
  select * into v_invoice from invoices where id = v_attempt.invoice_id;
  if not found or v_invoice.status <> 'issued' then return jsonb_build_object('eligible', false, 'reason_code', 'INVOICE_NOT_ELIGIBLE'); end if;
  select * into v_client from clients where id = v_attempt.client_id;
  if not found then return jsonb_build_object('eligible', false, 'reason_code', 'INVOICE_NOT_ELIGIBLE'); end if;
  if not v_invoice.is_synthetic or not v_client.is_synthetic then return jsonb_build_object('eligible', false, 'reason_code', 'SYNTHETIC_DATA_REQUIRED'); end if;
  select * into v_settings from collection_settings where id = 'default';
  if not found or not v_settings.automation_enabled or v_settings.delivery_mode <> 'test' then
    return jsonb_build_object('eligible', false, 'reason_code', 'DELIVERY_DISABLED');
  end if;
  v_today := (now() at time zone v_settings.timezone)::date;
  v_local_time := (now() at time zone v_settings.timezone)::time;
  if v_local_time < v_settings.send_start or v_local_time >= v_settings.send_end
    or (v_settings.weekdays_only and extract(isodow from v_today) in (6, 7)) then
    return jsonb_build_object('eligible', false, 'reason_code', 'OUTSIDE_SEND_WINDOW');
  end if;
  select coalesce(sum(l.amount), 0) - coalesce((
    select sum(a.amount) from payment_allocations a join payments p on p.id = a.payment_id
    where a.invoice_id = v_invoice.id and p.status = 'recorded' and a.reversed_at is null
  ), 0) into v_balance from invoice_lines l where l.invoice_id = v_invoice.id;
  if v_balance <= 0 or v_balance < v_settings.minimum_balance then
    return jsonb_build_object('eligible', false, 'reason_code', 'BELOW_MINIMUM_BALANCE');
  end if;
  if exists(select 1 from collection_holds h where h.client_id = v_invoice.client_id and h.released_at is null
    and (h.expires_on is null or h.expires_on >= collections_firm_today())
    and (h.invoice_id is null or h.invoice_id = v_invoice.id)) then
    return jsonb_build_object('eligible', false, 'reason_code', 'ACTIVE_HOLD');
  end if;
  if v_attempt.stage <= 3 then
    select count(*) filter (where is_primary), count(*) filter (where is_primary and email is not null and btrim(email) <> '')
      into v_primary, v_email from contacts where client_id = v_invoice.client_id and category = 'client';
    if v_primary <> 1 then return jsonb_build_object('eligible', false, 'reason_code', 'CONTACT_REVIEW_REQUIRED'); end if;
    if v_email <> 1 then return jsonb_build_object('eligible', false, 'reason_code', 'EMAIL_CONTACT_MISSING'); end if;
  end if;
  return jsonb_build_object('eligible', true, 'invoice_number', v_invoice.invoice_number,
    'balance', v_balance::text, 'due_date', v_invoice.due_date::text,
    'days_past_due', greatest(collections_firm_today() - v_invoice.due_date, 0));
end;
$$;
revoke all on function tap_hub_project.get_collection_test_message_context(uuid) from public, anon, authenticated;
grant execute on function tap_hub_project.get_collection_test_message_context(uuid) to service_role;

notify pgrst, 'reload schema';
commit;
