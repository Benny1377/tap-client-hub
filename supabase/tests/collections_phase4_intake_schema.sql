-- Phase 4 schema/security assertions. No real report files or production data.
begin;
do $$
declare
  v_public boolean;
  v_rls boolean;
begin
  if not exists(select 1 from information_schema.columns where table_schema='tap_hub_project' and table_name='collection_delivery_attempts' and column_name='canonical_collection_identity')
    or not exists(select 1 from information_schema.columns where table_schema='tap_hub_project' and table_name='collection_holds' and column_name='source_invoice_id')
    or not exists(select 1 from information_schema.columns where table_schema='tap_hub_project' and table_name='collection_events' and column_name='canonical_collection_identity') then
    raise exception 'Source identity columns are missing from Phase 3 action history';
  end if;
  select public into v_public from storage.buckets where id='collections-ar-pdfs';
  if v_public is distinct from false then raise exception 'A/R PDF bucket must be private'; end if;
  select relrowsecurity into v_rls from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='tap_hub_project' and c.relname='collection_import_batches';
  if v_rls is distinct from true then raise exception 'Import batch table must have RLS enabled'; end if;
  if has_function_privilege('anon','tap_hub_project.approve_collection_import_batch(uuid,uuid)','EXECUTE')
    or has_function_privilege('authenticated','tap_hub_project.approve_collection_import_batch(uuid,uuid)','EXECUTE') then
    raise exception 'Batch approval RPC must be service-role-only';
  end if;
end;
$$;

-- Late linking must preserve activity under the original PDF identity, and
-- both source aliases must resolve to that same canonical key.
do $$
declare
  v_source_invoice_id uuid := gen_random_uuid();
  v_batch_one uuid := gen_random_uuid();
  v_batch_two uuid := gen_random_uuid();
  v_as_of date := tap_hub_project.collections_firm_today();
  v_identity text;
  v_pdf_resolved text;
  v_billing_resolved text;
begin
  insert into tap_hub_project.collection_import_batches
    (id,file_sha256,storage_path,original_filename,content_type,file_size_bytes,report_type,source_as_of,status,uploaded_by)
  values
    (v_batch_one,repeat('a',64),v_batch_one::text||'/one.pdf','one.pdf','application/pdf',100,'aging_detail',v_as_of,'needs_review','00000000-0000-4000-8000-000000000001'),
    (v_batch_two,repeat('b',64),v_batch_two::text||'/two.pdf','two.pdf','application/pdf',100,'aging_detail',v_as_of,'needs_review','00000000-0000-4000-8000-000000000001');
  insert into tap_hub_project.collection_source_invoice_identities(source_invoice_id,client_id)
    values (v_source_invoice_id,'10000000-0000-4000-8000-000000000001');
  insert into tap_hub_project.collection_import_rows(batch_id,source_invoice_id,page_number,row_number,raw_text,review_disposition)
    values (v_batch_one,v_source_invoice_id,1,1,'synthetic invoice row','invoice'),
           (v_batch_two,v_source_invoice_id,1,1,'synthetic revised invoice row','invoice');
  insert into tap_hub_project.collection_import_invoices
    (source_invoice_id,batch_id,invoice_number,customer_name,open_balance,source_as_of,source_row_key,review_status)
    values (v_source_invoice_id,v_batch_one,'SYN-001','Synthetic Orchard',125,v_as_of,'1:1','ready');
  perform tap_hub_project.approve_collection_import_batch(v_batch_one,'00000000-0000-4000-8000-000000000003');
  select canonical_collection_identity into v_identity from tap_hub_project.collection_source_invoice_identities where source_invoice_id=v_source_invoice_id;
  if v_identity <> 'pdf_import:'||v_source_invoice_id::text then raise exception 'PDF-only identity was not established'; end if;

  perform tap_hub_project.record_collection_event_for_source(
    '10000000-0000-4000-8000-000000000001','pdf_import',null,v_source_invoice_id,
    'reminder_logged','00000000-0000-4000-8000-000000000002',1,'{}'::jsonb,null);
  insert into tap_hub_project.collection_import_invoices
    (source_invoice_id,batch_id,proposed_linked_invoice_id,invoice_number,customer_name,open_balance,source_as_of,source_row_key,review_status)
    values (v_source_invoice_id,v_batch_two,'20000000-0000-4000-8000-000000000001','SYN-001','Synthetic Orchard',125,v_as_of,'1:1','ready');
  perform tap_hub_project.approve_collection_import_batch(v_batch_two,'00000000-0000-4000-8000-000000000003');

  select canonical_collection_identity into v_identity from tap_hub_project.collection_source_invoice_identities where source_invoice_id=v_source_invoice_id;
  v_pdf_resolved := tap_hub_project.resolve_collection_source_identity('10000000-0000-4000-8000-000000000001','pdf_import',null,v_source_invoice_id);
  v_billing_resolved := tap_hub_project.resolve_collection_source_identity('10000000-0000-4000-8000-000000000001','billing','20000000-0000-4000-8000-000000000001',null);
  if v_identity <> 'pdf_import:'||v_source_invoice_id::text or v_pdf_resolved <> v_identity or v_billing_resolved <> v_identity then
    raise exception 'Late link changed canonical identity or failed to share aliases';
  end if;
  if not exists(select 1 from tap_hub_project.collection_events where canonical_collection_identity=v_identity and event_type='reminder_logged' and stage=1) then
    raise exception 'Late link lost completed stage history';
  end if;
