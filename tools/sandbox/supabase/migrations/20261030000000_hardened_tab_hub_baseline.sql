-- TAB-HUB shared sandbox: reviewed schema-only bootstrap.
-- Generated from the owner-provided schema export after validation; do not edit
-- generated body manually. See tools/sandbox/README.md for the approval flow.
--
-- The source snapshot's GRANT statements are intentionally excluded. The
-- explicit, deny-by-default privilege block at the end is authoritative.




SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "tap_hub_project";


ALTER SCHEMA "tap_hub_project" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "tap_hub_project"."allocate_payment"("p_payment_id" "uuid", "p_invoice_id" "uuid", "p_amount" numeric, "p_created_by" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'tap_hub_project', 'public'
    AS $$
declare
  v_payment payments%rowtype;
  v_invoice invoices%rowtype;
  v_payment_used numeric(12,2);
  v_invoice_used numeric(12,2);
  v_allocation_id uuid;
begin
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'invalid_input: allocation amount must be positive and have at most two decimals'
      using errcode = '22023';
  end if;

  select * into v_payment from payments where id = p_payment_id for update;
  if not found then
    raise exception 'not_found: payment does not exist' using errcode = 'P0002';
  end if;
  if v_payment.status <> 'recorded' then
    raise exception 'invariant_violation: payment is not available' using errcode = 'P0001';
  end if;

  select * into v_invoice from invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'not_found: invoice does not exist' using errcode = 'P0002';
  end if;
  if v_invoice.status <> 'issued' then
    raise exception 'invariant_violation: only issued invoices can be allocated' using errcode = 'P0001';
  end if;
  if v_payment.client_id <> v_invoice.client_id then
    raise exception 'invariant_violation: payment and invoice belong to different clients' using errcode = 'P0001';
  end if;

  select coalesce(sum(amount), 0) into v_payment_used
    from payment_allocations where payment_id = p_payment_id and reversed_at is null;
  select coalesce(sum(amount), 0) into v_invoice_used
    from payment_allocations where invoice_id = p_invoice_id and reversed_at is null;

  if v_payment_used + p_amount > v_payment.amount then
    raise exception 'invariant_violation: payment would be over-allocated' using errcode = 'P0001';
  end if;
  if v_invoice_used + p_amount > coalesce((select sum(amount) from invoice_lines where invoice_id = p_invoice_id), 0) then
    raise exception 'invariant_violation: invoice would be over-allocated' using errcode = 'P0001';
  end if;

  insert into payment_allocations(payment_id, invoice_id, amount, created_by)
  values (p_payment_id, p_invoice_id, p_amount, p_created_by)
  returning id into v_allocation_id;
  return v_allocation_id;
end;
$$;


ALTER FUNCTION "tap_hub_project"."allocate_payment"("p_payment_id" "uuid", "p_invoice_id" "uuid", "p_amount" numeric, "p_created_by" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "tap_hub_project"."approve_collection_event"("p_event_id" "uuid", "p_event_type" "text", "p_actor" "uuid", "p_detail" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'tap_hub_project', 'public'
    AS $$
declare v_source collection_events%rowtype; v_event_id uuid;
begin
  perform set_config('tap_hub.actor_id', p_actor::text, true);
  select * into v_source from collection_events where id = p_event_id;
  if not found then raise exception 'not_found: source event does not exist' using errcode = 'P0002'; end if;
  perform 1 from clients where id = v_source.client_id for update;
  select * into v_source from collection_events where id = p_event_id for update;
  if (v_source.event_type = 'escalation_requested' and p_event_type <> 'escalated')
     or (v_source.event_type = 'formal_notice_requested' and p_event_type <> 'formal_notice_approved')
     or v_source.event_type not in ('escalation_requested', 'formal_notice_requested') then
    raise exception 'conflict: approval event does not match a pending request' using errcode = 'P0001';
  end if;
  if exists (select 1 from collection_events where approves_event_id = p_event_id) then
    raise exception 'conflict: source request has already been approved' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from collection_holds h where h.client_id = v_source.client_id and h.released_at is null
      and (h.expires_on is null or h.expires_on >= collections_firm_today())
      and (h.invoice_id is null or h.invoice_id = v_source.invoice_id)
  ) then raise exception 'conflict: action blocked by an active Collections hold' using errcode = 'P0001'; end if;
  insert into collection_events(client_id, invoice_id, event_type, actor, detail, approves_event_id)
  values (v_source.client_id, v_source.invoice_id, p_event_type, p_actor, coalesce(p_detail, '{}'::jsonb), p_event_id)
  returning id into v_event_id;
  return v_event_id;
end; $$;


ALTER FUNCTION "tap_hub_project"."approve_collection_event"("p_event_id" "uuid", "p_event_type" "text", "p_actor" "uuid", "p_detail" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "tap_hub_project"."audit_billing_row"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'tap_hub_project', 'public'
    AS $$
declare
  v_old jsonb;
  v_new jsonb;
  v_actor uuid;
  v_id text;
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
  insert into tap_hub_project.audit_log(actor, action, entity, entity_id, detail)
  values (
    v_actor,
    lower(tg_op),
    v_entity,
    v_id,
    jsonb_build_object('old', v_old, 'new', v_new)
  );
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;


ALTER FUNCTION "tap_hub_project"."audit_billing_row"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "tap_hub_project"."collections_firm_today"() RETURNS "date"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'tap_hub_project', 'public'
    AS $$
  select (statement_timestamp() at time zone coalesce(
    (select nullif(timezone, '') from collection_settings where id = 'default'),
    'America/Chicago'
  ))::date;
$$;


ALTER FUNCTION "tap_hub_project"."collections_firm_today"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "tap_hub_project"."collections_invoice_stage_context"("p_client_id" "uuid", "p_invoice_id" "uuid", "p_due_date" "date", "p_as_of_date" "date") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'tap_hub_project', 'public'
    AS $$
declare
  v_as_of date := coalesce(p_as_of_date, collections_firm_today());
  v_timezone text;
  v_days integer;
  v_completed integer := 0;
  v_current integer := 0;
  v_next integer;
  v_pending jsonb;
begin
  select coalesce(nullif(timezone, ''), 'America/Chicago') into v_timezone
  from collection_settings where id = 'default';
  v_timezone := coalesce(v_timezone, 'America/Chicago');
  v_days := greatest(v_as_of - p_due_date, 0);

  select coalesce(max(case
      when e.event_type = 'escalated' then 4
      when e.event_type in ('formal_notice_approved','formal_notice_sent') then 5
      when e.event_type = 'reminder_logged' then coalesce(least(coalesce(e.stage,
        (select max(r.stage) from collection_ladder_rules r
         where r.enabled and r.automatic
           and r.days_past_due <= greatest((e.occurred_at at time zone v_timezone)::date - p_due_date, 0))), 3), 0)
      else 0 end), 0)
    into v_completed
  from collection_events e
  where e.client_id = p_client_id
    and (e.invoice_id = p_invoice_id or
      (e.invoice_id is null and e.event_type in ('escalation_requested','escalated',
       'formal_notice_requested','formal_notice_approved','formal_notice_sent')
       and p_due_date <= (e.occurred_at at time zone v_timezone)::date))
    and (e.occurred_at at time zone v_timezone)::date <= v_as_of;

  select greatest(v_completed, coalesce(max(d.stage), 0)) into v_completed
  from collection_delivery_attempts d
  where d.invoice_id = p_invoice_id and d.status = 'sent';

  select coalesce(max(r.stage), 0) into v_current
  from collection_ladder_rules r where r.enabled and r.days_past_due <= v_days;

  select jsonb_build_object('event_id', q.id, 'event_type', q.event_type,
      'stage', case when q.event_type = 'escalation_requested' then 4 else 5 end,
      'requested_at', q.occurred_at)
    into v_pending
  from collection_events q
  where q.client_id = p_client_id
    and (q.invoice_id = p_invoice_id or (q.invoice_id is null and p_due_date <= (q.occurred_at at time zone v_timezone)::date))
    and q.event_type in ('escalation_requested','formal_notice_requested')
    and (q.occurred_at at time zone v_timezone)::date <= v_as_of
    and not exists (select 1 from collection_events a where a.approves_event_id = q.id)
  order by q.occurred_at desc limit 1;

  if v_pending is null then
    select min(r.stage) into v_next from collection_ladder_rules r
    where r.enabled and r.stage > v_completed and r.days_past_due <= v_days;
  end if;
  return jsonb_build_object('current_stage', v_current, 'next_stage', v_next,
    'awaiting_approval', v_pending);
end; $$;


ALTER FUNCTION "tap_hub_project"."collections_invoice_stage_context"("p_client_id" "uuid", "p_invoice_id" "uuid", "p_due_date" "date", "p_as_of_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "tap_hub_project"."delete_draft_invoice"("p_invoice_id" "uuid", "p_actor" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'tap_hub_project', 'public'
    AS $$
declare v_invoice invoices%rowtype;
begin
  select * into v_invoice from invoices where id = p_invoice_id for update;
  if not found then raise exception 'not_found: invoice does not exist' using errcode = 'P0002'; end if;
  if v_invoice.status <> 'draft' then raise exception 'conflict: only draft invoices can be deleted' using errcode = 'P0001'; end if;
  perform set_config('tap_hub.actor_id', p_actor::text, true);
  delete from invoices where id = p_invoice_id;
  return true;
end; $$;


ALTER FUNCTION "tap_hub_project"."delete_draft_invoice"("p_invoice_id" "uuid", "p_actor" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "tap_hub_project"."delete_draft_invoice_line"("p_line_id" "uuid", "p_actor" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'tap_hub_project', 'public'
    AS $$
declare v_line invoice_lines%rowtype; v_invoice invoices%rowtype;
begin
  select * into v_line from invoice_lines where id = p_line_id for update;
  if not found then raise exception 'not_found: invoice line does not exist' using errcode = 'P0002'; end if;
  select * into v_invoice from invoices where id = v_line.invoice_id for update;
  if not found or v_invoice.status <> 'draft' then raise exception 'conflict: invoice lines can only be deleted while invoice is draft' using errcode = 'P0001'; end if;
  perform set_config('tap_hub.actor_id', p_actor::text, true);
  delete from invoice_lines where id = p_line_id;
  return true;
end; $$;


ALTER FUNCTION "tap_hub_project"."delete_draft_invoice_line"("p_line_id" "uuid", "p_actor" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "tap_hub_project"."get_billing_invoice_balances"("p_as_of_date" "date" DEFAULT NULL::"date") RETURNS TABLE("invoice_id" "uuid", "client_id" "uuid", "invoice_number" "text", "status" "text", "issue_date" "date", "due_date" "date", "invoice_total" numeric, "allocated" numeric, "balance" numeric, "days_past_due" integer, "aging_bucket" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'tap_hub_project', 'public'
    AS $$
  with asof as (
    select coalesce(p_as_of_date, collections_firm_today()) as day
  ), totals as (
    select i.id, i.client_id, i.invoice_number, i.status, i.issue_date, i.due_date,
      coalesce(lines.total, 0)::numeric(18,2) as invoice_total,
      coalesce(allocations.total, 0)::numeric(18,2) as allocated
    from invoices i
    left join lateral (
      select sum(l.amount)::numeric(18,2) as total
      from invoice_lines l where l.invoice_id = i.id
    ) lines on true
    left join lateral (
      select sum(a.amount)::numeric(18,2) as total
      from payment_allocations a
      join payments p on p.id = a.payment_id and p.status = 'recorded'
      where a.invoice_id = i.id and a.reversed_at is null
    ) allocations on true
    where i.status = 'issued'
  ), balances as (
    select t.*, greatest(t.invoice_total - t.allocated, 0)::numeric(18,2) as balance,
      case when greatest(t.invoice_total - t.allocated, 0) <= 0 then 0
        else greatest((select day from asof) - t.due_date, 0)::integer end as days_past_due
    from totals t
  )
  select b.id, b.client_id, b.invoice_number, b.status, b.issue_date, b.due_date,
    b.invoice_total, b.allocated, b.balance, b.days_past_due,
    case when b.days_past_due = 0 then 'current' when b.days_past_due <= 30 then '1_30'
      when b.days_past_due <= 60 then '31_60' when b.days_past_due <= 90 then '61_90' else '90_plus' end
  from balances b;
$$;


ALTER FUNCTION "tap_hub_project"."get_billing_invoice_balances"("p_as_of_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "tap_hub_project"."get_billing_receivables"("p_client_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'tap_hub_project', 'public'
    AS $$
with invoice_rows as (
  select b.* from get_billing_invoice_balances(collections_firm_today()) b
  where p_client_id is null or b.client_id = p_client_id
), payment_balances as (
  select p.id as payment_id, p.client_id, p.amount::numeric(18,2) as amount,
    greatest(p.amount - coalesce(sum(a.amount) filter (where a.reversed_at is null), 0), 0)::numeric(18,2) as remaining
  from payments p left join payment_allocations a on a.payment_id = p.id
  where p.status = 'recorded' and (p_client_id is null or p.client_id = p_client_id)
  group by p.id
), aging as (
  select client_id,
    sum(balance) filter (where aging_bucket = 'current') as current_due,
    sum(balance) filter (where aging_bucket = '1_30') as d1_30,
    sum(balance) filter (where aging_bucket = '31_60') as d31_60,
    sum(balance) filter (where aging_bucket = '61_90') as d61_90,
    sum(balance) filter (where aging_bucket = '90_plus') as d90_plus
  from invoice_rows where balance > 0 group by client_id
), unallocated_clients as (
  select client_id, sum(remaining)::numeric(18,2) as amount
  from payment_balances group by client_id having sum(remaining) > 0
), client_universe as (
  select client_id from aging union select client_id from unallocated_clients
)
select jsonb_build_object(
  'as_of_date', collections_firm_today(),
  'receivables', coalesce((select jsonb_agg(jsonb_build_object(
    'id', invoice_id, 'client_id', client_id, 'invoice_number', invoice_number, 'status', status,
    'issue_date', issue_date, 'due_date', due_date, 'total', invoice_total::text,
    'allocated', allocated::text, 'balance', balance::text, 'days_past_due', days_past_due,
    'aging_bucket', aging_bucket
  ) order by due_date, invoice_number) from invoice_rows), '[]'::jsonb),
  'client_aging', coalesce((select jsonb_agg(jsonb_build_object(
    'client_id', u.client_id, 'current', coalesce(a.current_due, 0)::numeric(18,2)::text,
    '1_30', coalesce(a.d1_30, 0)::numeric(18,2)::text, '31_60', coalesce(a.d31_60, 0)::numeric(18,2)::text,
    '61_90', coalesce(a.d61_90, 0)::numeric(18,2)::text, '90_plus', coalesce(a.d90_plus, 0)::numeric(18,2)::text
  ) order by u.client_id) from client_universe u left join aging a using (client_id)), '[]'::jsonb),
  'unallocated_payment_balances', coalesce((select jsonb_agg(jsonb_build_object(
    'payment_id', payment_id, 'client_id', client_id, 'amount', amount::text, 'unallocated', remaining::text
  ) order by client_id, payment_id) from payment_balances), '[]'::jsonb),
  'unallocated_payments', coalesce((select jsonb_agg(jsonb_build_object('client_id', client_id, 'amount', amount::text) order by client_id) from unallocated_clients), '[]'::jsonb),
  'unallocated_by_client', coalesce((select jsonb_agg(jsonb_build_object('client_id', client_id, 'amount', amount::text) order by client_id) from unallocated_clients), '[]'::jsonb)
);
$$;


ALTER FUNCTION "tap_hub_project"."get_billing_receivables"("p_client_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "tap_hub_project"."get_collections_worklist"("p_client_id" "uuid" DEFAULT NULL::"uuid", "p_as_of_date" "date" DEFAULT NULL::"date", "p_limit" integer DEFAULT 100, "p_offset" integer DEFAULT 0) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'tap_hub_project', 'public'
    AS $$ select get_collections_worklist(p_client_id,p_as_of_date,p_limit,p_offset,'priority'); $$;


ALTER FUNCTION "tap_hub_project"."get_collections_worklist"("p_client_id" "uuid", "p_as_of_date" "date", "p_limit" integer, "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "tap_hub_project"."get_collections_worklist"("p_client_id" "uuid", "p_as_of_date" "date", "p_limit" integer, "p_offset" integer, "p_sort_order" "text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'tap_hub_project', 'public'
    AS $$
with base as (
  select get_collections_worklist_130(p_client_id,p_as_of_date,p_limit,p_offset,p_sort_order) as payload
), accounts as (
  select a.value as account, a.ordinality
  from base b cross join lateral jsonb_array_elements(coalesce(b.payload->'accounts','[]'::jsonb)) with ordinality a(value, ordinality)
), changed_accounts as (
  select account || jsonb_build_object('invoices', coalesce((
    select jsonb_agg(i.value || collections_invoice_stage_context(
      (account->>'client_id')::uuid, (i.value->>'invoice_id')::uuid,
      (i.value->>'due_date')::date, coalesce(p_as_of_date, (select (payload->>'as_of_date')::date from base)))
      order by i.ordinality)
    from jsonb_array_elements(coalesce(account->'invoices','[]'::jsonb)) with ordinality i(value, ordinality)
  ), '[]'::jsonb)) as account, ordinality
  from accounts
)
select payload || jsonb_build_object('accounts', coalesce((
  select jsonb_agg(account order by ordinality) from changed_accounts
), '[]'::jsonb)) from base;
$$;


ALTER FUNCTION "tap_hub_project"."get_collections_worklist"("p_client_id" "uuid", "p_as_of_date" "date", "p_limit" integer, "p_offset" integer, "p_sort_order" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "tap_hub_project"."get_collections_worklist_130"("p_client_id" "uuid", "p_as_of_date" "date", "p_limit" integer, "p_offset" integer, "p_sort_order" "text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'tap_hub_project', 'public'
    AS $$
with settings as (
  select * from collection_settings where id = 'default'
), asof as (
  select coalesce(p_as_of_date, collections_firm_today()) as day,
    coalesce((select minimum_balance from settings), 50::numeric) as minimum_balance,
    coalesce((select direct_escalation_threshold from settings), 5000::numeric) as direct_escalation_threshold,
    coalesce((select nullif(timezone, '') from settings), 'America/Chicago') as timezone
), invoice_balances as (
  select b.* from get_billing_invoice_balances((select day from asof)) b
  where (p_client_id is null or b.client_id = p_client_id) and b.balance > 0
), unallocated as (
  select p.client_id, sum(p.amount - coalesce(pa.used, 0))::numeric(18,2) as amount
  from payments p
  left join lateral (
    select sum(a.amount) as used from payment_allocations a
    where a.payment_id = p.id and a.reversed_at is null
  ) pa on true
  where p.status = 'recorded' and (p_client_id is null or p.client_id = p_client_id)
  group by p.client_id having sum(p.amount - coalesce(pa.used, 0)) > 0
), contacts as (
  select c.client_id,
    count(*) filter (where c.category = 'client' and c.is_primary)::integer as primary_count,
    max(c.name) filter (where c.category = 'client' and c.is_primary) as contact_name,
    max(c.email) filter (where c.category = 'client' and c.is_primary) as contact_email,
    max(c.phone) filter (where c.category = 'client' and c.is_primary) as contact_phone
  from tap_hub_project.contacts c group by c.client_id
), per_invoice as (
  select b.*,
    exists(select 1 from collection_holds h where h.client_id = b.client_id and h.released_at is null
      and (h.expires_on is null or h.expires_on >= (select day from asof))
      and (h.invoice_id is null or h.invoice_id = b.invoice_id)) as on_hold,
    coalesce((select max(case
      when e.event_type in ('escalation_requested','escalated') then 4
      when e.event_type in ('formal_notice_requested','formal_notice_approved','formal_notice_sent') then 5
      when e.event_type = 'reminder_logged' then least(coalesce(e.stage,
        (select max(r.stage) from collection_ladder_rules r
         where r.enabled and r.automatic
           and r.days_past_due <= greatest((e.occurred_at at time zone (select timezone from asof))::date - b.due_date, 0))), 3)
      else null end)
      from collection_events e where e.client_id = b.client_id
        and (e.invoice_id is null or e.invoice_id = b.invoice_id)
        and (e.occurred_at at time zone (select timezone from asof))::date <= (select day from asof)), 0) as last_stage,
    (select max(d.stage) from collection_delivery_attempts d where d.invoice_id = b.invoice_id and d.status = 'sent') as last_delivery_stage
  from invoice_balances b
), actions as (
  select pi.*,
    greatest(pi.last_stage, coalesce(pi.last_delivery_stage, 0)) as completed_stage,
    coalesce((select max(r.stage) from collection_ladder_rules r where r.enabled and r.days_past_due <= pi.days_past_due), 0) as current_stage,
    (select min(r.stage) from collection_ladder_rules r
     where r.enabled and r.stage > greatest(pi.last_stage, coalesce(pi.last_delivery_stage, 0))
       and r.days_past_due <= pi.days_past_due) as next_stage
  from per_invoice pi
), account_rows as (
  select c.id as client_id, c.name as client_name,
    coalesce(ct.primary_count,0) as primary_contact_count, ct.contact_name, ct.contact_email, ct.contact_phone,
    coalesce(u.amount,0)::numeric(18,2) as unallocated_credit,
    coalesce(bool_or(a.on_hold),false) as on_hold,
    count(a.invoice_id)::integer as open_invoice_count,
    coalesce(sum(a.balance),0)::numeric(18,2) as gross_open_balance,
    coalesce(sum(a.balance) filter(where a.aging_bucket='current'),0)::numeric(18,2) as current_balance,
    coalesce(sum(a.balance) filter(where a.aging_bucket='1_30'),0)::numeric(18,2) as days_1_30,
    coalesce(sum(a.balance) filter(where a.aging_bucket='31_60'),0)::numeric(18,2) as days_31_60,
    coalesce(sum(a.balance) filter(where a.aging_bucket='61_90'),0)::numeric(18,2) as days_61_90,
    coalesce(sum(a.balance) filter(where a.aging_bucket='90_plus'),0)::numeric(18,2) as days_over_90,
    coalesce(sum(a.balance) filter(where a.days_past_due between 21 and 30),0)::numeric(18,2) as score_21_30,
    coalesce(sum(a.balance) filter(where a.days_past_due between 31 and 60),0)::numeric(18,2) as score_31_60,
    coalesce(sum(a.balance) filter(where a.days_past_due between 61 and 90),0)::numeric(18,2) as score_61_90,
    coalesce(sum(a.balance) filter(where a.days_past_due between 91 and 180),0)::numeric(18,2) as score_91_180,
    coalesce(sum(a.balance) filter(where a.days_past_due > 180),0)::numeric(18,2) as score_over_180,
    coalesce(max(a.days_past_due),0)::integer as oldest_days_past_due,
    coalesce(sum(a.balance * case when a.days_past_due between 21 and 30 then 1.0
      when a.days_past_due between 31 and 60 then 1.3 when a.days_past_due between 61 and 90 then 1.6
      when a.days_past_due between 91 and 180 then 2.0 when a.days_past_due > 180 then 2.4 else 0 end),0)::numeric(18,2) as call_priority_score,
    coalesce(max(a.balance) filter(where a.balance >= (select direct_escalation_threshold from asof)),0)::numeric(18,2) as largest_high_balance_invoice,
    coalesce(jsonb_agg(jsonb_build_object(
      'invoice_id',a.invoice_id,'invoice_number',a.invoice_number,'issue_date',a.issue_date,'due_date',a.due_date,
      'invoice_total',a.invoice_total::text,'allocated',a.allocated::text,'balance',a.balance::text,
      'days_past_due',a.days_past_due,'current_stage',a.current_stage,'next_stage',a.next_stage,
      'on_hold',a.on_hold,'credit_review_required',coalesce(u.amount,0)>0,
      'contact_review_required',coalesce(ct.primary_count,0)<>1 or nullif(trim(coalesce(ct.contact_email,'')),'') is null,
      'below_minimum',a.balance < (select minimum_balance from asof)
    ) order by a.due_date,a.invoice_number) filter(where a.invoice_id is not null),'[]'::jsonb) as invoices
  from clients c left join contacts ct on ct.client_id=c.id left join unallocated u on u.client_id=c.id
  left join actions a on a.client_id=c.id
  where c.status='active' and (p_client_id is null or c.id=p_client_id)
  group by c.id,c.name,ct.primary_count,ct.contact_name,ct.contact_email,ct.contact_phone,u.amount
), filtered_accounts as (
  select * from account_rows where open_invoice_count>0 or unallocated_credit>0
), summary as (
  select coalesce(sum(gross_open_balance),0)::numeric(18,2) as gross_open,
    coalesce(sum(unallocated_credit),0)::numeric(18,2) as unallocated,
    coalesce(sum(current_balance),0)::numeric(18,2) as current_due,
    coalesce(sum(days_1_30),0)::numeric(18,2) as b1,coalesce(sum(days_31_60),0)::numeric(18,2) as b2,
    coalesce(sum(days_61_90),0)::numeric(18,2) as b3,coalesce(sum(days_over_90),0)::numeric(18,2) as b4,
    coalesce(sum(open_invoice_count),0)::integer as invoice_count,
    count(*) filter(where gross_open_balance>0)::integer as owing_accounts,
    count(*) filter(where unallocated_credit>0)::integer as credit_review_accounts,
    count(*) filter(where open_invoice_count>=3)::integer as chronic_accounts,
    coalesce(max(oldest_days_past_due),0)::integer as oldest_days
  from filtered_accounts
), page_accounts as (
  select * from filtered_accounts
  order by case when p_sort_order='stable' then client_id::text end,
    case when p_sort_order<>'stable' then call_priority_score end desc,
    case when p_sort_order<>'stable' then gross_open_balance end desc,client_name,client_id
  limit greatest(1,least(coalesce(p_limit,100),200)) offset greatest(coalesce(p_offset,0),0)
)
select jsonb_build_object(
  'as_of_date',(select day from asof),'currency','USD',
  'summary',jsonb_build_object('gross_open_balance',(select gross_open::text from summary),
    'unallocated_credit',(select unallocated::text from summary),
    'net_ar_estimate',((select gross_open-unallocated from summary))::text,
    'aging',jsonb_build_object('current',(select current_due::text from summary),'days_1_30',(select b1::text from summary),
      'days_31_60',(select b2::text from summary),'days_61_90',(select b3::text from summary),'days_over_90',(select b4::text from summary)),
    'open_invoice_count',(select invoice_count from summary),'owing_accounts',(select owing_accounts from summary),
    'credit_review_accounts',(select credit_review_accounts from summary),'chronic_accounts',(select chronic_accounts from summary),
    'oldest_days_past_due',(select oldest_days from summary)),
  'accounts',coalesce((select jsonb_agg(jsonb_build_object(
    'client_id',p.client_id,'client_name',p.client_name,'contact_name',p.contact_name,'contact_email',p.contact_email,
    'contact_phone',p.contact_phone,'primary_contact_count',p.primary_contact_count,
    'gross_open_balance',p.gross_open_balance::text,'unallocated_credit',p.unallocated_credit::text,
    'net_ar_estimate',(p.gross_open_balance-p.unallocated_credit)::text,'open_invoice_count',p.open_invoice_count,
    'oldest_days_past_due',p.oldest_days_past_due,
    'aging',jsonb_build_object('current',p.current_balance::text,'days_1_30',p.days_1_30::text,
      'days_31_60',p.days_31_60::text,'days_61_90',p.days_61_90::text,'days_over_90',p.days_over_90::text),
    'call_priority_score',p.call_priority_score::text,
    'priority_score_components',jsonb_build_object(
      '21_30',jsonb_build_object('balance',p.score_21_30::text,'weight','1.0','weighted_amount',p.score_21_30::text),
      '31_60',jsonb_build_object('balance',p.score_31_60::text,'weight','1.3','weighted_amount',(p.score_31_60*1.3)::numeric(18,2)::text),
      '61_90',jsonb_build_object('balance',p.score_61_90::text,'weight','1.6','weighted_amount',(p.score_61_90*1.6)::numeric(18,2)::text),
      '91_180',jsonb_build_object('balance',p.score_91_180::text,'weight','2.0','weighted_amount',(p.score_91_180*2.0)::numeric(18,2)::text),
      'over_180',jsonb_build_object('balance',p.score_over_180::text,'weight','2.4','weighted_amount',(p.score_over_180*2.4)::numeric(18,2)::text),
      'score_zero_before_days_past_due',21),
    'on_hold',p.on_hold,'credit_review_required',p.unallocated_credit>0,
    'contact_review_required',p.primary_contact_count<>1 or nullif(trim(coalesce(p.contact_email,'')),'') is null,
    'largest_high_balance_invoice',p.largest_high_balance_invoice::text,'invoices',p.invoices
  ) order by case when p_sort_order='stable' then p.client_id::text end,
    case when p_sort_order<>'stable' then p.call_priority_score end desc,
    case when p_sort_order<>'stable' then p.gross_open_balance end desc,p.client_name,p.client_id)
  from page_accounts p),'[]'::jsonb),
  'pagination',jsonb_build_object('limit',greatest(1,least(coalesce(p_limit,100),200)),
    'offset',greatest(coalesce(p_offset,0),0),'total_accounts',(select count(*) from filtered_accounts))
);
$$;


ALTER FUNCTION "tap_hub_project"."get_collections_worklist_130"("p_client_id" "uuid", "p_as_of_date" "date", "p_limit" integer, "p_offset" integer, "p_sort_order" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "tap_hub_project"."place_collection_hold"("p_client_id" "uuid", "p_invoice_id" "uuid", "p_reason" "text", "p_actor" "uuid", "p_expires_on" "date") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'tap_hub_project', 'public'
    AS $$
declare v_hold_id uuid;
begin
  perform set_config('tap_hub.actor_id', p_actor::text, true);
  perform 1 from clients where id = p_client_id for update;
  if not found then raise exception 'not_found: client does not exist' using errcode = 'P0002'; end if;
  if p_expires_on is not null and p_expires_on < collections_firm_today() then
    raise exception 'invalid_input: hold expiry cannot be in the past' using errcode = '22023';
  end if;
  if p_invoice_id is not null and not exists(select 1 from invoices where id = p_invoice_id and client_id = p_client_id) then
    raise exception 'invalid_input: hold invoice must belong to the selected client' using errcode = '22023';
  end if;
  insert into collection_holds(client_id, invoice_id, reason, placed_by, expires_on)
  values (p_client_id, p_invoice_id, p_reason, p_actor, p_expires_on) returning id into v_hold_id;
  insert into collection_events(client_id, invoice_id, event_type, actor, detail)
  values (p_client_id, p_invoice_id, 'hold_placed', p_actor, jsonb_build_object('hold_id', v_hold_id, 'reason', p_reason, 'expires_on', p_expires_on));
  return v_hold_id;
end; $$;


ALTER FUNCTION "tap_hub_project"."place_collection_hold"("p_client_id" "uuid", "p_invoice_id" "uuid", "p_reason" "text", "p_actor" "uuid", "p_expires_on" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "tap_hub_project"."record_billing_audit"("p_actor" "uuid", "p_action" "text", "p_entity" "text", "p_entity_id" "text" DEFAULT NULL::"text", "p_detail" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'tap_hub_project', 'public'
    AS $$
begin
  insert into tap_hub_project.audit_log(actor, action, entity, entity_id, detail)
  values (p_actor, p_action, p_entity, p_entity_id, coalesce(p_detail, '{}'::jsonb));
end;
$$;


ALTER FUNCTION "tap_hub_project"."record_billing_audit"("p_actor" "uuid", "p_action" "text", "p_entity" "text", "p_entity_id" "text", "p_detail" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "tap_hub_project"."record_collection_event"("p_client_id" "uuid", "p_invoice_id" "uuid", "p_event_type" "text", "p_actor" "uuid", "p_stage" integer DEFAULT NULL::integer, "p_detail" "jsonb" DEFAULT '{}'::"jsonb", "p_approval_event_id" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'tap_hub_project', 'public'
    AS $$
declare v_event_id uuid; v_approval collection_events%rowtype; v_stage integer := p_stage;
begin
  perform set_config('tap_hub.actor_id', p_actor::text, true);
  perform 1 from clients where id=p_client_id for update;
  if not found then raise exception 'not_found: client does not exist' using errcode='P0002'; end if;
  if p_event_type in ('hold_placed','hold_released','escalated','formal_notice_approved') then
    raise exception 'invalid_input: this event type is written only by its dedicated workflow' using errcode='22023';
  end if;
  if p_event_type not in ('note','reminder_logged','call_logged','promise_to_pay','escalation_requested','formal_notice_requested','formal_notice_sent') then
    raise exception 'invalid_input: unsupported Collections event type' using errcode='22023';
  end if;
  if p_event_type in ('escalation_requested','formal_notice_requested') and p_invoice_id is null then
    raise exception 'invalid_input: escalation and formal-notice requests require an invoice' using errcode='22023';
  end if;
  if p_invoice_id is not null and not exists(select 1 from invoices where id=p_invoice_id and client_id=p_client_id) then
    raise exception 'not_found: invoice does not belong to client' using errcode='P0002';
  end if;
  if p_event_type='reminder_logged' then
    if v_stage is not null and v_stage not between 1 and 3 then raise exception 'invalid_input: reminder stage must be 1, 2, or 3' using errcode='22023'; end if;
    if v_stage is null and p_invoice_id is not null then
      select max(r.stage) into v_stage from get_billing_invoice_balances(collections_firm_today()) b
      join collection_ladder_rules r on r.enabled and r.automatic and r.days_past_due<=b.days_past_due
      where b.invoice_id=p_invoice_id and b.client_id=p_client_id;
    end if;
  end if;
  if p_event_type in ('escalation_requested','formal_notice_requested') and exists(
    select 1 from collection_holds h where h.client_id=p_client_id and h.released_at is null
      and (h.expires_on is null or h.expires_on>=collections_firm_today())
      and (h.invoice_id is null or h.invoice_id=p_invoice_id)
  ) then raise exception 'conflict: action blocked by an active Collections hold' using errcode='P0001'; end if;
  if p_event_type='formal_notice_sent' then
    if p_approval_event_id is null then raise exception 'invalid_input: approved notice event is required' using errcode='22023'; end if;
    if nullif(trim(coalesce(p_detail->>'note','')),'') is null then raise exception 'invalid_input: add a note describing when and how the notice was sent' using errcode='22023'; end if;
    select * into v_approval from collection_events where id=p_approval_event_id for update;
    if not found or v_approval.event_type<>'formal_notice_approved' or v_approval.client_id<>p_client_id
       or v_approval.invoice_id is distinct from p_invoice_id then
      raise exception 'conflict: matching formal notice approval required' using errcode='P0001';
    end if;
    insert into collection_events(client_id,invoice_id,event_type,actor,detail)
    values(p_client_id,p_invoice_id,p_event_type,p_actor,coalesce(p_detail,'{}'::jsonb)||jsonb_build_object('approval_event_id',p_approval_event_id)) returning id into v_event_id;
  else
    insert into collection_events(client_id,invoice_id,event_type,stage,actor,detail)
    values(p_client_id,p_invoice_id,p_event_type,v_stage,p_actor,coalesce(p_detail,'{}'::jsonb)) returning id into v_event_id;
  end if;
  return v_event_id;
end; $$;


ALTER FUNCTION "tap_hub_project"."record_collection_event"("p_client_id" "uuid", "p_invoice_id" "uuid", "p_event_type" "text", "p_actor" "uuid", "p_stage" integer, "p_detail" "jsonb", "p_approval_event_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "tap_hub_project"."release_collection_hold"("p_hold_id" "uuid", "p_actor" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'tap_hub_project', 'public'
    AS $$
declare v_hold collection_holds%rowtype;
begin
  perform set_config('tap_hub.actor_id', p_actor::text, true);
  select * into v_hold from collection_holds where id = p_hold_id;
  if not found then raise exception 'conflict: active hold does not exist' using errcode = 'P0001'; end if;
  perform 1 from clients where id = v_hold.client_id for update;
  select * into v_hold from collection_holds where id = p_hold_id for update;
  if not found or v_hold.released_at is not null then raise exception 'conflict: active hold does not exist' using errcode = 'P0001'; end if;
  update collection_holds set released_by = p_actor, released_at = now() where id = p_hold_id;
  insert into collection_events(client_id, invoice_id, event_type, actor, detail)
  values (v_hold.client_id, v_hold.invoice_id, 'hold_released', p_actor, jsonb_build_object('hold_id', p_hold_id, 'reason', v_hold.reason));
  return p_hold_id;
end; $$;


ALTER FUNCTION "tap_hub_project"."release_collection_hold"("p_hold_id" "uuid", "p_actor" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "tap_hub_project"."reverse_payment"("p_payment_id" "uuid", "p_actor" "uuid", "p_reason" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'tap_hub_project', 'public'
    AS $$
declare v_payment payments%rowtype;
begin
  perform set_config('tap_hub.actor_id', p_actor::text, true);
  select * into v_payment from payments where id = p_payment_id for update;
  if not found then raise exception 'not_found: payment does not exist' using errcode = 'P0002'; end if;
  if v_payment.status <> 'recorded' then raise exception 'invariant_violation: payment is already reversed' using errcode = 'P0001'; end if;
  if exists(select 1 from payment_allocations where payment_id = p_payment_id and reversed_at is null) then
    raise exception 'invariant_violation: reverse active allocations before reversing this payment' using errcode = 'P0001';
  end if;
  update payments set status = 'reversed', reversed_by = p_actor, reversed_at = now(), reversal_reason = p_reason where id = p_payment_id;
end; $$;


ALTER FUNCTION "tap_hub_project"."reverse_payment"("p_payment_id" "uuid", "p_actor" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "tap_hub_project"."reverse_payment_allocation"("p_allocation_id" "uuid", "p_actor" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'tap_hub_project', 'public'
    AS $$
declare v_allocation payment_allocations%rowtype;
begin
  perform set_config('tap_hub.actor_id', p_actor::text, true);
  select * into v_allocation from payment_allocations where id = p_allocation_id for update;
  if not found then raise exception 'not_found: allocation does not exist' using errcode = 'P0002'; end if;
  if v_allocation.reversed_at is not null then raise exception 'invariant_violation: allocation is already reversed' using errcode = 'P0001'; end if;
  update payment_allocations set reversed_at = now(), reversed_by = p_actor where id = p_allocation_id;
end; $$;


ALTER FUNCTION "tap_hub_project"."reverse_payment_allocation"("p_allocation_id" "uuid", "p_actor" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "tap_hub_project"."support_ticket_messages_notify"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  update tap_hub_project_sync_20260915T170652Z.support_tickets t
     set last_activity_at = now(),
         first_response_at = case
           when new.author_type = 'agent' and t.first_response_at is null then now()
           else t.first_response_at
         end
   where t.id = new.ticket_id;
  return new;
end;
$$;


ALTER FUNCTION "tap_hub_project"."support_ticket_messages_notify"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "tap_hub_project"."support_tickets_maintain"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();

  if tg_op = 'INSERT' then
    new.last_activity_at = coalesce(new.last_activity_at, now());
    if new.status = 'closed' and new.closed_at is null then
      new.closed_at = now();
    end if;

  elsif tg_op = 'UPDATE' then
    -- Bump last activity only on a meaningful content/status change, not when
    -- the row is touched solely to update bookkeeping timestamps.
    if new.status is distinct from old.status
       or new.summary is distinct from old.summary
       or new.what_happened is distinct from old.what_happened
       or new.priority is distinct from old.priority
    then
      new.last_activity_at = now();
    end if;

    if new.status = 'closed' and old.status is distinct from 'closed' and new.closed_at is null then
      new.closed_at = now();
    elsif new.status is distinct from 'closed' and old.status = 'closed' then
      new.closed_at = null; -- reopened
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "tap_hub_project"."support_tickets_maintain"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "tap_hub_project"."annual_filing" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid",
    "state" "text",
    "company_name" "text",
    "due_date" "date",
    "website" "text",
    "contact_name" "text",
    "credential_id" "uuid",
    "cost" numeric,
    "notes" "text"
);


ALTER TABLE "tap_hub_project"."annual_filing" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "tap_hub_project"."audit_log" (
    "id" bigint NOT NULL,
    "actor" "uuid",
    "action" "text" NOT NULL,
    "entity" "text",
    "entity_id" "text",
    "detail" "jsonb",
    "at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "tap_hub_project"."audit_log" OWNER TO "postgres";


ALTER TABLE "tap_hub_project"."audit_log" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "tap_hub_project"."audit_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "tap_hub_project"."billing_periods" (
    "client_service_id" "uuid" NOT NULL,
    "period" "text" NOT NULL,
    "amount" numeric(10,2),
    "invoiced_at" timestamp with time zone,
    "paid_at" timestamp with time zone
);


ALTER TABLE "tap_hub_project"."billing_periods" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "tap_hub_project"."client_service_billing" (
    "client_service_id" "uuid" NOT NULL,
    "monthly_fee" numeric
);


ALTER TABLE "tap_hub_project"."client_service_billing" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "tap_hub_project"."client_services" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "service_id" "uuid" NOT NULL,
    "assigned_to" "uuid",
    "active" boolean DEFAULT true NOT NULL,
    "frequency" "text",
    "processor" "text",
    "software" "text",
    "started_on" "date",
    "ended_on" "date",
    "notes" "text",
    "expected_annual" integer,
    "financials_month" integer,
    "eftps" "text",
    "payroll_password" "text",
    "paydate" "text",
    "sales_tax_line_items" "jsonb" DEFAULT '[]'::"jsonb",
    "biweekly_code" "text",
    "pay_start_date" "text",
    "filing_state" "text",
    "filing_month" "text",
    "filing_type" "text",
    "comments" "jsonb" DEFAULT '[]'::"jsonb",
    "pay_emails" "text"[],
    "pay_period_frequency" "text",
    "reporting_method" "text",
    "payroll_category" "text",
    "qb_license" "text",
    "reporting_notes" "text",
    "due_month" "text",
    "return_type" "text",
    "reg_label" "text",
    "assigned_to_name" "text",
    "detail" "jsonb",
    "service_name" "text",
    "state_renewal" boolean,
    "renewal_state" "text",
    "renewal_due_month" "text",
    "renewal_due_day" "text",
    "renewal_identifiers" "text"
);


ALTER TABLE "tap_hub_project"."client_services" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "tap_hub_project"."client_tax_ids" (
    "client_id" "uuid" NOT NULL,
    "ein" "text",
    "ssn_last4" "text"
);


ALTER TABLE "tap_hub_project"."client_tax_ids" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "tap_hub_project"."clients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "type" "text" NOT NULL,
    "entity_type" "text",
    "group_owner" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "city" "text",
    "state" "text" DEFAULT 'TX'::"text",
    "zip" "text",
    "address" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone,
    "client_code" "text",
    "group_name" "text",
    "emails" "text",
    "phones" "text",
    "ein" "text",
    "key_name" "text",
    "active" boolean DEFAULT true,
    "active_updated_at" timestamp with time zone,
    "active_updated_by" "text"
);


ALTER TABLE "tap_hub_project"."clients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "tap_hub_project"."collection_delivery_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "invoice_id" "uuid" NOT NULL,
    "stage" smallint NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "attempt_count" integer DEFAULT 0 NOT NULL,
    "next_attempt_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "provider_message_id" "text",
    "recipient_hash" "text",
    "last_error_code" "text",
    "actor" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sent_at" timestamp with time zone,
    CONSTRAINT "collection_delivery_attempts_attempt_count_check" CHECK (("attempt_count" >= 0)),
    CONSTRAINT "collection_delivery_attempts_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'sending'::"text", 'sent'::"text", 'suppressed'::"text", 'needs_review'::"text", 'failed'::"text"])))
);


ALTER TABLE "tap_hub_project"."collection_delivery_attempts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "tap_hub_project"."collection_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "invoice_id" "uuid",
    "event_type" "text" NOT NULL,
    "stage" integer,
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "actor" "uuid",
    "detail" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "approves_event_id" "uuid",
    CONSTRAINT "collection_events_event_type_check" CHECK (("event_type" = ANY (ARRAY['note'::"text", 'reminder_logged'::"text", 'call_logged'::"text", 'promise_to_pay'::"text", 'escalation_requested'::"text", 'escalated'::"text", 'formal_notice_requested'::"text", 'formal_notice_approved'::"text", 'formal_notice_sent'::"text", 'hold_placed'::"text", 'hold_released'::"text"]))),
    CONSTRAINT "collection_events_stage_check" CHECK ((("stage" >= 1) AND ("stage" <= 5)))
);


ALTER TABLE "tap_hub_project"."collection_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "tap_hub_project"."collection_holds" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "invoice_id" "uuid",
    "reason" "text" NOT NULL,
    "placed_by" "uuid" NOT NULL,
    "placed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_on" "date",
    "released_by" "uuid",
    "released_at" timestamp with time zone
);


ALTER TABLE "tap_hub_project"."collection_holds" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "tap_hub_project"."collection_ladder_rules" (
    "stage" smallint NOT NULL,
    "label" "text" NOT NULL,
    "days_past_due" integer NOT NULL,
    "automatic" boolean DEFAULT false NOT NULL,
    "subject_template" "text" NOT NULL,
    "body_template" "text" NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "collection_ladder_rules_check" CHECK ((("stage" < 4) OR ("automatic" = false))),
    CONSTRAINT "collection_ladder_rules_days_past_due_check" CHECK (("days_past_due" >= 1)),
    CONSTRAINT "collection_ladder_rules_stage_check" CHECK ((("stage" >= 1) AND ("stage" <= 5)))
);


ALTER TABLE "tap_hub_project"."collection_ladder_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "tap_hub_project"."collection_settings" (
    "id" "text" DEFAULT 'default'::"text" NOT NULL,
    "automation_enabled" boolean DEFAULT false NOT NULL,
    "delivery_mode" "text" DEFAULT 'disabled'::"text" NOT NULL,
    "timezone" "text" DEFAULT 'America/Chicago'::"text" NOT NULL,
    "send_start" time without time zone DEFAULT '09:00:00'::time without time zone NOT NULL,
    "send_end" time without time zone DEFAULT '17:00:00'::time without time zone NOT NULL,
    "weekdays_only" boolean DEFAULT true NOT NULL,
    "minimum_balance" numeric(12,2) DEFAULT 50 NOT NULL,
    "direct_escalation_threshold" numeric(12,2) DEFAULT 5000 NOT NULL,
    "sender_name" "text",
    "reply_to" "text",
    "test_recipient" "text",
    "copy_assignee" boolean DEFAULT false NOT NULL,
    "include_payment_link" boolean DEFAULT false NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "collection_settings_check" CHECK (("send_end" > "send_start")),
    CONSTRAINT "collection_settings_check1" CHECK ((("delivery_mode" <> 'test'::"text") OR ("test_recipient" IS NOT NULL))),
    CONSTRAINT "collection_settings_delivery_mode_check" CHECK (("delivery_mode" = ANY (ARRAY['disabled'::"text", 'test'::"text"]))),
    CONSTRAINT "collection_settings_direct_escalation_threshold_check" CHECK (("direct_escalation_threshold" >= (0)::numeric)),
    CONSTRAINT "collection_settings_id_check" CHECK (("id" = 'default'::"text")),
    CONSTRAINT "collection_settings_minimum_balance_check" CHECK (("minimum_balance" >= (0)::numeric))
);


ALTER TABLE "tap_hub_project"."collection_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "tap_hub_project"."comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "entity_type" "text",
    "entity_id" "uuid",
    "month" integer,
    "body" "text",
    "author_label" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "tap_hub_project"."comments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "tap_hub_project"."contacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid",
    "name" "text" NOT NULL,
    "email" "text",
    "phone" "text",
    "is_primary" boolean DEFAULT false NOT NULL,
    "category" "text" DEFAULT 'client'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone,
    CONSTRAINT "contacts_category_check" CHECK (("category" = ANY (ARRAY['client'::"text", 'internal'::"text", 'unassigned'::"text"])))
);


ALTER TABLE "tap_hub_project"."contacts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "tap_hub_project"."credentials" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid",
    "portal" "text" NOT NULL,
    "username" "text",
    "vault_ref" "text",
    "notes" "text",
    "group_label" "text",
    "is_bank" boolean DEFAULT false NOT NULL,
    "link_url" "text",
    "purpose" "text",
    "additional_info_01" "text",
    "additional_info_02" "text",
    "entity_name" "text",
    "category" "text",
    "service_type" "text",
    "ip_restrictions" "text",
    "created_by" "text",
    "client_name" "text",
    "portal_url" "text",
    "site" "text",
    "url" "text",
    "additional_info_1" "text",
    "additional_info_2" "text"
);


ALTER TABLE "tap_hub_project"."credentials" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "tap_hub_project"."external_account_ids" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid" NOT NULL,
    "system" "text" NOT NULL,
    "external_realm" "text",
    "external_id" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    CONSTRAINT "external_account_ids_entity_type_check" CHECK (("entity_type" = ANY (ARRAY['client'::"text", 'invoice'::"text", 'payment'::"text"])))
);


ALTER TABLE "tap_hub_project"."external_account_ids" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "tap_hub_project"."invoice_lines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "invoice_id" "uuid" NOT NULL,
    "client_service_id" "uuid",
    "period" "text",
    "description" "text" NOT NULL,
    "quantity" numeric(12,4) DEFAULT 1 NOT NULL,
    "unit_amount" numeric(12,2) NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid",
    CONSTRAINT "invoice_lines_amount_check" CHECK (("amount" >= (0)::numeric)),
    CONSTRAINT "invoice_lines_period_check" CHECK ((("period" IS NULL) OR ("period" ~ '^[0-9]{4}-[0-9]{2}$'::"text"))),
    CONSTRAINT "invoice_lines_quantity_check" CHECK (("quantity" > (0)::numeric)),
    CONSTRAINT "invoice_lines_unit_amount_check" CHECK (("unit_amount" >= (0)::numeric))
);


ALTER TABLE "tap_hub_project"."invoice_lines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "tap_hub_project"."invoices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "invoice_number" "text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "issue_date" "date" NOT NULL,
    "due_date" "date" NOT NULL,
    "memo" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "voided_by" "uuid",
    "voided_at" timestamp with time zone,
    "void_reason" "text",
    "updated_by" "uuid",
    CONSTRAINT "invoices_check" CHECK (("due_date" >= "issue_date")),
    CONSTRAINT "invoices_check1" CHECK ((("status" = 'void'::"text") = ("voided_at" IS NOT NULL))),
    CONSTRAINT "invoices_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'issued'::"text", 'void'::"text"])))
);


ALTER TABLE "tap_hub_project"."invoices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "tap_hub_project"."payment_allocations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "payment_id" "uuid" NOT NULL,
    "invoice_id" "uuid" NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reversed_at" timestamp with time zone,
    "reversed_by" "uuid",
    CONSTRAINT "payment_allocations_amount_check" CHECK (("amount" > (0)::numeric))
);


ALTER TABLE "tap_hub_project"."payment_allocations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "tap_hub_project"."payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "received_on" "date" NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "method" "text" NOT NULL,
    "reference" "text",
    "status" "text" DEFAULT 'recorded'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reversed_by" "uuid",
    "reversed_at" timestamp with time zone,
    "reversal_reason" "text",
    CONSTRAINT "payments_amount_check" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "payments_check" CHECK ((("status" = 'reversed'::"text") = ("reversed_at" IS NOT NULL))),
    CONSTRAINT "payments_method_check" CHECK (("method" = ANY (ARRAY['check'::"text", 'ach'::"text", 'wire'::"text", 'card'::"text", 'cash'::"text", 'other'::"text"]))),
    CONSTRAINT "payments_status_check" CHECK (("status" = ANY (ARRAY['recorded'::"text", 'reversed'::"text"])))
);


ALTER TABLE "tap_hub_project"."payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "tap_hub_project"."period_counts" (
    "client_service_id" "uuid" NOT NULL,
    "period" "text" NOT NULL,
    "processed" integer DEFAULT 0 NOT NULL,
    "expected" integer,
    "updated_by" "uuid",
    "updated_at" timestamp with time zone
);


ALTER TABLE "tap_hub_project"."period_counts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "tap_hub_project"."profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "full_name" "text" NOT NULL,
    "role" "text" DEFAULT 'staff'::"text" NOT NULL,
    "location" "text",
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "org_id" "uuid",
    "user_id" "uuid",
    "avatar_url" "text",
    "reporting_manager" "uuid",
    "modules" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "invite_status" "text" DEFAULT 'invited'::"text" NOT NULL,
    "invited_at" timestamp with time zone,
    "last_login_at" timestamp with time zone,
    "totp_secret" "text",
    "totp_enabled" boolean DEFAULT false NOT NULL,
    "email_2fa_enabled" boolean DEFAULT false NOT NULL,
    "email_2fa_code" "text",
    "email_2fa_code_expires_at" timestamp with time zone,
    "email" "text",
    "allow_edit_client_data" boolean DEFAULT false NOT NULL,
    "can_manage_users" boolean DEFAULT false
);


ALTER TABLE "tap_hub_project"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "tap_hub_project"."sales_tax_registration" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_service_id" "uuid" NOT NULL,
    "rt_number" "text",
    "tax_reg_id" "text",
    "frequency" "text",
    "assigned_to" "uuid",
    "bank_name" "text",
    "bank_account_ref" "text",
    "bank_routing_ref" "text",
    "notes" "text",
    "service_name" "text"
);


ALTER TABLE "tap_hub_project"."sales_tax_registration" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "tap_hub_project"."services" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "tracking" "text" DEFAULT 'stage'::"text" NOT NULL
);


ALTER TABLE "tap_hub_project"."services" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "tap_hub_project"."state_renewals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_service_id" "uuid" NOT NULL,
    "state" "text",
    "due_month" "text",
    "due_day" "text",
    "identifiers" "text",
    "assigned_to" "uuid",
    "frequency" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone,
    "comments" "jsonb"
);


ALTER TABLE "tap_hub_project"."state_renewals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "tap_hub_project"."support_apps" (
    "key" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "tap_hub_project"."support_apps" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "tap_hub_project"."support_ticket_attachments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ticket_id" "uuid" NOT NULL,
    "message_id" "uuid",
    "file_name" "text" NOT NULL,
    "content_type" "text",
    "size_bytes" bigint,
    "storage_ref" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "tap_hub_project"."support_ticket_attachments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "tap_hub_project"."support_ticket_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ticket_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "actor_type" "text",
    "actor_name" "text",
    "actor_user_id" "text",
    "from_status" "text",
    "to_status" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "support_ticket_events_actor_type_check" CHECK (("actor_type" = ANY (ARRAY['reporter'::"text", 'agent'::"text", 'system'::"text"])))
);


ALTER TABLE "tap_hub_project"."support_ticket_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "tap_hub_project"."support_ticket_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ticket_id" "uuid" NOT NULL,
    "author_type" "text" NOT NULL,
    "author_name" "text",
    "author_user_id" "text",
    "body" "text" NOT NULL,
    "visibility" "text" DEFAULT 'public'::"text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "support_ticket_messages_author_type_check" CHECK (("author_type" = ANY (ARRAY['reporter'::"text", 'agent'::"text", 'system'::"text"]))),
    CONSTRAINT "support_ticket_messages_body_check" CHECK (("length"(TRIM(BOTH FROM "body")) > 0)),
    CONSTRAINT "support_ticket_messages_visibility_check" CHECK (("visibility" = ANY (ARRAY['public'::"text", 'internal'::"text"])))
);


ALTER TABLE "tap_hub_project"."support_ticket_messages" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "tap_hub_project"."support_tickets_external_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "tap_hub_project"."support_tickets_external_id_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "tap_hub_project"."support_tickets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ticket_number" bigint NOT NULL,
    "reporter_profile_id" "uuid",
    "reporter_name" "text",
    "reporter_email" "text",
    "account_firm" "text",
    "app_area" "text",
    "summary" "text",
    "priority" "text",
    "what_happened" "text",
    "expected_result" "text",
    "reproduction_steps" "text",
    "screenshot_confirmed" boolean,
    "status" "text",
    "assigned_to" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone,
    "resolved_at" timestamp with time zone,
    "source_app_key" "text" DEFAULT 'tap-hub'::"text" NOT NULL,
    "external_reference" "text",
    "reporter_user_id" "text",
    "category" "text",
    "client_context" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "last_activity_at" timestamp with time zone,
    "first_response_at" timestamp with time zone,
    "closed_at" timestamp with time zone,
    "external_id" "text" DEFAULT ('AIF-'::"text" || "lpad"(("nextval"('"tap_hub_project"."support_tickets_external_id_seq"'::"regclass"))::"text", 6, '0'::"text")) NOT NULL
);


ALTER TABLE "tap_hub_project"."support_tickets" OWNER TO "postgres";


ALTER TABLE "tap_hub_project"."support_tickets" ALTER COLUMN "ticket_number" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "tap_hub_project"."support_tickets_ticket_number_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "tap_hub_project"."time_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "who" "uuid" NOT NULL,
    "client_id" "uuid",
    "client_service_id" "uuid",
    "task" "text",
    "started_at" timestamp with time zone,
    "seconds" integer DEFAULT 0 NOT NULL,
    "note" "text",
    "edited" boolean DEFAULT false NOT NULL,
    "edited_by" "uuid",
    "edited_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "company" "text" DEFAULT 'Tap Associates'::"text",
    "manual" boolean DEFAULT false
);


ALTER TABLE "tap_hub_project"."time_entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "tap_hub_project"."work_periods" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_service_id" "uuid" NOT NULL,
    "period" "text" NOT NULL,
    "stage" "text" DEFAULT 'not_started'::"text" NOT NULL,
    "done_by" "uuid",
    "done_at" timestamp with time zone,
    "billed_at" timestamp with time zone,
    "paid_at" timestamp with time zone,
    "notes" "text"
);


