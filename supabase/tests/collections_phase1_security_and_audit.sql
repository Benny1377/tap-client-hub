-- Read-only metadata assertions for local/non-production validation.
-- Run only against a disposable/local or approved non-production database:
-- supabase test db --linked must NOT be used against production.
do $$
declare
  v_table text;
  v_oid regclass;
begin
  foreach v_table in array array[
    'invoices', 'invoice_lines', 'payments', 'payment_allocations',
    'external_account_ids', 'collection_holds', 'collection_events'
  ] loop
    v_oid := to_regclass('tap_hub_project.' || v_table);
    if v_oid is null then raise exception 'missing billing table: %', v_table; end if;
    if not (select relrowsecurity from pg_class where oid = v_oid) then
      raise exception 'RLS is not enabled for %', v_table;
    end if;
    if has_table_privilege('anon', v_oid, 'select')
       or has_table_privilege('anon', v_oid, 'insert')
       or has_table_privilege('anon', v_oid, 'update')
       or has_table_privilege('anon', v_oid, 'delete') then
      raise exception 'anon has direct table privileges on %', v_table;
    end if;
    if not exists (
      select 1 from pg_trigger
      where tgrelid = v_oid and not tgisinternal
        and tgname = 'billing_audit_' || v_table
    ) then raise exception 'transactional audit trigger missing on %', v_table; end if;
  end loop;

  if has_function_privilege('anon', 'tap_hub_project.allocate_payment(uuid,uuid,numeric,uuid)', 'execute')
     or has_function_privilege('authenticated', 'tap_hub_project.allocate_payment(uuid,uuid,numeric,uuid)', 'execute') then
    raise exception 'untrusted role can execute allocate_payment';
  end if;
  if has_function_privilege('anon', 'tap_hub_project.get_billing_receivables(uuid)', 'execute')
     or has_function_privilege('authenticated', 'tap_hub_project.get_billing_receivables(uuid)', 'execute') then
    raise exception 'untrusted role can execute get_billing_receivables';
  end if;
  if has_function_privilege('anon', 'tap_hub_project.record_collection_event(uuid,uuid,text,uuid,integer,jsonb,uuid)', 'execute')
     or has_function_privilege('authenticated', 'tap_hub_project.record_collection_event(uuid,uuid,text,uuid,integer,jsonb,uuid)', 'execute')
     or has_function_privilege('anon', 'tap_hub_project.approve_collection_event(uuid,text,uuid,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'tap_hub_project.approve_collection_event(uuid,text,uuid,jsonb)', 'execute')
     or has_function_privilege('anon', 'tap_hub_project.place_collection_hold(uuid,uuid,text,uuid,date)', 'execute')
     or has_function_privilege('authenticated', 'tap_hub_project.place_collection_hold(uuid,uuid,text,uuid,date)', 'execute')
     or has_function_privilege('anon', 'tap_hub_project.release_collection_hold(uuid,uuid)', 'execute')
     or has_function_privilege('authenticated', 'tap_hub_project.release_collection_hold(uuid,uuid)', 'execute') then
    raise exception 'untrusted role can execute a Collections mutation RPC';
  end if;
  if not exists (
    select 1 from pg_indexes where schemaname = 'tap_hub_project'
      and indexname = 'uq_collection_events_approves_event'
  ) then raise exception 'unique approval constraint is missing'; end if;
end;
$$;
