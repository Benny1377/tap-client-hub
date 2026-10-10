import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20261010110000_billing_audit_and_receivables.sql");

for (const table of ["invoices", "invoice_lines", "payments", "payment_allocations", "collection_holds", "collection_events"]) {
  assert.match(migration, new RegExp(`billing_audit_${table}`), `${table} should be audited transactionally`);
}
assert.match(migration, /billing_audit_external_account_ids/);
assert.match(migration, /uq_collection_events_approves_event/);
assert.match(migration, /uq_collection_events_notice_sent_approval/);
assert.match(migration, /get_billing_receivables/);
assert.match(migration, /client_aging/);
assert.match(migration, /unallocated_payment_balances/);
assert.match(migration, /'unallocated_payments'/);
assert.match(migration, /delete_draft_invoice_line/);
assert.match(migration, /delete_draft_invoice/);
assert.match(migration, /place_collection_hold/);
assert.match(migration, /release_collection_hold/);
assert.match(migration, /approve_collection_event/);
assert.match(migration, /record_collection_event/);

const receivablesRoute = read("app/api/billing/receivables/route.ts");
assert.match(receivablesRoute, /rpc\("get_billing_receivables"/);
assert.doesNotMatch(receivablesRoute, /Number\(|new Date\(/);
const paymentsRoute = read("app/api/billing/payments/route.ts");
assert.match(paymentsRoute, /unallocated_amount/);
assert.match(paymentsRoute, /readModelError/);
const eventRoute = read("app/api/collections/events/route.ts");
assert.match(eventRoute, /formal_notice_sent/);
assert.match(eventRoute, /approval_event_id/);
const holdRoute = read("app/api/collections/holds/route.ts");
assert.match(holdRoute, /HOLD_NOT_ACTIVE/);
assert.match(holdRoute, /HOLD_NOT_ACTIVE/);
assert.match(holdRoute, /status: notActive \? 409 : 500/);
const invoiceRoute = read("app/api/billing/invoices/[id]/route.ts");
assert.match(invoiceRoute, /delete_draft_invoice/);
assert.match(invoiceRoute, /INVOICE_REFERENCED/);

const demoLogin = read("app/api/demo-login/route.ts");
assert.doesNotMatch(demoLogin, /TapHub2026!/);
assert.match(demoLogin, /status: 410/);
assert.match(demoLogin, /cookie\.name\.startsWith\("sb-"\)/);
assert.doesNotMatch(read("app/api/auth/mark-password-change/route.ts"), /TapHub2026!/);
assert.match(read("app/api/auth/sign-in/route.ts"), /REVOKED_PASSWORD_SHA256/);
const clientRoute = read("app/api/clients/route.ts");
assert.match(clientRoute, /resolveAccessIdentity/);
assert.match(clientRoute, /if \(!identity\).*401/s);
assert.match(holdRoute, /place_collection_hold/);
assert.match(holdRoute, /release_collection_hold/);
const approveRoute = read("app/api/collections/events/approve/route.ts");
assert.match(approveRoute, /approve_collection_event/);

console.log("Collections Phase 1 review contract checks passed.");
