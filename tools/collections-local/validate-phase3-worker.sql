-- Phase 4 (20261019100000) makes canonical_collection_identity required on attempts; Billing
-- attempts here use 'billing:<invoice_id>'.
-- Usage (local harness only, after reset.sh --local):
--   psql postgresql://postgres:postgres@127.0.0.1:55322/postgres -X -A -t -F ' | ' -f tools/collections-local/validate-phase3-worker.sql
-- Expected: W1 t/sending 1, W2 t, W3 t/t/1/accepted, W4 completed_stage 3, W5 DELIVERY_DISABLED,
-- W6 SYNTHETIC_DATA_REQUIRED, W7 ACTIVE_HOLD, W9 EMAIL_CONTACT_MISSING, W10 APPROVAL_REQUIRED,
-- W8 OUTSIDE_SEND_WINDOW, W11 STAGE_NOT_DUE (codes from migration 20261018110000), W12 0 grants and
-- the pause error, W13 fingerprint: first t, same t, changed f, malformed rejected.
-- Phase 3 worker RPC checks against the LOCAL harness only (port 55322).
-- Every block runs inside BEGIN ... ROLLBACK: nothing persists and no provider
-- is called (these are database functions only).
-- W12 and W13 deliberately trigger errors, so keep going after one.
\set ON_ERROR_STOP off
\set owner '00000000-0000-4000-8000-000000000001'
\set inv1 '20000000-0000-4000-8000-000000000001'
\set cli1 '10000000-0000-4000-8000-000000000001'

-- Shared setup for each block: test mode on, automation on, always inside the send window.
\set setup 'update tap_hub_project.collection_settings set automation_enabled = true, delivery_mode = ''test'', test_recipient = ''test@example.invalid'', weekdays_only = false, send_start = ''00:00'', send_end = ''23:59:59'' where id = ''default'';'

-- W1-W4: claim, accept, exactly one reminder_logged, replay is a no-op, stage context counts one stage.
begin;
:setup
insert into tap_hub_project.collection_delivery_attempts (id, client_id, invoice_id, stage, status, idempotency_key, actor, canonical_collection_identity)
values ('30000000-0000-4000-8000-000000000001', :'cli1', :'inv1', 3, 'queued', 'collections:test:w1', :'owner', 'billing:' || :'inv1');
select 'W1 claim returns null (eligible)', tap_hub_project.claim_collection_test_delivery('30000000-0000-4000-8000-000000000001', :'owner') is null;
select 'W1 status after claim', status, attempt_count from tap_hub_project.collection_delivery_attempts where id = '30000000-0000-4000-8000-000000000001';
select 'W2 message context has no email/name keys', not (ctx ? 'email' or ctx ? 'contact_email' or ctx ? 'client_name'), ctx->>'eligible'
  from (select tap_hub_project.get_collection_test_message_context('30000000-0000-4000-8000-000000000001') ctx) x;
select 'W3 first accept', tap_hub_project.accept_collection_delivery('30000000-0000-4000-8000-000000000001', 'msg_local_1', :'owner');
select 'W3 replay accept is refused', tap_hub_project.accept_collection_delivery('30000000-0000-4000-8000-000000000001', 'msg_local_2', :'owner') = false;
select 'W3 reminder_logged count', count(*) from tap_hub_project.collection_events
  where event_type = 'reminder_logged' and detail->>'delivery_attempt_id' = '30000000-0000-4000-8000-000000000001';
select 'W3 accepted row', status, provider_message_id, accepted_at is not null from tap_hub_project.collection_delivery_attempts where id = '30000000-0000-4000-8000-000000000001';
select 'W4 stage context after accept', tap_hub_project.collections_invoice_stage_context(:'cli1', :'inv1', i.due_date, tap_hub_project.collections_firm_today())
  from tap_hub_project.invoices i where i.id = :'inv1';
select 'W4 audit actor on attempt rows', count(*) filter (where actor = :'owner'), count(*) from tap_hub_project.audit_log
  where entity = 'collection_delivery_attempts' and entity_id = '30000000-0000-4000-8000-000000000001';
rollback;

-- W5: automation off -> DELIVERY_DISABLED.
begin;
insert into tap_hub_project.collection_delivery_attempts (id, client_id, invoice_id, stage, status, idempotency_key, canonical_collection_identity)
values ('30000000-0000-4000-8000-000000000005', :'cli1', :'inv1', 3, 'queued', 'collections:test:w5', 'billing:' || :'inv1');
select 'W5 automation off', tap_hub_project.claim_collection_test_delivery('30000000-0000-4000-8000-000000000005', :'owner');
rollback;

-- W6: non-synthetic invoice -> SYNTHETIC_DATA_REQUIRED.
begin;
:setup
update tap_hub_project.invoices set is_synthetic = false where id = :'inv1';
insert into tap_hub_project.collection_delivery_attempts (id, client_id, invoice_id, stage, status, idempotency_key, canonical_collection_identity)
values ('30000000-0000-4000-8000-000000000006', :'cli1', :'inv1', 3, 'queued', 'collections:test:w6', 'billing:' || :'inv1');
select 'W6 non-synthetic invoice', tap_hub_project.claim_collection_test_delivery('30000000-0000-4000-8000-000000000006', :'owner');
rollback;

