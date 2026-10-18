import test from "node:test";
import assert from "node:assert/strict";
import { loadTs } from "./helpers/load-ts.mjs";

const { renderCollectionsTemplate } = loadTs("lib/collections-template.ts");

test("HTML body template and substitutions are escaped while newlines remain available", () => {
  const rendered = renderCollectionsTemplate("<img src=x onerror=alert(1)>\nHello {contact_name}", { contact_name: "<script>alert(1)</script>" }, true);
  assert.equal(rendered, "&lt;img src=x onerror=alert(1)&gt;\nHello &lt;script&gt;alert(1)&lt;/script&gt;");
});

test("unknown template tokens fail closed", () => {
  assert.throws(() => renderCollectionsTemplate("Hello {client_email}", { client_email: "x@example.invalid" }), /TEMPLATE_TOKEN_INVALID/);
});
