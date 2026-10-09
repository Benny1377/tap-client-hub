// Billing and Collections UI data layer: API client, refresh-after-mutation,
// section loading, validation, and view-model rules.
// Run with: node tests/billing-ui-data.test.mjs
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadTs, root } from "./helpers/load-ts.mjs";

const api = loadTs("lib/billing-ui/api.ts");
const ledger = loadTs("lib/billing-ui/ledger.ts");
const validation = loadTs("lib/billing-ui/validation.ts");
const vm = loadTs("lib/billing-ui/view-model.ts");

let passed = 0;
async function check(label, fn) {
  try {
    await fn();
    passed += 1;
  } catch (error) {
    error.message = `${label}: ${error.message}`;
    throw error;
  }
}

/** Fake fetch: routes keyed by "METHOD path"; records every call. */
function fakeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const method = init.method || "GET";
    calls.push({ method, url, body: init.body ? JSON.parse(init.body) : undefined });
    const handler = routes[`${method} ${url}`] || routes[`${method} ${url.split("?")[0]}`];
    if (!handler) return new Response(JSON.stringify({ error: "Not mocked" }), { status: 500 });
    const [status, body] = typeof handler === "function" ? handler() : handler;
    return new Response(JSON.stringify(body), { status });
  };
  return { fetchImpl, calls };
}

const invoice = (overrides = {}) => ({
  id: "inv-1", client_id: "c-1", invoice_number: "TAP-1", status: "draft", issue_date: "2026-10-01", due_date: "2026-10-31",
  memo: null, created_by: null, created_at: "2026-10-01T00:00:00Z", voided_by: null, voided_at: null, void_reason: null, invoice_lines: [], ...overrides,
});
const line = { id: "l-1", invoice_id: "inv-1", client_service_id: null, period: "2026-10", description: "Bookkeeping", quantity: 1, unit_amount: 250, amount: 250, sort_order: 0 };
const owner = { role: "owner", modules: [] };
const admin = { role: "admin", modules: [] };
const staff = { role: "staff", modules: ["Billing", "Collections"] };
const manager = { role: "manager", modules: ["Billing", "Collections"] };

// --- API client -------------------------------------------------------------
await check("status codes map to stable error kinds", () => {
  assert.equal(api.kindForStatus(401), "unauthorized");
  assert.equal(api.kindForStatus(403), "forbidden");
  assert.equal(api.kindForStatus(404), "not_found");
  assert.equal(api.kindForStatus(409), "conflict");
  assert.equal(api.kindForStatus(422), "invalid");
  assert.equal(api.kindForStatus(400), "invalid");
  assert.equal(api.kindForStatus(500), "server");
});

await check("403 from a route becomes a forbidden failure carrying the server message", async () => {
  const { fetchImpl } = fakeFetch({ "GET /api/billing/invoices": [403, { error: "Forbidden" }] });
  const result = await api.createBillingApi(fetchImpl).invoices();
  assert.deepEqual(result, { ok: false, status: 403, kind: "forbidden", message: "Forbidden" });
});

await check("network failure is reported, not thrown", async () => {
  const result = await api.createBillingApi(async () => { throw new TypeError("offline"); }).payments();
  assert.equal(result.ok, false);
  assert.equal(result.kind, "network");
});

await check("client filter is passed as client_id and requests are not cached", async () => {
  const { fetchImpl, calls } = fakeFetch({ "GET /api/billing/receivables": [200, { receivables: [] }] });
  const seen = [];
  await api.createBillingApi((url, init) => { seen.push(init); return fetchImpl(url, init); }).receivables("c 1");
  assert.equal(calls[0].url, "/api/billing/receivables?client_id=c%201");
  assert.equal(seen[0].cache, "no-store");
});

await check("mutations call the contract routes with the contract bodies", async () => {
  const { fetchImpl, calls } = fakeFetch({
    "POST /api/billing/invoices/inv-1": [200, { invoice: invoice() }],
    "POST /api/billing/allocations": [201, { allocation_id: "a-1" }],
    "POST /api/collections/events/approve": [201, { event: {} }],
    "PATCH /api/collections/holds": [200, { hold: {} }],
    "DELETE /api/billing/invoice-lines": [200, { deleted: true }],
  });
  const client = api.createBillingApi(fetchImpl);
  await client.issueInvoice("inv-1");
  await client.voidInvoice("inv-1", "Duplicate");
  await client.allocate({ payment_id: "p-1", invoice_id: "inv-1", amount: "10.00" });
  await client.approveEvent("e-1", "escalated");
  await client.releaseHold("h-1");
  await client.deleteLine("l-1");
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    "POST /api/billing/invoices/inv-1",
    "POST /api/billing/invoices/inv-1",
    "POST /api/billing/allocations",
    "POST /api/collections/events/approve",
    "PATCH /api/collections/holds",
    "DELETE /api/billing/invoice-lines?id=l-1",
  ]);
  assert.deepEqual(calls[0].body, { action: "issue" });
  assert.deepEqual(calls[1].body, { action: "void", reason: "Duplicate" });
  assert.deepEqual(calls[2].body, { payment_id: "p-1", invoice_id: "inv-1", amount: "10.00" });
  assert.deepEqual(calls[3].body, { event_id: "e-1", event_type: "escalated" });
  assert.deepEqual(calls[4].body, { id: "h-1" });
});

