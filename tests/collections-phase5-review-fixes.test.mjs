import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const [runner, migration, route, apiTypes, deliveryLabels, reset, sqlTest] = await Promise.all([
  readFile(new URL("lib/collections-test-run.ts", root), "utf8"),
  readFile(new URL("supabase/migrations/20261111115029_collections_phase5_delivery_and_relink_safety.sql", root), "utf8"),
  readFile(new URL("app/api/collections/imports/relink-clients/route.ts", root), "utf8"),
  readFile(new URL("lib/collections-api.ts", root), "utf8"),
  readFile(new URL("lib/billing-ui/delivery.ts", root), "utf8"),
  readFile(new URL("tools/collections-local/reset.sh", root), "utf8"),
  readFile(new URL("supabase/tests/collections_phase5_delivery_relink_safety.sql", root), "utf8"),
]);

assert.match(runner, /billing:\$\{invoice\.invoice_id\}/);
assert.match(runner, /canonical_collection_identity", identity/);
assert.match(runner, /EMAIL_CONTACT_INVALID/);
assert.match(migration, /source_invoice_id,canonical_collection_identity,event_type,stage,actor,detail/);
assert.match(migration, /case when v_attempt\.source='pdf_import' then null else v_attempt\.invoice_id end/);
assert.match(migration, /claim_collection_test_delivery_pre_email_validation/);
assert.match(migration, /collections_client_name_aliases/);
assert.match(migration, /status='inactive'/);
assert.match(migration, /client_relink_summary/);
assert.match(migration, /EMAIL_CONTACT_INVALID/);
assert.doesNotMatch(route, /error\.message/);
assert.match(route, /The client relink conflicts with the current account data or state/);
assert.match(apiTypes, /"EMAIL_CONTACT_INVALID"/);
assert.match(deliveryLabels, /EMAIL_CONTACT_INVALID: "The primary contact email address is invalid\."/);
assert.match(reset, /20261111115029_collections_phase5_delivery_and_relink_safety\.sql/);
assert.match(sqlTest, /auto_match_collection_import_rows/);
assert.match(sqlTest, /client_relink_summary/);

console.log("Collections Phase 5 review fixes contract: 17/17 passed");
