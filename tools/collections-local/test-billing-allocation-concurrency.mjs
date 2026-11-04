// LOCAL ONLY. Proves concurrent allocations cannot exceed one invoice balance.
// Uses the disposable local Supabase Postgres on fixed port 55322, synthetic
// rows, and removes its fixtures and audit rows in finally. No .env or hosted
// credentials are read.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const DB = "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
const OWNER_ID = "00000000-0000-4000-8000-000000000001";
const execFileAsync = promisify(execFile);
const ids = {
  client: randomUUID(),
  invoice: randomUUID(),
  paymentA: randomUUID(),
  paymentB: randomUUID(),
};
const invoiceNumber = `LOCAL-ALLOC-RACE-${ids.invoice}`;

async function psql(sql) {
  const { stdout } = await execFileAsync(
    "psql",
    [DB, "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql],
    { encoding: "utf8", maxBuffer: 1024 * 1024 },
  );
  return stdout.trim();
}

async function tryAllocation(paymentId) {
  try {
    const allocationId = await psql(
      `select tap_hub_project.allocate_payment('${paymentId}', '${ids.invoice}', 75.00, '${OWNER_ID}')`,
    );
    return { ok: true, allocationId };
  } catch (error) {
    const message = [error.stdout, error.stderr, error.message].filter(Boolean).join("\n");
    return { ok: false, expectedOverAllocation: message.includes("invoice would be over-allocated") };
  }
}

async function cleanup() {
  const allocationIds = (await psql(`select id::text from tap_hub_project.payment_allocations where invoice_id = '${ids.invoice}'`))
    .split(/\r?\n/).filter(Boolean);
  const lineIds = (await psql(`select id::text from tap_hub_project.invoice_lines where invoice_id = '${ids.invoice}'`))
    .split(/\r?\n/).filter(Boolean);
  const auditIds = [ids.client, ids.invoice, ids.paymentA, ids.paymentB, ...allocationIds, ...lineIds];
  const auditIdList = auditIds.map((id) => `'${id}'`).join(",");
  await psql(`begin;
    delete from tap_hub_project.payment_allocations where invoice_id = '${ids.invoice}';
    delete from tap_hub_project.invoices where id = '${ids.invoice}';
    delete from tap_hub_project.payments where id in ('${ids.paymentA}', '${ids.paymentB}');
    delete from tap_hub_project.clients where id = '${ids.client}';
    delete from tap_hub_project.audit_log where entity_id in (${auditIdList});
    commit;`);
}

try {
  await psql(`begin;
    select set_config('tap_hub.actor_id', '${OWNER_ID}', true);
    insert into tap_hub_project.clients(id, name, type)
      values ('${ids.client}', 'Synthetic Allocation Race LLC', 'business');
    insert into tap_hub_project.invoices(id, client_id, invoice_number, status, issue_date, due_date, created_by)
      values ('${ids.invoice}', '${ids.client}', null, 'draft', null, null, '${OWNER_ID}');
    insert into tap_hub_project.invoice_lines(invoice_id, description, quantity, unit_amount, amount, created_by)
      values ('${ids.invoice}', 'Synthetic race invoice line', 1, 100.00, 100.00, '${OWNER_ID}');
    update tap_hub_project.invoices set status = 'issued', invoice_number = '${invoiceNumber}', issue_date = current_date, due_date = current_date + 15 where id = '${ids.invoice}';
    insert into tap_hub_project.payments(id, client_id, received_on, amount, method, created_by)
      values ('${ids.paymentA}', '${ids.client}', current_date, 75.00, 'check', '${OWNER_ID}'),
             ('${ids.paymentB}', '${ids.client}', current_date, 75.00, 'check', '${OWNER_ID}');
    commit;`);

  const results = await Promise.all([tryAllocation(ids.paymentA), tryAllocation(ids.paymentB)]);
  assert.equal(results.filter((result) => result.ok).length, 1, `one allocation must win: ${JSON.stringify(results)}`);
  assert.equal(results.filter((result) => result.expectedOverAllocation).length, 1, `one allocation must be rejected for invoice over-allocation: ${JSON.stringify(results)}`);

  const allocated = await psql(
    `select coalesce(sum(amount), 0)::numeric(12,2)::text from tap_hub_project.payment_allocations where invoice_id = '${ids.invoice}' and reversed_at is null`,
  );
  assert.equal(allocated, "75.00", `active allocations must remain at or below the $100.00 invoice total; got ${allocated}`);
  console.log("PASS concurrent Billing allocation: one $75.00 allocation accepted, one rejected, $75.00 active total.");
} finally {
  await cleanup();
}
