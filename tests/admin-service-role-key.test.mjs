import assert from "node:assert/strict";

const { requireServiceRoleKey } = await import(new URL("../lib/supabase/admin-key.ts", import.meta.url).href);

assert.equal(requireServiceRoleKey("service-role-key"), "service-role-key");
assert.throws(
  () => requireServiceRoleKey(undefined),
  /SUPABASE_SERVICE_ROLE_KEY is required/,
);
assert.throws(
  () => requireServiceRoleKey("   "),
  /SUPABASE_SERVICE_ROLE_KEY is required/,
);
console.log("admin service-role configuration tests passed");
