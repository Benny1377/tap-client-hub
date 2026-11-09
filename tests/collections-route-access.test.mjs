import assert from "node:assert/strict";
import { canAccessPathname, moduleForPathname } from "../lib/access-policy.ts";

assert.equal(moduleForPathname("/billing"), "Billing");
assert.equal(moduleForPathname("/billing/invoices"), "Billing");
assert.equal(moduleForPathname("/collections"), "Collections");
assert.equal(moduleForPathname("/collections/aging"), "Collections");
assert.equal(moduleForPathname("/clients/operations-import"), "Clients");

assert.equal(
  canAccessPathname("staff", ["Billing"], "/billing/invoices"),
  true,
  "Billing assignment must cover nested Billing routes.",
);
assert.equal(
  canAccessPathname("staff", ["Collections"], "/collections/aging"),
  true,
  "Collections assignment must cover nested Collections routes.",
);
assert.equal(
  canAccessPathname("staff", ["Billing"], "/collections/aging"),
  false,
  "Billing assignment must not grant Collections access.",
);
assert.equal(
  canAccessPathname("manager", ["Collections"], "/collections/aging"),
  true,
  "Managers assigned Collections may reach its routes.",
);
assert.equal(
  canAccessPathname("admin", [], "/clients/operations-import"),
  true,
  "Owner/Admin access to a nested Clients page must not be redirected before its page-level role check.",
);
assert.equal(
  canAccessPathname("staff", [], "/clients/operations-import"),
  false,
  "Nested Clients routes must still require the Clients module for non-power users.",
);

console.log("Billing and Collections nested route access checks passed");
