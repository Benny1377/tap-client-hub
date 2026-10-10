import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const migration = await read("supabase/migrations/20261010120000_collections_automation_foundation.sql");
const receivablesRoute = await read("app/api/collections/receivables/route.ts");
const previewRoute = await read("app/api/collections/automation/preview/route.ts");

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

console.log("Collections Phase 2 backend contract checks passed.");
