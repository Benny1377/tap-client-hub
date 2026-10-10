-- Run only on local/disposable or approved non-production after migrations through 140000.
-- This test creates and rolls back its own Billing/Collections fixture.
begin;
do $$
declare
  v_actor uuid;
  v_client uuid := gen_random_uuid();
  v_old_invoice uuid := gen_random_uuid();
  v_later_invoice uuid := gen_random_uuid();
  v_pending_invoice uuid := gen_random_uuid();
  v_catchup_invoice uuid := gen_random_uuid();
  v_approval uuid := gen_random_uuid();
  v_hold uuid;
  v_sent uuid;
  v_ctx jsonb;
  v_today date := tap_hub_project.collections_firm_today();
begin
  select id into v_actor from tap_hub_project.profiles order by id limit 1;
  if v_actor is null then raise exception 'Test needs one seeded profile for required actor foreign keys'; end if;
  perform set_config('tap_hub.actor_id', v_actor::text, true);
  insert into tap_hub_project.clients(id,name,type,status) values(v_client,'Phase 2 stage regression fixture','Business','active');
  insert into tap_hub_project.invoices(id,client_id,invoice_number,status,issue_date,due_date,created_by)
  values
    (v_old_invoice,v_client,'TST-'||substr(v_old_invoice::text,1,8),'issued',v_today-100,v_today-90,v_actor),
    (v_later_invoice,v_client,'TST-'||substr(v_later_invoice::text,1,8),'issued',v_today-40,v_today-30,v_actor),
    (v_pending_invoice,v_client,'TST-'||substr(v_pending_invoice::text,1,8),'issued',v_today-56,v_today-46,v_actor),
    (v_catchup_invoice,v_client,'TST-'||substr(v_catchup_invoice::text,1,8),'issued',v_today-50,v_today-20,v_actor);
  insert into tap_hub_project.invoice_lines(invoice_id,description,quantity,unit_amount,amount)
  values (v_old_invoice,'Fixture',1,100,100),(v_later_invoice,'Fixture',1,100,100),
    (v_pending_invoice,'Fixture',1,100,100),(v_catchup_invoice,'Fixture',1,100,100);

  v_ctx := tap_hub_project.collections_invoice_stage_context(v_client,v_catchup_invoice,v_today-20,v_today-14);
  if (v_ctx->>'next_stage')::integer is distinct from 2 then raise exception 'Missed day-1 reminder did not catch up to stage 2'; end if;
  v_ctx := tap_hub_project.collections_invoice_stage_context(v_client,v_catchup_invoice,v_today-20,v_today);
  if (v_ctx->>'next_stage')::integer is distinct from 3 then raise exception 'Missed reminders did not catch up to stage 3'; end if;

  -- Legacy account-level escalation applies only to invoices already due on its firm date.
  insert into tap_hub_project.collection_events(client_id,invoice_id,event_type,actor,occurred_at)
  values(v_client,null,'escalated',v_actor,(v_today-60)::timestamp at time zone 'America/Chicago');
  v_ctx := tap_hub_project.collections_invoice_stage_context(v_client,v_old_invoice,v_today-90,v_today);
  if (v_ctx->>'next_stage')::integer is distinct from 5 then raise exception 'Legacy client-level escalation was not applied to an already-due invoice'; end if;
  v_ctx := tap_hub_project.collections_invoice_stage_context(v_client,v_later_invoice,v_today-30,v_today);
  if (v_ctx->>'next_stage')::integer is distinct from 3 then raise exception 'Legacy escalation leaked to a later invoice instead of the reminder catch-up stage'; end if;

  -- A pending request is not a completed stage and blocks later preview stages.
  insert into tap_hub_project.collection_events(client_id,invoice_id,event_type,actor)
  values(v_client,v_pending_invoice,'escalation_requested',v_actor);
  v_ctx := tap_hub_project.collections_invoice_stage_context(v_client,v_pending_invoice,v_today-46,v_today);
  if v_ctx->'awaiting_approval' is null or v_ctx->'awaiting_approval'='null'::jsonb then raise exception 'Pending request was not returned'; end if;
  if v_ctx->'next_stage' is distinct from 'null'::jsonb then raise exception 'Pending request incorrectly proposed a later stage'; end if;

  begin
    perform tap_hub_project.record_collection_event(v_client,null,'formal_notice_requested',v_actor,null,'{}'::jsonb,null);
    raise exception 'Expected client-level notice request to be rejected';
  exception when sqlstate '22023' then null;
  end;

  -- Recording a previously sent notice is factual logging, not a send action,
  -- and remains possible when a hold is now active (with matching approval + note).
  insert into tap_hub_project.collection_events(id,client_id,invoice_id,event_type,actor)
  values(v_approval,v_client,v_old_invoice,'formal_notice_approved',v_actor);
  v_hold := tap_hub_project.place_collection_hold(v_client,v_old_invoice,'Regression fixture hold',v_actor,null);
  v_sent := tap_hub_project.record_collection_event(v_client,v_old_invoice,'formal_notice_sent',v_actor,null,
    '{"note":"Sent by mail before hold was placed"}'::jsonb,v_approval);
  if not exists(select 1 from tap_hub_project.collection_events where id=v_sent and event_type='formal_notice_sent') then
    raise exception 'Factual notice-sent event was blocked by a current hold';
  end if;
end;
$$;
rollback;
