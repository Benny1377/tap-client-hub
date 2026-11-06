-- Billing Phase 2: configurable pricing, candidate provenance and issue lifecycle.
-- Billing-owned schema only; Operations tables, rows, and policies are not modified.
begin;

alter table tap_hub_project.invoices
  alter column invoice_number drop not null,
  alter column issue_date drop not null,
  alter column due_date drop not null,
  add column if not exists remittance_snapshot jsonb;
update tap_hub_project.invoices set invoice_number=null,issue_date=null,due_date=null where status='draft';
alter table tap_hub_project.invoices drop constraint if exists invoices_due_date_check;
alter table tap_hub_project.invoices add constraint invoices_draft_dates_check check (
  (status = 'draft' and invoice_number is null and issue_date is null and due_date is null)
  or (status in ('issued','void') and invoice_number is not null and issue_date is not null and due_date is not null and due_date >= issue_date)
);
create unique index if not exists invoices_number_unique_when_assigned on tap_hub_project.invoices(invoice_number) where invoice_number is not null;

create table tap_hub_project.billing_invoice_sequences (
  issue_year integer primary key check (issue_year between 2000 and 9999), last_value integer not null default 0 check (last_value between 0 and 9999)
);
create or replace function tap_hub_project.billing_firm_today(p_at timestamptz default now()) returns date
language sql immutable set search_path=tap_hub_project,public as $$ select (p_at at time zone 'America/Chicago')::date $$;
create or replace function tap_hub_project.billing_period_end(p_month date) returns date
language sql immutable set search_path=tap_hub_project,public as $$ select (date_trunc('month',p_month::timestamp)::date + interval '1 month')::date - 1 $$;
create table tap_hub_project.billing_action_policy (
  action_key text primary key,
  allowed_roles text[] not null default '{}',
  enabled boolean not null default true,
  updated_by uuid references tap_hub_project.profiles(id), updated_at timestamptz not null default now(), reason text not null,
  check(action_key in ('billing.view','pricing.view','pricing.manage','candidates.view','candidates.manage','invoices.draft.manage','invoices.issue','payments.record','payments.allocate','settings.terms.manage','settings.remittance.manage')),
  check(allowed_roles <@ array['owner','admin','manager','staff','offshore']::text[])
);
insert into tap_hub_project.billing_action_policy(action_key,allowed_roles,reason) values
 ('pricing.manage',array['owner','admin'],'Initial fixed default; Owner/Admin may delegate'),
 ('settings.terms.manage',array[]::text[],'Initial fixed default; Owner/Admin only'),
 ('settings.remittance.manage',array[]::text[],'Initial fixed default; Owner/Admin only')
on conflict (action_key) do nothing;

