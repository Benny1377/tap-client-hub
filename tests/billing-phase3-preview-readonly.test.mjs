import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../tools/billing-preview/verify-billing-phase3-reads.mjs", import.meta.url), "utf8");

test("hosted Phase 3 read checker pins the test Preview and TAB-HUB sandbox", () => {
  assert.match(source, /BILLING_PREVIEW_EXPECTED_HOST/);
  assert.match(source, /previewUrl\.host !== expectedPreviewHost/);
  assert.match(source, /vuqgxotdccxivjmavsoj\.supabase\.co/);
  assert.match(source, /apiUrl\.host !== SANDBOX_HOST/);
});

test("hosted Phase 3 read checker only sends GET requests outside sign-in", () => {
  assert.match(source, /async call\(path\)[\s\S]*?method: "GET"/);
  assert.match(source, /const db = async \(p\) =>[\s\S]*?method: "GET"/);
  assert.doesNotMatch(source, /callJson|\.call\("PATCH"|\.call\("POST"|\.call\("DELETE"/);
  assert.doesNotMatch(source, /\.rpc\(|method: "PATCH"|method: "DELETE"/);
  assert.match(source, /BASE \+ "\/api\/auth\/sign-in", \{ method: "POST"/);
});

test("policy preview validates the effective allow-list without saving it", () => {
  assert.match(source, /allowed roles are filtered to delegable roles/);
  assert.match(source, /response roles are limited to manager, staff, offshore/);
  assert.match(source, /read checks changed nothing in policy/);
  assert.doesNotMatch(source, /saving the GET response|PATCH.*permissions\/policy/);
});
