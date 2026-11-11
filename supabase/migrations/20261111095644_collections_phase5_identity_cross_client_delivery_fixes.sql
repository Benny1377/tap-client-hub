-- Phase 5 follow-ups: carry invoice identity only on an exact reviewed key,
-- allow globally paged activity reads, and keep PDF-only test claims source-aware.
-- This migration is local/branch-only until the owner authorizes Sandbox rollout.
begin;

create index if not exists idx_collection_import_invoice_identity_match
  on tap_hub_project.collection_import_invoices(invoice_number, transaction_date, source_as_of desc)
  where review_status = 'approved';

-- Reuse an existing source identity only when one prior approved invoice has the
-- exact same TAP client, invoice number, and transaction date. A partial key,
-- duplicate identity, or reused identity in this batch stays in manual review.
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
  v_matched integer := 0; v_uncertain integer := 0; v_unmatched integer := 0; v_identity_reused integer := 0;
begin
  select * into v_batch from tap_hub_project.collection_import_batches where id=p_batch_id for update;
  if not found then raise exception 'not_found: import batch does not exist' using errcode='P0002'; end if;
  if v_batch.status <> 'needs_review' or v_batch.report_type <> 'aging_detail' or v_batch.source_as_of is null then
    raise exception 'conflict: detail report is not available for automatic matching' using errcode='P0001';
  end if;
  if coalesce(cardinality(p_source_row_ids),0)>500 then
    raise exception 'invalid_input: too many rows in one automatic match' using errcode='22023';
  end if;

  foreach v_row_id in array coalesce(p_source_row_ids,array[]::uuid[]) loop
    select * into v_row from tap_hub_project.collection_import_rows
    where id=v_row_id and batch_id=p_batch_id for update;
    if not found or v_row.source_invoice_id is not null or v_row.review_disposition <> 'unreviewed' then
      v_uncertain:=v_uncertain+1; continue;
    end if;
    v_suggestion:=v_row.parsed_fields->'auto_suggestion'; v_fields:=v_suggestion->'fields';
    if v_suggestion->>'disposition'<>'invoice' or v_suggestion->>'confidence'<>'high'
      or v_fields->>'transaction_type'<>'Invoice'
      or coalesce(v_fields->>'invoice_number','')=''
      or coalesce(v_fields->>'customer_name','')=''
      or coalesce(v_fields->>'transaction_date','') !~ '^\d{4}-\d{2}-\d{2}$'
      or coalesce(v_fields->>'due_date','') !~ '^\d{4}-\d{2}-\d{2}$'
      or coalesce(v_fields->>'reported_aging','') !~ '^\d{1,4}$'
      or coalesce(v_fields->>'open_balance','') !~ '^-?\d{1,10}(\.\d{1,2})?$' then
      v_uncertain:=v_uncertain+1; continue;
    end if;

    v_customer_name:=v_fields->>'customer_name';
    v_customer_key:=trim(regexp_replace(regexp_replace(regexp_replace(lower(v_customer_name),'[^a-z0-9]+',' ','g'),
      '\m(llc|incorporated|inc|ltd|limited|corp|corporation)\M','','g'),'\s+',' ','g'));
    if v_customer_key='' then v_unmatched:=v_unmatched+1; continue; end if;
    select count(*) into v_client_count from tap_hub_project.clients c
    where c.status='active' and trim(regexp_replace(regexp_replace(regexp_replace(lower(c.name),'[^a-z0-9]+',' ','g'),
      '\m(llc|incorporated|inc|ltd|limited|corp|corporation)\M','','g'),'\s+',' ','g'))=v_customer_key;
    if v_client_count<>1 then v_unmatched:=v_unmatched+1; continue; end if;
    select c.id into v_client_id from tap_hub_project.clients c
    where c.status='active' and trim(regexp_replace(regexp_replace(regexp_replace(lower(c.name),'[^a-z0-9]+',' ','g'),
      '\m(llc|incorporated|inc|ltd|limited|corp|corporation)\M','','g'),'\s+',' ','g'))=v_customer_key;

    select count(distinct s.source_invoice_id), (array_agg(distinct s.source_invoice_id))[1]
      into v_exact_count,v_existing_source_invoice_id
    from tap_hub_project.collection_import_invoices prior
    join tap_hub_project.collection_import_batches prior_batch on prior_batch.id=prior.batch_id
    join tap_hub_project.collection_source_invoice_identities s using(source_invoice_id)
    where prior_batch.status='approved' and prior_batch.report_type='aging_detail'
      and prior_batch.source_as_of < v_batch.source_as_of and prior.review_status='approved'
      and s.client_id=v_client_id and prior.invoice_number=v_fields->>'invoice_number'
      and prior.transaction_date=(v_fields->>'transaction_date')::date;

    if v_exact_count>1 then v_uncertain:=v_uncertain+1; continue; end if;
    if v_exact_count=1 and exists(select 1 from tap_hub_project.collection_import_invoices used
      where used.batch_id=p_batch_id and used.source_invoice_id=v_existing_source_invoice_id) then
      v_uncertain:=v_uncertain+1; continue;
    end if;
    if v_exact_count=0 then
      select count(distinct s.source_invoice_id) into v_partial_count
      from tap_hub_project.collection_import_invoices prior
      join tap_hub_project.collection_import_batches prior_batch on prior_batch.id=prior.batch_id
      join tap_hub_project.collection_source_invoice_identities s using(source_invoice_id)
      where prior_batch.status='approved' and prior_batch.report_type='aging_detail'
        and prior_batch.source_as_of < v_batch.source_as_of and prior.review_status='approved'
        and s.client_id=v_client_id
        and (prior.invoice_number=v_fields->>'invoice_number'
          or prior.transaction_date=(v_fields->>'transaction_date')::date);
      if v_partial_count>0 then v_uncertain:=v_uncertain+1; continue; end if;
    end if;

    perform tap_hub_project.review_unreviewed_collection_import_invoice(
      p_batch_id,v_row_id,p_actor,v_client_id,null,v_existing_source_invoice_id,
      jsonb_build_object('invoice_number',v_fields->>'invoice_number','customer_name',v_customer_name,
        'customer_external_id',null,'transaction_type',v_fields->>'transaction_type',
        'transaction_date',v_fields->>'transaction_date','due_date',v_fields->>'due_date',
        'terms',v_fields->'terms','po_number',v_fields->'po_number',
        'reported_aging',(v_fields->>'reported_aging')::integer,'open_balance',v_fields->>'open_balance',
        'row_data',v_row.parsed_fields||jsonb_build_object('auto_match',jsonb_build_object(
          'method','unique_normalized_customer_name','client_id',v_client_id,
          'identity_method',case when v_exact_count=1 then 'exact_client_invoice_number_transaction_date' else 'new_invoice' end)))
    );
    v_matched:=v_matched+1;
    if v_exact_count=1 then v_identity_reused:=v_identity_reused+1; end if;
  end loop;
  return jsonb_build_object('matched',v_matched,'uncertain',v_uncertain,'unmatched_client',v_unmatched,
    'identity_reused',v_identity_reused);
