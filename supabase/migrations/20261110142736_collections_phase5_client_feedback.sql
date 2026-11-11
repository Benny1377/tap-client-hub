-- Collections Phase 5: client feedback rules, read models and report clearing.
-- Shared Sandbox deployment is a separate, owner-authorized release step.
begin;

alter table tap_hub_project.collection_ladder_rules
  add column if not exists min_days_since_previous integer not null default 0;
alter table tap_hub_project.collection_ladder_rules
  add constraint collection_ladder_min_gap_range
  check (min_days_since_previous between 0 and 3650) not valid;
alter table tap_hub_project.collection_ladder_rules validate constraint collection_ladder_min_gap_range;
update tap_hub_project.collection_ladder_rules
set min_days_since_previous = case when stage between 2 and 4 then 7 else 0 end
where min_days_since_previous = 0;

alter table tap_hub_project.collection_source_invoice_identities
  add column if not exists cleared_as_of date,
  add column if not exists cleared_by_batch_id uuid references tap_hub_project.collection_import_batches(id),
  add column if not exists reopened_at timestamptz,
  add column if not exists reopened_by_batch_id uuid references tap_hub_project.collection_import_batches(id);
create index if not exists idx_collection_identity_cleared
  on tap_hub_project.collection_source_invoice_identities(cleared_as_of, client_id)
  where cleared_as_of is not null;
create index if not exists idx_collection_import_approved_identity_date
  on tap_hub_project.collection_import_invoices(source_invoice_id, source_as_of desc, updated_at desc);
create index if not exists idx_collection_events_client_notes
  on tap_hub_project.collection_events(client_id, occurred_at desc, id desc) where event_type = 'note';
create index if not exists idx_collection_attempts_client_canonical
  on tap_hub_project.collection_delivery_attempts(client_id, canonical_collection_identity, stage, status);

-- Keep the existing configuration RPC as the audited writer for unchanged fields.
-- This wrapper strips the new field before delegating, then updates it in the same
-- transaction so either both writes/audit rows commit or neither does.
create or replace function tap_hub_project.update_collections_configuration_phase5(
  p_actor uuid, p_rules jsonb default '[]'::jsonb, p_settings jsonb default '{}'::jsonb
) returns boolean language plpgsql security definer
set search_path = tap_hub_project, public as $$
declare
  v_rules_without_gap jsonb;
  v_rule jsonb;
  v_gap integer;
begin
  if jsonb_typeof(p_rules) <> 'array' then
    raise exception 'invalid_input: rules must be an array' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(value - 'min_days_since_previous'), '[]'::jsonb)
    into v_rules_without_gap from jsonb_array_elements(p_rules);
  perform update_collections_configuration(p_actor, v_rules_without_gap, p_settings);
  perform set_config('tap_hub.actor_id', p_actor::text, true);
  for v_rule in select value from jsonb_array_elements(p_rules) loop
    if v_rule ? 'min_days_since_previous' then
      if (v_rule->>'min_days_since_previous') !~ '^\d{1,4}$' then
        raise exception 'invalid_input: minimum gap must be an integer' using errcode = '22023';
      end if;
      v_gap := (v_rule->>'min_days_since_previous')::integer;
      if v_gap < 0 or v_gap > 3650 then
        raise exception 'invalid_input: minimum gap is out of range' using errcode = '22023';
      end if;
      update collection_ladder_rules set min_days_since_previous = v_gap,
        updated_by = p_actor, updated_at = now() where stage = (v_rule->>'stage')::integer;
      if not found then raise exception 'not_found: Collections rule does not exist' using errcode = 'P0002'; end if;
    end if;
  end loop;
  return true;
end; $$;

-- Canonical stage calculation: no history starts at Friendly; every subsequent
-- stage waits for both its configured age threshold and its minimum stage gap.
create or replace function tap_hub_project.collections_invoice_stage_context(
  p_client_id uuid, p_invoice_id uuid, p_due_date date, p_as_of_date date
) returns jsonb language plpgsql stable security definer
set search_path = tap_hub_project, public as $$
declare
  v_as_of date := coalesce(p_as_of_date, collections_firm_today());
  v_timezone text;
  v_days integer;
  v_completed integer := 0;
  v_current integer := 0;
  v_next integer;
  v_upcoming integer;
  v_pending jsonb;
  v_last_completed_on date;
  v_eligible_on date;
  v_threshold integer;
  v_gap integer;
