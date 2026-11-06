-- Close the Phase 2 review findings: enforce invoice transition authorization
-- in the database and return the exact candidate audit row from its mutation.
begin;

create or replace function tap_hub_project.assert_billing_action_actor(p_actor uuid,p_action text)
returns void language plpgsql security definer set search_path=tap_hub_project,public as $$
declare v_role text; v_active boolean; v_modules text[]; v_allowed text[]; v_enabled boolean; v_policy_exists boolean;
begin
 select lower(role),active,modules into v_role,v_active,v_modules from profiles where id=p_actor;
 if not found or v_active is distinct from true then
   raise exception 'forbidden: active billing actor required' using errcode='42501';
 end if;
 v_role:=case
   when v_role like '%owner%' then 'owner'
   when v_role like '%admin%' then 'admin'
   when v_role like '%manager%' then 'manager'
   when v_role like '%offshore%' or v_role like '%india%' then 'offshore'
   else 'staff'
 end;
 if v_role in ('owner','admin') then return; end if;
 if p_action='invoices.void' then
   raise exception 'forbidden: Owner/Admin required' using errcode='42501';
 end if;
 if not exists(select 1 from unnest(coalesce(v_modules,'{}'::text[])) module where lower(trim(module))='billing') then
   raise exception 'forbidden: Billing module required' using errcode='42501';
 end if;
 select allowed_roles,enabled into v_allowed,v_enabled from billing_action_policy where action_key=p_action;
 v_policy_exists:=found;
 if v_policy_exists then
   if not v_enabled or not (v_role=any(v_allowed)) then
     raise exception 'forbidden: billing action is not granted' using errcode='42501';
   end if;
 elsif p_action not in ('invoices.issue','candidates.manage') then
   raise exception 'forbidden: billing action has no default grant' using errcode='42501';
 end if;
end; $$;

-- Retain the transactional row-audit behavior, exposing the exact generated
-- audit ID to the candidate mutation RPC within the same database transaction.
create or replace function tap_hub_project.audit_billing_row()
returns trigger language plpgsql security definer
set search_path=tap_hub_project,public as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_actor uuid;
  v_id text;
  v_audit_id text;
  v_entity text := tg_table_name;
begin
  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
  v_id := coalesce(v_new->>'id', v_old->>'id');
  v_actor := coalesce(
    nullif(current_setting('tap_hub.actor_id', true), '')::uuid,
    nullif(coalesce(v_new, v_old)->>'actor', '')::uuid,
    nullif(coalesce(v_new, v_old)->>'updated_by', '')::uuid,
    nullif(coalesce(v_new, v_old)->>'created_by', '')::uuid,
    nullif(coalesce(v_new, v_old)->>'placed_by', '')::uuid,
    nullif(coalesce(v_new, v_old)->>'released_by', '')::uuid,
    nullif(coalesce(v_new, v_old)->>'voided_by', '')::uuid,
    nullif(coalesce(v_new, v_old)->>'reversed_by', '')::uuid
  );
  insert into audit_log(actor, action, entity, entity_id, detail)
  values(v_actor, lower(tg_op), v_entity, v_id,
    jsonb_build_object('old',v_old,'new',v_new))
  returning id::text into v_audit_id;
  if tg_table_name='billing_candidates' then
    perform set_config('tap_hub.billing_candidate_audit_id',v_audit_id,true);
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end; $$;

create or replace function tap_hub_project.issue_billing_invoice(p_invoice_id uuid,p_actor uuid)
returns uuid language plpgsql security definer set search_path=tap_hub_project,public as $$
declare v_invoice invoices%rowtype; v_today date; v_year integer; v_no integer; v_days integer; v_snapshot jsonb;
begin
 perform assert_billing_action_actor(p_actor,'invoices.issue');
 select * into v_invoice from invoices where id=p_invoice_id for update;
 if not found then raise exception 'not_found: invoice does not exist' using errcode='P0002'; end if;
 if v_invoice.status<>'draft' then raise exception 'conflict: only draft invoices may be issued' using errcode='P0001'; end if;
 if not exists(select 1 from invoice_lines where invoice_id=p_invoice_id) then raise exception 'issue_precondition_failed: invoice has no lines' using errcode='P0001'; end if;
 if exists(select 1 from billing_candidate_line_links l join billing_candidates c on c.id=l.candidate_id where l.invoice_line_id in(select id from invoice_lines where invoice_id=p_invoice_id) and c.state<>'drafted') then raise exception 'issue_precondition_failed: linked candidate state is invalid' using errcode='P0001'; end if;
 v_today:=billing_firm_today(now()); v_year:=extract(year from v_today)::int;
 insert into billing_invoice_sequences(issue_year,last_value) values(v_year,0) on conflict(issue_year) do nothing;
 update billing_invoice_sequences set last_value=last_value+1 where issue_year=v_year returning last_value into v_no;
 if v_no>9999 then raise exception 'issue_precondition_failed: invoice sequence exhausted' using errcode='P0001'; end if;
 select o.net_days into v_days from billing_terms_overrides o where o.client_id=v_invoice.client_id
   and (o.client_service_id is null or exists(select 1 from invoice_lines il where il.invoice_id=p_invoice_id and il.client_service_id=o.client_service_id))
   and v_today between o.effective_from and coalesce(o.effective_to,'infinity'::date)
   order by case when o.client_service_id is null then 0 else 1 end desc,o.effective_from desc,o.id limit 1;
 if v_days is null then select default_net_days into v_days from billing_terms_settings where singleton; end if;
 v_days:=coalesce(v_days,15);
 select case when payee_name is null and address is null and instructions is null then null else jsonb_strip_nulls(jsonb_build_object('payeeName',payee_name,'address',address,'instructions',instructions)) end into v_snapshot from billing_remittance_settings where singleton;
 perform set_config('tap_hub.actor_id',p_actor::text,true);
 update invoices set invoice_number=format('TAP-%s-%s',v_year,lpad(v_no::text,4,'0')),issue_date=v_today,due_date=v_today+v_days,status='issued',remittance_snapshot=v_snapshot,updated_by=p_actor where id=p_invoice_id;
 update billing_candidates c set state='invoiced',updated_by=p_actor,updated_at=now() from billing_candidate_line_links l join invoice_lines il on il.id=l.invoice_line_id where l.candidate_id=c.id and l.active and il.invoice_id=p_invoice_id;
 return p_invoice_id;
