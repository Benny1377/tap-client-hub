begin;

create or replace function tap_hub_project.record_billing_audit(
  p_actor uuid,
  p_action text,
  p_entity text,
  p_entity_id text default null,
  p_detail jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = tap_hub_project, public
as $$
begin
  insert into tap_hub_project.audit_log(actor, action, entity, entity_id, detail)
  values (p_actor, p_action, p_entity, p_entity_id, coalesce(p_detail, '{}'::jsonb));
end;
$$;

revoke all on function tap_hub_project.record_billing_audit(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function tap_hub_project.record_billing_audit(uuid, text, text, text, jsonb) to service_role;

commit;
