-- Make summary/detail cross-check fail closed until every invoice-like source
-- line has been staged as an import invoice or explicitly classified away.
-- Retains the existing net math for recognized invoice and adjustment rows.
begin;

create or replace function tap_hub_project.cross_check_collection_import_reports(
  p_summary_batch_id uuid,p_detail_batch_id uuid,p_summary_total numeric,p_note text,p_actor uuid
) returns jsonb language plpgsql security definer
set search_path = tap_hub_project, public as $$
declare
  v_summary collection_import_batches%rowtype;
  v_detail collection_import_batches%rowtype;
  v_invoice_count integer;
  v_detail_total numeric(12,2);
  v_invoice_total numeric(12,2);
  v_non_invoice_total numeric(12,2);
  v_expected_non_invoice_count integer;
  v_evidence_count integer;
  v_status text;
  v_check jsonb;
begin
  perform set_config('tap_hub.actor_id',p_actor::text,true);
  select * into v_summary from collection_import_batches where id=p_summary_batch_id for update;
  select * into v_detail from collection_import_batches where id=p_detail_batch_id for update;
  if not found or v_summary.id is null then raise exception 'not_found: summary or detail batch does not exist' using errcode='P0002'; end if;
  if v_summary.report_type <> 'aging_summary' or v_summary.status in ('approved','rejected','superseded') then
    raise exception 'conflict: only an open summary report can be cross-checked' using errcode='P0001';
  end if;
  if v_detail.report_type <> 'aging_detail' or v_detail.source_as_of is distinct from v_summary.source_as_of or v_detail.status <> 'needs_review' then
    raise exception 'conflict: detail report must be under review with the same as-of date' using errcode='P0001';
  end if;

  if exists(
    select 1 from collection_import_rows r
    where r.batch_id=p_detail_batch_id and (
      r.review_disposition='unreviewed'
      or (r.review_disposition='invoice' and (
        r.source_invoice_id is null
        or not exists(select 1 from collection_import_invoices i
          where i.batch_id=p_detail_batch_id and i.source_invoice_id=r.source_invoice_id
            and i.review_status in ('ready','approved'))
      ))
    )
  ) then
    raise exception 'conflict: every invoice source row must be reviewed before cross-check' using errcode='P0001';
  end if;

  select count(*),coalesce(sum(open_balance),0)::numeric(12,2) into v_invoice_count,v_invoice_total
    from collection_import_invoices where batch_id=p_detail_batch_id and review_status in ('ready','approved');
  if v_invoice_count=0 or exists(
    select 1 from collection_import_invoices where batch_id=p_detail_batch_id and review_status not in ('ready','approved')
  ) then raise exception 'conflict: every detail invoice row must be reviewed before cross-check' using errcode='P0001'; end if;

  select count(*) into v_expected_non_invoice_count from collection_import_rows r
  where r.batch_id=p_detail_batch_id and r.duplicate_of is null
    and lower(trim(r.parsed_fields->'cells'->>0)) in ('payment','general journal','check');
  select count(*),coalesce(sum((r.parsed_fields#>>'{auto_suggestion,fields,open_balance}')::numeric),0)::numeric(12,2)
    into v_evidence_count,v_non_invoice_total
  from collection_import_rows r
  where r.batch_id=p_detail_batch_id and r.duplicate_of is null
    and r.parsed_fields#>>'{auto_suggestion,disposition}'='ignored'
    and lower(trim(r.parsed_fields#>>'{auto_suggestion,fields,transaction_type}')) in ('payment','general journal','check')
    and r.parsed_fields#>>'{auto_suggestion,fields,open_balance}' ~ '^-?[0-9]{1,10}(\.[0-9]{1,2})?$';
  if v_expected_non_invoice_count <> v_evidence_count then
    raise exception 'conflict: recognized payment or adjustment rows need readable amounts before cross-check' using errcode='P0001';
  end if;

  v_detail_total := (v_invoice_total + v_non_invoice_total)::numeric(12,2);
  v_status := case when round(p_summary_total,2)=v_detail_total then 'matched' else 'mismatch' end;
  v_check := jsonb_build_object('detail_batch_id',p_detail_batch_id,'source_as_of',v_summary.source_as_of,
    'summary_reported_total',round(p_summary_total,2)::numeric(12,2)::text,
    'detail_invoice_total',v_detail_total::text,'detail_net_total',v_detail_total::text,
    'detail_invoice_subtotal',v_invoice_total::text,'detail_non_invoice_adjustments',v_non_invoice_total::text,
    'difference',(round(p_summary_total,2)-v_detail_total)::numeric(12,2)::text,
    'status',v_status,'invoice_count',v_invoice_count,'non_invoice_evidence_count',v_evidence_count,
    'note',trim(p_note),'checked_by',p_actor,'checked_at',now());
  update collection_import_batches set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('detail_cross_check',v_check),updated_at=now()
    where id=p_summary_batch_id;
  insert into collection_import_audit(batch_id,actor,action,detail)
  values(p_summary_batch_id,p_actor,'summary_detail_cross_checked',v_check);
  return v_check;
end; $$;
revoke all on function tap_hub_project.cross_check_collection_import_reports(uuid,uuid,numeric,text,uuid) from public,anon,authenticated;
grant execute on function tap_hub_project.cross_check_collection_import_reports(uuid,uuid,numeric,text,uuid) to service_role;

commit;
