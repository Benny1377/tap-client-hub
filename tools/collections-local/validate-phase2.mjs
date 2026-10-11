// LOCAL ONLY. Phase 2 integrated validation for the tools/collections-local stack:
// real app routes on http://localhost:3000 (npm run dev with the local .env.local)
// backed by the disposable local Supabase, plus database and audit_log evidence.
// Refuses to run unless .env.local points at http://127.0.0.1:55321. Synthetic data only.
//
// Run from the repository root after reset.sh, ui-overlay.sql, and create-test-users.mjs:
//   node tools/collections-local/validate-phase2.mjs
// Set PSQL if psql is not on PATH. Each run adds events; reset.sh for a clean rerun.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// LOCAL ONLY API client for http://localhost:3000 backed by the local Supabase stack.
// Signs in through the app's own routes, keeps cookies in memory, never prints secrets.

const BASE = "http://localhost:3000";
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
if (!/^http:\/\/127\.0\.0\.1:55321\/?$/.test(env.NEXT_PUBLIC_SUPABASE_URL)) throw new Error("Refusing: app is not pointed at the local Supabase");

function credentials(name) {
  return { email: env[`TEST_${name}_EMAIL`], password: env[`TEST_${name}_PASSWORD`] };
}

class Session {
  constructor(label) { this.label = label; this.jar = new Map(); }
  cookieHeader() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "); }
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
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(this.jar.size ? { Cookie: this.cookieHeader() } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    this.store(res);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  }
  async signIn(name) {
    const { email, password } = credentials(name);
    const resolved = await this.call("POST", "/api/auth/resolve-login", { identifier: email });
    const signIn = await this.call("POST", "/api/auth/sign-in", { email: resolved.json?.email || email, password });
    return { resolveStatus: resolved.status, signInStatus: signIn.status, signInError: signIn.json?.error, hasSessionCookie: [...this.jar.keys()].some((k) => /^sb-.*-auth-token/.test(k)) };
  }
}

// ---- Validation ----------------------------------------------------------------
const DB = "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
const PSQL = process.env.PSQL || "psql";
const sql = (q) => execFileSync(PSQL, [DB, "-X", "-A", "-t", "-F", " | ", "-c", q], { encoding: "utf8" }).split(String.fromCharCode(13)).join("").trim();

const C1 = "10000000-0000-4000-8000-000000000001"; // Example Orchard LLC
const C2 = "10000000-0000-4000-8000-000000000002"; // Sample Harbor Inc
const I1 = "20000000-0000-4000-8000-000000000001"; // LOCAL-001
const I2 = "20000000-0000-4000-8000-000000000002"; // LOCAL-002
const OWNER_ID = "00000000-0000-4000-8000-000000000001";
const STAFF_ID = "00000000-0000-4000-8000-000000000002";

