import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

test("Contacts API is a dedicated database endpoint, not a client-directory projection", () => {
  const routePath = new URL("../app/api/contacts/route.ts", import.meta.url);

  assert.equal(existsSync(routePath), true, "expected a dedicated /api/contacts route");

  const route = readFileSync(routePath, "utf8");
  assert.match(route, /\.from\("contacts"\)/, "Contacts endpoint must read the contacts table");
  assert.match(route, /export async function POST/, "Contacts endpoint must create contacts");
  assert.match(route, /export async function PATCH/, "Contacts endpoint must update dedicated contacts");
  assert.match(route, /requireClientDataEditAccess/, "Contact writes must require client-data edit access");
  assert.match(route, /contact\.category === "unassigned"/, "Unassigned contacts must be included in the GET response");
  assert.match(route, /category !== "client" && category !== "internal" && category !== "unassigned"/, "The API must accept only the three supported contact categories");
  assert.match(route, /client_id: category === "client" \? clientId : null/, "Non-client categories must never be associated with a client");
  assert.match(route, /category === "unassigned" \? false/, "Unassigned contacts cannot be marked primary for a client");

  const migrationPath = new URL("../migrations/20261028_contacts_unassigned_category.sql", import.meta.url);
  assert.equal(existsSync(migrationPath), true, "expected an idempotent migration for the unassigned category");
  const migration = readFileSync(migrationPath, "utf8");
  assert.match(migration, /check\s*\(category in \('client', 'internal', 'unassigned'\)\)/i, "Migration must allow all existing categories plus unassigned");
});

test("Contacts page loads dedicated contact records and provides an add-contact action", () => {
  const page = readFileSync(new URL("../app/contacts/page.tsx", import.meta.url), "utf8");

  assert.match(page, /fetch\("\/api\/contacts"/, "Contacts page must load /api/contacts directly");
  assert.match(page, /\+ Add/, "Contacts page must provide a + Add action");
  assert.doesNotMatch(page, /useClients\(\)/, "Contacts page must not project the full clients list");
  assert.match(page, /type ContactCategory = "client" \| "internal" \| "unassigned";/, "Contacts must represent unmatched records as a distinct category");
  assert.match(page, /category: ContactCategory/, "Contact records must use the expanded category type");
  assert.match(page, /categoryFilter === "all" \|\| contact\.category === categoryFilter/, "The directory filter must match all three categories");
  assert.match(page, /<option value="unassigned">Unassigned \(no client match\)<\/option>/, "Directory filter must expose unassigned contacts");
  assert.match(page, /<option value="unassigned">Unassigned<\/option>/, "Add/edit forms must offer an unassigned category");
  assert.match(page, /contact\.category === "unassigned" \? "Unassigned"/, "The list must label unmatched contacts without associating them to an internal category");
  assert.match(page, /Unassigned contact - no client match/, "Contact profile must explain the missing client match");
});
