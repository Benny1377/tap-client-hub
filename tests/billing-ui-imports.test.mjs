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

// ---- Source-aware holds and activity, re-import identity, permissions -------------
const vm = loadTs("lib/billing-ui/view-model.ts");
const { invoiceTargetFields } = loadTs("lib/billing-ui/api.ts");
const collections = loadTs("components/billing/collections-panels.tsx");
const TODAY = "2026-10-18";
const pdfHold = { id: "h-1", client_id: "c-1", invoice_id: null, source: "pdf_import", source_invoice_id: "s-1", canonical_collection_identity: "pdf_import:s-1", invoice_number: "SYN-1001", reason: "Synthetic dispute", placed_by: null, placed_at: "2026-10-18T10:00:00Z", expires_on: null, released_by: null, released_at: null };

test("a hold on a report-only invoice is an invoice hold, not a whole-client hold", () => {
  assert.equal(vm.invoiceScope(pdfHold), "pdf_import:s-1");
  assert.equal(vm.invoiceScope({ invoice_id: null, source_invoice_id: null }), null, "whole client");
  assert.equal(vm.invoiceScope({ invoice_id: "inv-1" }), "billing:inv-1");
  assert.equal(vm.holdBlocks([pdfHold], TODAY, "c-1", null), false, "does not block client-level requests");
  assert.equal(vm.holdBlocks([pdfHold], TODAY, "c-1", "inv-1"), false, "does not block a Billing invoice");
  assert.equal(vm.holdBlocks([pdfHold], TODAY, "c-1", { invoice_id: null, source_invoice_id: "s-1", canonical_collection_identity: "pdf_import:s-1" }), true);
  const request = { id: "e-1", client_id: "c-1", invoice_id: null, source_invoice_id: "s-2", canonical_collection_identity: "pdf_import:s-2", event_type: "escalation_requested", stage: 4, occurred_at: "2026-10-18T11:00:00Z", actor: null, detail: {}, approves_event_id: null };
  assert.equal(vm.approvalRequests([request], [pdfHold], { role: "owner", modules: [] }, TODAY)[0].state, "can_approve", "another invoice's hold does not block approval");
});

test("form choices become the route's invoice target", () => {
  assert.deepEqual({ ...invoiceTargetFields("") }, { invoice_id: null });
  assert.deepEqual({ ...invoiceTargetFields("inv-1") }, { invoice_id: "inv-1" });
  assert.deepEqual(JSON.parse(JSON.stringify(invoiceTargetFields("pdf_import:s-1"))), { target: { source: "pdf_import", source_invoice_id: "s-1" } });
});

test("holds, history and the activity form name report-only invoices", () => {
  const options = [{ id: "inv-1", invoice_number: "LOCAL-001", client_id: "c-1", source: "billing" }, { id: "pdf_import:s-1", invoice_number: "SYN-1001", client_id: "c-1", source: "pdf_import", source_invoice_id: "s-1", source_as_of: "2026-08-28" }];
  const holdsHtml = render(h(collections.HoldsPanel, { holds: [pdfHold], clientId: "c-1", clientNames: {}, invoiceOptions: options, viewer: { role: "owner", modules: [] }, today: TODAY, onPlace: ok, onRelease: ok }));
  assert.match(holdsHtml, /Invoice SYN-1001 \(A\/R report\) only/);
  assert.doesNotMatch(holdsHtml, /Whole client/);
  assert.match(holdsHtml, /value="pdf_import:s-1"[^>]*>Invoice SYN-1001 \(A\/R report as of 2026-08-28\) only/);
  const event = { id: "e-1", client_id: "c-1", invoice_id: null, source_invoice_id: "s-1", canonical_collection_identity: "pdf_import:s-1", invoice_number: "SYN-1001", event_type: "call_logged", stage: null, occurred_at: "2026-10-18T11:00:00Z", actor: null, detail: { note: "Called" }, approves_event_id: null };
  const activity = render(h(collections.ActivityPanel, { events: [event], holds: [pdfHold], invoiceOptions: options, clientId: "c-1", clientNames: {}, viewer: { role: "staff", modules: ["Collections"] }, today: TODAY, onLog: ok, onApprove: ok, onRecordNoticeSent: ok }));
  assert.match(activity, /<td class="bc-nowrap">SYN-1001 \(A\/R report\)<\/td>/);
  assert.match(activity, /data-invoice-holds/, "the held report invoice is called out");
  assert.doesNotMatch(activity, /data-requests-blocked/, "no client-wide warning for an invoice hold");
});

