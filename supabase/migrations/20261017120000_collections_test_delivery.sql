-- Collections Phase 3: test-only delivery foundations.
-- Forward-only: preserve historical migrations and fail closed by default.
begin;

alter table tap_hub_project.clients
  add column if not exists is_synthetic boolean not null default false;
alter table tap_hub_project.invoices
  add column if not exists is_synthetic boolean not null default false;

alter table tap_hub_project.collection_delivery_attempts
  add column if not exists reason_code text;
alter table tap_hub_project.collection_delivery_attempts
  add column if not exists accepted_at timestamptz;
update tap_hub_project.collection_delivery_attempts
  set accepted_at = sent_at where status = 'sent' and accepted_at is null;

-- Keep the historical sent_at value but expose its precise meaning as accepted_at.
alter table tap_hub_project.collection_delivery_attempts
  drop constraint if exists collection_delivery_attempts_status_check;
update tap_hub_project.collection_delivery_attempts set status = 'accepted' where status = 'sent';
alter table tap_hub_project.collection_delivery_attempts
  add constraint collection_delivery_attempts_status_check
  check (status in ('queued', 'sending', 'accepted', 'suppressed', 'needs_review', 'failed'));

create index if not exists idx_collection_delivery_history
  on tap_hub_project.collection_delivery_attempts(created_at desc, id desc);
create unique index if not exists idx_collection_reminder_delivery_once
  on tap_hub_project.collection_events ((detail->>'delivery_attempt_id'))
  where event_type = 'reminder_logged' and detail ? 'delivery_attempt_id';

-- Actor-attributed, off-only pause. The env kill switch remains authoritative.
create or replace function tap_hub_project.pause_collections_automation(p_actor uuid)
returns boolean language plpgsql security definer
set search_path = tap_hub_project, public as $$
begin
  if p_actor is null or not exists(select 1 from profiles where id = p_actor) then
    raise exception 'invalid_input: actor profile is required' using errcode = '22023';
  end if;
  perform set_config('tap_hub.actor_id', p_actor::text, true);
  update collection_settings
    set automation_enabled = false, updated_by = p_actor, updated_at = now()
    where id = 'default';
  return found;
end;
$$;
revoke all on function tap_hub_project.pause_collections_automation(uuid) from public, anon, authenticated;
grant execute on function tap_hub_project.pause_collections_automation(uuid) to service_role;

-- Record provider acceptance and its one stage-1..3 event in a single transaction.
create or replace function tap_hub_project.accept_collection_delivery(
  p_attempt_id uuid, p_provider_message_id text, p_actor uuid default null
) returns boolean language plpgsql security definer
set search_path = tap_hub_project, public as $$
declare v_attempt collection_delivery_attempts%rowtype;
begin
  select * into v_attempt from collection_delivery_attempts where id = p_attempt_id for update;
  if not found or v_attempt.status <> 'sending' then return false; end if;
  perform set_config('tap_hub.actor_id', coalesce(p_actor::text, ''), true);
  update collection_delivery_attempts
    set status = 'accepted', reason_code = null,
        provider_message_id = p_provider_message_id, accepted_at = now(), sent_at = now(), updated_at = now()
    where id = p_attempt_id;
  if v_attempt.stage between 1 and 3 then
    insert into collection_events(client_id, invoice_id, event_type, stage, actor, detail)
    values (v_attempt.client_id, v_attempt.invoice_id, 'reminder_logged', v_attempt.stage,
      p_actor, jsonb_build_object('delivery_attempt_id', p_attempt_id, 'delivery_status', 'accepted'))
    on conflict do nothing;
  end if;
  return true;
end;
$$;
revoke all on function tap_hub_project.accept_collection_delivery(uuid, text, uuid) from public, anon, authenticated;
grant execute on function tap_hub_project.accept_collection_delivery(uuid, text, uuid) to service_role;

-- Claim only after a transactionally fresh eligibility check. Stages 1-3 are
-- automatic reminders; stage 4 is an internal review notice; stage 5 needs an
-- explicit formal_notice_approved event. All provider delivery stays test-only.
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
  if not found or v_invoice.status <> 'issued' then return 'SYNTHETIC_DATA_REQUIRED'; end if;
  select * into v_client from clients where id = v_attempt.client_id;
  if not found then return 'SYNTHETIC_DATA_REQUIRED'; end if;
  if not v_client.is_synthetic or not v_invoice.is_synthetic then return 'SYNTHETIC_DATA_REQUIRED'; end if;
  select * into v_rule from collection_ladder_rules where stage = v_attempt.stage;
  if not found or not v_rule.enabled or (v_attempt.stage <= 3 and not v_rule.automatic)
    or (v_attempt.stage >= 4 and v_rule.automatic) then return 'RULE_DISABLED'; end if;

  select coalesce(sum(l.amount), 0) - coalesce((
    select sum(a.amount) from payment_allocations a join payments p on p.id = a.payment_id
    where a.invoice_id = v_invoice.id and p.status = 'recorded' and a.reversed_at is null
  ), 0) into v_balance
  from invoice_lines l where l.invoice_id = v_invoice.id;
  if v_balance <= 0 then return 'BELOW_MINIMUM_BALANCE'; end if;
  if v_balance < v_settings.minimum_balance then return 'BELOW_MINIMUM_BALANCE'; end if;
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
    or (v_settings.weekdays_only and extract(isodow from v_today) in (6, 7)) then return 'RULE_DISABLED'; end if;
  if v_attempt.stage < 5 then
    v_context := collections_invoice_stage_context(v_invoice.client_id, v_invoice.id, v_invoice.due_date, v_today);
    if v_attempt.stage = 4 and v_balance >= v_settings.direct_escalation_threshold
      and coalesce((v_context->>'completed_stage')::integer, 0) < 4
      and (v_context->>'awaiting_approval') is null then
      null; -- Approved direct-escalation preview path.
    elsif (v_context->>'next_stage') is distinct from v_attempt.stage::text then
      return 'ATTEMPT_ALREADY_EXISTS';
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

-- Refresh the synthetic message values immediately before the provider call.
-- Client email/name are intentionally excluded from this function's payload.
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
begin
  select * into v_attempt from collection_delivery_attempts where id = p_attempt_id;
  if not found or v_attempt.status <> 'sending' then return jsonb_build_object('eligible', false, 'reason_code', 'ATTEMPT_ALREADY_EXISTS'); end if;
  select * into v_invoice from invoices where id = v_attempt.invoice_id and status = 'issued';
  select * into v_client from clients where id = v_attempt.client_id;
  if not found or v_invoice.id is null or not v_invoice.is_synthetic or not v_client.is_synthetic then
    return jsonb_build_object('eligible', false, 'reason_code', 'SYNTHETIC_DATA_REQUIRED');
  end if;
  select * into v_settings from collection_settings where id = 'default';
  if not found or not v_settings.automation_enabled or v_settings.delivery_mode <> 'test'
    or (now() at time zone v_settings.timezone)::time < v_settings.send_start
    or (now() at time zone v_settings.timezone)::time >= v_settings.send_end
    or (v_settings.weekdays_only and extract(isodow from now() at time zone v_settings.timezone) in (6,7)) then
    return jsonb_build_object('eligible', false, 'reason_code', 'DELIVERY_DISABLED');
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

commit;
