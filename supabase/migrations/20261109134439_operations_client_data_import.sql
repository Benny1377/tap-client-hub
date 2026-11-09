begin;

alter table tap_hub_project.clients
  add column if not exists operations_source_client_id uuid,
  add column if not exists operations_client_code text;

alter table tap_hub_project.contacts
  add column if not exists operations_source_contact_id uuid;

create unique index if not exists clients_operations_source_client_id_uidx
  on tap_hub_project.clients (operations_source_client_id)
  where operations_source_client_id is not null;

create unique index if not exists contacts_operations_source_contact_id_uidx
  on tap_hub_project.contacts (operations_source_contact_id)
  where operations_source_contact_id is not null;

create or replace function tap_hub_project.import_operations_client_data(
  p_actor uuid,
  p_clients jsonb,
  p_contacts jsonb,
  p_apply boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = tap_hub_project, public
as $$
declare
  v_client jsonb;
  v_contact jsonb;
  v_existing_id uuid;
  v_match_count integer;
  v_created integer := 0;
  v_updated integer := 0;
  v_contacts_created integer := 0;
  v_contacts_updated integer := 0;
  v_primary_set integer := 0;
  v_conflicts jsonb := '[]'::jsonb;
  v_map jsonb := '{}'::jsonb;
  v_source_id uuid;
  v_contact_id uuid;
  v_primary_contact_id uuid;
  v_changed integer;
begin
  if p_actor is null or not exists (
    select 1 from profiles
    where id = p_actor and active is distinct from false
      and lower(role) in ('owner', 'admin')
  ) then
    raise exception 'operations_import_forbidden';
  end if;
  if jsonb_typeof(p_clients) <> 'array' or jsonb_typeof(p_contacts) <> 'array'
     or jsonb_array_length(p_clients) > 2000 or jsonb_array_length(p_contacts) > 5000 then
    raise exception 'operations_import_invalid_payload';
  end if;

  -- Preflight: refuse duplicate or ambiguous identities before any writes.
  for v_client in select value from jsonb_array_elements(p_clients)
  loop
    v_source_id := (v_client->>'source_client_id')::uuid;
    if nullif(btrim(v_client->>'client_name'), '') is null then
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
        'source_client_id', v_source_id, 'reason', 'missing_client_name'));
      continue;
    end if;
    select id into v_existing_id from clients where operations_source_client_id = v_source_id;
    if found then
      v_map := v_map || jsonb_build_object(v_source_id::text, v_existing_id::text);
    else
      select count(*), (array_agg(id order by id))[1] into v_match_count, v_existing_id
      from clients
      where status = 'active'
        and regexp_replace(lower(btrim(name)), '[^[:alnum:]]+', '', 'g') =
            regexp_replace(lower(btrim(v_client->>'client_name')), '[^[:alnum:]]+', '', 'g');
      if v_match_count > 1 then
        v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
          'source_client_id', v_source_id, 'reason', 'ambiguous_exact_name', 'candidate_count', v_match_count));
      elsif v_match_count = 1 then
        v_map := v_map || jsonb_build_object(v_source_id::text, v_existing_id::text);
      end if;
    end if;
  end loop;

  if exists (
    select 1 from jsonb_array_elements(p_clients) c
    group by regexp_replace(lower(btrim(c->>'client_name')), '[^[:alnum:]]+', '', 'g')
    having count(distinct c->>'source_client_id') > 1
  ) then
    v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
      'reason', 'duplicate_normalized_source_names'));
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_contacts) c
    group by c->>'source_contact_id' having count(*) > 1
  ) then
    v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
      'reason', 'duplicate_source_contact_ids'));
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_contacts) c
    where not (v_map ? (c->>'source_client_id'))
  ) then
    v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
      'reason', 'contact_has_unknown_source_client'));
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_contacts) c
    where coalesce((c->>'is_primary')::boolean, false)
    group by c->>'source_client_id' having count(*) > 1
  ) then
    v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
      'reason', 'multiple_primary_contacts_for_client'));
  end if;
  if jsonb_array_length(v_conflicts) > 0 then
    return jsonb_build_object('ok', false, 'conflicts', v_conflicts);
  end if;

  if not p_apply then
    select count(*) into v_created from jsonb_array_elements(p_clients) c
      where not (v_map ? (c->>'source_client_id'));
    v_updated := jsonb_array_length(p_clients) - v_created;
    return jsonb_build_object(
      'ok', true, 'mode', 'preview', 'clients', jsonb_array_length(p_clients),
      'matched_existing', v_updated, 'would_create', v_created,
      'contacts', jsonb_array_length(p_contacts), 'conflicts', '[]'::jsonb);
  end if;

  for v_client in select value from jsonb_array_elements(p_clients)
  loop
    v_source_id := (v_client->>'source_client_id')::uuid;
    v_existing_id := nullif(v_map->>v_source_id::text, '')::uuid;
    if v_existing_id is null then
      insert into clients (
        name, type, group_name, address, city, state, zip, status, client_code,
        created_by, operations_source_client_id, operations_client_code
      ) values (
        btrim(v_client->>'client_name'),
        case when lower(v_client->>'type') = 'personal' then 'Personal' else 'Business' end,
        nullif(btrim(v_client->>'group_name'), ''), nullif(btrim(v_client->>'address'), ''),
        nullif(btrim(v_client->>'city'), ''), nullif(btrim(v_client->>'state'), ''),
        nullif(btrim(v_client->>'zip'), ''), 'active',
        'OPS-' || upper(substr(replace(v_source_id::text, '-', ''), 1, 12)),
        p_actor, v_source_id, nullif(btrim(v_client->>'client_code'), '')
      ) returning id into v_existing_id;
      v_created := v_created + 1;
      v_map := v_map || jsonb_build_object(v_source_id::text, v_existing_id::text);
    else
      update clients set
        name = btrim(v_client->>'client_name'),
        type = case when lower(v_client->>'type') = 'personal' then 'Personal' else 'Business' end,
        group_name = nullif(btrim(v_client->>'group_name'), ''),
        address = nullif(btrim(v_client->>'address'), ''),
        city = nullif(btrim(v_client->>'city'), ''),
        state = nullif(btrim(v_client->>'state'), ''),
        zip = nullif(btrim(v_client->>'zip'), ''),
        operations_source_client_id = v_source_id,
        operations_client_code = nullif(btrim(v_client->>'client_code'), '')
      where id = v_existing_id
        and (name, type, group_name, address, city, state, zip, operations_source_client_id, operations_client_code)
          is distinct from (
            btrim(v_client->>'client_name'),
            case when lower(v_client->>'type') = 'personal' then 'Personal' else 'Business' end,
            nullif(btrim(v_client->>'group_name'), ''), nullif(btrim(v_client->>'address'), ''),
            nullif(btrim(v_client->>'city'), ''), nullif(btrim(v_client->>'state'), ''),
            nullif(btrim(v_client->>'zip'), ''), v_source_id, nullif(btrim(v_client->>'client_code'), '')
          );
      get diagnostics v_changed = row_count;
      if v_changed > 0 then
        insert into audit_log(actor, action, entity, entity_id, detail)
        values (p_actor, 'update', 'clients', v_existing_id::text,
          jsonb_build_object('source', 'operations_import', 'source_client_id', v_source_id,
            'fields', jsonb_build_array('name','type','group_name','address','city','state','zip','operations_client_code')));
        v_updated := v_updated + 1;
      end if;
    end if;
  end loop;

  for v_contact in select value from jsonb_array_elements(p_contacts)
  loop
    v_source_id := (v_contact->>'source_client_id')::uuid;
    v_existing_id := (v_map->>v_source_id::text)::uuid;
    v_contact_id := (v_contact->>'source_contact_id')::uuid;
    select id into v_primary_contact_id from contacts where operations_source_contact_id = v_contact_id;
    if found then
      update contacts set
        client_id = v_existing_id,
        category = 'client',
        name = nullif(btrim(v_contact->>'name'), ''),
        email = nullif(btrim(v_contact->>'email'), ''),
        phone = nullif(btrim(v_contact->>'phone'), ''),
        operations_source_contact_id = v_contact_id,
        updated_at = now()
      where id = v_primary_contact_id
        and (client_id, category, name, email, phone, operations_source_contact_id)
          is distinct from (
            v_existing_id, 'client', nullif(btrim(v_contact->>'name'), ''),
            nullif(btrim(v_contact->>'email'), ''), nullif(btrim(v_contact->>'phone'), ''), v_contact_id
          );
      get diagnostics v_changed = row_count;
      if v_changed > 0 then
        insert into audit_log(actor, action, entity, entity_id, detail)
        values (p_actor, 'update', 'contacts', v_primary_contact_id::text,
          jsonb_build_object('source', 'operations_import', 'source_contact_id', v_contact_id,
            'source_client_id', v_source_id, 'fields', jsonb_build_array('client_id','name','email','phone')));
        v_contacts_updated := v_contacts_updated + 1;
      end if;
    else
      insert into contacts(client_id, category, is_primary, name, email, phone, operations_source_contact_id)
      values (v_existing_id, 'client', false, nullif(btrim(v_contact->>'name'), ''),
        nullif(btrim(v_contact->>'email'), ''), nullif(btrim(v_contact->>'phone'), ''), v_contact_id)
      returning id into v_primary_contact_id;
      insert into audit_log(actor, action, entity, entity_id, detail)
      values (p_actor, 'insert', 'contacts', v_primary_contact_id::text,
        jsonb_build_object('source', 'operations_import', 'source_contact_id', v_contact_id,
          'source_client_id', v_source_id, 'fields', jsonb_build_array('client_id','name','email','phone')));
      v_contacts_created := v_contacts_created + 1;
    end if;
  end loop;

  -- Apply source primary selections without copying contact PII into the audit log.
  for v_client in
    select value from jsonb_array_elements(p_clients) c
    where exists (select 1 from jsonb_array_elements(p_contacts) ct
      where ct->>'source_client_id' = c.value->>'source_client_id'
        and coalesce((ct->>'is_primary')::boolean, false))
  loop
    v_source_id := (v_client->>'source_client_id')::uuid;
    v_existing_id := (v_map->>v_source_id::text)::uuid;
    select (ct->>'source_contact_id')::uuid into v_contact_id
    from jsonb_array_elements(p_contacts) ct
    where ct->>'source_client_id' = v_source_id::text and coalesce((ct->>'is_primary')::boolean, false);
    select id into v_primary_contact_id from contacts where operations_source_contact_id = v_contact_id;
    for v_contact in
      select to_jsonb(c) from contacts c
      where c.client_id = v_existing_id and c.category = 'client'
        and c.is_primary is distinct from (c.id = v_primary_contact_id)
    loop
      v_contact_id := (v_contact->>'id')::uuid;
      update contacts set is_primary = (id = v_primary_contact_id), updated_at = now() where id = v_contact_id;
      insert into audit_log(actor, action, entity, entity_id, detail)
      values (p_actor, 'update', 'contacts', v_contact_id::text,
        jsonb_build_object('source', 'operations_import', 'source_client_id', v_source_id,
          'fields', jsonb_build_array('is_primary'), 'is_primary', v_contact_id = v_primary_contact_id));
      v_primary_set := v_primary_set + 1;
    end loop;
  end loop;

  return jsonb_build_object('ok', true, 'mode', 'applied', 'clients_created', v_created,
    'clients_updated', v_updated, 'contacts_created', v_contacts_created,
    'contacts_updated', v_contacts_updated, 'primary_flags_updated', v_primary_set,
    'conflicts', '[]'::jsonb);
end;
$$;

revoke all on function tap_hub_project.import_operations_client_data(uuid, jsonb, jsonb, boolean) from public, anon, authenticated;
grant execute on function tap_hub_project.import_operations_client_data(uuid, jsonb, jsonb, boolean) to service_role;

commit;