test("earlier imports are matched by client and invoice number or Billing link, as a suggestion only", () => {
  const priors = imports.priorImportsFrom({ accounts: [{ client_id: "c-1", invoices: [
    { source_invoice_id: "s-1", invoice_id: null, invoice_number: "SYN-1001", balance: "150.00", source_as_of: "2026-08-28" },
    { source_invoice_id: "s-2", invoice_id: "inv-1", invoice_number: "LOCAL-001", balance: "125.00", source_as_of: "2026-08-28" },
    { source_invoice_id: null, invoice_id: "inv-2", invoice_number: "LOCAL-002", balance: "80.00" },
  ] }] });
  assert.deepEqual(priors.map((item) => item.source_invoice_id), ["s-1", "s-2"], "only rows that came from a report");
  assert.equal(imports.suggestPriorImport(priors, "c-1", " syn-1001 ", null)?.source_invoice_id, "s-1");
  assert.equal(imports.suggestPriorImport(priors, "c-1", "OTHER", "inv-1")?.source_invoice_id, "s-2");
  assert.equal(imports.suggestPriorImport(priors, "c-2", "SYN-1001", null), null, "never across clients");
  assert.equal(imports.suggestPriorImport(priors, null, "SYN-1001", null), null);
});

test("a matching earlier import is offered as a suggestion for a new line", () => {
  const priors = [{ source_invoice_id: "s-old", client_id: "c-1", invoice_number: "SYN-1001", balance: "150.00", source_as_of: "2026-07-31", invoice_id: null }];
  // An unmatched new line, prefilled the way a correction would be, so the client is set.
  const html = render(h(panels.InvoiceMappingForm, { row: row("r9", "unreviewed"), existing: importInvoice({ invoice_number: "SYN-1001", open_balance: "120.00", proposed_linked_invoice_id: null }), clients, billingInvoices: [billingInvoice], priorImports: priors, onSubmit: ok, onCancel: () => {} }));
  assert.match(html, /data-field="existing_source_invoice_id"/);
  assert.match(html, /data-prior-suggestion="s-old"/);
  assert.match(html, /This looks like <b>SYN-1001<\/b> from the report as of 2026-07-31/);
});

test("correcting a confirmed line starts from its confirmed values and keeps its identity", () => {
  const confirmed = { ...row("r5", "invoice"), source_invoice_id: "s-1" };
  const html = render(h(panels.InvoiceMappingForm, { row: confirmed, existing: importInvoice({ invoice_number: "SYN-1001", open_balance: "150.00" }), clients, billingInvoices: [billingInvoice], priorImports: [{ source_invoice_id: "s-old", client_id: "c-1", invoice_number: "SYN-1001", balance: "1.00", source_as_of: null, invoice_id: null }], onSubmit: ok, onCancel: () => {} }));
  assert.match(html, /data-field="open_balance"[^>]*value="150.00"/);
  assert.match(html, /data-field="customer_name"[^>]*value="Example Orchard LLC"/);
  assert.doesNotMatch(html, /data-field="existing_source_invoice_id"/, "an already-confirmed line keeps its identity");
  assert.doesNotMatch(html, /data-field="confirmed" checked/, "the PDF check must be ticked again");
});

test("an invoice's earlier reviewed balance is shown when it changed", () => {
  const revisions = [
    { id: "rv-2", batch_id: "b-0", source_invoice_id: "s-1", actor: null, snapshot: { open_balance: "100.00", source_as_of: "2026-08-28" }, created_at: "2026-10-18T10:00:00Z" },
    { id: "rv-1", batch_id: "b-old", source_invoice_id: "s-1", actor: null, snapshot: { open_balance: "150.00", source_as_of: "2026-07-31" }, created_at: "2026-09-01T10:00:00Z" },
  ];
  assert.equal(imports.earlierBalance({ source_invoice_id: "s-1", open_balance: "100.00" }, revisions)?.balance, "150.00", "skips unchanged snapshots");
  assert.equal(imports.earlierBalance({ source_invoice_id: "s-9", open_balance: "100.00" }, revisions), null);
  const html = render(h(panels.ConfirmedInvoices, { invoices: [importInvoice({ open_balance: "120.00" })], revisions: [{ ...revisions[0], snapshot: { open_balance: "150.00", source_as_of: "2026-07-31" } }], clientNames: {}, billingById: new Map() }));
  assert.match(html, /was \$150\.00 \(as of 2026-07-31\)/);
});