end; $$;

create or replace function tap_hub_project.void_billing_invoice(p_invoice_id uuid,p_reason text,p_actor uuid)
returns uuid language plpgsql security definer set search_path=tap_hub_project,public as $$
declare v_invoice invoices%rowtype;
begin
 perform assert_billing_action_actor(p_actor,'invoices.void');
 if nullif(btrim(p_reason),'') is null then raise exception 'invalid_input: void reason required' using errcode='22023'; end if;
 select * into v_invoice from invoices where id=p_invoice_id for update;
 if not found then raise exception 'not_found: invoice does not exist' using errcode='P0002'; end if;
 if v_invoice.status<>'issued' then raise exception 'conflict: only issued invoices may be voided' using errcode='P0001'; end if;
 if exists(select 1 from payment_allocations where invoice_id=p_invoice_id and reversed_at is null) then raise exception 'active_payment_allocation: reverse allocations first' using errcode='P0001'; end if;
 perform set_config('tap_hub.actor_id',p_actor::text,true);
 update invoices set status='void',void_reason=btrim(p_reason),voided_by=p_actor,voided_at=now(),updated_by=p_actor where id=p_invoice_id;
 update billing_candidates c set state=case when c.unit_amount is null then 'unpriced' else 'open' end,updated_by=p_actor,updated_at=now() from billing_candidate_line_links l join invoice_lines il on il.id=l.invoice_line_id where l.candidate_id=c.id and il.invoice_id=p_invoice_id;
 update billing_candidate_line_links l set active=false where l.active and l.invoice_line_id in(select id from invoice_lines where invoice_id=p_invoice_id);
 return p_invoice_id;
end; $$;

create or replace function tap_hub_project.mutate_billing_candidate(
 p_id uuid,p_action text,p_expected_state text,p_reason text,p_actor uuid,
 p_unit_amount numeric default null,p_price_source text default null
) returns jsonb language plpgsql security definer set search_path=tap_hub_project,public as $$
declare v_candidate billing_candidates%rowtype; v_next_state text; v_audit_id text;
begin
 if p_id is null or p_actor is null or nullif(btrim(p_reason),'') is null or length(btrim(p_reason))>1000 then
   raise exception 'invalid_input: candidate mutation reason and identifiers are required' using errcode='22023';
 end if;
 if p_action not in ('dismiss','reopen','reprice') then
   raise exception 'invalid_input: unsupported candidate action' using errcode='22023';
 end if;
 perform assert_billing_action_actor(p_actor,'candidates.manage');
 select * into v_candidate from billing_candidates where id=p_id for update;
 if not found then raise exception 'not_found: candidate does not exist' using errcode='P0002'; end if;
 if v_candidate.state is distinct from p_expected_state then
   raise exception 'candidate_not_open: candidate changed during mutation' using errcode='P0001';
 end if;
 if p_action='dismiss' then
   if v_candidate.state not in ('open','unpriced') then raise exception 'candidate_not_open: candidate cannot be dismissed' using errcode='P0001'; end if;
   v_next_state:='dismissed';
 elsif p_action='reopen' then
   if v_candidate.state<>'dismissed' then raise exception 'candidate_not_open: only dismissed candidates can be reopened' using errcode='P0001'; end if;
   v_next_state:=case when v_candidate.unit_amount is null then 'unpriced' else 'open' end;
 elsif p_action='reprice' then
   if v_candidate.state not in ('open','unpriced') or p_unit_amount is null or p_unit_amount<0 or nullif(btrim(p_price_source),'') is null then
     raise exception 'candidate_not_open: candidate cannot be repriced' using errcode='P0001';
   end if;
   v_next_state:='open';
 end if;
 perform set_config('tap_hub.actor_id',p_actor::text,true);
 perform set_config('tap_hub.billing_candidate_audit_id','',true);
 update billing_candidates set
   state=v_next_state,
   unit_amount=case when p_action='reprice' then p_unit_amount else unit_amount end,
   price_source=case when p_action='reprice' then p_price_source else price_source end,
   dismissed_reason=case when p_action='dismiss' then btrim(p_reason) when p_action='reopen' then null else dismissed_reason end,
   last_reason=btrim(p_reason),updated_by=p_actor,updated_at=now()
 where id=p_id returning * into v_candidate;
 v_audit_id:=nullif(current_setting('tap_hub.billing_candidate_audit_id',true),'');
 if v_audit_id is null then raise exception 'audit_write_failed: candidate audit row was not captured' using errcode='P0001'; end if;
 return jsonb_build_object('candidate',to_jsonb(v_candidate),'auditId',v_audit_id);
end; $$;

revoke all on function tap_hub_project.assert_billing_action_actor(uuid,text) from public,anon,authenticated;
revoke all on function tap_hub_project.mutate_billing_candidate(uuid,text,text,text,uuid,numeric,text) from public,anon,authenticated;
grant execute on function tap_hub_project.mutate_billing_candidate(uuid,text,text,text,uuid,numeric,text) to service_role;

commit;
