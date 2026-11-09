-- Serialize automatic invoice staging against human row classification. The row
-- lock and disposition check stay in the same transaction as the existing review
-- function so a stale client cannot turn a line someone just ignored into an invoice.
create or replace function tap_hub_project.review_unreviewed_collection_import_invoice(
  p_batch_id uuid,
  p_source_row_id uuid,
  p_actor uuid,
  p_client_id uuid,
  p_linked_invoice_id uuid,
  p_existing_source_invoice_id uuid,
  p_fields jsonb
) returns jsonb
language plpgsql security definer
set search_path = tap_hub_project, public
as $$
declare
  v_disposition text;
  v_source_invoice_id uuid;
begin
  select review_disposition, source_invoice_id
    into v_disposition, v_source_invoice_id
  from collection_import_rows
  where id = p_source_row_id and batch_id = p_batch_id
  for update;

  if not found then
    raise exception 'not_found: source row does not belong to this batch' using errcode = 'P0002';
  end if;
  if v_disposition <> 'unreviewed' or v_source_invoice_id is not null then
    raise exception 'conflict: source row is no longer available for automatic matching' using errcode = 'P0001';
  end if;

  return review_collection_import_invoice(
    p_batch_id, p_source_row_id, p_actor, p_client_id, p_linked_invoice_id,
    p_existing_source_invoice_id, p_fields
  );
end;
$$;

revoke all on function tap_hub_project.review_unreviewed_collection_import_invoice(uuid,uuid,uuid,uuid,uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function tap_hub_project.review_unreviewed_collection_import_invoice(uuid,uuid,uuid,uuid,uuid,uuid,jsonb) to service_role;

-- Stage a set of high-confidence rows in one transaction. The batch lock
-- serializes matching against classification and approval, while each row is
-- rechecked before it is applied. A single report can contain hundreds of rows;
-- doing one HTTP/RPC round trip per invoice is too slow and can partially apply.
create or replace function tap_hub_project.auto_match_collection_import_rows(
  p_batch_id uuid,
  p_actor uuid,
  p_source_row_ids uuid[]
) returns jsonb
language plpgsql security definer
set search_path = tap_hub_project, public
as $$
declare
  v_batch collection_import_batches%rowtype;
  v_row collection_import_rows%rowtype;
  v_suggestion jsonb;
  v_fields jsonb;
  v_row_id uuid;
  v_customer_name text;
  v_customer_key text;
  v_client_id uuid;
  v_client_count integer;
  v_matched integer := 0;
  v_uncertain integer := 0;
  v_unmatched integer := 0;
begin
  select * into v_batch from collection_import_batches where id = p_batch_id for update;
  if not found then raise exception 'not_found: import batch does not exist' using errcode = 'P0002'; end if;
  if v_batch.status <> 'needs_review' or v_batch.report_type <> 'aging_detail' or v_batch.source_as_of is null then
    raise exception 'conflict: detail report is not available for automatic matching' using errcode = 'P0001';
  end if;
  if coalesce(cardinality(p_source_row_ids), 0) > 500 then
    raise exception 'invalid_input: too many rows in one automatic match' using errcode = '22023';
  end if;

  foreach v_row_id in array coalesce(p_source_row_ids, array[]::uuid[]) loop
    select * into v_row from collection_import_rows
    where id = v_row_id and batch_id = p_batch_id for update;
    if not found or v_row.source_invoice_id is not null or v_row.review_disposition <> 'unreviewed' then
      v_uncertain := v_uncertain + 1;
      continue;
    end if;
    v_suggestion := v_row.parsed_fields->'auto_suggestion';
    v_fields := v_suggestion->'fields';
    if v_suggestion->>'disposition' <> 'invoice' or v_suggestion->>'confidence' <> 'high'
      or v_fields->>'transaction_type' <> 'Invoice'
      or coalesce(v_fields->>'invoice_number','') = '' or coalesce(v_fields->>'customer_name','') = ''
      or coalesce(v_fields->>'transaction_date','') !~ '^\d{4}-\d{2}-\d{2}$'
      or coalesce(v_fields->>'due_date','') !~ '^\d{4}-\d{2}-\d{2}$'
      or coalesce(v_fields->>'reported_aging','') !~ '^\d{1,4}$'
      or coalesce(v_fields->>'open_balance','') !~ '^-?\d{1,10}(\.\d{1,2})?$' then
      v_uncertain := v_uncertain + 1;
      continue;
    end if;

    v_customer_name := v_fields->>'customer_name';
    v_customer_key := trim(regexp_replace(
      regexp_replace(regexp_replace(lower(v_customer_name), '[^a-z0-9]+', ' ', 'g'),
        '\m(llc|incorporated|inc|ltd|limited|corp|corporation)\M', '', 'g'),
      '\s+', ' ', 'g'));
    if v_customer_key = '' then
      v_unmatched := v_unmatched + 1;
      continue;
    end if;
    select count(*) into v_client_count from clients c
    where c.status = 'active'
      and trim(regexp_replace(
        regexp_replace(regexp_replace(lower(c.name), '[^a-z0-9]+', ' ', 'g'),
          '\m(llc|incorporated|inc|ltd|limited|corp|corporation)\M', '', 'g'),
        '\s+', ' ', 'g')) = v_customer_key;
    if v_client_count <> 1 then
      v_unmatched := v_unmatched + 1;
      continue;
    end if;
    select c.id into v_client_id from clients c
    where c.status = 'active'
      and trim(regexp_replace(
        regexp_replace(regexp_replace(lower(c.name), '[^a-z0-9]+', ' ', 'g'),
          '\m(llc|incorporated|inc|ltd|limited|corp|corporation)\M', '', 'g'),
        '\s+', ' ', 'g')) = v_customer_key;

    perform review_unreviewed_collection_import_invoice(
      p_batch_id, v_row_id, p_actor, v_client_id, null, null,
      jsonb_build_object(
        'invoice_number', v_fields->>'invoice_number', 'customer_name', v_customer_name,
        'customer_external_id', null, 'transaction_type', v_fields->>'transaction_type',
        'transaction_date', v_fields->>'transaction_date', 'due_date', v_fields->>'due_date',
        'terms', v_fields->'terms', 'po_number', v_fields->'po_number',
        'reported_aging', (v_fields->>'reported_aging')::integer,
        'open_balance', v_fields->>'open_balance',
        'row_data', v_row.parsed_fields || jsonb_build_object(
          'auto_match', jsonb_build_object('method','unique_normalized_customer_name','client_id',v_client_id))
      )
    );
    v_matched := v_matched + 1;
  end loop;

  return jsonb_build_object('matched', v_matched, 'uncertain', v_uncertain, 'unmatched_client', v_unmatched);
end;
$$;

revoke all on function tap_hub_project.auto_match_collection_import_rows(uuid,uuid,uuid[]) from public, anon, authenticated;
grant execute on function tap_hub_project.auto_match_collection_import_rows(uuid,uuid,uuid[]) to service_role;
