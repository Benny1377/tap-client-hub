import test from "node:test";
import assert from "node:assert/strict";
import { parseOperationsClientCsv } from "../lib/operations-client-import.ts";

const headers = ["source_client_id", "client_name", "client_code", "group_name", "address", "city", "state", "zip", "type", "status", "source_contact_id", "contact_category", "contact_name", "contact_email", "contact_phone", "is_primary"].join(",");
const clientId = "001c09da-4f00-4271-91cc-a22f5ea76770";
const contactId = "a525b023-21e4-4a6b-82c9-d8c6f1512be9";

test("Operations CSV import parses quoted commas and groups source client/contact rows", () => {
  const parsed = parseOperationsClientCsv(`${headers}\n${clientId},\"ACME, Inc.\",\"00123.0\",Group,\"1 Main St\",Houston,TX,77001,Business,active,${contactId},client,\"Jane Doe\",jane@example.invalid,5551234567,true`);
  assert.equal(parsed.clients.length, 1);
  assert.equal(parsed.contacts.length, 1);
  assert.equal(parsed.clients[0].client_name, "ACME, Inc.");
  assert.equal(parsed.contacts[0].email, "jane@example.invalid");
  assert.equal(parsed.contacts[0].is_primary, true);
});

test("Operations CSV normalizes literal null fields and contact-free clients", () => {
  const parsed = parseOperationsClientCsv(`${headers}\n${clientId},Solo LLC,null,null,null,null,null,null,personal,active,null,null,null,null,null,null`);
  assert.equal(parsed.clients[0].type, "Personal");
  assert.equal(parsed.clients[0].client_code, null);
  assert.equal(parsed.contacts.length, 0);
});

test("Operations CSV refuses inconsistent client rows and unsupported input", () => {
  const first = `${clientId},Solo LLC,1,Group,,,,,Business,active,null,null,null,null,null,false`;
  const second = `${clientId},Changed LLC,1,Group,,,,,Business,active,null,null,null,null,null,false`;
  assert.throws(() => parseOperationsClientCsv(`${headers}\n${first}\n${second}`), /disagree/);
  assert.throws(() => parseOperationsClientCsv("source_client_id,client_name\n"), /Unexpected CSV columns/);
});

test("Operations client import is sandbox-only, Owner/Admin-only and uses the transactional RPC", async () => {
  const fs = await import("node:fs");
  const route = fs.readFileSync(new URL("../app/api/clients/operations-import/route.ts", import.meta.url), "utf8");
  const migration = fs.readFileSync(new URL("../supabase/migrations/20261109134439_operations_client_data_import.sql", import.meta.url), "utf8");
  assert.match(route, /vuqgxotdccxivjmavsoj\.supabase\.co/);
  assert.match(route, /identity\.role !== "owner" && identity\.role !== "admin"/);
  assert.match(route, /import_operations_client_data/);
  assert.match(migration, /security invoker/i);
  assert.match(migration, /revoke all on function .* from public, anon, authenticated/i);
  assert.match(migration, /operations_source_client_id/);
  assert.match(migration, /operations_source_contact_id/);
  assert.match(migration, /operations_import/);
});