begin
  select coalesce(nullif(timezone,''),'America/Chicago') into v_timezone from collection_settings where id='default';
  v_timezone := coalesce(v_timezone,'America/Chicago');
  v_days := greatest(v_as_of - p_due_date,0);

  select coalesce(max(case
    when e.event_type = 'escalated' then 4
    when e.event_type in ('formal_notice_approved','formal_notice_sent') then 5
    when e.event_type = 'reminder_logged' then least(coalesce(e.stage,1),3)
    else 0 end),0)
  into v_completed
  from collection_events e
  where e.client_id=p_client_id and (e.invoice_id=p_invoice_id or
    (e.invoice_id is null and e.event_type in ('escalated','escalation_requested','formal_notice_requested',
      'formal_notice_approved','formal_notice_sent') and p_due_date <= (e.occurred_at at time zone v_timezone)::date))
    and (e.occurred_at at time zone v_timezone)::date <= v_as_of;

  select greatest(v_completed,coalesce(max(d.stage),0)) into v_completed
  from collection_delivery_attempts d
  where d.invoice_id=p_invoice_id and d.status='accepted' and d.stage <= 3;

  select coalesce(max(r.stage),0) into v_current from collection_ladder_rules r
  where r.enabled and r.days_past_due <= v_days;

  select jsonb_build_object('event_id',q.id,'event_type',q.event_type,
      'stage',case when q.event_type='escalation_requested' then 4 else 5 end,'requested_at',q.occurred_at)
  into v_pending from collection_events q
  where q.client_id=p_client_id and (q.invoice_id=p_invoice_id or
    (q.invoice_id is null and q.event_type in ('escalation_requested','formal_notice_requested')
      and p_due_date <= (q.occurred_at at time zone v_timezone)::date))
    and q.event_type in ('escalation_requested','formal_notice_requested')
    and (q.occurred_at at time zone v_timezone)::date <= v_as_of
    and not exists(select 1 from collection_events a where a.approves_event_id=q.id)
  order by q.occurred_at desc limit 1;

  select min(r.stage) into v_upcoming from collection_ladder_rules r
  where r.enabled and r.stage > v_completed;
  if v_pending is null then
    -- The first touch is fixed to stage 1. Later stages advance one rung at a time.
    select r.stage, r.days_past_due, r.min_days_since_previous
      into v_next,v_threshold,v_gap from collection_ladder_rules r
      where r.enabled and r.stage = case when v_completed=0 then 1 else v_completed+1 end;
    if v_next is not null then
      if v_completed=0 then
        v_eligible_on := p_due_date + v_threshold;
      else
        select max((e.occurred_at at time zone v_timezone)::date) into v_last_completed_on
        from collection_events e
        where e.client_id=p_client_id and e.invoice_id=p_invoice_id
          and coalesce(e.stage,0)=v_completed
          and e.event_type in ('reminder_logged','escalated','formal_notice_approved','formal_notice_sent');
        select greatest(v_last_completed_on, max((d.accepted_at at time zone v_timezone)::date))
          into v_last_completed_on from collection_delivery_attempts d
        where d.invoice_id=p_invoice_id and d.stage=v_completed and d.status='accepted';
        v_eligible_on := greatest(p_due_date + v_threshold,
          coalesce(v_last_completed_on,p_due_date) + coalesce(v_gap,0));
      end if;
      if v_eligible_on > v_as_of then v_next := null; end if;
    end if;
  end if;
  return jsonb_build_object('current_stage',v_current,'completed_stage',v_completed,
    'upcoming_stage',v_upcoming,'next_stage',v_next,'next_stage_eligible_on',v_eligible_on,
    'awaiting_approval',v_pending);
end; $$;

