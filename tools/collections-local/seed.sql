-- Entirely fictional records for local Collections tests.
insert into tap_hub_project.profiles (id, full_name, email, role, modules)
values
  ('00000000-0000-4000-8000-000000000001', 'Local Owner', 'owner@example.invalid', 'owner', array['billing','collections']),
  ('00000000-0000-4000-8000-000000000002', 'Local Staff', 'staff@example.invalid', 'staff', array['collections']);

insert into tap_hub_project.clients (id, name, type, status)
values
  ('10000000-0000-4000-8000-000000000001', 'Example Orchard LLC', 'business', 'active'),
  ('10000000-0000-4000-8000-000000000002', 'Sample Harbor Inc', 'business', 'active');

insert into tap_hub_project.contacts (client_id, category, is_primary, name, email, phone)
values
  ('10000000-0000-4000-8000-000000000001', 'client', true, 'Alex Example', 'alex@example.invalid', '555-0101'),
  ('10000000-0000-4000-8000-000000000002', 'client', true, 'Sam Sample', 'sam@example.invalid', '555-0102');

insert into tap_hub_project.invoices (id, client_id, invoice_number, status, issue_date, due_date, created_by)
values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'LOCAL-001', 'issued', current_date - 70, current_date - 40, '00000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'LOCAL-002', 'issued', current_date - 45, current_date - 15, '00000000-0000-4000-8000-000000000001');

insert into tap_hub_project.invoice_lines (invoice_id, description, quantity, unit_amount, amount, created_by)
values
  ('20000000-0000-4000-8000-000000000001', 'Example service', 1, 125, 125, '00000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', 'Sample service', 1, 80, 80, '00000000-0000-4000-8000-000000000001');
