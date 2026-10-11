-- Configuration and primary-contact selection must be actor-audited and atomic.
-- This test uses only the seeded synthetic profile/client records and rolls back.
begin;
do $$
declare
  v_owner uuid := '00000000-0000-4000-8000-000000000001';
  v_client uuid := '10000000-0000-4000-8000-000000000001';
  v_existing_contact uuid;
  v_new_contact uuid;
  v_primary_count integer;
  v_rule_auto boolean;
  v_minimum numeric;
begin
  insert into tap_hub_project.contacts(client_id, category, is_primary, name, email)
  values (v_client, 'client', true, 'Alternate Example', 'alternate@example.invalid')
  returning id into v_new_contact;
  select id into v_existing_contact from tap_hub_project.contacts
    where client_id = v_client and name = 'Alex Example';

  perform tap_hub_project.set_primary_client_contact(v_new_contact, v_owner);
  select count(*) into v_primary_count from tap_hub_project.contacts
    where client_id = v_client and category = 'client' and is_primary;
  if v_primary_count <> 1 or not exists(select 1 from tap_hub_project.contacts where id = v_new_contact and is_primary) then
    raise exception 'Explicit contact selection must leave exactly one remembered primary';
  end if;
  if not exists(select 1 from tap_hub_project.audit_log where actor = v_owner and entity = 'contacts' and entity_id = v_existing_contact::text and detail->>'is_primary' = 'false')
     or not exists(select 1 from tap_hub_project.audit_log where actor = v_owner and entity = 'contacts' and entity_id = v_new_contact::text and detail->>'is_primary' = 'true') then
    raise exception 'Primary contact changes must have actor-attributed audit rows';
  end if;

  perform tap_hub_project.update_collections_configuration(
    v_owner,
    '[{"stage":2,"days_past_due":7,"automatic":true,"subject_template":"Updated {invoice_number}","body_template":"Hello {contact_name}"}]'::jsonb,
    '{"minimum_balance":75,"direct_escalation_threshold":6000,"send_start":"08:30","send_end":"16:30","weekdays_only":false,"timezone":"America/Los_Angeles"}'::jsonb
  );
  select minimum_balance into v_minimum from tap_hub_project.collection_settings where id = 'default';
  select automatic into v_rule_auto from tap_hub_project.collection_ladder_rules where stage = 2;
  if v_minimum <> 75 or not v_rule_auto then raise exception 'Owner configuration changes did not persist'; end if;
  if not exists(select 1 from tap_hub_project.audit_log where actor = v_owner and entity = 'collection_settings' and action = 'update')
     or not exists(select 1 from tap_hub_project.audit_log where actor = v_owner and entity = 'collection_ladder_rules' and action = 'update') then
    raise exception 'Rule and guardrail changes must have actor-attributed audit rows';
  end if;

  begin
    perform tap_hub_project.update_collections_configuration(v_owner, '[{"stage":4,"automatic":true}]'::jsonb, '{}'::jsonb);
    raise exception 'Automatic stage 4 should be rejected';
  exception when sqlstate '22023' then null;
  end;
end;
$$;
rollback;
