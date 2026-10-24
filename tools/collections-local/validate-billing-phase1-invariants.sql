-- Local synthetic proof that ledger protections hold below the API layer.
do $$
declare
  v_invoice_id uuid := gen_random_uuid();
  v_line_id uuid;
  v_payment_id uuid := gen_random_uuid();
  v_actor uuid := '00000000-0000-4000-8000-000000000001';
  v_client_id uuid := '10000000-0000-4000-8000-000000000001';
begin
  insert into tap_hub_project.invoices (
    id, client_id, invoice_number, status, issue_date, due_date, created_by
  ) values (
    v_invoice_id, v_client_id, 'LOCAL-INVARIANT-' || replace(v_invoice_id::text, '-', ''),
    'draft', current_date, current_date + 15, v_actor
  );

  -- PostgreSQL numeric rounding is the database source of truth for the line amount.
  insert into tap_hub_project.invoice_lines (
    invoice_id, description, quantity, unit_amount, amount, created_by
  ) values (
    v_invoice_id, 'Synthetic invariant line', 1.2345, 10.00, 12.35, v_actor
  ) returning id into v_line_id;

  begin
    update tap_hub_project.invoice_lines set amount = 12.34 where id = v_line_id;
    raise exception 'expected line-amount invariant violation';
  exception when sqlstate 'P0001' then
    if sqlerrm not like 'invariant_violation:%' then raise; end if;
  end;

  update tap_hub_project.invoices set status = 'issued' where id = v_invoice_id;

  begin
    update tap_hub_project.invoice_lines set description = 'Mutated issued line' where id = v_line_id;
    raise exception 'expected issued-line immutability violation';
  exception when sqlstate 'P0001' then
    if sqlerrm not like 'invariant_violation:%' then raise; end if;
  end;

  insert into tap_hub_project.payments (id, client_id, received_on, amount, method, created_by)
  values (v_payment_id, v_client_id, current_date, 5.00, 'check', v_actor);
  perform tap_hub_project.allocate_payment(v_payment_id, v_invoice_id, 5.00, v_actor);

  begin
    update tap_hub_project.invoices
    set status = 'void', voided_by = v_actor, voided_at = now(), void_reason = 'Synthetic test'
    where id = v_invoice_id;
    raise exception 'expected active-allocation void violation';
  exception when sqlstate 'P0001' then
    if sqlerrm not like 'invariant_violation:%' then raise; end if;
  end;
end;
$$;

select 'billing phase 1 database invariants: PASS' as result;
