// Phase 4 A/R report review UI: value parsing, review progress, the approval
// checklist, balance math, the import API client, and rendered review pieces.
// Synthetic values only. Run with: node --test tests/billing-ui-imports.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { loadTs } from "./helpers/load-ts.mjs";

const require = createRequire(import.meta.url);
const { createElement: h } = require("react");
const { renderToStaticMarkup: render } = require("react-dom/server");

const imports = loadTs("lib/billing-ui/imports.ts");
const { createBillingApi } = loadTs("lib/billing-ui/api.ts");
const panels = loadTs("components/billing/import-panels.tsx");
const { SourceNote } = loadTs("components/billing/worklist-panels.tsx");

const row = (id, disposition, cells = ["08/01/2026", "Invoice", "SYN-1001", "08/31/2026", "150.00"]) => ({
  id, source_invoice_id: null, page_number: 1, row_number: Number(id.replace(/\D/g, "")) || 1, raw_text: cells.join(" | "),
  parsed_fields: { cells }, duplicate_of: null, exact_duplicate: false, review_disposition: disposition,
});
const batch = (overrides = {}) => ({
  id: "b-1", original_filename: "synthetic-ar.pdf", report_type: "aging_detail", source_as_of: "2026-08-28", status: "needs_review",
  uploaded_by: "u-uploader", parsed_at: "2026-10-18T10:00:00Z", approved_by: null, approved_at: null, supersedes_batch_id: null,
  metadata: { page_count: 1 }, created_at: "2026-10-18T10:00:00Z", updated_at: "2026-10-18T10:00:00Z", ...overrides,
});
const importInvoice = (overrides = {}) => ({
  id: "ii-1", source_invoice_id: "s-1", invoice_number: "SYN-1002", customer_name: "Example Orchard LLC", transaction_type: "Invoice",
  transaction_date: "2026-07-15", due_date: "2026-08-14", terms: null, po_number: null, reported_aging: null, open_balance: "100.00",
  source_as_of: "2026-08-28", source_row_key: "1:2", review_status: "ready", discrepancy_status: "none", row_data: {},
  proposed_linked_invoice_id: "inv-1", identity: { client_id: "c-1", linked_invoice_id: null, selected_source: "pdf_import" }, ...overrides,
});
const billingInvoice = { id: "inv-1", client_id: "c-1", invoice_number: "LOCAL-001", status: "issued", issue_date: "2026-07-01", due_date: "2026-08-14", total: "125.00", allocated: "0.00", balance: "125.00", days_past_due: 60 };
const clients = [{ id: "c-1", name: "Example Orchard LLC" }, { id: "c-2", name: "Synthetic Dairy" }];
const ok = async () => ({ ok: true, status: 200, data: {} });

test("amounts parse only when they are unambiguous money", () => {
  assert.equal(imports.parseAmount("150.00"), 150);
  assert.equal(imports.parseAmount("$1,234.50"), 1234.5);
  assert.equal(imports.parseAmount("(25.00)"), -25);
  assert.equal(imports.parseAmount("-7.1"), -7.1);
  for (const bad of ["", "SYN-1001", "1.234", "12,34", "1 000.00", "08/31/2026"]) assert.equal(imports.parseAmount(bad), null, bad);
});

test("report dates convert from US format and reject impossible dates", () => {
  assert.equal(imports.parseReportDate("08/31/2026"), "2026-08-31");
  assert.equal(imports.parseReportDate("8/1/2026"), "2026-08-01");
  assert.equal(imports.parseReportDate("2026-08-31"), "2026-08-31");
  for (const bad of ["02/30/2026", "13/01/2026", "Aug 31, 2026", "2026-02-30"]) assert.equal(imports.parseReportDate(bad), null, bad);
});

test("cells come from the parser, or from the joined text when missing", () => {
  assert.deepEqual(imports.rowCells(row("r1", "unreviewed", ["A", "B"])), ["A", "B"]);
  assert.deepEqual(imports.rowCells({ raw_text: "A | B | C", parsed_fields: {} }), ["A", "B", "C"]);
});

test("review progress counts every line exactly once", () => {
  const progress = imports.reviewProgress([row("r1", "invoice"), row("r2", "header"), row("r3", "summary"), row("r4", "ignored"), row("r5", "duplicate"), row("r6", "unreviewed")]);
  assert.deepEqual({ ...progress }, { total: 6, invoices: 1, classified: 3, duplicates: 1, unreviewed: 1 });
});

