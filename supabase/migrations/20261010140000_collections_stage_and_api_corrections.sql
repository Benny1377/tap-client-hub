-- Correct stage history without rewriting the already released 130000 migration.
-- This is forward-only and is intentionally not applied to any hosted database here.
begin;

alter function tap_hub_project.get_collections_worklist(uuid,date,integer,integer,text)
  rename to get_collections_worklist_130;

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
  v_pending jsonb;
begin
  select coalesce(nullif(timezone, ''), 'America/Chicago') into v_timezone
  from collection_settings where id = 'default';
  v_timezone := coalesce(v_timezone, 'America/Chicago');
  v_days := greatest(v_as_of - p_due_date, 0);

  select coalesce(max(case
      when e.event_type = 'escalated' then 4
      when e.event_type in ('formal_notice_approved','formal_notice_sent') then 5
      when e.event_type = 'reminder_logged' then coalesce(least(coalesce(e.stage,
        (select max(r.stage) from collection_ladder_rules r
         where r.enabled and r.automatic
           and r.days_past_due <= greatest((e.occurred_at at time zone v_timezone)::date - p_due_date, 0))), 3), 0)
      else 0 end), 0)
    into v_completed
  from collection_events e
  where e.client_id = p_client_id
    and (e.invoice_id = p_invoice_id or
      (e.invoice_id is null and e.event_type in ('escalation_requested','escalated',
       'formal_notice_requested','formal_notice_approved','formal_notice_sent')
       and p_due_date <= (e.occurred_at at time zone v_timezone)::date))
    and (e.occurred_at at time zone v_timezone)::date <= v_as_of;

  select greatest(v_completed, coalesce(max(d.stage), 0)) into v_completed
  from collection_delivery_attempts d
  where d.invoice_id = p_invoice_id and d.status = 'sent';

  select coalesce(max(r.stage), 0) into v_current
  from collection_ladder_rules r where r.enabled and r.days_past_due <= v_days;

  select jsonb_build_object('event_id', q.id, 'event_type', q.event_type,
      'stage', case when q.event_type = 'escalation_requested' then 4 else 5 end,
      'requested_at', q.occurred_at)
    into v_pending
  from collection_events q
  where q.client_id = p_client_id
    and (q.invoice_id = p_invoice_id or (q.invoice_id is null and p_due_date <= (q.occurred_at at time zone v_timezone)::date))
    and q.event_type in ('escalation_requested','formal_notice_requested')
    and (q.occurred_at at time zone v_timezone)::date <= v_as_of
    and not exists (select 1 from collection_events a where a.approves_event_id = q.id)
  order by q.occurred_at desc limit 1;

  if v_pending is null then
    select min(r.stage) into v_next from collection_ladder_rules r
    where r.enabled and r.stage > v_completed and r.days_past_due <= v_days;
  end if;
  return jsonb_build_object('current_stage', v_current, 'next_stage', v_next,
    'awaiting_approval', v_pending);
end; $$;

create or replace function tap_hub_project.get_collections_worklist(
  p_client_id uuid, p_as_of_date date, p_limit integer, p_offset integer, p_sort_order text
) returns jsonb language sql stable security definer
set search_path = tap_hub_project, public as $$
with base as (
  select get_collections_worklist_130(p_client_id,p_as_of_date,p_limit,p_offset,p_sort_order) as payload
), accounts as (
  select a.value as account, a.ordinality
  from base b cross join lateral jsonb_array_elements(coalesce(b.payload->'accounts','[]'::jsonb)) with ordinality a(value, ordinality)
), changed_accounts as (
  select account || jsonb_build_object('invoices', coalesce((
    select jsonb_agg(i.value || collections_invoice_stage_context(
      (account->>'client_id')::uuid, (i.value->>'invoice_id')::uuid,
      (i.value->>'due_date')::date, coalesce(p_as_of_date, (select (payload->>'as_of_date')::date from base)))
      order by i.ordinality)
    from jsonb_array_elements(coalesce(account->'invoices','[]'::jsonb)) with ordinality i(value, ordinality)
  ), '[]'::jsonb)) as account, ordinality
  from accounts
)
select payload || jsonb_build_object('accounts', coalesce((
  select jsonb_agg(account order by ordinality) from changed_accounts
), '[]'::jsonb)) from base;
$$;

create or replace function tap_hub_project.get_collections_worklist(
  p_client_id uuid default null,p_as_of_date date default null,p_limit integer default 100,p_offset integer default 0
) returns jsonb language sql stable security definer
set search_path = tap_hub_project, public as
$$ select get_collections_worklist(p_client_id,p_as_of_date,p_limit,p_offset,'priority'); $$;

