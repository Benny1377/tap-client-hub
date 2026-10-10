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
  for (const label of ["AR insights", "call list", "Collections activity", "holds"]) assert.match(collectionsHtml, new RegExp(`Loading ${label}…`));
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
  const amountInput = html.match(/<input[^>]*data-field="amount"[^>]*>/)?.[0] || "";
  const inputId = amountInput.match(/ id="([^"]+)"/)?.[1];
  assert.ok(inputId, "the amount input has an id");
  assert.match(amountInput, /aria-invalid="true"/);
  assert.match(amountInput, new RegExp(`aria-describedby="${inputId}-error"`), "the error is linked to its own input");
  assert.match(html, new RegExp(`<label for="${inputId}"`), "the label points at its own input");
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

check("Owner/Admin reverse allocations with a confirm step, only for active ones", () => {
  const html = paymentsPanel(owner);
  assert.equal((html.match(/data-confirm-action=/g) || []).length, 1, "only the active allocation can be reversed");
  assert.match(html, /data-confirm-action="a-1"[\s\S]*?This returns \$60\.00 to the payment and reopens it on TAP-1[\s\S]*?>Confirm reversal</);
  assert.doesNotMatch(html, /data-approval-boundary/);
});

check("a payment with active allocations explains why it can't be reversed yet", () => {
  const html = paymentsPanel(owner);
  assert.match(html, /data-reverse-blocked[^>]*>Reverse its allocations first/);
  assert.doesNotMatch(html, /data-reverse-payment/);
  const clean = render(h(paymentPanels.PaymentsPanel, {
    payments: [{ ...payment, payment_allocations: [{ ...payment.payment_allocations[1] }] }], invoices: [invoice({ status: "issued", invoice_lines: [line] })], receivables: [receivable], clientId: "c-1",
    clientNames: {}, viewer: owner, handlers: { onRecord: noop, onAllocate: noop, onReversePayment: noop, onReverseAllocation: noop },
  }));
  assert.match(clean, /data-reverse-payment/, "with only reversed allocations, the payment can be reversed");
  assert.doesNotMatch(clean, /data-reverse-blocked/);
});

check("receivables render server-derived totals", () => {
  const html = render(h(paymentPanels.ReceivablesTable, { receivables: [receivable], clientNames: { "c-1": "Acme LLC" } }));
  assert.match(html, /\$250\.00[\s\S]*\$100\.00[\s\S]*\$150\.00/);
  assert.match(html, />12</);
  assert.match(html, /data-aging="1_30"[^>]*>1–30 days</);
});

// --- Holds -----------------------------------------------------------------
const hold = (overrides = {}) => ({ id: "h-1", client_id: "c-1", invoice_id: null, reason: "Disputed fee", placed_by: "u", placed_at: "2026-10-01T00:00:00Z", expires_on: null, released_by: null, released_at: null, ...overrides });
const invoiceOptions = [{ id: "inv-1", invoice_number: "TAP-1", client_id: "c-1" }];
const holdsPanel = (holds, viewer) => render(h(collections.HoldsPanel, { holds, clientId: "c-1", clientNames: {}, invoiceOptions, viewer, today: TODAY, onPlace: noop, onRelease: noop }));
const banner = (holds, clientId = "c-1") => render(h(collections.ActiveHoldBanner, { holds, clientId, clientNames: { "c-1": "Acme LLC" }, invoiceNumbers: { "inv-1": "TAP-1" }, today: TODAY }));

