// AR Insights and "Who's where" shaping, from the PracticeOps design.
// Run with: node tests/collections-ar-insights.test.mjs
import assert from "node:assert/strict";
import { loadTs } from "./helpers/load-ts.mjs";

const ar = loadTs("lib/billing-ui/ar-insights.ts");
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

check("status follows the touch the oldest invoice has reached, with credit and current", () => {
  assert.equal(ar.rungChip(acct("x", [inv("10.00", 50)]), rules).label, "Touch 5");
  assert.equal(ar.rungChip(acct("x", [inv("10.00", 50)]), rules).gate, true);
  assert.equal(ar.rungChip(acct("x", [inv("10.00", 0)]), rules).label, "Current");
  assert.equal(ar.rungChip(acct("x", [], { net_ar_estimate: "-5.00" }), rules).label, "In credit");
});

check("money reads in whole dollars and dates in the design's form", () => {
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
