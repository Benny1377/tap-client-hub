-- Collections Phase 4: auditable QuickBooks A/R PDF intake and source identities.
-- Forward-only. Never apply to hosted projects without the release gate.
begin;

alter table tap_hub_project.collection_delivery_attempts
  add column if not exists source text not null default 'billing',
  add column if not exists source_invoice_id uuid,
  add column if not exists canonical_collection_identity text;

update tap_hub_project.collection_delivery_attempts
set canonical_collection_identity = 'billing:' || invoice_id::text
where canonical_collection_identity is null;

alter table tap_hub_project.collection_delivery_attempts
  alter column invoice_id drop not null,
  alter column canonical_collection_identity set not null,
  add constraint collection_delivery_attempts_source_check
    check (source in ('billing', 'pdf_import')),
  add constraint collection_delivery_attempts_source_identity_check
    check ((source = 'billing' and invoice_id is not null and source_invoice_id is null)
      or (source = 'pdf_import' and source_invoice_id is not null)),
  add constraint collection_delivery_attempts_identity_check
    check (invoice_id is not null or source_invoice_id is not null);

alter table tap_hub_project.collection_delivery_attempts
  drop constraint if exists collection_delivery_attempts_invoice_id_stage_key;
create unique index if not exists uq_collection_delivery_identity_stage
  on tap_hub_project.collection_delivery_attempts(canonical_collection_identity, stage);
create index if not exists idx_collection_delivery_source_invoice
  on tap_hub_project.collection_delivery_attempts(source_invoice_id, created_at desc)
  where source_invoice_id is not null;

alter table tap_hub_project.collection_holds
  add column if not exists source text not null default 'billing',
  add column if not exists source_invoice_id uuid,
  add column if not exists canonical_collection_identity text;
update tap_hub_project.collection_holds
set canonical_collection_identity = case when invoice_id is null then null else 'billing:' || invoice_id::text end
where canonical_collection_identity is null;
alter table tap_hub_project.collection_holds
  add constraint collection_holds_source_check check (source in ('billing', 'pdf_import')),
  add constraint collection_holds_identity_check check (
    (invoice_id is null and source_invoice_id is null and canonical_collection_identity is null)
    or (invoice_id is not null and source_invoice_id is null and source = 'billing' and canonical_collection_identity is not null)
    or (invoice_id is null and source_invoice_id is not null and source = 'pdf_import' and canonical_collection_identity is not null)
  );
create index if not exists idx_collection_holds_canonical_active
  on tap_hub_project.collection_holds(canonical_collection_identity, released_at)
  where canonical_collection_identity is not null;

alter table tap_hub_project.collection_events
  add column if not exists source text not null default 'billing',
  add column if not exists source_invoice_id uuid,
  add column if not exists canonical_collection_identity text;
update tap_hub_project.collection_events
set canonical_collection_identity = case when invoice_id is null then null else 'billing:' || invoice_id::text end
where canonical_collection_identity is null;
alter table tap_hub_project.collection_events
  add constraint collection_events_source_check check (source in ('billing', 'pdf_import')),
  add constraint collection_events_identity_check check (
    (invoice_id is null and source_invoice_id is null and canonical_collection_identity is null)
    or (invoice_id is not null and source_invoice_id is null and source = 'billing' and canonical_collection_identity is not null)
    or (invoice_id is null and source_invoice_id is not null and source = 'pdf_import' and canonical_collection_identity is not null)
  );
create index if not exists idx_collection_events_canonical_stage
  on tap_hub_project.collection_events(canonical_collection_identity, occurred_at desc)
  where canonical_collection_identity is not null;

create table if not exists tap_hub_project.collection_import_batches (
  id uuid primary key default gen_random_uuid(),
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  storage_path text not null unique,
  original_filename text not null,
  content_type text not null check (content_type = 'application/pdf'),
  file_size_bytes bigint not null check (file_size_bytes between 1 and 26214400),
  report_type text check (report_type in ('aging_summary', 'aging_detail', 'unknown')),
  source_as_of date,
  status text not null default 'uploaded' check (status in ('uploaded','parsing','needs_review','approved','rejected','superseded','failed')),
  uploaded_by uuid not null references tap_hub_project.profiles(id),
  parsed_at timestamptz,
  approved_by uuid references tap_hub_project.profiles(id),
  approved_at timestamptz,
  supersedes_batch_id uuid references tap_hub_project.collection_import_batches(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'approved' or (approved_at is not null and approved_by is not null))
);
create unique index if not exists uq_collection_import_file_sha256
  on tap_hub_project.collection_import_batches(file_sha256);

