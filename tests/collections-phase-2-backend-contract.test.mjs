import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const migration = await read("supabase/migrations/20261010120000_collections_automation_foundation.sql");
const followupMigration = await read("supabase/migrations/20261010130000_collections_shared_date_and_stage_model.sql");
const catchUpMigration = await read("supabase/migrations/20261011100000_collections_catch_up_policy.sql");
const stageContextMigration = await read("supabase/migrations/20261011110000_collections_stage_context_and_timezone.sql");
const dynamicRulesMigration = await read("supabase/migrations/20261011120000_collections_dynamic_rules.sql");
const receivablesRoute = await read("app/api/collections/receivables/route.ts");
const previewRoute = await read("app/api/collections/automation/preview/route.ts");
const rulesRoute = await read("app/api/collections/rules/route.ts");
const contactsRoute = await read("app/api/contacts/route.ts");
const eventRoute = await read("app/api/collections/events/route.ts");
const holdsRoute = await read("app/api/collections/holds/route.ts");
const localBootstrap = await read("tools/collections-local/supabase/migrations/00000000000000_local_collections_bootstrap.sql");
const localUsers = await read("tools/collections-local/create-test-users.mjs");
const contracts = await read("lib/collections-api.ts");

assert.match(migration, /create or replace function tap_hub_project\.get_collections_worklist/i);
assert.match(migration, /from invoice_lines il where il\.invoice_id = i\.id/i);
assert.match(migration, /from payment_allocations pa[\s\S]*?where pa\.invoice_id = i\.id and pa\.reversed_at is null/i);
assert.doesNotMatch(migration, /left join invoice_lines il on il\.invoice_id = i\.id[\s\S]*?left join payment_allocations pa on pa\.invoice_id = i\.id/i,
  "invoice lines and allocations must not be joined into a single sum (it multiplies rows)");
assert.match(migration, /'current', \(select current_due::text from summary\)/);
assert.match(migration, /revoke all on function tap_hub_project\.get_collections_worklist\([\s\S]*?from public, anon, authenticated/i);
assert.match(migration, /grant execute on function tap_hub_project\.get_collections_worklist[\s\S]*?to service_role/i);

assert.match(receivablesRoute, /requireLedgerReadAccess/);
assert.match(receivablesRoute, /db\.rpc\("get_collections_worklist"/);
assert.match(receivablesRoute, /Cache-Control.*no-store/);
assert.match(previewRoute, /requireBillingPowerUser/);
assert.match(previewRoute, /delivery_performed: false/);
assert.doesNotMatch(previewRoute, /resend|sendEmail|\.send\(/i, "preview must never call an outbound messaging provider");
assert.match(previewRoute, /p_sort_order: "stable"/);
assert.match(previewRoute, /pageOffset \+= 200/);
assert.match(previewRoute, /has_more: offset \+ actions\.length < allActions\.length/);
assert.match(previewRoute, /contact_phone: account\.contact_phone/);
assert.match(contracts, /contact_phone: string \| null/);

assert.match(followupMigration, /create or replace function tap_hub_project\.collections_firm_today/i);
assert.match(followupMigration, /create or replace function tap_hub_project\.get_billing_invoice_balances/i);
assert.match(followupMigration, /get_billing_invoice_balances\(collections_firm_today\(\)\)/i);
assert.doesNotMatch(followupMigration, /current_date/i, "Phase 2 date and hold boundaries must use the shared firm-date function");
assert.match(followupMigration, /when e\.event_type in \('escalation_requested','escalated'\) then 4/i);
assert.match(followupMigration, /when e\.event_type in \('formal_notice_requested','formal_notice_approved','formal_notice_sent'\) then 5/i);
assert.match(followupMigration, /'priority_score_components'/);
assert.match(followupMigration, /perform set_config\('tap_hub\.actor_id', p_actor::text, true\)/g);
assert.match(catchUpMigration, /where r\.enabled and r\.automatic and r\.stage <= 3\s+and r\.stage > v_completed and r\.days_past_due <= v_days/i,
  "missed reminders should catch up to the latest currently due automatic stage");
assert.match(catchUpMigration, /if v_next is null then\s+select min\(r\.stage\)/i,
  "approval stages should remain sequential after automatic reminders");
assert.match(stageContextMigration, /'completed_stage', v_completed/);
assert.match(stageContextMigration, /'upcoming_stage', v_upcoming/);
assert.match(rulesRoute, /firm_timezone/);
assert.match(rulesRoute, /requireLedgerReadAccess/);
assert.match(rulesRoute, /requireBillingPowerUser/);
assert.match(rulesRoute, /update_collections_configuration/);
assert.match(rulesRoute, /subject_template, body_template/);
assert.match(rulesRoute, /test-recipient setup is deferred to integrations/);
assert.match(dynamicRulesMigration, /create or replace function tap_hub_project\.update_collections_configuration/i);
assert.match(dynamicRulesMigration, /stage.*>= 4/i);
assert.match(dynamicRulesMigration, /create or replace function tap_hub_project\.set_primary_client_contact/i);
assert.match(dynamicRulesMigration, /selected_primary_contact_id/);
assert.match(contactsRoute, /set_primary_client_contact/);
assert.match(eventRoute, /invoice:invoices\(invoice_number\)/);
assert.match(holdsRoute, /invoice:invoices\(invoice_number\)/);
assert.match(eventRoute, /collectionsError/);
assert.match(holdsRoute, /collectionsError/);
assert.match(localBootstrap, /allow_edit_client_data boolean not null default false/);
assert.match(localBootstrap, /email_2fa_enabled boolean not null default false/);
assert.match(localBootstrap, /location text/);
assert.match(localUsers, /55321/);
assert.match(localUsers, /SUPABASE_SERVICE_ROLE_KEY/);
assert.match(contracts, /CollectionsReceivablesResponse/);
assert.match(contracts, /CollectionsAutomationPreviewResponse/);

console.log("Collections Phase 2 backend contract checks passed.");
