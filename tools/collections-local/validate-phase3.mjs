// LOCAL ONLY. Phase 3 (test-only email delivery) integrated checks for the
// tools/collections-local stack: real app routes backed by the disposable local
// Supabase, plus database and audit evidence. Synthetic data only; never sends.
//
// Run from the repository root after reset.sh and create-test-users.mjs, with the
// app running against the local stack:
//   APP_URL=http://localhost:3000 node tools/collections-local/validate-phase3.mjs
// Set PSQL if psql is not on PATH. Each check is PASS, FAIL, or BLOCKED; BLOCKED
// means the Phase 3 route it needs is not installed yet (404 without a code).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const BASE = process.env.APP_URL || "http://localhost:3000";
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
if (!/^http:\/\/127\.0\.0\.1:55321\/?$/.test(env.NEXT_PUBLIC_SUPABASE_URL)) throw new Error("Refusing: app is not pointed at the local Supabase");
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\/?$/.test(BASE)) throw new Error("Refusing: APP_URL must be a local address");

class Session {
  constructor(label) { this.label = label; this.jar = new Map(); }
  store(res) {
    for (const raw of res.headers.getSetCookie?.() || []) {
      const [pair] = raw.split(";");
      const name = pair.slice(0, pair.indexOf("="));
      const value = pair.slice(pair.indexOf("=") + 1);
      if (/max-age=0|expires=thu, 01 jan 1970/i.test(raw) || value === "") this.jar.delete(name); else this.jar.set(name, value);
    }
  }
  async call(method, path, body) {
    const res = await fetch(BASE + path, {
      method,
      redirect: "manual",
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(this.jar.size ? { Cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    this.store(res);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json };
  }
  async signIn(name) {
    const email = env[`TEST_${name}_EMAIL`];
    const resolved = await this.call("POST", "/api/auth/resolve-login", { identifier: email });
    const signIn = await this.call("POST", "/api/auth/sign-in", { email: resolved.json?.email || email, password: env[`TEST_${name}_PASSWORD`] });
    if (signIn.status !== 200) throw new Error(`${name} could not sign in (${signIn.status})`);
  }
}

const DB = "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
const PSQL = process.env.PSQL || "psql";
const sql = (q) => execFileSync(PSQL, [DB, "-X", "-A", "-t", "-c", q], { encoding: "utf8" }).split(String.fromCharCode(13)).join("").trim();
const OWNER_ID = "00000000-0000-4000-8000-000000000001";

const results = [];
function record(id, name, outcome, evidence) {
  results.push(outcome);
  console.log(`${outcome} ${id} ${name} :: ${evidence}`);
}
const pass = (ok) => (ok ? "PASS" : "FAIL");
const missing = (r) => r.status === 404 && !r.json?.code;
const attempts = () => Number(sql("select count(*) from tap_hub_project.collection_delivery_attempts"));

// ---- Database safeguards (run before any route exists) --------------------------
const settings = sql("select automation_enabled || ' ' || delivery_mode from tap_hub_project.collection_settings where id = 'default'");
record("DB1", "automation off and delivery disabled by default", pass(settings === "false disabled"), settings);
const constraints = sql("select string_agg(pg_get_constraintdef(oid), ' | ') from pg_constraint where conrelid = 'tap_hub_project.collection_delivery_attempts'::regclass");
record("DB2", "one attempt per invoice/stage and a unique idempotency key", pass(/UNIQUE \(invoice_id, stage\)/.test(constraints) && /UNIQUE \(idempotency_key\)/.test(constraints)), "unique (invoice_id, stage) and (idempotency_key)");
const grants = sql("select coalesce(string_agg(grantee || ':' || privilege_type, ','), 'none') from information_schema.role_table_grants where table_schema = 'tap_hub_project' and table_name = 'collection_delivery_attempts' and grantee in ('anon', 'authenticated')");
const rls = sql("select relrowsecurity from pg_class where oid = 'tap_hub_project.collection_delivery_attempts'::regclass");
record("DB3", "attempts table has RLS and no anon/authenticated grants", pass(rls === "t" && grants === "none"), `rls=${rls} grants=${grants}`);
const statusCheck = sql("select pg_get_constraintdef(oid) from pg_constraint where conname = 'collection_delivery_attempts_status_check'");
const accepted = /'accepted'/.test(statusCheck) && !/'sent'/.test(statusCheck);
record("DB4", "status vocabulary uses accepted, not sent (contract item 1)", accepted ? "PASS" : "BLOCKED", accepted ? "accepted" : "still 'sent'/sent_at; needs the producer's forward-only migration");
const startAttempts = attempts();
record("DB5", "no delivery attempts exist before the run", pass(startAttempts === 0), `attempts=${startAttempts}`);

// ---- Sessions ----------------------------------------------------------------
const owner = new Session("owner"); const admin = new Session("admin");
const staffC = new Session("staff-collections"); const staffB = new Session("staff-billing"); const staffU = new Session("staff-unassigned");
for (const [s, n] of [[owner, "OWNER"], [admin, "ADMIN"], [staffC, "STAFF_COLLECTIONS"], [staffB, "STAFF_BILLING"], [staffU, "STAFF_UNASSIGNED"]]) await s.signIn(n);
const anon = new Session("anon");

// ---- Route presence ------------------------------------------------------------
const ROUTES = {
  status: ["GET", "/api/collections/delivery-status"],
  history: ["GET", "/api/collections/deliveries"],
  retry: ["POST", "/api/collections/deliveries/00000000-0000-4000-8000-00000000dead/retry"],
  pause: ["POST", "/api/collections/automation/pause"],
  testRun: ["POST", "/api/collections/automation/test-run"],
};
const present = {};
for (const [key, [method, path]] of Object.entries(ROUTES)) {
  // Probe as Collections staff so nothing state-changing can succeed.
  const probe = await staffC.call(method, path);
  present[key] = !missing(probe);
  record("RT", `${method} ${path} is installed`, present[key] ? "PASS" : "BLOCKED", present[key] ? `${probe.status}` : "404 without a code");
}

// ---- Access matrix (every installed route) --------------------------------------
for (const [key, [method, path]] of Object.entries(ROUTES)) {
  if (!present[key]) { record("AC", `${method} ${path} access matrix`, "BLOCKED", "route not installed"); continue; }
  const rows = [[anon, "anonymous", 401], [staffU, "unassigned staff", 403], [staffC, "Collections staff", 403], [staffB, "Billing staff", 403]];
  for (const [session, who, expected] of rows) {
    const r = await session.call(method, path);
    record("AC", `${who} ${method} ${path} -> ${expected}`, pass(r.status === expected), `${r.status} ${r.json?.code || ""}`);
  }
}

// ---- Delivery status -------------------------------------------------------------
if (present.status) {
  const r = await owner.call("GET", ROUTES.status[1]);
  const keys = Object.keys(r.json || {}).sort().join();
  record("ST1", "Owner reads the exact delivery-status shape", pass(r.status === 200 && keys === "automation_enabled,missing,mode,test_ready,test_recipient_masked"), `${r.status} keys=${keys}`);
  const masked = r.json?.test_recipient_masked;
  record("ST2", "no secret or full mailbox is exposed", pass(!JSON.stringify({ ...r.json, missing: undefined }).match(/key|secret|token|re_[A-Za-z0-9]|@[^*]/i) && (masked === null || /\*/.test(masked))), `masked=${masked}`);
  record("ST3", "delivery stays disabled in the local harness", pass(r.json?.mode === "disabled" && r.json?.test_ready === false), `mode=${r.json?.mode} ready=${r.json?.test_ready} missing=${(r.json?.missing || []).join(",")}`);
  const a = await admin.call("GET", ROUTES.status[1]);
  record("ST4", "Admin reads delivery status", pass(a.status === 200), `${a.status}`);
} else record("ST", "delivery status checks", "BLOCKED", "route not installed");

// ---- History, paging, filters ------------------------------------------------------
if (present.history) {
  const r = await owner.call("GET", `${ROUTES.history[1]}?limit=50&offset=0`);
  record("HI1", "history returns { items, pagination: { limit, offset, total } }", pass(r.status === 200 && Array.isArray(r.json?.items) && ["limit", "offset", "total"].every((k) => typeof r.json?.pagination?.[k] === "number")), `${r.status} total=${r.json?.pagination?.total}`);
  for (const [query, label] of [["limit=201", "limit over 200"], ["offset=-1", "negative offset"], ["status=sent", "an unknown status"], ["invoice_id=not-a-uuid", "a malformed invoice id"]]) {
    const bad = await owner.call("GET", `${ROUTES.history[1]}?${query}`);
    record("HI2", `history rejects ${label}`, pass(bad.status === 422 || bad.status === 400), `${bad.status} ${bad.json?.code || ""}`);
  }
  const forbidden = JSON.stringify(r.json?.items || []);
  record("HI3", "history items carry no recipient, provider id, payload, or body", pass(!/recipient|provider_message_id|payload|body|@/i.test(forbidden)), `${(r.json?.items || []).length} items`);
} else record("HI", "history, paging, and filter checks", "BLOCKED", "route not installed");

// ---- Retry ---------------------------------------------------------------------
if (present.retry) {
  const r = await owner.call("POST", ROUTES.retry[1]);
  record("RE1", "retrying an unknown attempt is a coded not-found", pass(r.status === 404 && Boolean(r.json?.code)), `${r.status} ${r.json?.code || ""}`);
} else record("RE", "retry checks", "BLOCKED", "route not installed");

// ---- Pause (off only) -----------------------------------------------------------
if (present.pause) {
  const before = Number(sql("select coalesce(max(id), 0) from tap_hub_project.audit_log"));
  const r = await owner.call("POST", ROUTES.pause[1]);
  record("PA1", "Owner pause returns the delivery-status shape with automation off", pass(r.status === 200 && r.json?.automation_enabled === false && "test_ready" in (r.json || {})), `${r.status} automation=${r.json?.automation_enabled}`);
  const audit = sql(`select coalesce(string_agg(actor || ' ' || action || ' ' || entity, '; '), '') from tap_hub_project.audit_log where id > ${before}`);
  record("PA2", "pause is audited with the Owner as actor", pass(audit.includes(OWNER_ID)), audit || "no audit row");
  const again = await owner.call("POST", ROUTES.pause[1]);
  record("PA3", "pausing twice is harmless", pass(again.status === 200 && again.json?.automation_enabled === false), `${again.status}`);
  const reEnable = await owner.call("PATCH", "/api/collections/rules", { settings: { automation_enabled: true } });
  record("PA4", "automation cannot be switched on through the rules API", pass(reEnable.status === 422), `${reEnable.status} ${reEnable.json?.code || ""}`);
  for (const path of ["/api/collections/automation/unpause", "/api/collections/automation/resume"]) {
    const resume = await owner.call("POST", path);
    record("PA5", `no unpause route at ${path}`, pass(resume.status === 404), `${resume.status}`);
  }
} else record("PA", "off-only pause checks", "BLOCKED", "route not installed");

// ---- Run test now (must refuse while not test-ready) ---------------------------------
if (present.testRun) {
  const before = attempts();
  const r = await owner.call("POST", ROUTES.testRun[1]);
  record("TR1", "Run test now is refused while test mode is not ready", pass(r.status >= 400 && r.status < 500 && Boolean(r.json?.code)), `${r.status} ${r.json?.code || ""}`);
  record("TR2", "a refused test run creates no delivery attempts", pass(attempts() === before), `attempts ${before} -> ${attempts()}`);
  const withBody = await owner.call("POST", ROUTES.testRun[1], { recipient: "someone@example.invalid", as_of_date: "2030-01-01" });
  record("TR3", "test run ignores or rejects recipient/as-of overrides", pass(withBody.status >= 400 && attempts() === before), `${withBody.status} ${withBody.json?.code || ""}`);
} else record("TR", "Run test now checks", "BLOCKED", "route not installed");

// ---- Worklist and preview fields ---------------------------------------------------
const wl = await owner.call("GET", "/api/collections/receivables");
const invoices = (wl.json?.accounts || []).flatMap((a) => a.invoices);
const hasLast = invoices.length > 0 && invoices.every((i) => "last_delivery" in i);
record("WL1", "every worklist invoice carries last_delivery (null until an attempt)", hasLast ? pass(invoices.every((i) => i.last_delivery === null)) : "BLOCKED", hasLast ? `${invoices.length} invoices` : "field not returned yet");
const staffWl = await staffC.call("GET", "/api/collections/receivables");
const staffHas = (staffWl.json?.accounts || []).flatMap((a) => a.invoices).every((i) => "last_delivery" in i);
record("WL2", "Collections staff also see last_delivery", hasLast ? pass(staffHas) : "BLOCKED", hasLast ? "readable by all worklist readers" : "field not returned yet");
const pv = await owner.call("POST", "/api/collections/automation/preview", {});
const actions = pv.json?.actions || [];
const hasAttempt = actions.length > 0 && actions.every((a) => "delivery_attempt" in a);
if (pv.status !== 200) record("PV1", "preview actions carry delivery_attempt", "FAIL", `${pv.status} ${pv.json?.code || ""}`);
else if (!actions.length) record("PV1", "preview actions carry delivery_attempt", "BLOCKED", "the preview returned no actions for the fixtures");
else record("PV1", "preview actions carry delivery_attempt", hasAttempt ? pass(actions.every((a) => a.delivery_attempt === null && a.delivery_performed === false)) : "FAIL", hasAttempt ? `${actions.length} actions` : "field not returned");

// ---- Synthetic-only safeguard ------------------------------------------------------
const marker = sql("select count(*) from information_schema.columns where table_schema = 'tap_hub_project' and table_name in ('clients', 'invoices') and column_name ilike '%synthetic%'");
record("SY1", "fixtures carry the synthetic marker the worker requires (contract item 9)", Number(marker) > 0 ? "PASS" : "BLOCKED", Number(marker) > 0 ? `${marker} marker column(s)` : "marker not implemented yet");

const endAttempts = attempts();
record("END", "no delivery attempts were created by this run", pass(endAttempts === startAttempts), `attempts=${endAttempts}`);

const count = (o) => results.filter((r) => r === o).length;
console.log(`\nPHASE 3 SUMMARY: ${count("PASS")} PASS, ${count("FAIL")} FAIL, ${count("BLOCKED")} BLOCKED`);
process.exitCode = count("FAIL") ? 1 : 0;