ALTER TABLE "tap_hub_project"."work_periods" OWNER TO "postgres";


ALTER TABLE ONLY "tap_hub_project"."annual_filing"
    ADD CONSTRAINT "annual_filing_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "tap_hub_project"."audit_log"
    ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "tap_hub_project"."client_service_billing"
    ADD CONSTRAINT "client_service_billing_pkey" PRIMARY KEY ("client_service_id");



ALTER TABLE ONLY "tap_hub_project"."client_services"
    ADD CONSTRAINT "client_services_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "tap_hub_project"."clients"
    ADD CONSTRAINT "clients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "tap_hub_project"."collection_delivery_attempts"
    ADD CONSTRAINT "collection_delivery_attempts_idempotency_key_key" UNIQUE ("idempotency_key");



ALTER TABLE ONLY "tap_hub_project"."collection_delivery_attempts"
    ADD CONSTRAINT "collection_delivery_attempts_invoice_id_stage_key" UNIQUE ("invoice_id", "stage");



ALTER TABLE ONLY "tap_hub_project"."collection_delivery_attempts"
    ADD CONSTRAINT "collection_delivery_attempts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "tap_hub_project"."collection_events"
    ADD CONSTRAINT "collection_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "tap_hub_project"."collection_holds"
    ADD CONSTRAINT "collection_holds_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "tap_hub_project"."collection_ladder_rules"
    ADD CONSTRAINT "collection_ladder_rules_pkey" PRIMARY KEY ("stage");