-- Shared source-aware reminder stage selector for manual event logging as well
-- as the Billing stage-context RPC.
create or replace function tap_hub_project.collections_source_next_reminder_stage(
  p_client_id uuid,p_source text,p_invoice_id uuid,p_source_invoice_id uuid,p_as_of date default null
) returns integer language plpgsql stable security definer
set search_path=tap_hub_project,public as $$
declare
  v_identity text; v_due date; v_as_of date:=coalesce(p_as_of,collections_firm_today());
  v_timezone text; v_completed integer:=0; v_stage integer; v_gap integer; v_threshold integer;
  v_completed_at date; v_eligible date;
begin
  select canonical_collection_identity into v_identity from collection_source_invoice_identities
  where (p_source='billing' and linked_invoice_id=p_invoice_id)
     or (p_source='pdf_import' and source_invoice_id=p_source_invoice_id)
  order by (source_invoice_id=p_source_invoice_id) desc limit 1;
  if v_identity is null then
    v_identity:=case when p_source='billing' then 'billing:'||p_invoice_id::text else 'pdf_import:'||p_source_invoice_id::text end;
  end if;
  select coalesce(nullif(timezone,''),'America/Chicago') into v_timezone from collection_settings where id='default';
  if p_source='billing' then select due_date into v_due from invoices where id=p_invoice_id and client_id=p_client_id;
  else select i.due_date into v_due from collection_import_invoices i join collection_import_batches b on b.id=i.batch_id
    where i.source_invoice_id=p_source_invoice_id and b.status='approved' and i.review_status='approved'
    order by i.source_as_of desc,i.updated_at desc limit 1;
  end if;
  if v_due is null then return null; end if;
  select greatest(
    coalesce((select max(case when e.event_type='escalated' then 4 when e.event_type='formal_notice_sent' then 5
      when e.event_type='reminder_logged' then least(coalesce(e.stage,1),3) else 0 end)
      from collection_events e where e.canonical_collection_identity=v_identity),0),
    coalesce((select max(d.stage) from collection_delivery_attempts d where d.canonical_collection_identity=v_identity
      and d.status='accepted' and d.stage<=3),0)) into v_completed;
  if v_completed>=3 then return null; end if;
  v_stage:=case when v_completed=0 then 1 else v_completed+1 end;
  select days_past_due,min_days_since_previous into v_threshold,v_gap from collection_ladder_rules
  where stage=v_stage and enabled and automatic;
  if not found then return null; end if;
  select max(local_date) into v_completed_at from (
    select (e.occurred_at at time zone coalesce(v_timezone,'America/Chicago'))::date as local_date
    from collection_events e where e.canonical_collection_identity=v_identity and e.stage=v_completed
      and e.event_type='reminder_logged'
    union all
    select (d.accepted_at at time zone coalesce(v_timezone,'America/Chicago'))::date
    from collection_delivery_attempts d where d.canonical_collection_identity=v_identity and d.stage=v_completed
      and d.status='accepted' and d.accepted_at is not null
  ) completed_dates;
  v_eligible:=greatest(v_due+v_threshold,coalesce(v_completed_at,v_due)+case when v_completed=0 then 0 else coalesce(v_gap,0) end);
  if v_eligible>v_as_of then return null; end if;
  return v_stage;
end; $$;

-- Replace the prior catch-up default with the shared source-aware next stage.
alter function tap_hub_project.record_collection_event_for_source(uuid,text,uuid,uuid,text,uuid,integer,jsonb,uuid)
  rename to record_collection_event_for_source_pre_phase5;
revoke all on function tap_hub_project.record_collection_event_for_source_pre_phase5(uuid,text,uuid,uuid,text,uuid,integer,jsonb,uuid)
  from public,anon,authenticated,service_role;
