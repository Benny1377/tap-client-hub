-- Follow up Aanan's integrated review: repair test-run identities, bind accepted
-- reminders to their invoice identity, make relinks reusable by later imports,
-- and fail closed on malformed contact email values.
begin;

-- Preserve old A/R names as matching aliases before deactivating relink sources.
create table if not exists tap_hub_project.collections_client_name_aliases (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references tap_hub_project.clients(id) on delete restrict,
  source_client_id uuid references tap_hub_project.clients(id) on delete restrict,
  alias_name text not null check (length(btrim(alias_name)) between 1 and 255),
  normalized_name text not null check (length(normalized_name) between 1 and 255),
  created_by uuid not null references tap_hub_project.profiles(id),
  created_at timestamptz not null default now(),
  unique (client_id, normalized_name)
);
create index if not exists idx_collections_client_alias_normalized
  on tap_hub_project.collections_client_name_aliases(normalized_name);
alter table tap_hub_project.collections_client_name_aliases enable row level security;
revoke all on tap_hub_project.collections_client_name_aliases from public, anon, authenticated;
grant all on tap_hub_project.collections_client_name_aliases to service_role;
drop trigger if exists audit_collections_client_name_aliases on tap_hub_project.collections_client_name_aliases;
create trigger audit_collections_client_name_aliases after insert or update or delete
  on tap_hub_project.collections_client_name_aliases for each row
  execute function tap_hub_project.audit_billing_row();

-- Backfill relinks already performed on the Sandbox/Preview. A name collision
-- remains ambiguous and therefore requires review; it is never auto-selected.
do $backfill$
declare v_link record; v_name text; v_key text;
begin
  for v_link in
    select distinct (detail->>'source_client_id')::uuid source_id,
      (detail->>'target_client_id')::uuid target_id, actor
    from tap_hub_project.collection_import_audit
    where action='client_relinked_to_operations'
      and coalesce(detail->>'canonical_identity_preserved','false')='true'
      and actor is not null
      and coalesce(detail->>'source_client_id','') ~* '^[0-9a-f-]{36}$'
      and coalesce(detail->>'target_client_id','') ~* '^[0-9a-f-]{36}$'
  loop
    select name into v_name from tap_hub_project.clients where id=v_link.source_id;
    v_key:=trim(regexp_replace(regexp_replace(regexp_replace(lower(coalesce(v_name,'')), '[^a-z0-9]+',' ','g'),
      '\m(llc|incorporated|inc|ltd|limited|corp|corporation)\M','','g'),'\s+',' ','g'));
    if v_key<>'' and exists(select 1 from tap_hub_project.clients where id=v_link.target_id and status='active') then
      insert into tap_hub_project.collections_client_name_aliases(client_id,source_client_id,alias_name,normalized_name,created_by)
      values(v_link.target_id,v_link.source_id,v_name,v_key,v_link.actor)
      on conflict(client_id,normalized_name) do nothing;
      if not exists(select 1 from tap_hub_project.invoices where client_id=v_link.source_id)
        and not exists(select 1 from tap_hub_project.payments where client_id=v_link.source_id) then
        update tap_hub_project.clients set status='inactive' where id=v_link.source_id and status='active';
      end if;
    end if;
  end loop;
end;
$backfill$;

