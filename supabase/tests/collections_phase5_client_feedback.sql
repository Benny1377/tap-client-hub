-- Synthetic Phase 5 regression checks. All rows are rolled back.
begin;
do $$
declare
  v_client uuid := gen_random_uuid();
  v_invoice uuid := gen_random_uuid();
  v_paid_late uuid := gen_random_uuid();
  v_paid_early uuid := gen_random_uuid();
  v_open_late uuid := gen_random_uuid();
  v_payment_late uuid := gen_random_uuid();
  v_payment_early uuid := gen_random_uuid();
  v_note_count bigint;
  v_late_count bigint;
  v_today date := tap_hub_project.collections_firm_today();
  v_context jsonb;
  v_next integer;
  v_eligible date;
begin
  perform set_config('tap_hub.actor_id','00000000-0000-4000-8000-000000000001',true);
  insert into tap_hub_project.clients(id,name,type,status)
  values(v_client,'Synthetic Phase 5 regression client','Business','active');
  if (select count(*) from tap_hub_project.collection_ladder_rules where stage between 2 and 4 and min_days_since_previous=7) <> 3 then
    raise exception 'Phase 5 defaults must set seven-day gaps for stages 2 through 4';
  end if;
  insert into tap_hub_project.invoices(id,client_id,invoice_number,status,issue_date,due_date,is_synthetic)
  values(v_invoice,v_client,'SYN-PHASE5-'||substr(v_invoice::text,1,8),'issued',v_today-200,v_today-190,true);

  v_context := tap_hub_project.collections_invoice_stage_context(v_client,v_invoice,v_today-190,v_today);
  if (v_context->>'next_stage')::integer <> 1 or (v_context->>'completed_stage')::integer <> 0 then
    raise exception 'Old invoices with no history must start at Friendly, not catch up';
  end if;

  insert into tap_hub_project.collection_events(client_id,invoice_id,event_type,stage,occurred_at)
  values(v_client,v_invoice,'reminder_logged',1,now()-interval '1 day');
  v_context := tap_hub_project.collections_invoice_stage_context(v_client,v_invoice,v_today-190,v_today);
  v_next := nullif(v_context->>'next_stage','')::integer;
  v_eligible := nullif(v_context->>'next_stage_eligible_on','')::date;
  if v_next is not null or v_eligible <> v_today+6 then
    raise exception 'Stage 2 must wait for both threshold and a seven-day completed-stage gap';
  end if;

  update tap_hub_project.collection_events set occurred_at=now()-interval '8 days'
    where invoice_id=v_invoice and event_type='reminder_logged' and stage=1;
  v_context := tap_hub_project.collections_invoice_stage_context(v_client,v_invoice,v_today-190,v_today);
  if (v_context->>'next_stage')::integer <> 2 then
    raise exception 'Stage 2 should become eligible after its configured gap';
  end if;

  insert into tap_hub_project.invoices(id,client_id,invoice_number,status,issue_date,due_date,is_synthetic)
  values
    (v_paid_late,v_client,null,'draft',null,null,true),
    (v_paid_early,v_client,null,'draft',null,null,true),
    (v_open_late,v_client,null,'draft',null,null,true);
  insert into tap_hub_project.invoice_lines(invoice_id,description,quantity,unit_amount,amount)
  values (v_paid_late,'fixture',1,100,100),(v_paid_early,'fixture',1,100,100),(v_open_late,'fixture',1,100,100);
  update tap_hub_project.invoices set status='issued',issue_date=v_today-100,due_date=v_today-60,
    presentation_snapshot='{"firmName":"Synthetic fixture"}'::jsonb,
    invoice_number=case id when v_paid_late then 'SYN-P5-LATE-'||substr(v_paid_late::text,1,8)
      when v_paid_early then 'SYN-P5-EARLY-'||substr(v_paid_early::text,1,8)
      else 'SYN-P5-OPEN-'||substr(v_open_late::text,1,8) end
  where id in (v_paid_late,v_paid_early,v_open_late);
  insert into tap_hub_project.payments(id,client_id,received_on,amount,method,status)
  values (v_payment_late,v_client,v_today-20,100,'ach','recorded'),(v_payment_early,v_client,v_today-40,100,'ach','recorded');
  insert into tap_hub_project.payment_allocations(payment_id,invoice_id,amount,created_at)
  values (v_payment_late,v_paid_late,100,(v_today-20)::timestamp at time zone 'America/Chicago'),
    (v_payment_early,v_paid_early,100,(v_today-40)::timestamp at time zone 'America/Chicago');
  select late_beyond_final_count into v_late_count from tap_hub_project.get_collections_late_history(v_today) where client_id=v_client;
  if v_late_count<>2 then raise exception 'Late metric expected 2 but returned %',v_late_count; end if;

  insert into tap_hub_project.collection_events(client_id,event_type,actor,detail)
  values (v_client,'note',(select id from tap_hub_project.profiles order by id limit 1),'{"note":"internal test one"}'::jsonb),
    (v_client,'note',(select id from tap_hub_project.profiles order by id limit 1),'{"note":"internal test two"}'::jsonb);
  select note_count into v_note_count from tap_hub_project.get_collections_note_summaries(array[v_client]) where client_id=v_client;
  if v_note_count<>2 then raise exception 'Notes summary must aggregate account and invoice notes without changing note events'; end if;
end;
$$;
rollback;
