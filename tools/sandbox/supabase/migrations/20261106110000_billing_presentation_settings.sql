-- Phase 3 firm-facing invoice presentation metadata. This is not remittance,
-- numbering-sequence, email-delivery, or payment-processing configuration.
begin;

create table tap_hub_project.billing_presentation_settings (
  id text primary key default 'singleton' check (id = 'singleton'),
  singleton boolean not null unique default true check (singleton),
  firm_name text not null default 'TAP Associates, LLC' check (length(btrim(firm_name)) between 1 and 160),
  tagline text check (tagline is null or length(tagline) <= 500),
  invoice_footer text check (invoice_footer is null or length(invoice_footer) <= 500),
  updated_by uuid references tap_hub_project.profiles(id),
  updated_at timestamptz not null default now(),
  reason text not null check (length(btrim(reason)) between 1 and 1000)
);

insert into tap_hub_project.billing_presentation_settings(singleton, firm_name, reason)
values (true, 'TAP Associates, LLC', 'Phase 3 presentation settings initialization');

alter table tap_hub_project.billing_presentation_settings enable row level security;
revoke all on tap_hub_project.billing_presentation_settings from public, anon, authenticated;
grant select, insert, update, delete on tap_hub_project.billing_presentation_settings to service_role;

create trigger billing_audit_billing_presentation_settings
after insert or update or delete on tap_hub_project.billing_presentation_settings
for each row execute function tap_hub_project.audit_billing_row();