test("the approval checklist mirrors the server's approval rules", () => {
  const ready = { batch: batch(), rows: [row("r1", "invoice"), row("r2", "header")], invoices: [importInvoice()], revisions: [] };
  const byId = (checks) => Object.fromEntries(checks.map((check) => [check.id, check.ok]));
  assert.deepEqual(byId(imports.approvalChecklist(ready, "u-approver")), { layout: true, as_of: true, invoices: true, ready: true, lines: true, uploader: true });
  assert.equal(byId(imports.approvalChecklist(ready, "u-uploader")).uploader, false, "the uploader cannot approve");
  assert.equal(byId(imports.approvalChecklist({ ...ready, rows: [...ready.rows, row("r3", "unreviewed")] }, "u-approver")).lines, false);
  assert.equal(byId(imports.approvalChecklist({ ...ready, batch: batch({ report_type: "aging_summary" }) }, "u-approver")).layout, false, "summaries are cross-check evidence only");
  assert.equal(byId(imports.approvalChecklist({ ...ready, invoices: [] }, "u-approver")).invoices, false);
  assert.equal(byId(imports.approvalChecklist({ ...ready, invoices: [importInvoice({ review_status: "needs_review" })] }, "u-approver")).ready, false);
  assert.equal(imports.approvalChecklist(ready, null).some((check) => check.id === "uploader"), false, "no uploader claim without a viewer id");
});

test("balance comparison shows report minus Billing in cents", () => {
  assert.deepEqual({ ...imports.compareBalances("100.00", "125.00") }, { pdf: 100, billing: 125, difference: -25, matches: false });
  assert.equal(imports.compareBalances(0.1 + 0.2, "0.30").matches, true, "no floating-point false alarms");
});

test("the linked Billing invoice prefers the applied identity link over the proposal", () => {
  assert.equal(imports.linkedBillingInvoiceId(importInvoice()), "inv-1");
  assert.equal(imports.linkedBillingInvoiceId(importInvoice({ identity: { client_id: "c-1", linked_invoice_id: "inv-9", selected_source: "billing" } })), "inv-9");
  assert.equal(imports.linkedBillingInvoiceId(importInvoice({ proposed_linked_invoice_id: null, identity: null })), null);
});

test("uploads are checked in the browser before sending", () => {
  assert.equal(imports.uploadProblem({ name: "report.pdf", size: 2048, type: "application/pdf" }), null);
  assert.match(imports.uploadProblem({ name: "report.xlsx", size: 2048, type: "" }), /PDF/);
  assert.match(imports.uploadProblem({ name: "report.pdf", size: 26 * 1024 * 1024, type: "application/pdf" }), /25 MB/);
});

test("every import route the UI calls uses the contract's path, method and body", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET", body: init.body, headers: init.headers });
    return new Response(JSON.stringify({}), { status: 200 });
  };
  const api = createBillingApi(fetchImpl);
  await api.imports();
  await api.importBatch("b-1");
  await api.uploadImport(new File([new Uint8Array([37, 80, 68, 70, 45])], "synthetic.pdf", { type: "application/pdf" }));
  await api.parseImport("b-1");
  await api.classifyImportRow("b-1", "r-1", "header");
  await api.reviewImportInvoice("b-1", { source_row_id: "r-1", client_id: "c-1", customer_name: "X", open_balance: 1, confirmed: true });
  await api.approveImport("b-1");
  await api.crossCheckImport("b-2", { detail_batch_id: "b-1", summary_total: 250, note: "Total printed on page 1" });
  await api.resolveDiscrepancy("s-1", { selected_source: "billing", resolution_note: "Payment posted after the report" });
  await api.importFileUrl("b-1");
  assert.deepEqual(calls.map((call) => `${call.method} ${call.url}`), [
    "GET /api/collections/imports",
    "GET /api/collections/imports/b-1",
    "POST /api/collections/imports",
    "POST /api/collections/imports/b-1/parse",
    "PATCH /api/collections/imports/b-1",
    "POST /api/collections/imports/b-1",
    "POST /api/collections/imports/b-1/approve",
    "POST /api/collections/imports/b-2/cross-check",
    "POST /api/collections/imports/invoices/s-1/resolve",
    "GET /api/collections/imports/b-1/file",
  ]);
  const upload = calls[2];
  assert.ok(upload.body instanceof FormData && upload.body.get("file") instanceof File, "multipart upload");
  assert.equal(upload.headers, undefined, "no JSON content type on a multipart body");
  assert.deepEqual(JSON.parse(calls[4].body), { row_id: "r-1", disposition: "header" });
  assert.deepEqual(calls[4].headers, { "Content-Type": "application/json" });
});

test("mapping validation requires a client, the customer, a balance and the PDF check", () => {
  const errors = panels.validateMapping({});
  assert.deepEqual(Object.keys(errors).sort(), ["client_id", "confirmed", "customer_name", "open_balance"]);
  assert.deepEqual(panels.validateMapping({ client_id: "c-1", customer_name: "X", open_balance: "150.00", confirmed: "yes" }), {});
  assert.ok(panels.validateMapping({ client_id: "c-1", customer_name: "X", open_balance: "150.00", confirmed: "yes", due_date: "02/30/2026" }).due_date);
  assert.ok(panels.validateMapping({ client_id: "c-1", customer_name: "X", open_balance: "abc", confirmed: "yes" }).open_balance);
});