ALTER TABLE ONLY "tap_hub_project"."collection_settings"
    ADD CONSTRAINT "collection_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "tap_hub_project"."comments"
    ADD CONSTRAINT "comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "tap_hub_project"."contacts"
    ADD CONSTRAINT "contacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "tap_hub_project"."credentials"
    ADD CONSTRAINT "credentials_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "tap_hub_project"."external_account_ids"
    ADD CONSTRAINT "external_account_ids_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "tap_hub_project"."external_account_ids"
    ADD CONSTRAINT "external_account_ids_system_external_realm_entity_type_exte_key" UNIQUE ("system", "external_realm", "entity_type", "external_id");



ALTER TABLE ONLY "tap_hub_project"."invoice_lines"
    ADD CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "tap_hub_project"."invoices"
    ADD CONSTRAINT "invoices_invoice_number_key" UNIQUE ("invoice_number");



ALTER TABLE ONLY "tap_hub_project"."invoices"
    ADD CONSTRAINT "invoices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "tap_hub_project"."payment_allocations"
    ADD CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "tap_hub_project"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "tap_hub_project"."period_counts"
    ADD CONSTRAINT "period_counts_client_service_id_period_key" UNIQUE ("client_service_id", "period");



ALTER TABLE ONLY "tap_hub_project"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "tap_hub_project"."sales_tax_registration"
    ADD CONSTRAINT "sales_tax_registration_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "tap_hub_project"."services"
    ADD CONSTRAINT "services_code_key" UNIQUE ("code");



