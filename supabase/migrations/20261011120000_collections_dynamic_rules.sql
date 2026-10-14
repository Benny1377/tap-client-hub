-- Owner/Admin-managed Collections rules and explicit primary-contact selection.
-- Configuration only: automation and email delivery remain disabled.
begin;

create or replace function tap_hub_project.update_collections_configuration(
  p_actor uuid,
  p_rules jsonb default '[]'::jsonb,
  p_settings jsonb default '{}'::jsonb
) returns boolean
language plpgsql security definer
set search_path = tap_hub_project, public
as $$
declare
  v_rule jsonb;
  v_timezone text;
  v_send_start text;
  v_send_end text;
begin
  if p_actor is null or not exists(select 1 from profiles where id = p_actor) then
    raise exception 'invalid_input: actor profile is required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_rules) <> 'array' or jsonb_typeof(p_settings) <> 'object' then
    raise exception 'invalid_input: invalid configuration payload' using errcode = '22023';
  end if;

  perform set_config('tap_hub.actor_id', p_actor::text, true);

  for v_rule in select value from jsonb_array_elements(p_rules)
  loop
    if jsonb_typeof(v_rule) <> 'object'
       or not (v_rule ? 'stage')
       or (v_rule->>'stage') !~ '^[1-5]$' then
      raise exception 'invalid_input: each rule needs a stage from 1 through 5' using errcode = '22023';
    end if;
    if v_rule ? 'automatic' and (v_rule->>'automatic')::boolean and (v_rule->>'stage')::integer >= 4 then
      raise exception 'invalid_input: approval stages cannot be automatic' using errcode = '22023';
    end if;
    update collection_ladder_rules
    set label = case when v_rule ? 'label' then v_rule->>'label' else label end,
        days_past_due = case when v_rule ? 'days_past_due' then (v_rule->>'days_past_due')::integer else days_past_due end,
        automatic = case when v_rule ? 'automatic' then (v_rule->>'automatic')::boolean else automatic end,
        enabled = case when v_rule ? 'enabled' then (v_rule->>'enabled')::boolean else enabled end,
        subject_template = case when v_rule ? 'subject_template' then v_rule->>'subject_template' else subject_template end,
        body_template = case when v_rule ? 'body_template' then v_rule->>'body_template' else body_template end,
        updated_by = p_actor,
        updated_at = now()
    where stage = (v_rule->>'stage')::integer;
    if not found then raise exception 'not_found: Collections rule does not exist' using errcode = 'P0002'; end if;
  end loop;

  v_timezone := p_settings->>'timezone';
  v_send_start := p_settings->>'send_start';
  v_send_end := p_settings->>'send_end';
  if v_timezone is not null and not exists(select 1 from pg_timezone_names where name = v_timezone) then
    raise exception 'invalid_input: timezone must be a valid IANA timezone' using errcode = '22023';
  end if;
  if v_send_start is not null and v_send_start !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'invalid_input: send_start must use HH:MM' using errcode = '22023';
  end if;
  if v_send_end is not null and v_send_end !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'invalid_input: send_end must use HH:MM' using errcode = '22023';
  end if;
  if p_settings ? 'minimum_balance' and (p_settings->>'minimum_balance')::numeric < 0 then
    raise exception 'invalid_input: minimum_balance cannot be negative' using errcode = '22023';
  end if;
  if p_settings ? 'direct_escalation_threshold' and (p_settings->>'direct_escalation_threshold')::numeric < 0 then
    raise exception 'invalid_input: direct_escalation_threshold cannot be negative' using errcode = '22023';
  end if;

  update collection_settings
  set timezone = coalesce(v_timezone, timezone),
      send_start = coalesce(v_send_start::time, send_start),
      send_end = coalesce(v_send_end::time, send_end),
      weekdays_only = case when p_settings ? 'weekdays_only' then (p_settings->>'weekdays_only')::boolean else weekdays_only end,
      minimum_balance = case when p_settings ? 'minimum_balance' then (p_settings->>'minimum_balance')::numeric else minimum_balance end,
      direct_escalation_threshold = case when p_settings ? 'direct_escalation_threshold' then (p_settings->>'direct_escalation_threshold')::numeric else direct_escalation_threshold end,
      updated_by = p_actor,
      updated_at = now()
  where id = 'default';
  return true;
end;
$$;

create or replace function tap_hub_project.set_primary_client_contact(
  p_contact_id uuid,
  p_actor uuid
) returns boolean
language plpgsql security definer
set search_path = tap_hub_project, public
as $$
declare
  v_contact contacts%rowtype;
  v_changed_id uuid;
begin
  select * into v_contact from contacts where id = p_contact_id for update;
  if not found or v_contact.category <> 'client' or v_contact.client_id is null then
    raise exception 'not_found: client contact does not exist' using errcode = 'P0002';
  end if;
  if p_actor is null or not exists(select 1 from profiles where id = p_actor) then
    raise exception 'invalid_input: actor profile is required' using errcode = '22023';
  end if;
  perform 1 from clients where id = v_contact.client_id for update;
  perform set_config('tap_hub.actor_id', p_actor::text, true);
  for v_changed_id in
    update contacts set is_primary = false
    where client_id = v_contact.client_id and category = 'client' and is_primary and id <> p_contact_id
    returning id
  loop
    insert into audit_log(actor, action, entity, entity_id, detail)
    values (p_actor, 'update', 'contacts', v_changed_id::text,
      jsonb_build_object('is_primary', false, 'selected_primary_contact_id', p_contact_id));
  end loop;
  update contacts set is_primary = true where id = p_contact_id and not is_primary;
  insert into audit_log(actor, action, entity, entity_id, detail)
  values (p_actor, 'update', 'contacts', p_contact_id::text,
    jsonb_build_object('is_primary', true, 'client_id', v_contact.client_id));
  return true;
end;
$$;

revoke all on function tap_hub_project.update_collections_configuration(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function tap_hub_project.set_primary_client_contact(uuid, uuid) from public, anon, authenticated;
grant execute on function tap_hub_project.update_collections_configuration(uuid, jsonb, jsonb) to service_role;
grant execute on function tap_hub_project.set_primary_client_contact(uuid, uuid) to service_role;

commit;