test("an unreviewed line offers invoice mapping and the three classifications; a repeated line offers nothing", () => {
  const props = { clientNames: {}, editable: true, mappingOpen: false, onMap: () => {}, onClassify: ok, mappingForm: null };
  const open = render(h("table", null, h("tbody", null, h(panels.LineRow, { ...props, row: row("r1", "unreviewed") }))));
  for (const label of ["Invoice…", "Heading", "Total", "Ignore"]) assert.match(open, new RegExp(label));
  assert.match(open, /SYN-1001/);
  const repeated = render(h("table", null, h("tbody", null, h(panels.LineRow, { ...props, row: row("r2", "duplicate") }))));
  assert.doesNotMatch(repeated, /Heading|Invoice…/);
  const locked = render(h("table", null, h("tbody", null, h(panels.LineRow, { ...props, editable: false, row: row("r3", "unreviewed") }))));
  assert.doesNotMatch(locked, /Heading/, "an approved report is read-only");
});

test("the mapping form shows the line's cells as click-to-fill buttons and never prefills values", () => {
  const html = render(h(panels.InvoiceMappingForm, { row: row("r1", "unreviewed"), clients, billingInvoices: [billingInvoice], onSubmit: ok, onCancel: () => {} }));
  assert.equal((html.match(/data-cell=/g) || []).length, 5);
  assert.match(html, /I checked these values against the PDF/);
  assert.doesNotMatch(html, /value="150.00"/, "the balance is not filled in automatically");
  assert.match(html, /Pick the client first/, "Billing link waits for the client");
});

test("confirmed invoices show the report-versus-Billing arithmetic", () => {
  const html = render(h(panels.ConfirmedInvoices, { invoices: [importInvoice()], clientNames: { "c-1": "Example Orchard LLC" }, billingById: new Map([["inv-1", billingInvoice]]) }));
  assert.match(html, /data-billing-math="differs"/);
  assert.match(html, /Differs by -\$25\.00/);
  assert.match(html, /→ Example Orchard LLC/);
});

test("approval is disabled with the reason shown until every check passes", () => {
  const detail = { batch: batch(), rows: [row("r1", "unreviewed")], invoices: [], revisions: [] };
  const blocked = render(h(panels.ApprovalBox, { detail, viewer: { id: "u-approver", role: "admin", modules: [] }, onApprove: ok }));
  assert.match(blocked, /data-approval-box="blocked"/);
  assert.match(blocked, /1 line still to classify/);
  assert.match(blocked, /disabled=""/);
  const ownUpload = render(h(panels.ApprovalBox, { detail: { ...detail, rows: [row("r1", "invoice")], invoices: [importInvoice()] }, viewer: { id: "u-uploader", role: "owner", modules: [] }, onApprove: ok }));
  assert.match(ownUpload, /data-approval-check="uploader" data-ok="false"/);
});

test("the discrepancy form states the math and both choices with their balances", () => {
  const html = render(h(panels.DiscrepancyResolver, { invoice: importInvoice({ discrepancy_status: "blocked", review_status: "blocked" }), billing: billingInvoice, onResolve: ok }));
  assert.match(html, /Report \(as of 2026-08-28\) \$100\.00 − Billing today \$125\.00 = <b>-\$25\.00<\/b>/);
  assert.match(html, /Use Billing&#x27;s balance \(\$125\.00\)|Use Billing’s balance \(\$125\.00\)/);
  assert.match(html, /Use the report&#x27;s balance \(\$100\.00\)|Use the report’s balance \(\$100\.00\)/);
});

test("the summary cross-check offers only same-date detail reports and shows the last result", () => {
  const summary = batch({ id: "b-sum", report_type: "aging_summary", metadata: { detail_cross_check: { detail_batch_id: "b-1", status: "mismatch", summary_reported_total: "260.00", detail_invoice_total: "250.00", difference: "10.00" } } });
  const html = render(h(panels.CrossCheckForm, { api: {}, batch: summary, batches: [summary, batch(), batch({ id: "b-old", original_filename: "older.pdf", source_as_of: "2026-07-31" })], onDone: async () => {} }));
  assert.match(html, /synthetic-ar\.pdf/);
  assert.doesNotMatch(html, /older\.pdf/);
  assert.match(html, /data-cross-check-result="mismatch"/);
  assert.match(html, /= <b>\$10\.00<\/b>/);
});

test("call-list rows say when a balance comes from an A/R report or is blocked by a difference", () => {
  assert.equal(render(h(SourceNote, { invoice: { source: "billing", source_as_of: null, discrepancy_status: "none" } })), "");
  assert.match(render(h(SourceNote, { invoice: { source: "pdf_import", source_as_of: "2026-08-28", discrepancy_status: "none" } })), /From A\/R report · as of 2026-08-28/);
  assert.match(render(h(SourceNote, { invoice: { source: "billing", source_as_of: "2026-08-28", discrepancy_status: "blocked" } })), /Balances differ/);
});