check("hold banner appears only while a hold is in force, with its scope", () => {
  const active = banner([hold()]);
  assert.match(active, /data-active-hold-banner/);
  assert.match(active, /Acme LLC \(whole client\)\. Escalation[\s\S]*blocked/);
  assert.match(banner([hold({ invoice_id: "inv-1" })]), /Acme LLC \(invoice TAP-1\)\./);
  const both = banner([hold({ id: "h-2", invoice_id: "inv-1" }), hold()]);
  assert.match(both, /Acme LLC \(whole client, invoice TAP-1\)\./, "one entry per client, whole client first");
  assert.equal((both.match(/Acme LLC/g) || []).length, 1, "the client name is not repeated");
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
const eventsPanel = (events, holds, viewer) => render(h(collections.EventsPanel, { events, holds, invoiceOptions, clientId: "c-1", clientNames: {}, viewer, today: TODAY, onLog: noop, onApprove: noop, onRecordNoticeSent: noop }));

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

// --- Phase 1 completion -----------------------------------------------------
const worklistPanels = loadTs("components/billing/worklist-panels.tsx");

check("payments show the server's unallocated amount, also in the allocation picker", () => {
  const withRemaining = { ...payment, unallocated_amount: "0.00" };
  const partly = { ...payment, id: "p-2", amount: "200.00", payment_allocations: [], unallocated_amount: "200.00" };
  const html = render(h(paymentPanels.PaymentsPanel, {
    payments: [withRemaining, partly], invoices: [invoice({ status: "issued", invoice_lines: [line] })], receivables: [receivable], clientId: "c-1",
    clientNames: {}, viewer: staff, handlers: { onRecord: noop, onAllocate: noop, onReversePayment: noop, onReverseAllocation: noop },
  }));
  assert.match(html, /data-unallocated="200\.00"[^>]*>\$200\.00</);
  assert.match(html, /\$200\.00 · \$200\.00 left/);
});

check("per-client aging totals render the server's buckets", () => {
  const html = render(h(paymentPanels.ClientAgingSummary, { aging: { client_id: "c-1", current: "0.00", "1_30": "150.00", "31_60": "0.00", "61_90": "0.00", "90_plus": "75.50" } }));
  assert.match(html, /data-aging-total="1_30"[\s\S]*\$150\.00/);
  assert.match(html, /data-aging-total="90_plus"[\s\S]*\$75\.50/);
  assert.equal(render(h(paymentPanels.ClientAgingSummary, { aging: null })), "");
});

check("holds show their scope and can be placed on one invoice", () => {
  const html = holdsPanel([hold(), hold({ id: "h-2", invoice_id: "inv-1" })], owner);
  assert.match(html, /data-hold-row="h-1"[\s\S]*?data-hold-scope[^>]*>Whole client/);
  assert.match(html, /data-hold-row="h-2"[\s\S]*?data-hold-scope[^>]*>Invoice TAP-1 only/);
  assert.match(html, /aria-label="Place hold"[\s\S]*name="invoice_id"[\s\S]*Invoice TAP-1 only/);
});

const approvalEvent = { ...request, id: "a-1", event_type: "formal_notice_approved", invoice_id: "inv-1", approves_event_id: "e-1", detail: {} };

check("Owner/Admin can record an approved notice as sent; staff see the boundary", () => {
  const ownerHtml = eventsPanel([approvalEvent], [], owner);
  assert.match(ownerHtml, /data-notice-approval="a-1" data-notice-state="can_record"[\s\S]*>Record notice sent</);
  assert.match(ownerHtml, /TAP Hub does not send notices/);
  const staffHtml = eventsPanel([approvalEvent], [], staff);
  assert.match(staffHtml, /data-notice-state="requires_owner_admin"/);
  assert.match(staffHtml, /Recording a notice as sent requires Owner\/Admin/);
  assert.doesNotMatch(staffHtml, />Record notice sent</);
});

check("a hold on the notice's invoice blocks recording it as sent", () => {
  const html = eventsPanel([approvalEvent], [hold({ invoice_id: "inv-1" })], owner);
  assert.match(html, /data-notice-state="blocked_by_hold"/);
  assert.doesNotMatch(html, />Record notice sent</);
});

check("notices already recorded as sent leave the list", () => {
  const sent = { ...approvalEvent, id: "s-1", event_type: "formal_notice_sent", approves_event_id: null, detail: { approval_event_id: "a-1" } };
  assert.match(eventsPanel([approvalEvent, sent], [], owner), /No approved notices waiting/);
});

check("history shows the invoice for each event", () => {
  const html = eventsPanel([{ ...request, invoice_id: "inv-1" }], [], staff);
  assert.match(html, /data-event-row="e-1"[\s\S]*?>TAP-1</);
});

// --- Phase 2: worklist and preview ---------------------------------------
const component = (balance, weight, weighted) => ({ balance, weight, weighted_amount: weighted });
const worklistAccount = {
  client_id: "c-1", client_name: "Acme LLC", contact_name: "Pat Lee", contact_email: null, contact_phone: "555-0100", primary_contact_count: 1,
  gross_open_balance: "1500.00", unallocated_credit: "200.00", net_ar_estimate: "1300.00", open_invoice_count: 2, oldest_days_past_due: 45,
  aging: { current: "0.00", days_1_30: "500.00", days_31_60: "1000.00", days_61_90: "0.00", days_over_90: "0.00" },
  call_priority_score: "1800.00",
  priority_score_components: {
    "21_30": component("500.00", "1.0", "500.00"), "31_60": component("1000.00", "1.3", "1300.00"), "61_90": component("0.00", "1.6", "0.00"),
    "91_180": component("0.00", "2.0", "0.00"), over_180: component("0.00", "2.4", "0.00"), score_zero_before_days_past_due: 21,
  },
  on_hold: true, credit_review_required: true, contact_review_required: true, largest_high_balance_invoice: "0.00",
  invoices: [
    { invoice_id: "inv-1", invoice_number: "TAP-1", issue_date: "2026-08-01", due_date: "2026-08-25", invoice_total: "1000.00", allocated: "0.00", balance: "1000.00", days_past_due: 45, current_stage: 5, next_stage: 4, on_hold: true, credit_review_required: true, contact_review_required: true, below_minimum: false },
    { invoice_id: "inv-2", invoice_number: "TAP-2", issue_date: "2026-09-01", due_date: "2026-09-14", invoice_total: "500.00", allocated: "0.00", balance: "500.00", days_past_due: 25, current_stage: 4, next_stage: null, on_hold: false, credit_review_required: true, contact_review_required: true, below_minimum: false },
  ],
};
const worklist = (overrides = {}) => ({
  as_of_date: TODAY, currency: "USD",
  summary: { gross_open_balance: "1500.00", unallocated_credit: "200.00", net_ar_estimate: "1300.00", aging: worklistAccount.aging, open_invoice_count: 2, owing_accounts: 1, credit_review_accounts: 1, chronic_accounts: 0, oldest_days_past_due: 45 },
  accounts: [worklistAccount], pagination: { limit: 50, offset: 0, total_accounts: 1 }, ...overrides,
});

check("AR summary shows server totals, aging, and the firm date", () => {
  const html = render(h(worklistPanels.WorklistSummary, { worklist: worklist() }));
  assert.match(html, /As of 2026-10-09 \(firm date\)/);
  assert.match(html, /data-summary="gross"[\s\S]*?\$1,500\.00/);
  assert.match(html, /data-summary="net"[\s\S]*?\$1,300\.00/);
  assert.match(html, /data-summary="aging-31-60"[\s\S]*?\$1,000\.00/);
  assert.match(html, /data-credit-review-count[^>]*>1 account has unallocated payments/);
});

check("call list shows flags, contact, score breakdown, and invoice next steps", () => {
  const html = render(h(worklistPanels.WorklistTable, { worklist: worklist(), onSelectClient: () => {}, onPage: () => {} }));
  assert.match(html, /data-worklist-account="c-1"[\s\S]*Acme LLC/);
  for (const flag of ["hold", "credit", "contact"]) assert.match(html, new RegExp(`data-flag="${flag}"`));
  assert.match(html, /555-0100/);
  assert.match(html, /data-score-band="31_60"[\s\S]*?\$1,000\.00[\s\S]*?× 1\.3[\s\S]*?= 1,300\.00/);
  assert.match(html, /under 21 days past due add nothing/);
  assert.match(html, /data-worklist-invoice="inv-1" data-next-stage="4"[\s\S]*?4 · Owner escalation[\s\S]*?On hold/);
  assert.match(html, /data-worklist-invoice="inv-2" data-next-stage=""[\s\S]*?Ladder complete — follow up manually/);
  assert.doesNotMatch(html, /Up to date/, "an overdue invoice is never shown as up to date");
  const notDue = { ...worklistAccount, invoices: [{ ...worklistAccount.invoices[1], invoice_id: "inv-3", days_past_due: 0, next_stage: null }] };
  const notDueHtml = render(h(worklistPanels.WorklistTable, { worklist: worklist({ accounts: [notDue] }), onSelectClient: () => {}, onPage: () => {} }));
  assert.match(notDueHtml, /data-worklist-invoice="inv-3"[\s\S]*?Not due yet/);
});

check("call list pagination reflects the server's page", () => {
  const firstPage = render(h(worklistPanels.WorklistTable, { worklist: worklist({ pagination: { limit: 1, offset: 0, total_accounts: 3 } }), onSelectClient: () => {}, onPage: () => {} }));
  assert.match(firstPage, /Showing 1–1 of 3/);
  assert.match(firstPage, /<button type="button"[^>]*disabled=""[^>]*>Previous<\/button>/);
  assert.doesNotMatch(firstPage, /disabled=""[^>]*>Next</);
  assert.match(render(h(worklistPanels.WorklistTable, { worklist: worklist({ accounts: [] }), onSelectClient: () => {}, onPage: () => {} })), /No accounts owe money/);
});

check("automation preview is Owner/Admin only", () => {
  for (const viewer of [staff, manager, null]) {
    const html = render(h(worklistPanels.AutomationPreviewPanel, { viewer, runPreview: noop }));
    assert.match(html, /The automation preview requires Owner\/Admin/);
    assert.doesNotMatch(html, /Run preview/);
  }
  assert.match(render(h(worklistPanels.AutomationPreviewPanel, { viewer: owner, runPreview: noop })), />Run preview</);
});

check("preview results say nothing was sent and explain each outcome", () => {
  const preview = {
    as_of_date: TODAY, automation_enabled: false, delivery_mode: "disabled",
    actions: [
      { client_id: "c-1", client_name: "Acme LLC", contact_phone: "555-0100", invoice_id: "inv-1", invoice_number: "TAP-1", balance: "1000.00", days_past_due: 45, stage: 4, action_type: "owner_escalation_review", disposition: "approval_required", suppression_reasons: [], review_warnings: ["email_contact_missing"], delivery_performed: false },
      { client_id: "c-2", client_name: "Beta Co", contact_phone: null, invoice_id: "inv-7", invoice_number: "TAP-7", balance: "40.00", days_past_due: 6, stage: 2, action_type: "reminder_candidate", disposition: "suppressed", suppression_reasons: ["below_minimum_balance", "active_hold"], review_warnings: [], delivery_performed: false },
    ],
    pagination: { limit: 50, offset: 0, total_actions: 2, has_more: false },
  };
  const html = render(h(worklistPanels.PreviewResults, { preview, onPage: () => {} }));
  assert.match(html, /data-preview-safety[\s\S]*Automation is off and delivery is disabled\. Nothing was sent\./);
  assert.match(html, /data-preview-action="inv-1" data-disposition="approval_required"[\s\S]*?4 · Owner escalation[\s\S]*?Needs Owner\/Admin review[\s\S]*?data-warning="email_contact_missing"/);
  assert.match(html, /data-preview-action="inv-7" data-disposition="suppressed"[\s\S]*?data-suppression="below_minimum_balance"[\s\S]*?data-suppression="active_hold"/);
  assert.match(html, /2 actions in total/);
  assert.match(html, /disabled=""[^>]*>Next</);
});

// --- Browser-test fixes (2026-10-10) ------------------------------------------
check("two forms on one page never share input ids", () => {
  const html = paymentsPanel(staff);
  const ids = [...html.matchAll(/<(?:input|select|textarea)[^>]* id="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(ids.length >= 6, `expected inputs from both payment forms, found ${ids.length}`);
  assert.equal(new Set(ids).size, ids.length, `duplicate ids: ${ids.filter((id, i) => ids.indexOf(id) !== i).join(", ")}`);
  assert.equal((html.match(/data-field="amount"/g) || []).length, 2, "both forms still have an amount field");
});

check("inputs use border longhands only, so error styling clears cleanly", () => {
  const html = render(h(ui.LedgerFormView, {
    fields: [{ name: "amount", label: "Amount" }], values: { amount: "x" }, errors: { amount: "Bad" },
    serverError: null, submitting: false, submitLabel: "Save", onChange: () => {}, onSubmit: () => {},
  }));
  const style = html.match(/<input[^>]*style="([^"]+)"/)?.[1] || "";
  assert.doesNotMatch(style, /(^|;)border:/, "no border shorthand on inputs");
  assert.match(style, /border-color:var\(--red\)/);
});

check("error banners use the server's stable code for the headline", () => {
  const html = render(h(ui.ErrorBanner, { kind: "conflict", code: "LEDGER_CONFLICT", message: "invariant_violation: payment would be over-allocated" }));
  assert.match(html, /data-error-code="LEDGER_CONFLICT"/);
  assert.match(html, /That change would break the ledger&#x27;s rules\.[\s\S]*Payment would be over-allocated/);
  assert.doesNotMatch(html, /invariant_violation|reloaded/);
});

check("a draft shows its issue date, not that it was issued", () => {
  assert.match(detail(invoice(), staff), /Issue date 2026-10-01 · Due 2026-10-31/);
  assert.doesNotMatch(detail(invoice(), staff), /Issued 2026-10-01/);
  assert.match(detail(invoice({ status: "issued", invoice_lines: [line] }), staff, receivable), /Issued 2026-10-01 · Due 2026-10-31/);
});

check("the activity form names invoices with their own hold before a request is tried", () => {
  const html = eventsPanel([], [hold({ invoice_id: "inv-1" })], staff);
  assert.match(html, /data-invoice-holds[^>]*>Invoice TAP-1 has a hold, so escalation and formal-notice requests for it will be refused\./);
  assert.doesNotMatch(eventsPanel([], [hold()], staff), /data-invoice-holds/, "a client-wide hold uses the client-wide warning instead");
});

check("AR summary cards sit in a grid that fits two per row on a phone", () => {
  const html = render(h(worklistPanels.WorklistSummary, { worklist: worklist() }));
  // 100px minimum: the cards area is about 230px wide on a 375px phone, so two fit per row.
  assert.equal((html.match(/grid-template-columns:repeat\(auto-fill, minmax\(100px, 1fr\)\)/g) || []).length, 2);
});

console.log(`billing UI render checks passed (${passed})`);