ALTER TABLE ONLY "tap_hub_project"."services"
    ADD CONSTRAINT "services_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "tap_hub_project"."state_renewals"
    ADD CONSTRAINT "state_renewals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "tap_hub_project"."support_apps"
    ADD CONSTRAINT "support_apps_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "tap_hub_project"."support_ticket_attachments"
    ADD CONSTRAINT "support_ticket_attachments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "tap_hub_project"."support_ticket_events"
    ADD CONSTRAINT "support_ticket_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "tap_hub_project"."support_ticket_messages"
    ADD CONSTRAINT "support_ticket_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "tap_hub_project"."support_tickets"
    ADD CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "tap_hub_project"."support_tickets"
    ADD CONSTRAINT "support_tickets_ticket_number_key" UNIQUE ("ticket_number");



ALTER TABLE ONLY "tap_hub_project"."time_entries"
    ADD CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "tap_hub_project"."work_periods"
    ADD CONSTRAINT "work_periods_client_service_id_period_key" UNIQUE ("client_service_id", "period");



ALTER TABLE ONLY "tap_hub_project"."work_periods"
    ADD CONSTRAINT "work_periods_pkey" PRIMARY KEY ("id");



CREATE INDEX "contacts_category_idx" ON "tap_hub_project"."contacts" USING "btree" ("category");



