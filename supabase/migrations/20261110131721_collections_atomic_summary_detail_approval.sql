-- Final A/R approval now reconciles both dated reports and approves them as one unit.
-- Admins may approve a batch they uploaded, but batch correctors still cannot self-approve.
begin;

create or replace function tap_hub_project.approve_collection_import_batch(p_batch_id uuid, p_actor uuid)
returns jsonb
language plpgsql security definer
set search_path = tap_hub_project, public
as $$
declare
  v_batch collection_import_batches%rowtype;
  v_identity collection_source_invoice_identities%rowtype;
  v_target text;
  v_pdf_target text;
  v_billing_target text;
  v_invoice_count integer;
  v_pdf_balance numeric(12,2);
  v_billing_balance numeric(12,2);
  v_proposed_invoice_id uuid;
  v_effective_invoice_id uuid;
  v_snapshot_stale boolean;
  v_actor_is_admin boolean;
begin
  perform set_config('tap_hub.actor_id', p_actor::text, true);
  select * into v_batch from collection_import_batches where id = p_batch_id for update;
  if not found then raise exception 'not_found: import batch does not exist' using errcode = 'P0002'; end if;
  if v_batch.status <> 'needs_review' then raise exception 'conflict: batch is not awaiting approval' using errcode = 'P0001'; end if;
  select exists(select 1 from profiles where id = p_actor and lower(role) = 'admin') into v_actor_is_admin;
  if v_batch.uploaded_by = p_actor and not v_actor_is_admin then raise exception 'conflict: non-admin uploader cannot approve this batch' using errcode = 'P0001'; end if;
  if exists(select 1 from collection_import_audit where batch_id = p_batch_id and actor = p_actor and action in ('pdf_row_corrected','pdf_row_classified','pdf_summary_row_corrected')) then
    raise exception 'conflict: batch corrector cannot approve this batch' using errcode = 'P0001';
  end if;
  if v_batch.report_type = 'unknown' or v_batch.source_as_of is null then
    raise exception 'conflict: report type and as-of date require review' using errcode = 'P0001';
  end if;
  if v_batch.report_type <> 'aging_detail' then
    raise exception 'conflict: summary reports are cross-check evidence, not invoice-level import data' using errcode = 'P0001';
  end if;
  if exists(
    select 1 from collection_import_batches summary
    where summary.report_type = 'aging_summary' and summary.source_as_of = v_batch.source_as_of
      and summary.status = 'needs_review'
      and (nullif(current_setting('tap_hub.approval_summary_batch_id', true), '') is null
        or summary.id = nullif(current_setting('tap_hub.approval_summary_batch_id', true), '')::uuid)
      and (summary.metadata->'detail_cross_check'->>'detail_batch_id' is distinct from p_batch_id::text
        or summary.metadata->'detail_cross_check'->>'status' is distinct from 'matched')
  ) then
    raise exception 'conflict: same-date summary report has not been cross-checked successfully' using errcode = 'P0001';
  end if;
  select count(*) into v_invoice_count from collection_import_invoices where batch_id = p_batch_id;
  if v_invoice_count = 0 or exists(
    select 1 from collection_import_invoices i
    join collection_source_invoice_identities s using (source_invoice_id)
    where i.batch_id = p_batch_id and (i.review_status <> 'ready' or s.client_id is null)
  ) then raise exception 'conflict: every invoice requires review and explicit client linkage' using errcode = 'P0001'; end if;
  if exists(select 1 from collection_import_rows where batch_id = p_batch_id and review_disposition = 'unreviewed') then
    raise exception 'conflict: every extracted line must be classified before approval' using errcode = 'P0001';
  end if;

  for v_identity in
    select s.* from collection_source_invoice_identities s
    join collection_import_invoices i using (source_invoice_id)
    where i.batch_id = p_batch_id for update of s
  loop
    select proposed_linked_invoice_id into v_proposed_invoice_id from collection_import_invoices
      where batch_id = p_batch_id and source_invoice_id = v_identity.source_invoice_id;
    if v_identity.linked_invoice_id is not null and v_proposed_invoice_id is not null
      and v_identity.linked_invoice_id <> v_proposed_invoice_id then
      raise exception 'conflict: a linked Billing invoice cannot be reassigned' using errcode = 'P0001';
    end if;
    v_effective_invoice_id := coalesce(v_identity.linked_invoice_id, v_proposed_invoice_id);
    v_pdf_target := 'pdf_import:' || v_identity.source_invoice_id::text;
    v_billing_target := case when v_effective_invoice_id is null then null else 'billing:' || v_effective_invoice_id::text end;
    v_target := v_identity.canonical_collection_identity;
    if v_target is not null and v_billing_target is not null and v_target = v_pdf_target
      and not exists(select 1 from collection_delivery_attempts where canonical_collection_identity = v_pdf_target)
      and not exists(select 1 from collection_events where canonical_collection_identity = v_pdf_target)
      and not exists(select 1 from collection_holds where canonical_collection_identity = v_pdf_target) then
      -- A late link before activity may still adopt the Billing identity.
      v_target := v_billing_target;
    end if;
    if v_target is null then
      if v_billing_target is null then
        v_target := v_pdf_target;
      else
        if exists(select 1 from collection_delivery_attempts where canonical_collection_identity = v_pdf_target)
          or exists(select 1 from collection_events where canonical_collection_identity = v_pdf_target)
          or exists(select 1 from collection_holds where canonical_collection_identity = v_pdf_target) then
          v_target := v_pdf_target;
        elsif exists(select 1 from collection_delivery_attempts where canonical_collection_identity = v_billing_target)
          or exists(select 1 from collection_events where canonical_collection_identity = v_billing_target)
          or exists(select 1 from collection_holds where canonical_collection_identity = v_billing_target) then
          v_target := v_billing_target;
        else
          v_target := v_billing_target;
        end if;
      end if;
    end if;
    if v_billing_target is not null and v_target <> v_pdf_target and v_target <> v_billing_target then
      raise exception 'conflict: unsupported canonical identity' using errcode = 'P0001';
    end if;
    if v_billing_target is not null and v_target = v_pdf_target and (
      exists(select 1 from collection_delivery_attempts where canonical_collection_identity = v_billing_target)
      or exists(select 1 from collection_events where canonical_collection_identity = v_billing_target)
      or exists(select 1 from collection_holds where canonical_collection_identity = v_billing_target)
    ) and (
      exists(select 1 from collection_delivery_attempts where canonical_collection_identity = v_pdf_target)
      or exists(select 1 from collection_events where canonical_collection_identity = v_pdf_target)
      or exists(select 1 from collection_holds where canonical_collection_identity = v_pdf_target)
    ) then raise exception 'conflict: source identities have separate histories; manual reconciliation required' using errcode = 'P0001'; end if;

    if v_identity.canonical_collection_identity is not null and v_target <> v_identity.canonical_collection_identity then
      delete from collection_invoice_aliases where canonical_collection_identity = v_identity.canonical_collection_identity
        and source_invoice_id = v_identity.source_invoice_id;
    end if;

    -- Before activity exists, a newly linked row may adopt Billing identity;
    -- after activity the trigger rejects any identity rewrite.
    update collection_source_invoice_identities set canonical_collection_identity = v_target, updated_at = now()
    where source_invoice_id = v_identity.source_invoice_id
      and canonical_collection_identity is distinct from v_target;
    update collection_source_invoice_identities set linked_invoice_id = v_effective_invoice_id, updated_at = now()
      where source_invoice_id = v_identity.source_invoice_id and linked_invoice_id is null and v_effective_invoice_id is not null;
    if not exists(select 1 from collection_invoice_aliases where canonical_collection_identity = v_target and source = 'pdf_import') then
      insert into collection_invoice_aliases(canonical_collection_identity, source, source_invoice_id, created_by)
      values (v_target, 'pdf_import', v_identity.source_invoice_id, p_actor);
    end if;
    if v_billing_target is not null and not exists(select 1 from collection_invoice_aliases where canonical_collection_identity = v_target and source = 'billing') then
      insert into collection_invoice_aliases(canonical_collection_identity, source, invoice_id, created_by)
      values (v_target, 'billing', v_effective_invoice_id, p_actor);
    end if;

    if v_effective_invoice_id is not null then
      select i.open_balance into v_pdf_balance from collection_import_invoices i
        where i.batch_id = p_batch_id and i.source_invoice_id = v_identity.source_invoice_id;
      select (coalesce((select sum(il.amount) from invoice_lines il where il.invoice_id = v_effective_invoice_id),0)
        - coalesce((select sum(pa.amount) from payment_allocations pa join payments p on p.id = pa.payment_id
            where pa.invoice_id = v_effective_invoice_id and pa.reversed_at is null and p.status = 'recorded'),0))::numeric(12,2)
        into v_billing_balance;
      v_snapshot_stale := collections_billing_invoice_changed_on_or_after(v_effective_invoice_id, v_batch.source_as_of);
      if v_pdf_balance is distinct from v_billing_balance or v_snapshot_stale then
        update collection_import_invoices set discrepancy_status = 'blocked', review_status = 'blocked', updated_at = now()
          where batch_id = p_batch_id and source_invoice_id = v_identity.source_invoice_id;
        insert into collection_import_audit(batch_id, source_invoice_id, actor, action, detail)
        values (p_batch_id, v_identity.source_invoice_id, p_actor, case when v_snapshot_stale then 'billing_snapshot_stale_at_approval' else 'billing_discrepancy_detected' end, jsonb_build_object(
          'billing_invoice_id', v_effective_invoice_id, 'source_as_of', v_batch.source_as_of,
          'pdf_open_balance', v_pdf_balance, 'billing_open_balance', v_billing_balance,
          'difference', (v_pdf_balance - v_billing_balance)::numeric(12,2),
          'snapshot_stale', v_snapshot_stale
        ));
      end if;
    end if;
  end loop;
  update collection_import_invoices set review_status = 'approved', updated_at = now()
  where batch_id = p_batch_id and review_status = 'ready';
  update collection_import_batches set status = 'approved', approved_by = p_actor, approved_at = now(), updated_at = now()
  where id = p_batch_id;
  insert into collection_import_audit(batch_id, actor, action, detail)
  values (p_batch_id, p_actor, 'batch_approved', jsonb_build_object('invoice_count', v_invoice_count));
  return jsonb_build_object('batch_id', p_batch_id, 'status', 'approved', 'invoice_count', v_invoice_count);
