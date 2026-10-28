import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canAccessPathname, moduleForPathname } from "../lib/access-policy.ts";

const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
const accessServer = readFileSync(new URL("../lib/access-server.ts", import.meta.url), "utf8");

assert.match(accessServer, /export async function requireClientDataViewAccess\(\)/);
assert.match(accessServer, /const identity = await resolveAccessIdentity\(\{ requireSupabaseAuth: true \}\)/);
assert.match(accessServer, /if \(requireSupabaseAuth && !authUser\) return null/);
assert.match(accessServer, /const demoSession = requireSupabaseAuth \? null : verifyDemoSession/);
assert.match(accessServer, /const demoUserFromCookie = requireSupabaseAuth \? ""/);
assert.match(accessServer, /if \(demoName && !requireSupabaseAuth\)/);
assert.match(accessServer, /const demoFallback = !requireSupabaseAuth/);
assert.match(accessServer, /if \(!identity\.modules\.includes\("Clients"\)\) return \{ identity, status: 403 as const \}/);
assert.equal(moduleForPathname("/contacts"), "Clients");
assert.equal(
  canAccessPathname("staff", ["Clients"], "/contacts"),
  true,
  "A user with Clients access must be allowed to open the Contacts directory.",
);
assert.match(
  layout,
  /\{ label: "Contacts", href: "\/contacts", icon: "👤", module: "Clients" \}/,
  "Contacts must be a normal Clients navigation entry.",
);
assert.doesNotMatch(
  layout,
  /show_contacts_tab/,
  "Contacts must not be hidden behind a URL feature flag.",
);

console.log("contacts route and navigation regression checks passed");
