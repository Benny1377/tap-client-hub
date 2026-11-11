// Email log grouping (Collections Phase 5, item 5): counts and dates per client and invoice, no email content.
// Run with: node tests/collections-email-log.test.mjs
import assert from "node:assert/strict";
import { loadTs } from "./helpers/load-ts.mjs";

const log = loadTs("lib/billing-ui/email-log.ts");
let passed = 0;
const check = (label, fn) => { try { fn(); passed += 1; } catch (error) { error.message = `${label}: ${error.message}`; throw error; } };

const labels = { 1: "Friendly", 2: "Professional", 3: "Firm", 4: "Owner escalation", 5: "Formal notice" };
const names = { a: "Synthetic Orchard LLC", b: "Sample Harbor Inc" };
const attempt = (client, row, number, stage, status, at, extra = {}) => ({
  attempt_id: `${row}-${stage}`, client_id: client, row_key: row, invoice_number: number, stage, status,
  reason_text: status === "accepted" ? null : "Email delivery is disabled.", accepted_at: status === "accepted" ? at : null, updated_at: at, ...extra,
});

check("only accepted attempts count as sent, per stage and per client", () => {
  const [a] = log.groupEmailLog([
    attempt("a", "r1", "TAP-2", 1, "accepted", "2026-11-03T15:00:00Z"),
    attempt("a", "r1", "TAP-2", 2, "accepted", "2026-11-10T15:00:00Z"),
    attempt("a", "r2", "TAP-10", 1, "accepted", "2026-11-04T15:00:00Z"),
    attempt("a", "r2", "TAP-10", 2, "suppressed", "2026-11-11T15:00:00Z"),
  ], labels, names);
  assert.equal(a.client_name, "Synthetic Orchard LLC");
  assert.deepEqual(a.stages.map((s) => [s.label, s.sent_count]), [["Friendly", 2], ["Professional", 1]]);
  assert.equal(a.total_sent, 3); assert.equal(a.last_sent_at, "2026-11-10T15:00:00Z");
  assert.deepEqual(a.invoices.map((i) => i.invoice_number), ["TAP-2", "TAP-10"], "numeric invoice order");
  assert.deepEqual(a.invoices[1].not_sent.map((n) => [n.label, n.status]), [["Professional", "suppressed"]]);
});

check("the internal owner hand-off (touch 4) is never listed as an email", () => {
  const [a] = log.groupEmailLog([attempt("a", "r1", "TAP-2", 4, "accepted", "2026-11-03T15:00:00Z"), attempt("a", "r1", "TAP-2", 1, "accepted", "2026-11-01T15:00:00Z")], labels, names);
  assert.deepEqual(a.stages.map((s) => s.stage), [1]);
});

check("clients most recently emailed come first; never-emailed clients last", () => {
  const order = log.groupEmailLog([
    attempt("b", "r9", "TAP-9", 1, "failed", "2026-11-12T15:00:00Z"),
    attempt("a", "r1", "TAP-2", 1, "accepted", "2026-11-03T15:00:00Z"),
  ], labels, names).map((c) => c.client_id);
  assert.deepEqual(order, ["a", "b"]);
});

check("dates show the year in the firm's time zone", () => {
  assert.equal(log.firmDate("2026-11-03T03:00:00Z", "America/Chicago"), "2 Nov 2026");
  assert.equal(log.firmDate("not a date", "America/Chicago"), "—");
});

console.log(`collections email log checks passed (${passed})`);