end;
$$;
revoke all on function tap_hub_project.approve_collection_import_batch(uuid,uuid) from public, anon, authenticated;
grant execute on function tap_hub_project.approve_collection_import_batch(uuid,uuid) to service_role;

create or replace function tap_hub_project.prevent_import_corrector_approval()
returns trigger
language plpgsql
security definer
set search_path = tap_hub_project, public
as $$
declare
  v_actor uuid;
  v_actor_is_admin boolean;
begin
  if old.status is distinct from 'approved' and new.status = 'approved' then
    v_actor := nullif(current_setting('tap_hub.actor_id', true), '')::uuid;
    if v_actor is null then
      raise exception 'conflict: batch approval requires a recorded actor' using errcode = 'P0001';
    end if;
    select exists(select 1 from profiles where id = v_actor and lower(role) = 'admin') into v_actor_is_admin;
    if (new.uploaded_by = v_actor and not v_actor_is_admin) or exists(
      select 1 from collection_import_audit
      where batch_id = old.id and actor = v_actor
        and action in ('pdf_row_corrected', 'pdf_row_classified', 'pdf_batch_metadata_corrected', 'pdf_summary_row_corrected')
    ) then
      raise exception 'conflict: non-admin uploader or batch corrector cannot approve this batch' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function tap_hub_project.prevent_import_corrector_approval() from public, anon, authenticated;

