-- Sandbox initialization of the canonical Collections defaults.
-- The schema-only bootstrap intentionally contains no application/config rows.
-- Values match supabase/migrations/20261010120000_collections_automation_foundation.sql.
-- Automation and delivery remain disabled; this creates no client/report data.
begin;

insert into tap_hub_project.collection_settings(id)
values ('default')
on conflict (id) do nothing;

insert into tap_hub_project.collection_ladder_rules
  (stage, label, days_past_due, automatic, subject_template, body_template)
values
  (1, 'Friendly', 1, true,
   'Reminder about invoice {invoice_number}',
   'Hello {contact_name},\n\nThis is a friendly reminder that invoice {invoice_number} for {balance} was due on {due_date}. If payment has already been arranged, please disregard this message.\n\nPlease contact our office if you have any questions.'),
  (2, 'Professional', 5, true,
   'Past due: invoice {invoice_number}',
   'Hello {contact_name},\n\nOur records show invoice {invoice_number} for {balance} is {days_past_due} days past due. Please arrange payment or let us know if payment is in progress.\n\nIf there is an issue with the invoice, please contact our office so we can review it.'),
  (3, 'Firm', 15, true,
   'Follow-up required: invoice {invoice_number}',
   'Hello {contact_name},\n\nInvoice {invoice_number} for {balance}, due {due_date}, is now {days_past_due} days past due. Please contact our office to arrange payment or discuss any question about this invoice.'),
  (4, 'Owner escalation', 21, false,
   'Owner review required: invoice {invoice_number}',
   'Internal review only. This action is never sent to the client automatically.'),
  (5, 'Formal notice', 28, false,
   'Formal notice requires approval: invoice {invoice_number}',
   'Draft only. Owner/Admin approval and separately approved wording are required before any notice is sent.')
on conflict (stage) do nothing;

commit;
