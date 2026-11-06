import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const api = loadTs("lib/billing-phase2.ts");
const access = loadTs("lib/billing-access.ts");

test("Phase 2 money fields serialize as fixed two-decimal strings", () => {
  assert.deepEqual(api.toCamel({ unit_amount: "12.5", amount: 2, other_count: 2 }), {
    unitAmount: "12.50", amount: "2.00", otherCount: 2,
  });
});

test("public Billing serializers omit internal audit actor and reason fields", () => {
  assert.deepEqual(api.toCamel({ id: "rate-1", created_by: "user-1", updated_by: "user-2", reason: "internal" }), { id: "rate-1" });
});

test("policy projection includes all delegable actions and effective defaults", () => {
  const policies = access.effectiveBillingPolicy([
    { action_key: "pricing.manage", allowed_roles: ["owner", "admin"], enabled: true },
    { action_key: "settings.terms.manage", allowed_roles: [], enabled: true },
  ]);
  assert.equal(policies.length, 11);
  assert.deepEqual(policies.find((policy) => policy.actionKey === "billing.view"), {
    actionKey: "billing.view", allowedRoles: ["manager", "staff", "offshore"], enabled: true,
  });
  assert.deepEqual(policies.find((policy) => policy.actionKey === "pricing.manage"), {
    actionKey: "pricing.manage", allowedRoles: ["owner", "admin"], enabled: true,
  });
  assert.deepEqual(policies.find((policy) => policy.actionKey === "settings.remittance.manage"), {
    actionKey: "settings.remittance.manage", allowedRoles: [], enabled: false,
  });
  assert.equal(policies.some((policy) => ["policy.manage", "invoices.void", "payments.reverse"].includes(policy.actionKey)), false);
});

test("policy projection preserves an explicit revocation of a default action", () => {
  const policy = access.effectiveBillingPolicy([
    { action_key: "billing.view", allowed_roles: [], enabled: false },
  ]).find((item) => item.actionKey === "billing.view");
  assert.deepEqual(policy, { actionKey: "billing.view", allowedRoles: [], enabled: false });
});

test("bundle serializers expose components under the contracted key", () => {
  assert.deepEqual(api.toPhase2Bundle({
    id: "bundle-1", unit_amount: "300", billing_bundle_components: [{ client_service_id: "service-1" }],
  }), { id: "bundle-1", unitAmount: "300.00", components: [{ clientServiceId: "service-1" }] });
  assert.deepEqual(api.toPhase2Bundle({ id: "bundle-2", unit_amount: "25" }), {
    id: "bundle-2", unitAmount: "25.00", components: [],
  });
});

test("candidate source is a canonical nested object", () => {
  assert.deepEqual(api.toPhase2Candidate({
    id: "candidate-1", source_adapter: "schedule", source_identity: "service-1:2026-11", unit_amount: "125",
  }), {
    id: "candidate-1", unitAmount: "125.00", source: { adapter: "schedule", identity: "service-1:2026-11" },
  });
});

test("invoice serializer emits camelCase lines, decimal quantities, and active provenance", () => {
  assert.deepEqual(api.toPhase2Invoice({
    id: "invoice-1", invoice_number: null, invoice_lines: [{
      id: "line-1", quantity: "1.2", unit_amount: "10", amount: "12",
      billing_candidate_line_links: [{ candidate_id: "candidate-1", active: true }, { candidate_id: "candidate-2", active: false }],
    }],
  }), {
    id: "invoice-1", invoiceNumber: null,
    lines: [{ id: "line-1", quantity: "1.2000", unitAmount: "10.00", amount: "12.00", candidateIds: ["candidate-1"] }],
  });
});

test("mutations use the contract's resource envelopes", () => {
  assert.deepEqual(api.mutationResponse("rate-cards", ["rate-cards"], { id: "card-1", unit_amount: "10" }), {
    rateCard: { id: "card-1", unitAmount: "10.00" },
  });
  assert.deepEqual(api.mutationResponse("client-pricing", ["client-pricing", "overrides"], { id: "override-1" }), {
    override: { id: "override-1" },
  });
  assert.deepEqual(api.mutationResponse("bundles", ["bundles", "bundle-1", "components"], {
    bundleId: "bundle-1", components: [{ clientServiceId: "service-1" }],
  }), { bundleId: "bundle-1", components: [{ clientServiceId: "service-1" }] });
  assert.deepEqual(api.mutationResponse("settings", ["settings", "remittance"], {
    payee_name: "TAP", address: "Houston", instructions: "Invoice number", updated_at: "2026-11-05T12:00:00Z", updated_by: "user-1",
  }), {
    remittance: { payeeName: "TAP", address: "Houston", instructions: "Invoice number" }, updatedAt: "2026-11-05T12:00:00Z",
  });
});

test("Billing permission defaults, explicit revocations, and Owner/Admin-only keys resolve server-side", () => {
  const staff = { role: "staff", modules: ["Billing"] };
  const defaults = access.billingActionsForIdentity(staff, []);
  assert.ok(defaults.includes("payments.record"));
  assert.ok(!defaults.includes("pricing.manage"));
  assert.ok(!defaults.includes("invoices.void"));
  assert.ok(!defaults.includes("payments.reverse"));
  assert.ok(!access.billingActionsForIdentity(staff, [
    { action_key: "payments.record", allowed_roles: [], enabled: false },
  ]).includes("payments.record"));
  assert.ok(access.billingActionsForIdentity(staff, [
    { action_key: "pricing.manage", allowed_roles: ["staff"], enabled: true },
    { action_key: "invoices.void", allowed_roles: ["staff"], enabled: true },
  ]).includes("pricing.manage"));
  assert.ok(!access.billingActionsForIdentity(staff, [
    { action_key: "invoices.void", allowed_roles: ["staff"], enabled: true },
  ]).includes("invoices.void"));
  assert.deepEqual(access.billingActionsForIdentity({ role: "staff", modules: ["Collections"] }, []), []);
  assert.ok(access.billingActionsForIdentity({ role: "owner", modules: [] }, []).includes("payments.reverse"));
});