create table tap_hub_project.billing_rate_cards (
 id uuid primary key default gen_random_uuid(), name text not null, currency text not null default 'USD' check(currency='USD'), active boolean not null default true,
 effective_from date not null, effective_to date, created_by uuid references tap_hub_project.profiles(id), updated_by uuid references tap_hub_project.profiles(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), reason text not null,
 check(effective_to is null or effective_to>=effective_from), unique(name,effective_from)
);
create table tap_hub_project.billing_rate_card_entries (
 id uuid primary key default gen_random_uuid(), rate_card_id uuid not null references tap_hub_project.billing_rate_cards(id) on delete cascade,
 service_code text not null, unit text not null, unit_amount numeric(12,2) not null check(unit_amount>=0), effective_from date not null, effective_to date,
 created_by uuid references tap_hub_project.profiles(id), updated_by uuid references tap_hub_project.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), reason text not null,
 check(effective_to is null or effective_to>=effective_from)
);
create table tap_hub_project.billing_client_service_overrides (
 id uuid primary key default gen_random_uuid(), client_service_id uuid not null references tap_hub_project.client_services(id) on delete restrict,
 unit_amount numeric(12,2) not null check(unit_amount>=0), effective_from date not null, effective_to date,
 created_by uuid references tap_hub_project.profiles(id), updated_by uuid references tap_hub_project.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), reason text not null,
 check(effective_to is null or effective_to>=effective_from)
);
create table tap_hub_project.billing_bundles (
 id uuid primary key default gen_random_uuid(), name text not null, client_id uuid references tap_hub_project.clients(id) on delete restrict,
 unit_amount numeric(12,2) not null check(unit_amount>=0), active boolean not null default true, effective_from date not null, effective_to date,
 created_by uuid references tap_hub_project.profiles(id), updated_by uuid references tap_hub_project.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), reason text not null,
 check(effective_to is null or effective_to>=effective_from)
);
create table tap_hub_project.billing_bundle_components (
  id uuid primary key default gen_random_uuid(),
 bundle_id uuid not null references tap_hub_project.billing_bundles(id) on delete cascade,
 client_service_id uuid not null references tap_hub_project.client_services(id) on delete restrict,
  created_by uuid references tap_hub_project.profiles(id),
  unique(bundle_id,client_service_id)
);
create table tap_hub_project.billing_terms_settings (
 singleton boolean primary key default true check(singleton), default_net_days integer not null default 15 check(default_net_days between 0 and 365),
 billing_day text not null default 'service_period_end' check(billing_day='service_period_end'), timezone text not null default 'America/Chicago' check(timezone='America/Chicago'),
 updated_by uuid references tap_hub_project.profiles(id), updated_at timestamptz not null default now(), reason text not null
);
insert into tap_hub_project.billing_terms_settings(singleton,reason) values(true,'Initial approved defaults') on conflict(singleton) do nothing;
create table tap_hub_project.billing_terms_overrides (
 id uuid primary key default gen_random_uuid(), client_id uuid not null references tap_hub_project.clients(id) on delete cascade,
 client_service_id uuid references tap_hub_project.client_services(id) on delete cascade, net_days integer not null check(net_days between 0 and 365),
 effective_from date not null, effective_to date, created_by uuid references tap_hub_project.profiles(id), updated_by uuid references tap_hub_project.profiles(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), reason text not null,
 check(effective_to is null or effective_to>=effective_from)
);
create unique index billing_terms_override_scope_start on tap_hub_project.billing_terms_overrides(client_id,coalesce(client_service_id,'00000000-0000-0000-0000-000000000000'::uuid),effective_from);
create table tap_hub_project.billing_remittance_settings (
 singleton boolean primary key default true check(singleton), payee_name text, address text, instructions text,
 updated_by uuid references tap_hub_project.profiles(id), updated_at timestamptz not null default now(), reason text not null
);
insert into tap_hub_project.billing_remittance_settings(singleton,reason) values(true,'Initial empty settings') on conflict(singleton) do nothing;
create table tap_hub_project.billing_completion_source_maps (
 id uuid primary key default gen_random_uuid(), client_service_id uuid not null references tap_hub_project.client_services(id) on delete restrict,
 adapter text not null check(adapter in ('schedule','work_period_done','period_count_threshold','manual_confirmation')),
 predicate jsonb not null default '{}'::jsonb, identity_fields text[] not null, candidate_date_rule text not null check(candidate_date_rule in ('period_end','completion_date','confirmed_date')),
 effective_from date not null, effective_to date, enabled boolean not null default true, created_by uuid references tap_hub_project.profiles(id), updated_by uuid references tap_hub_project.profiles(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), reason text not null, check(effective_to is null or effective_to>=effective_from)
);
create table tap_hub_project.billing_candidates (
 id uuid primary key default gen_random_uuid(), client_id uuid not null references tap_hub_project.clients(id) on delete restrict,
 client_service_id uuid not null references tap_hub_project.client_services(id) on delete restrict, candidate_type text not null check(candidate_type in ('recurring','completion')),
 source_adapter text not null check(source_adapter in ('schedule','work_period_done','period_count_threshold','manual_confirmation')),
 source_identity text not null, period text, candidate_date date not null, description text not null,
 state text not null check(state in ('unpriced','open','drafted','invoiced','dismissed')), service_code text, unit text,
 unit_amount numeric(12,2) check(unit_amount is null or unit_amount>=0), price_source text,
 dismissed_reason text, last_reason text, created_by uuid references tap_hub_project.profiles(id), updated_by uuid references tap_hub_project.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(client_service_id,candidate_type,source_identity), check(period is null or period ~ '^[0-9]{4}-[0-9]{2}$')
);
create table tap_hub_project.billing_manual_confirmations (
 id uuid primary key,
 client_service_id uuid not null references tap_hub_project.client_services(id) on delete restrict,
 confirmed_date date not null,
 source_note text not null check(length(btrim(source_note)) between 1 and 2000),
 candidate_id uuid not null unique references tap_hub_project.billing_candidates(id) on delete restrict,
 created_by uuid not null references tap_hub_project.profiles(id),
 created_at timestamptz not null default now(),
 reason text not null check(length(btrim(reason)) between 1 and 1000)
);
create index billing_candidates_page_idx on tap_hub_project.billing_candidates(candidate_date desc,id desc);
create index billing_candidates_client_state_idx on tap_hub_project.billing_candidates(client_id,state,candidate_date desc);
create table tap_hub_project.billing_candidate_line_links (
 id uuid primary key default gen_random_uuid(),
 candidate_id uuid not null references tap_hub_project.billing_candidates(id) on delete restrict,
 invoice_line_id uuid references tap_hub_project.invoice_lines(id) on delete set null,
 active boolean not null default true,
 created_by uuid references tap_hub_project.profiles(id),
 created_at timestamptz not null default now(),
 check ((active and invoice_line_id is not null) or not active)
);
create unique index billing_candidate_one_active_claim on tap_hub_project.billing_candidate_line_links(candidate_id) where active;
create index billing_candidate_line_links_line_idx on tap_hub_project.billing_candidate_line_links(invoice_line_id);

