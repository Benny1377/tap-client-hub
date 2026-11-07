// Phase 3 screen 1: candidate grouping, permission gating and locked lines.
// Run with: node tests/billing-ui-candidates.test.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { loadTs } from "./helpers/load-ts.mjs";

const require = createRequire(import.meta.url);
const { createElement: h } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const logic = loadTs("lib/billing-ui/candidates.ts");
const vm = loadTs("lib/billing-ui/view-model.ts");
const panels = loadTs("components/billing/candidate-panels.tsx");
const invoicePanels = loadTs("components/billing/invoice-panels.tsx");

const candidate = (id, clientServiceId, overrides = {}) => ({ id, clientId: "c-1", clientServiceId, state: "open", candidateType: "recurring", candidateDate: "2026-11-30", period: "2026-11", description: `Service ${id}`, unitAmount: "125.00", ...overrides });
const bundle = (overrides = {}) => ({ id: "b-1", name: "Monthly package", active: true, effectiveFrom: "2026-01-01", effectiveTo: null, unitAmount: "300.00", components: [{ clientServiceId: "s-1" }, { clientServiceId: "s-2" }], ...overrides });
const noop = async () => ({ ok: true, status: 200, data: {} });
const handlers = { onDismiss: noop, onReopen: noop, onReprice: noop, onDraft: noop };
const list = (props) => renderToStaticMarkup(h(panels.CandidateList, { items: [], bundles: [], filter: "open", canManage: true, canDraft: true, hasMore: false, loadingMore: false, onMore: () => {}, handlers, ...props }));

let passed = 0;
const check = (label, fn) => { try { fn(); passed += 1; } catch (error) { error.message = `${label}: ${error.message}`; throw error; } };

check("ordinary candidates are one row each and selectable when open and priced", () => {
  const units = logic.candidateUnits([candidate("a", "s-9"), candidate("b", "s-8", { unitAmount: null, state: "unpriced" })], []);
  assert.equal(units.length, 2);
  assert.equal(units[0].selectable, true);
  assert.equal(units[1].selectable, false);
});

check("a complete package is one selectable row carrying every candidate, priced once", () => {
  const units = logic.candidateUnits([candidate("a", "s-1", { unitAmount: "300.00" }), candidate("b", "s-2", { unitAmount: "300.00" })], [bundle()]);
  assert.equal(units.length, 1);
  assert.equal(units[0].selectable, true);
  assert.equal(units[0].unitAmount, "300.00");
  assert.deepEqual(logic.selectedCandidateIds(units, new Set([units[0].key])), ["a", "b"]);
});

check("a package missing a service cannot be selected, matching the server", () => {
  const [unit] = logic.candidateUnits([candidate("a", "s-1")], [bundle()]);
  assert.equal(unit.selectable, false);
  assert.match(unit.blockedReason, /needs all 2 services on this date; 1 is ready/);
});

check("two candidates for one package service on a date cannot be selected", () => {
  const [unit] = logic.candidateUnits([candidate("a", "s-1"), candidate("b", "s-1"), candidate("c", "s-2")], [bundle()]);
  assert.equal(unit.selectable, false);
  assert.match(unit.blockedReason, /two candidates for one service/);
});

check("package dates and active flag decide membership", () => {
  assert.equal(logic.candidateUnits([candidate("a", "s-1"), candidate("b", "s-2")], [bundle({ effectiveTo: "2026-10-31" })]).length, 2);
  assert.equal(logic.candidateUnits([candidate("a", "s-1"), candidate("b", "s-2")], [bundle({ active: false })]).length, 2);
  assert.equal(logic.candidateUnits([candidate("a", "s-1"), candidate("b", "s-2", { candidateDate: "2026-12-31" })], [bundle()]).length, 2);
});

check("stale selections are dropped after a refresh", () => {
  const units = logic.candidateUnits([candidate("a", "s-9", { state: "drafted" })], []);
  assert.deepEqual(logic.selectedCandidateIds(units, new Set(["a"])), []);
});

check("the list shows a package price once and never a total", () => {
  const html = list({ items: [candidate("a", "s-1", { unitAmount: "300.00" }), candidate("b", "s-2", { unitAmount: "300.00" })], bundles: [bundle()] });
  assert.equal((html.match(/\$300\.00/g) || []).length, 1);
  assert.doesNotMatch(html, /\$600\.00/);
  assert.match(html, /Monthly package/);
});

check("selection appears only for users who can draft, on the Ready filter", () => {
  const items = [candidate("a", "s-9")];
  assert.match(list({ items }), /type="checkbox"/);
  assert.doesNotMatch(list({ items, canDraft: false }), /type="checkbox"/);
  assert.doesNotMatch(list({ items, filter: "dismissed" }), /type="checkbox"/);
});

