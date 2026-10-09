// Billing and Collections UI rendering: loading, validation errors, 403s,
// lifecycle states, active holds, and Owner/Admin approval boundaries.
// Renders the real components with react-dom/server.
// Run with: node tests/billing-ui-render.test.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { loadTs } from "./helpers/load-ts.mjs";

const require = createRequire(import.meta.url);
const { createElement: h } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const ui = loadTs("components/billing/ui.tsx");
const invoicePanels = loadTs("components/billing/invoice-panels.tsx");
const paymentPanels = loadTs("components/billing/payment-panels.tsx");
const collections = loadTs("components/billing/collections-panels.tsx");
const BillingPage = loadTs("app/billing/page.tsx").default;
const CollectionsPage = loadTs("app/collections/page.tsx").default;

const render = (element) => renderToStaticMarkup(element);
const noop = async () => ({ ok: true, status: 200, data: {} });
let passed = 0;
function check(label, fn) {
  try {
    fn();
    passed += 1;
  } catch (error) {
    error.message = `${label}: ${error.message}`;
    throw error;
  }
}

const owner = { role: "owner", modules: [] };
const staff = { role: "staff", modules: ["Billing", "Collections"] };
const manager = { role: "manager", modules: ["Billing", "Collections"] };
const line = { id: "l-1", invoice_id: "inv-1", client_service_id: null, period: "2026-10", description: "Monthly bookkeeping", quantity: "1.0000", unit_amount: "250.00", amount: "250.00", sort_order: 0 };
const invoice = (overrides = {}) => ({
  id: "inv-1", client_id: "c-1", invoice_number: "TAP-1", status: "draft", issue_date: "2026-10-01", due_date: "2026-10-31", memo: null,
  created_by: null, created_at: "2026-10-01T00:00:00Z", voided_by: null, voided_at: null, void_reason: null, invoice_lines: [], ...overrides,
});
const receivable = { id: "inv-1", client_id: "c-1", invoice_number: "TAP-1", status: "issued", issue_date: "2026-10-01", due_date: "2026-10-31", total: "250.00", allocated: "100.00", balance: "150.00", days_past_due: 12, aging_bucket: "1_30" };
const TODAY = "2026-10-09";
const handlers = { onUpdate: noop, onAddLine: noop, onUpdateLine: noop, onDeleteLine: noop, onIssue: noop, onVoid: noop, onDeleteDraft: noop };
const detail = (inv, viewer, rec = null) => render(h(invoicePanels.InvoiceDetail, { invoice: inv, receivable: rec, viewer, handlers }));

// --- Loading -------------------------------------------------------------
check("sections show a loading status", () => {
  const html = render(h(ui.SectionView, { state: { status: "loading" }, label: "invoices", children: () => "ready" }));
  assert.match(html, /role="status"/);
  assert.match(html, /Loading invoices…/);
});

check("pages render every section as loading before the API responds", () => {
  const billing = render(h(BillingPage));
  for (const label of ["invoices", "payments", "receivables"]) assert.match(billing, new RegExp(`Loading ${label}…`));
  const collectionsHtml = render(h(CollectionsPage));
  for (const label of ["receivables", "Collections activity", "holds"]) assert.match(collectionsHtml, new RegExp(`Loading ${label}…`));
});