CREATE INDEX "idx_allocations_invoice" ON "tap_hub_project"."payment_allocations" USING "btree" ("invoice_id");



CREATE INDEX "idx_allocations_payment" ON "tap_hub_project"."payment_allocations" USING "btree" ("payment_id");



CREATE INDEX "idx_collection_delivery_client" ON "tap_hub_project"."collection_delivery_attempts" USING "btree" ("client_id", "created_at" DESC);



CREATE INDEX "idx_collection_delivery_queue" ON "tap_hub_project"."collection_delivery_attempts" USING "btree" ("status", "next_attempt_at") WHERE ("status" = ANY (ARRAY['queued'::"text", 'failed'::"text"]));



CREATE INDEX "idx_collection_events_client" ON "tap_hub_project"."collection_events" USING "btree" ("client_id", "occurred_at" DESC);



CREATE INDEX "idx_collection_holds_client" ON "tap_hub_project"."collection_holds" USING "btree" ("client_id", "released_at");



CREATE INDEX "idx_external_ids_entity" ON "tap_hub_project"."external_account_ids" USING "btree" ("entity_type", "entity_id");



CREATE INDEX "idx_invoice_lines_invoice" ON "tap_hub_project"."invoice_lines" USING "btree" ("invoice_id", "sort_order");