create or replace function tap_hub_project.record_collection_event_for_source(
  p_client_id uuid,p_source text,p_invoice_id uuid,p_source_invoice_id uuid,p_event_type text,
  p_actor uuid,p_stage integer default null,p_detail jsonb default '{}'::jsonb,p_approval_event_id uuid default null
) returns uuid language plpgsql security definer set search_path=tap_hub_project,public as $$
declare v_stage integer:=p_stage; v_eligible_stage integer;
begin
  if p_event_type='reminder_logged' then
    v_eligible_stage:=collections_source_next_reminder_stage(p_client_id,p_source,p_invoice_id,p_source_invoice_id,collections_firm_today());
    if v_stage is null then
      v_stage:=v_eligible_stage;
    elsif v_eligible_stage is not null and v_stage is distinct from v_eligible_stage then
      raise exception 'conflict: reminder stage is not the next eligible stage' using errcode='P0001';
    end if;
    if v_stage is null then raise exception 'conflict: no reminder stage is currently eligible' using errcode='P0001'; end if;
  end if;
  return record_collection_event_for_source_pre_phase5(
    p_client_id,p_source,p_invoice_id,p_source_invoice_id,p_event_type,p_actor,v_stage,p_detail,p_approval_event_id);
end; $$;

-- Aggregates expose note metadata only, never note contents.
create or replace function tap_hub_project.get_collections_note_summaries(p_client_ids uuid[])
returns table(client_id uuid,note_count bigint,last_note_at timestamptz)
language sql stable security definer set search_path=tap_hub_project,public as $$
  select e.client_id,count(*)::bigint,max(e.occurred_at)
  from collection_events e where e.event_type='note' and e.client_id=any(p_client_ids)
  group by e.client_id
$$;

-- Count dated evidence only. Billing paid invoices are deliberately omitted if
-- the ledger cannot prove their settlement crossed the configured deadline.
create or replace function tap_hub_project.get_collections_late_history(p_as_of date default null)
returns table(client_id uuid,late_beyond_final_count bigint)
language sql stable security definer set search_path=tap_hub_project,public as $$
  with cfg as (
    select coalesce(p_as_of,collections_firm_today()) as as_of_date,
      coalesce((select nullif(timezone,'') from collection_settings where id='default'),'America/Chicago') as timezone,
      (select r.stage from collection_ladder_rules r where r.enabled order by r.stage desc limit 1) as stage,
      (select r.label from collection_ladder_rules r where r.enabled order by r.stage desc limit 1) as label,
      (select r.days_past_due from collection_ladder_rules r where r.enabled order by r.stage desc limit 1) as threshold
  ), invoice_totals as (
    select i.id,i.client_id,i.due_date,coalesce(sum(il.amount),0)::numeric(12,2) as total_amount
    from invoices i left join invoice_lines il on il.invoice_id=i.id
    where i.status='issued' group by i.id,i.client_id,i.due_date
  ), allocation_events as (
    select pa.invoice_id,greatest(p.received_on,(pa.created_at at time zone (select timezone from cfg))::date) as effective_on,
      sum(pa.amount)::numeric(12,2) as allocated
    from payment_allocations pa join payments p on p.id=pa.payment_id
    where pa.reversed_at is null and p.status='recorded'
    group by pa.invoice_id,greatest(p.received_on,(pa.created_at at time zone (select timezone from cfg))::date)
  ), allocation_running as (
    select invoice_id,effective_on,sum(allocated) over(partition by invoice_id order by effective_on rows unbounded preceding) as total_allocated
    from allocation_events
  ), settled as (
    select t.id as invoice_id,min(r.effective_on) as settled_on
    from invoice_totals t join allocation_running r on r.invoice_id=t.id and r.total_allocated>=t.total_amount
    group by t.id
  ), billing_open as (
    select coalesce(s.canonical_collection_identity,'billing:'||i.id::text) as identity,
      i.client_id,(i.due_date + cfg.threshold + 1) as crossed_on
    from invoice_totals i cross join cfg
    left join collection_source_invoice_identities s on s.linked_invoice_id=i.id
    left join settled st on st.invoice_id=i.id
    where i.due_date is not null and i.total_amount>0
      and greatest(cfg.as_of_date-i.due_date,0)>cfg.threshold
      and ((i.total_amount-(select coalesce(sum(pa.amount),0) from payment_allocations pa
            join payments p on p.id=pa.payment_id where pa.invoice_id=i.id and pa.reversed_at is null and p.status='recorded'))>0
        or st.settled_on > i.due_date+cfg.threshold)
      and (s.selected_source is distinct from 'pdf_import')
  ), pdf_seen as (
    select distinct on (s.canonical_collection_identity) s.canonical_collection_identity as identity,
      s.client_id, greatest(i.source_as_of-coalesce(i.due_date,i.source_as_of),0) as days_past_due,
      i.source_as_of as crossed_on
    from collection_import_invoices i
    join collection_import_batches b on b.id=i.batch_id and b.status='approved'
    join collection_source_invoice_identities s using(source_invoice_id)
    cross join cfg
    where i.review_status='approved' and i.discrepancy_status<>'blocked'
      and s.canonical_collection_identity is not null and s.client_id is not null
      and greatest(i.source_as_of-coalesce(i.due_date,i.source_as_of),0)>cfg.threshold
      and i.source_as_of >= (cfg.as_of_date - interval '12 months')::date
    order by s.canonical_collection_identity,i.source_as_of desc,i.updated_at desc
  ), all_evidence as (
    select identity,client_id,crossed_on from billing_open
      where crossed_on >= ((select as_of_date from cfg)-interval '12 months')::date
    union
    select identity,client_id,crossed_on from pdf_seen
  )
  select e.client_id,count(distinct e.identity)::bigint from all_evidence e group by e.client_id