test("permission changes keep Owner/Admin in every action", () => {
  const policy = { upload: ["owner", "admin", "collections"], review: ["owner", "admin", "collections"], approve: ["owner", "admin"] };
  assert.deepEqual([...imports.togglePolicy(policy, "approve", "collections", true).approve].sort(), ["admin", "collections", "owner"]);
  assert.deepEqual([...imports.togglePolicy(policy, "review", "collections", false).review].sort(), ["admin", "owner"]);
  assert.deepEqual([...imports.togglePolicy({ upload: [], review: [], approve: [] }, "upload", "billing", true).upload].sort(), ["admin", "billing", "owner"]);
});

test("permission and delivery-history calls use the contract's routes", async () => {
  const calls = [];
  const api = createBillingApi(async (url, init = {}) => { calls.push(`${init.method || "GET"} ${url}${init.body ? ` ${init.body}` : ""}`); return new Response("{}", { status: 200 }); });
  await api.importPermissions();
  await api.updateImportPermissions({ upload: ["owner", "admin"], review: ["owner", "admin"], approve: ["owner", "admin"] });
  await api.deliveries({ sourceInvoiceId: "s-1" });
  assert.deepEqual(calls, [
    "GET /api/collections/imports/permissions",
    'PATCH /api/collections/imports/permissions {"policy":{"upload":["owner","admin"],"review":["owner","admin"],"approve":["owner","admin"]}}',
    "GET /api/collections/deliveries?source_invoice_id=s-1",
  ]);
});

test("a success response without a JSON body is reported as a failure, not as null data", async () => {
  const api = createBillingApi(async () => new Response("<html>reloading</html>", { status: 200, headers: { "Content-Type": "text/html" } }));
  const result = await api.deliveries({});
  assert.equal(result.ok, false);
  assert.equal(result.kind, "server");
});

test("report details can be corrected only in review and before any invoice is confirmed", () => {
  assert.equal(imports.canCorrectMetadata({ batch: batch(), invoices: [] }), true);
  assert.equal(imports.canCorrectMetadata({ batch: batch(), invoices: [importInvoice()] }), false);
  assert.equal(imports.canCorrectMetadata({ batch: batch({ status: "approved" }), invoices: [] }), false);
  assert.equal(imports.metadataNeedsReview({ report_type: "unknown", source_as_of: "2026-08-28" }), true);
  assert.equal(imports.metadataNeedsReview({ report_type: "aging_detail", source_as_of: null }), true);
  assert.equal(imports.metadataNeedsReview({ report_type: "aging_detail", source_as_of: "2026-08-28" }), false);
});

test("an unread layout or date opens the correction form; otherwise it is an optional fix", () => {
  const needed = render(h(panels.MetadataCorrection, { batch: { report_type: "unknown", source_as_of: null }, onCorrect: ok }));
  assert.match(needed, /data-metadata-correction="needed"/);
  assert.match(needed, /The layout wasn(&#x27;|’)t recognized/);
  assert.match(needed, /I read the report type and date from the PDF/);
  assert.doesNotMatch(needed, /data-field="metadata_confirmed" checked/, "the confirmation is never pre-ticked");
  const optional = render(h(panels.MetadataCorrection, { batch: { report_type: "aging_detail", source_as_of: "2026-08-28" }, onCorrect: ok }));
  assert.match(optional, /data-metadata-correction="optional"/);
  assert.match(optional, /Report type or date read wrong\?/);
});

test("the metadata correction call matches the contract", async () => {
  const calls = [];
  const api = createBillingApi(async (url, init = {}) => { calls.push(`${init.method} ${url} ${init.body}`); return new Response("{}", { status: 200 }); });
  await api.correctImportMetadata("b-1", { report_type: "aging_detail", source_as_of: "2026-08-28" });
  assert.deepEqual(calls, ['PATCH /api/collections/imports/b-1/metadata {"report_type":"aging_detail","source_as_of":"2026-08-28","confirmed":true}']);
});