check("actions appear only for users who can manage candidates", () => {
  const items = [candidate("a", "s-9")];
  assert.match(list({ items }), /Dismiss/);
  assert.doesNotMatch(list({ items, canManage: false }), /Dismiss/);
  assert.match(list({ items: [candidate("a", "s-9", { state: "dismissed" })], filter: "dismissed" }), /Reopen/);
});

check("drafting waits when packages could not be loaded", () => {
  const html = list({ items: [candidate("a", "s-9")], bundles: null });
  assert.doesNotMatch(html, /type="checkbox"/);
  assert.match(html, /Package pricing could not be loaded/);
});

check("an empty list says so", () => {
  assert.match(list({ filter: "unpriced" }), /No no price candidates|No .* candidates for this client/);
});

const line = (overrides = {}) => ({ id: "l-1", invoice_id: "inv-1", client_service_id: null, period: null, description: "Bookkeeping", quantity: "1", unit_amount: "125.00", amount: "125.00", sort_order: 0, ...overrides });
const invoice = (overrides = {}) => ({ id: "inv-1", client_id: "c-1", invoice_number: null, status: "draft", issue_date: null, due_date: null, memo: null, created_by: null, created_at: "", voided_by: null, voided_at: null, void_reason: null, invoice_lines: [line()], ...overrides });
const staff = { role: "staff", modules: ["Billing"] };
const owner = { role: "owner", modules: [] };
const detailHandlers = { onUpdate: noop, onAddLine: noop, onUpdateLine: noop, onDeleteLine: noop, onIssue: noop, onVoid: noop, onDeleteDraft: noop };
const detail = (inv, viewer, permissions) => renderToStaticMarkup(h(invoicePanels.InvoiceDetail, { invoice: inv, receivable: null, viewer, permissions, handlers: detailHandlers }));

check("permissions shape invoice actions", () => {
  const none = vm.invoiceActions(invoice(), staff, []);
  assert.equal(none.editable, false);
  assert.equal(none.canDeleteDraft, false);
  assert.equal(none.canIssue, false);
  assert.match(none.issueBlockedReason, /do not have permission to issue/);
  const full = vm.invoiceActions(invoice(), staff, ["invoices.draft.manage", "invoices.issue"]);
  assert.equal(full.editable, true);
  assert.equal(full.canIssue, true);
  assert.equal(vm.invoiceActions(invoice(), staff).editable, true, "no list falls back to the role");
});

check("a candidate-linked line is locked and offers only removal", () => {
  const granted = ["invoices.draft.manage", "invoices.issue"];
  const html = detail(invoice({ invoice_lines: [line({ candidateIds: ["ca-1"] })] }), staff, granted);
  assert.match(html, /data-line-locked/);
  assert.match(html, /Remove and return candidate/);
  assert.doesNotMatch(html, /Save line/);
  assert.match(detail(invoice({ invoice_lines: [line({ candidateIds: ["a", "b"] })] }), staff, granted), /Remove and return candidates/);
});

check("an ordinary line stays editable", () => {
  const html = detail(invoice({ invoice_lines: [line({ candidateIds: [] })] }), staff, ["invoices.draft.manage"]);
  assert.match(html, /Save line/);
  assert.doesNotMatch(html, /data-line-locked/);
});

check("a user without draft access sees no edit or delete controls", () => {
  const html = detail(invoice(), staff, ["billing.view"]);
  assert.doesNotMatch(html, /Save line|Add line|Delete draft|Save draft/);
});

check("drafts and voids say linked candidates go back to Ready", () => {
  const granted = ["invoices.draft.manage"];
  assert.match(detail(invoice({ invoice_lines: [line({ candidateIds: ["a"] })] }), staff, granted), /Its candidates go back to Ready/);
  assert.match(detail(invoice({ status: "issued", invoice_number: "TAP-1", issue_date: "2026-11-01", due_date: "2026-11-16", invoice_lines: [line({ candidateIds: ["a"] })] }), owner, ["invoices.void"]), /Its candidates go back to Ready/);
  assert.doesNotMatch(detail(invoice(), staff, granted), /go back to Ready/);
});

