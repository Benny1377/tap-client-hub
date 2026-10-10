-- Owner decision: when reminders were missed, propose the latest eligible
-- reminder stage. Human approval stages still advance one at a time.
-- Forward-only: apply after 20261010140000, never rewrite that version.
begin;

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
      when e.event_type = 'reminder_logged' then least(coalesce(e.stage,
        (select max(r.stage) from collection_ladder_rules r
         where r.enabled and r.automatic
           and r.days_past_due <= greatest((e.occurred_at at time zone v_timezone)::date - p_due_date, 0))), 3)
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
    -- Catch up to the latest due reminder, but never jump over an approval gate.
    select max(r.stage) into v_next from collection_ladder_rules r
    where r.enabled and r.automatic and r.stage <= 3
      and r.stage > v_completed and r.days_past_due <= v_days;
    if v_next is null then
      select min(r.stage) into v_next from collection_ladder_rules r
      where r.enabled and r.stage > v_completed and r.days_past_due <= v_days;
    end if;
  end if;
  return jsonb_build_object('current_stage', v_current, 'next_stage', v_next,
    'awaiting_approval', v_pending);
end; $$;

revoke all on function tap_hub_project.collections_invoice_stage_context(uuid,uuid,date,date)
  from public, anon, authenticated;
grant execute on function tap_hub_project.collections_invoice_stage_context(uuid,uuid,date,date)
  to service_role;

commit;
