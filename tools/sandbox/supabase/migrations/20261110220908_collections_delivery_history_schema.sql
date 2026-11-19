-- Restore the delivery-history schema expected by the source-aware API without
-- replacing the newer Sandbox claim function that enforces PDF discrepancy gates.
begin;

alter table tap_hub_project.collection_delivery_attempts
  add column if not exists reason_code text,
  add column if not exists accepted_at timestamptz,
  add column if not exists payload_fingerprint text;

-- Preserve legacy accepted-send timestamps before migrating the status label.
update tap_hub_project.collection_delivery_attempts
set accepted_at = coalesce(accepted_at, sent_at, updated_at)
where status = 'sent' and accepted_at is null;

alter table tap_hub_project.collection_delivery_attempts
  drop constraint if exists collection_delivery_attempts_status_check;
update tap_hub_project.collection_delivery_attempts
set status = 'accepted'
where status = 'sent';
alter table tap_hub_project.collection_delivery_attempts
  add constraint collection_delivery_attempts_status_check
  check (status in ('queued', 'sending', 'accepted', 'suppressed', 'needs_review', 'failed')) not valid;
alter table tap_hub_project.collection_delivery_attempts
  validate constraint collection_delivery_attempts_status_check;

create index if not exists idx_collection_delivery_history
  on tap_hub_project.collection_delivery_attempts(created_at desc, id desc);
create unique index if not exists idx_collection_reminder_delivery_once
  on tap_hub_project.collection_events ((detail->>'delivery_attempt_id'))
  where event_type = 'reminder_logged' and detail ? 'delivery_attempt_id';

notify pgrst, 'reload schema';
commit;
