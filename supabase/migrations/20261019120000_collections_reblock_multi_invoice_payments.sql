-- A payment can be allocated to multiple invoices. When its recorded/reversed
-- state changes, re-block every linked PDF snapshot affected by that payment.
-- This is forward-only so already-pushed Phase 4 migrations remain immutable.
begin;

create or replace function tap_hub_project.block_stale_collection_imports()
returns trigger
language plpgsql
security definer
set search_path = tap_hub_project, public
as $$
declare
  v_invoice_id uuid;
  v_changed_at timestamptz := now();
  v_billing_balance numeric(12,2);
  v_source record;
  v_timezone text;
begin
  if tg_table_name in ('payment_allocations', 'invoice_lines') then
    for v_invoice_id in
      select distinct affected.invoice_id
      from (
        select case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end as invoice_id
        union all
        select case when tg_op = 'UPDATE' then old.invoice_id else null end as invoice_id
      ) affected
      where affected.invoice_id is not null
    loop
      select timezone into v_timezone from collection_settings where id = 'default';
      select (coalesce((select sum(il.amount) from invoice_lines il where il.invoice_id = v_invoice_id),0)
          - coalesce((select sum(pa.amount) from payment_allocations pa join payments p on p.id = pa.payment_id
              where pa.invoice_id = v_invoice_id and pa.reversed_at is null and p.status = 'recorded'),0))::numeric(12,2)
        into v_billing_balance;
      for v_source in
        select distinct i.source_invoice_id, i.batch_id, i.open_balance, i.source_as_of
        from collection_import_invoices i
        join collection_source_invoice_identities s using (source_invoice_id)
        where s.linked_invoice_id = v_invoice_id
          and i.review_status = 'approved'
          and (
            (v_changed_at at time zone coalesce(v_timezone, 'America/Chicago'))::date >= i.source_as_of
            or collections_billing_invoice_changed_on_or_after(v_invoice_id, i.source_as_of)
          )
      loop
        update collection_import_invoices set discrepancy_status = 'blocked', review_status = 'blocked', updated_at = now()
          where batch_id = v_source.batch_id and source_invoice_id = v_source.source_invoice_id;
        insert into collection_import_audit(batch_id, source_invoice_id, actor, action, detail)
        values (v_source.batch_id, v_source.source_invoice_id, null, 'billing_snapshot_stale', jsonb_build_object(
          'billing_invoice_id', v_invoice_id, 'source_as_of', v_source.source_as_of,
          'pdf_open_balance', v_source.open_balance, 'billing_open_balance', v_billing_balance,
          'difference', (v_billing_balance - v_source.open_balance)::numeric(12,2),
          'ledger_table', tg_table_name, 'changed_at', v_changed_at
        ));
      end loop;
    end loop;
  elsif tg_table_name = 'payments' then
    select timezone into v_timezone from collection_settings where id = 'default';
    for v_invoice_id in
      select distinct pa.invoice_id
      from payment_allocations pa
      where pa.payment_id = coalesce(new.id, old.id)
    loop
      select (coalesce((select sum(il.amount) from invoice_lines il where il.invoice_id = v_invoice_id),0)
          - coalesce((select sum(pa.amount) from payment_allocations pa join payments p on p.id = pa.payment_id
              where pa.invoice_id = v_invoice_id and pa.reversed_at is null and p.status = 'recorded'),0))::numeric(12,2)
        into v_billing_balance;
      for v_source in
        select distinct i.source_invoice_id, i.batch_id, i.open_balance, i.source_as_of
        from collection_import_invoices i
        join collection_source_invoice_identities s using (source_invoice_id)
        where s.linked_invoice_id = v_invoice_id
          and i.review_status = 'approved'
          and (
            (v_changed_at at time zone coalesce(v_timezone, 'America/Chicago'))::date >= i.source_as_of
            or collections_billing_invoice_changed_on_or_after(v_invoice_id, i.source_as_of)
          )
      loop
        update collection_import_invoices set discrepancy_status = 'blocked', review_status = 'blocked', updated_at = now()
          where batch_id = v_source.batch_id and source_invoice_id = v_source.source_invoice_id;
        insert into collection_import_audit(batch_id, source_invoice_id, actor, action, detail)
        values (v_source.batch_id, v_source.source_invoice_id, null, 'billing_snapshot_stale', jsonb_build_object(
          'billing_invoice_id', v_invoice_id, 'source_as_of', v_source.source_as_of,
          'pdf_open_balance', v_source.open_balance, 'billing_open_balance', v_billing_balance,
          'difference', (v_billing_balance - v_source.open_balance)::numeric(12,2),
          'ledger_table', tg_table_name, 'changed_at', v_changed_at
        ));
      end loop;
    end loop;
  else
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

commit;