CREATE INDEX "idx_invoices_client_status" ON "tap_hub_project"."invoices" USING "btree" ("client_id", "status");



CREATE INDEX "idx_invoices_due_date" ON "tap_hub_project"."invoices" USING "btree" ("due_date") WHERE ("status" = 'issued'::"text");



CREATE INDEX "idx_payments_client_status" ON "tap_hub_project"."payments" USING "btree" ("client_id", "status");



CREATE INDEX "support_ticket_attachments_ticket_idx" ON "tap_hub_project"."support_ticket_attachments" USING "btree" ("ticket_id", "created_at");



CREATE INDEX "support_ticket_events_ticket_time_idx" ON "tap_hub_project"."support_ticket_events" USING "btree" ("ticket_id", "created_at");



CREATE INDEX "support_ticket_messages_ticket_time_idx" ON "tap_hub_project"."support_ticket_messages" USING "btree" ("ticket_id", "created_at");



CREATE INDEX "support_ticket_messages_visibility_idx" ON "tap_hub_project"."support_ticket_messages" USING "btree" ("ticket_id", "visibility", "created_at");



CREATE INDEX "support_tickets_app_status_activity_idx" ON "tap_hub_project"."support_tickets" USING "btree" ("source_app_key", "status", "last_activity_at" DESC);