end;
$$;

-- A Billing mutation on the report date is conservatively treated as stale,
-- because the PDF contains a date and not a source timestamp.
do $$
declare
  v_source_invoice_id uuid := gen_random_uuid();
  v_batch uuid := gen_random_uuid();
  v_invoice uuid := '20000000-0000-4000-8000-000000000002';
  v_as_of date := tap_hub_project.collections_firm_today();
begin
  delete from tap_hub_project.audit_log a
   where a.entity = 'invoice_lines'
     and coalesce(a.detail->'new'->>'invoice_id',a.detail->'old'->>'invoice_id') = v_invoice::text;
  insert into tap_hub_project.collection_import_batches
    (id,file_sha256,storage_path,original_filename,content_type,file_size_bytes,report_type,source_as_of,status,uploaded_by)
  values (v_batch,repeat('c',64),v_batch::text||'/stale.pdf','stale.pdf','application/pdf',100,'aging_detail',v_as_of,'needs_review','00000000-0000-4000-8000-000000000001');
  insert into tap_hub_project.collection_source_invoice_identities(source_invoice_id,client_id,linked_invoice_id)
    values (v_source_invoice_id,'10000000-0000-4000-8000-000000000001',v_invoice);
  insert into tap_hub_project.collection_import_rows(batch_id,source_invoice_id,page_number,row_number,raw_text,review_disposition)
    values (v_batch,v_source_invoice_id,1,1,'synthetic invoice row','invoice');
  insert into tap_hub_project.collection_import_invoices
    (source_invoice_id,batch_id,invoice_number,customer_name,open_balance,source_as_of,source_row_key,review_status)
    values (v_source_invoice_id,v_batch,'LOCAL-002','Synthetic Harbor',80,v_as_of,'1:1','ready');
  perform tap_hub_project.approve_collection_import_batch(v_batch,'00000000-0000-4000-8000-000000000003');
  insert into tap_hub_project.invoice_lines(invoice_id,description,quantity,unit_amount,amount,created_by)
    values (v_invoice,'Synthetic post-report change',1,10,10,'00000000-0000-4000-8000-000000000001');
  if not exists(select 1 from tap_hub_project.collection_import_invoices where batch_id=v_batch and review_status='blocked' and discrepancy_status='blocked') then
    raise exception 'A post-report Billing change did not re-block the PDF invoice';
  end if;
  if not exists(select 1 from tap_hub_project.collection_import_audit where batch_id=v_batch and action='billing_snapshot_stale') then
    raise exception 'A stale snapshot re-block was not audit logged';
  end if;
end;
$$;

-- A correction updates the parsed row, invoice snapshot, prior-revision
-- snapshot, and audit row as one transaction.
do $$
declare
  v_batch uuid := gen_random_uuid();
  v_row uuid := gen_random_uuid();
  v_source_invoice_id uuid;
  v_result jsonb;
