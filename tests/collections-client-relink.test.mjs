import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const route = await readFile(new URL("app/api/collections/imports/relink-clients/route.ts", root), "utf8");
const migration = await readFile(new URL("supabase/migrations/20261110135841_collections_audited_client_relink.sql", root), "utf8");
const reset = await readFile(new URL("tools/collections-local/reset.sh", root), "utf8");

assert.match(route, /requireCollectionsAccess\(\)/);
assert.match(route, /isPowerUser\(access\.identity\.role\)/);
assert.match(route, /relink_collections_client_accounts/);
assert.match(route, /source_client_id/);
assert.match(route, /target_client_id/);
assert.match(route, /no-store/);

assert.match(migration, /active Owner or Admin actor required/);
assert.match(migration, /operations_source_client_id is null/);
assert.match(migration, /operations_source_client_id is not null/);
assert.match(migration, /every A\/R snapshot for the source client must be approved/);
assert.match(migration, /source client has Billing ledger records/);
assert.match(migration, /update collection_source_invoice_identities[\s\S]*set client_id=v_target_client_id/);
assert.match(migration, /update collection_holds set client_id=v_target_client_id/);
assert.match(migration, /update collection_events set client_id=v_target_client_id/);
assert.match(migration, /update collection_delivery_attempts set client_id=v_target_client_id/);
assert.match(migration, /canonical_identity_preserved/);
assert.match(migration, /client_relinked_to_operations/);
assert.match(migration, /revoke all on function[\s\S]*from public, anon, authenticated/);
assert.match(migration, /to service_role/);
assert.match(reset, /20261110135841_collections_audited_client_relink\.sql/);

console.log("Collections client relink contract: 17/17 passed");