// --- Refresh after mutation ------------------------------------------------
for (const [label, status, body, shouldRefresh] of [
  ["success refreshes balances from the API", 201, { allocation_id: "a-1" }, true],
  ["409 conflict refreshes to show the current state", 409, { error: "invariant_violation: invoice would be over-allocated" }, true],
  ["403 does not refresh", 403, { error: "Forbidden" }, false],
  ["422 does not refresh", 422, { error: "amount must be positive" }, false],
]) {
  await check(`mutateThenRefresh: ${label}`, async () => {
    const { fetchImpl } = fakeFetch({ "POST /api/billing/allocations": [status, body] });
    let refreshes = 0;
    const result = await api.mutateThenRefresh(
      () => api.createBillingApi(fetchImpl).allocate({ payment_id: "p", invoice_id: "i", amount: "1.00" }),
      async () => { refreshes += 1; },
    );
    assert.equal(refreshes, shouldRefresh ? 1 : 0);
    assert.equal(result.status, status);
  });
}

await check("after a successful mutation the refreshed balance comes from the server", async () => {
  let balance = "250.00";
  const { fetchImpl } = fakeFetch({
    "POST /api/billing/allocations": () => { balance = "150.00"; return [201, { allocation_id: "a-1" }]; },
    "GET /api/billing/receivables": () => [200, { receivables: [{ id: "inv-1", balance }] }],
  });
  const client = api.createBillingApi(fetchImpl);
  let shown = (await ledger.loadLedger(client, null, ["receivables"])).receivables.data[0].balance;
  assert.equal(shown, "250.00");
  await api.mutateThenRefresh(() => client.allocate({ payment_id: "p", invoice_id: "inv-1", amount: "100.00" }), async () => {
    shown = (await ledger.loadLedger(client, null, ["receivables"])).receivables.data[0].balance;
  });
  assert.equal(shown, "150.00");
});

// --- Section loading -------------------------------------------------------
await check("sections start loading and fail independently", async () => {
  const initial = ledger.loadingLedger();
  assert.ok(Object.values(initial).every((section) => section.status === "loading"));
  const { fetchImpl, calls } = fakeFetch({
    "GET /api/collections/holds": [200, { holds: [] }],
    "GET /api/collections/events": [403, { error: "Forbidden" }],
  });
  const state = await ledger.loadLedger(api.createBillingApi(fetchImpl), null, ["holds", "events"]);
  assert.equal(state.holds.status, "ready");
  assert.equal(state.events.status, "error");
  assert.equal(state.events.kind, "forbidden");
  assert.equal(state.invoices.status, "loading", "sections not requested are not fetched");
  assert.equal(calls.length, 2);
});

// --- Validation ------------------------------------------------------------
await check("invoice draft validation", () => {
  assert.deepEqual(Object.keys(validation.validateInvoiceDraft({})).sort(), ["client_id", "due_date", "invoice_number", "issue_date"]);
  assert.match(validation.validateInvoiceDraft({ client_id: "c", invoice_number: "1", issue_date: "2026-10-10", due_date: "2026-10-01" }).due_date, /on or after/);
  assert.deepEqual(validation.validateInvoiceDraft({ client_id: "c", invoice_number: "1", issue_date: "2026-10-01", due_date: "2026-10-01" }), {});
});

await check("money validation matches the server's two-decimal rule", () => {
  for (const good of ["1", "0.01", "1250.50"]) assert.equal(validation.isPositiveMoney(good), true, good);
  for (const bad of ["0", "0.00", "-1", "1.005", "1e3", "abc", ""]) assert.equal(validation.isPositiveMoney(bad), false, bad);
  assert.ok(validation.validateLine({ description: "x", quantity: "1", unit_amount: "1.999" }).unit_amount);
  assert.ok(validation.validateLine({ description: "x", quantity: "0", unit_amount: "1" }).quantity);
  assert.ok(validation.validateLine({ description: "x", quantity: "1", unit_amount: "1", period: "2026-13" }).period);
  assert.deepEqual(validation.validateLine({ description: "x", quantity: "2", unit_amount: "0", period: "2026-10" }), {});
});

await check("payment, allocation, hold, and event validation", () => {
  assert.ok(validation.validatePayment({ client_id: "c", received_on: "2026-10-01", amount: "10", method: "bitcoin" }).method);
  assert.deepEqual(validation.validatePayment({ client_id: "c", received_on: "2026-10-01", amount: "10", method: "ach" }), {});
  assert.ok(validation.validateAllocation({ payment_id: "p", invoice_id: "", amount: "1" }).invoice_id);
  assert.ok(validation.validateHold({ client_id: "c", reason: " " }).reason);
  assert.ok(validation.validateEvent({ client_id: "c", event_type: "hold_placed" }).event_type, "holds are not logged as free-form events");
  assert.ok(validation.validateEvent({ client_id: "c", event_type: "escalated" }).event_type, "approvals are not logged as free-form events");
  assert.deepEqual(validation.validateEvent({ client_id: "c", event_type: "escalation_requested" }), {});
});