$$;

create or replace function tap_hub_project.preview_collection_import_clear(
  p_detail_batch_id uuid,p_limit integer default 50,p_offset integer default 0
) returns jsonb language plpgsql stable security definer
set search_path=tap_hub_project,public as $$
declare v_as_of date; v_newest date; v_count bigint; v_balance numeric(12,2); v_items jsonb;
begin
  if p_limit not between 1 and 200 or p_offset not between 0 and 100000 then
    raise exception 'invalid_input: invalid page bounds' using errcode='22023';
  end if;
  select source_as_of into v_as_of from collection_import_batches where id=p_detail_batch_id and report_type='aging_detail';
  if v_as_of is null then raise exception 'not_found: detail report not found' using errcode='P0002'; end if;
  select max(source_as_of) into v_newest from collection_import_batches where report_type='aging_detail' and status='approved';
  if v_newest is not null and v_as_of<=v_newest then
    return jsonb_build_object('count',0,'total_balance','0.00','items','[]'::jsonb,
      'pagination',jsonb_build_object('limit',p_limit,'offset',p_offset,'total',0));
  end if;
  with latest as (
    select distinct on(i.source_invoice_id) i.source_invoice_id,i.invoice_number,i.open_balance,i.source_as_of
    from collection_import_invoices i join collection_import_batches b on b.id=i.batch_id
    where b.status='approved' and i.review_status='approved' and i.source_as_of<v_as_of
    order by i.source_invoice_id,i.source_as_of desc,i.updated_at desc,i.id desc
  ), candidates as (
    select s.source_invoice_id,s.canonical_collection_identity,s.client_id,l.invoice_number,l.open_balance,l.source_as_of
    from latest l join collection_source_invoice_identities s using(source_invoice_id)
    where s.selected_source='pdf_import' and s.linked_invoice_id is null and s.canonical_collection_identity is not null
      and s.cleared_as_of is null
      and not exists(select 1 from collection_import_invoices n where n.batch_id=p_detail_batch_id and n.source_invoice_id=s.source_invoice_id)
  )
  select count(*),coalesce(sum(open_balance),0)::numeric(12,2) into v_count,v_balance from candidates;
  with latest as (
    select distinct on(i.source_invoice_id) i.source_invoice_id,i.invoice_number,i.open_balance,i.source_as_of
    from collection_import_invoices i join collection_import_batches b on b.id=i.batch_id
    where b.status='approved' and i.review_status='approved' and i.source_as_of<v_as_of
    order by i.source_invoice_id,i.source_as_of desc,i.updated_at desc,i.id desc
  ), candidates as (
    select s.source_invoice_id,s.canonical_collection_identity,s.client_id,l.invoice_number,l.open_balance,l.source_as_of
    from latest l join collection_source_invoice_identities s using(source_invoice_id)
    where s.selected_source='pdf_import' and s.linked_invoice_id is null and s.canonical_collection_identity is not null
      and s.cleared_as_of is null
      and not exists(select 1 from collection_import_invoices n where n.batch_id=p_detail_batch_id and n.source_invoice_id=s.source_invoice_id)
  )
  select coalesce(jsonb_agg(jsonb_build_object('source_invoice_id',source_invoice_id,
    'canonical_collection_identity',canonical_collection_identity,'client_id',client_id,
    'invoice_number',invoice_number,'balance',open_balance::text,'last_seen_as_of',source_as_of)
    order by source_invoice_id),'[]'::jsonb) into v_items
  from (select * from candidates order by source_invoice_id offset p_offset limit p_limit) page;
  return jsonb_build_object('count',v_count,'total_balance',v_balance::text,'items',v_items,
    'pagination',jsonb_build_object('limit',p_limit,'offset',p_offset,'total',v_count));
