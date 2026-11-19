-- Entirely fictional records for local Collections tests.
insert into tap_hub_project.profiles (id, full_name, email, role, modules)
values
  ('00000000-0000-4000-8000-000000000001', 'Local Owner', 'owner@example.invalid', 'owner', array['billing','collections']),
  ('00000000-0000-4000-8000-000000000002', 'Local Collections Staff', 'staff@example.invalid', 'staff', array['collections']),
  ('00000000-0000-4000-8000-000000000003', 'Local Admin', 'admin@example.invalid', 'admin', '{}'),
  ('00000000-0000-4000-8000-000000000004', 'Local Billing Staff', 'billing@example.invalid', 'staff', array['billing']),
  ('00000000-0000-4000-8000-000000000005', 'Local Unassigned Staff', 'unassigned@example.invalid', 'staff', array['timesheet']);

insert into tap_hub_project.clients (id, name, client_code, group_name, address, city, state, zip, type, status, is_synthetic)
values
  ('10000000-0000-4000-8000-000000000001', 'Example Orchard LLC', 'LOCAL-CLIENT-001', 'Local Example Group', '100 Fictional Oak St', 'Sampletown', 'TX', '70001', 'business', 'active', true),
  ('10000000-0000-4000-8000-000000000002', 'Sample Harbor Inc', 'LOCAL-CLIENT-002', 'Local Sample Group', '200 Imaginary Bay Ave', 'Demoville', 'TX', '70002', 'business', 'active', true);

insert into tap_hub_project.services (id, code, name, active, tracking)
values
  ('30000000-0000-4000-8000-000000000001', 'LOCAL-REC', 'Synthetic recurring bookkeeping', true, 'manual'),
  ('30000000-0000-4000-8000-000000000002', 'LOCAL-STAGE', 'Synthetic completion-tracked service', true, 'stage'),
  ('30000000-0000-4000-8000-000000000003', 'LOCAL-COUNT', 'Synthetic count-tracked service', true, 'count');

insert into tap_hub_project.client_services (id, client_id, service_id, active, frequency)
values
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', true, 'monthly'),
  ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', true, 'monthly'),
  ('40000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003', true, 'monthly');

-- Give each synthetic Operations assignment an explicit Billing source map and
-- a deterministic rate so local schedule and candidate flows exercise the
-- same required configuration as a real client.
insert into tap_hub_project.billing_rate_cards (id, name, active, effective_from, created_by, updated_by, reason)
values ('50000000-0000-4000-8000-000000000001', 'Local synthetic test rates', true, '2026-01-01', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'Synthetic local fixture')
on conflict (id) do nothing;

insert into tap_hub_project.billing_rate_card_entries (id, rate_card_id, service_code, unit, unit_amount, effective_from, created_by, updated_by, reason)
values
  ('51000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'LOCAL-REC', 'service', 150.00, '2026-01-01', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'Synthetic local fixture'),
  ('51000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000001', 'LOCAL-STAGE', 'service', 225.00, '2026-01-01', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'Synthetic local fixture'),
  ('51000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000001', 'LOCAL-COUNT', 'count', 25.00, '2026-01-01', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'Synthetic local fixture')
on conflict (id) do nothing;

insert into tap_hub_project.billing_completion_source_maps (id, client_service_id, adapter, predicate, identity_fields, candidate_date_rule, effective_from, enabled, created_by, updated_by, reason)
values
  ('52000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'schedule', '{}'::jsonb, array['client_service_id','period'], 'period_end', '2026-01-01', true, '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'Synthetic recurring schedule fixture'),
  ('52000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', 'work_period_done', '{"stage":"done"}'::jsonb, array['client_service_id','period'], 'period_end', '2026-01-01', true, '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'Synthetic work completion fixture'),
  ('52000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000003', 'period_count_threshold', '{"threshold":2}'::jsonb, array['client_service_id','period'], 'period_end', '2026-01-01', true, '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'Synthetic count threshold fixture')
on conflict (id) do nothing;

insert into tap_hub_project.work_periods (client_service_id, period, stage, done_at)
values
  ('40000000-0000-4000-8000-000000000002', '2026-10', 'done', '2026-10-20T15:00:00Z'),
  ('40000000-0000-4000-8000-000000000002', '2026-11', 'in_progress', null);

insert into tap_hub_project.period_counts (client_service_id, period, processed, expected)
values
  ('40000000-0000-4000-8000-000000000003', '2026-10', 2, 2),
  ('40000000-0000-4000-8000-000000000003', '2026-11', 0, 2);

insert into tap_hub_project.contacts (client_id, category, is_primary, name, email, phone)
values
  ('10000000-0000-4000-8000-000000000001', 'client', true, 'Alex Example', 'alex@example.invalid', '555-0101'),
  ('10000000-0000-4000-8000-000000000002', 'client', true, 'Sam Sample', 'sam@example.invalid', '555-0102');

insert into tap_hub_project.invoices (id, client_id, invoice_number, status, issue_date, due_date, created_by, is_synthetic)
values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', null, 'draft', null, null, '00000000-0000-4000-8000-000000000001', true),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', null, 'draft', null, null, '00000000-0000-4000-8000-000000000001', true);

insert into tap_hub_project.invoice_lines (invoice_id, description, quantity, unit_amount, amount, created_by)
values
  ('20000000-0000-4000-8000-000000000001', 'Example service', 1, 125, 125, '00000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', 'Sample service', 1, 80, 80, '00000000-0000-4000-8000-000000000001');

-- The invoice-transition guard requires an explicit active actor even for
-- synthetic seed transitions. This seed runs in its own psql session.
select set_config('tap_hub.actor_id', '00000000-0000-4000-8000-000000000001', false);

update tap_hub_project.invoices
set status = 'issued', invoice_number = 'LOCAL-001', issue_date = tap_hub_project.collections_firm_today() - 70, due_date = tap_hub_project.collections_firm_today() - 40,
    presentation_snapshot = (select jsonb_strip_nulls(jsonb_build_object('firmName', firm_name, 'tagline', tagline, 'invoiceFooter', invoice_footer)) from tap_hub_project.billing_presentation_settings where singleton)
where id = '20000000-0000-4000-8000-000000000001';

update tap_hub_project.invoices
set status = 'issued', invoice_number = 'LOCAL-002', issue_date = tap_hub_project.collections_firm_today() - 45, due_date = tap_hub_project.collections_firm_today() - 15,
    presentation_snapshot = (select jsonb_strip_nulls(jsonb_build_object('firmName', firm_name, 'tagline', tagline, 'invoiceFooter', invoice_footer)) from tap_hub_project.billing_presentation_settings where singleton)
where id = '20000000-0000-4000-8000-000000000002';
