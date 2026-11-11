-- Regression checks for the owner-approved Phase 5 follow-ups.
-- All writes are synthetic and rolled back; the delivery check only claims a
-- database row and never contacts a provider.
begin;
do $$
declare
  v_client uuid := '10000000-0000-4000-8000-000000000001';
  v_actor uuid := '00000000-0000-4000-8000-000000000001';
  v_admin uuid := '00000000-0000-4000-8000-000000000003';
  v_prior_batch uuid := gen_random_uuid();
  v_next_batch uuid := gen_random_uuid();
  v_delivery_batch uuid := gen_random_uuid();
  v_exact_identity uuid := gen_random_uuid();
  v_ambiguous_identity_1 uuid := gen_random_uuid();
  v_ambiguous_identity_2 uuid := gen_random_uuid();
  v_partial_identity uuid := gen_random_uuid();
  v_delivery_identity uuid := gen_random_uuid();
  v_linked_delivery_identity uuid := gen_random_uuid();
  v_accepted_attempt uuid := gen_random_uuid();
  v_linked_attempt uuid := gen_random_uuid();
  v_exact_row uuid := gen_random_uuid();
  v_ambiguous_row uuid := gen_random_uuid();
  v_partial_row uuid := gen_random_uuid();
  v_attempt uuid := gen_random_uuid();
  v_result jsonb;
  v_reason text;
  v_context jsonb;
  v_today date := tap_hub_project.collections_firm_today();
