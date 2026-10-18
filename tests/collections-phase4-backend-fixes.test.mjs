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

test("multi-invoice payment changes re-block every linked snapshot through a forward migration", () => {
  const sql = source("supabase/migrations/20261019120000_collections_reblock_multi_invoice_payments.sql");
  const localReset = source("tools/collections-local/reset.sh");
  const sqlTests = source("supabase/tests/collections_phase4_intake_schema.sql");
  assert.match(sql, /for v_invoice_id in[\s\S]*select distinct pa\.invoice_id[\s\S]*pa\.payment_id = coalesce\(new\.id, old\.id\)/);
  assert.match(sql, /collections_billing_invoice_changed_on_or_after\(v_invoice_id, i\.source_as_of\)/);
  assert.match(sql, /billing_snapshot_stale/);
  assert.match(localReset, /20261019120000_collections_reblock_multi_invoice_payments\.sql/);
  assert.match(sqlTests, /Reversing a payment did not re-block every linked invoice snapshot/);
});

test("the parse route's deploy trace includes the pdfjs worker it imports at runtime", () => {
  const config = source("next.config.ts");
  assert.match(config, /outputFileTracingIncludes:/);
  assert.ok(config.includes(String.raw`"/api/collections/imports/\\[id\\]/parse": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"]`));
});

test("the batch review read returns each imported invoice's client and Billing links for the review UI", () => {
  const route = source("app/api/collections/imports/[id]/route.ts");
  assert.match(route, /select\("id,source_invoice_id,proposed_linked_invoice_id,/);
  assert.match(route, /collection_source_invoice_identities"\)\.select\("source_invoice_id,client_id,linked_invoice_id,selected_source"\)/);
  assert.match(route, /invoices: reviewedInvoices/);
});
