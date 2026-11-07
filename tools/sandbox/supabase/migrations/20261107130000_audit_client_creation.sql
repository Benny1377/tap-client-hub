-- Attribute client creation to the authenticated creator and audit the
-- business identity without copying contact details, EINs, or other PII.
begin;

alter table tap_hub_project.clients
  add column if not exists created_by uuid references tap_hub_project.profiles(id);

create or replace function tap_hub_project.audit_client_creation()
returns trigger
language plpgsql
security definer
set search_path = tap_hub_project, public
as $$
begin
  if tg_op = 'INSERT' then
    insert into tap_hub_project.audit_log(actor, action, entity, entity_id, detail)
    values (
      new.created_by,
      'insert',
      'clients',
      new.id::text,
      jsonb_build_object('name', new.name, 'type', new.type, 'status', new.status)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists audit_client_creation on tap_hub_project.clients;
create trigger audit_client_creation
  after insert on tap_hub_project.clients
  for each row execute function tap_hub_project.audit_client_creation();

commit;
