// LOCAL ONLY. Proves two concurrent DB claims cannot own the same attempt.
// Uses synthetic fixtures on the fixed local Supabase port and restores every
// modified setting and fixture in finally. No provider request is made.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const DB = "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
const CLIENT_ID = "10000000-0000-4000-8000-000000000001";
const OWNER_ID = "00000000-0000-4000-8000-000000000001";
const execFileAsync = promisify(execFile);
const invoiceId = randomUUID();
const attemptId = randomUUID();
const invoiceNumber = `LOCAL-CONCURRENCY-${invoiceId.slice(0, 8)}`;
const idempotencyKey = `collections:${invoiceId}:stage:1`;
let originalSettings;

async function psql(statement) {
  const args = [DB, "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1"];
  args.push("-c", statement);
  const { stdout } = await execFileAsync("psql", args, { encoding: "utf8", maxBuffer: 1024 * 1024 });
  return stdout.trim();
}
const sqlLiteral = (value) => value == null ? "null" : `'${String(value).replaceAll("'", "''")}'`;

try {
  const settingsText = await psql(`select jsonb_build_object(
    'automation_enabled', automation_enabled, 'delivery_mode', delivery_mode, 'test_recipient', test_recipient,
    'send_start', send_start::text, 'send_end', send_end::text, 'weekdays_only', weekdays_only
  )::text from tap_hub_project.collection_settings where id = 'default'`);
  originalSettings = JSON.parse(settingsText);

  await psql(`set session_replication_role = replica; begin;
    select set_config('tap_hub.actor_id', '${OWNER_ID}', true);
    update tap_hub_project.collection_settings set automation_enabled = true, delivery_mode = 'test',
      test_recipient = 'owner@example.invalid', send_start = time '00:00:00', send_end = time '23:59:59.999999',
      weekdays_only = false where id = 'default';
    insert into tap_hub_project.invoices (id, client_id, invoice_number, status, issue_date, due_date, created_by, is_synthetic)
      values ('${invoiceId}', '${CLIENT_ID}', '${invoiceNumber}', 'issued', tap_hub_project.collections_firm_today() - 30,
        tap_hub_project.collections_firm_today() - 2, '${OWNER_ID}', true);
    insert into tap_hub_project.invoice_lines (invoice_id, description, quantity, unit_amount, amount)
      values ('${invoiceId}', 'Synthetic concurrent-claim test', 1, 100, 100);
    insert into tap_hub_project.collection_delivery_attempts
      (id, client_id, invoice_id, stage, status, idempotency_key, actor)
      values ('${attemptId}', '${CLIENT_ID}', '${invoiceId}', 1, 'queued', '${idempotencyKey}', '${OWNER_ID}');
    commit;`);

  const claim = `set session_replication_role = replica; select coalesce(tap_hub_project.claim_collection_test_delivery('${attemptId}', '${OWNER_ID}'), 'CLAIMED');`;
  const outputs = await Promise.all([psql(claim), psql(claim)]);
  const results = outputs.map((output) => output.split(/\r?\n/).at(-1));
  assert.equal(results.filter((result) => result === "CLAIMED").length, 1, `exactly one claim must win: ${JSON.stringify(results)}`);
  assert.equal(results.filter((result) => result === "ATTEMPT_ALREADY_EXISTS").length, 1, `the replay must be refused: ${JSON.stringify(results)}`);

  const persisted = (await psql(`select status || '|' || attempt_count from tap_hub_project.collection_delivery_attempts where id = '${attemptId}'`)).split(/\r?\n/).at(-1);
  assert.equal(persisted, "sending|1");
  console.log("PASS concurrent claim: one owner, one replay refused, no provider call");
} finally {
  if (originalSettings) {
    await psql(`set session_replication_role = replica; begin;
      delete from tap_hub_project.collection_delivery_attempts where id = '${attemptId}';
      delete from tap_hub_project.invoices where id = '${invoiceId}';
      update tap_hub_project.collection_settings set automation_enabled = ${originalSettings.automation_enabled},
        delivery_mode = ${sqlLiteral(originalSettings.delivery_mode)}, test_recipient = ${sqlLiteral(originalSettings.test_recipient)},
        send_start = ${sqlLiteral(originalSettings.send_start)}::time, send_end = ${sqlLiteral(originalSettings.send_end)}::time,
        weekdays_only = ${originalSettings.weekdays_only}
        where id = 'default';
      commit;`);
  }
}