begin
  insert into tap_hub_project.collection_import_batches
    (id,file_sha256,storage_path,original_filename,content_type,file_size_bytes,report_type,source_as_of,status,uploaded_by)
  values (v_batch,repeat('d',64),v_batch::text||'/correction.pdf','correction.pdf','application/pdf',100,'aging_detail',tap_hub_project.collections_firm_today(),'needs_review','00000000-0000-4000-8000-000000000001');
  insert into tap_hub_project.collection_import_rows(id,batch_id,page_number,row_number,raw_text)
    values (v_row,v_batch,1,1,'synthetic correction row');
  v_result := tap_hub_project.review_collection_import_invoice(v_batch,v_row,'00000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',null,null,
    '{"invoice_number":"SYN-CORR","customer_name":"Synthetic Orchard","open_balance":42,"row_data":{"po":"PO-1"}}'::jsonb);
  v_source_invoice_id := (v_result->>'source_invoice_id')::uuid;
  perform tap_hub_project.review_collection_import_invoice(v_batch,v_row,'00000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',null,v_source_invoice_id,
    '{"invoice_number":"SYN-CORR","customer_name":"Synthetic Orchard Updated","open_balance":40,"row_data":{"terms":"Net 30"}}'::jsonb);
  if not exists(select 1 from tap_hub_project.collection_import_invoice_revisions
    where source_invoice_id=v_source_invoice_id and (snapshot->>'open_balance')::numeric=42) then
    raise exception 'Prior import invoice correction was not preserved';
  end if;
  if not exists(select 1 from tap_hub_project.collection_import_invoices
    where batch_id=v_batch and source_invoice_id=v_source_invoice_id and open_balance=40
      and row_data->>'po'='PO-1' and row_data->>'terms'='Net 30') then
    raise exception 'Correction did not retain new values alongside prior non-conflicting data';
  end if;
  if not exists(select 1 from tap_hub_project.collection_import_audit
    where batch_id=v_batch and source_invoice_id=v_source_invoice_id and actor='00000000-0000-4000-8000-000000000003' and action='pdf_row_corrected') then
    raise exception 'Correction audit row is missing or has the wrong actor';
  end if;
end;
$$;

-- A same-date summary mismatch blocks detail approval until corrected and
-- rechecked; the API-side math is performed in the transaction.
do $$
declare
  v_summary uuid := gen_random_uuid();
  v_detail uuid := gen_random_uuid();
  v_source uuid := gen_random_uuid();
  v_row uuid := gen_random_uuid();
  v_as_of date := tap_hub_project.collections_firm_today();
  v_check jsonb;
  v_blocked boolean := false;
begin
  insert into tap_hub_project.collection_import_batches
    (id,file_sha256,storage_path,original_filename,content_type,file_size_bytes,report_type,source_as_of,status,uploaded_by)
  values
    (v_summary,repeat('e',64),v_summary::text||'/summary.pdf','summary.pdf','application/pdf',100,'aging_summary',v_as_of,'needs_review','00000000-0000-4000-8000-000000000001'),
    (v_detail,repeat('f',64),v_detail::text||'/detail.pdf','detail.pdf','application/pdf',100,'aging_detail',v_as_of,'needs_review','00000000-0000-4000-8000-000000000001');
  insert into tap_hub_project.collection_source_invoice_identities(source_invoice_id,client_id)
    values (v_source,'10000000-0000-4000-8000-000000000001');
  insert into tap_hub_project.collection_import_rows(id,batch_id,source_invoice_id,page_number,row_number,raw_text,review_disposition)
    values (v_row,v_detail,v_source,1,1,'synthetic cross-check row','invoice');
  insert into tap_hub_project.collection_import_invoices
    (source_invoice_id,batch_id,invoice_number,customer_name,open_balance,source_as_of,source_row_key,review_status)
    values (v_source,v_detail,'SYN-XCHECK','Synthetic Orchard',42,v_as_of,'1:1','ready');
  v_check := tap_hub_project.cross_check_collection_import_reports(v_summary,v_detail,40,'Reviewed total differs; reconcile rows','00000000-0000-4000-8000-000000000003');
  if v_check->>'status' <> 'mismatch' or v_check->>'difference' <> '-2.00' then raise exception 'Summary/detail mismatch math is incorrect'; end if;
  begin
    perform tap_hub_project.approve_collection_import_batch(v_detail,'00000000-0000-4000-8000-000000000003');
  exception when sqlstate 'P0001' then v_blocked := true;
  end;
  if not v_blocked then raise exception 'Detail approval was not blocked by mismatched summary report'; end if;
  v_check := tap_hub_project.cross_check_collection_import_reports(v_summary,v_detail,42,'Reviewed corrected total and confirmed','00000000-0000-4000-8000-000000000003');
  if v_check->>'status' <> 'matched' or v_check->>'difference' <> '0.00' then raise exception 'Corrected summary/detail match was not recorded'; end if;
  perform tap_hub_project.approve_collection_import_batch(v_detail,'00000000-0000-4000-8000-000000000003');
end;
$$;
rollback;
