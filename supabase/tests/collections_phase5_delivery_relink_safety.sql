-- Regression coverage for Phase 5 review issues. All mutations are rolled back.
begin;
do $$
declare
  v_actor uuid:='00000000-0000-4000-8000-000000000001';
  v_admin uuid:='00000000-0000-4000-8000-000000000003';
  v_source uuid:=gen_random_uuid();
  v_target uuid:=gen_random_uuid();
  v_ops_id uuid:=gen_random_uuid();
  v_prior_batch uuid:=gen_random_uuid();
  v_next_batch uuid:=gen_random_uuid();
  v_identity uuid:=gen_random_uuid();
  v_prior_row uuid:=gen_random_uuid();
  v_next_row uuid:=gen_random_uuid();
  v_result jsonb;
begin
  perform set_config('tap_hub.actor_id',v_actor::text,true);
  insert into tap_hub_project.clients(id,name,type,status,operations_source_client_id,is_synthetic)
  values(v_source,'Legacy Alias Account LLC','business','active',null,true),
    (v_target,'Operations Canonical Account Inc','business','active',v_ops_id,true);
  insert into tap_hub_project.collection_import_batches
    (id,file_sha256,storage_path,original_filename,content_type,file_size_bytes,report_type,source_as_of,status,uploaded_by,approved_by,approved_at)
  values(v_prior_batch,repeat('d',64),v_prior_batch::text||'/old.pdf','old.pdf','application/pdf',100,
      'aging_detail',tap_hub_project.collections_firm_today()-10,'approved',v_actor,v_admin,now()),
    (v_next_batch,repeat('e',64),v_next_batch::text||'/new.pdf','new.pdf','application/pdf',100,
      'aging_detail',tap_hub_project.collections_firm_today(),'needs_review',v_actor,null,null);
  insert into tap_hub_project.collection_source_invoice_identities(source_invoice_id,client_id,canonical_collection_identity)
  values(v_identity,v_source,'pdf_import:'||v_identity::text);
  insert into tap_hub_project.collection_import_invoices
    (source_invoice_id,batch_id,invoice_number,customer_name,transaction_type,transaction_date,due_date,
      reported_aging,open_balance,source_as_of,source_row_key,review_status,confirmed_at)
  values(v_identity,v_prior_batch,'ALIAS-100','Legacy Alias Account LLC','Invoice',
    tap_hub_project.collections_firm_today()-40,tap_hub_project.collections_firm_today()-30,30,250,
    tap_hub_project.collections_firm_today()-10,'old:1','approved',now());
  insert into tap_hub_project.collection_import_audit(batch_id,source_invoice_id,actor,action,detail)
  values(v_prior_batch,v_identity,v_actor,'seeded_for_relink_test','{}'::jsonb);

  v_result:=tap_hub_project.relink_collections_client_accounts(
    jsonb_build_array(jsonb_build_object(
      'source_client_id',v_source,'target_client_id',v_target,'note','Exact reviewed Operations client link')),v_actor);
  if (select status from tap_hub_project.clients where id=v_source)<>'inactive'
    or (select client_id from tap_hub_project.collection_source_invoice_identities where source_invoice_id=v_identity)<>v_target then
    raise exception 'Relink must retire the empty source and preserve the invoice under the Operations client';
  end if;
  if not exists(select 1 from tap_hub_project.collections_client_name_aliases
    where client_id=v_target and source_client_id=v_source and normalized_name='legacy alias account') then
    raise exception 'Relink must preserve the old report name as a normalized client match alias';
  end if;
  if not exists(select 1 from tap_hub_project.collection_import_audit where action='client_relink_summary'
    and actor=v_actor and detail->>'source_client_id'=v_source::text
    and detail->>'target_client_id'=v_target::text and detail ? 'delivery_attempts_reassigned') then
    raise exception 'Relink must write a summary audit row with reassigned-item counts';
  end if;

  insert into tap_hub_project.collection_import_rows(id,batch_id,page_number,row_number,raw_text,parsed_fields)
  values(v_next_row,v_next_batch,1,1,'Legacy Alias Account LLC invoice ALIAS-100',jsonb_build_object(
    'auto_suggestion',jsonb_build_object('disposition','invoice','confidence','high','fields',jsonb_build_object(
      'transaction_type','Invoice','invoice_number','ALIAS-100','customer_name','Legacy Alias Account LLC',
      'transaction_date',(tap_hub_project.collections_firm_today()-40)::text,
      'due_date',(tap_hub_project.collections_firm_today()-30)::text,'reported_aging',30,'open_balance','250.00'))));
  v_result:=tap_hub_project.auto_match_collection_import_rows(v_next_batch,v_actor,array[v_next_row]);
  if (v_result->>'matched')::integer<>1 or (v_result->>'identity_reused')::integer<>1
    or (select source_invoice_id from tap_hub_project.collection_import_rows where id=v_next_row)<>v_identity then
    raise exception 'A later report must match the old A/R name to Operations and carry forward invoice identity: %',v_result;
  end if;
end;
$$;
rollback;
