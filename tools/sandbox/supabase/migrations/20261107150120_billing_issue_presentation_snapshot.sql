-- Freeze the firm-facing invoice identity at issue time, alongside remittance.
-- Drafts remain live previews; existing issued/void invoices retain null for
-- this newly introduced historical field and are never rewritten here.
begin;

alter table tap_hub_project.invoices
  add column if not exists presentation_snapshot jsonb;

create or replace function tap_hub_project.issue_billing_invoice(p_invoice_id uuid,p_actor uuid)
returns uuid language plpgsql security definer set search_path=tap_hub_project,public as $$
declare
  v_invoice invoices%rowtype;
  v_today date;
  v_year integer;
  v_no integer;
  v_days integer;
  v_remittance_snapshot jsonb;
  v_presentation_snapshot jsonb;
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
 select case when payee_name is null and address is null and instructions is null then null else jsonb_strip_nulls(jsonb_build_object('payeeName',payee_name,'address',address,'instructions',instructions)) end
   into v_remittance_snapshot from billing_remittance_settings where singleton;
 select jsonb_strip_nulls(jsonb_build_object('firmName',firm_name,'tagline',tagline,'invoiceFooter',invoice_footer))
   into v_presentation_snapshot from billing_presentation_settings where singleton;
 if v_presentation_snapshot is null then
   raise exception 'issue_precondition_failed: invoice presentation settings are not initialized' using errcode='P0001';
 end if;
 perform set_config('tap_hub.actor_id',p_actor::text,true);
 update invoices set invoice_number=format('TAP-%s-%s',v_year,lpad(v_no::text,4,'0')),
   issue_date=v_today,due_date=v_today+v_days,status='issued',remittance_snapshot=v_remittance_snapshot,
   presentation_snapshot=v_presentation_snapshot,updated_by=p_actor where id=p_invoice_id;
 update billing_candidates c set state='invoiced',updated_by=p_actor,updated_at=now()
   from billing_candidate_line_links l join invoice_lines il on il.id=l.invoice_line_id
   where l.candidate_id=c.id and l.active and il.invoice_id=p_invoice_id;
 return p_invoice_id;
end; $$;

create or replace function tap_hub_project.guard_invoice_presentation_snapshot()
returns trigger language plpgsql security definer set search_path=tap_hub_project,public as $$
begin
  if old.status='draft' and new.status='issued' and new.presentation_snapshot is null then
    raise exception 'invariant_violation: issued invoice requires a presentation snapshot' using errcode='P0001';
  end if;
  if old.status<>'draft' and new.presentation_snapshot is distinct from old.presentation_snapshot then
    raise exception 'invariant_violation: issued invoice presentation snapshot is immutable' using errcode='P0001';
  end if;
  return new;
end; $$;

drop trigger if exists billing_invoice_presentation_snapshot_guard on tap_hub_project.invoices;
create trigger billing_invoice_presentation_snapshot_guard
before update of status,presentation_snapshot on tap_hub_project.invoices
for each row execute function tap_hub_project.guard_invoice_presentation_snapshot();

commit;
