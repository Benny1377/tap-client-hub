import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

test("Contacts API is a dedicated database endpoint, not a client-directory projection", () => {
  const routePath = new URL("../app/api/contacts/route.ts", import.meta.url);

  assert.equal(existsSync(routePath), true, "expected a dedicated /api/contacts route");

  const route = readFileSync(routePath, "utf8");
  assert.match(route, /\.from\("contacts"\)/, "Contacts endpoint must read the contacts table");
  assert.match(route, /export async function GET\(\)[\s\S]*?resolveAccessIdentity\(\)/, "Contacts reads must resolve the authenticated identity");
  assert.match(route, /if \(!identity\)[\s\S]*?status: 401/, "Anonymous Contacts reads must be rejected");
  assert.match(route, /identity\.modules\.includes\("Clients"\)[\s\S]*?status: 403/, "Contacts reads must require the Clients module");
  assert.match(route, /export async function POST/, "Contacts endpoint must create contacts");
  assert.match(route, /export async function PATCH/, "Contacts endpoint must update dedicated contacts");
  assert.match(route, /requireClientDataEditAccess/, "Contact writes must require client-data edit access");
});

test("Contacts page loads dedicated contact records and provides an add-contact action", () => {
  const page = readFileSync(new URL("../app/contacts/page.tsx", import.meta.url), "utf8");

  assert.match(page, /fetch\("\/api\/contacts"/, "Contacts page must load /api/contacts directly");
  assert.match(page, /\+ Add/, "Contacts page must provide a + Add action");
  assert.doesNotMatch(page, /useClients\(\)/, "Contacts page must not project the full clients list");
});