// --- 403 and other server errors -------------------------------------------
check("a 403 section shows the forbidden message, not data", () => {
  const html = render(h(ui.SectionView, { state: { status: "error", kind: "forbidden", message: "Forbidden" }, label: "holds", children: () => "SECRET DATA" }));
  assert.match(html, /role="alert"/);
  assert.match(html, /data-error-kind="forbidden"/);
  assert.match(html, /don&#x27;t have access/);
  assert.doesNotMatch(html, /SECRET DATA/);
});

check("401 and 409 have their own guidance", () => {
  assert.match(render(h(ui.ErrorBanner, { kind: "unauthorized", message: "Unauthorized" })), /Sign in again/);
  assert.match(render(h(ui.ErrorBanner, { kind: "conflict", message: "invariant_violation: invoice would be over-allocated" })), /reloaded[\s\S]*over-allocated/);
});

// --- Validation errors -----------------------------------------------------
check("field errors are rendered next to their inputs and marked invalid", () => {
  const html = render(h(ui.LedgerFormView, {
    fields: [{ name: "amount", label: "Amount" }, { name: "method", label: "Method", type: "select", options: [{ value: "ach", label: "ACH" }] }],
    values: { amount: "1.005", method: "" },
    errors: { amount: "Amount must be positive with at most two decimals.", method: "Choose a payment method." },
    serverError: null, submitting: false, submitLabel: "Record payment", onChange: () => {}, onSubmit: () => {},
  }));
  assert.match(html, /id="field-amount"[^>]*aria-invalid="true"[^>]*aria-describedby="field-amount-error"|aria-invalid="true"[^>]*id="field-amount"/);
  assert.match(html, /data-field-error="amount"[^>]*>Amount must be positive/);
  assert.match(html, /data-field-error="method"[^>]*>Choose a payment method/);
});

check("server 422 and 403 responses from a submit are shown in the form", () => {
  const base = { fields: [{ name: "reason", label: "Reason" }], values: { reason: "x" }, errors: {}, submitting: false, submitLabel: "Save", onChange: () => {}, onSubmit: () => {} };
  const invalid = render(h(ui.LedgerFormView, { ...base, serverError: { kind: "invalid", message: "due_date must be on or after issue_date" } }));
  assert.match(invalid, /data-error-kind="invalid"[\s\S]*due_date must be on or after issue_date/);
  const forbidden = render(h(ui.LedgerFormView, { ...base, serverError: { kind: "forbidden", message: "Forbidden" } }));
  assert.match(forbidden, /data-error-kind="forbidden"/);
});

check("a submitting form disables its button", () => {
  const html = render(h(ui.LedgerFormView, { fields: [], values: {}, errors: {}, serverError: null, submitting: true, submitLabel: "Save", onChange: () => {}, onSubmit: () => {} }));
  assert.match(html, /<button type="submit" disabled=""[^>]*>Saving…<\/button>/);
});

// --- Invoice lifecycle states ---------------------------------------------
check("draft without lines: editable, issue blocked with a reason", () => {
  const html = detail(invoice(), staff);
  assert.match(html, /data-lifecycle="draft"/);
  assert.match(html, /aria-label="Add line"/);
  assert.match(html, /aria-label="Edit draft"/);
  assert.match(html, /data-issue-blocked[^>]*>Add at least one line/);
  assert.match(html, /data-delete-draft[\s\S]*>Delete this draft</);
  assert.doesNotMatch(html, />Issue invoice</);
  assert.doesNotMatch(html, /data-void-control/);
});

check("draft with lines: lines are editable and can be issued", () => {
  const html = detail(invoice({ invoice_lines: [line] }), staff);
  assert.match(html, />Issue invoice</);
  assert.match(html, /data-line-row="l-1"[\s\S]*>Edit<[\s\S]*>Remove</);
});

check("issued for staff and managers: locked, void requires Owner/Admin", () => {
  for (const viewer of [staff, manager]) {
    const html = detail(invoice({ status: "issued", invoice_lines: [line] }), viewer, receivable);
    assert.match(html, /data-lifecycle="issued"/);
    assert.match(html, /Issued invoices are locked/);
    assert.doesNotMatch(html, /aria-label="Add line"|>Edit<|>Remove<|>Issue invoice<|data-delete-draft/);
    assert.doesNotMatch(html, /data-void-control/);
    assert.match(html, /data-approval-boundary="owner-admin"[^>]*>Voiding an invoice requires Owner\/Admin/);
  }
});

check("issued for Owner/Admin: void control with balance from the API", () => {
  const html = detail(invoice({ status: "issued", invoice_lines: [line] }), owner, receivable);
  assert.match(html, /data-void-control/);
  assert.doesNotMatch(html, /data-approval-boundary/);
  assert.match(html, /Balance <strong>\$150\.00<\/strong>/);
  assert.match(html, /12 days past due/);
});

check("void invoices show the reason and no actions", () => {
  const html = detail(invoice({ status: "void", voided_at: "2026-10-05T10:00:00Z", void_reason: "Duplicate", invoice_lines: [line] }), owner);
  assert.match(html, /data-lifecycle="void"/);
  assert.match(html, /Voided 2026-10-05: Duplicate/);
  assert.doesNotMatch(html, /Issue invoice|data-void-control|aria-label="Add line"|data-delete-draft/);
});

check("invoice list shows status and server balance", () => {
  const html = render(h(invoicePanels.InvoiceList, { invoices: [invoice({ status: "issued" })], receivables: [receivable], clientNames: { "c-1": "Acme LLC" }, selectedId: null, onSelect: () => {} }));
  assert.match(html, /Acme LLC/);
  assert.match(html, /data-status="issued"/);
  assert.match(html, /\$150\.00/);
});

// --- Payments, allocations, receivables -----------------------------------
const payment = {
  id: "p-1", client_id: "c-1", received_on: "2026-10-03", amount: "100.00", method: "ach", reference: "ACH-9", status: "recorded",
  reversed_by: null, reversed_at: null, reversal_reason: null, created_by: null,
  payment_allocations: [
    { id: "a-1", payment_id: "p-1", invoice_id: "inv-1", amount: "60.00", created_by: null, created_at: "2026-10-03T00:00:00Z", reversed_at: null },
    { id: "a-2", payment_id: "p-1", invoice_id: "inv-1", amount: "40.00", created_by: null, created_at: "2026-10-03T00:00:00Z", reversed_at: "2026-10-04T00:00:00Z" },
  ],
};
const paymentsPanel = (viewer) => render(h(paymentPanels.PaymentsPanel, {
  payments: [payment], invoices: [invoice({ status: "issued", invoice_lines: [line] })], receivables: [receivable], clientId: "c-1",
  clientNames: {}, viewer, handlers: { onRecord: noop, onAllocate: noop, onReversePayment: noop, onReverseAllocation: noop },
}));

check("staff see payments and can allocate, but reversals require Owner/Admin", () => {
  const html = paymentsPanel(staff);
  assert.match(html, /data-allocation="a-1" data-allocation-state="active"/);
  assert.match(html, /data-allocation="a-2" data-allocation-state="reversed"[^>]*>[\s\S]*\(reversed\)/);
  assert.doesNotMatch(html, /data-reverse-payment|>Reverse</);
  assert.match(html, /Reversing a payment or an allocation requires Owner\/Admin/);
  assert.match(html, /aria-label="Allocate payment"[\s\S]*TAP-1 · balance \$150\.00/);
});

check("Owner/Admin see reversal controls only for active records", () => {
  const html = paymentsPanel(owner);
  assert.match(html, /data-reverse-payment/);
  assert.equal((html.match(/>Reverse<\/button>/g) || []).length, 1, "only the active allocation can be reversed");
  assert.doesNotMatch(html, /data-approval-boundary/);
});

check("receivables render server-derived totals", () => {
  const html = render(h(paymentPanels.ReceivablesTable, { receivables: [receivable], clientNames: { "c-1": "Acme LLC" } }));
  assert.match(html, /\$250\.00[\s\S]*\$100\.00[\s\S]*\$150\.00/);
  assert.match(html, />12</);
  assert.match(html, /data-aging="1_30"[^>]*>1–30 days</);
});

// --- Holds -----------------------------------------------------------------
const hold = (overrides = {}) => ({ id: "h-1", client_id: "c-1", invoice_id: null, reason: "Disputed fee", placed_by: "u", placed_at: "2026-10-01T00:00:00Z", expires_on: null, released_by: null, released_at: null, ...overrides });
const holdsPanel = (holds, viewer) => render(h(collections.HoldsPanel, { holds, clientId: "c-1", clientNames: {}, viewer, today: TODAY, onPlace: noop, onRelease: noop }));
const banner = (holds, clientId = "c-1") => render(h(collections.ActiveHoldBanner, { holds, clientId, clientNames: { "c-1": "Acme LLC" }, invoiceNumbers: { "inv-1": "TAP-1" }, today: TODAY }));

check("hold banner appears only while a hold is in force, with its scope", () => {
  const active = banner([hold()]);
  assert.match(active, /data-active-hold-banner/);
  assert.match(active, /Acme LLC\. Escalation[\s\S]*blocked/);
  assert.match(banner([hold({ invoice_id: "inv-1" })]), /Acme LLC \(invoice TAP-1\)/);
  assert.equal(banner([hold({ released_at: "2026-10-05T00:00:00Z" })]), "");
  assert.equal(banner([hold({ expires_on: "2026-10-01" })]), "", "expired holds no longer block");
  assert.equal(banner([hold()], "c-2"), "");
});

check("Owner/Admin can place and release holds", () => {
  const html = holdsPanel([hold()], owner);
  assert.match(html, /data-hold-state="active"[\s\S]*>Release hold</);
  assert.match(html, /aria-label="Place hold"/);
});

check("staff and managers cannot place or release holds", () => {
  for (const viewer of [staff, manager]) {
    const html = holdsPanel([hold()], viewer);
    assert.doesNotMatch(html, /Release hold|aria-label="Place hold"/);
    assert.match(html, /Placing or releasing a hold requires Owner\/Admin/);
  }
});

check("an unreleased hold past its review date shows as expired and no longer blocking", () => {
  const html = holdsPanel([hold({ expires_on: "2026-10-01" })], owner);
  assert.match(html, /data-hold-state="expired"/);
  assert.match(html, /Expired, not released/);
  assert.match(html, /no longer blocks/);
  assert.match(html, />Release hold</, "Owner/Admin can still close it out");
});

// --- Collections events and approval boundaries ---------------------------
const request = { id: "e-1", client_id: "c-1", invoice_id: null, event_type: "formal_notice_requested", stage: null, occurred_at: "2026-10-02T09:00:00Z", actor: "u", detail: { note: "Third reminder ignored" }, approves_event_id: null };
const eventsPanel = (events, holds, viewer) => render(h(collections.EventsPanel, { events, holds, receivables: [receivable], clientId: "c-1", clientNames: {}, viewer, today: TODAY, onLog: noop, onApprove: noop }));

check("Owner/Admin get an approve button", () => {
  const html = eventsPanel([request], [], owner);
  assert.match(html, /data-approval-state="can_approve"[\s\S]*>Approve formal notice</);
});

check("staff and managers see the Owner/Admin boundary instead of an approve button", () => {
  for (const viewer of [staff, manager]) {
    const html = eventsPanel([request], [], viewer);
    assert.match(html, /data-approval-state="requires_owner_admin"/);
    assert.doesNotMatch(html, />Approve formal notice<\/button>/);
    assert.match(html, /Approve formal notice requires Owner\/Admin/);
  }
});

check("a client-wide hold blocks approval even for Owner/Admin and warns before requesting", () => {
  const html = eventsPanel([request], [hold()], owner);
  assert.match(html, /data-approval-state="blocked_by_hold"/);
  assert.match(html, /data-blocked-by-hold/);
  assert.doesNotMatch(html, />Approve formal notice<\/button>/);
  assert.match(html, /data-requests-blocked/);
});

check("an invoice hold does not block a client-level request", () => {
  const html = eventsPanel([request], [hold({ invoice_id: "inv-1" })], owner);
  assert.match(html, /data-approval-state="can_approve"/);
  assert.doesNotMatch(html, /data-requests-blocked/);
});

check("approved requests leave the queue and the timeline shows details", () => {
  const approval = { ...request, id: "e-2", event_type: "formal_notice_approved", approves_event_id: "e-1", detail: {} };
  const html = eventsPanel([approval, request], [], owner);
  assert.match(html, /Nothing awaiting approval/);
  assert.match(html, /Formal notice approved/);
  assert.match(html, /Third reminder ignored/);
});

check("the activity form offers only loggable activities", () => {
  const html = eventsPanel([], [], staff);
  assert.match(html, /value="escalation_requested"/);
  assert.match(html, /value="formal_notice_requested"/);
  for (const reserved of ["escalated", "formal_notice_approved", "formal_notice_sent", "hold_placed", "hold_released"]) {
    assert.doesNotMatch(html, new RegExp(`value="${reserved}"`), `${reserved} must not be a free-form activity`);
  }
});

console.log(`billing UI render checks passed (${passed})`);
