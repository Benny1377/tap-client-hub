-- Local synthetic integration check. All generated ledger/config rows are rolled back.
begin;
do $$
declare
  v_client uuid; v_client_service uuid; v_service_code text; v_client_service_2 uuid; v_service_code_2 text; v_actor uuid;
  v_card uuid; v_bundle uuid; v_candidate uuid; v_candidate_2 uuid; v_invoice uuid; v_line uuid; v_number text; v_amount numeric; v_state text;
  v_today date := tap_hub_project.billing_firm_today(now());
begin
  if tap_hub_project.billing_firm_today(timestamptz '2026-03-08 05:59:00+00')<>'2026-03-07'
     or tap_hub_project.billing_firm_today(timestamptz '2026-03-08 06:00:00+00')<>'2026-03-08'
     or tap_hub_project.billing_firm_today(timestamptz '2026-03-08 08:00:00+00')<>'2026-03-08'
     or tap_hub_project.billing_firm_today(timestamptz '2026-11-01 06:59:00+00')<>'2026-11-01'
     or tap_hub_project.billing_firm_today(timestamptz '2026-11-01 07:00:00+00')<>'2026-11-01' then
    raise exception 'Houston firm date changed incorrectly across DST boundaries';
  end if;
  if tap_hub_project.billing_period_end(date '2026-02-10')<>'2026-02-28'
     or tap_hub_project.billing_period_end(date '2024-02-10')<>'2024-02-29'
     or tap_hub_project.billing_period_end(date '2026-04-10')<>'2026-04-30'
     or tap_hub_project.billing_period_end(date '2026-05-10')<>'2026-05-31' then
    raise exception 'Houston period-end calculation failed month-end cases';
  end if;
  select cs.client_id,cs.id,s.code into v_client,v_client_service,v_service_code
  from tap_hub_project.client_services cs join tap_hub_project.services s on s.id=cs.service_id
  where cs.active order by cs.id limit 1;
  select id into v_actor from tap_hub_project.profiles where role in ('owner','admin') and active limit 1;
  if v_client is null or v_client_service is null or v_service_code is null or v_actor is null then
    raise exception 'synthetic client-service and Owner/Admin fixtures are required';
  end if;

  insert into tap_hub_project.billing_completion_source_maps(client_service_id,adapter,predicate,identity_fields,candidate_date_rule,effective_from,created_by,updated_by,reason)
  values(v_client_service,'schedule','{}'::jsonb,array['client_service_id','period'],'period_end',v_today-1,v_actor,v_actor,'transactional schedule-map validation');

  perform tap_hub_project.set_billing_action_policies('[{"actionKey":"pricing.manage","allowedRoles":["staff"],"enabled":true}]'::jsonb,v_actor,'transactional policy validation');
  if not exists(select 1 from tap_hub_project.billing_action_policy where action_key='pricing.manage' and allowed_roles=array['staff']::text[] and enabled) then raise exception 'policy RPC did not persist the delegable role'; end if;
  begin
    perform tap_hub_project.set_billing_action_policies('[{"actionKey":"invoices.void","allowedRoles":["staff"],"enabled":true}]'::jsonb,v_actor,'must be rejected');
    raise exception 'policy RPC unexpectedly delegated fixed Owner/Admin action' using errcode='P0003';
  exception when sqlstate '22023' then null;
  end;

  insert into tap_hub_project.billing_rate_cards(name,currency,active,effective_from,created_by,updated_by,reason)
  values('Phase 2 SQL test '||gen_random_uuid(),'USD',true,v_today-60,v_actor,v_actor,'transactional synthetic test') returning id into v_card;
  insert into tap_hub_project.billing_rate_card_entries(rate_card_id,service_code,unit,unit_amount,effective_from,created_by,updated_by,reason)
  values(v_card,v_service_code,'service',10.00,v_today-60,v_actor,v_actor,'transactional synthetic test');
  insert into tap_hub_project.billing_terms_overrides(client_id,client_service_id,net_days,effective_from,created_by,updated_by,reason)
  values(v_client,null,30,v_today-60,v_actor,v_actor,'client terms test');
  insert into tap_hub_project.billing_terms_overrides(client_id,client_service_id,net_days,effective_from,created_by,updated_by,reason)
  values(v_client,v_client_service,45,v_today-60,v_actor,v_actor,'client-service terms precedence test');
  update tap_hub_project.billing_remittance_settings set payee_name='TAP Synthetic',address='100 Test St, Houston, TX',instructions='Synthetic test only',updated_by=v_actor,reason='transactional remittance snapshot test' where singleton;
  select p.unit_amount into v_amount from tap_hub_project.resolve_billing_price(v_client_service,v_client,v_service_code,'service',v_today) p;
  if v_amount is distinct from 10.00 then raise exception 'price resolution did not select the active rate card entry'; end if;
  begin
    insert into tap_hub_project.billing_rate_card_entries(rate_card_id,service_code,unit,unit_amount,effective_from,created_by,updated_by,reason)
    values(v_card,v_service_code,'service',11.00,v_today-1,v_actor,v_actor,'must overlap');
    raise exception 'overlapping effective rate unexpectedly succeeded' using errcode='P0003';
  exception when sqlstate '23505' then null;
  end;

  insert into tap_hub_project.billing_candidates(client_id,client_service_id,candidate_type,source_adapter,source_identity,period,candidate_date,description,state,service_code,unit,unit_amount,price_source,created_by,updated_by)
  values(v_client,v_client_service,'recurring','schedule','phase2-test:'||gen_random_uuid(),to_char(v_today,'YYYY-MM'),v_today,'Phase 2 synthetic candidate','open',v_service_code,'service',10.00,'rate_card',v_actor,v_actor)
  returning id into v_candidate;
  v_invoice:=tap_hub_project.create_draft_from_candidates(array[v_candidate],'Synthetic validation',v_actor);
  if exists(select 1 from tap_hub_project.invoices where id=v_invoice and (status<>'draft' or invoice_number is not null or issue_date is not null or due_date is not null)) then raise exception 'candidate draft must have null issue fields'; end if;
  select id,amount into v_line,v_amount from tap_hub_project.invoice_lines where invoice_id=v_invoice;
  if v_amount is distinct from 10.00 then raise exception 'draft line amount is incorrect'; end if;
  begin
    update tap_hub_project.invoice_lines set description='Should fail' where id=v_line;
    raise exception 'candidate-linked line edit unexpectedly succeeded' using errcode='P0003';
  exception when sqlstate 'P0001' then null;
  end;
  perform tap_hub_project.issue_billing_invoice(v_invoice,v_actor);
  if not exists(select 1 from tap_hub_project.invoices where id=v_invoice and status='issued' and invoice_number ~ '^TAP-[0-9]{4}-[0-9]{4}$' and issue_date=v_today and due_date=issue_date+45 and remittance_snapshot->>'payeeName'='TAP Synthetic') then raise exception 'atomic issue fields, client-service terms, or remittance snapshot incorrect'; end if;
  select invoice_number into v_number from tap_hub_project.invoices where id=v_invoice;
  select state into v_state from tap_hub_project.billing_candidates where id=v_candidate;
  if v_state<>'invoiced' then raise exception 'issue did not transition candidate to invoiced'; end if;
  perform tap_hub_project.void_billing_invoice(v_invoice,'Synthetic correction',v_actor);
  select state into v_state from tap_hub_project.billing_candidates where id=v_candidate;
  if v_state<>'open' then raise exception 'void did not return candidate to open'; end if;
  v_invoice:=tap_hub_project.create_draft_from_candidates(array[v_candidate],'Synthetic reissue',v_actor);
  perform tap_hub_project.issue_billing_invoice(v_invoice,v_actor);
  if (select invoice_number from tap_hub_project.invoices where id=v_invoice)=v_number then raise exception 'voided invoice number was reused'; end if;
  perform tap_hub_project.void_billing_invoice(v_invoice,'Synthetic second correction',v_actor);
  v_invoice:=tap_hub_project.create_draft_from_candidates(array[v_candidate],'Synthetic re-draft',v_actor);
  select id into v_line from tap_hub_project.invoice_lines where invoice_id=v_invoice;
  perform tap_hub_project.delete_draft_invoice_line(v_line,v_actor);
  select state into v_state from tap_hub_project.billing_candidates where id=v_candidate;
  if v_state<>'open' then raise exception 'line deletion did not release candidate claim'; end if;
  perform tap_hub_project.delete_draft_invoice(v_invoice,v_actor);
  if exists(select 1 from tap_hub_project.invoices where id=v_invoice) then raise exception 'draft deletion did not remove invoice'; end if;
  v_invoice:=tap_hub_project.create_draft_from_candidates(array[v_candidate],'Delete draft with linked line',v_actor);
  perform tap_hub_project.delete_draft_invoice(v_invoice,v_actor);
  select state into v_state from tap_hub_project.billing_candidates where id=v_candidate;
  if v_state<>'open' then raise exception 'deleting draft with a line did not return candidate to open'; end if;

  select cs.id,s.code into v_client_service_2,v_service_code_2 from tap_hub_project.client_services cs
  join tap_hub_project.services s on s.id=cs.service_id where cs.client_id=v_client and cs.active and cs.id<>v_client_service order by cs.id limit 1;
  if v_client_service_2 is not null then
    insert into tap_hub_project.billing_completion_source_maps(client_service_id,adapter,predicate,identity_fields,candidate_date_rule,effective_from,created_by,updated_by,reason)
    values(v_client_service_2,'manual_confirmation','{}'::jsonb,array['confirmation_id'],'confirmed_date',v_today-1,v_actor,v_actor,'manual-confirmation test map');
    declare
      v_confirmation uuid:=gen_random_uuid(); v_manual jsonb; v_retry jsonb; v_manual_candidate uuid;
    begin
      v_manual:=tap_hub_project.create_billing_manual_confirmation(v_confirmation,v_client_service_2,v_today,'Synthetic owner-confirmed work','Synthetic manual confirmation',v_actor);
      v_retry:=tap_hub_project.create_billing_manual_confirmation(v_confirmation,v_client_service_2,v_today,'Synthetic owner-confirmed work','Synthetic manual confirmation',v_actor);
      if (v_manual->>'created')::boolean is distinct from true or (v_retry->>'created')::boolean is distinct from false or v_manual->>'candidateId' is distinct from v_retry->>'candidateId' then raise exception 'manual confirmation idempotency failed'; end if;
      v_manual_candidate:=(v_manual->>'candidateId')::uuid;
      if not exists(select 1 from tap_hub_project.billing_candidates where id=v_manual_candidate and source_adapter='manual_confirmation' and source_identity=v_confirmation::text and period=to_char(v_today,'YYYY-MM')) then raise exception 'manual confirmation candidate provenance is invalid'; end if;
      begin
        perform tap_hub_project.create_billing_manual_confirmation(gen_random_uuid(),v_client_service_2,v_today,'Duplicate synthetic confirmation','Duplicate test',v_actor);
        raise exception 'a second manual confirmation for the same service/date was accepted' using errcode='P0003';
      exception when unique_violation then null;
      end;
      begin
        perform tap_hub_project.create_billing_manual_confirmation(gen_random_uuid(),v_client_service_2,v_today+1,'Future synthetic confirmation','Future test',v_actor);
        raise exception 'a future manual confirmation was accepted' using errcode='P0003';
      exception when sqlstate '22023' then null;
      end;
      begin
        perform tap_hub_project.create_billing_manual_confirmation(v_confirmation,v_client_service_2,v_today,'Synthetic owner-confirmed work','Changed reason',v_actor);
        raise exception 'manual confirmation idempotency key accepted a changed reason' using errcode='P0003';
      exception when sqlstate '23505' then null;
      end;
      begin
        perform tap_hub_project.create_billing_manual_confirmation(v_confirmation,v_client_service_2,v_today,'Different note','Synthetic conflict',v_actor);
        raise exception 'manual confirmation idempotency key accepted conflicting data' using errcode='P0003';
      exception when sqlstate '23505' then null;
      end;
    end;
    insert into tap_hub_project.billing_bundles(name,client_id,unit_amount,active,effective_from,created_by,updated_by,reason)
    values('Phase 2 bundle test '||gen_random_uuid(),v_client,18.00,true,v_today-60,v_actor,v_actor,'transactional synthetic bundle test') returning id into v_bundle;
    perform tap_hub_project.set_billing_bundle_components(v_bundle,array[v_client_service,v_client_service_2],v_actor,'synthetic bundle components');
    insert into tap_hub_project.billing_candidates(client_id,client_service_id,candidate_type,source_adapter,source_identity,period,candidate_date,description,state,service_code,unit,unit_amount,price_source,created_by,updated_by)
    values(v_client,v_client_service,'recurring','schedule','bundle-test-a:'||gen_random_uuid(),to_char(v_today,'YYYY-MM'),v_today,'Bundle component A','open',v_service_code,'service',10.00,'bundle',v_actor,v_actor) returning id into v_candidate;
    insert into tap_hub_project.billing_candidates(client_id,client_service_id,candidate_type,source_adapter,source_identity,period,candidate_date,description,state,service_code,unit,unit_amount,price_source,created_by,updated_by)
    values(v_client,v_client_service_2,'recurring','schedule','bundle-test-b:'||gen_random_uuid(),to_char(v_today,'YYYY-MM'),v_today,'Bundle component B','open',v_service_code_2,'service',10.00,'bundle',v_actor,v_actor) returning id into v_candidate_2;
    begin
      perform tap_hub_project.create_draft_from_candidates(array[v_candidate],'Incomplete package',v_actor);
      raise exception 'partial bundle candidate selection unexpectedly succeeded' using errcode='P0003';
    exception when sqlstate 'P0001' then null;
    end;
    v_invoice:=tap_hub_project.create_draft_from_candidates(array[v_candidate,v_candidate_2],'Complete package',v_actor);
    select id,amount into v_line,v_amount from tap_hub_project.invoice_lines where invoice_id=v_invoice;
    if v_amount is distinct from 18.00 or (select count(*) from tap_hub_project.invoice_lines where invoice_id=v_invoice)<>1 or (select count(*) from tap_hub_project.billing_candidate_line_links where invoice_line_id=v_line and active)<>2 then raise exception 'bundle must produce one package line with every candidate linked'; end if;
    perform tap_hub_project.delete_draft_invoice(v_invoice,v_actor);
  end if;
end;
$$;
rollback;
