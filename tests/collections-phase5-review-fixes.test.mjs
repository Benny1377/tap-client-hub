import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const [runner, migration, billingDispatch, route, apiTypes, deliveryLabels, reset, sqlTest] = await Promise.all([
  readFile(new URL("lib/collections-test-run.ts", root), "utf8"),
  readFile(new URL("supabase/migrations/20261111115029_collections_phase5_delivery_and_relink_safety.sql", root), "utf8"),
  readFile(new URL("supabase/migrations/20261111125830_collections_test_delivery_billing_claim_dispatch.sql", root), "utf8"),
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
assert.match(billingDispatch, /if v_attempt\.source='billing' then[\s\S]*select \* into v_identity[\s\S]*for update[\s\S]*if not found then[\s\S]*claim_collection_test_delivery_pre_phase5/);
assert.ok(billingDispatch.indexOf("if not found then\n      return tap_hub_project.claim_collection_test_delivery_pre_phase5") < billingDispatch.indexOf("return tap_hub_project.claim_collection_test_delivery_pre_billing_dispatch(p_attempt_id,p_actor);\nend;"), "only Billing attempts without an identity row bypass the identity-dependent wrapper");
assert.match(billingDispatch, /EMAIL_CONTACT_INVALID/);
assert.doesNotMatch(route, /error\.message/);
assert.match(route, /The client relink conflicts with the current account data or state/);
assert.match(apiTypes, /"EMAIL_CONTACT_INVALID"/);
assert.match(deliveryLabels, /EMAIL_CONTACT_INVALID: "The primary contact email address is invalid\."/);
assert.match(reset, /20261111115029_collections_phase5_delivery_and_relink_safety\.sql/);
assert.match(reset, /20261111125830_collections_test_delivery_billing_claim_dispatch\.sql/);
assert.match(sqlTest, /auto_match_collection_import_rows/);
assert.match(sqlTest, /client_relink_summary/);
const deliveryRegression = await readFile(new URL("supabase/tests/collections_phase5_identity_delivery_followups.sql", root), "utf8");
assert.match(deliveryRegression, /Billing-only claim must not require a source identity row/);

console.log("Collections Phase 5 review fixes contract: 23/23 passed");
