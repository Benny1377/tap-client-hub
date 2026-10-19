-- Restore the Phase 2 event rules (20261010140000 record_collection_event) inside the
-- source-aware event function from 20261019100000: catch-up stage for a reminder logged
-- without a stage, reminder stage 1-3, a note on "notice sent", and a hold only blocks new
-- escalation/formal-notice requests (a notice already sent may be recorded during a later hold).
begin;

create or replace function tap_hub_project.record_collection_event_for_source(
  p_client_id uuid, p_source text, p_invoice_id uuid, p_source_invoice_id uuid,
  p_event_type text, p_actor uuid, p_stage integer default null,
  p_detail jsonb default '{}'::jsonb, p_approval_event_id uuid default null
) returns uuid
language plpgsql security definer set search_path = tap_hub_project, public as $$
declare v_identity text; v_event_id uuid; v_approval collection_events%rowtype; v_stage integer := p_stage; v_due date;
begin
  -- Keeps every Phase 2 rule of record_collection_event (20261010140000) for both sources.
  perform set_config('tap_hub.actor_id', coalesce(p_actor::text, ''), true);
  perform 1 from clients where id = p_client_id for update;
  if not found then raise exception 'not_found: client does not exist' using errcode = 'P0002'; end if;
  v_identity := resolve_collection_source_identity(p_client_id,p_source,p_invoice_id,p_source_invoice_id);
  if p_event_type in ('hold_placed','hold_released','escalated','formal_notice_approved') then
    raise exception 'invalid_input: this event type is written only by its dedicated workflow' using errcode = '22023';
  end if;
  if p_event_type not in ('note','reminder_logged','call_logged','promise_to_pay','escalation_requested','formal_notice_requested','formal_notice_sent') then
    raise exception 'invalid_input: unsupported Collections event type' using errcode = '22023';
  end if;
  if p_event_type = 'reminder_logged' then
    if v_stage is not null and v_stage not between 1 and 3 then
      raise exception 'invalid_input: reminder stage must be 1, 2, or 3' using errcode = '22023';
    end if;
    if v_stage is null then
      -- Catch-up stage: the latest automatic reminder the invoice's age has reached.
      if p_source = 'billing' then
        select max(r.stage) into v_stage from get_billing_invoice_balances(collections_firm_today()) b
        join collection_ladder_rules r on r.enabled and r.automatic and r.days_past_due <= b.days_past_due
        where b.invoice_id = p_invoice_id and b.client_id = p_client_id;
      else
        select i.due_date into v_due from collection_import_invoices i
          where i.source_invoice_id = p_source_invoice_id and i.review_status in ('approved','blocked')
          order by i.updated_at desc limit 1;
        if v_due is not null then
          select max(r.stage) into v_stage from collection_ladder_rules r
            where r.enabled and r.automatic and r.days_past_due <= greatest(collections_firm_today() - v_due, 0);
        end if;
      end if;
    end if;
  end if;
  -- Holds block new requests only; a notice already sent may still be recorded during a later hold (Phase 2 FN3).
  if p_event_type in ('escalation_requested','formal_notice_requested') and exists(
    select 1 from collection_holds h where h.client_id = p_client_id and h.released_at is null
      and (h.expires_on is null or h.expires_on >= collections_firm_today())
      and (h.canonical_collection_identity is null or h.canonical_collection_identity = v_identity)
  ) then raise exception 'conflict: action blocked by an active Collections hold' using errcode = 'P0001'; end if;
  if p_event_type = 'formal_notice_sent' then
    if p_approval_event_id is null then raise exception 'invalid_input: approved notice event is required' using errcode = '22023'; end if;
    if nullif(trim(coalesce(p_detail->>'note','')),'') is null then
      raise exception 'invalid_input: add a note describing when and how the notice was sent' using errcode = '22023';
    end if;
    select * into v_approval from collection_events where id = p_approval_event_id for update;
    if not found or v_approval.event_type <> 'formal_notice_approved' or v_approval.client_id <> p_client_id
      or v_approval.canonical_collection_identity is distinct from v_identity then
      raise exception 'conflict: matching formal notice approval required' using errcode = 'P0001';
    end if;
    insert into collection_events(client_id,invoice_id,source,source_invoice_id,canonical_collection_identity,event_type,actor,detail)
    values (p_client_id,p_invoice_id,p_source,p_source_invoice_id,v_identity,p_event_type,p_actor,
      coalesce(p_detail,'{}'::jsonb)||jsonb_build_object('approval_event_id',p_approval_event_id)) returning id into v_event_id;
  else
    insert into collection_events(client_id,invoice_id,source,source_invoice_id,canonical_collection_identity,event_type,stage,actor,detail)
    values (p_client_id,p_invoice_id,p_source,p_source_invoice_id,v_identity,p_event_type,v_stage,p_actor,coalesce(p_detail,'{}'::jsonb)) returning id into v_event_id;
  end if;
  return v_event_id;
end;
$$;

revoke all on function tap_hub_project.record_collection_event_for_source(uuid,text,uuid,uuid,text,uuid,integer,jsonb,uuid) from public, anon, authenticated;
grant execute on function tap_hub_project.record_collection_event_for_source(uuid,text,uuid,uuid,text,uuid,integer,jsonb,uuid) to service_role;

commit;
