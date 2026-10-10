import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const migration = await read("supabase/migrations/20261010120000_collections_automation_foundation.sql");
const followupMigration = await read("supabase/migrations/20261010130000_collections_shared_date_and_stage_model.sql");
const catchUpMigration = await read("supabase/migrations/20261011100000_collections_catch_up_policy.sql");
const receivablesRoute = await read("app/api/collections/receivables/route.ts");
const previewRoute = await read("app/api/collections/automation/preview/route.ts");
const rulesRoute = await read("app/api/collections/rules/route.ts");
const eventRoute = await read("app/api/collections/events/route.ts");
const holdsRoute = await read("app/api/collections/holds/route.ts");
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
assert.match(rulesRoute, /requireLedgerReadAccess/);
assert.match(rulesRoute, /stage, label, days_past_due, automatic, enabled/);
assert.match(eventRoute, /invoice:invoices\(invoice_number\)/);
assert.match(holdsRoute, /invoice:invoices\(invoice_number\)/);
assert.match(eventRoute, /collectionsError/);
assert.match(holdsRoute, /collectionsError/);
assert.match(contracts, /CollectionsReceivablesResponse/);
assert.match(contracts, /CollectionsAutomationPreviewResponse/);

console.log("Collections Phase 2 backend contract checks passed.");
