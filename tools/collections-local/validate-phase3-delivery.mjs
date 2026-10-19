// LOCAL ONLY. Engineer A Phase 3 synthetic delivery run: drives the Owner "Run test now"
// path end to end against the fake Resend provider (fake-resend.mjs), so nothing is sent.
// Covers readiness, access, a hold suppressing a send, provider rate limiting and
// retry with the same idempotency key, acceptance and the logged reminder, a
// network failure that needs review, an invoice blocked by an A/R report balance
// difference (Phase 4), repeat runs, and pause.
//
//   node tools/collections-local/dev-fake-resend.mjs            # app on :3002 with the fake
//   APP_URL=http://localhost:3002 node tools/collections-local/validate-phase3-delivery.mjs
//
// Run after `reset.sh --local` and `create-test-users.mjs`. It enables test delivery in the
// local database for the run and turns it back off at the end. Outcomes: PASS, FAIL.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.APP_URL || "http://localhost:3002";
const here = dirname(fileURLToPath(import.meta.url));
const LOG = process.env.FAKE_RESEND_LOG || join(here, ".fake-resend", "requests.jsonl");
const CONTROL = process.env.FAKE_RESEND_CONTROL || join(here, ".fake-resend", "control.json");
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
if (!/^http:\/\/127\.0\.0\.1:55321\/?$/.test(env.NEXT_PUBLIC_SUPABASE_URL)) throw new Error("Refusing: app is not pointed at the local Supabase");
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\/?$/.test(BASE)) throw new Error("Refusing: APP_URL must be a local address");
if (!existsSync(`${LOG}.loaded`) || !readFileSync(`${LOG}.loaded`, "utf8").includes("start-server")) {
  throw new Error("Refusing: the fake Resend provider is not loaded in the app's route server (start it with dev-fake-resend.mjs)");
}

const DB = "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
const sql = (q) => execFileSync(process.env.PSQL || "psql", [DB, "-X", "-A", "-t", "-c", q], { encoding: "utf8" }).split(String.fromCharCode(13)).join("").trim();
const C2 = "10000000-0000-4000-8000-000000000002"; // Sample Harbor Inc (synthetic)
const I1 = "20000000-0000-4000-8000-000000000001"; // LOCAL-001
const I2 = "20000000-0000-4000-8000-000000000002"; // LOCAL-002
const TEST_INBOX = "test-inbox@example.test";

