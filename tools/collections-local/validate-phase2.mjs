// LOCAL ONLY. Phase 2 integrated validation for the tools/collections-local stack:
// real app routes on http://localhost:3000 (npm run dev with the local .env.local)
// backed by the disposable local Supabase, plus database and audit_log evidence.
// Refuses to run unless .env.local points at http://127.0.0.1:55321. Synthetic data only.
//
// Run from the repository root after reset.sh and create-test-users.mjs:
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
    const signIn = await this.call("POST", "/api/auth/sign-in", { identifier: email, password });
    return { signInStatus: signIn.status, signInError: signIn.json?.error, hasSessionCookie: [...this.jar.keys()].some((k) => /^sb-.*-auth-token/.test(k)) };
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
const ADMIN_ID = "00000000-0000-4000-8000-000000000003";

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

const pv = (asOf) => owner.call("POST", "/api/collections/automation/preview", { as_of_date: asOf });

// ---- Receivables, rules, firm date --------------------------------------------
const rules = await owner.call("GET", "/api/collections/rules");
const RULE_KEYS = "automatic,body_template,days_past_due,enabled,label,stage,subject_template";
const SETTING_KEYS = "direct_escalation_threshold,minimum_balance,send_end,send_start,weekdays_only";
record("R1", "rules endpoint returns rules, firm timezone, and guardrails without sender secrets", rules.status === 200 && rules.json.rules.length === 5 && rules.json.rules.every((r) => Object.keys(r).sort().join() === RULE_KEYS) && Object.keys(rules.json).sort().join() === "firm_timezone,rules,settings" && Object.keys(rules.json.settings).sort().join() === SETTING_KEYS && rules.json.firm_timezone === sql("select timezone from tap_hub_project.collection_settings"), `${rules.status} tz=${rules.json?.firm_timezone} ${rules.json?.rules?.map((r) => `${r.stage}:${r.label}@${r.days_past_due}${r.automatic ? "a" : "m"}`).join(" ")} settings=${JSON.stringify(rules.json?.settings)}`);
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

// ---- Primary-contact selection (ambiguous legacy data pauses the client) -----------
const SAM = sql(`select id from tap_hub_project.contacts where client_id = '${C2}' and name = 'Sam Sample'`);
// Simulate pre-existing ambiguous data: a second primary inserted outside the API.
const ALT = sql(`insert into tap_hub_project.contacts(client_id, category, is_primary, name, email) values ('${C2}', 'client', true, 'Alex Harbor', 'alex.harbor@example.invalid') returning id`).split("\n")[0];
const amb = (await pv(firmToday)).json?.actions?.find((a) => a.invoice_id === I2);
record("CT1", "two primary contacts pause the reminder until someone chooses", amb?.disposition === "suppressed" && amb.suppression_reasons.includes("contact_review_required"), JSON.stringify(amb && { stage: amb.stage, disposition: amb.disposition, reasons: amb.suppression_reasons }));
const staffContact = await staffC.call("PATCH", "/api/contacts", { id: SAM, clientId: C2, category: "client", name: "Sam Sample", email: "sam@example.invalid", isPrimary: true });
record("CT2", "Collections staff without client-edit access cannot choose the contact", staffContact.status === 403, `${staffContact.status}`);
let a0 = auditMax();
const choose = await owner.call("PATCH", "/api/contacts", { id: SAM, clientId: C2, category: "client", name: "Sam Sample", email: "sam@example.invalid", isPrimary: true });
const primaries = sql(`select string_agg(name, ',' order by name) from tap_hub_project.contacts where client_id = '${C2}' and category = 'client' and is_primary`);
const contactAudit = sql(`select string_agg(actor || ' ' || entity_id || ' ' || (detail->>'is_primary'), '; ' order by id) from tap_hub_project.audit_log where id > ${a0} and entity = 'contacts' and detail ? 'is_primary'`);
record("CT3", "Owner's choice leaves exactly one remembered primary, audited", choose.status === 200 && choose.json?.contact?.is_primary === true && primaries === "Sam Sample" && contactAudit.includes(`${OWNER_ID} ${ALT} false`) && contactAudit.includes(`${OWNER_ID} ${SAM} true`), `${choose.status} primaries=${primaries} audit: ${contactAudit}`);
const resolved = (await pv(firmToday)).json?.actions?.find((a) => a.invoice_id === I2);
record("CT4", "after the choice, the reminder is no longer paused", resolved?.disposition === "preview_only" && resolved.suppression_reasons.length === 0 && resolved.delivery_performed === false, JSON.stringify(resolved && { stage: resolved.stage, disposition: resolved.disposition }));

