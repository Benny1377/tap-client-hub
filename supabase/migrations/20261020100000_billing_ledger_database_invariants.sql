-- Billing Phase 1: enforce ledger invariants in the database as well as routes.
-- Forward-only. Safe for the local synthetic harness only until separately approved.
begin;

create or replace function tap_hub_project.enforce_invoice_line_invariants()
returns trigger
language plpgsql
security definer
set search_path = tap_hub_project, public
as $$
declare
  v_invoice_status text;
  v_expected_amount numeric(12,2);
begin
  select status into v_invoice_status
  from invoices
  where id = case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end
  for key share;

  -- A draft deletion removes the parent invoice first, then PostgreSQL
  -- cascades to its lines. In that DELETE-only cascade there is no parent
  -- row left to inspect; delete_draft_invoice already authorized the draft.
  if not found and tg_op = 'DELETE' then
    return old;
  end if;

  if not found then
    raise exception 'invariant_violation: invoice does not exist' using errcode = 'P0001';
  end if;

  if v_invoice_status <> 'draft' then
    raise exception 'invariant_violation: invoice lines can only be changed while invoice is draft'
      using errcode = 'P0001';
  end if;

  if tg_op <> 'DELETE' then
    v_expected_amount := round(new.quantity * new.unit_amount, 2);
    if new.amount <> v_expected_amount then
      raise exception 'invariant_violation: line amount must equal rounded quantity times unit amount'
        using errcode = 'P0001';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists billing_invoice_line_invariants on tap_hub_project.invoice_lines;
create trigger billing_invoice_line_invariants
before insert or update or delete on tap_hub_project.invoice_lines
for each row execute function tap_hub_project.enforce_invoice_line_invariants();

create or replace function tap_hub_project.enforce_invoice_void_invariants()
returns trigger
language plpgsql
security definer
set search_path = tap_hub_project, public
as $$
begin
  if old.status = 'issued' and new.status = 'void'
    and nullif(btrim(new.void_reason), '') is null then
    raise exception 'invariant_violation: a non-empty void reason is required'
      using errcode = 'P0001';
  end if;

  if old.status = 'issued' and new.status = 'void' and exists (
    select 1
    from payment_allocations
    where invoice_id = new.id and reversed_at is null
  ) then
    raise exception 'invariant_violation: reverse active payment allocations before voiding invoice'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists billing_invoice_void_invariants on tap_hub_project.invoices;
create trigger billing_invoice_void_invariants
before update of status on tap_hub_project.invoices
for each row execute function tap_hub_project.enforce_invoice_void_invariants();

commit;