-- Extend unique exact-name auto-match to reviewed relink aliases. UNION dedupes
-- a target that matches both its current name and one of its aliases.
create or replace function tap_hub_project.auto_match_collection_import_rows(
  p_batch_id uuid, p_actor uuid, p_source_row_ids uuid[]
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_batch tap_hub_project.collection_import_batches%rowtype;
  v_row tap_hub_project.collection_import_rows%rowtype;
  v_suggestion jsonb; v_fields jsonb; v_row_id uuid;
  v_customer_name text; v_customer_key text; v_client_id uuid; v_client_count integer;
  v_exact_count integer; v_partial_count integer; v_existing_source_invoice_id uuid;
  v_matched integer:=0; v_uncertain integer:=0; v_unmatched integer:=0; v_identity_reused integer:=0;
begin
  select * into v_batch from tap_hub_project.collection_import_batches where id=p_batch_id for update;
  if not found then raise exception 'not_found: import batch does not exist' using errcode='P0002'; end if;
  if v_batch.status<>'needs_review' or v_batch.report_type<>'aging_detail' or v_batch.source_as_of is null then
    raise exception 'conflict: detail report is not available for automatic matching' using errcode='P0001';
  end if;
  if coalesce(cardinality(p_source_row_ids),0)>500 then raise exception 'invalid_input: too many rows in one automatic match' using errcode='22023'; end if;
  foreach v_row_id in array coalesce(p_source_row_ids,array[]::uuid[]) loop
    select * into v_row from tap_hub_project.collection_import_rows where id=v_row_id and batch_id=p_batch_id for update;
    if not found or v_row.source_invoice_id is not null or v_row.review_disposition<>'unreviewed' then v_uncertain:=v_uncertain+1; continue; end if;
    v_suggestion:=v_row.parsed_fields->'auto_suggestion'; v_fields:=v_suggestion->'fields';
    if v_suggestion->>'disposition'<>'invoice' or v_suggestion->>'confidence'<>'high'
      or v_fields->>'transaction_type'<>'Invoice' or coalesce(v_fields->>'invoice_number','')=''
      or coalesce(v_fields->>'customer_name','')=''
      or coalesce(v_fields->>'transaction_date','') !~ '^\d{4}-\d{2}-\d{2}$'
      or coalesce(v_fields->>'due_date','') !~ '^\d{4}-\d{2}-\d{2}$'
      or coalesce(v_fields->>'reported_aging','') !~ '^\d{1,4}$'
      or coalesce(v_fields->>'open_balance','') !~ '^-?\d{1,10}(\.\d{1,2})?$' then v_uncertain:=v_uncertain+1; continue; end if;
    v_customer_name:=v_fields->>'customer_name';
    v_customer_key:=trim(regexp_replace(regexp_replace(regexp_replace(lower(v_customer_name),'[^a-z0-9]+',' ','g'),
      '\m(llc|incorporated|inc|ltd|limited|corp|corporation)\M','','g'),'\s+',' ','g'));
    if v_customer_key='' then v_unmatched:=v_unmatched+1; continue; end if;
    with candidates as (
      select c.id client_id from tap_hub_project.clients c
      where c.status='active' and trim(regexp_replace(regexp_replace(regexp_replace(lower(c.name),'[^a-z0-9]+',' ','g'),
        '\m(llc|incorporated|inc|ltd|limited|corp|corporation)\M','','g'),'\s+',' ','g'))=v_customer_key
      union
      select a.client_id from tap_hub_project.collections_client_name_aliases a
      join tap_hub_project.clients c on c.id=a.client_id and c.status='active'
      where a.normalized_name=v_customer_key
    ) select count(*),(array_agg(client_id order by client_id))[1] into v_client_count,v_client_id from candidates;
    if v_client_count<>1 then v_unmatched:=v_unmatched+1; continue; end if;

    select count(distinct s.source_invoice_id),(array_agg(distinct s.source_invoice_id))[1]
      into v_exact_count,v_existing_source_invoice_id
    from tap_hub_project.collection_import_invoices prior
    join tap_hub_project.collection_import_batches prior_batch on prior_batch.id=prior.batch_id
    join tap_hub_project.collection_source_invoice_identities s using(source_invoice_id)
    where prior_batch.status='approved' and prior_batch.report_type='aging_detail'
      and prior_batch.source_as_of<v_batch.source_as_of and prior.review_status='approved'
      and s.client_id=v_client_id and prior.invoice_number=v_fields->>'invoice_number'
      and prior.transaction_date=(v_fields->>'transaction_date')::date;
    if v_exact_count>1 then v_uncertain:=v_uncertain+1; continue; end if;
    if v_exact_count=1 and exists(select 1 from tap_hub_project.collection_import_invoices used
      where used.batch_id=p_batch_id and used.source_invoice_id=v_existing_source_invoice_id) then v_uncertain:=v_uncertain+1; continue; end if;
    if v_exact_count=0 then
      select count(distinct s.source_invoice_id) into v_partial_count
      from tap_hub_project.collection_import_invoices prior
      join tap_hub_project.collection_import_batches prior_batch on prior_batch.id=prior.batch_id
      join tap_hub_project.collection_source_invoice_identities s using(source_invoice_id)
      where prior_batch.status='approved' and prior_batch.report_type='aging_detail'
        and prior_batch.source_as_of<v_batch.source_as_of and prior.review_status='approved'
        and s.client_id=v_client_id and (prior.invoice_number=v_fields->>'invoice_number'
          or prior.transaction_date=(v_fields->>'transaction_date')::date);
      if v_partial_count>0 then v_uncertain:=v_uncertain+1; continue; end if;
    end if;
    perform tap_hub_project.review_unreviewed_collection_import_invoice(
      p_batch_id,v_row_id,p_actor,v_client_id,null,v_existing_source_invoice_id,
      jsonb_build_object('invoice_number',v_fields->>'invoice_number','customer_name',v_customer_name,
        'customer_external_id',null,'transaction_type',v_fields->>'transaction_type',
        'transaction_date',v_fields->>'transaction_date','due_date',v_fields->>'due_date',
        'terms',v_fields->'terms','po_number',v_fields->'po_number','reported_aging',(v_fields->>'reported_aging')::integer,
        'open_balance',v_fields->>'open_balance','row_data',v_row.parsed_fields||jsonb_build_object('auto_match',
          jsonb_build_object('method','unique_normalized_customer_name','client_id',v_client_id,
            'identity_method',case when v_exact_count=1 then 'exact_client_invoice_number_transaction_date' else 'new_invoice' end))));
    v_matched:=v_matched+1;
    if v_exact_count=1 then v_identity_reused:=v_identity_reused+1; end if;
  end loop;
  return jsonb_build_object('matched',v_matched,'uncertain',v_uncertain,'unmatched_client',v_unmatched,'identity_reused',v_identity_reused);
end; $$;
revoke all on function tap_hub_project.auto_match_collection_import_rows(uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function tap_hub_project.auto_match_collection_import_rows(uuid,uuid,uuid[]) to service_role;

-- Wrap the existing atomic relink in the same transaction: preserve the old
-- report customer name as an alias, retire the now-empty A/R-only client, and
-- add one easily-found audit summary with all moved-row counts.
alter function tap_hub_project.relink_collections_client_accounts(jsonb,uuid)
  rename to relink_collections_client_accounts_pre_alias;
revoke all on function tap_hub_project.relink_collections_client_accounts_pre_alias(jsonb,uuid) from public,anon,authenticated;
grant execute on function tap_hub_project.relink_collections_client_accounts_pre_alias(jsonb,uuid) to service_role;
create function tap_hub_project.relink_collections_client_accounts(p_links jsonb,p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb; v_result_item jsonb; v_source uuid; v_target uuid; v_alias_name text; v_key text;
  v_target_key text; v_alias_recorded boolean; v_batch uuid; v_inserted integer;
begin
  v_result:=tap_hub_project.relink_collections_client_accounts_pre_alias(p_links,p_actor);
  for v_result_item in select value from jsonb_array_elements(coalesce(v_result->'results','[]'::jsonb)) loop
    v_source:=(v_result_item->>'source_client_id')::uuid; v_target:=(v_result_item->>'target_client_id')::uuid;
    v_alias_recorded:=false;
    select name into v_alias_name from tap_hub_project.clients where id=v_source;
    select trim(regexp_replace(regexp_replace(regexp_replace(lower(coalesce(v_alias_name,'')),'[^a-z0-9]+',' ','g'),
      '\m(llc|incorporated|inc|ltd|limited|corp|corporation)\M','','g'),'\s+',' ','g')) into v_key;
    select trim(regexp_replace(regexp_replace(regexp_replace(lower(name),'[^a-z0-9]+',' ','g'),
      '\m(llc|incorporated|inc|ltd|limited|corp|corporation)\M','','g'),'\s+',' ','g'))
      into v_target_key from tap_hub_project.clients where id=v_target;
    if v_key<>'' and v_key is distinct from v_target_key then
      insert into tap_hub_project.collections_client_name_aliases(client_id,source_client_id,alias_name,normalized_name,created_by)
      values(v_target,v_source,v_alias_name,v_key,p_actor) on conflict(client_id,normalized_name) do nothing;
      get diagnostics v_inserted = row_count;
      v_alias_recorded:=v_inserted>0 or exists(select 1 from tap_hub_project.collections_client_name_aliases
        where client_id=v_target and normalized_name=v_key);
    end if;
    -- The prior operation guarantees there are no Billing invoices/payments.
    -- Keep the old client row for history but remove it from automatic matches.
    if not exists(select 1 from tap_hub_project.invoices where client_id=v_source)
      and not exists(select 1 from tap_hub_project.payments where client_id=v_source) then
      update tap_hub_project.clients set status='inactive' where id=v_source and status='active';
    end if;
    select batch_id into v_batch from tap_hub_project.collection_import_audit
    where action='client_relinked_to_operations' and actor=p_actor
      and detail->>'source_client_id'=v_source::text
      and detail->>'target_client_id'=v_target::text
    order by occurred_at desc limit 1;
    insert into tap_hub_project.collection_import_audit(batch_id,actor,action,detail)
    values(v_batch,p_actor,'client_relink_summary',jsonb_build_object(
      'source_client_id',v_source,'target_client_id',v_target,
      'invoice_identities_relinked',(v_result_item->>'invoice_identities_relinked')::integer,
      'holds_reassigned',(v_result_item->>'holds_reassigned')::integer,
      'events_reassigned',(v_result_item->>'events_reassigned')::integer,
      'delivery_attempts_reassigned',(v_result_item->>'delivery_attempts_reassigned')::integer,
      'source_deactivated',not exists(select 1 from tap_hub_project.clients where id=v_source and status='active'),
      'alias_recorded',v_alias_recorded,'canonical_identity_preserved',true));
  end loop;
  return v_result;
end; $$;
revoke all on function tap_hub_project.relink_collections_client_accounts(jsonb,uuid) from public,anon,authenticated;
grant execute on function tap_hub_project.relink_collections_client_accounts(jsonb,uuid) to service_role;

-- Acceptance event retains the attempt's one source identity; PDF-linked rows
-- intentionally set invoice_id NULL to satisfy the events identity constraint.
create or replace function tap_hub_project.accept_collection_delivery(
  p_attempt_id uuid,p_provider_message_id text,p_actor uuid default null
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_attempt tap_hub_project.collection_delivery_attempts%rowtype;
begin
  select * into v_attempt from tap_hub_project.collection_delivery_attempts where id=p_attempt_id for update;
  if not found or v_attempt.status<>'sending' then return false; end if;
  perform set_config('tap_hub.actor_id',coalesce(p_actor::text,''),true);
  update tap_hub_project.collection_delivery_attempts set status='accepted',reason_code=null,
    provider_message_id=p_provider_message_id,accepted_at=now(),sent_at=now(),updated_at=now() where id=p_attempt_id;
  if v_attempt.stage between 1 and 3 then
    insert into tap_hub_project.collection_events(client_id,invoice_id,source,source_invoice_id,canonical_collection_identity,event_type,stage,actor,detail)
    values(v_attempt.client_id,case when v_attempt.source='pdf_import' then null else v_attempt.invoice_id end,
      v_attempt.source,case when v_attempt.source='pdf_import' then v_attempt.source_invoice_id else null end,
      v_attempt.canonical_collection_identity,'reminder_logged',v_attempt.stage,p_actor,
      jsonb_build_object('delivery_attempt_id',p_attempt_id,'delivery_status','accepted')) on conflict do nothing;
  end if;
  return true;
end; $$;
revoke all on function tap_hub_project.accept_collection_delivery(uuid,text,uuid) from public,anon,authenticated;
grant execute on function tap_hub_project.accept_collection_delivery(uuid,text,uuid) to service_role;

-- Keep test-only eligibility but add a final primary-email syntax gate before
-- the delegated Billing/PDF claim functions can transition an attempt to sending.
alter function tap_hub_project.claim_collection_test_delivery(uuid,uuid)
  rename to claim_collection_test_delivery_pre_email_validation;
revoke all on function tap_hub_project.claim_collection_test_delivery_pre_email_validation(uuid,uuid) from public,anon,authenticated;
grant execute on function tap_hub_project.claim_collection_test_delivery_pre_email_validation(uuid,uuid) to service_role;
create function tap_hub_project.claim_collection_test_delivery(p_attempt_id uuid,p_actor uuid default null)
returns text language plpgsql security definer set search_path = '' as $$
declare v_attempt tap_hub_project.collection_delivery_attempts%rowtype; v_count integer; v_email text;
begin
  select * into v_attempt from tap_hub_project.collection_delivery_attempts where id=p_attempt_id;
  if not found or v_attempt.status<>'queued' then
    return tap_hub_project.claim_collection_test_delivery_pre_email_validation(p_attempt_id,p_actor);
  end if;
  if v_attempt.stage between 1 and 3 then
    select count(*),max(nullif(btrim(email),'')) into v_count,v_email from tap_hub_project.contacts
    where client_id=v_attempt.client_id and category='client' and is_primary;
    if v_count<>1 then return 'CONTACT_REVIEW_REQUIRED'; end if;
    if v_email is null then return 'EMAIL_CONTACT_MISSING'; end if;
    if v_email !~ '^[^[:space:]@"<>]+@[^[:space:]@"<>]+\.[^[:space:]@"<>]+$' then return 'EMAIL_CONTACT_INVALID'; end if;
  end if;
  return tap_hub_project.claim_collection_test_delivery_pre_email_validation(p_attempt_id,p_actor);
end; $$;
revoke all on function tap_hub_project.claim_collection_test_delivery(uuid,uuid) from public,anon,authenticated;
grant execute on function tap_hub_project.claim_collection_test_delivery(uuid,uuid) to service_role;

alter function tap_hub_project.get_collection_test_message_context(uuid)
  rename to get_collection_test_message_context_pre_email_validation;
revoke all on function tap_hub_project.get_collection_test_message_context_pre_email_validation(uuid) from public,anon,authenticated;
grant execute on function tap_hub_project.get_collection_test_message_context_pre_email_validation(uuid) to service_role;
create function tap_hub_project.get_collection_test_message_context(p_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_attempt tap_hub_project.collection_delivery_attempts%rowtype; v_count integer; v_email text;
begin
  select * into v_attempt from tap_hub_project.collection_delivery_attempts where id=p_attempt_id;
  if not found or v_attempt.status<>'sending' then
    return tap_hub_project.get_collection_test_message_context_pre_email_validation(p_attempt_id);
  end if;
  if v_attempt.stage between 1 and 3 then
    select count(*),max(nullif(btrim(email),'')) into v_count,v_email from tap_hub_project.contacts
    where client_id=v_attempt.client_id and category='client' and is_primary;
    if v_count<>1 then return jsonb_build_object('eligible',false,'reason_code','CONTACT_REVIEW_REQUIRED'); end if;
    if v_email is null then return jsonb_build_object('eligible',false,'reason_code','EMAIL_CONTACT_MISSING'); end if;
    if v_email !~ '^[^[:space:]@"<>]+@[^[:space:]@"<>]+\.[^[:space:]@"<>]+$' then
      return jsonb_build_object('eligible',false,'reason_code','EMAIL_CONTACT_INVALID');
    end if;
  end if;
  return tap_hub_project.get_collection_test_message_context_pre_email_validation(p_attempt_id);
end; $$;
revoke all on function tap_hub_project.get_collection_test_message_context(uuid) from public,anon,authenticated;
grant execute on function tap_hub_project.get_collection_test_message_context(uuid) to service_role;

commit;
