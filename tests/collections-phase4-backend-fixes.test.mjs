// Engineer A proposed fixes on top of be2aa41, found by the Phase 4 integrated run
// (tools/collections-local/validate-phase4.mjs). Static checks; no database.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const UUID_LINE = /const UUID = (\/\^.*\$\/i);/;

test("the discrepancy resolve route accepts a real UUID", () => {
  const text = source("app/api/collections/imports/invoices/[sourceInvoiceId]/resolve/route.ts");
  const regex = eval(UUID_LINE.exec(text)[1]);
  assert.equal(regex.test("1d8a414d-9caf-4509-8446-af7b7105ff34"), true);
  assert.equal(regex.test("not-a-uuid"), false);
});

test("pdfjs-dist is loaded by Node, not bundled, so its worker file resolves", () => {
  assert.match(source("next.config.ts"), /serverExternalPackages:\s*\[[^\]]*"pdfjs-dist"/);
});

test("receivables keeps the source fields the PDF merge attached to Billing-selected rows", () => {
  const text = source("app/api/collections/receivables/route.ts");
  assert.doesNotMatch(text, /invoice\.discrepancy_status = "none";/, "never reset a merged discrepancy to none");
  assert.match(text, /invoice\.discrepancy_status \|\|= "none";/);
  assert.match(text, /invoice\.canonical_collection_identity \|\|= `billing:\$\{invoice\.invoice_id\}`;/);
  assert.match(text, /\.in\("canonical_collection_identity", billingInvoices\.map\(\(invoice\) => invoice\.canonical_collection_identity\)\)/);
});

test("the source-aware event function keeps every Phase 2 event rule", () => {
  const sql = source("supabase/migrations/20261019110000_collections_event_rules_for_source.sql");
  assert.match(sql, /reminder stage must be 1, 2, or 3/);
  assert.match(sql, /get_billing_invoice_balances\(collections_firm_today\(\)\)/, "Billing catch-up stage");
  assert.match(sql, /select i\.due_date into v_due from collection_import_invoices i/, "PDF catch-up stage from the reviewed due date");
  assert.match(sql, /add a note describing when and how the notice was sent/);
  assert.match(sql, /p_event_type in \('escalation_requested','formal_notice_requested'\) and exists\(/, "holds block requests, not a sent-notice record");
  assert.match(source("tools/collections-local/reset.sh"), /20261019110000_collections_event_rules_for_source\.sql/);
});