begin
  perform set_config('tap_hub.actor_id',v_actor::text,true);

  insert into tap_hub_project.collection_import_batches
    (id,file_sha256,storage_path,original_filename,content_type,file_size_bytes,report_type,source_as_of,status,uploaded_by,approved_by,approved_at)
  values
    (v_prior_batch,repeat('a',64),v_prior_batch::text||'/prior.pdf','prior.pdf','application/pdf',100,'aging_detail',v_today-10,'approved',v_actor,v_admin,now()),
    (v_next_batch,repeat('b',64),v_next_batch::text||'/next.pdf','next.pdf','application/pdf',100,'aging_detail',v_today,'needs_review',v_actor,null,null),
    (v_delivery_batch,repeat('c',64),v_delivery_batch::text||'/delivery.pdf','delivery.pdf','application/pdf',100,'aging_detail',v_today,'approved',v_actor,v_admin,now());

  insert into tap_hub_project.collection_source_invoice_identities(source_invoice_id,client_id,canonical_collection_identity,linked_invoice_id)
  values
    (v_exact_identity,v_client,'pdf_import:'||v_exact_identity::text,null),
    (v_ambiguous_identity_1,v_client,'pdf_import:'||v_ambiguous_identity_1::text,null),
    (v_ambiguous_identity_2,v_client,'pdf_import:'||v_ambiguous_identity_2::text,null),
    (v_partial_identity,v_client,'pdf_import:'||v_partial_identity::text,null),
    (v_delivery_identity,v_client,'pdf_import:'||v_delivery_identity::text,null),
    (v_linked_delivery_identity,v_client,'pdf_import:'||v_linked_delivery_identity::text,
      '20000000-0000-4000-8000-000000000001');

  insert into tap_hub_project.collection_import_invoices
    (source_invoice_id,batch_id,invoice_number,customer_name,transaction_type,transaction_date,due_date,
     reported_aging,open_balance,source_as_of,source_row_key,review_status,confirmed_at)
  values
    (v_exact_identity,v_prior_batch,'EXACT-1','Example Orchard LLC','Invoice',v_today-40,v_today-30,30,100,v_today-10,'1:1','approved',now()),
    (v_ambiguous_identity_1,v_prior_batch,'AMBIG-1','Example Orchard LLC','Invoice',v_today-35,v_today-25,25,200,v_today-10,'1:2','approved',now()),
    (v_ambiguous_identity_2,v_prior_batch,'AMBIG-1','Example Orchard LLC','Invoice',v_today-35,v_today-25,25,200,v_today-10,'1:3','approved',now()),
    (v_partial_identity,v_prior_batch,'PARTIAL-1','Example Orchard LLC','Invoice',v_today-20,v_today-10,10,300,v_today-10,'1:4','approved',now()),
    (v_delivery_identity,v_delivery_batch,'DELIVERY-1','Example Orchard LLC','Invoice',v_today-40,v_today-30,30,125,v_today,'1:5','approved',now()),
    (v_linked_delivery_identity,v_delivery_batch,'DELIVERY-2','Example Orchard LLC','Invoice',v_today-40,v_today-30,30,150,v_today,'1:6','approved',now());

  insert into tap_hub_project.collection_import_rows(id,batch_id,page_number,row_number,raw_text,parsed_fields)
  values
    (v_exact_row,v_next_batch,1,1,'Exact matching invoice',jsonb_build_object('auto_suggestion',jsonb_build_object('disposition','invoice','confidence','high','fields',jsonb_build_object('transaction_type','Invoice','invoice_number','EXACT-1','customer_name','Example Orchard LLC','transaction_date',(v_today-40)::text,'due_date',(v_today-30)::text,'reported_aging',30,'open_balance','110.00')))),
    (v_ambiguous_row,v_next_batch,1,2,'Ambiguous matching invoice',jsonb_build_object('auto_suggestion',jsonb_build_object('disposition','invoice','confidence','high','fields',jsonb_build_object('transaction_type','Invoice','invoice_number','AMBIG-1','customer_name','Example Orchard LLC','transaction_date',(v_today-35)::text,'due_date',(v_today-25)::text,'reported_aging',25,'open_balance','200.00')))),
    (v_partial_row,v_next_batch,1,3,'Partially matching invoice',jsonb_build_object('auto_suggestion',jsonb_build_object('disposition','invoice','confidence','high','fields',jsonb_build_object('transaction_type','Invoice','invoice_number','PARTIAL-1','customer_name','Example Orchard LLC','transaction_date',(v_today-21)::text,'due_date',(v_today-10)::text,'reported_aging',10,'open_balance','300.00'))));

  v_result:=tap_hub_project.auto_match_collection_import_rows(v_next_batch,v_actor,array[v_exact_row,v_ambiguous_row,v_partial_row]);
  if (v_result->>'matched')::integer<>1 or (v_result->>'uncertain')::integer<>2
    or (v_result->>'identity_reused')::integer<>1 then
    raise exception 'Expected one exact identity carry-forward and two held-for-review matches, got %',v_result;
  end if;
  if (select source_invoice_id from tap_hub_project.collection_import_rows where id=v_exact_row)<>v_exact_identity
    or (select canonical_collection_identity from tap_hub_project.collection_source_invoice_identities where source_invoice_id=v_exact_identity)
      <>'pdf_import:'||v_exact_identity::text then
    raise exception 'Exact match did not preserve the previous source and canonical identity';
  end if;
  if exists(select 1 from tap_hub_project.collection_import_rows where id in (v_ambiguous_row,v_partial_row) and source_invoice_id is not null) then
    raise exception 'Ambiguous or partial invoice matches must not carry an identity automatically';
  end if;

  insert into tap_hub_project.collection_delivery_attempts
    (id,client_id,invoice_id,source,source_invoice_id,canonical_collection_identity,stage,status,idempotency_key,accepted_at,updated_at)
  values (v_accepted_attempt,v_client,null,'pdf_import',v_exact_identity,'pdf_import:'||v_exact_identity::text,1,'accepted',
    'phase5-accepted-date:'||v_accepted_attempt::text,now()-interval '8 days',now());
  if tap_hub_project.collections_source_next_reminder_stage(v_client,'pdf_import',null,v_exact_identity,v_today)<>2 then
    raise exception 'An accepted attempt must age its next-stage gap from accepted_at, not its later updated_at';
  end if;

  -- Explicit stage values cannot bypass the ladder when no stage is currently eligible.
  update tap_hub_project.collection_ladder_rules set automatic=false where stage=1;
  begin
    perform tap_hub_project.record_collection_event_for_source(v_client,'pdf_import',null,v_delivery_identity,
      'reminder_logged',v_actor,1,'{}'::jsonb,null);
    raise exception 'Explicit reminder stage was accepted with no eligible stage';
  exception when raise_exception then
    if position('reminder stage is not the next eligible stage' in sqlerrm)=0 then raise; end if;
  end;
  update tap_hub_project.collection_ladder_rules set automatic=true where stage=1;

  -- A synthetic report-only invoice can be claimed in test mode, with no provider call.
  update tap_hub_project.collection_settings set automation_enabled=true,delivery_mode='test',
    test_recipient='phase5-test@example.invalid',send_start='00:00',send_end='23:59',weekdays_only=false
    where id='default';
  insert into tap_hub_project.collection_delivery_attempts
    (id,client_id,invoice_id,source,source_invoice_id,canonical_collection_identity,stage,status,idempotency_key,actor)
  values (v_attempt,v_client,null,'pdf_import',v_delivery_identity,'pdf_import:'||v_delivery_identity::text,1,'queued',
    'phase5-followup:'||v_attempt::text,v_actor);
  v_reason:=tap_hub_project.claim_collection_test_delivery(v_attempt,v_actor);
  if v_reason is not null then raise exception 'Synthetic PDF-only claim should be permitted in test mode, got %',v_reason; end if;
  if (select status from tap_hub_project.collection_delivery_attempts where id=v_attempt)<>'sending' then
    raise exception 'Test claim did not move the report-only attempt to sending';
  end if;
  v_context:=tap_hub_project.get_collection_test_message_context(v_attempt);
  if coalesce((v_context->>'eligible')::boolean,false) is not true or v_context->>'invoice_number'<>'DELIVERY-1' then
    raise exception 'Synthetic PDF-only message context was not resolved safely: %',v_context;
  end if;

  insert into tap_hub_project.collection_delivery_attempts
    (id,client_id,invoice_id,source,source_invoice_id,canonical_collection_identity,stage,status,idempotency_key,actor)
  values (v_linked_attempt,v_client,'20000000-0000-4000-8000-000000000001','pdf_import',v_linked_delivery_identity,
    'pdf_import:'||v_linked_delivery_identity::text,1,'queued','phase5-linked-pdf:'||v_linked_attempt::text,v_actor);
  v_reason:=tap_hub_project.claim_collection_test_delivery(v_linked_attempt,v_actor);
  if v_reason is not null then raise exception 'PDF-selected linked invoice should use its approved PDF snapshot, got %',v_reason; end if;
  v_context:=tap_hub_project.get_collection_test_message_context(v_linked_attempt);
  if coalesce((v_context->>'eligible')::boolean,false) is not true or v_context->>'invoice_number'<>'DELIVERY-2' then
    raise exception 'Linked PDF source message context did not use the PDF-selected invoice: %',v_context;
  end if;
end;
$$;
rollback;