create or replace function tap_hub_project.normalize_collection_import_customer(p_name text)
returns text
language sql
immutable
strict
set search_path = tap_hub_project, public
as $$
  select trim(regexp_replace(
    regexp_replace(lower(regexp_replace(p_name, '[^a-zA-Z0-9]+', ' ', 'g')),
      '(^| )(llc|incorporated|inc|ltd|limited|corp|corporation)( |$)', ' ', 'g'),
    '\s+', ' ', 'g'))
$$;
revoke all on function tap_hub_project.normalize_collection_import_customer(text) from public, anon, authenticated;
grant execute on function tap_hub_project.normalize_collection_import_customer(text) to service_role;

create or replace function tap_hub_project.review_collection_import_summary_row(
  p_batch_id uuid,
  p_row_id uuid,
  p_actor uuid,
  p_customer_name text,
  p_fields jsonb
) returns jsonb
language plpgsql
security definer
set search_path = tap_hub_project, public
as $$
declare
  v_batch collection_import_batches%rowtype;
  v_row collection_import_rows%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_field_name text;
  v_value text;
begin
  perform set_config('tap_hub.actor_id',p_actor::text,true);
  select * into v_batch from collection_import_batches where id=p_batch_id for update;
  if not found then raise exception 'not_found: summary report not found' using errcode='P0002'; end if;
  if v_batch.report_type <> 'aging_summary' or v_batch.status <> 'needs_review' then
    raise exception 'conflict: only an open summary report can be corrected' using errcode='P0001';
  end if;
  select * into v_row from collection_import_rows where id=p_row_id and batch_id=p_batch_id for update;
  if not found then raise exception 'not_found: summary row not found' using errcode='P0002'; end if;
  if v_row.parsed_fields#>>'{auto_suggestion,fields,kind}' <> 'customer' then
    raise exception 'conflict: only a recognized customer balance row can be corrected' using errcode='P0001';
  end if;
  if p_customer_name is null or length(trim(p_customer_name))=0 or length(trim(p_customer_name))>255
    or p_fields is null or jsonb_typeof(p_fields)<>'object' then
    raise exception 'invalid_input: corrected customer and balances are required' using errcode='22023';
  end if;
  foreach v_field_name in array array['current','days_1_30','days_31_60','days_61_90','over_90','total_open_balance'] loop
    v_value := p_fields->>v_field_name;
    if v_value is null or v_value !~ '^-?[0-9]{1,10}(\.[0-9]{1,2})?$' then
      raise exception 'invalid_input: all summary amounts must be finite currency values' using errcode='22023';
    end if;
  end loop;
  v_before := v_row.parsed_fields#>'{auto_suggestion,fields}';
  v_after := p_fields || jsonb_build_object('kind','customer','customer_name',trim(p_customer_name));
  update collection_import_rows
    set parsed_fields = jsonb_set(parsed_fields#-'{auto_suggestion,reconciliation}', '{auto_suggestion,fields}', v_after, true)
    where id=p_row_id;
  insert into collection_import_audit(batch_id,source_invoice_id,actor,action,detail)
    values(p_batch_id,null,p_actor,'pdf_summary_row_corrected',jsonb_build_object(
      'row_id',p_row_id,'before',v_before,'after',v_after
    ));
  return jsonb_build_object('row_id',p_row_id,'customer_name',trim(p_customer_name),'fields',v_after,'review_disposition','summary');
end;
$$;
revoke all on function tap_hub_project.review_collection_import_summary_row(uuid,uuid,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function tap_hub_project.review_collection_import_summary_row(uuid,uuid,uuid,text,jsonb) to service_role;

create or replace function tap_hub_project.approve_collection_import_pair(
  p_detail_batch_id uuid,
  p_summary_batch_id uuid,
  p_actor uuid
) returns jsonb
language plpgsql
security definer
set search_path = tap_hub_project, public
as $$
declare
  v_detail collection_import_batches%rowtype;
  v_summary collection_import_batches%rowtype;
  v_role text;
  v_summary_total numeric(12,2);
  v_invoice_total numeric(12,2);
  v_noninvoice_total numeric(12,2);
  v_difference numeric(12,2);
  v_printed_total numeric(12,2);
  v_printed_total_count integer := 0;
  v_printed_total_matches boolean := true;
  v_conflict_count integer := 0;
  v_customer_count integer := 0;
  v_matches jsonb := '[]'::jsonb;
  v_match record;
  v_result jsonb;
  v_legacy_result jsonb;
  v_timestamp timestamptz := now();
begin
  perform set_config('tap_hub.actor_id', p_actor::text, true);
  if p_detail_batch_id = p_summary_batch_id then
    raise exception 'invalid_input: detail and summary must be different batches' using errcode = '22023';
  end if;

  -- Lock in stable order so concurrent approval attempts serialize consistently.
  perform 1 from collection_import_batches
    where id in (p_detail_batch_id, p_summary_batch_id)
    order by id for update;
  select * into v_detail from collection_import_batches where id = p_detail_batch_id;
  select * into v_summary from collection_import_batches where id = p_summary_batch_id;
  if v_detail.id is null or v_summary.id is null then
    raise exception 'not_found: summary or detail batch does not exist' using errcode = 'P0002';
  end if;
  if v_detail.report_type <> 'aging_detail' or v_summary.report_type <> 'aging_summary'
    or v_detail.status <> 'needs_review' or v_summary.status <> 'needs_review'
    or v_detail.source_as_of is null or v_detail.source_as_of is distinct from v_summary.source_as_of then
    raise exception 'conflict: upload both same-date detail and summary reports and finish review before approval' using errcode = 'P0001';
  end if;
  if exists(select 1 from collection_import_rows where batch_id in (p_detail_batch_id,p_summary_batch_id) and review_disposition = 'unreviewed') then
    raise exception 'conflict: resolve every unreviewed row in both reports before final reconciliation' using errcode = 'P0001';
  end if;
  if exists(
    select 1 from collection_import_audit where batch_id in (p_detail_batch_id,p_summary_batch_id) and actor = p_actor
      and action in ('pdf_row_corrected','pdf_row_classified','pdf_batch_metadata_corrected','pdf_summary_row_corrected')
  ) then
    raise exception 'conflict: batch corrector cannot approve this report pair' using errcode = 'P0001';
  end if;

  select count(*) into v_customer_count
  from collection_import_rows r
  where r.batch_id = p_summary_batch_id
    and r.parsed_fields#>>'{auto_suggestion,fields,kind}' = 'customer'
    and r.parsed_fields#>>'{auto_suggestion,fields,total_open_balance}' ~ '^-?[0-9]{1,10}(\.[0-9]{1,2})?$';
  if v_customer_count = 0 then
    raise exception 'conflict: summary customer balances could not be read safely' using errcode = 'P0001';
  end if;

  select coalesce(sum((r.parsed_fields#>>'{auto_suggestion,fields,total_open_balance}')::numeric),0)::numeric(12,2)
    into v_summary_total
  from collection_import_rows r
  where r.batch_id = p_summary_batch_id
    and r.parsed_fields#>>'{auto_suggestion,fields,kind}' = 'customer'
    and r.parsed_fields#>>'{auto_suggestion,fields,total_open_balance}' ~ '^-?[0-9]{1,10}(\.[0-9]{1,2})?$';

  select count(*)::integer,
    coalesce(sum((r.parsed_fields#>>'{auto_suggestion,fields,total_open_balance}')::numeric),0)::numeric(12,2)
    into v_printed_total_count,v_printed_total
  from collection_import_rows r
  where r.batch_id = p_summary_batch_id
    and r.parsed_fields#>>'{auto_suggestion,fields,kind}' = 'grand_total'
    and r.parsed_fields#>>'{auto_suggestion,fields,total_open_balance}' ~ '^-?[0-9]{1,10}(\.[0-9]{1,2})?$';
  v_printed_total_matches := v_printed_total_count = 0 or
    (v_printed_total_count = 1 and v_printed_total = v_summary_total);

  select coalesce(sum(open_balance),0)::numeric(12,2) into v_invoice_total
    from collection_import_invoices where batch_id = p_detail_batch_id and review_status in ('ready','approved');
  select coalesce(sum((r.parsed_fields#>>'{auto_suggestion,fields,open_balance}')::numeric),0)::numeric(12,2)
    into v_noninvoice_total
  from collection_import_rows r
  where r.batch_id = p_detail_batch_id and r.duplicate_of is null
    and r.parsed_fields#>>'{auto_suggestion,disposition}' = 'ignored'
    and lower(trim(r.parsed_fields#>>'{auto_suggestion,fields,transaction_type}')) in ('payment','general journal','check')
    and r.parsed_fields#>>'{auto_suggestion,fields,open_balance}' ~ '^-?[0-9]{1,10}(\.[0-9]{1,2})?$';
  v_difference := (v_summary_total - v_invoice_total - v_noninvoice_total)::numeric(12,2);

  for v_match in
    with summary_rows as (
      select tap_hub_project.normalize_collection_import_customer(r.parsed_fields#>>'{auto_suggestion,fields,customer_name}') as customer_key,
        max(r.parsed_fields#>>'{auto_suggestion,fields,customer_name}') as customer_name,
        sum((r.parsed_fields#>>'{auto_suggestion,fields,total_open_balance}')::numeric)::numeric(12,2) as balance,
        count(*)::integer as row_count,
        bool_and(
          (r.parsed_fields#>>'{auto_suggestion,fields,current}') ~ '^-?[0-9]{1,10}(\.[0-9]{1,2})?$'
          and (r.parsed_fields#>>'{auto_suggestion,fields,days_1_30}') ~ '^-?[0-9]{1,10}(\.[0-9]{1,2})?$'
          and (r.parsed_fields#>>'{auto_suggestion,fields,days_31_60}') ~ '^-?[0-9]{1,10}(\.[0-9]{1,2})?$'
          and (r.parsed_fields#>>'{auto_suggestion,fields,days_61_90}') ~ '^-?[0-9]{1,10}(\.[0-9]{1,2})?$'
          and (r.parsed_fields#>>'{auto_suggestion,fields,over_90}') ~ '^-?[0-9]{1,10}(\.[0-9]{1,2})?$'
          and (
            case when (r.parsed_fields#>>'{auto_suggestion,fields,current}') ~ '^-?[0-9]{1,10}(\.[0-9]{1,2})?$'
              and (r.parsed_fields#>>'{auto_suggestion,fields,days_1_30}') ~ '^-?[0-9]{1,10}(\.[0-9]{1,2})?$'
              and (r.parsed_fields#>>'{auto_suggestion,fields,days_31_60}') ~ '^-?[0-9]{1,10}(\.[0-9]{1,2})?$'
              and (r.parsed_fields#>>'{auto_suggestion,fields,days_61_90}') ~ '^-?[0-9]{1,10}(\.[0-9]{1,2})?$'
              and (r.parsed_fields#>>'{auto_suggestion,fields,over_90}') ~ '^-?[0-9]{1,10}(\.[0-9]{1,2})?$'
            then (
              (r.parsed_fields#>>'{auto_suggestion,fields,current}')::numeric
              +(r.parsed_fields#>>'{auto_suggestion,fields,days_1_30}')::numeric
              +(r.parsed_fields#>>'{auto_suggestion,fields,days_31_60}')::numeric
              +(r.parsed_fields#>>'{auto_suggestion,fields,days_61_90}')::numeric
              +(r.parsed_fields#>>'{auto_suggestion,fields,over_90}')::numeric
            ) = (r.parsed_fields#>>'{auto_suggestion,fields,total_open_balance}')::numeric
            else false end
          )
        ) as buckets_consistent
      from collection_import_rows r
      where r.batch_id = p_summary_batch_id
        and r.parsed_fields#>>'{auto_suggestion,fields,kind}' = 'customer'
        and r.parsed_fields#>>'{auto_suggestion,fields,total_open_balance}' ~ '^-?[0-9]{1,10}(\.[0-9]{1,2})?$'
      group by tap_hub_project.normalize_collection_import_customer(r.parsed_fields#>>'{auto_suggestion,fields,customer_name}')
    ),
    detail_amounts as (
      select tap_hub_project.normalize_collection_import_customer(i.customer_name) as customer_key,
        i.customer_name, i.open_balance::numeric as balance, s.client_id
      from collection_import_invoices i
      join collection_source_invoice_identities s using (source_invoice_id)
      where i.batch_id = p_detail_batch_id and i.review_status in ('ready','approved')
      union all
      select tap_hub_project.normalize_collection_import_customer(r.parsed_fields#>>'{auto_suggestion,fields,customer_name}') as customer_key,
        r.parsed_fields#>>'{auto_suggestion,fields,customer_name}' as customer_name,
        (r.parsed_fields#>>'{auto_suggestion,fields,open_balance}')::numeric as balance,
        null::uuid as client_id
      from collection_import_rows r
      where r.batch_id = p_detail_batch_id and r.duplicate_of is null
        and r.parsed_fields#>>'{auto_suggestion,disposition}' = 'ignored'
        and lower(trim(r.parsed_fields#>>'{auto_suggestion,fields,transaction_type}')) in ('payment','general journal','check')
        and r.parsed_fields#>>'{auto_suggestion,fields,open_balance}' ~ '^-?[0-9]{1,10}(\.[0-9]{1,2})?$'
    ),
    detail_rows as (
      select customer_key, max(customer_name) as customer_name,
        sum(balance)::numeric(12,2) as balance, count(distinct client_id)::integer as client_count
      from detail_amounts where coalesce(customer_key,'') <> ''
      group by customer_key
    )
    select coalesce(s.customer_key,d.customer_key) as customer_key,
      s.customer_name as summary_customer, d.customer_name as detail_customer,
      s.balance as summary_balance, d.balance as detail_balance,
      coalesce(s.row_count,0) as summary_row_count, coalesce(d.client_count,0) as detail_client_count,
      (s.customer_key is not null and d.customer_key is not null and s.balance = d.balance
        and s.row_count = 1 and s.buckets_consistent and coalesce(d.client_count,0) <= 1) as matched,
      coalesce(s.buckets_consistent,false) as buckets_consistent
    from summary_rows s full outer join detail_rows d using (customer_key)
    order by coalesce(s.customer_key,d.customer_key)
  loop
    v_customer_count := v_customer_count + 0; -- retain the readable invoice-row count above
    if not v_match.matched then v_conflict_count := v_conflict_count + 1; end if;
    v_matches := v_matches || jsonb_build_array(jsonb_build_object(
      'customer_key',v_match.customer_key,
      'summary_customer',v_match.summary_customer,
      'detail_customer',v_match.detail_customer,
      'summary_balance',v_match.summary_balance,
      'detail_balance',v_match.detail_balance,
      'difference',case when v_match.summary_balance is null or v_match.detail_balance is null then null
        else (v_match.summary_balance-v_match.detail_balance)::numeric(12,2)::text end,
      'buckets_consistent',v_match.buckets_consistent,
      'status',case when v_match.matched then 'matched' else 'conflict' end
    ));
    if v_match.summary_customer is not null then
      update collection_import_rows r
      set parsed_fields = jsonb_set(r.parsed_fields,'{auto_suggestion,reconciliation}',
        jsonb_build_object(
          'summary_balance',v_match.summary_balance,
          'detail_balance',v_match.detail_balance,
          'difference',case when v_match.summary_balance is null or v_match.detail_balance is null then null
            else (v_match.summary_balance-v_match.detail_balance)::numeric(12,2)::text end,
          'buckets_consistent',v_match.buckets_consistent,
          'status',case when v_match.matched then 'matched' else 'conflict' end
        ),true)
      where r.batch_id = p_summary_batch_id
        and r.parsed_fields#>>'{auto_suggestion,fields,kind}' = 'customer'
        and tap_hub_project.normalize_collection_import_customer(r.parsed_fields#>>'{auto_suggestion,fields,customer_name}') = v_match.customer_key;
    end if;
  end loop;

  if not v_printed_total_matches then v_conflict_count := v_conflict_count + 1; end if;

  if v_conflict_count = 0 and v_difference = 0 then
    v_result := jsonb_build_object(
      'status','matched','summary_batch_id',p_summary_batch_id,'detail_batch_id',p_detail_batch_id,
      'source_as_of',v_detail.source_as_of,'summary_total',v_summary_total::text,
      'detail_invoice_total',v_invoice_total::text,'detail_non_invoice_adjustments',v_noninvoice_total::text,
      'detail_total',(v_invoice_total+v_noninvoice_total)::numeric(12,2)::text,'difference',v_difference::text,
      'printed_summary_total',case when v_printed_total_count = 1 then v_printed_total::text else null end,
      'printed_summary_total_matches',v_printed_total_matches,
      'customers',v_matches,'matched_customer_count',v_customer_count
    );
    -- This existing RPC performs the validated transaction-level reconciliation and audit.
    v_legacy_result := cross_check_collection_import_reports(
      p_summary_batch_id,p_detail_batch_id,v_summary_total,
      'Final automatic customer and total reconciliation at paired approval',p_actor
    );
    update collection_import_batches
      set metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('detail_cross_check',v_result),
          updated_at = v_timestamp
      where id = p_summary_batch_id;
    perform set_config('tap_hub.approval_summary_batch_id',p_summary_batch_id::text,true);
    v_legacy_result := approve_collection_import_batch(p_detail_batch_id,p_actor);
    update collection_import_batches
      set status = 'approved',approved_by = p_actor,approved_at = v_timestamp,updated_at = v_timestamp
      where id = p_summary_batch_id and status = 'needs_review';
    insert into collection_import_audit(batch_id,actor,action,detail)
      values(p_summary_batch_id,p_actor,'batch_approved',jsonb_build_object(
        'detail_batch_id',p_detail_batch_id,'customer_match_count',v_customer_count,'summary_total',v_summary_total
      ));
    return jsonb_build_object(
      'status','approved','detail_batch',v_legacy_result,'summary_batch_id',p_summary_batch_id,
      'summary_status','approved','reconciliation',v_result
    );
  end if;

  v_result := jsonb_build_object(
    'status','mismatch','summary_batch_id',p_summary_batch_id,'detail_batch_id',p_detail_batch_id,
    'source_as_of',v_detail.source_as_of,'summary_total',v_summary_total::text,
    'detail_invoice_total',v_invoice_total::text,'detail_non_invoice_adjustments',v_noninvoice_total::text,
    'detail_total',(v_invoice_total+v_noninvoice_total)::numeric(12,2)::text,'difference',v_difference::text,
    'printed_summary_total',case when v_printed_total_count = 1 then v_printed_total::text else null end,
    'printed_summary_total_matches',v_printed_total_matches,
    'customers',v_matches,'conflict_customer_count',v_conflict_count
  );
  update collection_import_batches set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('detail_cross_check',v_result),updated_at=v_timestamp
    where id=p_summary_batch_id;
  insert into collection_import_audit(batch_id,actor,action,detail)
    values(p_summary_batch_id,p_actor,'summary_detail_final_reconciliation',v_result);
  return jsonb_build_object('status','mismatch','detail_status','needs_review','summary_status','needs_review','reconciliation',v_result);
end;
$$;
revoke all on function tap_hub_project.approve_collection_import_pair(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function tap_hub_project.approve_collection_import_pair(uuid,uuid,uuid) to service_role;

commit;
