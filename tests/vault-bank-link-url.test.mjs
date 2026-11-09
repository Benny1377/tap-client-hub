import assert from "node:assert/strict";

const { resolveBankPortalUrl } = await import(new URL("../lib/vault-bank-link.ts", import.meta.url).href);

assert.equal(resolveBankPortalUrl("tapbank.example/login", ""), "https://tapbank.example/login");
assert.equal(
  resolveBankPortalUrl("https://entry.example/portal", "https://default.example"),
  "https://entry.example/portal",
  "entry-specific URLs take precedence",
);
assert.equal(resolveBankPortalUrl("", "default.example/portal"), "https://default.example/portal");
assert.equal(resolveBankPortalUrl("http://insecure.example", ""), "", "bank portals must use HTTPS");
assert.equal(resolveBankPortalUrl("javascript:alert(1)", ""), "", "script URLs must be rejected");
assert.equal(resolveBankPortalUrl("", ""), "", "missing configuration remains a disabled link");
console.log("bank portal URL regression tests passed");