create or replace function tap_hub_project.record_collection_event(
  p_client_id uuid, p_invoice_id uuid, p_event_type text, p_actor uuid,
  p_stage integer default null, p_detail jsonb default '{}'::jsonb,
  p_approval_event_id uuid default null
) returns uuid language plpgsql security definer
set search_path = tap_hub_project, public as $$
declare v_event_id uuid; v_approval collection_events%rowtype; v_stage integer := p_stage;
begin
  perform set_config('tap_hub.actor_id', p_actor::text, true);
  perform 1 from clients where id=p_client_id for update;
  if not found then raise exception 'not_found: client does not exist' using errcode='P0002'; end if;
  if p_event_type in ('hold_placed','hold_released','escalated','formal_notice_approved') then
    raise exception 'invalid_input: this event type is written only by its dedicated workflow' using errcode='22023';
  end if;
  if p_event_type not in ('note','reminder_logged','call_logged','promise_to_pay','escalation_requested','formal_notice_requested','formal_notice_sent') then
    raise exception 'invalid_input: unsupported Collections event type' using errcode='22023';
  end if;
  if p_event_type in ('escalation_requested','formal_notice_requested') and p_invoice_id is null then
    raise exception 'invalid_input: escalation and formal-notice requests require an invoice' using errcode='22023';
  end if;
  if p_invoice_id is not null and not exists(select 1 from invoices where id=p_invoice_id and client_id=p_client_id) then
    raise exception 'not_found: invoice does not belong to client' using errcode='P0002';
  end if;
  if p_event_type='reminder_logged' then
    if v_stage is not null and v_stage not between 1 and 3 then raise exception 'invalid_input: reminder stage must be 1, 2, or 3' using errcode='22023'; end if;
    if v_stage is null and p_invoice_id is not null then
      select max(r.stage) into v_stage from get_billing_invoice_balances(collections_firm_today()) b
      join collection_ladder_rules r on r.enabled and r.automatic and r.days_past_due<=b.days_past_due
      where b.invoice_id=p_invoice_id and b.client_id=p_client_id;
    end if;
  end if;
  if p_event_type in ('escalation_requested','formal_notice_requested') and exists(
    select 1 from collection_holds h where h.client_id=p_client_id and h.released_at is null
      and (h.expires_on is null or h.expires_on>=collections_firm_today())
      and (h.invoice_id is null or h.invoice_id=p_invoice_id)
  ) then raise exception 'conflict: action blocked by an active Collections hold' using errcode='P0001'; end if;
  if p_event_type='formal_notice_sent' then
    if p_approval_event_id is null then raise exception 'invalid_input: approved notice event is required' using errcode='22023'; end if;
    if nullif(trim(coalesce(p_detail->>'note','')),'') is null then raise exception 'invalid_input: add a note describing when and how the notice was sent' using errcode='22023'; end if;
    select * into v_approval from collection_events where id=p_approval_event_id for update;
    if not found or v_approval.event_type<>'formal_notice_approved' or v_approval.client_id<>p_client_id
       or v_approval.invoice_id is distinct from p_invoice_id then
      raise exception 'conflict: matching formal notice approval required' using errcode='P0001';
    end if;
    insert into collection_events(client_id,invoice_id,event_type,actor,detail)
    values(p_client_id,p_invoice_id,p_event_type,p_actor,coalesce(p_detail,'{}'::jsonb)||jsonb_build_object('approval_event_id',p_approval_event_id)) returning id into v_event_id;
  else
    insert into collection_events(client_id,invoice_id,event_type,stage,actor,detail)
    values(p_client_id,p_invoice_id,p_event_type,v_stage,p_actor,coalesce(p_detail,'{}'::jsonb)) returning id into v_event_id;
  end if;
  return v_event_id;
end; $$;

revoke all on function tap_hub_project.get_collections_worklist_130(uuid,date,integer,integer,text) from public, anon, authenticated, service_role;
revoke all on function tap_hub_project.collections_invoice_stage_context(uuid,uuid,date,date) from public, anon, authenticated;
grant execute on function tap_hub_project.collections_invoice_stage_context(uuid,uuid,date,date) to service_role;
revoke all on function tap_hub_project.get_collections_worklist(uuid,date,integer,integer,text) from public, anon, authenticated;
grant execute on function tap_hub_project.get_collections_worklist(uuid,date,integer,integer,text) to service_role;
revoke all on function tap_hub_project.get_collections_worklist(uuid,date,integer,integer) from public, anon, authenticated;
grant execute on function tap_hub_project.get_collections_worklist(uuid,date,integer,integer) to service_role;
revoke all on function tap_hub_project.record_collection_event(uuid,uuid,text,uuid,integer,jsonb,uuid) from public, anon, authenticated;
grant execute on function tap_hub_project.record_collection_event(uuid,uuid,text,uuid,integer,jsonb,uuid) to service_role;

commit;
