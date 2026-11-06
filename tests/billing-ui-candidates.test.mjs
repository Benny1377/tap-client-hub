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

console.log(`billing UI candidate checks passed (${passed})`);