end; $$;
revoke all on function tap_hub_project.auto_match_collection_import_rows(uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function tap_hub_project.auto_match_collection_import_rows(uuid,uuid,uuid[]) to service_role;

-- Cross-client activity is still bounded and paginated. A supplied client_id
-- remains a strict filter; omitting it returns the newest page across clients.
-- Application authorization remains requireLedgerReadAccess().

-- An explicit reminder stage must equal the eligible stage. Null eligibility is
-- not a bypass: a caller cannot record a reminder before its configured rule.
create or replace function tap_hub_project.record_collection_event_for_source(
  p_client_id uuid,p_source text,p_invoice_id uuid,p_source_invoice_id uuid,p_event_type text,
  p_actor uuid,p_stage integer default null,p_detail jsonb default '{}'::jsonb,p_approval_event_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_stage integer:=p_stage; v_eligible_stage integer;
begin
  if p_event_type='reminder_logged' then
    v_eligible_stage:=tap_hub_project.collections_source_next_reminder_stage(
      p_client_id,p_source,p_invoice_id,p_source_invoice_id,tap_hub_project.collections_firm_today());
    if v_stage is null then v_stage:=v_eligible_stage;
    elsif v_stage is distinct from v_eligible_stage then
      raise exception 'conflict: reminder stage is not the next eligible stage' using errcode='P0001';
    end if;
    if v_stage is null then raise exception 'conflict: no reminder stage is currently eligible' using errcode='P0001'; end if;
  end if;
  return tap_hub_project.record_collection_event_for_source_pre_phase5(
    p_client_id,p_source,p_invoice_id,p_source_invoice_id,p_event_type,p_actor,v_stage,p_detail,p_approval_event_id);
end; $$;
revoke all on function tap_hub_project.record_collection_event_for_source(uuid,text,uuid,uuid,text,uuid,integer,jsonb,uuid) from public,anon,authenticated;
grant execute on function tap_hub_project.record_collection_event_for_source(uuid,text,uuid,uuid,text,uuid,integer,jsonb,uuid) to service_role;

-- Preserve the existing Billing message-context implementation when present.
-- The consolidated sandbox baseline may not include this older helper, so
-- provide its established Billing-only behavior as a fallback for that schema.
do $migration$
begin
  if to_regprocedure('tap_hub_project.get_collection_test_message_context_pre_phase5_source(uuid)') is null then
    if to_regprocedure('tap_hub_project.get_collection_test_message_context(uuid)') is not null then
      execute 'alter function tap_hub_project.get_collection_test_message_context(uuid) '
        || 'rename to get_collection_test_message_context_pre_phase5_source';
    else
      execute $fallback$
        create function tap_hub_project.get_collection_test_message_context_pre_phase5_source(p_attempt_id uuid)
        returns jsonb language plpgsql security definer
        set search_path = tap_hub_project, public as $function$
        declare
          v_attempt collection_delivery_attempts%rowtype;
          v_invoice invoices%rowtype;
          v_client clients%rowtype;
          v_settings collection_settings%rowtype;
          v_balance numeric(12,2);
          v_primary integer;
          v_email integer;
          v_today date;
          v_local_time time;
        begin
          select * into v_attempt from collection_delivery_attempts where id = p_attempt_id;
          if not found or v_attempt.status <> 'sending' then
            return jsonb_build_object('eligible', false, 'reason_code', 'ATTEMPT_ALREADY_EXISTS');
          end if;
          select * into v_invoice from invoices where id = v_attempt.invoice_id;
          if not found or v_invoice.status <> 'issued' then
            return jsonb_build_object('eligible', false, 'reason_code', 'INVOICE_NOT_ELIGIBLE');
          end if;
          select * into v_client from clients where id = v_attempt.client_id;
          if not found then
            return jsonb_build_object('eligible', false, 'reason_code', 'INVOICE_NOT_ELIGIBLE');
          end if;
          if not v_invoice.is_synthetic or not v_client.is_synthetic then
            return jsonb_build_object('eligible', false, 'reason_code', 'SYNTHETIC_DATA_REQUIRED');
          end if;
          select * into v_settings from collection_settings where id = 'default';
          if not found or not v_settings.automation_enabled or v_settings.delivery_mode <> 'test' then
            return jsonb_build_object('eligible', false, 'reason_code', 'DELIVERY_DISABLED');
          end if;
          v_today := (now() at time zone v_settings.timezone)::date;
          v_local_time := (now() at time zone v_settings.timezone)::time;
          if v_local_time < v_settings.send_start or v_local_time >= v_settings.send_end
            or (v_settings.weekdays_only and extract(isodow from v_today) in (6, 7)) then
            return jsonb_build_object('eligible', false, 'reason_code', 'OUTSIDE_SEND_WINDOW');
          end if;
          select coalesce(sum(l.amount), 0) - coalesce((
            select sum(a.amount) from payment_allocations a join payments p on p.id = a.payment_id
            where a.invoice_id = v_invoice.id and p.status = 'recorded' and a.reversed_at is null
          ), 0) into v_balance from invoice_lines l where l.invoice_id = v_invoice.id;
          if v_balance <= 0 or v_balance < v_settings.minimum_balance then
            return jsonb_build_object('eligible', false, 'reason_code', 'BELOW_MINIMUM_BALANCE');
          end if;
          if exists(select 1 from collection_holds h where h.client_id = v_invoice.client_id and h.released_at is null
            and (h.expires_on is null or h.expires_on >= collections_firm_today())
            and (h.invoice_id is null or h.invoice_id = v_invoice.id)) then
            return jsonb_build_object('eligible', false, 'reason_code', 'ACTIVE_HOLD');
          end if;
          if v_attempt.stage <= 3 then
            select count(*) filter (where is_primary),
              count(*) filter (where is_primary and email is not null and btrim(email) <> '')
              into v_primary, v_email from contacts
              where client_id = v_invoice.client_id and category = 'client';
            if v_primary <> 1 then
              return jsonb_build_object('eligible', false, 'reason_code', 'CONTACT_REVIEW_REQUIRED');
            end if;
            if v_email <> 1 then
              return jsonb_build_object('eligible', false, 'reason_code', 'EMAIL_CONTACT_MISSING');
            end if;
          end if;
          return jsonb_build_object('eligible', true, 'invoice_number', v_invoice.invoice_number,
            'balance', v_balance::text, 'due_date', v_invoice.due_date::text,
            'days_past_due', greatest(collections_firm_today() - v_invoice.due_date, 0));
        end;
        $function$
      $fallback$;
    end if;
  end if;
end;
$migration$;
revoke all on function tap_hub_project.get_collection_test_message_context_pre_phase5_source(uuid)
  from public,anon,authenticated;
grant execute on function tap_hub_project.get_collection_test_message_context_pre_phase5_source(uuid) to service_role;

create or replace function tap_hub_project.claim_collection_test_delivery(p_attempt_id uuid,p_actor uuid default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_attempt tap_hub_project.collection_delivery_attempts%rowtype;
  v_identity tap_hub_project.collection_source_invoice_identities%rowtype;
  v_item tap_hub_project.collection_import_invoices%rowtype;
  v_client tap_hub_project.clients%rowtype;
  v_billing_invoice tap_hub_project.invoices%rowtype;
  v_settings tap_hub_project.collection_settings%rowtype;
  v_rule tap_hub_project.collection_ladder_rules%rowtype;
  v_completed integer:=0; v_primary integer:=0; v_email integer:=0;
  v_balance numeric(12,2); v_unallocated numeric(12,2); v_today date; v_local_time time;
  v_last_completed date; v_eligible date; v_pending boolean;
begin
  select * into v_attempt from tap_hub_project.collection_delivery_attempts where id=p_attempt_id for update;
  if not found or v_attempt.status<>'queued' then return 'ATTEMPT_ALREADY_EXISTS'; end if;
  select * into v_identity from tap_hub_project.collection_source_invoice_identities
    where canonical_collection_identity=v_attempt.canonical_collection_identity for update;
  if not found then return 'INVOICE_NOT_ELIGIBLE'; end if;
  if v_identity.cleared_as_of is not null then return 'SOURCE_CLEARED'; end if;
  if v_attempt.source<>'pdf_import' then
    return tap_hub_project.claim_collection_test_delivery_pre_phase5(p_attempt_id,p_actor);
  end if;
  if v_attempt.source_invoice_id is null or v_identity.source_invoice_id<>v_attempt.source_invoice_id
    or v_identity.client_id<>v_attempt.client_id or v_identity.selected_source<>'pdf_import'
    or v_identity.linked_invoice_id is distinct from v_attempt.invoice_id then return 'INVOICE_NOT_ELIGIBLE'; end if;
  if v_attempt.stage not between 1 and 4 then return 'APPROVAL_REQUIRED'; end if;
  select * into v_settings from tap_hub_project.collection_settings where id='default';
  if not found or not v_settings.automation_enabled or v_settings.delivery_mode<>'test' then return 'DELIVERY_DISABLED'; end if;
  select * into v_client from tap_hub_project.clients where id=v_attempt.client_id;
  if not found then return 'INVOICE_NOT_ELIGIBLE'; end if;
  if not v_client.is_synthetic then return 'SYNTHETIC_DATA_REQUIRED'; end if;
  if v_attempt.invoice_id is not null then
    select * into v_billing_invoice from tap_hub_project.invoices where id=v_attempt.invoice_id and client_id=v_attempt.client_id;
    if not found or not v_billing_invoice.is_synthetic then return 'SYNTHETIC_DATA_REQUIRED'; end if;
  end if;
  select i.* into v_item from tap_hub_project.collection_import_invoices i
    join tap_hub_project.collection_import_batches b on b.id=i.batch_id
    where i.source_invoice_id=v_attempt.source_invoice_id and b.status='approved'
      and i.review_status='approved' order by i.source_as_of desc,i.updated_at desc,i.id desc limit 1;
  if not found or v_item.discrepancy_status='blocked' then
    return case when found then 'SOURCE_DISCREPANCY_BLOCKED' else 'INVOICE_NOT_ELIGIBLE' end;
  end if;
  if v_item.due_date is null then return 'INVOICE_NOT_ELIGIBLE'; end if;
  v_balance:=v_item.open_balance;
  if v_balance<=0 or v_balance<v_settings.minimum_balance then return 'BELOW_MINIMUM_BALANCE'; end if;
  if exists(select 1 from tap_hub_project.collection_holds h where h.client_id=v_attempt.client_id
    and h.released_at is null and (h.expires_on is null or h.expires_on>=tap_hub_project.collections_firm_today())
    and (h.canonical_collection_identity is null or h.canonical_collection_identity=v_attempt.canonical_collection_identity)) then
    return 'ACTIVE_HOLD';
  end if;
  select coalesce(sum(p.amount-coalesce(a.used,0)),0) into v_unallocated
  from tap_hub_project.payments p left join lateral (
    select sum(pa.amount) used from tap_hub_project.payment_allocations pa
    where pa.payment_id=p.id and pa.reversed_at is null
  ) a on true where p.client_id=v_attempt.client_id and p.status='recorded';
  if v_attempt.stage<=3 then
    if v_unallocated>0 then return 'UNALLOCATED_CREDIT_REVIEW'; end if;
    select count(*) filter(where is_primary),count(*) filter(where is_primary and email is not null and btrim(email)<>'')
      into v_primary,v_email from tap_hub_project.contacts where client_id=v_attempt.client_id and category='client';
    if v_primary<>1 then return 'CONTACT_REVIEW_REQUIRED'; end if;
    if v_email<>1 then return 'EMAIL_CONTACT_MISSING'; end if;
  end if;
  v_today:=(now() at time zone v_settings.timezone)::date;
  v_local_time:=(now() at time zone v_settings.timezone)::time;
  if v_local_time<v_settings.send_start or v_local_time>=v_settings.send_end
    or (v_settings.weekdays_only and extract(isodow from v_today) in (6,7)) then return 'OUTSIDE_SEND_WINDOW'; end if;
  select * into v_rule from tap_hub_project.collection_ladder_rules where stage=v_attempt.stage;
  if not found or not v_rule.enabled or (v_attempt.stage<=3 and not v_rule.automatic)
    or (v_attempt.stage=4 and v_rule.automatic) then return 'RULE_DISABLED'; end if;
  if v_attempt.stage<=3 then
    if tap_hub_project.collections_source_next_reminder_stage(v_attempt.client_id,'pdf_import',null,v_attempt.source_invoice_id,v_today)
      is distinct from v_attempt.stage then return 'STAGE_NOT_DUE'; end if;
  else
    select greatest(
      coalesce((select max(case when e.event_type='escalated' then 4 when e.event_type in ('formal_notice_approved','formal_notice_sent') then 5
        when e.event_type='reminder_logged' then least(coalesce(e.stage,1),3) else 0 end)
        from tap_hub_project.collection_events e where e.canonical_collection_identity=v_attempt.canonical_collection_identity),0),
      coalesce((select max(d.stage) from tap_hub_project.collection_delivery_attempts d
        where d.canonical_collection_identity=v_attempt.canonical_collection_identity and d.status='accepted' and d.stage<=3),0)
    ) into v_completed;
    select exists(select 1 from tap_hub_project.collection_events q where q.canonical_collection_identity=v_attempt.canonical_collection_identity
      and q.event_type in ('escalation_requested','formal_notice_requested')
      and not exists(select 1 from tap_hub_project.collection_events a where a.approves_event_id=q.id)) into v_pending;
    v_eligible:=v_item.due_date+v_rule.days_past_due;
    if v_balance>=v_settings.direct_escalation_threshold and v_completed<4 and not v_pending then
      null; -- Approved high-balance internal escalation path.
    elsif v_completed<>3 or v_eligible>v_today or v_pending then return 'STAGE_NOT_DUE';
    else
      select max((e.occurred_at at time zone v_settings.timezone)::date) into v_last_completed
      from tap_hub_project.collection_events e where e.canonical_collection_identity=v_attempt.canonical_collection_identity
        and e.stage=3 and e.event_type='reminder_logged';
      select greatest(v_last_completed,max((d.accepted_at at time zone v_settings.timezone)::date)) into v_last_completed
      from tap_hub_project.collection_delivery_attempts d where d.canonical_collection_identity=v_attempt.canonical_collection_identity
        and d.stage=3 and d.status='accepted' and d.accepted_at is not null;
      if greatest(v_eligible,coalesce(v_last_completed,v_item.due_date)+v_rule.min_days_since_previous)>v_today then return 'STAGE_NOT_DUE'; end if;
    end if;
  end if;
  perform set_config('tap_hub.actor_id',coalesce(p_actor::text,''),true);
  update tap_hub_project.collection_delivery_attempts set status='sending',attempt_count=attempt_count+1,
    actor=p_actor,reason_code=null,updated_at=now() where id=p_attempt_id and status='queued';
  if not found then return 'ATTEMPT_ALREADY_EXISTS'; end if;
  return null;
end; $$;
revoke all on function tap_hub_project.claim_collection_test_delivery(uuid,uuid) from public,anon,authenticated;
grant execute on function tap_hub_project.claim_collection_test_delivery(uuid,uuid) to service_role;

create or replace function tap_hub_project.get_collection_test_message_context(p_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_attempt tap_hub_project.collection_delivery_attempts%rowtype;
  v_identity tap_hub_project.collection_source_invoice_identities%rowtype;
  v_item tap_hub_project.collection_import_invoices%rowtype;
  v_client tap_hub_project.clients%rowtype;
  v_billing_invoice tap_hub_project.invoices%rowtype;
  v_settings tap_hub_project.collection_settings%rowtype;
  v_primary integer; v_email integer; v_balance numeric(12,2); v_today date; v_local_time time;
begin
  select * into v_attempt from tap_hub_project.collection_delivery_attempts where id=p_attempt_id;
  if not found or v_attempt.status<>'sending' then return jsonb_build_object('eligible',false,'reason_code','ATTEMPT_ALREADY_EXISTS'); end if;
  if v_attempt.source<>'pdf_import' then
    return tap_hub_project.get_collection_test_message_context_pre_phase5_source(p_attempt_id);
  end if;
  select * into v_identity from tap_hub_project.collection_source_invoice_identities
    where canonical_collection_identity=v_attempt.canonical_collection_identity;
  if not found then return jsonb_build_object('eligible',false,'reason_code','INVOICE_NOT_ELIGIBLE'); end if;
  if v_identity.cleared_as_of is not null then return jsonb_build_object('eligible',false,'reason_code','SOURCE_CLEARED'); end if;
  if v_identity.source_invoice_id<>v_attempt.source_invoice_id or v_identity.client_id<>v_attempt.client_id
    or v_identity.selected_source<>'pdf_import' or v_identity.linked_invoice_id is distinct from v_attempt.invoice_id then
    return jsonb_build_object('eligible',false,'reason_code','INVOICE_NOT_ELIGIBLE');
  end if;
  select i.* into v_item from tap_hub_project.collection_import_invoices i
    join tap_hub_project.collection_import_batches b on b.id=i.batch_id
    where i.source_invoice_id=v_attempt.source_invoice_id and b.status='approved' and i.review_status='approved'
    order by i.source_as_of desc,i.updated_at desc,i.id desc limit 1;
  if not found then return jsonb_build_object('eligible',false,'reason_code','INVOICE_NOT_ELIGIBLE'); end if;
  if v_item.discrepancy_status='blocked' then return jsonb_build_object('eligible',false,'reason_code','SOURCE_DISCREPANCY_BLOCKED'); end if;
  if v_item.due_date is null then return jsonb_build_object('eligible',false,'reason_code','INVOICE_NOT_ELIGIBLE'); end if;
  select * into v_client from tap_hub_project.clients where id=v_attempt.client_id;
  if not found then return jsonb_build_object('eligible',false,'reason_code','INVOICE_NOT_ELIGIBLE'); end if;
  if not v_client.is_synthetic then return jsonb_build_object('eligible',false,'reason_code','SYNTHETIC_DATA_REQUIRED'); end if;
  if v_attempt.invoice_id is not null then
    select * into v_billing_invoice from tap_hub_project.invoices where id=v_attempt.invoice_id and client_id=v_attempt.client_id;
    if not found or not v_billing_invoice.is_synthetic then
      return jsonb_build_object('eligible',false,'reason_code','SYNTHETIC_DATA_REQUIRED');
    end if;
  end if;
  select * into v_settings from tap_hub_project.collection_settings where id='default';
  if not found or not v_settings.automation_enabled or v_settings.delivery_mode<>'test' then
    return jsonb_build_object('eligible',false,'reason_code','DELIVERY_DISABLED'); end if;
  v_today:=(now() at time zone v_settings.timezone)::date; v_local_time:=(now() at time zone v_settings.timezone)::time;
  if v_local_time<v_settings.send_start or v_local_time>=v_settings.send_end
    or (v_settings.weekdays_only and extract(isodow from v_today) in (6,7)) then
    return jsonb_build_object('eligible',false,'reason_code','OUTSIDE_SEND_WINDOW'); end if;
  v_balance:=v_item.open_balance;
  if v_balance<=0 or v_balance<v_settings.minimum_balance then return jsonb_build_object('eligible',false,'reason_code','BELOW_MINIMUM_BALANCE'); end if;
  if exists(select 1 from tap_hub_project.collection_holds h where h.client_id=v_attempt.client_id and h.released_at is null
    and (h.expires_on is null or h.expires_on>=tap_hub_project.collections_firm_today())
    and (h.canonical_collection_identity is null or h.canonical_collection_identity=v_attempt.canonical_collection_identity)) then
    return jsonb_build_object('eligible',false,'reason_code','ACTIVE_HOLD'); end if;
  if v_attempt.stage<=3 then
    select count(*) filter(where is_primary),count(*) filter(where is_primary and email is not null and btrim(email)<>'')
      into v_primary,v_email from tap_hub_project.contacts where client_id=v_attempt.client_id and category='client';
    if v_primary<>1 then return jsonb_build_object('eligible',false,'reason_code','CONTACT_REVIEW_REQUIRED'); end if;
    if v_email<>1 then return jsonb_build_object('eligible',false,'reason_code','EMAIL_CONTACT_MISSING'); end if;
  end if;
  return jsonb_build_object('eligible',true,'invoice_number',v_item.invoice_number,'balance',v_balance::text,
    'due_date',v_item.due_date::text,'days_past_due',greatest(tap_hub_project.collections_firm_today()-v_item.due_date,0));
end; $$;
revoke all on function tap_hub_project.get_collection_test_message_context(uuid) from public,anon,authenticated;
grant execute on function tap_hub_project.get_collection_test_message_context(uuid) to service_role;

-- Keep the existing direct-escalation threshold: it remains an input to stage-4
-- test eligibility and the high-balance worklist metric.

commit;
