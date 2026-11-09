// Paired A/R approval helpers: summary rows as evidence, the approval checklist, and the mismatch payload.
// Run with: node tests/collections-ar-pair.test.mjs
import assert from "node:assert/strict";
import { loadTs } from "./helpers/load-ts.mjs";

const im = loadTs("lib/billing-ui/imports.ts");
let passed = 0;
const check = (label, fn) => { try { fn(); passed += 1; } catch (error) { error.message = `${label}: ${error.message}`; throw error; } };

const row = (disposition, fields, reconciliation) => ({ id: "r", page_number: 1, row_number: 1, raw_text: "", review_disposition: disposition, parsed_fields: { cells: [], auto_suggestion: { disposition: "summary", confidence: "high", reason: "", fields, ...(reconciliation ? { reconciliation } : {}) } } });
const customer = { kind: "customer", customer_name: "A Co", current: "0.00", days_1_30: "10.00", days_31_60: "0.00", days_61_90: "0.00", over_90: "0.00", total_open_balance: "10.00" };

check("a summary customer row is pending until the pair is reconciled, never ignored", () => {
  assert.equal(im.summaryRowView(row("summary", customer)).status, "pending");
  assert.equal(im.summaryRowView(row("summary", customer, { status: "matched" })).status, "matched");
  assert.equal(im.summaryRowView(row("summary", customer, { status: "conflict" })).status, "conflict");
  assert.equal(im.summaryRowView(row("unreviewed", {})).status, "review");
  assert.equal(im.summaryRowView(row("summary", { kind: "grand_total", total_open_balance: "10.00" })).kind, "grand_total");
});

const detail = (uploadedBy) => ({ batch: { id: "d", report_type: "aging_detail", source_as_of: "2026-03-01", status: "needs_review", uploaded_by: uploadedBy }, rows: [], invoices: [{ review_status: "ready" }], revisions: [] });
const summary = (uploadedBy, unreviewed = 0) => ({ batch: { id: "s", report_type: "aging_summary", source_as_of: "2026-03-01", status: "needs_review", uploaded_by: uploadedBy }, rows: Array.from({ length: unreviewed }, () => ({ review_disposition: "unreviewed" })), invoices: [], revisions: [] });
const ok = (checks) => checks.every((item) => item.ok);

check("approval needs the same-date summary, fully readable", () => {
  assert.equal(ok(im.pairApprovalChecklist(detail("u"), null, { id: "me", role: "owner" })), false);
  assert.equal(ok(im.pairApprovalChecklist(detail("u"), summary("u", 1), { id: "me", role: "owner" })), false);
  assert.equal(ok(im.pairApprovalChecklist(detail("u"), summary("u"), { id: "me", role: "owner" })), true);
});

check("an Admin may approve a pair they uploaded; an Owner uploader may not", () => {
  assert.equal(ok(im.pairApprovalChecklist(detail("me"), summary("me"), { id: "me", role: "admin" })), true);
  assert.equal(ok(im.pairApprovalChecklist(detail("me"), summary("u"), { id: "me", role: "owner" })), false);
  assert.equal(ok(im.pairApprovalChecklist(detail("u"), summary("me"), { id: "me", role: "owner" })), false);
});

check("the mismatch payload is read from the 409 body, and anything else is ignored", () => {
  const reconciliation = { status: "mismatch", customers: [{ status: "conflict" }], summary_total: "1", detail_total: "0" };
  assert.equal(im.reconciliationOf({ status: "mismatch", reconciliation }).status, "mismatch");
  assert.equal(im.reconciliationOf(reconciliation).customers.length, 1);
  assert.equal(im.reconciliationOf({ status: "approved" }), null);
  assert.equal(im.reconciliationOf(null), null);
});

console.log(`collections A/R pair checks passed (${passed})`);
