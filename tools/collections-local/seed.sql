-- Entirely fictional records for local Collections tests.
insert into tap_hub_project.profiles (id, full_name, email, role, modules)
values
  ('00000000-0000-4000-8000-000000000001', 'Local Owner', 'owner@example.invalid', 'owner', array['billing','collections']),
  ('00000000-0000-4000-8000-000000000002', 'Local Collections Staff', 'staff@example.invalid', 'staff', array['collections']),
  ('00000000-0000-4000-8000-000000000003', 'Local Admin', 'admin@example.invalid', 'admin', '{}'),
  ('00000000-0000-4000-8000-000000000004', 'Local Billing Staff', 'billing@example.invalid', 'staff', array['billing']),
  ('00000000-0000-4000-8000-000000000005', 'Local Unassigned Staff', 'unassigned@example.invalid', 'staff', array['timesheet']);

insert into tap_hub_project.clients (id, name, client_code, group_name, address, city, state, zip, type, status)
values
  ('10000000-0000-4000-8000-000000000001', 'Example Orchard LLC', 'LOCAL-CLIENT-001', 'Local Example Group', '100 Fictional Oak St', 'Sampletown', 'TX', '70001', 'business', 'active'),
  ('10000000-0000-4000-8000-000000000002', 'Sample Harbor Inc', 'LOCAL-CLIENT-002', 'Local Sample Group', '200 Imaginary Bay Ave', 'Demoville', 'TX', '70002', 'business', 'active');

insert into tap_hub_project.contacts (client_id, category, is_primary, name, email, phone)
values
  ('10000000-0000-4000-8000-000000000001', 'client', true, 'Alex Example', 'alex@example.invalid', '555-0101'),
  ('10000000-0000-4000-8000-000000000002', 'client', true, 'Sam Sample', 'sam@example.invalid', '555-0102');

insert into tap_hub_project.invoices (id, client_id, invoice_number, status, issue_date, due_date, created_by)
values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'LOCAL-001', 'issued', tap_hub_project.collections_firm_today() - 70, tap_hub_project.collections_firm_today() - 40, '00000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'LOCAL-002', 'issued', tap_hub_project.collections_firm_today() - 45, tap_hub_project.collections_firm_today() - 15, '00000000-0000-4000-8000-000000000001');

insert into tap_hub_project.invoice_lines (invoice_id, description, quantity, unit_amount, amount, created_by)
values
  ('20000000-0000-4000-8000-000000000001', 'Example service', 1, 125, 125, '00000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', 'Sample service', 1, 80, 80, '00000000-0000-4000-8000-000000000001');