end; $$;

-- Keep the pre-Phase-5 approval implementation as the atomic reconciliation
-- engine, then add omission clearing/reopening in the same transaction.
alter function tap_hub_project.approve_collection_import_pair(uuid,uuid,uuid)
  rename to approve_collection_import_pair_pre_phase5;
revoke all on function tap_hub_project.approve_collection_import_pair_pre_phase5(uuid,uuid,uuid)
  from public,anon,authenticated,service_role;

create or replace function tap_hub_project.approve_collection_import_pair(
  p_detail_batch_id uuid,p_summary_batch_id uuid,p_actor uuid,p_complete_report_confirmed boolean
) returns jsonb language plpgsql security definer
set search_path=tap_hub_project,public as $$
declare
  v_detail collection_import_batches%rowtype;
  v_would_clear jsonb;
  v_inflight integer;
  v_newest_approved date;
  v_can_clear boolean;
  v_result jsonb;
  v_identity record;
begin
  select * into v_detail from collection_import_batches where id=p_detail_batch_id for update;
  if not found then raise exception 'not_found: detail batch not found' using errcode='P0002'; end if;
  select max(source_as_of) into v_newest_approved from collection_import_batches where report_type='aging_detail' and status='approved';
  v_can_clear:=v_newest_approved is null or v_detail.source_as_of>v_newest_approved;
  v_would_clear:=case when v_can_clear then preview_collection_import_clear(p_detail_batch_id,50,0)
    else jsonb_build_object('count',0,'total_balance','0.00','items','[]'::jsonb,
      'pagination',jsonb_build_object('limit',50,'offset',0,'total',0)) end;

  -- Lock candidate identity rows before checking in-flight deliveries. The claim
  -- path takes the same identity->attempt lock order, so neither path can slip
  -- a new send between the check and the final clear.
  perform s.source_invoice_id from (
    select distinct on(i.source_invoice_id) i.source_invoice_id,i.source_as_of
    from collection_import_invoices i join collection_import_batches b on b.id=i.batch_id
    where b.status='approved' and i.review_status='approved' and i.source_as_of<v_detail.source_as_of
    order by i.source_invoice_id,i.source_as_of desc,i.updated_at desc,i.id desc
  ) prior join collection_source_invoice_identities s using(source_invoice_id)
  where v_can_clear and s.selected_source='pdf_import' and s.linked_invoice_id is null
    and s.cleared_as_of is null and not exists(select 1 from collection_import_invoices n
      where n.batch_id=p_detail_batch_id and n.source_invoice_id=s.source_invoice_id)
  order by s.canonical_collection_identity for update of s;

  select count(*)::integer into v_inflight
  from collection_delivery_attempts a
  join collection_source_invoice_identities s on s.canonical_collection_identity=a.canonical_collection_identity
  where v_can_clear and a.status='sending' and s.selected_source='pdf_import' and s.linked_invoice_id is null and s.cleared_as_of is null
    and not exists(select 1 from collection_import_invoices n
      where n.batch_id=p_detail_batch_id and n.source_invoice_id=s.source_invoice_id)
    and exists(select 1 from collection_import_invoices old
      join collection_import_batches b on b.id=old.batch_id and b.status='approved'
      where old.source_invoice_id=s.source_invoice_id and old.review_status='approved'
        and old.source_as_of < v_detail.source_as_of);
  if v_inflight>0 then raise exception 'clear_in_flight:%',v_inflight using errcode='P0001'; end if;
  if coalesce((v_would_clear->>'count')::integer,0)>0 and not p_complete_report_confirmed then
    raise exception using message='clear_confirmation_required:'||v_would_clear::text,errcode='P0001';
  end if;

  v_result := approve_collection_import_pair_pre_phase5(p_detail_batch_id,p_summary_batch_id,p_actor);
  if v_result->>'status' <> 'approved' then return v_result; end if;

  -- Serialize clears and claims on the same identity rows. Preserve canonical
  -- identity and all accepted/event history; only suppress work not yet sent.
  for v_identity in
    with latest as (
      select distinct on (i.source_invoice_id) i.source_invoice_id,i.invoice_number,i.open_balance,i.source_as_of
      from collection_import_invoices i join collection_import_batches b on b.id=i.batch_id
      where b.status='approved' and i.review_status='approved' and i.source_as_of < v_detail.source_as_of
      order by i.source_invoice_id,i.source_as_of desc,i.updated_at desc,i.id desc
    )
    select s.* from latest l join collection_source_invoice_identities s using(source_invoice_id)
    where v_can_clear and s.selected_source='pdf_import' and s.linked_invoice_id is null and s.cleared_as_of is null
      and s.canonical_collection_identity is not null
      and not exists(select 1 from collection_import_invoices n where n.batch_id=p_detail_batch_id and n.source_invoice_id=s.source_invoice_id)
    for update of s
  loop
    update collection_source_invoice_identities set cleared_as_of=v_detail.source_as_of,
      cleared_by_batch_id=p_detail_batch_id,reopened_at=null,reopened_by_batch_id=null,updated_at=now()
    where source_invoice_id=v_identity.source_invoice_id;
    update collection_delivery_attempts set status='suppressed',reason_code='SOURCE_CLEARED',updated_at=now()
    where canonical_collection_identity=v_identity.canonical_collection_identity and status in ('queued','needs_review');
    insert into collection_import_audit(batch_id,actor,action,detail)
    values(p_detail_batch_id,p_actor,'source_invoice_cleared',jsonb_build_object(
      'source_invoice_id',v_identity.source_invoice_id,'canonical_collection_identity',v_identity.canonical_collection_identity,
      'as_of',v_detail.source_as_of));
  end loop;

  for v_identity in
    select s.* from collection_import_invoices i
    join collection_source_invoice_identities s using(source_invoice_id)
    where v_can_clear and i.batch_id=p_detail_batch_id and i.review_status='approved' and s.cleared_as_of is not null
      and s.cleared_as_of < v_detail.source_as_of
    for update of s
  loop
    update collection_source_invoice_identities set cleared_as_of=null,cleared_by_batch_id=null,
      reopened_at=now(),reopened_by_batch_id=p_detail_batch_id,updated_at=now()
    where source_invoice_id=v_identity.source_invoice_id;
    insert into collection_import_audit(batch_id,actor,action,detail)
    values(p_detail_batch_id,p_actor,'source_invoice_reopened',jsonb_build_object(
      'source_invoice_id',v_identity.source_invoice_id,'canonical_collection_identity',v_identity.canonical_collection_identity,
      'as_of',v_detail.source_as_of));
  end loop;
  insert into collection_import_audit(batch_id,actor,action,detail)
  values(p_detail_batch_id,p_actor,'complete_report_confirmed',jsonb_build_object(
    'confirmed',coalesce(p_complete_report_confirmed,false),'would_clear',v_would_clear->>'count'));
  return jsonb_set(v_result,'{reconciliation,would_clear}',v_would_clear,true);