create table if not exists tap_hub_project.collection_source_invoice_identities (
  source_invoice_id uuid primary key default gen_random_uuid(),
  client_id uuid references tap_hub_project.clients(id) on delete restrict,
  canonical_collection_identity text,
  linked_invoice_id uuid references tap_hub_project.invoices(id) on delete restrict,
  selected_source text not null default 'pdf_import' check (selected_source in ('billing','pdf_import')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tap_hub_project.collection_import_invoices (
  id uuid primary key default gen_random_uuid(),
  source_invoice_id uuid not null references tap_hub_project.collection_source_invoice_identities(source_invoice_id) on delete restrict,
  batch_id uuid not null references tap_hub_project.collection_import_batches(id) on delete restrict,
  proposed_linked_invoice_id uuid references tap_hub_project.invoices(id) on delete restrict,
  invoice_number text,
  customer_name text not null,
  customer_external_id text,
  transaction_type text,
  transaction_date date,
  due_date date,
  terms text,
  po_number text,
  reported_aging integer,
  open_balance numeric(12,2) not null,
  currency text not null default 'USD' check (currency = 'USD'),
  source_as_of date not null,
  source_row_key text not null,
  review_status text not null default 'needs_review' check (review_status in ('needs_review','ready','blocked','approved','superseded','rejected')),
  discrepancy_status text not null default 'none' check (discrepancy_status in ('none','blocked','resolved')),
  confirmed_at timestamptz,
  row_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (batch_id, source_row_key),
  unique (batch_id, source_invoice_id),
  check (open_balance <> 'NaN'::numeric)
);

create index if not exists idx_collection_import_identity_client
  on tap_hub_project.collection_source_invoice_identities(client_id);
create index if not exists idx_collection_import_identity_canonical
  on tap_hub_project.collection_source_invoice_identities(canonical_collection_identity)
  where canonical_collection_identity is not null;
create index if not exists idx_collection_import_identity_billing
  on tap_hub_project.collection_source_invoice_identities(linked_invoice_id)
  where linked_invoice_id is not null;

create table if not exists tap_hub_project.collection_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references tap_hub_project.collection_import_batches(id) on delete restrict,
  source_invoice_id uuid references tap_hub_project.collection_source_invoice_identities(source_invoice_id) on delete restrict,
  page_number integer not null check (page_number > 0),
  row_number integer not null check (row_number > 0),
  raw_text text not null,
  parsed_fields jsonb not null default '{}'::jsonb,
  duplicate_of uuid references tap_hub_project.collection_import_rows(id),
  exact_duplicate boolean not null default false,
  review_disposition text not null default 'unreviewed' check (review_disposition in ('unreviewed','invoice','summary','header','ignored','duplicate')),
  created_at timestamptz not null default now(),
  unique (batch_id, page_number, row_number)
);

create table if not exists tap_hub_project.collection_import_invoice_revisions (
  id bigint generated always as identity primary key,
  batch_id uuid not null references tap_hub_project.collection_import_batches(id) on delete restrict,
  source_invoice_id uuid not null references tap_hub_project.collection_source_invoice_identities(source_invoice_id) on delete restrict,
  actor uuid references tap_hub_project.profiles(id),
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_collection_import_invoice_revisions_source
  on tap_hub_project.collection_import_invoice_revisions(source_invoice_id, created_at desc);

create table if not exists tap_hub_project.collection_invoice_aliases (
  canonical_collection_identity text not null,
  source text not null check (source in ('billing','pdf_import')),
  invoice_id uuid references tap_hub_project.invoices(id) on delete restrict,
  source_invoice_id uuid references tap_hub_project.collection_source_invoice_identities(source_invoice_id) on delete restrict,
  created_by uuid not null references tap_hub_project.profiles(id),
  created_at timestamptz not null default now(),
  primary key (canonical_collection_identity, source),
  unique (invoice_id),
  unique (source_invoice_id),
  check ((source = 'billing' and invoice_id is not null and source_invoice_id is null)
    or (source = 'pdf_import' and source_invoice_id is not null and invoice_id is null))
);

create or replace function tap_hub_project.populate_collection_action_source_identity()
returns trigger language plpgsql set search_path = tap_hub_project, public as $$
begin
  if new.source_invoice_id is not null then
    if new.invoice_id is not null then raise exception 'invalid_input: exactly one direct invoice identity is allowed' using errcode = '22023'; end if;
    new.source := 'pdf_import';
    if new.canonical_collection_identity is null then
      select canonical_collection_identity into new.canonical_collection_identity
        from collection_source_invoice_identities where source_invoice_id = new.source_invoice_id;
    end if;
  elsif new.invoice_id is not null then
    new.source := 'billing';
    if new.canonical_collection_identity is null then
      select canonical_collection_identity into new.canonical_collection_identity
        from collection_invoice_aliases where source = 'billing' and invoice_id = new.invoice_id;
      new.canonical_collection_identity := coalesce(new.canonical_collection_identity, 'billing:' || new.invoice_id::text);
    end if;
  else
    new.source := coalesce(new.source, 'billing');
    new.canonical_collection_identity := null;
  end if;
  return new;
end;
$$;
drop trigger if exists populate_collection_hold_source_identity on tap_hub_project.collection_holds;
create trigger populate_collection_hold_source_identity before insert on tap_hub_project.collection_holds
  for each row execute function tap_hub_project.populate_collection_action_source_identity();
drop trigger if exists populate_collection_event_source_identity on tap_hub_project.collection_events;
create trigger populate_collection_event_source_identity before insert on tap_hub_project.collection_events
  for each row execute function tap_hub_project.populate_collection_action_source_identity();

create table if not exists tap_hub_project.collection_import_audit (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references tap_hub_project.collection_import_batches(id) on delete restrict,
  source_invoice_id uuid references tap_hub_project.collection_source_invoice_identities(source_invoice_id) on delete restrict,
  actor uuid references tap_hub_project.profiles(id),
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

alter table tap_hub_project.collection_delivery_attempts
  add constraint collection_delivery_attempts_source_invoice_fk
  foreign key (source_invoice_id) references tap_hub_project.collection_source_invoice_identities(source_invoice_id) on delete restrict;
alter table tap_hub_project.collection_holds
  add constraint collection_holds_source_invoice_fk
  foreign key (source_invoice_id) references tap_hub_project.collection_source_invoice_identities(source_invoice_id) on delete restrict;
alter table tap_hub_project.collection_events
  add constraint collection_events_source_invoice_fk
  foreign key (source_invoice_id) references tap_hub_project.collection_source_invoice_identities(source_invoice_id) on delete restrict;

create or replace function tap_hub_project.keep_collection_identity_immutable()
returns trigger language plpgsql set search_path = tap_hub_project, public as $$
begin
  if old.canonical_collection_identity is not null
    and new.canonical_collection_identity is distinct from old.canonical_collection_identity
    and (
      exists(select 1 from collection_delivery_attempts where canonical_collection_identity = old.canonical_collection_identity)
      or exists(select 1 from collection_events where canonical_collection_identity = old.canonical_collection_identity)
      or exists(select 1 from collection_holds where canonical_collection_identity = old.canonical_collection_identity)
    ) then
    raise exception 'conflict: canonical collection identity is immutable after approval' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists collection_source_identity_immutable on tap_hub_project.collection_source_invoice_identities;
create trigger collection_source_identity_immutable before update of canonical_collection_identity
  on tap_hub_project.collection_source_invoice_identities for each row execute function tap_hub_project.keep_collection_identity_immutable();

create table if not exists tap_hub_project.collection_import_permissions (
  id text primary key default 'default' check (id = 'default'),
  policy jsonb not null default '{"upload":["owner","admin","collections"],"review":["owner","admin","collections"],"approve":["owner","admin"]}'::jsonb,
  updated_by uuid references tap_hub_project.profiles(id),
  updated_at timestamptz not null default now()
);
insert into tap_hub_project.collection_import_permissions(id) values ('default') on conflict (id) do nothing;

-- The PDF records a date, not a timestamp. Treat ledger activity on that date
-- as potentially later than the report and require an explicit review.
create or replace function tap_hub_project.collections_billing_invoice_changed_on_or_after(p_invoice_id uuid, p_source_as_of date)
returns boolean language sql stable security definer
set search_path = tap_hub_project, public as $$
  select exists (
    select 1 from audit_log a
    where a.entity in ('invoice_lines','payment_allocations')
      and coalesce(a.detail->'new'->>'invoice_id',a.detail->'old'->>'invoice_id') = p_invoice_id::text
      and (a.at at time zone coalesce((select timezone from collection_settings where id='default'),'America/Chicago'))::date >= p_source_as_of
  ) or exists (
    select 1 from payment_allocations pa
    where pa.invoice_id = p_invoice_id and (
      (pa.created_at at time zone coalesce((select timezone from collection_settings where id='default'),'America/Chicago'))::date >= p_source_as_of
      or (pa.reversed_at at time zone coalesce((select timezone from collection_settings where id='default'),'America/Chicago'))::date >= p_source_as_of
    )
  )
$$;
revoke all on function tap_hub_project.collections_billing_invoice_changed_on_or_after(uuid,date) from public,anon,authenticated;
grant execute on function tap_hub_project.collections_billing_invoice_changed_on_or_after(uuid,date) to service_role;

create or replace function tap_hub_project.approve_collection_import_batch(p_batch_id uuid, p_actor uuid)
returns jsonb
language plpgsql security definer
set search_path = tap_hub_project, public
as $$
declare
  v_batch collection_import_batches%rowtype;
  v_identity collection_source_invoice_identities%rowtype;
  v_target text;
  v_pdf_target text;
  v_billing_target text;
  v_invoice_count integer;
  v_pdf_balance numeric(12,2);
  v_billing_balance numeric(12,2);
  v_proposed_invoice_id uuid;
  v_effective_invoice_id uuid;
  v_snapshot_stale boolean;
begin
  perform set_config('tap_hub.actor_id', p_actor::text, true);
  select * into v_batch from collection_import_batches where id = p_batch_id for update;
  if not found then raise exception 'not_found: import batch does not exist' using errcode = 'P0002'; end if;
  if v_batch.status <> 'needs_review' then raise exception 'conflict: batch is not awaiting approval' using errcode = 'P0001'; end if;
  if v_batch.uploaded_by = p_actor then raise exception 'conflict: uploader cannot approve this batch' using errcode = 'P0001'; end if;
  if exists(select 1 from collection_import_audit where batch_id = p_batch_id and actor = p_actor and action in ('pdf_row_corrected','pdf_row_classified')) then
    raise exception 'conflict: batch corrector cannot approve this batch' using errcode = 'P0001';
  end if;
  if v_batch.report_type = 'unknown' or v_batch.source_as_of is null then
    raise exception 'conflict: report type and as-of date require review' using errcode = 'P0001';
  end if;
  if v_batch.report_type <> 'aging_detail' then
    raise exception 'conflict: summary reports are cross-check evidence, not invoice-level import data' using errcode = 'P0001';
  end if;
  if exists(
    select 1 from collection_import_batches summary
    where summary.report_type = 'aging_summary' and summary.source_as_of = v_batch.source_as_of
      and summary.status = 'needs_review'
      and (summary.metadata->'detail_cross_check'->>'detail_batch_id' is distinct from p_batch_id::text
        or summary.metadata->'detail_cross_check'->>'status' is distinct from 'matched')
  ) then
    raise exception 'conflict: same-date summary report has not been cross-checked successfully' using errcode = 'P0001';
  end if;
  select count(*) into v_invoice_count from collection_import_invoices where batch_id = p_batch_id;
  if v_invoice_count = 0 or exists(
    select 1 from collection_import_invoices i
    join collection_source_invoice_identities s using (source_invoice_id)
    where i.batch_id = p_batch_id and (i.review_status <> 'ready' or s.client_id is null)
  ) then raise exception 'conflict: every invoice requires review and explicit client linkage' using errcode = 'P0001'; end if;
  if exists(select 1 from collection_import_rows where batch_id = p_batch_id and review_disposition = 'unreviewed') then
    raise exception 'conflict: every extracted line must be classified before approval' using errcode = 'P0001';
  end if;

  for v_identity in
    select s.* from collection_source_invoice_identities s
    join collection_import_invoices i using (source_invoice_id)
    where i.batch_id = p_batch_id for update of s
  loop
    select proposed_linked_invoice_id into v_proposed_invoice_id from collection_import_invoices
      where batch_id = p_batch_id and source_invoice_id = v_identity.source_invoice_id;
    if v_identity.linked_invoice_id is not null and v_proposed_invoice_id is not null
      and v_identity.linked_invoice_id <> v_proposed_invoice_id then
      raise exception 'conflict: a linked Billing invoice cannot be reassigned' using errcode = 'P0001';
    end if;
    v_effective_invoice_id := coalesce(v_identity.linked_invoice_id, v_proposed_invoice_id);
    v_pdf_target := 'pdf_import:' || v_identity.source_invoice_id::text;
    v_billing_target := case when v_effective_invoice_id is null then null else 'billing:' || v_effective_invoice_id::text end;
    v_target := v_identity.canonical_collection_identity;
    if v_target is not null and v_billing_target is not null and v_target = v_pdf_target
      and not exists(select 1 from collection_delivery_attempts where canonical_collection_identity = v_pdf_target)
      and not exists(select 1 from collection_events where canonical_collection_identity = v_pdf_target)
      and not exists(select 1 from collection_holds where canonical_collection_identity = v_pdf_target) then
      -- A late link before activity may still adopt the Billing identity.
      v_target := v_billing_target;
    end if;
    if v_target is null then
      if v_billing_target is null then
        v_target := v_pdf_target;
      else
        if exists(select 1 from collection_delivery_attempts where canonical_collection_identity = v_pdf_target)
          or exists(select 1 from collection_events where canonical_collection_identity = v_pdf_target)
          or exists(select 1 from collection_holds where canonical_collection_identity = v_pdf_target) then
          v_target := v_pdf_target;
        elsif exists(select 1 from collection_delivery_attempts where canonical_collection_identity = v_billing_target)
          or exists(select 1 from collection_events where canonical_collection_identity = v_billing_target)
          or exists(select 1 from collection_holds where canonical_collection_identity = v_billing_target) then
          v_target := v_billing_target;
        else
          v_target := v_billing_target;
        end if;
      end if;
    end if;
    if v_billing_target is not null and v_target <> v_pdf_target and v_target <> v_billing_target then
      raise exception 'conflict: unsupported canonical identity' using errcode = 'P0001';
    end if;
    if v_billing_target is not null and v_target = v_pdf_target and (
      exists(select 1 from collection_delivery_attempts where canonical_collection_identity = v_billing_target)
      or exists(select 1 from collection_events where canonical_collection_identity = v_billing_target)
      or exists(select 1 from collection_holds where canonical_collection_identity = v_billing_target)
    ) and (
      exists(select 1 from collection_delivery_attempts where canonical_collection_identity = v_pdf_target)
      or exists(select 1 from collection_events where canonical_collection_identity = v_pdf_target)
      or exists(select 1 from collection_holds where canonical_collection_identity = v_pdf_target)
    ) then raise exception 'conflict: source identities have separate histories; manual reconciliation required' using errcode = 'P0001'; end if;

    if v_identity.canonical_collection_identity is not null and v_target <> v_identity.canonical_collection_identity then
      delete from collection_invoice_aliases where canonical_collection_identity = v_identity.canonical_collection_identity
        and source_invoice_id = v_identity.source_invoice_id;
    end if;

    -- Before activity exists, a newly linked row may adopt Billing identity;
    -- after activity the trigger rejects any identity rewrite.
    update collection_source_invoice_identities set canonical_collection_identity = v_target, updated_at = now()
    where source_invoice_id = v_identity.source_invoice_id
      and canonical_collection_identity is distinct from v_target;
    update collection_source_invoice_identities set linked_invoice_id = v_effective_invoice_id, updated_at = now()
      where source_invoice_id = v_identity.source_invoice_id and linked_invoice_id is null and v_effective_invoice_id is not null;
    if not exists(select 1 from collection_invoice_aliases where canonical_collection_identity = v_target and source = 'pdf_import') then
      insert into collection_invoice_aliases(canonical_collection_identity, source, source_invoice_id, created_by)
      values (v_target, 'pdf_import', v_identity.source_invoice_id, p_actor);
    end if;
    if v_billing_target is not null and not exists(select 1 from collection_invoice_aliases where canonical_collection_identity = v_target and source = 'billing') then
      insert into collection_invoice_aliases(canonical_collection_identity, source, invoice_id, created_by)
      values (v_target, 'billing', v_effective_invoice_id, p_actor);
    end if;

    if v_effective_invoice_id is not null then
      select i.open_balance into v_pdf_balance from collection_import_invoices i
        where i.batch_id = p_batch_id and i.source_invoice_id = v_identity.source_invoice_id;
      select (coalesce((select sum(il.amount) from invoice_lines il where il.invoice_id = v_effective_invoice_id),0)
        - coalesce((select sum(pa.amount) from payment_allocations pa join payments p on p.id = pa.payment_id
            where pa.invoice_id = v_effective_invoice_id and pa.reversed_at is null and p.status = 'recorded'),0))::numeric(12,2)
        into v_billing_balance;
      v_snapshot_stale := collections_billing_invoice_changed_on_or_after(v_effective_invoice_id, v_batch.source_as_of);
      if v_pdf_balance is distinct from v_billing_balance or v_snapshot_stale then
        update collection_import_invoices set discrepancy_status = 'blocked', review_status = 'blocked', updated_at = now()
          where batch_id = p_batch_id and source_invoice_id = v_identity.source_invoice_id;
        insert into collection_import_audit(batch_id, source_invoice_id, actor, action, detail)
        values (p_batch_id, v_identity.source_invoice_id, p_actor, case when v_snapshot_stale then 'billing_snapshot_stale_at_approval' else 'billing_discrepancy_detected' end, jsonb_build_object(
          'billing_invoice_id', v_effective_invoice_id, 'source_as_of', v_batch.source_as_of,
          'pdf_open_balance', v_pdf_balance, 'billing_open_balance', v_billing_balance,
          'difference', (v_pdf_balance - v_billing_balance)::numeric(12,2),
          'snapshot_stale', v_snapshot_stale
        ));
      end if;
    end if;
  end loop;
  update collection_import_invoices set review_status = 'approved', updated_at = now()
  where batch_id = p_batch_id and review_status = 'ready';
  update collection_import_batches set status = 'approved', approved_by = p_actor, approved_at = now(), updated_at = now()
  where id = p_batch_id;
  insert into collection_import_audit(batch_id, actor, action, detail)
  values (p_batch_id, p_actor, 'batch_approved', jsonb_build_object('invoice_count', v_invoice_count));
  return jsonb_build_object('batch_id', p_batch_id, 'status', 'approved', 'invoice_count', v_invoice_count);
end;
$$;
revoke all on function tap_hub_project.approve_collection_import_batch(uuid,uuid) from public, anon, authenticated;
grant execute on function tap_hub_project.approve_collection_import_batch(uuid,uuid) to service_role;

create or replace function tap_hub_project.review_collection_import_invoice(
  p_batch_id uuid, p_source_row_id uuid, p_actor uuid, p_client_id uuid,
  p_linked_invoice_id uuid, p_existing_source_invoice_id uuid, p_fields jsonb
) returns jsonb
language plpgsql security definer
set search_path = tap_hub_project, public
as $$
declare
  v_batch collection_import_batches%rowtype;
  v_source_row collection_import_rows%rowtype;
  v_identity collection_source_invoice_identities%rowtype;
  v_prior collection_import_invoices%rowtype;
  v_invoice collection_import_invoices%rowtype;
  v_source_invoice_id uuid;
  v_linked_invoice_id uuid;
  v_row_data jsonb;
begin
  perform set_config('tap_hub.actor_id', p_actor::text, true);
  select * into v_batch from collection_import_batches where id=p_batch_id for update;
  if not found or v_batch.status in ('approved','rejected','superseded') then raise exception 'conflict: batch is not editable' using errcode='P0001'; end if;
  if v_batch.source_as_of is null then raise exception 'conflict: report as-of date must be reviewed first' using errcode='P0001'; end if;
  if not exists(select 1 from clients where id=p_client_id) then raise exception 'not_found: TAP Hub client does not exist' using errcode='P0002'; end if;
  select * into v_source_row from collection_import_rows where id=p_source_row_id and batch_id=p_batch_id for update;
  if not found then raise exception 'not_found: source row does not belong to this batch' using errcode='P0002'; end if;
  v_source_invoice_id := coalesce(p_existing_source_invoice_id,v_source_row.source_invoice_id);
  if p_existing_source_invoice_id is not null and v_source_row.source_invoice_id is not null
     and p_existing_source_invoice_id <> v_source_row.source_invoice_id then
    raise exception 'conflict: source row is already assigned to another imported invoice' using errcode='P0001';
  end if;
  if v_source_invoice_id is null then
    insert into collection_source_invoice_identities(client_id) values (p_client_id) returning source_invoice_id into v_source_invoice_id;
  end if;
  select * into v_identity from collection_source_invoice_identities where source_invoice_id=v_source_invoice_id for update;
  if not found then raise exception 'not_found: prior source invoice identity does not exist' using errcode='P0002'; end if;
  if v_identity.client_id is not null and v_identity.client_id <> p_client_id then raise exception 'conflict: source invoice is linked to another client' using errcode='P0001'; end if;
  if v_identity.client_id is null then update collection_source_invoice_identities set client_id=p_client_id,updated_at=now() where source_invoice_id=v_source_invoice_id; end if;
  if p_linked_invoice_id is not null and not exists(select 1 from invoices where id=p_linked_invoice_id and client_id=p_client_id) then
    raise exception 'conflict: linked Billing invoice must belong to the selected client' using errcode='P0001';
  end if;
  if v_identity.linked_invoice_id is not null and p_linked_invoice_id is not null and v_identity.linked_invoice_id <> p_linked_invoice_id then
    raise exception 'conflict: an existing Billing link cannot be reassigned' using errcode='P0001';
  end if;
  v_linked_invoice_id := coalesce(v_identity.linked_invoice_id,p_linked_invoice_id);
  select * into v_prior from collection_import_invoices where source_invoice_id=v_source_invoice_id order by updated_at desc limit 1 for update;
  if found then
    insert into collection_import_invoice_revisions(batch_id,source_invoice_id,actor,snapshot)
    values (v_prior.batch_id,v_source_invoice_id,p_actor,to_jsonb(v_prior));
  end if;
  v_row_data := coalesce(v_prior.row_data,'{}'::jsonb) || coalesce(p_fields->'row_data','{}'::jsonb);
  if v_prior.id is not null then v_row_data := v_row_data || jsonb_build_object('prior_revision',jsonb_build_object('id',v_prior.id,'batch_id',v_prior.batch_id)); end if;
  insert into collection_import_invoices(
    batch_id,source_invoice_id,proposed_linked_invoice_id,invoice_number,customer_name,customer_external_id,
    transaction_type,transaction_date,due_date,terms,po_number,reported_aging,open_balance,source_as_of,source_row_key,
    review_status,discrepancy_status,confirmed_at,row_data
  ) values (
    p_batch_id,v_source_invoice_id,v_linked_invoice_id,
    coalesce(nullif(p_fields->>'invoice_number',''),v_prior.invoice_number),
    trim(p_fields->>'customer_name'),coalesce(nullif(p_fields->>'customer_external_id',''),v_prior.customer_external_id),
    coalesce(nullif(p_fields->>'transaction_type',''),v_prior.transaction_type),
    coalesce(nullif(p_fields->>'transaction_date','')::date,v_prior.transaction_date),
    coalesce(nullif(p_fields->>'due_date','')::date,v_prior.due_date),
    coalesce(nullif(p_fields->>'terms',''),v_prior.terms),coalesce(nullif(p_fields->>'po_number',''),v_prior.po_number),
    coalesce(nullif(p_fields->>'reported_aging','')::integer,v_prior.reported_aging),
    (p_fields->>'open_balance')::numeric(12,2),v_batch.source_as_of,
    v_source_row.page_number::text||':'||v_source_row.row_number::text,'ready','none',now(),v_row_data
  ) on conflict(batch_id,source_invoice_id) do update set
    proposed_linked_invoice_id=excluded.proposed_linked_invoice_id,invoice_number=excluded.invoice_number,
    customer_name=excluded.customer_name,customer_external_id=excluded.customer_external_id,
    transaction_type=excluded.transaction_type,transaction_date=excluded.transaction_date,due_date=excluded.due_date,
    terms=excluded.terms,po_number=excluded.po_number,reported_aging=excluded.reported_aging,
    open_balance=excluded.open_balance,source_as_of=excluded.source_as_of,source_row_key=excluded.source_row_key,
    review_status='ready',discrepancy_status='none',confirmed_at=now(),row_data=excluded.row_data,updated_at=now()
  returning * into v_invoice;
  update collection_import_rows set source_invoice_id=v_source_invoice_id,parsed_fields=coalesce(p_fields->'row_data','{}'::jsonb),review_disposition='invoice'
    where id=p_source_row_id;
  update collection_import_batches set status='needs_review',updated_at=now() where id=p_batch_id;
  insert into collection_import_audit(batch_id,source_invoice_id,actor,action,detail)
  values(p_batch_id,v_source_invoice_id,p_actor,'pdf_row_corrected',jsonb_build_object(
    'client_id',p_client_id,'linked_invoice_id',v_linked_invoice_id,'source_row_key',v_invoice.source_row_key,
    'prior_open_balance',v_prior.open_balance,'selected_open_balance',v_invoice.open_balance,
    'prior_revision_preserved',v_prior.id is not null
  ));
  return jsonb_build_object('invoice',to_jsonb(v_invoice),'source_invoice_id',v_source_invoice_id);
end;
$$;
revoke all on function tap_hub_project.review_collection_import_invoice(uuid,uuid,uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function tap_hub_project.review_collection_import_invoice(uuid,uuid,uuid,uuid,uuid,uuid,jsonb) to service_role;

create or replace function tap_hub_project.classify_collection_import_row(
  p_batch_id uuid, p_row_id uuid, p_disposition text, p_actor uuid, p_note text default null
) returns jsonb language plpgsql security definer
set search_path = tap_hub_project, public as $$
declare v_batch collection_import_batches%rowtype; v_row collection_import_rows%rowtype;
begin
  perform set_config('tap_hub.actor_id',p_actor::text,true);
  if p_disposition not in ('summary','header','ignored') then raise exception 'invalid_input: unsupported source-row disposition' using errcode='22023'; end if;
  select * into v_batch from collection_import_batches where id=p_batch_id for update;
  if not found then raise exception 'not_found: import batch does not exist' using errcode='P0002'; end if;
  if v_batch.status in ('approved','rejected','superseded') then raise exception 'conflict: batch is not editable' using errcode='P0001'; end if;
  select * into v_row from collection_import_rows where id=p_row_id and batch_id=p_batch_id and source_invoice_id is null for update;
  if not found then raise exception 'not_found: unassigned source row does not exist' using errcode='P0002'; end if;
  update collection_import_rows set review_disposition=p_disposition where id=p_row_id returning * into v_row;
  insert into collection_import_audit(batch_id,actor,action,detail)
  values(p_batch_id,p_actor,'pdf_row_classified',jsonb_build_object('row_id',p_row_id,'disposition',p_disposition,'note',left(p_note,500)));
  return jsonb_build_object('id',v_row.id,'page_number',v_row.page_number,'row_number',v_row.row_number,'review_disposition',v_row.review_disposition);
end; $$;
revoke all on function tap_hub_project.classify_collection_import_row(uuid,uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function tap_hub_project.classify_collection_import_row(uuid,uuid,text,uuid,text) to service_role;

create or replace function tap_hub_project.cross_check_collection_import_reports(
  p_summary_batch_id uuid,p_detail_batch_id uuid,p_summary_total numeric,p_note text,p_actor uuid
) returns jsonb language plpgsql security definer
set search_path = tap_hub_project, public as $$
declare
  v_summary collection_import_batches%rowtype;
  v_detail collection_import_batches%rowtype;
  v_invoice_count integer;
  v_detail_total numeric(12,2);
  v_status text;
  v_check jsonb;
begin
  perform set_config('tap_hub.actor_id',p_actor::text,true);
  select * into v_summary from collection_import_batches where id=p_summary_batch_id for update;
  select * into v_detail from collection_import_batches where id=p_detail_batch_id for update;
  if not found or v_summary.id is null then raise exception 'not_found: summary or detail batch does not exist' using errcode='P0002'; end if;
  if v_summary.report_type <> 'aging_summary' or v_summary.status in ('approved','rejected','superseded') then
    raise exception 'conflict: only an open summary report can be cross-checked' using errcode='P0001';
  end if;
  if v_detail.report_type <> 'aging_detail' or v_detail.source_as_of is distinct from v_summary.source_as_of or v_detail.status <> 'needs_review' then
    raise exception 'conflict: detail report must be under review with the same as-of date' using errcode='P0001';
  end if;
  select count(*),coalesce(sum(open_balance),0)::numeric(12,2) into v_invoice_count,v_detail_total
    from collection_import_invoices where batch_id=p_detail_batch_id and review_status in ('ready','approved');
  if v_invoice_count=0 or exists(select 1 from collection_import_invoices where batch_id=p_detail_batch_id and review_status not in ('ready','approved')) then
    raise exception 'conflict: every detail invoice row must be reviewed before cross-check' using errcode='P0001';
  end if;
  v_status := case when round(p_summary_total,2)=v_detail_total then 'matched' else 'mismatch' end;
  v_check := jsonb_build_object('detail_batch_id',p_detail_batch_id,'source_as_of',v_summary.source_as_of,
    'summary_reported_total',round(p_summary_total,2)::numeric(12,2)::text,
    'detail_invoice_total',v_detail_total::text,'difference',(round(p_summary_total,2)-v_detail_total)::numeric(12,2)::text,
    'status',v_status,'invoice_count',v_invoice_count,'note',trim(p_note),'checked_by',p_actor,'checked_at',now());
  update collection_import_batches set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('detail_cross_check',v_check),updated_at=now()
    where id=p_summary_batch_id;
  insert into collection_import_audit(batch_id,actor,action,detail)
  values(p_summary_batch_id,p_actor,'summary_detail_cross_checked',v_check);
  return v_check;
end; $$;
revoke all on function tap_hub_project.cross_check_collection_import_reports(uuid,uuid,numeric,text,uuid) from public,anon,authenticated;
grant execute on function tap_hub_project.cross_check_collection_import_reports(uuid,uuid,numeric,text,uuid) to service_role;

create or replace function tap_hub_project.resolve_collection_import_discrepancy(
  p_source_invoice_id uuid, p_selected_source text, p_note text, p_actor uuid
) returns jsonb
language plpgsql security definer
set search_path = tap_hub_project, public as $$
declare
  v_identity collection_source_invoice_identities%rowtype;
  v_row collection_import_invoices%rowtype;
  v_billing_balance numeric(12,2);
begin
  if p_selected_source not in ('billing','pdf_import') or length(trim(coalesce(p_note,''))) < 8 then
    raise exception 'invalid_input: source and reconciliation note are required' using errcode = '22023';
  end if;
  select * into v_identity from collection_source_invoice_identities where source_invoice_id = p_source_invoice_id for update;
  if not found then raise exception 'not_found: imported invoice does not exist' using errcode = 'P0002'; end if;
  if v_identity.client_id is null then raise exception 'conflict: imported customer must be linked to a TAP Hub client' using errcode = 'P0001'; end if;
  perform set_config('tap_hub.actor_id', p_actor::text, true);
  if p_selected_source = 'billing' and v_identity.linked_invoice_id is null then
    raise exception 'conflict: no linked Billing invoice is available' using errcode = 'P0001';
  end if;
  select * into v_row from collection_import_invoices where source_invoice_id = p_source_invoice_id
    and review_status in ('approved','blocked') order by updated_at desc limit 1 for update;
  if not found then raise exception 'conflict: no approved snapshot is available' using errcode = 'P0001'; end if;
  if v_identity.linked_invoice_id is not null then
    select (coalesce((select sum(il.amount) from invoice_lines il where il.invoice_id = v_identity.linked_invoice_id),0)
      - coalesce((select sum(pa.amount) from payment_allocations pa join payments p on p.id = pa.payment_id
          where pa.invoice_id = v_identity.linked_invoice_id and pa.reversed_at is null and p.status = 'recorded'),0))::numeric(12,2)
      into v_billing_balance;
  end if;
  update collection_import_invoices set discrepancy_status = 'resolved', review_status = 'approved', updated_at = now()
    where id = v_row.id;
  update collection_source_invoice_identities set selected_source = p_selected_source, updated_at = now()
    where source_invoice_id = p_source_invoice_id;
  insert into collection_import_audit(batch_id, source_invoice_id, actor, action, detail)
  values (v_row.batch_id, p_source_invoice_id, p_actor, 'source_discrepancy_resolved', jsonb_build_object(
    'pdf_open_balance', v_row.open_balance, 'billing_open_balance', v_billing_balance,
    'difference', case when v_billing_balance is null then null else (v_row.open_balance - v_billing_balance)::numeric(12,2) end,
    'selected_source', p_selected_source, 'selected_balance', case when p_selected_source = 'billing' then v_billing_balance else v_row.open_balance end,
    'note', trim(p_note)
  ));
  return jsonb_build_object('source_invoice_id', p_source_invoice_id, 'selected_source', p_selected_source,
    'pdf_open_balance', v_row.open_balance, 'billing_open_balance', v_billing_balance, 'discrepancy_status', 'resolved');
end;
$$;
revoke all on function tap_hub_project.resolve_collection_import_discrepancy(uuid,text,text,uuid) from public, anon, authenticated;
grant execute on function tap_hub_project.resolve_collection_import_discrepancy(uuid,text,text,uuid) to service_role;

create or replace function tap_hub_project.resolve_collection_source_identity(
  p_client_id uuid, p_source text, p_invoice_id uuid, p_source_invoice_id uuid
) returns text
language plpgsql stable security definer
set search_path = tap_hub_project, public as $$
declare v_identity text;
begin
  if p_source = 'billing' and p_invoice_id is not null and p_source_invoice_id is null then
    select a.canonical_collection_identity into v_identity from collection_invoice_aliases a
      where a.source = 'billing' and a.invoice_id = p_invoice_id;
    if v_identity is null and exists(select 1 from invoices where id = p_invoice_id and client_id = p_client_id) then
      v_identity := 'billing:' || p_invoice_id::text;
    end if;
  elsif p_source = 'pdf_import' and p_invoice_id is null and p_source_invoice_id is not null then
    select a.canonical_collection_identity into v_identity from collection_invoice_aliases a
      where a.source = 'pdf_import' and a.source_invoice_id = p_source_invoice_id;
    if not exists(select 1 from collection_source_invoice_identities where source_invoice_id = p_source_invoice_id and client_id = p_client_id) then
      v_identity := null;
    end if;
  end if;
  if v_identity is null then raise exception 'invalid_input: exactly one invoice identity belonging to the client is required' using errcode = '22023'; end if;
  return v_identity;
end;
$$;

create or replace function tap_hub_project.record_collection_event_for_source(
  p_client_id uuid, p_source text, p_invoice_id uuid, p_source_invoice_id uuid,
  p_event_type text, p_actor uuid, p_stage integer default null,
  p_detail jsonb default '{}'::jsonb, p_approval_event_id uuid default null
) returns uuid
language plpgsql security definer set search_path = tap_hub_project, public as $$
declare v_identity text; v_event_id uuid; v_approval collection_events%rowtype;
begin
  perform 1 from clients where id = p_client_id for update;
  if not found then raise exception 'not_found: client does not exist' using errcode = 'P0002'; end if;
  v_identity := resolve_collection_source_identity(p_client_id,p_source,p_invoice_id,p_source_invoice_id);
  if p_event_type not in ('note','reminder_logged','call_logged','promise_to_pay','escalation_requested','formal_notice_requested','formal_notice_sent') then
    raise exception 'invalid_input: unsupported Collections event type' using errcode = '22023';
  end if;
  if p_event_type in ('escalation_requested','formal_notice_requested','formal_notice_sent') and exists(
    select 1 from collection_holds h where h.client_id = p_client_id and h.released_at is null
      and (h.expires_on is null or h.expires_on >= collections_firm_today())
      and (h.canonical_collection_identity is null or h.canonical_collection_identity = v_identity)
  ) then raise exception 'conflict: action blocked by an active Collections hold' using errcode = 'P0001'; end if;
  if p_event_type = 'formal_notice_sent' then
    select * into v_approval from collection_events where id = p_approval_event_id for update;
    if not found or v_approval.event_type <> 'formal_notice_approved' or v_approval.client_id <> p_client_id
      or v_approval.canonical_collection_identity is distinct from v_identity then
      raise exception 'conflict: matching formal notice approval required' using errcode = 'P0001';
    end if;
    insert into collection_events(client_id,invoice_id,source,source_invoice_id,canonical_collection_identity,event_type,actor,detail)
    values (p_client_id,p_invoice_id,p_source,p_source_invoice_id,v_identity,p_event_type,p_actor,
      coalesce(p_detail,'{}'::jsonb)||jsonb_build_object('approval_event_id',p_approval_event_id)) returning id into v_event_id;
  else
    insert into collection_events(client_id,invoice_id,source,source_invoice_id,canonical_collection_identity,event_type,stage,actor,detail)
    values (p_client_id,p_invoice_id,p_source,p_source_invoice_id,v_identity,p_event_type,p_stage,p_actor,coalesce(p_detail,'{}'::jsonb)) returning id into v_event_id;
  end if;
  return v_event_id;
end;
$$;

drop function if exists tap_hub_project.approve_collection_event_for_source(uuid,text,uuid,jsonb);
create function tap_hub_project.approve_collection_event_for_source(
  p_event_id uuid, p_event_type text, p_actor uuid, p_detail jsonb default '{}'::jsonb,
  p_source text default null, p_invoice_id uuid default null, p_source_invoice_id uuid default null
) returns uuid language plpgsql security definer
set search_path = tap_hub_project, public as $$
declare v_source collection_events%rowtype; v_event_id uuid;
begin
  select * into v_source from collection_events where id = p_event_id for update;
  if not found then raise exception 'not_found: source event does not exist' using errcode = 'P0002'; end if;
  if p_source is not null then
    if resolve_collection_source_identity(v_source.client_id,p_source,p_invoice_id,p_source_invoice_id)
      is distinct from v_source.canonical_collection_identity then
      raise exception 'conflict: approval target does not match source event' using errcode = 'P0001';
    end if;
  end if;
  perform 1 from clients where id = v_source.client_id for update;
  if (v_source.event_type = 'escalation_requested' and p_event_type <> 'escalated')
    or (v_source.event_type = 'formal_notice_requested' and p_event_type <> 'formal_notice_approved')
    or v_source.event_type not in ('escalation_requested','formal_notice_requested') then
    raise exception 'conflict: approval event does not match a pending request' using errcode = 'P0001';
  end if;
  if exists(select 1 from collection_events where approves_event_id = p_event_id) then
    raise exception 'conflict: source request has already been approved' using errcode = 'P0001';
  end if;
  if exists(select 1 from collection_holds h where h.client_id = v_source.client_id and h.released_at is null
    and (h.expires_on is null or h.expires_on >= collections_firm_today())
    and (h.canonical_collection_identity is null or h.canonical_collection_identity = v_source.canonical_collection_identity)) then
    raise exception 'conflict: action blocked by an active Collections hold' using errcode = 'P0001';
  end if;
  insert into collection_events(client_id,invoice_id,source,source_invoice_id,canonical_collection_identity,event_type,actor,detail,approves_event_id)
  values (v_source.client_id,v_source.invoice_id,v_source.source,v_source.source_invoice_id,v_source.canonical_collection_identity,p_event_type,p_actor,coalesce(p_detail,'{}'::jsonb),p_event_id)
  returning id into v_event_id;
  return v_event_id;
end; $$;

create or replace function tap_hub_project.place_collection_hold_for_source(
  p_client_id uuid, p_source text, p_invoice_id uuid, p_source_invoice_id uuid,
  p_reason text, p_actor uuid, p_expires_on date
) returns uuid language plpgsql security definer
set search_path = tap_hub_project, public as $$
declare v_identity text; v_hold_id uuid;
begin
  perform 1 from clients where id = p_client_id for update;
  if not found then raise exception 'not_found: client does not exist' using errcode = 'P0002'; end if;
  if p_expires_on is not null and p_expires_on < collections_firm_today() then raise exception 'invalid_input: hold expiry cannot be in the past' using errcode = '22023'; end if;
  if (p_invoice_id is null and p_source_invoice_id is null) then
    v_identity := null;
    if p_source not in ('billing','pdf_import') then raise exception 'invalid_input: invalid source' using errcode = '22023'; end if;
  else
    v_identity := resolve_collection_source_identity(p_client_id,p_source,p_invoice_id,p_source_invoice_id);
  end if;
  insert into collection_holds(client_id,invoice_id,source,source_invoice_id,canonical_collection_identity,reason,placed_by,expires_on)
  values (p_client_id,p_invoice_id,p_source,p_source_invoice_id,v_identity,p_reason,p_actor,p_expires_on) returning id into v_hold_id;
  insert into collection_events(client_id,invoice_id,source,source_invoice_id,canonical_collection_identity,event_type,actor,detail)
  values (p_client_id,p_invoice_id,p_source,p_source_invoice_id,v_identity,'hold_placed',p_actor,jsonb_build_object('hold_id',v_hold_id,'reason',p_reason,'expires_on',p_expires_on));
  return v_hold_id;
end; $$;

create or replace function tap_hub_project.release_collection_hold(p_hold_id uuid, p_actor uuid)
returns uuid language plpgsql security definer
set search_path = tap_hub_project, public as $$
declare v_hold collection_holds%rowtype;
begin
  perform set_config('tap_hub.actor_id', p_actor::text, true);
  select * into v_hold from collection_holds where id = p_hold_id for update;
  if not found or v_hold.released_at is not null then raise exception 'conflict: active hold does not exist' using errcode = 'P0001'; end if;
  perform 1 from clients where id = v_hold.client_id for update;
  update collection_holds set released_by = p_actor, released_at = now() where id = p_hold_id;
  insert into collection_events(client_id,invoice_id,source,source_invoice_id,canonical_collection_identity,event_type,actor,detail)
  values (v_hold.client_id,v_hold.invoice_id,v_hold.source,v_hold.source_invoice_id,v_hold.canonical_collection_identity,'hold_released',p_actor,jsonb_build_object('hold_id',p_hold_id));
  return p_hold_id;
end; $$;

revoke all on function tap_hub_project.resolve_collection_source_identity(uuid,text,uuid,uuid) from public, anon, authenticated;
revoke all on function tap_hub_project.record_collection_event_for_source(uuid,text,uuid,uuid,text,uuid,integer,jsonb,uuid) from public, anon, authenticated;
revoke all on function tap_hub_project.approve_collection_event_for_source(uuid,text,uuid,jsonb,text,uuid,uuid) from public, anon, authenticated;
revoke all on function tap_hub_project.place_collection_hold_for_source(uuid,text,uuid,uuid,text,uuid,date) from public, anon, authenticated;
grant execute on function tap_hub_project.resolve_collection_source_identity(uuid,text,uuid,uuid) to service_role;
grant execute on function tap_hub_project.record_collection_event_for_source(uuid,text,uuid,uuid,text,uuid,integer,jsonb,uuid) to service_role;
grant execute on function tap_hub_project.approve_collection_event_for_source(uuid,text,uuid,jsonb,text,uuid,uuid) to service_role;
grant execute on function tap_hub_project.place_collection_hold_for_source(uuid,text,uuid,uuid,text,uuid,date) to service_role;

create or replace function tap_hub_project.block_stale_collection_imports()
returns trigger language plpgsql security definer
set search_path = tap_hub_project, public as $$
declare
  v_invoice_id uuid;
  v_changed_at timestamptz := now();
  v_billing_balance numeric(12,2);
  v_source record;
  v_timezone text;
begin
  if tg_table_name = 'payment_allocations' then
    v_invoice_id := coalesce(new.invoice_id, old.invoice_id);
    v_changed_at := now();
  elsif tg_table_name = 'invoice_lines' then
    v_invoice_id := coalesce(new.invoice_id, old.invoice_id);
    v_changed_at := now();
  elsif tg_table_name = 'payments' then
    select pa.invoice_id into v_invoice_id from payment_allocations pa
      where pa.payment_id = coalesce(new.id, old.id) order by pa.created_at desc limit 1;
    v_changed_at := now();
  else
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if v_invoice_id is null then if tg_op = 'DELETE' then return old; else return new; end if; end if;
  select timezone into v_timezone from collection_settings where id = 'default';
  if (v_changed_at at time zone coalesce(v_timezone, 'America/Chicago'))::date <
     (select max(i.source_as_of) from collection_import_invoices i
       join collection_source_invoice_identities s using (source_invoice_id)
       where s.linked_invoice_id = v_invoice_id and i.review_status = 'approved') then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  select (coalesce((select sum(il.amount) from invoice_lines il where il.invoice_id = v_invoice_id),0)
      - coalesce((select sum(pa.amount) from payment_allocations pa join payments p on p.id = pa.payment_id
          where pa.invoice_id = v_invoice_id and pa.reversed_at is null and p.status = 'recorded'),0))::numeric(12,2)
    into v_billing_balance;
  for v_source in
    select distinct i.source_invoice_id, i.batch_id, i.open_balance, i.source_as_of
    from collection_import_invoices i join collection_source_invoice_identities s using (source_invoice_id)
    where s.linked_invoice_id = v_invoice_id and i.review_status = 'approved'
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
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

drop trigger if exists collections_stale_snapshot_allocations on tap_hub_project.payment_allocations;
create trigger collections_stale_snapshot_allocations after insert or update or delete on tap_hub_project.payment_allocations
  for each row execute function tap_hub_project.block_stale_collection_imports();
drop trigger if exists collections_stale_snapshot_invoice_lines on tap_hub_project.invoice_lines;
create trigger collections_stale_snapshot_invoice_lines after insert or update or delete on tap_hub_project.invoice_lines
  for each row execute function tap_hub_project.block_stale_collection_imports();
drop trigger if exists collections_stale_snapshot_payments on tap_hub_project.payments;
create trigger collections_stale_snapshot_payments after update on tap_hub_project.payments
  for each row when (old.status is distinct from new.status or old.reversed_at is distinct from new.reversed_at)
  execute function tap_hub_project.block_stale_collection_imports();

alter table tap_hub_project.collection_import_batches enable row level security;
alter table tap_hub_project.collection_source_invoice_identities enable row level security;
alter table tap_hub_project.collection_import_invoices enable row level security;
alter table tap_hub_project.collection_import_rows enable row level security;
alter table tap_hub_project.collection_import_invoice_revisions enable row level security;
alter table tap_hub_project.collection_invoice_aliases enable row level security;
alter table tap_hub_project.collection_import_audit enable row level security;
alter table tap_hub_project.collection_import_permissions enable row level security;
revoke all on tap_hub_project.collection_import_batches, tap_hub_project.collection_source_invoice_identities, tap_hub_project.collection_import_invoices,
  tap_hub_project.collection_import_rows, tap_hub_project.collection_invoice_aliases,
  tap_hub_project.collection_import_invoice_revisions, tap_hub_project.collection_import_audit,
  tap_hub_project.collection_import_permissions from anon, authenticated;
grant all on tap_hub_project.collection_import_batches, tap_hub_project.collection_source_invoice_identities, tap_hub_project.collection_import_invoices,
  tap_hub_project.collection_import_rows, tap_hub_project.collection_invoice_aliases,
  tap_hub_project.collection_import_invoice_revisions, tap_hub_project.collection_import_audit,
  tap_hub_project.collection_import_permissions to service_role;

drop trigger if exists audit_collection_import_batches on tap_hub_project.collection_import_batches;
create trigger audit_collection_import_batches after insert or update or delete on tap_hub_project.collection_import_batches
  for each row execute function tap_hub_project.audit_billing_row();
drop trigger if exists audit_collection_import_invoices on tap_hub_project.collection_import_invoices;
create trigger audit_collection_import_invoices after insert or update or delete on tap_hub_project.collection_import_invoices
  for each row execute function tap_hub_project.audit_billing_row();
drop trigger if exists audit_collection_import_invoice_revisions on tap_hub_project.collection_import_invoice_revisions;
create trigger audit_collection_import_invoice_revisions after insert or update or delete on tap_hub_project.collection_import_invoice_revisions
  for each row execute function tap_hub_project.audit_billing_row();
drop trigger if exists audit_collection_source_invoice_identities on tap_hub_project.collection_source_invoice_identities;
create trigger audit_collection_source_invoice_identities after insert or update or delete on tap_hub_project.collection_source_invoice_identities
  for each row execute function tap_hub_project.audit_billing_row();
drop trigger if exists audit_collection_invoice_aliases on tap_hub_project.collection_invoice_aliases;
create trigger audit_collection_invoice_aliases after insert or update or delete on tap_hub_project.collection_invoice_aliases
  for each row execute function tap_hub_project.audit_billing_row();
drop trigger if exists audit_collection_import_permissions on tap_hub_project.collection_import_permissions;
create trigger audit_collection_import_permissions after insert or update or delete on tap_hub_project.collection_import_permissions
  for each row execute function tap_hub_project.audit_billing_row();

-- Bucket is private. The application accesses objects only after Collections
-- authorization and writes a corresponding access-audit row.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('collections-ar-pdfs', 'collections-ar-pdfs', false, 26214400, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 26214400,
  allowed_mime_types = array['application/pdf'];
drop policy if exists collections_ar_pdf_service_only on storage.objects;
create policy collections_ar_pdf_service_only on storage.objects
  for all to service_role using (bucket_id = 'collections-ar-pdfs') with check (bucket_id = 'collections-ar-pdfs');

commit;