-- A set-based, side-effect-free projection for the firm-wide schedule. Source
-- maps and the Operations facts are joined in one database statement; unlike
-- candidate generation this never writes candidates or audit rows.
create or replace function tap_hub_project.project_billing_firm_schedule(
  p_from date, p_to date, p_limit integer default 50,
  p_after_date date default null, p_after_client text default null,
  p_after_service uuid default null, p_after_identity text default null
) returns jsonb language sql stable security definer
set search_path = tap_hub_project, public as $$
with service_data as materialized (
  select cs.id client_service_id, cs.client_id, cs.frequency, cs.financials_month,
    s.code service_code, s.name service_name, cl.name client_name
  from client_services cs join services s on s.id=cs.service_id
  join clients cl on cl.id=cs.client_id
  where cs.active
), maps as materialized (
  select m.* from billing_completion_source_maps m
  join service_data sd on sd.client_service_id=m.client_service_id
  where m.enabled and m.effective_from<=p_to and coalesce(m.effective_to,'infinity'::date)>=p_from
    and m.adapter<>'manual_confirmation'
), source_rows as (
  select m.client_service_id, m.adapter, 'recurring'::text candidate_type,
    to_char(month_start,'YYYY-MM') period,
    (month_start + interval '1 month - 1 day')::date candidate_date,
    m.client_service_id::text||':'||to_char(month_start,'YYYY-MM') source_identity
  from maps m join service_data sd using(client_service_id)
  cross join lateral generate_series(date_trunc('month',p_from)::date,date_trunc('month',p_to)::date,interval '1 month') month_start
  where m.adapter='schedule'
    and (lower(btrim(sd.frequency))='monthly'
      or (lower(btrim(sd.frequency))='quarterly' and extract(month from month_start)::int in (1,4,7,10))
      or (lower(btrim(sd.frequency)) in ('annual','yearly') and extract(month from month_start)::int=case when sd.financials_month between 1 and 12 then sd.financials_month else 12 end))
    and (month_start + interval '1 month - 1 day')::date between p_from and p_to
    and (month_start + interval '1 month - 1 day')::date between m.effective_from and coalesce(m.effective_to,'infinity'::date)
  union all
  select m.client_service_id,m.adapter,'completion',
    lpad(parts[1],4,'0')||'-'||lpad(parts[2],2,'0'),
    case when m.candidate_date_rule='completion_date' then (wp.done_at at time zone 'America/Chicago')::date
      else (make_date(parts[1]::int,parts[2]::int,1)+interval '1 month - 1 day')::date end,
    m.client_service_id::text||':'||lpad(parts[1],4,'0')||'-'||lpad(parts[2],2,'0')
  from maps m join work_periods wp on wp.client_service_id=m.client_service_id
  cross join lateral regexp_match(wp.period::text,'^(\d{4})-?(\d{2})$') parts
  where m.adapter='work_period_done' and wp.stage='done'
    and parts[1]::int between 1900 and 9999 and parts[2]::int between 1 and 12
    and (m.candidate_date_rule='completion_date' or ((make_date(parts[1]::int,parts[2]::int,1)+interval '1 month - 1 day')::date between p_from and p_to))
    and (case when m.candidate_date_rule='completion_date' then (wp.done_at at time zone 'America/Chicago')::date
      else (make_date(parts[1]::int,parts[2]::int,1)+interval '1 month - 1 day')::date end) between p_from and p_to
    and (case when m.candidate_date_rule='completion_date' then (wp.done_at at time zone 'America/Chicago')::date
      else (make_date(parts[1]::int,parts[2]::int,1)+interval '1 month - 1 day')::date end) between m.effective_from and coalesce(m.effective_to,'infinity'::date)
  union all
  select m.client_service_id,m.adapter,'completion',
    lpad(parts[1],4,'0')||'-'||lpad(parts[2],2,'0'),
    (make_date(parts[1]::int,parts[2]::int,1)+interval '1 month - 1 day')::date,
    m.client_service_id::text||':'||lpad(parts[1],4,'0')||'-'||lpad(parts[2],2,'0')
  from maps m join period_counts pc on pc.client_service_id=m.client_service_id
  cross join lateral regexp_match(pc.period::text,'^(\d{4})-?(\d{2})$') parts
  where m.adapter='period_count_threshold' and coalesce(m.predicate->>'threshold','') ~ '^\d+$'
    and pc.processed >= (m.predicate->>'threshold')::int
    and parts[1]::int between 1900 and 9999 and parts[2]::int between 1 and 12
    and (make_date(parts[1]::int,parts[2]::int,1)+interval '1 month - 1 day')::date between p_from and p_to
    and (make_date(parts[1]::int,parts[2]::int,1)+interval '1 month - 1 day')::date between m.effective_from and coalesce(m.effective_to,'infinity'::date)
), unique_sources as (
  select distinct sr.* from source_rows sr
  where not exists(select 1 from billing_candidates bc where bc.client_service_id=sr.client_service_id and bc.candidate_type=sr.candidate_type and bc.source_identity=sr.source_identity)
), priced as (
  select us.*,sd.client_id,sd.client_name,sd.service_code,sd.service_name,
    price.unit_amount,price.price_source,price.bundle_id
  from unique_sources us join service_data sd using(client_service_id)
  left join lateral (select * from resolve_billing_price(us.client_service_id,sd.client_id,sd.service_code,'service',us.candidate_date) limit 1) price on true
), projected as (
  select client_id,client_name,client_service_id,service_code,service_name,candidate_date,period,
    service_name description,'service'::text unit,unit_amount,price_source,
    case when unit_amount is null then 'unpriced' else 'priced' end price_state,
    adapter source_adapter,source_identity,bundle_id
  from priced where bundle_id is null
  union all
  select (array_agg(p.client_id order by p.client_service_id))[1],min(p.client_name),(array_agg(p.client_service_id order by p.client_service_id))[1],min(p.service_code),min(b.name),p.candidate_date,
    min(p.period),min(b.name),'service',max(p.unit_amount),max(p.price_source),'priced',min(p.adapter),
    'bundle:'||p.bundle_id::text||':'||p.candidate_date::text,p.bundle_id
  from priced p join billing_bundles b on b.id=p.bundle_id
  group by p.bundle_id,p.candidate_date
), totals as (
  select count(*)::int candidate_count,count(*) filter(where unit_amount is not null)::int priced_count,
    count(*) filter(where unit_amount is null)::int unpriced_count,
    coalesce(sum(unit_amount) filter(where unit_amount is not null),0)::numeric(18,2) projected_amount
  from projected
), page as (
  select * from projected p where p_after_date is null
    or (p.candidate_date,p.client_name,p.client_service_id,p.source_identity)>(p_after_date,p_after_client,p_after_service,p_after_identity)
  order by candidate_date,client_name,client_service_id,source_identity limit least(greatest(p_limit,1),101)
)
select jsonb_build_object(
  'items',coalesce((select jsonb_agg(jsonb_build_object(
    'clientId',client_id,'clientName',client_name,'clientServiceId',client_service_id,'serviceCode',service_code,
    'serviceName',service_name,'candidateDate',candidate_date,'period',period,'description',description,
    'unit',unit,'unitAmount',unit_amount::numeric(12,2)::text,'priceState',price_state,
    'sourceAdapter',source_adapter,'sourceIdentity',source_identity
  ) order by candidate_date,client_name,client_service_id,source_identity) from (select * from page limit least(greatest(p_limit,1),100)) p),'[]'::jsonb),
  'hasMore',(select count(*)>least(greatest(p_limit,1),100) from page),
  'summary',jsonb_build_object('candidateCount',(select candidate_count from totals),'pricedCount',(select priced_count from totals),
    'unpricedCount',(select unpriced_count from totals),'projectedAmount',(select projected_amount::text from totals))
);
$$;

revoke all on function tap_hub_project.project_billing_firm_schedule(date,date,integer,date,text,uuid,text) from public,anon,authenticated;
grant execute on function tap_hub_project.project_billing_firm_schedule(date,date,integer,date,text,uuid,text) to service_role;

commit;