const work = loadTs("lib/billing-ui/workbench.ts");
check("billing runs fall on month ends, across a year end", () => {
  assert.deepEqual(work.nextRunDates("2026-11-06"), ["2026-11-30", "2026-12-31", "2027-01-31"]);
  assert.deepEqual(work.nextRunDates("2028-01-15", 2), ["2028-01-31", "2028-02-29"]);
});
check("the firm date is Houston's, not the browser's", () => {
  assert.equal(work.firmToday(new Date("2026-11-07T03:00:00Z")), "2026-11-06");
  assert.equal(work.firmToday(new Date("2026-03-08T07:59:00Z")), "2026-03-08");
});
check("runs place work by month and show a package once", () => {
  const runs = ["2026-11-30", "2026-12-31"];
  const item = (id, date, amount = "300.00") => ({ clientServiceId: id, candidateDate: date, description: `Service ${id}`, unitAmount: amount });
  const rows = work.runRows([item("s-1", "2026-11-30"), item("s-2", "2026-11-30"), item("s-9", "2026-12-05", null)], runs, [bundle()]);
  assert.equal(rows.length, 2);
  const pack = rows.find((row) => row.packaged);
  assert.equal(pack.description, "Monthly package");
  assert.equal(pack.cells["2026-11-30"].amount, "300.00");
  const other = rows.find((row) => !row.packaged);
  assert.equal(other.cells["2026-12-31"].amount, null);
  assert.match(work.whyItMoves(other, runs), /No price yet/);
  assert.match(work.whyItMoves(other, runs), /Bills in 31 Dec only/);
});
check("priced how follows the server's order", () => {
  const override = { id: "o", clientServiceId: "s-1", unitAmount: "1.00", effectiveFrom: "2026-01-01" };
  assert.equal(work.pricedHow("s-1", "2026-11-30", [override], [bundle()]), "Package");
  assert.equal(work.pricedHow("s-1", "2026-11-30", [override], []), "Own price");
  assert.equal(work.pricedHow("s-1", "2025-11-30", [override], []), "Rate card");
});
check("client rows count, and never add money", () => {
  const [row] = work.clientRows([{ id: "c-1", name: "A" }], [{ client_id: "c-1", balance: "10.00", days_past_due: 4 }, { client_id: "c-1", balance: "0.00", days_past_due: 90 }], [candidate("a", "s-1")], []);
  assert.deepEqual({ open: row.openInvoices, past: row.daysPastDue, ready: row.ready, none: row.noPrice }, { open: 1, past: 4, ready: 1, none: 0 });
});

check("a package row in the firm schedule is known by its source", () => {
  assert.equal(work.isPackageRow("bundle:b-1:2026-11-30"), true);
  assert.equal(work.isPackageRow("schedule:s-1:2026-11"), false);
});

check("the monthly note never reads a partial total as complete", () => {
  assert.equal(work.monthlyNote(true, 0), "average month");
  assert.match(work.monthlyNote(false, 2), /partial · 2 services have no price/);
  assert.match(work.monthlyNote(false, 1), /1 service has no price/);
  assert.match(work.monthlyNote(false, 0), /partial/);
});

check("firm details show on a draft only, so an issued invoice never changes", () => {
  const { InvoiceDocument } = loadTs("components/billing/invoice-document.tsx");
  const presentation = { firmName: "Firm Now", tagline: "Tag now", invoiceFooter: "Foot now", invoiceNumberPrefix: "TAP", updatedAt: null };
  const remittance = { payeeName: "Saved Payee", address: null, instructions: null };
  const render = (status) => renderToStaticMarkup(h(InvoiceDocument, { invoice: { id: "i-1", client_id: "c-1", status, invoice_number: status === "draft" ? null : "TAP-1", invoice_lines: [] }, clientName: "Client", receivable: null, remittance, presentation }));
  const draft = render("draft");
  assert.match(draft, /Firm Now/); assert.match(draft, /Tag now/); assert.match(draft, /Foot now/);
  const issued = render("issued");
  assert.match(issued, /Saved Payee/); assert.doesNotMatch(issued, /Firm Now|Tag now|Foot now/);
});

check("the firm date follows Houston across a month end and both clock changes", () => {
  assert.equal(work.firmToday(new Date("2026-12-01T05:30:00Z")), "2026-11-30");
  assert.equal(work.firmToday(new Date("2026-12-01T06:30:00Z")), "2026-12-01");
  assert.equal(work.firmToday(new Date("2026-03-08T07:59:00Z")), "2026-03-08");
  assert.equal(work.firmToday(new Date("2026-03-08T04:59:00Z")), "2026-03-07");
  assert.equal(work.firmToday(new Date("2026-11-01T05:30:00Z")), "2026-11-01");
  assert.equal(work.firmToday(new Date("2026-11-02T05:30:00Z")), "2026-11-01");
});

check("run dates land on real month ends, over a year end and a leap February", () => {
  assert.deepEqual(work.nextRunDates("2026-12-31"), ["2026-12-31", "2027-01-31", "2027-02-28"]);
  assert.deepEqual(work.nextRunDates("2028-01-31"), ["2028-01-31", "2028-02-29", "2028-03-31"]);
  assert.deepEqual(work.nextRunDates("2026-11-30"), ["2026-11-30", "2026-12-31", "2027-01-31"]);
});

console.log(`billing UI candidate checks passed (${passed})`);