// ---- Reminder logging and stage persistence ------------------------------------
a0 = auditMax();
const rem = await staffC.call("POST", "/api/collections/events", { client_id: C2, invoice_id: I2, event_type: "reminder_logged", detail: { note: "Left voicemail" } });
const remStage = sql(`select stage from tap_hub_project.collection_events where id = '${rem.json?.event?.id}'`);
record("CU3", "logged reminder without a stage records the catch-up stage", rem.status === 201 && Number(remStage) === inv2?.next_stage && rem.json.event.invoice_number === "LOCAL-002", `${rem.status} stage(db)=${remStage} invoice_number=${rem.json?.event?.invoice_number}`);
record("AU1", "reminder write is audited with the staff actor", auditSince(a0).some((l) => l.startsWith(`${STAFF_ID} insert collection_events`)), auditSince(a0).join("; "));
const wl1 = await owner.call("GET", "/api/collections/receivables");
const inv2b = invoiceRow(wl1, I2);
record("CU4", "after the reminder, the worklist reloads with no repeat reminder", inv2b?.next_stage !== inv2?.next_stage, `LOCAL-002 next_stage ${inv2?.next_stage} -> ${inv2b?.next_stage} (days=${inv2b?.days_past_due})`);
record("PG1", "server progression: completed and upcoming stage after the catch-up reminder", inv2?.completed_stage === 0 && inv2b?.completed_stage === inv2?.next_stage && inv2b?.upcoming_stage === inv2b.completed_stage + 1 && inv2b?.next_stage === null, `LOCAL-002 completed ${inv2?.completed_stage} -> ${inv2b?.completed_stage}, upcoming=${inv2b?.upcoming_stage}, next=${inv2b?.next_stage}`);

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

const upRule = rules.json.rules.find((r) => r.stage === inv2b?.upcoming_stage);
const futureDay = sql(`select (tap_hub_project.collections_firm_today() + ${Math.max(1, (upRule?.days_past_due ?? 0) - inv2b.days_past_due)})::text`);
const prevFuture = await pv(futureDay);
const fut2 = prevFuture.json?.actions?.find((a) => a.invoice_id === I2);
const expectedType = (stage) => stage <= 3 ? "reminder_candidate" : stage === 4 ? "owner_escalation_review" : "formal_notice_approval_review";
record("PV2", "forward-dated preview proposes the upcoming stage once it is due, still without sending", prevFuture.status === 200 && Boolean(upRule) && fut2?.stage === upRule.stage && fut2.action_type === expectedType(upRule.stage) && fut2.delivery_performed === false && sql("select count(*) from tap_hub_project.collection_delivery_attempts") === "0", `${prevFuture.status} as_of=${prevFuture.json?.as_of_date} LOCAL-002 -> ${JSON.stringify(fut2 && { stage: fut2.stage, days: fut2.days_past_due, action: fut2.action_type, disposition: fut2.disposition })}`);

// ---- An explicit higher reminder logged early (fresh invoice via the Billing API) ---
const due3 = sql("select (tap_hub_project.collections_firm_today() - 2)::text");
const issue3 = sql("select (tap_hub_project.collections_firm_today() - 32)::text");
const draft3 = await owner.call("POST", "/api/billing/invoices", { client_id: C2, invoice_number: "LOCAL-003", issue_date: issue3, due_date: due3 });
const I3 = draft3.json?.invoice?.id;
const line3 = await owner.call("POST", "/api/billing/invoice-lines", { invoice_id: I3, description: "Synthetic advisory hours", quantity: "1", unit_amount: "40.00" });
const issued3 = await owner.call("POST", `/api/billing/invoices/${I3}`, { action: "issue" });
const fresh = invoiceRow(await owner.call("GET", "/api/collections/receivables"), I3);
record("ES0", "a new invoice issued through Billing appears in Collections at 2 days with reminder 1 due", draft3.status === 201 && line3.status === 201 && issued3.status === 200 && fresh?.balance === "40.00" && fresh.days_past_due === 2 && fresh.next_stage === 1, `draft ${draft3.status}, line ${line3.status}, issue ${issued3.status}; LOCAL-003 ${fresh?.balance}@${fresh?.days_past_due} next=${fresh?.next_stage}`);
const stage3 = rules.json.rules.find((r) => r.stage === 3);
const early = await owner.call("POST", "/api/collections/events", { client_id: C2, invoice_id: I3, event_type: "reminder_logged", stage: 3, detail: { note: "Sent the firm reminder early" } });
const earlyStage = sql(`select stage from tap_hub_project.collection_events where id = '${early.json?.event?.id}'`);
record("ES1", "Owner logs reminder 3 before it is due", early.status === 201 && earlyStage === "3" && fresh.days_past_due < stage3.days_past_due, `${early.status} stage(db)=${earlyStage} days=${fresh?.days_past_due} < ${stage3.days_past_due}`);
const afterEarly = invoiceRow(await owner.call("GET", "/api/collections/receivables"), I3);
record("ES2", "worklist counts the early stage as done and points to the next gate", afterEarly?.completed_stage === 3 && afterEarly.upcoming_stage === 4 && afterEarly.next_stage === null, `completed=${afterEarly?.completed_stage} upcoming=${afterEarly?.upcoming_stage} next=${afterEarly?.next_stage}`);
const day15 = sql(`select (tap_hub_project.collections_firm_today() + ${stage3.days_past_due - 2})::text`);
const noRepeat = (await pv(day15)).json?.actions?.find((a) => a.invoice_id === I3);
record("ES3", "when reminder 3 would normally fall due, the preview does not propose it again", !noRepeat || noRepeat.stage > 3, JSON.stringify(noRepeat && { stage: noRepeat.stage }) || "no action");