CREATE UNIQUE INDEX "support_tickets_external_id_key" ON "tap_hub_project"."support_tickets" USING "btree" ("external_id");



CREATE INDEX "support_tickets_external_reference_idx" ON "tap_hub_project"."support_tickets" USING "btree" ("source_app_key", "external_reference");



CREATE INDEX "support_tickets_reporter_user_id_idx" ON "tap_hub_project"."support_tickets" USING "btree" ("reporter_user_id", "created_at" DESC);



CREATE UNIQUE INDEX "uq_collection_events_approves_event" ON "tap_hub_project"."collection_events" USING "btree" ("approves_event_id") WHERE ("approves_event_id" IS NOT NULL);



CREATE UNIQUE INDEX "uq_collection_events_notice_sent_approval" ON "tap_hub_project"."collection_events" USING "btree" ((("detail" ->> 'approval_event_id'::"text"))) WHERE (("event_type" = 'formal_notice_sent'::"text") AND ("detail" ? 'approval_event_id'::"text"));



CREATE OR REPLACE TRIGGER "audit_collection_delivery_attempts" AFTER INSERT OR DELETE OR UPDATE ON "tap_hub_project"."collection_delivery_attempts" FOR EACH ROW EXECUTE FUNCTION "tap_hub_project"."audit_billing_row"();



CREATE OR REPLACE TRIGGER "audit_collection_ladder_rules" AFTER INSERT OR DELETE OR UPDATE ON "tap_hub_project"."collection_ladder_rules" FOR EACH ROW EXECUTE FUNCTION "tap_hub_project"."audit_billing_row"();



CREATE OR REPLACE TRIGGER "audit_collection_settings" AFTER INSERT OR DELETE OR UPDATE ON "tap_hub_project"."collection_settings" FOR EACH ROW EXECUTE FUNCTION "tap_hub_project"."audit_billing_row"();



CREATE OR REPLACE TRIGGER "billing_audit_collection_events" AFTER INSERT OR DELETE OR UPDATE ON "tap_hub_project"."collection_events" FOR EACH ROW EXECUTE FUNCTION "tap_hub_project"."audit_billing_row"();



CREATE OR REPLACE TRIGGER "billing_audit_collection_holds" AFTER INSERT OR DELETE OR UPDATE ON "tap_hub_project"."collection_holds" FOR EACH ROW EXECUTE FUNCTION "tap_hub_project"."audit_billing_row"();



CREATE OR REPLACE TRIGGER "billing_audit_external_account_ids" AFTER INSERT OR DELETE OR UPDATE ON "tap_hub_project"."external_account_ids" FOR EACH ROW EXECUTE FUNCTION "tap_hub_project"."audit_billing_row"();



CREATE OR REPLACE TRIGGER "billing_audit_invoice_lines" AFTER INSERT OR DELETE OR UPDATE ON "tap_hub_project"."invoice_lines" FOR EACH ROW EXECUTE FUNCTION "tap_hub_project"."audit_billing_row"();



CREATE OR REPLACE TRIGGER "billing_audit_invoices" AFTER INSERT OR DELETE OR UPDATE ON "tap_hub_project"."invoices" FOR EACH ROW EXECUTE FUNCTION "tap_hub_project"."audit_billing_row"();



CREATE OR REPLACE TRIGGER "billing_audit_payment_allocations" AFTER INSERT OR DELETE OR UPDATE ON "tap_hub_project"."payment_allocations" FOR EACH ROW EXECUTE FUNCTION "tap_hub_project"."audit_billing_row"();



CREATE OR REPLACE TRIGGER "billing_audit_payments" AFTER INSERT OR DELETE OR UPDATE ON "tap_hub_project"."payments" FOR EACH ROW EXECUTE FUNCTION "tap_hub_project"."audit_billing_row"();



CREATE OR REPLACE TRIGGER "support_ticket_messages_notify_trigger" AFTER INSERT ON "tap_hub_project"."support_ticket_messages" FOR EACH ROW EXECUTE FUNCTION "tap_hub_project"."support_ticket_messages_notify"();



CREATE OR REPLACE TRIGGER "support_tickets_maintain_trigger" BEFORE INSERT OR UPDATE ON "tap_hub_project"."support_tickets" FOR EACH ROW EXECUTE FUNCTION "tap_hub_project"."support_tickets_maintain"();



ALTER TABLE ONLY "tap_hub_project"."audit_log"
    ADD CONSTRAINT "audit_log_actor_fkey" FOREIGN KEY ("actor") REFERENCES "tap_hub_project"."profiles"("id");



ALTER TABLE ONLY "tap_hub_project"."billing_periods"
    ADD CONSTRAINT "billing_periods_client_service_id_fkey" FOREIGN KEY ("client_service_id") REFERENCES "tap_hub_project"."client_services"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "tap_hub_project"."client_services"
    ADD CONSTRAINT "client_services_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "tap_hub_project"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "tap_hub_project"."client_services"
    ADD CONSTRAINT "client_services_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "tap_hub_project"."services"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "tap_hub_project"."client_tax_ids"
    ADD CONSTRAINT "client_tax_ids_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "tap_hub_project"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "tap_hub_project"."collection_delivery_attempts"
    ADD CONSTRAINT "collection_delivery_attempts_actor_fkey" FOREIGN KEY ("actor") REFERENCES "tap_hub_project"."profiles"("id");



ALTER TABLE ONLY "tap_hub_project"."collection_delivery_attempts"
    ADD CONSTRAINT "collection_delivery_attempts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "tap_hub_project"."clients"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "tap_hub_project"."collection_delivery_attempts"
    ADD CONSTRAINT "collection_delivery_attempts_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "tap_hub_project"."invoices"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "tap_hub_project"."collection_delivery_attempts"
    ADD CONSTRAINT "collection_delivery_attempts_stage_fkey" FOREIGN KEY ("stage") REFERENCES "tap_hub_project"."collection_ladder_rules"("stage");



ALTER TABLE ONLY "tap_hub_project"."collection_events"
    ADD CONSTRAINT "collection_events_actor_fkey" FOREIGN KEY ("actor") REFERENCES "tap_hub_project"."profiles"("id");



ALTER TABLE ONLY "tap_hub_project"."collection_events"
    ADD CONSTRAINT "collection_events_approves_event_id_fkey" FOREIGN KEY ("approves_event_id") REFERENCES "tap_hub_project"."collection_events"("id");



ALTER TABLE ONLY "tap_hub_project"."collection_events"
    ADD CONSTRAINT "collection_events_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "tap_hub_project"."clients"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "tap_hub_project"."collection_events"
    ADD CONSTRAINT "collection_events_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "tap_hub_project"."invoices"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "tap_hub_project"."collection_holds"
    ADD CONSTRAINT "collection_holds_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "tap_hub_project"."clients"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "tap_hub_project"."collection_holds"
    ADD CONSTRAINT "collection_holds_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "tap_hub_project"."invoices"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "tap_hub_project"."collection_holds"
    ADD CONSTRAINT "collection_holds_placed_by_fkey" FOREIGN KEY ("placed_by") REFERENCES "tap_hub_project"."profiles"("id");



ALTER TABLE ONLY "tap_hub_project"."collection_holds"
    ADD CONSTRAINT "collection_holds_released_by_fkey" FOREIGN KEY ("released_by") REFERENCES "tap_hub_project"."profiles"("id");



