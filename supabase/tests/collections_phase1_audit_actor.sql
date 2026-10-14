-- Transactional actor-attribution regression. Run only on a disposable/local
-- or approved non-production database after migrations through 20261010130000.
begin;
do $$
declare
  v_creator uuid;
  v_actor uuid;
  v_client uuid := gen_random_uuid();
  v_invoice uuid := gen_random_uuid();
  v_payment uuid := gen_random_uuid();
  v_allocation uuid;
  v_hold uuid;
  v_bad_actor uuid;
begin
  -- profiles.id references auth.users, so use existing fixtures rather than
  -- creating fake auth identities in this transactional test.
  select id into v_actor from tap_hub_project.profiles
  where active and lower(role) in ('owner', 'admin') order by id limit 1;
  if v_actor is null then
    raise exception 'audit actor test requires an active Owner/Admin profile';
  end if;
  select id into v_creator from tap_hub_project.profiles
  where active and id <> v_actor order by id limit 1;
  v_creator := coalesce(v_creator, v_actor);
  insert into tap_hub_project.clients(id, name, type)
  values (v_client, 'Collections audit fixture', 'business');
  insert into tap_hub_project.invoices(id, client_id, invoice_number, status, issue_date, due_date, created_by)
  values (v_invoice, v_client, 'AUDIT-' || replace(v_invoice::text, '-', ''), 'issued', current_date, current_date, v_creator);
  insert into tap_hub_project.invoice_lines(invoice_id, description, quantity, unit_amount, amount, created_by)
  values (v_invoice, 'Audit fixture line', 1, 40, 40, v_creator);

  insert into tap_hub_project.payments(id, client_id, received_on, amount, method, created_by)
  values (v_payment, v_client, tap_hub_project.collections_firm_today(), 10, 'cash', v_creator);
  perform tap_hub_project.reverse_payment(v_payment, v_actor, 'audit actor regression');
  select actor into v_bad_actor from tap_hub_project.audit_log
  where entity = 'payments' and entity_id = v_payment::text and action = 'update'
  order by at desc limit 1;
  if v_bad_actor is distinct from v_actor then
    raise exception 'reverse_payment audit actor mismatch: expected %, got %', v_actor, v_bad_actor;
  end if;

  v_payment := gen_random_uuid();
  insert into tap_hub_project.payments(id, client_id, received_on, amount, method, created_by)
  values (v_payment, v_client, tap_hub_project.collections_firm_today(), 20, 'cash', v_creator);
  v_allocation := tap_hub_project.allocate_payment(v_payment, v_invoice, 20, v_creator);
  perform tap_hub_project.reverse_payment_allocation(v_allocation, v_actor);
  select actor into v_bad_actor from tap_hub_project.audit_log
  where entity = 'payment_allocations' and entity_id = v_allocation::text and action = 'update'
  order by at desc limit 1;
  if v_bad_actor is distinct from v_actor then
    raise exception 'reverse_payment_allocation audit actor mismatch: expected %, got %', v_actor, v_bad_actor;
  end if;

  v_hold := tap_hub_project.place_collection_hold(v_client, v_invoice, 'audit actor regression', v_creator, null);
  perform tap_hub_project.release_collection_hold(v_hold, v_actor);
  select actor into v_bad_actor from tap_hub_project.audit_log
  where entity = 'collection_holds' and entity_id = v_hold::text and action = 'update'
  order by at desc limit 1;
  if v_bad_actor is distinct from v_actor then
    raise exception 'release_collection_hold audit actor mismatch: expected %, got %', v_actor, v_bad_actor;
  end if;
end;
$$;
rollback;