end; $$;

-- Preserve the existing SQL/test callers. The route sends the fourth argument
-- explicitly; legacy callers get the safe default (no complete-report claim).
create or replace function tap_hub_project.approve_collection_import_pair(
  p_detail_batch_id uuid,p_summary_batch_id uuid,p_actor uuid
) returns jsonb language sql security definer set search_path=tap_hub_project,public as $$
  select approve_collection_import_pair(p_detail_batch_id,p_summary_batch_id,p_actor,false)
$$;

-- The public RPC name now has only the confirmation-aware entry point.
revoke all on function tap_hub_project.approve_collection_import_pair(uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function tap_hub_project.approve_collection_import_pair(uuid,uuid,uuid,boolean) to service_role;
revoke all on function tap_hub_project.approve_collection_import_pair(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function tap_hub_project.approve_collection_import_pair(uuid,uuid,uuid) to service_role;

-- A claim locks the same identity row as paired approval, closing the race where
-- a delivery could be claimed while a complete report clears that invoice.
alter function tap_hub_project.claim_collection_test_delivery(uuid,uuid)
  rename to claim_collection_test_delivery_pre_phase5;
revoke all on function tap_hub_project.claim_collection_test_delivery_pre_phase5(uuid,uuid)
  from public,anon,authenticated,service_role;
create or replace function tap_hub_project.claim_collection_test_delivery(p_attempt_id uuid,p_actor uuid default null)
returns text language plpgsql security definer set search_path=tap_hub_project,public as $$
declare v_attempt collection_delivery_attempts%rowtype; v_cleared date; v_result text; v_due date; v_context jsonb;
begin
  select * into v_attempt from collection_delivery_attempts where id=p_attempt_id;
  if not found then return 'ATTEMPT_ALREADY_EXISTS'; end if;
  select cleared_as_of into v_cleared from collection_source_invoice_identities
    where canonical_collection_identity=v_attempt.canonical_collection_identity for update;
  if v_cleared is not null then return 'SOURCE_CLEARED'; end if;
  select * into v_attempt from collection_delivery_attempts where id=p_attempt_id for update;
  if not found or v_attempt.status<>'queued' then return 'ATTEMPT_ALREADY_EXISTS'; end if;
  if v_attempt.stage between 1 and 4 then
    if v_attempt.invoice_id is null then return 'STAGE_NOT_DUE'; end if;
    select due_date into v_due from invoices where id=v_attempt.invoice_id;
    v_context := collections_invoice_stage_context(v_attempt.client_id,v_attempt.invoice_id,v_due,collections_firm_today());
    if v_context->>'next_stage' is distinct from v_attempt.stage::text then return 'STAGE_NOT_DUE'; end if;
  end if;
  v_result := claim_collection_test_delivery_pre_phase5(p_attempt_id,p_actor);
  return v_result;
end; $$;
revoke all on function tap_hub_project.claim_collection_test_delivery(uuid,uuid) from public,anon,authenticated;
grant execute on function tap_hub_project.claim_collection_test_delivery(uuid,uuid) to service_role;

revoke all on function tap_hub_project.update_collections_configuration_phase5(uuid,jsonb,jsonb) from public,anon,authenticated;
revoke all on function tap_hub_project.collections_invoice_stage_context(uuid,uuid,date,date) from public,anon,authenticated;
revoke all on function tap_hub_project.get_collections_note_summaries(uuid[]) from public,anon,authenticated;
revoke all on function tap_hub_project.get_collections_late_history(date) from public,anon,authenticated;
revoke all on function tap_hub_project.preview_collection_import_clear(uuid,integer,integer) from public,anon,authenticated;
revoke all on function tap_hub_project.collections_source_next_reminder_stage(uuid,text,uuid,uuid,date) from public,anon,authenticated;
grant execute on function tap_hub_project.update_collections_configuration_phase5(uuid,jsonb,jsonb) to service_role;
grant execute on function tap_hub_project.collections_invoice_stage_context(uuid,uuid,date,date) to service_role;
grant execute on function tap_hub_project.get_collections_note_summaries(uuid[]) to service_role;
grant execute on function tap_hub_project.get_collections_late_history(date) to service_role;
grant execute on function tap_hub_project.preview_collection_import_clear(uuid,integer,integer) to service_role;
grant execute on function tap_hub_project.collections_source_next_reminder_stage(uuid,text,uuid,uuid,date) to service_role;
revoke all on function tap_hub_project.record_collection_event_for_source(uuid,text,uuid,uuid,text,uuid,integer,jsonb,uuid) from public,anon,authenticated;
grant execute on function tap_hub_project.record_collection_event_for_source(uuid,text,uuid,uuid,text,uuid,integer,jsonb,uuid) to service_role;

commit;