ALTER TABLE ONLY "tap_hub_project"."collection_ladder_rules"
    ADD CONSTRAINT "collection_ladder_rules_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "tap_hub_project"."profiles"("id");



ALTER TABLE ONLY "tap_hub_project"."collection_ladder_rules"
    ADD CONSTRAINT "collection_ladder_rules_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "tap_hub_project"."profiles"("id");



ALTER TABLE ONLY "tap_hub_project"."collection_settings"
    ADD CONSTRAINT "collection_settings_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "tap_hub_project"."profiles"("id");



ALTER TABLE ONLY "tap_hub_project"."collection_settings"
    ADD CONSTRAINT "collection_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "tap_hub_project"."profiles"("id");



ALTER TABLE ONLY "tap_hub_project"."contacts"
    ADD CONSTRAINT "contacts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "tap_hub_project"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "tap_hub_project"."credentials"
    ADD CONSTRAINT "credentials_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "tap_hub_project"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "tap_hub_project"."external_account_ids"
    ADD CONSTRAINT "external_account_ids_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "tap_hub_project"."profiles"("id");



ALTER TABLE ONLY "tap_hub_project"."invoice_lines"
    ADD CONSTRAINT "invoice_lines_client_service_id_fkey" FOREIGN KEY ("client_service_id") REFERENCES "tap_hub_project"."client_services"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "tap_hub_project"."invoice_lines"
    ADD CONSTRAINT "invoice_lines_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "tap_hub_project"."profiles"("id");



ALTER TABLE ONLY "tap_hub_project"."invoice_lines"
    ADD CONSTRAINT "invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "tap_hub_project"."invoices"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "tap_hub_project"."invoice_lines"
    ADD CONSTRAINT "invoice_lines_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "tap_hub_project"."profiles"("id");



ALTER TABLE ONLY "tap_hub_project"."invoices"
    ADD CONSTRAINT "invoices_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "tap_hub_project"."clients"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "tap_hub_project"."invoices"
    ADD CONSTRAINT "invoices_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "tap_hub_project"."profiles"("id");



ALTER TABLE ONLY "tap_hub_project"."invoices"
    ADD CONSTRAINT "invoices_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "tap_hub_project"."profiles"("id");



ALTER TABLE ONLY "tap_hub_project"."invoices"
    ADD CONSTRAINT "invoices_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "tap_hub_project"."profiles"("id");



ALTER TABLE ONLY "tap_hub_project"."payment_allocations"
    ADD CONSTRAINT "payment_allocations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "tap_hub_project"."profiles"("id");



ALTER TABLE ONLY "tap_hub_project"."payment_allocations"
    ADD CONSTRAINT "payment_allocations_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "tap_hub_project"."invoices"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "tap_hub_project"."payment_allocations"
    ADD CONSTRAINT "payment_allocations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "tap_hub_project"."payments"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "tap_hub_project"."payment_allocations"
    ADD CONSTRAINT "payment_allocations_reversed_by_fkey" FOREIGN KEY ("reversed_by") REFERENCES "tap_hub_project"."profiles"("id");



ALTER TABLE ONLY "tap_hub_project"."payments"
    ADD CONSTRAINT "payments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "tap_hub_project"."clients"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "tap_hub_project"."payments"
    ADD CONSTRAINT "payments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "tap_hub_project"."profiles"("id");



ALTER TABLE ONLY "tap_hub_project"."payments"
    ADD CONSTRAINT "payments_reversed_by_fkey" FOREIGN KEY ("reversed_by") REFERENCES "tap_hub_project"."profiles"("id");



ALTER TABLE ONLY "tap_hub_project"."period_counts"
    ADD CONSTRAINT "period_counts_client_service_id_fkey" FOREIGN KEY ("client_service_id") REFERENCES "tap_hub_project"."client_services"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "tap_hub_project"."support_ticket_attachments"
    ADD CONSTRAINT "support_ticket_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "tap_hub_project"."support_ticket_messages"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "tap_hub_project"."support_ticket_attachments"
    ADD CONSTRAINT "support_ticket_attachments_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tap_hub_project"."support_tickets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "tap_hub_project"."support_ticket_events"
    ADD CONSTRAINT "support_ticket_events_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tap_hub_project"."support_tickets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "tap_hub_project"."support_ticket_messages"
    ADD CONSTRAINT "support_ticket_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tap_hub_project"."support_tickets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "tap_hub_project"."support_tickets"
    ADD CONSTRAINT "support_tickets_source_app_key_fkey" FOREIGN KEY ("source_app_key") REFERENCES "tap_hub_project"."support_apps"("key");



ALTER TABLE ONLY "tap_hub_project"."time_entries"
    ADD CONSTRAINT "time_entries_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "tap_hub_project"."clients"("id");



ALTER TABLE ONLY "tap_hub_project"."time_entries"
    ADD CONSTRAINT "time_entries_client_service_id_fkey" FOREIGN KEY ("client_service_id") REFERENCES "tap_hub_project"."client_services"("id");



ALTER TABLE ONLY "tap_hub_project"."time_entries"
    ADD CONSTRAINT "time_entries_edited_by_fkey" FOREIGN KEY ("edited_by") REFERENCES "tap_hub_project"."profiles"("id");



ALTER TABLE ONLY "tap_hub_project"."time_entries"
    ADD CONSTRAINT "time_entries_who_fkey" FOREIGN KEY ("who") REFERENCES "tap_hub_project"."profiles"("id");



ALTER TABLE ONLY "tap_hub_project"."work_periods"
    ADD CONSTRAINT "work_periods_client_service_id_fkey" FOREIGN KEY ("client_service_id") REFERENCES "tap_hub_project"."client_services"("id") ON DELETE CASCADE;



CREATE POLICY "Support apps readable by all" ON "tap_hub_project"."support_apps" FOR SELECT USING (true);



ALTER TABLE "tap_hub_project"."annual_filing" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "tap_hub_project"."audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "tap_hub_project"."billing_periods" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "tap_hub_project"."client_service_billing" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "tap_hub_project"."client_services" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "tap_hub_project"."client_tax_ids" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "tap_hub_project"."clients" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "tap_hub_project"."collection_delivery_attempts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "tap_hub_project"."collection_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "tap_hub_project"."collection_holds" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "tap_hub_project"."collection_ladder_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "tap_hub_project"."collection_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "tap_hub_project"."comments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "tap_hub_project"."contacts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "tap_hub_project"."credentials" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "tap_hub_project"."external_account_ids" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "tap_hub_project"."invoice_lines" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "tap_hub_project"."invoices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "tap_hub_project"."payment_allocations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "tap_hub_project"."payments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "tap_hub_project"."period_counts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "tap_hub_project"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "tap_hub_project"."sales_tax_registration" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "tap_hub_project"."services" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "tap_hub_project"."state_renewals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "tap_hub_project"."support_apps" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "tap_hub_project"."support_ticket_attachments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "tap_hub_project"."support_ticket_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "tap_hub_project"."support_ticket_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "tap_hub_project"."support_tickets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "tap_hub_project"."time_entries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "tap_hub_project"."work_periods" ENABLE ROW LEVEL SECURITY;





REVOKE ALL ON FUNCTION "tap_hub_project"."allocate_payment"("p_payment_id" "uuid", "p_invoice_id" "uuid", "p_amount" numeric, "p_created_by" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "tap_hub_project"."approve_collection_event"("p_event_id" "uuid", "p_event_type" "text", "p_actor" "uuid", "p_detail" "jsonb") FROM PUBLIC;



REVOKE ALL ON FUNCTION "tap_hub_project"."collections_firm_today"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "tap_hub_project"."collections_invoice_stage_context"("p_client_id" "uuid", "p_invoice_id" "uuid", "p_due_date" "date", "p_as_of_date" "date") FROM PUBLIC;



REVOKE ALL ON FUNCTION "tap_hub_project"."delete_draft_invoice"("p_invoice_id" "uuid", "p_actor" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "tap_hub_project"."delete_draft_invoice_line"("p_line_id" "uuid", "p_actor" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "tap_hub_project"."get_billing_invoice_balances"("p_as_of_date" "date") FROM PUBLIC;



REVOKE ALL ON FUNCTION "tap_hub_project"."get_billing_receivables"("p_client_id" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "tap_hub_project"."get_collections_worklist"("p_client_id" "uuid", "p_as_of_date" "date", "p_limit" integer, "p_offset" integer) FROM PUBLIC;



REVOKE ALL ON FUNCTION "tap_hub_project"."get_collections_worklist"("p_client_id" "uuid", "p_as_of_date" "date", "p_limit" integer, "p_offset" integer, "p_sort_order" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "tap_hub_project"."get_collections_worklist_130"("p_client_id" "uuid", "p_as_of_date" "date", "p_limit" integer, "p_offset" integer, "p_sort_order" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "tap_hub_project"."place_collection_hold"("p_client_id" "uuid", "p_invoice_id" "uuid", "p_reason" "text", "p_actor" "uuid", "p_expires_on" "date") FROM PUBLIC;



REVOKE ALL ON FUNCTION "tap_hub_project"."record_billing_audit"("p_actor" "uuid", "p_action" "text", "p_entity" "text", "p_entity_id" "text", "p_detail" "jsonb") FROM PUBLIC;



REVOKE ALL ON FUNCTION "tap_hub_project"."record_collection_event"("p_client_id" "uuid", "p_invoice_id" "uuid", "p_event_type" "text", "p_actor" "uuid", "p_stage" integer, "p_detail" "jsonb", "p_approval_event_id" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "tap_hub_project"."release_collection_hold"("p_hold_id" "uuid", "p_actor" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "tap_hub_project"."reverse_payment"("p_payment_id" "uuid", "p_actor" "uuid", "p_reason" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "tap_hub_project"."reverse_payment_allocation"("p_allocation_id" "uuid", "p_actor" "uuid") FROM PUBLIC;














































































































-- Hosted sandbox security boundary. Browser roles receive no schema, table,
-- sequence, or function privilege until a reviewed feature migration grants it.
REVOKE ALL ON SCHEMA tap_hub_project FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA tap_hub_project FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA tap_hub_project FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA tap_hub_project FROM PUBLIC, anon, authenticated;

GRANT USAGE ON SCHEMA tap_hub_project TO service_role;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA tap_hub_project TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA tap_hub_project TO service_role;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA tap_hub_project TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA tap_hub_project
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA tap_hub_project
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA tap_hub_project
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
