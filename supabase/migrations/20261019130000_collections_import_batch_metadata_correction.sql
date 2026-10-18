-- Reviewer-confirmed correction for report headers the parser cannot identify.
-- Corrections are atomic with their audit event and create a separation-of-duties barrier.
begin;

create or replace function tap_hub_project.correct_collection_import_batch_metadata(
  p_batch_id uuid,
  p_report_type text,
  p_source_as_of date,
  p_actor uuid,
  p_confirmed boolean
) returns jsonb
language plpgsql
security definer
set search_path = tap_hub_project, public
as $$
declare
  v_batch collection_import_batches%rowtype;
begin
  perform set_config('tap_hub.actor_id', p_actor::text, true);

  if p_confirmed is distinct from true
    or p_report_type is null
    or p_report_type not in ('aging_summary', 'aging_detail')
    or p_source_as_of is null then
    raise exception 'invalid_input: supported report type, as-of date, and reviewer confirmation are required'
      using errcode = '22023';
  end if;

  select * into v_batch
    from collection_import_batches
    where id = p_batch_id
    for update;
  if not found then
    raise exception 'not_found: import batch does not exist' using errcode = 'P0002';
  end if;
  if v_batch.status <> 'needs_review' then
    raise exception 'conflict: only a report awaiting review can be corrected' using errcode = 'P0001';
  end if;
  -- Invoice review copies the report date onto each reviewed invoice. Do not
  -- permit a header correction after that dependent review data exists.
  if exists(select 1 from collection_import_invoices where batch_id = p_batch_id) then
    raise exception 'conflict: report metadata cannot change after invoice review has begun' using errcode = 'P0001';
  end if;
  if v_batch.report_type is not distinct from p_report_type
    and v_batch.source_as_of is not distinct from p_source_as_of then
    raise exception 'invalid_input: corrected metadata must differ from the parsed values' using errcode = '22023';
  end if;

  update collection_import_batches
    set report_type = p_report_type,
        source_as_of = p_source_as_of,
        updated_at = now()
    where id = p_batch_id;

  insert into collection_import_audit(batch_id, actor, action, detail)
  values (
    p_batch_id,
    p_actor,
    'pdf_batch_metadata_corrected',
    jsonb_build_object(
      'before', jsonb_build_object('report_type', v_batch.report_type, 'source_as_of', v_batch.source_as_of),
      'after', jsonb_build_object('report_type', p_report_type, 'source_as_of', p_source_as_of),
      'reviewer_confirmed', true
    )
  );

  return jsonb_build_object(
    'id', p_batch_id,
    'status', 'needs_review',
    'report_type', p_report_type,
    'source_as_of', p_source_as_of
  );
end;
$$;
revoke all on function tap_hub_project.correct_collection_import_batch_metadata(uuid,text,date,uuid,boolean) from public, anon, authenticated;
grant execute on function tap_hub_project.correct_collection_import_batch_metadata(uuid,text,date,uuid,boolean) to service_role;

-- The existing approval RPC already checks row correctors. Extend the same
-- non-overridable rule to reviewers who corrected the batch header.
create or replace function tap_hub_project.prevent_import_corrector_approval()
returns trigger
language plpgsql
security definer
set search_path = tap_hub_project, public
as $$
declare
  v_actor uuid;
begin
  if old.status is distinct from 'approved' and new.status = 'approved' then
    v_actor := nullif(current_setting('tap_hub.actor_id', true), '')::uuid;
    if v_actor is null then
      raise exception 'conflict: batch approval requires a recorded actor' using errcode = 'P0001';
    end if;
    if new.uploaded_by = v_actor or exists(
      select 1 from collection_import_audit
      where batch_id = old.id and actor = v_actor
        and action in ('pdf_row_corrected', 'pdf_row_classified', 'pdf_batch_metadata_corrected')
    ) then
      raise exception 'conflict: uploader or batch corrector cannot approve this batch' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function tap_hub_project.prevent_import_corrector_approval() from public, anon, authenticated;
drop trigger if exists prevent_import_corrector_approval on tap_hub_project.collection_import_batches;
create trigger prevent_import_corrector_approval
  before update of status on tap_hub_project.collection_import_batches
  for each row execute function tap_hub_project.prevent_import_corrector_approval();

commit;
