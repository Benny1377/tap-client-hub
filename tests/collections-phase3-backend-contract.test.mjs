import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Phase 3 user routes enforce power-user access and no-store responses", () => {
  for (const path of [
    "app/api/collections/delivery-status/route.ts",
    "app/api/collections/deliveries/route.ts",
    "app/api/collections/deliveries/[id]/retry/route.ts",
    "app/api/collections/automation/pause/route.ts",
    "app/api/collections/automation/test-run/route.ts",
  ]) {
    const text = source(path);
    assert.match(text, /requireBillingPowerUser/);
    assert.match(text, /Cache-Control.*no-store|NO_STORE/);
  }
});

test("machine worker is token-only and requires a registered service actor", () => {
  const text = source("app/api/collections/automation/run/route.ts");
  assert.match(text, /timingSafeEqual/);
  assert.match(text, /COLLECTIONS_WORKER_TOKEN/);
  assert.match(text, /COLLECTIONS_SYSTEM_ACTOR_ID/);
  assert.doesNotMatch(text, /requireBillingPowerUser/);
});

test("provider code only targets the server-configured test mailbox and uses idempotency", () => {
  const text = source("lib/collections-test-run.ts");
  const provider = source("lib/collections-provider.ts");
  assert.match(text, /COLLECTIONS_TEST_RECIPIENT/);
  assert.match(provider, /Idempotency-Key/);
  assert.match(text, /record_collection_test_payload_fingerprint/);
  assert.match(text, /isSyntheticOnlyEnabled/);
  assert.doesNotMatch(text, /invoice\.contact_email|account\.contact_email/);
});

test("migration preserves default-off, synthetic-only, one-event and atomic claim safeguards", () => {
  const text = source("supabase/migrations/20261017120000_collections_test_delivery.sql");
  assert.match(text, /add column if not exists is_synthetic boolean not null default false/);
  assert.match(text, /status = 'accepted' where status = 'sent'/);
  assert.match(text, /idx_collection_reminder_delivery_once/);
  assert.match(text, /claim_collection_test_delivery/);
  assert.match(text, /pause_collections_automation/);
  assert.match(text, /not v_settings\.automation_enabled or v_settings\.delivery_mode <> 'test'/);
});

test("rules reject placeholders outside the explicit allowlist", () => {
  const text = source("app/api/collections/rules/route.ts");
  assert.match(text, /contact_name.*invoice_number.*balance.*due_date.*days_past_due/);
  assert.match(text, /TEMPLATE_TOKEN_INVALID/);
});
