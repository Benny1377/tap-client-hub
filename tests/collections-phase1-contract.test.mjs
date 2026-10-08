import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20261009130000_add_billing_audit_rpc.sql", import.meta.url), "utf8");
const allocation = readFileSync(new URL("../supabase/migrations/20261009120000_create_billing_ledger.sql", import.meta.url), "utf8");

assert.match(migration, /record_billing_audit/);
assert.match(migration, /revoke all on function/);
assert.match(migration, /grant execute.*service_role/);
assert.match(allocation, /for update/);
assert.match(allocation, /over-allocated/);
assert.match(allocation, /cross-client/);

console.log("Collections Phase 1 database contract checks passed");