-- W7: active hold -> ACTIVE_HOLD.
begin;
:setup
insert into tap_hub_project.collection_holds (client_id, invoice_id, reason, placed_by) values (:'cli1', :'inv1', 'local test hold', :'owner');
insert into tap_hub_project.collection_delivery_attempts (id, client_id, invoice_id, stage, status, idempotency_key, canonical_collection_identity)
values ('30000000-0000-4000-8000-000000000007', :'cli1', :'inv1', 3, 'queued', 'collections:test:w7', 'billing:' || :'inv1');
select 'W7 active hold', tap_hub_project.claim_collection_test_delivery('30000000-0000-4000-8000-000000000007', :'owner');
rollback;

-- W8: weekday-only on a weekend / outside the send window -> which code?
begin;
:setup
update tap_hub_project.collection_settings set weekdays_only = true where id = 'default';
insert into tap_hub_project.collection_delivery_attempts (id, client_id, invoice_id, stage, status, idempotency_key, canonical_collection_identity)
values ('30000000-0000-4000-8000-000000000008', :'cli1', :'inv1', 3, 'queued', 'collections:test:w8', 'billing:' || :'inv1');
select 'W8 weekend with weekdays_only (today isodow=' || extract(isodow from tap_hub_project.collections_firm_today()) || ')',
  tap_hub_project.claim_collection_test_delivery('30000000-0000-4000-8000-000000000008', :'owner');
rollback;

-- W9: primary contact without email -> EMAIL_CONTACT_MISSING (stage 1-3).
begin;
:setup
update tap_hub_project.contacts set email = null where client_id = :'cli1' and is_primary;
insert into tap_hub_project.collection_delivery_attempts (id, client_id, invoice_id, stage, status, idempotency_key, canonical_collection_identity)
values ('30000000-0000-4000-8000-000000000009', :'cli1', :'inv1', 3, 'queued', 'collections:test:w9', 'billing:' || :'inv1');
select 'W9 primary without email', tap_hub_project.claim_collection_test_delivery('30000000-0000-4000-8000-000000000009', :'owner');
rollback;

-- W10: stage 5 needs formal_notice_approved; accept of stage 5 writes no reminder_logged.
begin;
:setup
insert into tap_hub_project.collection_delivery_attempts (id, client_id, invoice_id, stage, status, idempotency_key, canonical_collection_identity)
values ('30000000-0000-4000-8000-00000000000a', :'cli1', :'inv1', 5, 'queued', 'collections:test:w10', 'billing:' || :'inv1');
select 'W10 stage 5 without approval', tap_hub_project.claim_collection_test_delivery('30000000-0000-4000-8000-00000000000a', :'owner');
rollback;

-- W11: wrong stage for the invoice (stage 1 when next is 3) -> refused.
begin;
:setup
insert into tap_hub_project.collection_delivery_attempts (id, client_id, invoice_id, stage, status, idempotency_key, canonical_collection_identity)
values ('30000000-0000-4000-8000-00000000000b', :'cli1', :'inv1', 1, 'queued', 'collections:test:w11', 'billing:' || :'inv1');
select 'W11 out-of-order stage', tap_hub_project.claim_collection_test_delivery('30000000-0000-4000-8000-00000000000b', :'owner');
rollback;

-- W12: pause RPC rejects an unknown actor; RPCs are not callable by anon/authenticated.
begin;
select 'W12 anon/authenticated EXECUTE on Phase 3 RPCs', count(*) from information_schema.routine_privileges
  where routine_schema = 'tap_hub_project' and grantee in ('anon', 'authenticated', 'PUBLIC')
  and routine_name in ('pause_collections_automation', 'accept_collection_delivery', 'claim_collection_test_delivery', 'get_collection_test_message_context');
rollback;
begin;
select 'W12 pause with unknown actor';
select tap_hub_project.pause_collections_automation('99999999-0000-4000-8000-000000000000');
rollback;

-- W13: payload fingerprint (migration 20261018110000). A retry may only reuse the
-- idempotency key with the identical payload; a changed payload is refused.
begin;
:setup
insert into tap_hub_project.collection_delivery_attempts (id, client_id, invoice_id, stage, status, idempotency_key, actor, canonical_collection_identity)
values ('30000000-0000-4000-8000-00000000000d', :'cli1', :'inv1', 3, 'queued', 'collections:test:w13', :'owner', 'billing:' || :'inv1');
select tap_hub_project.claim_collection_test_delivery('30000000-0000-4000-8000-00000000000d', :'owner') is null as claimed \gset w13_
select 'W13 first fingerprint stored', tap_hub_project.record_collection_test_payload_fingerprint('30000000-0000-4000-8000-00000000000d', repeat('a', 64), :'owner');
select 'W13 same payload accepted', tap_hub_project.record_collection_test_payload_fingerprint('30000000-0000-4000-8000-00000000000d', repeat('a', 64), :'owner');
select 'W13 changed payload refused', tap_hub_project.record_collection_test_payload_fingerprint('30000000-0000-4000-8000-00000000000d', repeat('b', 64), :'owner') = false;
rollback;
begin;
select 'W13 malformed fingerprint';
select tap_hub_project.record_collection_test_payload_fingerprint('30000000-0000-4000-8000-00000000000d', 'not-a-digest', null);
rollback;
