// AR Insights and "Who's where" shaping, from the PracticeOps design.
// Run with: node tests/collections-ar-insights.test.mjs
import assert from "node:assert/strict";
import { loadTs } from "./helpers/load-ts.mjs";

const ar = loadTs("lib/billing-ui/ar-insights.ts");
const importReadModel = loadTs("lib/collections-import-worklist.ts");
let passed = 0;
const check = (label, fn) => { try { fn(); passed += 1; } catch (error) { error.message = `${label}: ${error.message}`; throw error; } };

const rules = [1, 5, 15, 21, 45].map((days, index) => ({ stage: index + 1, label: `Touch ${index + 1}`, days_past_due: days, enabled: true }));
const inv = (balance, days, extra = {}) => ({ balance, days_past_due: days, source: "pdf_import", source_as_of: "2026-08-28", invoice_number: "1", issue_date: "2026-07-01", ...extra });
const acct = (id, invoices, extra = {}) => {
  const total = invoices.reduce((sum, item) => sum + Number(item.balance), 0);
  return { client_id: id, client_name: id, contact_name: `${id} contact`, contact_email: `${id}@example.test`, contact_phone: "555", net_ar_estimate: total.toFixed(2), gross_open_balance: total.toFixed(2), unallocated_credit: "0.00", open_invoice_count: invoices.length, oldest_days_past_due: Math.max(0, ...invoices.map((item) => item.days_past_due)), call_priority_score: String(invoices.filter((item) => item.days_past_due >= 21).reduce((sum, item) => sum + Number(item.balance), 0)), invoices, ...extra };
};
const book = (accounts, credit = "0.00") => {
  const gross = accounts.reduce((sum, a) => sum + Number(a.gross_open_balance), 0);
  const band = (lo, hi) => accounts.flatMap((a) => a.invoices).filter((i) => i.days_past_due >= lo && i.days_past_due <= hi).reduce((sum, i) => sum + Number(i.balance), 0).toFixed(2);
  return { as_of_date: "2026-11-09", accounts, pagination: { limit: 200, offset: 0, total_accounts: accounts.length }, summary: { gross_open_balance: gross.toFixed(2), net_ar_estimate: (gross - Number(credit)).toFixed(2), unallocated_credit: credit, aging: { current: band(-999, 0), days_1_30: band(1, 30), days_31_60: band(31, 60), days_61_90: band(61, 90), days_over_90: band(91, 9999) } } };
};

check("the first hand-off day comes from the first Owner/Admin touch", () => {
  assert.equal(ar.firstGate(rules), 21);
  assert.deepEqual(ar.reminderDays(rules), [1, 5, 15]);
});

check("contact display removes only trailing CSV quotes without mutating source values", () => {
  assert.equal(ar.displayContactValue('(713) 572-7000"'), "(713) 572-7000");
  assert.equal(ar.displayContactValue('account@example.test"  '), "account@example.test");
  assert.equal(ar.displayContactValue('(713) 555-0100'), "(713) 555-0100");
  assert.equal(ar.displayContactValue('"quoted" text'), '"quoted" text');
  assert.equal(ar.displayContactValue('"  '), null);
});

check("the ladder and team split adds back to the open balance", () => {
  const b = book([acct("a", [inv("100.00", 10), inv("300.00", 40)]), acct("b", [inv("50.00", -3)])]);
  const s = ar.arStats(b, rules);
  assert.equal(s.auto, 150); assert.equal(s.you, 300); assert.equal(s.auto + s.you, s.tot);
});

check("calling the top N brings in only their 21+ day money, and the book drops by it", () => {
  const b = book([acct("big", [inv("900.00", 100), inv("50.00", 3)]), acct("mid", [inv("200.00", 30)]), acct("new", [inv("70.00", 2)])], "20.00");
  const s = ar.arStats(b, rules);
  assert.deepEqual(s.calls.map((a) => a.client_id), ["big", "mid"]);
  const t = ar.tier(s, 1);
  assert.equal(t.got, 900); assert.equal(t.after, s.net - 900);
});

check("one shared contact is found and the largest group wins", () => {
  const owe = [acct("a", [inv("10.00", 30)], { contact_name: "Pat" }), acct("b", [inv("20.00", 30)], { contact_name: "pat " }), acct("c", [inv("5.00", 30)], { contact_name: "Lee" })];
  assert.deepEqual(ar.sharedContact(owe).map((a) => a.client_id), ["a", "b"]);
  assert.equal(ar.sharedContact([owe[2]]), null);
});