const results = [];
function record(id, name, ok, evidence) {
  results.push({ id, name, ok, evidence });
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${name} :: ${evidence}`);
}
const auditMax = () => Number(sql("select coalesce(max(id),0) from tap_hub_project.audit_log"));
const auditSince = (from) => sql(`select actor || ' ' || action || ' ' || entity from tap_hub_project.audit_log where id > ${from} order by id`).split("\n").filter(Boolean);
const invoiceRow = (wl, invoiceId) => wl.json?.accounts?.flatMap((a) => a.invoices).find((i) => i.invoice_id === invoiceId);

const owner = new Session("owner"); const admin = new Session("admin");
const staffC = new Session("staff-collections"); const staffB = new Session("staff-billing"); const staffU = new Session("staff-unassigned");
for (const [s, n] of [[owner, "OWNER"], [admin, "ADMIN"], [staffC, "STAFF_COLLECTIONS"], [staffB, "STAFF_BILLING"], [staffU, "STAFF_UNASSIGNED"]]) {
  const r = await s.signIn(n);
  record("AUTH", `${n} signs in through the app`, r.signInStatus === 200 && r.hasSessionCookie, JSON.stringify(r));
}

// ---- Receivables, rules, firm date --------------------------------------------
const rules = await owner.call("GET", "/api/collections/rules");
record("R1", "rules endpoint returns the display subset", rules.status === 200 && rules.json.rules.length === 5 && rules.json.rules.every((r) => Object.keys(r).sort().join() === "automatic,days_past_due,enabled,label,stage"), `${rules.status} ${rules.json?.rules?.map((r) => `${r.stage}:${r.label}@${r.days_past_due}${r.automatic ? "a" : "m"}`).join(" ")}`);
const wl0 = await owner.call("GET", "/api/collections/receivables");
const firmToday = sql("select tap_hub_project.collections_firm_today()");
const bill0 = await owner.call("GET", "/api/billing/receivables");
record("RC1", "worklist and Billing receivables share the firm date", wl0.status === 200 && wl0.json.as_of_date === firmToday && bill0.json?.as_of_date === firmToday, `worklist=${wl0.json?.as_of_date} billing=${bill0.json?.as_of_date} db=${firmToday}`);
const inv1 = invoiceRow(wl0, I1), inv2 = invoiceRow(wl0, I2);
const sqlBal = sql(`select invoice_number || '=' || balance::text || '@' || days_past_due from tap_hub_project.get_billing_invoice_balances(tap_hub_project.collections_firm_today()) order by invoice_number`);
record("RC2", "worklist balances match the database read model", inv1?.balance === "125.00" && inv2?.balance === "80.00" && sqlBal.includes(`LOCAL-001=125.00@${inv1?.days_past_due}`) && sqlBal.includes(`LOCAL-002=80.00@${inv2?.days_past_due}`), `api LOCAL-001=${inv1?.balance}@${inv1?.days_past_due} LOCAL-002=${inv2?.balance}@${inv2?.days_past_due}; sql ${sqlBal.replace(/\n/g, "; ")}`);
const autoStages = rules.json.rules.filter((r) => r.enabled && r.automatic);
const expectedCatchUp = (days) => Math.max(0, ...autoStages.filter((r) => r.days_past_due <= days).map((r) => r.stage)) || null;
record("CU1", "reminder catch-up proposes the latest due reminder (no history)", inv2?.next_stage === expectedCatchUp(inv2?.days_past_due) && (inv2?.next_stage ?? 0) > 1, `LOCAL-002 days=${inv2?.days_past_due} next_stage=${inv2?.next_stage} expected=${expectedCatchUp(inv2?.days_past_due)} current_stage=${inv2?.current_stage}`);
record("CU2", "catch-up never skips the Owner escalation gate", inv1?.next_stage === 3 || inv1?.next_stage === 4, `LOCAL-001 days=${inv1?.days_past_due} next_stage=${inv1?.next_stage} (reminders 1-3 are caught up to 3 first; 4 needs a human)`);

// ---- Reminder logging and stage persistence ------------------------------------
let a0 = auditMax();
const rem = await staffC.call("POST", "/api/collections/events", { client_id: C2, invoice_id: I2, event_type: "reminder_logged", detail: { note: "Left voicemail" } });
const remStage = sql(`select stage from tap_hub_project.collection_events where id = '${rem.json?.event?.id}'`);
record("CU3", "logged reminder without a stage records the catch-up stage", rem.status === 201 && Number(remStage) === inv2?.next_stage && rem.json.event.invoice_number === "LOCAL-002", `${rem.status} stage(db)=${remStage} invoice_number=${rem.json?.event?.invoice_number}`);
record("AU1", "reminder write is audited with the staff actor", auditSince(a0).some((l) => l.startsWith(`${STAFF_ID} insert collection_events`)), auditSince(a0).join("; "));
const wl1 = await owner.call("GET", "/api/collections/receivables");
const inv2b = invoiceRow(wl1, I2);
record("CU4", "after the reminder, the worklist reloads with no repeat reminder", inv2b?.next_stage !== inv2?.next_stage, `LOCAL-002 next_stage ${inv2?.next_stage} -> ${inv2b?.next_stage} (days=${inv2b?.days_past_due})`);

// ---- Escalation approval ---------------------------------------------------------
const noInv = await staffC.call("POST", "/api/collections/events", { client_id: C1, event_type: "escalation_requested" });
record("AP0", "escalation request without an invoice is refused", noInv.status === 422 && noInv.json?.code === "INVALID_INPUT" && !/invalid_input:/i.test(noInv.json?.error || ""), `${noInv.status} ${noInv.json?.code} "${noInv.json?.error}"`);
const esc = await staffC.call("POST", "/api/collections/events", { client_id: C1, invoice_id: I1, event_type: "escalation_requested", detail: { note: "No reply to reminders" } });
const wl2 = await owner.call("GET", "/api/collections/receivables");
const inv1p = invoiceRow(wl2, I1);
record("AP1", "pending escalation surfaces as awaiting_approval and blocks later stages", esc.status === 201 && inv1p?.awaiting_approval?.event_id === esc.json?.event?.id && inv1p.awaiting_approval.stage === 4 && inv1p.next_stage === null, `${esc.status} awaiting=${JSON.stringify(inv1p?.awaiting_approval)} next_stage=${inv1p?.next_stage}`);
const staffApprove = await staffC.call("POST", "/api/collections/events/approve", { event_id: esc.json.event.id, event_type: "escalated" });
record("AC1", "Collections staff cannot approve an escalation", staffApprove.status === 403 && staffApprove.json?.code === "FORBIDDEN", `${staffApprove.status} ${staffApprove.json?.code}`);
a0 = auditMax();
const approve = await owner.call("POST", "/api/collections/events/approve", { event_id: esc.json.event.id, event_type: "escalated" });
record("AP2", "Owner approves the escalation", approve.status === 201 && approve.json.event.approves_event_id === esc.json.event.id && approve.json.event.invoice_number === "LOCAL-001", `${approve.status} ${approve.json?.event?.event_type} invoice_number=${approve.json?.event?.invoice_number}`);
record("AU2", "approval is audited with the Owner as actor", auditSince(a0).some((l) => l.startsWith(`${OWNER_ID} insert collection_events`)), auditSince(a0).join("; "));
const dupApprove = await owner.call("POST", "/api/collections/events/approve", { event_id: esc.json.event.id, event_type: "escalated" });
record("AP3", "a second approval of the same request is refused", dupApprove.status === 409 && dupApprove.json?.code === "APPROVAL_CONFLICT", `${dupApprove.status} ${dupApprove.json?.code} "${dupApprove.json?.error}"`);
const wl3 = await owner.call("GET", "/api/collections/receivables");
const inv1a = invoiceRow(wl3, I1);
record("AP4", "after approval the ladder moves on (reload)", !inv1a?.awaiting_approval && inv1a?.next_stage === 5, `awaiting=${JSON.stringify(inv1a?.awaiting_approval)} next_stage=${inv1a?.next_stage} days=${inv1a?.days_past_due}`);

// ---- Formal notice, then a later hold, then record the send ------------------------
const fnReq = await staffC.call("POST", "/api/collections/events", { client_id: C1, invoice_id: I1, event_type: "formal_notice_requested" });
const fnApp = await owner.call("POST", "/api/collections/events/approve", { event_id: fnReq.json?.event?.id, event_type: "formal_notice_approved" });
record("FN1", "formal notice requested by staff and approved by Owner", fnReq.status === 201 && fnApp.status === 201, `request ${fnReq.status}, approve ${fnApp.status}`);
a0 = auditMax();
const laterHold = await owner.call("POST", "/api/collections/holds", { client_id: C1, invoice_id: I1, reason: "Client disputes LOCAL-001 after notice" });
record("HD1", "Owner places a later invoice hold", laterHold.status === 201 && laterHold.json.hold.invoice_number === "LOCAL-001", `${laterHold.status} invoice_number=${laterHold.json?.hold?.invoice_number}`);
record("AU3", "hold placement is audited with the Owner, with a hold_placed event", auditSince(a0).some((l) => l === `${OWNER_ID} insert collection_holds`) && auditSince(a0).some((l) => l === `${OWNER_ID} insert collection_events`), auditSince(a0).join("; "));
const blockedReq = await staffC.call("POST", "/api/collections/events", { client_id: C1, invoice_id: I1, event_type: "escalation_requested" });
record("HD2", "the hold blocks new escalation requests", blockedReq.status === 409 && !/conflict:/i.test(blockedReq.json?.error || ""), `${blockedReq.status} ${blockedReq.json?.code} "${blockedReq.json?.error}"`);
const staffSent = await staffC.call("POST", "/api/collections/events", { client_id: C1, invoice_id: I1, event_type: "formal_notice_sent", approval_event_id: fnApp.json?.event?.id, detail: { note: "Mailed" } });
record("AC2", "Collections staff cannot record a notice as sent", staffSent.status === 403, `${staffSent.status} ${staffSent.json?.code}`);
const noNote = await owner.call("POST", "/api/collections/events", { client_id: C1, invoice_id: I1, event_type: "formal_notice_sent", approval_event_id: fnApp.json?.event?.id, detail: {} });
record("FN2", "recording a sent notice requires a note", noNote.status === 422 && noNote.json?.code === "INVALID_INPUT", `${noNote.status} ${noNote.json?.code} "${noNote.json?.error}"`);
a0 = auditMax();
const sent = await owner.call("POST", "/api/collections/events", { client_id: C1, invoice_id: I1, event_type: "formal_notice_sent", approval_event_id: fnApp.json?.event?.id, detail: { note: "Mailed certified letter before the dispute hold" } });
const sentRow = sql(`select event_type || ' ' || (detail->>'approval_event_id') || ' ' || (detail->>'note') from tap_hub_project.collection_events where id = '${sent.json?.event?.id}'`);
record("FN3", "a notice sent before a later hold can be recorded during the hold", sent.status === 201 && sentRow.startsWith(`formal_notice_sent ${fnApp.json?.event?.id}`), `${sent.status} db: ${sentRow}`);
record("AU4", "notice-sent is audited with the Owner", auditSince(a0).some((l) => l === `${OWNER_ID} insert collection_events`), auditSince(a0).join("; "));
const dupSent = await owner.call("POST", "/api/collections/events", { client_id: C1, invoice_id: I1, event_type: "formal_notice_sent", approval_event_id: fnApp.json?.event?.id, detail: { note: "again" } });
record("FN4", "the same notice cannot be recorded twice", dupSent.status === 409 && dupSent.json?.code === "EVENT_CONFLICT", `${dupSent.status} ${dupSent.json?.code} "${dupSent.json?.error}"`);
const evList = await owner.call("GET", `/api/collections/events?client_id=${C1}`);
const holdList = await owner.call("GET", `/api/collections/holds?client_id=${C1}`);
record("RL1", "reload: events and holds persist with invoice_number", evList.json?.events?.some((e) => e.id === sent.json?.event?.id && e.invoice_number === "LOCAL-001") && holdList.json?.holds?.some((h) => h.id === laterHold.json?.hold?.id && h.invoice_number === "LOCAL-001" && !h.released_at), `events=${evList.json?.events?.length} holds=${holdList.json?.holds?.length}`);
a0 = auditMax();
const release = await owner.call("PATCH", "/api/collections/holds", { id: laterHold.json.hold.id });
record("HD3", "Owner releases the hold; audit names the releaser", release.status === 200 && Boolean(release.json?.hold?.released_at) && auditSince(a0).some((l) => l === `${OWNER_ID} update collection_holds`), `${release.status} audit: ${auditSince(a0).join("; ")}`);
const release2 = await owner.call("PATCH", "/api/collections/holds", { id: laterHold.json.hold.id });
record("HD4", "releasing an already released hold returns 409", release2.status === 409 && release2.json?.code === "HOLD_NOT_ACTIVE", `${release2.status} ${release2.json?.code}`);

// ---- Preview: no sending ------------------------------------------------------
const deliveriesBefore = sql("select count(*) from tap_hub_project.collection_delivery_attempts");
const prev = await owner.call("POST", "/api/collections/automation/preview", {});
const deliveriesAfter = sql("select count(*) from tap_hub_project.collection_delivery_attempts");
const settings = sql("select automation_enabled || ' ' || delivery_mode from tap_hub_project.collection_settings");
record("PV1", "preview is side-effect free with automation and delivery off", prev.status === 200 && prev.json.automation_enabled === false && prev.json.delivery_mode === "disabled" && prev.json.actions.every((a) => a.delivery_performed === false) && deliveriesBefore === deliveriesAfter && settings === "false disabled", `${prev.status} actions=${prev.json?.actions?.length} deliveries ${deliveriesBefore}->${deliveriesAfter} settings=${settings}`);

const futureDay = sql("select (tap_hub_project.collections_firm_today() + 2)::text");
const prevFuture = await owner.call("POST", "/api/collections/automation/preview", { as_of_date: futureDay });
const fut2 = prevFuture.json?.actions?.find((a) => a.invoice_id === I2);
record("PV2", "forward-dated preview proposes the next reminder once it is due, still without sending", prevFuture.status === 200 && fut2?.stage === 3 && fut2.action_type === "reminder_candidate" && fut2.delivery_performed === false && sql("select count(*) from tap_hub_project.collection_delivery_attempts") === "0", `${prevFuture.status} as_of=${prevFuture.json?.as_of_date} LOCAL-002 -> ${JSON.stringify(fut2 && { stage: fut2.stage, days: fut2.days_past_due, disposition: fut2.disposition })}`);

// ---- Access matrix -------------------------------------------------------------
const matrix = [
  [admin, "admin", "GET", "/api/collections/receivables", null, 200],
  [admin, "admin", "POST", "/api/collections/automation/preview", {}, 200],
  [staffC, "staff-collections", "GET", "/api/collections/receivables", null, 200],
  [staffC, "staff-collections", "GET", "/api/collections/rules", null, 200],
  [staffC, "staff-collections", "POST", "/api/collections/holds", { client_id: C2, reason: "x" }, 403],
  [staffC, "staff-collections", "POST", "/api/collections/automation/preview", {}, 403],
  [staffC, "staff-collections", "POST", "/api/billing/invoices", { client_id: C2, invoice_number: "X-1", issue_date: "2026-10-01", due_date: "2026-10-31" }, 403],
  [staffB, "staff-billing", "GET", "/api/collections/receivables", null, 200],
  [staffB, "staff-billing", "POST", "/api/collections/events", { client_id: C2, invoice_id: I2, event_type: "note" }, 403],
  [staffB, "staff-billing", "POST", "/api/collections/events/approve", { event_id: esc.json.event.id, event_type: "escalated" }, 403],
  [staffU, "staff-unassigned", "GET", "/api/collections/receivables", null, 403],
  [staffU, "staff-unassigned", "GET", "/api/collections/rules", null, 403],
  [staffU, "staff-unassigned", "GET", "/api/billing/invoices", null, 403],
  [new Session("anon"), "anonymous", "GET", "/api/collections/receivables", null, 401],
];
for (const [session, who, method, path, body, expected] of matrix) {
  const r = await session.call(method, path, body);
  record("AC3", `${who} ${method} ${path} -> ${expected}`, r.status === expected, `${r.status} ${r.json?.code || ""}`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\nSUMMARY: ${results.length - failed.length}/${results.length} passed${failed.length ? `; FAILED: ${failed.map((f) => `${f.id} ${f.name}`).join(" | ")}` : ""}`);