class Session {
  constructor() { this.jar = new Map(); }
  store(res) {
    for (const raw of res.headers.getSetCookie?.() || []) {
      const [pair] = raw.split(";");
      const name = pair.slice(0, pair.indexOf("="));
      const value = pair.slice(pair.indexOf("=") + 1);
      if (/max-age=0/i.test(raw) || value === "") this.jar.delete(name); else this.jar.set(name, value);
    }
  }
  async call(method, path, body) {
    const headers = this.jar.size ? { Cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(BASE + path, { method, redirect: "manual", headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    this.store(res);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json };
  }
  async signIn(name) {
    const email = env[`TEST_${name}_EMAIL`];
    const r = await this.call("POST", "/api/auth/sign-in", { identifier: email, password: env[`TEST_${name}_PASSWORD`] });
    if (r.status !== 200) throw new Error(`${name} could not sign in (${r.status})`);
    return this;
  }
}

const results = [];
const record = (id, name, ok, evidence) => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${name} :: ${evidence}`); };
const setMode = (mode) => writeFileSync(CONTROL, JSON.stringify({ mode }));
const requests = () => (existsSync(LOG) ? readFileSync(LOG, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : []);
const attempts = (invoiceId) => sql(`select coalesce(string_agg(stage || ':' || status || ':' || coalesce(reason_code, '-'), ',' order by stage), '') from tap_hub_project.collection_delivery_attempts where invoice_id = '${invoiceId}'`);

// Local-only switch-on: test mode, automation on, an all-day window so the run is not time-dependent.
writeFileSync(LOG, "");
setMode("accept");
sql("update tap_hub_project.collection_settings set delivery_mode = 'test', test_recipient = 'test-inbox@example.test', automation_enabled = true, weekdays_only = false, send_start = '00:00', send_end = '23:59:59' where id = 'default'");

const anon = new Session();
const owner = await new Session().signIn("OWNER");
const staffC = await new Session().signIn("STAFF_COLLECTIONS");

const status = await owner.call("GET", "/api/collections/delivery-status");
record("D0", "test delivery reports ready with only the masked test inbox", status.status === 200 && status.json?.test_ready === true && status.json?.mode === "test"
  && /^t\*+@example\.test$/.test(status.json?.test_recipient_masked || "") && !JSON.stringify(status.json).includes(TEST_INBOX),
  `${status.status} ready=${status.json?.test_ready} missing=${JSON.stringify(status.json?.missing)} masked=${status.json?.test_recipient_masked}`);

const staffRun = await staffC.call("POST", "/api/collections/automation/test-run");
const anonRun = await anon.call("POST", "/api/collections/automation/test-run");
record("D1", "only Owner/Admin can run a test send", staffRun.status === 403 && anonRun.status === 401 && requests().length === 0, `staff ${staffRun.status}, anonymous ${anonRun.status}, provider calls ${requests().length}`);

// A client-wide hold on Sample Harbor must keep LOCAL-002 from being sent.
const hold = await owner.call("POST", "/api/collections/holds", { client_id: C2, reason: "Synthetic hold for the delivery run" });
const holdId = hold.json?.hold?.id;

setMode("rate_limit");
const run1 = await owner.call("POST", "/api/collections/automation/test-run");
const afterRun1 = requests();
record("D2", "a provider rate limit fails the attempt as retryable", run1.status === 200 && run1.json?.failed >= 1 && /:failed:PROVIDER_RATE_LIMITED/.test(attempts(I1)) && afterRun1.length >= 1,
  `${run1.status} ${JSON.stringify(run1.json)}; LOCAL-001 ${attempts(I1)}; provider calls ${afterRun1.length}`);
record("D3", "the held client's invoice is suppressed and never reaches the provider", hold.status === 201 && !/:(accepted|sending|queued|failed)/.test(attempts(I2))
  && afterRun1.every((entry) => !/LOCAL-002/.test(entry.subject || "")),
  `hold ${hold.status}; LOCAL-002 ${attempts(I2) || "(no attempt)"}; suppressed ${run1.json?.suppressed}`);

const failed = await owner.call("GET", "/api/collections/deliveries?status=failed");
const failedItem = (failed.json?.items || []).find((item) => item.invoice_id === I1 && item.retryable);
const retry = failedItem ? await owner.call("POST", `/api/collections/deliveries/${failedItem.attempt_id}/retry`) : { status: 0 };
const staffRetry = failedItem ? await staffC.call("POST", `/api/collections/deliveries/${failedItem.attempt_id}/retry`) : { status: 0 };
record("D4", "the failed attempt is offered for retry and queued by Owner only", !!failedItem && retry.status === 202 && retry.json?.status === "queued" && staffRetry.status === 403,
  `retryable=${failedItem?.retryable}; retry ${retry.status} ${retry.json?.status}; staff ${staffRetry.status}`);

setMode("accept");
const run2 = await owner.call("POST", "/api/collections/automation/test-run");
const afterRun2 = requests();
const failedKey = afterRun1.find((entry) => entry.mode === "rate_limit")?.idempotency_key;
const acceptedEntries = afterRun2.filter((entry) => entry.mode === "accept");
const reminder = sql(`select count(*) from tap_hub_project.collection_events where invoice_id = '${I1}' and event_type = 'reminder_logged' and stage is not null`);
const messageIds = sql(`select count(*) from tap_hub_project.collection_delivery_attempts where invoice_id = '${I1}' and status = 'accepted' and provider_message_id like 'fake_%'`);
record("D5", "the retry is accepted with the same idempotency key and logs the reminder", run2.status === 200 && run2.json?.accepted >= 1 && !!failedKey
  && acceptedEntries.some((entry) => entry.idempotency_key === failedKey) && Number(reminder) >= 1 && Number(messageIds) >= 1,
  `${run2.status} ${JSON.stringify(run2.json)}; same key reused=${acceptedEntries.some((entry) => entry.idempotency_key === failedKey)}; reminders ${reminder}; accepted with provider id ${messageIds}`);

const run3 = await owner.call("POST", "/api/collections/automation/test-run");
const afterRun3 = requests();
const acceptedKeys = afterRun3.filter((entry) => entry.mode === "accept").map((entry) => entry.idempotency_key);
const duplicateStages = sql("select count(*) from (select canonical_collection_identity, stage from tap_hub_project.collection_delivery_attempts where status = 'accepted' group by 1, 2 having count(*) > 1) d");
record("D6", "repeat runs never send the same invoice stage twice", run3.status === 200 && new Set(acceptedKeys).size === acceptedKeys.length && duplicateStages === "0",
  `run3 ${run3.status} ${JSON.stringify(run3.json)}; accepted provider calls ${acceptedKeys.length} (unique ${new Set(acceptedKeys).size}); duplicate accepted stages ${duplicateStages}`);

// Phase 4: an approved A/R report says LOCAL-002's balance differs from Billing and nobody
// has resolved it. With the hold released, the runner must still not send it.
const ownerId = sql("select id from tap_hub_project.profiles where role = 'owner' order by id limit 1");
const adminId = sql("select id from tap_hub_project.profiles where role = 'admin' order by id limit 1");
sql(`with b as (insert into tap_hub_project.collection_import_batches (file_sha256, storage_path, original_filename, content_type, file_size_bytes, report_type, source_as_of, status, uploaded_by, approved_by, approved_at)
      values (repeat('d', 64), 'synthetic/delivery-check.pdf', 'delivery-check.pdf', 'application/pdf', 100, 'aging_detail', tap_hub_project.collections_firm_today() - 1, 'approved', '${ownerId}', '${adminId}', now()) returning id),
  s as (insert into tap_hub_project.collection_source_invoice_identities (client_id, linked_invoice_id, canonical_collection_identity, selected_source)
      values ('${C2}', '${I2}', 'billing:${I2}', 'billing') returning source_invoice_id)
  insert into tap_hub_project.collection_import_invoices (source_invoice_id, batch_id, invoice_number, customer_name, open_balance, source_as_of, source_row_key, review_status, discrepancy_status)
  select s.source_invoice_id, b.id, 'LOCAL-002', 'Sample Harbor Inc', 60, tap_hub_project.collections_firm_today() - 1, '1:1', 'blocked', 'blocked' from b, s`);
await owner.call("PATCH", "/api/collections/holds", { id: holdId });
const beforeBlocked = requests().length;
const blockedRun = await owner.call("POST", "/api/collections/automation/test-run");
record("D10", "an invoice blocked by an unresolved A/R report difference is not sent", blockedRun.status === 200 && requests().length === beforeBlocked && !/:(accepted|sending|failed)/.test(attempts(I2)),
  `${blockedRun.status} ${JSON.stringify(blockedRun.json)}; LOCAL-002 ${attempts(I2) || "(no attempt)"}; provider calls ${requests().length - beforeBlocked}`);
sql(`update tap_hub_project.collection_import_invoices set discrepancy_status = 'resolved', review_status = 'approved' where invoice_number = 'LOCAL-002' and batch_id in (select id from tap_hub_project.collection_import_batches where original_filename = 'delivery-check.pdf')`);

// Then make the provider unreachable: the outcome is unknown, so it needs review, not retry.
setMode("network_error");
const run4 = await owner.call("POST", "/api/collections/automation/test-run");
const unknown = await owner.call("GET", "/api/collections/deliveries?status=needs_review");
const unknownItem = (unknown.json?.items || []).find((item) => item.invoice_id === I2);
const unknownRetry = unknownItem ? await owner.call("POST", `/api/collections/deliveries/${unknownItem.attempt_id}/retry`) : { status: 0 };
record("D7", "an unreachable provider leaves the attempt for review, not automatic retry", run4.status === 200 && !!unknownItem && unknownItem.reason_code === "PROVIDER_OUTCOME_UNKNOWN" && unknownRetry.status === 409,
  `${run4.status} ${JSON.stringify(run4.json)}; LOCAL-002 ${attempts(I2)}; retry ${unknownRetry.status} ${unknownRetry.json?.code}`);

const staffHistory = await staffC.call("GET", "/api/collections/deliveries");
const history = await owner.call("GET", "/api/collections/deliveries");
const historyText = JSON.stringify(history.json || {});
record("D8", "delivery history is Owner/Admin only and shows no addresses or message bodies", staffHistory.status === 403 && history.status === 200 && (history.json?.items || []).length >= 2
  && !historyText.includes("@") && !/body|html/i.test(Object.keys(history.json?.items?.[0] || {}).join(",")),
  `staff ${staffHistory.status}; owner ${history.status} items=${(history.json?.items || []).length}`);

setMode("accept");
const before = requests().length;
const pause = await owner.call("POST", "/api/collections/automation/pause");
const pausedRun = await owner.call("POST", "/api/collections/automation/test-run");
record("D9", "pausing stops test sends", pause.status === 200 && pausedRun.status === 409 && pausedRun.json?.code === "DELIVERY_NOT_READY"
  && (pausedRun.json?.missing || []).includes("AUTOMATION_PAUSED") && requests().length === before,
  `pause ${pause.status}; run ${pausedRun.status} ${pausedRun.json?.code} ${JSON.stringify(pausedRun.json?.missing)}; provider calls unchanged=${requests().length === before}`);

const all = requests();
const contactEmails = sql("select coalesce(string_agg(email, ','), '') from tap_hub_project.contacts").split(",").filter(Boolean);
record("SF1", "every provider call went only to the test inbox, from the test sender, with the dummy key", all.length >= 3
  && all.every((entry) => JSON.stringify(entry.to) === JSON.stringify([TEST_INBOX]) && /collections-test@example\.test/.test(entry.from || "") && entry.reply_to === "replies-test@example.test" && entry.dummy_key === true)
  && all.every((entry) => !contactEmails.some((email) => JSON.stringify(entry).includes(email))),
  `${all.length} provider call(s); recipients ${[...new Set(all.map((entry) => JSON.stringify(entry.to)))].join(" ")}`);
const nonSynthetic = sql("select count(*) from tap_hub_project.collection_delivery_attempts a join tap_hub_project.invoices i on i.id = a.invoice_id where not i.is_synthetic");
record("SF2", "only synthetic invoices were attempted", nonSynthetic === "0", `${nonSynthetic} non-synthetic attempt(s)`);

sql("update tap_hub_project.collection_settings set delivery_mode = 'disabled', test_recipient = null, automation_enabled = false, weekdays_only = true, send_start = '09:00', send_end = '17:00' where id = 'default'");
setMode("accept");
const passed = results.filter(Boolean).length;
console.log(`\nPHASE 3 DELIVERY SUMMARY: ${passed} PASS, ${results.length - passed} FAIL (test delivery switched back off)`);