check("status follows the server's ladder history, not the invoice's age", () => {
  // 90 days past due but never touched: a first upload starts at the first touch the server proposes.
  assert.equal(ar.rungChip(acct("x", [inv("10.00", 90, { completed_stage: 0, next_stage: 1 })]), rules).label, "Touch 1 due");
  assert.equal(ar.rungChip(acct("x", [inv("10.00", 90, { completed_stage: 0, next_stage: 1 })]), rules).gate, false);
  // After the first touch, waiting for the gap: shown as sent.
  assert.equal(ar.rungChip(acct("x", [inv("10.00", 90, { completed_stage: 1, next_stage: null })]), rules).label, "Touch 1 sent");
  // The furthest invoice decides, and a gate is flagged.
  const chip = ar.rungChip(acct("x", [inv("10.00", 30, { completed_stage: 1, next_stage: 2 }), inv("5.00", 60, { completed_stage: 3, next_stage: 4 })]), rules);
  assert.equal(chip.label, "Touch 4 due"); assert.equal(chip.gate, true);
  assert.equal(ar.rungChip(acct("x", [inv("10.00", 40, { completed_stage: 0, next_stage: null })]), rules).label, "Past due · no touch yet");
  assert.equal(ar.rungChip(acct("x", [inv("10.00", 0)]), rules).label, "Current");
  assert.equal(ar.rungChip(acct("x", [inv("10.00", 40, { next_stage: 1 })], { on_hold: true }), rules).label, "On hold");
  assert.equal(ar.rungChip(acct("x", [], { net_ar_estimate: "-5.00" }), rules).label, "In credit");
});

check("zero-balance invoices read as paid and stay off the active ladder", () => {
  const paid = inv("0.00", 84, { collection_status: "paid", paid_as_of: "2026-11-10", completed_stage: 1, next_stage: null });
  assert.equal(ar.isPaidInvoice(paid), true);
  assert.equal(ar.isPaidInvoice({}), false, "missing balance is not proof of payment");
  assert.equal(ar.isOpenInvoice(paid), false);
  assert.equal(ar.nextTouch(paid, rules), "Paid · approved A/R report as of 2026-11-10");
  assert.deepEqual(ar.rungChip(acct("paid", [paid]), rules), { label: "Paid", tone: "c-green", gate: false });
  assert.equal(ar.isOpenInvoice(inv("25.00", 84, { collection_status: "open" })), true, "a later positive report balance reopens the invoice");
  assert.deepEqual(importReadModel.reportInvoicePaymentStatus("0.00", "2026-11-10"), { collection_status: "paid", paid_as_of: "2026-11-10" });
  assert.deepEqual(importReadModel.reportInvoicePaymentStatus("12.50", "2026-11-10"), { collection_status: "open", paid_as_of: null });
  assert.deepEqual(importReadModel.reportInvoicePaymentStatus(null, "2026-11-10"), { collection_status: "open", paid_as_of: null }, "missing balance is never silently treated as paid");
});

check("ladder step is the next touch when due, else the last completed", () => {
  assert.equal(ar.ladderStep({ completed_stage: 2, next_stage: 3 }), 3);
  assert.equal(ar.ladderStep({ completed_stage: 2, next_stage: null }), 2);
  assert.equal(ar.ladderStep({ completed_stage: 0, next_stage: null }), 0);
  assert.equal(ar.ladderStep({}), 0);
});

check("note counts come from note events, and the server's count wins", () => {
  const counts = ar.noteCounts([{ client_id: "a", event_type: "note" }, { client_id: "a", event_type: "note" }, { client_id: "a", event_type: "call_logged" }, { client_id: "b", event_type: "note" }]);
  assert.equal(counts.get("a"), 2); assert.equal(counts.get("b"), 1);
  assert.equal(ar.noteCountOf(acct("a", []), counts), 2);
  assert.equal(ar.noteCountOf(acct("a", [], { note_count: 7 }), counts), 7);
  assert.equal(ar.noteCountOf(acct("z", []), counts), 0);
});

check("late marker colours follow the design, and the column waits for the backend count", () => {
  assert.equal(ar.lateTone(2), "var(--ink)"); assert.equal(ar.lateTone(3), "var(--amber)"); assert.equal(ar.lateTone(5), "var(--red)");
  assert.equal(ar.hasLateCounts([acct("a", [])]), false);
  assert.equal(ar.hasLateCounts([acct("a", []), acct("b", [], { late_beyond_final_count: 0 })]), true);
});

check("money reads in whole dollars and dates in the design's form", () => {
  assert.equal(ar.dayMonth("2026-07-01", true), "1 Jul 2026");
  assert.equal(ar.dollars(214800.4), "$214,800");
  assert.equal(ar.dollars(-7400), "-$7,400");
  assert.equal(ar.dayMonth("2026-08-21", true), "21 Aug 2026");
  assert.equal(ar.asOfDate(book([acct("a", [inv("1.00", 1)])])), "2026-08-28");
});

check("pages merge into one book with every account", () => {
  const p1 = book([acct("a", [inv("1.00", 1)])]), p2 = { ...book([acct("b", [inv("2.00", 2)])]), summary: { ignored: true } };
  const merged = ar.mergePages([p1, p2]);
  assert.equal(merged.accounts.length, 2); assert.equal(merged.summary, p1.summary);
});

console.log(`collections AR insights checks passed (${passed})`);
