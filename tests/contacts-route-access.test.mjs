import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canAccessPathname, moduleForPathname } from "../lib/access-policy.ts";

const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
const apps = readFileSync(new URL("../components/practiceops/apps.ts", import.meta.url), "utf8");

assert.equal(moduleForPathname("/contacts"), "Clients");
assert.equal(
  canAccessPathname("staff", ["Clients"], "/contacts"),
  true,
  "A user with Clients access must be allowed to open the Contacts directory.",
);
assert.match(
  apps,
  /\{ label: "Contacts", href: "\/contacts", icon: "badge", module: "Clients" \}/,
  "Contacts must be a normal Clients navigation entry.",
);
assert.doesNotMatch(
  layout + apps,
  /show_contacts_tab/,
  "Contacts must not be hidden behind a URL feature flag.",
);

console.log("contacts route and navigation regression checks passed");