// ---- Owner/Admin rule configuration --------------------------------------------------
const original = rules.json;
const restoreBody = { rules: original.rules.map(({ stage, label, days_past_due, automatic, enabled, subject_template, body_template }) => ({ stage, label, days_past_due, automatic, enabled, subject_template, body_template })), settings: { timezone: original.firm_timezone, minimum_balance: Number(original.settings.minimum_balance), direct_escalation_threshold: Number(original.settings.direct_escalation_threshold), send_start: original.settings.send_start, send_end: original.settings.send_end, weekdays_only: original.settings.weekdays_only } };
const autoGate = await owner.call("PATCH", "/api/collections/rules", { rules: [{ stage: 4, automatic: true }] });
record("CF1", "approval stages 4 and 5 cannot be made automatic", autoGate.status === 422 && autoGate.json?.code === "INVALID_CONFIGURATION" && sql("select automatic from tap_hub_project.collection_ladder_rules where stage = 4") === "f", `${autoGate.status} ${autoGate.json?.code}`);
const badTz = await owner.call("PATCH", "/api/collections/rules", { settings: { timezone: "Mars/Olympus_Mons" } });
const senderField = await owner.call("PATCH", "/api/collections/rules", { settings: { sender_email: "x@example.invalid" } });
record("CF2", "invalid timezone and sender fields are refused", badTz.status === 422 && senderField.status === 422 && sql("select timezone from tap_hub_project.collection_settings") === original.firm_timezone, `timezone ${badTz.status} ${badTz.json?.code}; sender ${senderField.status} ${senderField.json?.code}`);
a0 = auditMax();
const adminSave = await admin.call("PATCH", "/api/collections/rules", { rules: [{ stage: 2, label: "Gentle nudge" }], settings: { minimum_balance: 60, timezone: "America/Los_Angeles" } });
const cfgAudit = auditSince(a0);
record("CF3", "Admin edits a label, a guardrail, and the timezone; saved and audited", adminSave.status === 200 && adminSave.json.rules.find((r) => r.stage === 2)?.label === "Gentle nudge" && Number(adminSave.json.settings.minimum_balance) === 60 && adminSave.json.firm_timezone === "America/Los_Angeles" && sql("select label from tap_hub_project.collection_ladder_rules where stage = 2") === "Gentle nudge" && cfgAudit.includes(`${ADMIN_ID} update collection_ladder_rules`) && cfgAudit.includes(`${ADMIN_ID} update collection_settings`), `${adminSave.status} audit: ${cfgAudit.join("; ")}`);
const staffSees = await staffC.call("GET", "/api/collections/rules");
record("CF4", "staff see the updated labels and firm timezone", staffSees.status === 200 && staffSees.json.firm_timezone === "America/Los_Angeles" && staffSees.json.rules.find((r) => r.stage === 2)?.label === "Gentle nudge", `${staffSees.status} tz=${staffSees.json?.firm_timezone}`);
await owner.call("PATCH", "/api/collections/rules", { settings: { direct_escalation_threshold: 50 } });
const direct = (await pv(firmToday)).json?.actions?.find((a) => a.invoice_id === I2);
record("CF5", "balance above the direct-escalation threshold proposes Owner/Admin review, not sending", direct?.stage === 4 && direct.action_type === "owner_escalation_review" && direct.disposition === "approval_required" && direct.delivery_performed === false, JSON.stringify(direct && { stage: direct.stage, action: direct.action_type, disposition: direct.disposition }));
const restored = await owner.call("PATCH", "/api/collections/rules", restoreBody);
record("CF6", "restoring the original rules round-trips exactly", restored.status === 200 && JSON.stringify(restored.json) === JSON.stringify(original), `${restored.status}`);
record("PV3", "still no delivery attempts and automation still off", sql("select count(*) from tap_hub_project.collection_delivery_attempts") === "0" && sql("select automation_enabled || ' ' || delivery_mode from tap_hub_project.collection_settings") === "false disabled", "deliveries=0");

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
  [staffC, "staff-collections", "PATCH", "/api/collections/rules", { rules: [{ stage: 2, label: "x" }] }, 403],
  [staffB, "staff-billing", "PATCH", "/api/collections/rules", { rules: [{ stage: 2, label: "x" }] }, 403],
  [staffU, "staff-unassigned", "PATCH", "/api/collections/rules", { rules: [{ stage: 2, label: "x" }] }, 403],
  [new Session("anon"), "anonymous", "GET", "/api/collections/receivables", null, 401],
  [new Session("anon"), "anonymous", "PATCH", "/api/collections/rules", { rules: [{ stage: 2, label: "x" }] }, 401],
];
for (const [session, who, method, path, body, expected] of matrix) {
  const r = await session.call(method, path, body);
  record("AC3", `${who} ${method} ${path} -> ${expected}`, r.status === expected, `${r.status} ${r.json?.code || ""}`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\nSUMMARY: ${results.length - failed.length}/${results.length} passed${failed.length ? `; FAILED: ${failed.map((f) => `${f.id} ${f.name}`).join(" | ")}` : ""}`);