// --- Lifecycle states ------------------------------------------------------
await check("draft without lines cannot be issued; draft with lines can", () => {
  const empty = vm.invoiceActions(invoice(), staff);
  assert.equal(empty.editable, true);
  assert.equal(empty.canIssue, false);
  assert.match(empty.issueBlockedReason, /at least one line/);
  assert.equal(vm.invoiceActions(invoice({ invoice_lines: [line] }), staff).canIssue, true);
});

await check("issued invoices are locked; only Owner/Admin may void", () => {
  const issued = invoice({ status: "issued", invoice_lines: [line] });
  for (const viewer of [owner, admin]) {
    const actions = vm.invoiceActions(issued, viewer);
    assert.equal(actions.editable, false);
    assert.equal(actions.canVoid, true);
    assert.equal(actions.voidRequiresOwnerAdmin, false);
  }
  for (const viewer of [staff, manager, null]) {
    const actions = vm.invoiceActions(issued, viewer);
    assert.equal(actions.canVoid, false);
    assert.equal(actions.voidRequiresOwnerAdmin, true);
  }
});

await check("void invoices allow no actions", () => {
  const actions = vm.invoiceActions(invoice({ status: "void", invoice_lines: [line] }), owner);
  assert.deepEqual(actions, { editable: false, canIssue: false, issueBlockedReason: null, canVoid: false, voidRequiresOwnerAdmin: false });
});

// --- Holds and approvals ---------------------------------------------------
const hold = (overrides = {}) => ({ id: "h-1", client_id: "c-1", invoice_id: null, reason: "Disputed", placed_by: "u", placed_at: "2026-10-01T00:00:00Z", expires_on: null, released_by: null, released_at: null, ...overrides });
const event = (overrides = {}) => ({ id: "e-1", client_id: "c-1", invoice_id: null, event_type: "escalation_requested", stage: null, occurred_at: "2026-10-02T00:00:00Z", actor: "u", detail: {}, approves_event_id: null, ...overrides });

await check("a hold is active until released, even after its expiry date", () => {
  const expired = hold({ expires_on: "2026-01-01" });
  assert.equal(vm.activeHolds([expired], "c-1").length, 1);
  assert.equal(vm.holdExpiryPassed(expired, "2026-10-09"), true);
  assert.equal(vm.activeHolds([hold({ released_at: "2026-10-05T00:00:00Z" })], "c-1").length, 0);
  assert.equal(vm.activeHolds([hold()], "c-2").length, 0, "holds are scoped to their client");
});

await check("approval states: Owner/Admin can approve, others are told it requires Owner/Admin", () => {
  for (const viewer of [owner, admin]) assert.equal(vm.approvalRequests([event()], [], viewer)[0].state, "can_approve");
  for (const viewer of [staff, manager]) assert.equal(vm.approvalRequests([event()], [], viewer)[0].state, "requires_owner_admin");
});

await check("an active hold blocks approval for everyone", () => {
  assert.equal(vm.approvalRequests([event()], [hold()], owner)[0].state, "blocked_by_hold");
  assert.equal(vm.approvalRequests([event()], [hold({ released_at: "2026-10-05T00:00:00Z" })], owner)[0].state, "can_approve");
});

await check("approved requests are recognised and request types map to approval types", () => {
  const requests = vm.approvalRequests([event(), event({ id: "e-2", event_type: "escalated", approves_event_id: "e-1" })], [], owner);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].state, "approved");
  assert.equal(vm.approvalTypeFor("formal_notice_requested"), "formal_notice_approved");
  assert.equal(vm.approvalTypeFor("note"), null);
});

// --- Money formatting ------------------------------------------------------
await check("money is formatted from server values without arithmetic", () => {
  assert.equal(vm.formatMoney("1234567.5"), "$1,234,567.50");
  assert.equal(vm.formatMoney(250), "$250.00");
  assert.equal(vm.formatMoney("0.10"), "$0.10");
  assert.equal(vm.formatMoney(null), "—");
});

// --- Boundary: no direct database, QuickBooks, OAuth, or email in UI code ---
await check("UI code goes through the API only", () => {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(join(root, dir))) {
      const path = join(dir, name);
      if (statSync(join(root, path)).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(name)) files.push(path);
    }
  };
  ["lib/billing-ui", "components/billing", "app/billing", "app/collections"].forEach(walk);
  assert.ok(files.length >= 10, `expected UI files, found ${files.length}`);
  for (const file of files) {
    const source = readFileSync(join(root, file), "utf8");
    assert.doesNotMatch(source, /@supabase|lib\/supabase|createAdminClient|SERVICE_ROLE/, `${file} must not access Supabase directly`);
    assert.doesNotMatch(source, /quickbooks|intuit|oauth|resend|send-email|nodemailer/i, `${file} must not contain QuickBooks, OAuth, or email delivery`);
  }
});

console.log(`billing UI data checks passed (${passed})`);