-- Transactional audit is inherited from the Phase 1 row-audit trigger.
do $$ declare t text; begin
 foreach t in array array['billing_action_policy','billing_rate_cards','billing_rate_card_entries','billing_client_service_overrides','billing_bundles','billing_bundle_components','billing_terms_settings','billing_terms_overrides','billing_remittance_settings','billing_completion_source_maps','billing_candidates','billing_manual_confirmations','billing_candidate_line_links'] loop
   execute format('drop trigger if exists billing_audit_%I on tap_hub_project.%I',t,t);
   execute format('create trigger billing_audit_%I after insert or update or delete on tap_hub_project.%I for each row execute function tap_hub_project.audit_billing_row()',t,t);
 end loop;
end $$;

-- The Owner/Admin policy editor can delegate only ordinary actions to real
-- application roles. The three fixed Owner/Admin actions cannot be stored or
-- delegated, even if a caller bypasses HTTP validation.
create or replace function tap_hub_project.set_billing_action_policies(p_policies jsonb,p_actor uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=tap_hub_project,public as $$
declare item jsonb; v_action text; v_roles text[]; v_enabled boolean; v_result jsonb:='[]'::jsonb;
begin
 if nullif(btrim(p_reason),'') is null or length(btrim(p_reason))>1000 or jsonb_typeof(p_policies) is distinct from 'array' or jsonb_array_length(p_policies)<1 or jsonb_array_length(p_policies)>14 then
   raise exception 'invalid_input: invalid policy payload or reason' using errcode='22023';
 end if;
 if not exists(select 1 from profiles where id=p_actor and active and lower(role) in ('owner','admin')) then
   raise exception 'forbidden: Owner/Admin required' using errcode='42501';
 end if;
 for item in select value from jsonb_array_elements(p_policies) loop
   v_action:=item->>'actionKey';
   if v_action in ('policy.manage','invoices.void','payments.reverse') or v_action not in ('billing.view','pricing.view','pricing.manage','candidates.view','candidates.manage','invoices.draft.manage','invoices.issue','payments.record','payments.allocate','settings.terms.manage','settings.remittance.manage') then
     raise exception 'invalid_input: action is not delegable' using errcode='22023';
   end if;
   if jsonb_typeof(item->'allowedRoles') is distinct from 'array' or jsonb_typeof(item->'enabled') is distinct from 'boolean' then
     raise exception 'invalid_input: role list and enabled flag are required' using errcode='22023';
   end if;
   select coalesce(array_agg(role_value), '{}') into v_roles from jsonb_array_elements_text(item->'allowedRoles') role_value;
   if exists(select 1 from unnest(v_roles) role_value where role_value not in ('manager','staff','offshore')) or cardinality(v_roles)<>(select count(distinct role_value) from unnest(v_roles) role_value) then
     raise exception 'invalid_input: role is not delegable' using errcode='22023';
   end if;
   v_enabled:=(item->>'enabled')::boolean;
   perform set_config('tap_hub.actor_id',p_actor::text,true);
   insert into billing_action_policy(action_key,allowed_roles,enabled,updated_by,updated_at,reason)
   values(v_action,v_roles,v_enabled,p_actor,now(),btrim(p_reason))
   on conflict(action_key) do update set allowed_roles=excluded.allowed_roles,enabled=excluded.enabled,updated_by=excluded.updated_by,updated_at=excluded.updated_at,reason=excluded.reason;
   v_result:=v_result||jsonb_build_array(jsonb_build_object('actionKey',v_action,'allowedRoles',v_roles,'enabled',v_enabled));
 end loop;
 return v_result;
end; $$;

create or replace function tap_hub_project.create_billing_manual_confirmation(p_id uuid,p_client_service_id uuid,p_confirmed_date date,p_source_note text,p_reason text,p_actor uuid)
returns jsonb language plpgsql security definer set search_path=tap_hub_project,public as $$
declare v_client uuid; v_code text; v_description text; v_candidate uuid; v_existing billing_manual_confirmations%rowtype; v_price record; v_map boolean;
begin
 if p_id is null or p_client_service_id is null or p_confirmed_date is null or p_actor is null or nullif(btrim(p_source_note),'') is null or length(btrim(p_source_note))>2000 or nullif(btrim(p_reason),'') is null or length(btrim(p_reason))>1000 then
   raise exception 'invalid_input: sourceNote and reason are required' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into v_existing from billing_manual_confirmations where id=p_id;
 if found then
   if v_existing.client_service_id<>p_client_service_id or v_existing.confirmed_date<>p_confirmed_date or v_existing.source_note<>btrim(p_source_note) or v_existing.reason<>btrim(p_reason) then
     raise exception 'duplicate_resource: idempotency key was used for different confirmation data' using errcode='23505',constraint='billing_manual_confirmation_idempotency';
   end if;
   return jsonb_build_object('created',false,'candidateId',v_existing.candidate_id,'confirmationId',v_existing.id);
 end if;
 select cs.client_id,s.name,s.code into v_client,v_description,v_code
 from client_services cs join services s on s.id=cs.service_id where cs.id=p_client_service_id and cs.active;
 if not found then raise exception 'not_found: active client service does not exist' using errcode='P0002'; end if;
 select exists(select 1 from billing_completion_source_maps where client_service_id=p_client_service_id and adapter='manual_confirmation' and enabled and p_confirmed_date between effective_from and coalesce(effective_to,'infinity'::date)) into v_map;
 if not v_map then raise exception 'source_map_missing: no active manual confirmation rule for date' using errcode='P0001'; end if;
 select * into v_price from resolve_billing_price(p_client_service_id,v_client,v_code,'service',p_confirmed_date) limit 1;
 perform set_config('tap_hub.actor_id',p_actor::text,true);
 insert into billing_candidates(client_id,client_service_id,candidate_type,source_adapter,source_identity,period,candidate_date,description,state,service_code,unit,unit_amount,price_source,created_by,updated_by)
 values(v_client,p_client_service_id,'completion','manual_confirmation',p_id::text,to_char(p_confirmed_date,'YYYY-MM'),p_confirmed_date,v_description,case when v_price.unit_amount is null then 'unpriced' else 'open' end,v_code,'service',v_price.unit_amount,v_price.price_source,p_actor,p_actor)
 returning id into v_candidate;
 insert into billing_manual_confirmations(id,client_service_id,confirmed_date,source_note,candidate_id,created_by,reason)
 values(p_id,p_client_service_id,p_confirmed_date,btrim(p_source_note),v_candidate,p_actor,btrim(p_reason));
 return jsonb_build_object('created',true,'candidateId',v_candidate,'confirmationId',p_id);
end; $$;

-- Effective ranges for one identity may not overlap. Serialize concurrent writes per identity.
create or replace function tap_hub_project.guard_billing_effective_range() returns trigger language plpgsql set search_path=tap_hub_project,public as $$
declare v_conflict boolean;
begin
 if tg_table_name='billing_rate_card_entries' then
   perform pg_advisory_xact_lock(hashtext('rate:'||new.service_code||':'||new.unit));
   select exists(select 1 from billing_rate_card_entries x where x.id is distinct from new.id and x.service_code=new.service_code and x.unit=new.unit and daterange(x.effective_from,coalesce(x.effective_to,'infinity'::date),'[]') && daterange(new.effective_from,coalesce(new.effective_to,'infinity'::date),'[]')) into v_conflict;
 elsif tg_table_name='billing_client_service_overrides' then
   perform pg_advisory_xact_lock(hashtext('override:'||new.client_service_id));
   select exists(select 1 from billing_client_service_overrides x where x.id is distinct from new.id and x.client_service_id=new.client_service_id and daterange(x.effective_from,coalesce(x.effective_to,'infinity'::date),'[]') && daterange(new.effective_from,coalesce(new.effective_to,'infinity'::date),'[]')) into v_conflict;
 elsif tg_table_name='billing_completion_source_maps' then
   perform pg_advisory_xact_lock(hashtext('map:'||new.client_service_id));
   select exists(select 1 from billing_completion_source_maps x where x.id is distinct from new.id and x.client_service_id=new.client_service_id and daterange(x.effective_from,coalesce(x.effective_to,'infinity'::date),'[]') && daterange(new.effective_from,coalesce(new.effective_to,'infinity'::date),'[]')) into v_conflict;
 elsif tg_table_name='billing_terms_overrides' then
   perform pg_advisory_xact_lock(hashtext('terms:'||new.client_id||':'||coalesce(new.client_service_id::text,'firm')));
   select exists(select 1 from billing_terms_overrides x where x.id is distinct from new.id and x.client_id=new.client_id and x.client_service_id is not distinct from new.client_service_id and daterange(x.effective_from,coalesce(x.effective_to,'infinity'::date),'[]') && daterange(new.effective_from,coalesce(new.effective_to,'infinity'::date),'[]')) into v_conflict;
 elsif tg_table_name='billing_bundles' then
   perform pg_advisory_xact_lock(hashtext('bundle:'||coalesce(new.client_id::text,'*')||':'||new.name));
   perform pg_advisory_xact_lock(hashtext('bundle-component:'||component.client_service_id)) from billing_bundle_components component where component.bundle_id=new.id;
   select
     exists(select 1 from billing_bundles x where x.id is distinct from new.id and x.client_id is not distinct from new.client_id and x.name=new.name and daterange(x.effective_from,coalesce(x.effective_to,'infinity'::date),'[]') && daterange(new.effective_from,coalesce(new.effective_to,'infinity'::date),'[]'))
     or exists(select 1 from billing_bundle_components mine join billing_bundle_components other on other.client_service_id=mine.client_service_id join billing_bundles x on x.id=other.bundle_id
       where mine.bundle_id=new.id and x.id is distinct from new.id and x.client_id is not distinct from new.client_id and daterange(x.effective_from,coalesce(x.effective_to,'infinity'::date),'[]') && daterange(new.effective_from,coalesce(new.effective_to,'infinity'::date),'[]'))
     into v_conflict;
 else return new; end if;
 if v_conflict then raise exception 'effective date overlap' using errcode='23505', constraint='billing_effective_date_overlap'; end if;
 return new;
end; $$;
create trigger billing_rate_entry_range before insert or update on tap_hub_project.billing_rate_card_entries for each row execute function tap_hub_project.guard_billing_effective_range();
create trigger billing_client_override_range before insert or update on tap_hub_project.billing_client_service_overrides for each row execute function tap_hub_project.guard_billing_effective_range();
create trigger billing_source_map_range before insert or update on tap_hub_project.billing_completion_source_maps for each row execute function tap_hub_project.guard_billing_effective_range();
create trigger billing_terms_override_range before insert or update on tap_hub_project.billing_terms_overrides for each row execute function tap_hub_project.guard_billing_effective_range();
create trigger billing_bundle_range before insert or update on tap_hub_project.billing_bundles for each row execute function tap_hub_project.guard_billing_effective_range();
create or replace function tap_hub_project.guard_billing_bundle_component_range() returns trigger language plpgsql set search_path=tap_hub_project,public as $$
declare v_conflict boolean; v_client uuid; v_from date; v_to date;
begin
 select client_id,effective_from,effective_to into v_client,v_from,v_to from billing_bundles where id=new.bundle_id;
 if not found then raise exception 'bundle not found' using errcode='23503'; end if;
 perform pg_advisory_xact_lock(hashtext('bundle-component:'||new.client_service_id));
 select exists(select 1 from billing_bundle_components other join billing_bundles ob on ob.id=other.bundle_id
   where other.client_service_id=new.client_service_id and other.id is distinct from new.id and ob.client_id is not distinct from v_client
   and ob.id<>new.bundle_id and daterange(ob.effective_from,coalesce(ob.effective_to,'infinity'::date),'[]') && daterange(v_from,coalesce(v_to,'infinity'::date),'[]')) into v_conflict;
 if v_conflict then raise exception 'effective date overlap' using errcode='23505',constraint='billing_effective_date_overlap'; end if;
 return new;
end; $$;
create trigger billing_bundle_component_range before insert or update on tap_hub_project.billing_bundle_components for each row execute function tap_hub_project.guard_billing_bundle_component_range();

create or replace function tap_hub_project.resolve_billing_price(p_client_service_id uuid,p_client_id uuid,p_service_code text,p_unit text,p_on date)
returns table(unit_amount numeric,price_source text,bundle_id uuid) language plpgsql stable security definer set search_path=tap_hub_project,public as $$
begin
 return query
 select b.unit_amount,'bundle'::text,b.id from billing_bundles b join billing_bundle_components bc on bc.bundle_id=b.id
 where b.active and b.client_id=p_client_id and bc.client_service_id=p_client_service_id and p_on between b.effective_from and coalesce(b.effective_to,'infinity'::date)
 order by b.effective_from desc,b.id limit 1;
 if found then return; end if;
 return query select o.unit_amount,'client_service_override'::text,null::uuid from billing_client_service_overrides o
 where o.client_service_id=p_client_service_id and p_on between o.effective_from and coalesce(o.effective_to,'infinity'::date) order by o.effective_from desc,o.id limit 1;
 if found then return; end if;
 return query select e.unit_amount,'rate_card'::text,null::uuid from billing_rate_card_entries e join billing_rate_cards c on c.id=e.rate_card_id and c.active
 where e.service_code=p_service_code and e.unit=p_unit and p_on between c.effective_from and coalesce(c.effective_to,'infinity'::date) and p_on between e.effective_from and coalesce(e.effective_to,'infinity'::date)
 order by e.effective_from desc,e.id limit 1;
end; $$;

create or replace function tap_hub_project.set_billing_bundle_components(p_bundle_id uuid,p_client_service_ids uuid[],p_actor uuid,p_reason text)
returns void language plpgsql security definer set search_path=tap_hub_project,public as $$
begin
 if nullif(btrim(p_reason),'') is null then raise exception 'invalid_input: reason required' using errcode='22023'; end if;
 perform 1 from billing_bundles where id=p_bundle_id for update;
 if not found then raise exception 'not_found: bundle does not exist' using errcode='P0002'; end if;
 if coalesce(cardinality(p_client_service_ids),0)<>(select count(distinct x) from unnest(coalesce(p_client_service_ids,'{}'::uuid[])) x) then raise exception 'invalid_input: duplicate bundle component' using errcode='22023'; end if;
 perform set_config('tap_hub.actor_id',p_actor::text,true);
 delete from billing_bundle_components where bundle_id=p_bundle_id;
 insert into billing_bundle_components(bundle_id,client_service_id,created_by)
 select p_bundle_id,x,p_actor from unnest(coalesce(p_client_service_ids,'{}'::uuid[])) x;
 perform record_billing_audit(p_actor,'replace','billing_bundle_components',p_bundle_id::text,jsonb_build_object('reason',btrim(p_reason),'client_service_ids',coalesce(p_client_service_ids,'{}'::uuid[])));
end; $$;

-- Protect all issued/candidate-linked line mutations in the database, not only HTTP routes.
create or replace function tap_hub_project.enforce_phase2_invoice_line_rules() returns trigger language plpgsql set search_path=tap_hub_project,public as $$
declare v_status text;
begin
 if tg_op='DELETE' then select status into v_status from invoices where id=old.invoice_id;
 else select status into v_status from invoices where id=new.invoice_id; end if;
 if tg_op='DELETE' and not found then return old; end if; -- parent-row cascade during draft invoice deletion
 if v_status is distinct from 'draft' then raise exception 'invariant_violation: invoice lines can only be changed while invoice is draft' using errcode='P0001'; end if;
 if tg_op='UPDATE' and exists(select 1 from billing_candidate_line_links where invoice_line_id=old.id and active) then
   raise exception 'candidate_linked_line_immutable' using errcode='P0001';
 end if;
 if tg_op='DELETE' then return old; else return new; end if;
end; $$;
drop trigger if exists billing_phase2_invoice_line_rules on tap_hub_project.invoice_lines;
create trigger billing_phase2_invoice_line_rules before insert or update or delete on tap_hub_project.invoice_lines for each row execute function tap_hub_project.enforce_phase2_invoice_line_rules();

create or replace function tap_hub_project.create_draft_from_candidates(p_candidate_ids uuid[],p_memo text,p_actor uuid)
returns uuid language plpgsql security definer set search_path=tap_hub_project,public as $$
declare v_client uuid; v_invoice uuid; v_count integer; g record; v_line uuid; v_bundle uuid; v_quantity numeric; v_unit numeric; v_description text; v_service uuid; v_period text;
begin
 if coalesce(array_length(p_candidate_ids,1),0)=0 then raise exception 'candidate_not_open: at least one candidate is required' using errcode='P0001'; end if;
 if cardinality(p_candidate_ids)<>(select count(distinct x) from unnest(p_candidate_ids) x) then raise exception 'candidate_not_open: duplicate candidate id' using errcode='P0001'; end if;
 perform 1 from billing_candidates where id=any(p_candidate_ids) order by id for update;
 select count(*),min(client_id::text)::uuid into v_count,v_client from billing_candidates where id=any(p_candidate_ids) and state='open' and unit_amount is not null;
 if v_count<>cardinality(p_candidate_ids) then
   if exists(select 1 from billing_candidates where id=any(p_candidate_ids) and unit_amount is null) then raise exception 'candidate_unpriced: candidate has no price' using errcode='P0001'; end if;
   raise exception 'candidate_not_open: candidates are unavailable' using errcode='P0001';
 end if;
 if (select count(distinct client_id) from billing_candidates where id=any(p_candidate_ids))<>1 then raise exception 'candidate_not_open: candidates must belong to one client' using errcode='P0001'; end if;
 if exists(
   select 1 from billing_candidates c
   join billing_bundles b on b.client_id=c.client_id and b.active and c.candidate_date between b.effective_from and coalesce(b.effective_to,'infinity'::date)
   join billing_bundle_components selected_component on selected_component.bundle_id=b.id and selected_component.client_service_id=c.client_service_id
   where c.id=any(p_candidate_ids) and (
     exists(select 1 from billing_bundle_components needed left join billing_candidates chosen
       on chosen.client_service_id=needed.client_service_id and chosen.candidate_date=c.candidate_date and chosen.id=any(p_candidate_ids) and chosen.state='open' and chosen.unit_amount is not null
       where needed.bundle_id=b.id and chosen.id is null)
     or exists(select 1 from billing_candidates duplicate join billing_bundle_components comp on comp.client_service_id=duplicate.client_service_id and comp.bundle_id=b.id
       where duplicate.id=any(p_candidate_ids) and duplicate.candidate_date=c.candidate_date and duplicate.client_service_id=c.client_service_id and duplicate.id<>c.id)
   )
 ) then raise exception 'candidate_not_open: select all open bundle components for the same date' using errcode='P0001'; end if;
 perform set_config('tap_hub.actor_id',p_actor::text,true);
 insert into invoices(client_id,invoice_number,status,issue_date,due_date,memo,created_by) values(v_client,null,'draft',null,null,p_memo,p_actor) returning id into v_invoice;
 for g in
   select c.id candidate_id,c.client_service_id,c.period,c.description,c.unit_amount,c.candidate_date,c.client_id,
     (select b.id from billing_bundles b join billing_bundle_components bc on bc.bundle_id=b.id where b.active and b.client_id=c.client_id and bc.client_service_id=c.client_service_id and c.candidate_date between b.effective_from and coalesce(b.effective_to,'infinity'::date) order by b.effective_from desc,b.id limit 1) bundle_id
   from billing_candidates c where c.id=any(p_candidate_ids) order by c.id
 loop
   v_bundle:=g.bundle_id;
   if v_bundle is null then v_quantity:=1; v_unit:=g.unit_amount; v_description:=g.description; v_service:=g.client_service_id; v_period:=g.period;
   else
     if exists(select 1 from billing_candidate_line_links l join invoice_lines il on il.id=l.invoice_line_id where l.candidate_id in (select c2.id from billing_candidates c2 join billing_bundle_components bc on bc.client_service_id=c2.client_service_id where bc.bundle_id=v_bundle and c2.id=any(p_candidate_ids) and c2.candidate_date=g.candidate_date) and il.invoice_id=v_invoice) then continue; end if;
     select b.unit_amount,b.name into v_unit,v_description from billing_bundles b where b.id=v_bundle;
     select min(c2.client_service_id::text)::uuid,min(c2.period) into v_service,v_period from billing_candidates c2 join billing_bundle_components bc on bc.client_service_id=c2.client_service_id where bc.bundle_id=v_bundle and c2.id=any(p_candidate_ids) and c2.candidate_date=g.candidate_date;
     v_quantity:=1;
   end if;
   insert into invoice_lines(invoice_id,client_service_id,period,description,quantity,unit_amount,amount,created_by)
   values(v_invoice,v_service,v_period,v_description,v_quantity,v_unit,round(v_quantity*v_unit,2),p_actor) returning id into v_line;
   if v_bundle is null then insert into billing_candidate_line_links(candidate_id,invoice_line_id,created_by) values(g.candidate_id,v_line,p_actor);
   else insert into billing_candidate_line_links(candidate_id,invoice_line_id,created_by) select c2.id,v_line,p_actor from billing_candidates c2 join billing_bundle_components bc on bc.client_service_id=c2.client_service_id where bc.bundle_id=v_bundle and c2.id=any(p_candidate_ids) and c2.candidate_date=g.candidate_date; end if;
 end loop;
 update billing_candidates set state='drafted',updated_by=p_actor,updated_at=now() where id=any(p_candidate_ids);
 return v_invoice;
end; $$;

create or replace function tap_hub_project.issue_billing_invoice(p_invoice_id uuid,p_actor uuid)
returns uuid language plpgsql security definer set search_path=tap_hub_project,public as $$
declare v_invoice invoices%rowtype; v_today date; v_year integer; v_no integer; v_days integer; v_snapshot jsonb;
begin
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

create or replace function tap_hub_project.delete_draft_invoice(p_invoice_id uuid,p_actor uuid) returns boolean language plpgsql security definer set search_path=tap_hub_project,public as $$
declare v_status text;
begin
 select status into v_status from invoices where id=p_invoice_id for update;
 if not found then raise exception 'not_found: invoice does not exist' using errcode='P0002'; end if;
 if v_status<>'draft' then raise exception 'conflict: only draft invoices can be deleted' using errcode='P0001'; end if;
 perform set_config('tap_hub.actor_id',p_actor::text,true);
 update billing_candidates c set state=case when c.unit_amount is null then 'unpriced' else 'open' end,updated_by=p_actor,updated_at=now()
 from billing_candidate_line_links l join invoice_lines il on il.id=l.invoice_line_id where l.candidate_id=c.id and il.invoice_id=p_invoice_id;
 update billing_candidate_line_links l set active=false where l.active and l.invoice_line_id in(select id from invoice_lines where invoice_id=p_invoice_id);
 delete from invoices where id=p_invoice_id;
 return true;
end; $$;

create or replace function tap_hub_project.delete_draft_invoice_line(p_line_id uuid,p_actor uuid) returns boolean language plpgsql security definer set search_path=tap_hub_project,public as $$
declare v_invoice uuid;
begin
 select invoice_id into v_invoice from invoice_lines where id=p_line_id for update;
 if not found then raise exception 'not_found: invoice line does not exist' using errcode='P0002'; end if;
 if not exists(select 1 from invoices where id=v_invoice and status='draft' for update) then raise exception 'conflict: invoice lines can only be deleted while invoice is draft' using errcode='P0001'; end if;
 perform set_config('tap_hub.actor_id',p_actor::text,true);
 update billing_candidates c set state=case when c.unit_amount is null then 'unpriced' else 'open' end,updated_by=p_actor,updated_at=now() from billing_candidate_line_links l where l.candidate_id=c.id and l.invoice_line_id=p_line_id;
 update billing_candidate_line_links set active=false where invoice_line_id=p_line_id and active;
 delete from invoice_lines where id=p_line_id;
 return true;
end; $$;

-- New Billing-owned tables are private; server routes use service_role after action authorization.
do $$ declare t text; begin
 foreach t in array array['billing_invoice_sequences','billing_action_policy','billing_rate_cards','billing_rate_card_entries','billing_client_service_overrides','billing_bundles','billing_bundle_components','billing_terms_settings','billing_terms_overrides','billing_remittance_settings','billing_completion_source_maps','billing_candidates','billing_manual_confirmations','billing_candidate_line_links'] loop
   execute format('alter table tap_hub_project.%I enable row level security',t);
   execute format('grant select,insert,update,delete on tap_hub_project.%I to service_role',t);
 end loop;
end $$;
grant usage on schema tap_hub_project to service_role;
revoke all on function tap_hub_project.resolve_billing_price(uuid,uuid,text,text,date) from public,anon,authenticated;
revoke all on function tap_hub_project.billing_firm_today(timestamptz) from public,anon,authenticated;
revoke all on function tap_hub_project.billing_period_end(date) from public,anon,authenticated;
revoke all on function tap_hub_project.create_draft_from_candidates(uuid[],text,uuid) from public,anon,authenticated;
revoke all on function tap_hub_project.issue_billing_invoice(uuid,uuid) from public,anon,authenticated;
revoke all on function tap_hub_project.void_billing_invoice(uuid,text,uuid) from public,anon,authenticated;
revoke all on function tap_hub_project.set_billing_bundle_components(uuid,uuid[],uuid,text) from public,anon,authenticated;
revoke all on function tap_hub_project.set_billing_action_policies(jsonb,uuid,text) from public,anon,authenticated;
revoke all on function tap_hub_project.create_billing_manual_confirmation(uuid,uuid,date,text,text,uuid) from public,anon,authenticated;
grant execute on function tap_hub_project.resolve_billing_price(uuid,uuid,text,text,date) to service_role;
grant execute on function tap_hub_project.billing_firm_today(timestamptz) to service_role;
grant execute on function tap_hub_project.billing_period_end(date) to service_role;
grant execute on function tap_hub_project.create_draft_from_candidates(uuid[],text,uuid) to service_role;
grant execute on function tap_hub_project.issue_billing_invoice(uuid,uuid) to service_role;
grant execute on function tap_hub_project.void_billing_invoice(uuid,text,uuid) to service_role;
grant execute on function tap_hub_project.set_billing_bundle_components(uuid,uuid[],uuid,text) to service_role;
grant execute on function tap_hub_project.set_billing_action_policies(jsonb,uuid,text) to service_role;
grant execute on function tap_hub_project.create_billing_manual_confirmation(uuid,uuid,date,text,text,uuid) to service_role;
commit;
