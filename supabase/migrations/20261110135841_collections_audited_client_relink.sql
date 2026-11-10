-- Re-associate an already-approved A/R account with its Operations client
-- without changing invoice identity or silently splitting Collections history.
create or replace function tap_hub_project.relink_collections_client_accounts(
  p_links jsonb,
  p_actor uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'tap_hub_project', 'public'
as $function$
declare
  v_link jsonb;
  v_source_client_id uuid;
  v_target_client_id uuid;
  v_note text;
  v_source_ids uuid[];
  v_source_seen uuid[] := '{}'::uuid[];
  v_target_seen uuid[] := '{}'::uuid[];
  v_identity_count integer;
  v_event_count integer;
  v_hold_count integer;
  v_attempt_count integer;
  v_results jsonb := '[]'::jsonb;
begin
  if p_actor is null or not exists (
    select 1 from profiles p where p.id = p_actor and p.active is distinct from false
      and lower(trim(coalesce(p.role, ''))) in ('owner', 'admin')
  ) then
    raise exception 'forbidden: active Owner or Admin actor required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_links) <> 'array' or jsonb_array_length(p_links) < 1 or jsonb_array_length(p_links) > 100 then
    raise exception 'invalid_input: provide between 1 and 100 client links' using errcode = '22023';
  end if;

  perform set_config('tap_hub.actor_id', p_actor::text, true);

  for v_link in select value from jsonb_array_elements(p_links)
  loop
    if jsonb_typeof(v_link) <> 'object'
      or coalesce(v_link->>'source_client_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(v_link->>'target_client_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then
      raise exception 'invalid_input: source and target client ids must be UUIDs' using errcode = '22023';
    end if;
    v_source_client_id := (v_link->>'source_client_id')::uuid;
    v_target_client_id := (v_link->>'target_client_id')::uuid;
    v_note := trim(coalesce(v_link->>'note',''));
    if v_source_client_id = v_target_client_id or length(v_note) < 8 or length(v_note) > 500 then
      raise exception 'invalid_input: distinct clients and an 8-500 character reason are required' using errcode = '22023';
    end if;
    if v_source_client_id = any(v_source_seen) or v_target_client_id = any(v_target_seen) then
      raise exception 'invalid_input: duplicate source or target client in request' using errcode = '22023';
    end if;
    v_source_seen := array_append(v_source_seen, v_source_client_id);
    v_target_seen := array_append(v_target_seen, v_target_client_id);

    -- Lock in stable order so concurrent relinks cannot race or deadlock.
    perform 1 from clients where id in (v_source_client_id, v_target_client_id) order by id for update;
    if (select count(*) from clients where id in (v_source_client_id, v_target_client_id)) <> 2 then
      raise exception 'not_found: source or target client does not exist' using errcode = 'P0002';
    end if;
    if not exists(select 1 from clients where id=v_source_client_id and status='active' and operations_source_client_id is null)
      or not exists(select 1 from clients where id=v_target_client_id and status='active' and operations_source_client_id is not null) then
      raise exception 'conflict: source must be an active A/R client and target an active Operations-linked client' using errcode = 'P0001';
    end if;

    select coalesce(array_agg(s.source_invoice_id order by s.source_invoice_id), '{}'::uuid[])
      into v_source_ids from collection_source_invoice_identities s where s.client_id=v_source_client_id;
    v_identity_count := coalesce(cardinality(v_source_ids),0);
    if v_identity_count = 0 then
      raise exception 'conflict: source client has no A/R invoice identities to relink' using errcode = 'P0001';
    end if;
    if exists (
      select 1 from unnest(v_source_ids) ids(source_invoice_id)
      left join lateral (
        select b.status from collection_import_invoices i
        join collection_import_batches b on b.id=i.batch_id
        where i.source_invoice_id=ids.source_invoice_id
        order by i.updated_at desc, i.created_at desc limit 1
      ) latest on true
      where latest.status is distinct from 'approved'
    ) then
      raise exception 'conflict: every A/R snapshot for the source client must be approved' using errcode = 'P0001';
    end if;
    if exists (
      select 1 from collection_source_invoice_identities s
      join invoices i on i.id=s.linked_invoice_id
      where s.source_invoice_id=any(v_source_ids) and i.client_id<>v_target_client_id
    ) then
      raise exception 'conflict: a linked Billing invoice belongs to a different client' using errcode = 'P0001';
    end if;
    -- This operation is Collections-only. Never move or strand Billing ledger rows.
    if exists(select 1 from invoices where client_id=v_source_client_id)
      or exists(select 1 from payments where client_id=v_source_client_id) then
      raise exception 'conflict: source client has Billing ledger records; manual reconciliation is required' using errcode = 'P0001';
    end if;

    update collection_source_invoice_identities
      set client_id=v_target_client_id, updated_at=now()
      where source_invoice_id=any(v_source_ids);
    get diagnostics v_identity_count = row_count;

    update collection_holds set client_id=v_target_client_id where client_id=v_source_client_id;
    get diagnostics v_hold_count = row_count;
    update collection_events set client_id=v_target_client_id where client_id=v_source_client_id;
    get diagnostics v_event_count = row_count;
    update collection_delivery_attempts set client_id=v_target_client_id, updated_at=now()
      where client_id=v_source_client_id;
    get diagnostics v_attempt_count = row_count;

    -- Batch-level audit trail; the table trigger also captures each identity update
    -- in audit_log with the actor set above. Keep canonical identity unchanged.
    insert into collection_import_audit(batch_id, source_invoice_id, actor, action, detail)
    select latest.batch_id, ids.source_invoice_id, p_actor, 'client_relinked_to_operations',
      jsonb_build_object(
        'source_client_id',v_source_client_id,
        'target_client_id',v_target_client_id,
        'canonical_identity_preserved',true,
        'reason',v_note
      )
    from unnest(v_source_ids) ids(source_invoice_id)
    join lateral (
      select i.batch_id from collection_import_invoices i
      join collection_import_batches b on b.id=i.batch_id and b.status='approved'
      where i.source_invoice_id=ids.source_invoice_id
      order by i.updated_at desc, i.created_at desc limit 1
    ) latest on true;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'source_client_id',v_source_client_id,
      'target_client_id',v_target_client_id,
      'invoice_identities_relinked',v_identity_count,
      'holds_reassigned',v_hold_count,
      'events_reassigned',v_event_count,
      'delivery_attempts_reassigned',v_attempt_count,
      'canonical_identity_preserved',true
    ));
  end loop;
  return jsonb_build_object('results',v_results);
end;
$function$;

revoke all on function tap_hub_project.relink_collections_client_accounts(jsonb, uuid) from public, anon, authenticated;
grant execute on function tap_hub_project.relink_collections_client_accounts(jsonb, uuid) to service_role;
