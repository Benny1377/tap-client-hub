// LOCAL ONLY. Authenticated-HTTP matrix for Billing Phase 2 on the disposable local harness.
// Signs in through POST /api/auth/sign-in as Owner, Admin, Billing, Collections and unassigned staff
// and calls the real /api/billing/* routes of the running app. Operations facts (services, work periods,
// counts) are synthetic rows created through psql because no Operations API exists for them; no report,
// ledger or Billing row is inserted directly. Never prints credentials.
//
// Setup (repo root, branch carrying the Phase 2 migration):
//   1. bash tools/collections-local/reset.sh --local
//   2. node tools/collections-local/create-test-users.mjs   (writes TEST_* credentials to the ignored .env.local)
//   3. npm run dev
//   4. node tools/collections-local/verify-billing-phase2-routes.mjs
// Cleanup: every run adds synthetic P2<tag> services, rate cards, candidates, invoices, a client terms override and a
// payment, and restores the Billing action policy to its staff defaults. Run it once per reset: it refuses a database
// that already holds a Phase 2 run. Run reset.sh --local and create-test-users.mjs again for a clean database.
// Optional env: BILLING_VERIFY_BASE_URL (default http://localhost:3000), BILLING_VERIFY_API_URL (default
// http://127.0.0.1:55321), BILLING_VERIFY_DB_URL (default postgresql://postgres:postgres@127.0.0.1:55322/postgres),
// BILLING_VERIFY_PSQL (default psql).
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const BASE = process.env.BILLING_VERIFY_BASE_URL || "http://localhost:3000";
const API = process.env.BILLING_VERIFY_API_URL || "http://127.0.0.1:55321";
const DB = process.env.BILLING_VERIFY_DB_URL || "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
const PSQL = process.env.BILLING_VERIFY_PSQL || "psql";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const loopback = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;
if (!loopback.test(API) || !loopback.test(BASE) || !/^postgresql:\/\/[^@]*@(127\.0\.0\.1|localhost)[:/]/.test(DB) || env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") !== API) throw new Error("Refusing: not the local harness");

const sqlThrow = (q) => execFileSync(PSQL, [DB, "-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-c", q], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).replace(/\r/g, "").trim();
// Verification reads never abort the run: a failed query shows up as ERR in the evidence of the check that used it.
const sql = (q) => { try { return sqlThrow(q); } catch { return "ERR"; } };

class Session {
  constructor() { this.jar = new Map(); }
  async call(method, path, body, raw = false) {
    const res = await fetch(BASE + path, { method, redirect: "manual", headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(this.jar.size ? { Cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}) }, body: body !== undefined ? (raw ? body : JSON.stringify(body)) : undefined });
    for (const c of res.headers.getSetCookie?.() || []) { const [pair] = c.split(";"); const n = pair.slice(0, pair.indexOf("=")); const v = pair.slice(pair.indexOf("=") + 1); if (/max-age=0/i.test(c) || v === "") this.jar.delete(n); else this.jar.set(n, v); }
    const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, code: json?.code, text };
  }
  async signIn(name) { const r = await this.call("POST", "/api/auth/sign-in", { identifier: env[`TEST_${name}_EMAIL`], password: env[`TEST_${name}_PASSWORD`] }); if (r.status !== 200) throw new Error(`sign-in ${name} ${r.status}`); return this; }
}

const results = [];
const rec = (id, name, ok, ev = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${name} :: ${String(ev).slice(0, 200)}`); };
const info = (id, name, ev) => console.log(`INFO ${id} ${name} :: ${String(ev).slice(0, 200)}`);
const DEC = /^-?\d+\.\d{2}$/;
const tag = Date.now().toString(36).toUpperCase();
const C1 = "10000000-0000-4000-8000-000000000001";
const OWNER_ID = "00000000-0000-4000-8000-000000000001";
const BILLING_ID = "00000000-0000-4000-8000-000000000004";
const firmDate = (d = new Date()) => { const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(d); return p; };
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mkService = (suffix, frequency) => sqlThrow(`with s as (insert into tap_hub_project.services(code,name,tracking) values('P2${tag}-${suffix}','Synthetic ${suffix} ${tag}','manual') returning id), c as (insert into tap_hub_project.client_services(client_id,service_id,active,frequency,financials_month) select '${C1}', id, true, ${frequency ? `'${frequency}'` : "null"}, null from s returning id) select id from c`);
const serviceCode = (suffix) => `P2${tag}-${suffix}`;

if (sql(`select count(*) from tap_hub_project.billing_terms_overrides where client_id='${C1}'`) !== "0") throw new Error("This database already holds a Phase 2 run (client terms overrides exist). Run: bash tools/collections-local/reset.sh --local, then create-test-users.mjs");

const anon = new Session();
const owner = await new Session().signIn("OWNER");
const admin = await new Session().signIn("ADMIN");
const billing = await new Session().signIn("STAFF_BILLING");
const colls = await new Session().signIn("STAFF_COLLECTIONS");
const unassigned = await new Session().signIn("STAFF_UNASSIGNED");

// ---- Operations fixtures (synthetic, via psql) --------------------------------------------------------
const cs = { rec: mkService("REC", "monthly"), unp: mkService("UNP", "monthly"), wp: mkService("WP", null), cnt: mkService("CNT", null), man: mkService("MAN", null), none: mkService("NOMAP", "monthly"), b1: mkService("B1", "monthly"), b2: mkService("B2", "monthly") };
sqlThrow(`insert into tap_hub_project.work_periods(client_service_id,period,stage,done_at) values('${cs.wp}','2026-10','done','2026-10-20 15:00:00+00')`);
sqlThrow(`insert into tap_hub_project.period_counts(client_service_id,period,processed,expected) values('${cs.cnt}','2026-10',3,3)`);

// ---- A. Access and permissions -------------------------------------------------------------------------
const gets = ["/permissions", "/rate-cards", "/candidates", "/candidates/schedule?from=2026-11-01&to=2026-11-30&clientId=" + C1, "/completion-source-maps", "/settings/terms", "/settings/remittance", "/bundles", "/client-pricing?clientId=" + C1];
let bad = [];
for (const p of gets) { const r = await anon.call("GET", "/api/billing" + p); if (r.status !== 401) bad.push(`${p}=${r.status}`); }
rec("A1", "anonymous gets 401 on every Phase 2 read", !bad.length, bad.join(" ") || `${gets.length} paths`);
const anonW = [["POST", "/candidates/generate", { from: "2026-11-01", to: "2026-11-30", clientId: C1 }], ["POST", "/rate-cards", { name: "x", effectiveFrom: "2026-11-01" }], ["PATCH", "/permissions/policy", { policies: [], reason: "x" }], ["POST", "/candidates/manual-confirmations", {}], ["POST", "/invoices/from-candidates", { candidateIds: [randomUUID()] }]];
bad = []; for (const [m, p, b] of anonW) { const r = await anon.call(m, "/api/billing" + p, b); if (r.status !== 401) bad.push(`${m} ${p}=${r.status}`); }
rec("A2", "anonymous gets 401 on Phase 2 writes", !bad.length, bad.join(" "));
for (const [who, s] of [["Collections-only", colls], ["unassigned", unassigned]]) {
  bad = []; for (const p of gets) { const r = await s.call("GET", "/api/billing" + p); if (r.status !== 403) bad.push(`${p}=${r.status}`); }
  rec(`A3-${who}`, `${who} staff get 403 (no redacted body) on every Phase 2 read incl. /permissions`, !bad.length, bad.join(" ") || `${gets.length} paths`);
  bad = []; for (const [m, p, b] of anonW) { const r = await s.call(m, "/api/billing" + p, b); if (r.status !== 403) bad.push(`${m} ${p}=${r.status}`); }
  rec(`A4-${who}`, `${who} staff get 403 on Phase 2 writes`, !bad.length, bad.join(" "));
}
const ALL14 = ["billing.view", "pricing.view", "pricing.manage", "candidates.view", "candidates.manage", "invoices.draft.manage", "invoices.issue", "invoices.void", "payments.record", "payments.allocate", "payments.reverse", "settings.terms.manage", "settings.remittance.manage", "policy.manage"];
for (const [who, s] of [["Owner", owner], ["Admin", admin]]) { const r = await s.call("GET", "/api/billing/permissions"); rec(`A5-${who}`, `${who} resolves all 14 fixed actions`, r.status === 200 && JSON.stringify([...r.json.actions].sort()) === JSON.stringify([...ALL14].sort()), `status ${r.status} actions=${r.json?.actions?.length}`); }
const STAFF8 = ["billing.view", "pricing.view", "candidates.view", "candidates.manage", "invoices.draft.manage", "invoices.issue", "payments.record", "payments.allocate"];
const bp = await billing.call("GET", "/api/billing/permissions");
rec("A6", "Billing staff default to the 8 contract actions; no pricing.manage, settings, void, reverse or policy", bp.status === 200 && JSON.stringify([...bp.json.actions].sort()) === JSON.stringify([...STAFF8].sort()) && bp.json.role === "staff" && bp.json.modules.map((m) => m.toLowerCase()).includes("billing"), `status ${bp.status} ${JSON.stringify(bp.json?.actions)}`);
const bw = [["POST", "/rate-cards", { name: "x", effectiveFrom: "2026-11-01", reason: "x" }], ["PATCH", "/settings/terms", { defaultNetDays: 15, billingDay: "service_period_end", reason: "x" }], ["PATCH", "/settings/remittance", { payeeName: "x", reason: "x" }], ["PATCH", "/permissions/policy", { policies: [{ actionKey: "pricing.manage", allowedRoles: ["staff"], enabled: true }], reason: "x" }], ["POST", "/client-pricing/overrides", { clientServiceId: cs.rec, unitAmount: "1.00", effectiveFrom: "2026-11-01", reason: "x" }]];
bad = []; for (const [m, p, b] of bw) { const r = await billing.call(m, "/api/billing" + p, b); if (r.status !== 403) bad.push(`${m} ${p}=${r.status}`); }
rec("A7", "Billing staff cannot manage pricing, terms, remittance or policy (403)", !bad.length, bad.join(" "));
const bdr = await billing.call("GET", "/api/billing/rate-cards?limit=5");
rec("A8", "Billing staff can read pricing (pricing.view)", bdr.status === 200 && Array.isArray(bdr.json?.items), `status ${bdr.status}`);

// ---- B. Pricing, terms and remittance mutations --------------------------------------------------------
let rc = await owner.call("POST", "/api/billing/rate-cards", { name: `P2 ${tag} Standard`, currency: "USD", effectiveFrom: "2026-01-01", reason: "Initial rate card setup" });
const rcLiteral = rc.status;
rec("B1", "POST /rate-cards with the contract's literal example body (includes reason, b630f2a) returns 201", rc.status === 201, `status ${rc.status} ${rc.code || ""}`);
const rcNoReason = await owner.call("POST", "/api/billing/rate-cards", { name: `P2 ${tag} NoReason`, currency: "USD", effectiveFrom: "2030-01-01" });
rec("B1b", "POST /rate-cards without a reason is 422 INVALID_INPUT", rcNoReason.status === 422 && rcNoReason.code === "INVALID_INPUT", `status ${rcNoReason.status} ${rcNoReason.code || ""}`);
const rateCardId = rc.json?.rateCard?.id;
rec("B2", "rate card created with camelCase shape", rc.status === 201 && !!rateCardId && rc.json.rateCard.effectiveFrom === "2026-01-01" && rc.json.rateCard.active === true, `status ${rc.status} (first attempt ${rcLiteral})`);
let ent = await owner.call("POST", `/api/billing/rate-cards/${rateCardId}/entries`, { serviceCode: serviceCode("REC"), unit: "service", unitAmount: "125.00", effectiveFrom: "2026-01-01", reason: "Initial rate entry" });
const entLiteral = ent.status;
rec("B3", "POST entries with the contract's literal example body (includes reason, b630f2a) returns 201", ent.status === 201, `status ${ent.status} ${ent.code || ""}`);
const entryId = ent.json?.entry?.id;
rec("B4", "entry unitAmount is a decimal string", ent.status === 201 && ent.json.entry.unitAmount === "125.00", `status ${ent.status} amount ${ent.json?.entry?.unitAmount} (first attempt ${entLiteral})`);
const ov = await owner.call("POST", `/api/billing/rate-cards/${rateCardId}/entries`, { serviceCode: serviceCode("REC"), unit: "service", unitAmount: "99.00", effectiveFrom: "2026-06-01", reason: "overlap" });
rec("B5", "overlapping rate entry is 409 EFFECTIVE_DATE_OVERLAP", ov.status === 409 && ov.code === "EFFECTIVE_DATE_OVERLAP", `${ov.status} ${ov.code}`);
const badMoney = await owner.call("POST", `/api/billing/rate-cards/${rateCardId}/entries`, { serviceCode: "X", unit: "service", unitAmount: "12.345", effectiveFrom: "2026-01-01", reason: "x" });
rec("B6", "money with three decimals is 422 INVALID_INPUT", badMoney.status === 422 && badMoney.code === "INVALID_INPUT", `${badMoney.status} ${badMoney.code}`);
const noReason = await owner.call("PATCH", `/api/billing/rate-cards/${rateCardId}/entries/${entryId}`, { unitAmount: "130.00" });
rec("B7", "PATCH without a reason is 422", noReason.status === 422, `${noReason.status} ${noReason.code}`);
const pe = await owner.call("PATCH", `/api/billing/rate-cards/${rateCardId}/entries/${entryId}`, { unitAmount: "125.00", reason: "Synthetic no-op" });
rec("B8", "PATCH entry returns decimal string", pe.status === 200 && pe.json?.entry?.unitAmount === "125.00", `${pe.status} ${pe.json?.entry?.unitAmount}`);
const rcGet = await billing.call("GET", `/api/billing/rate-cards/${rateCardId}`);
rec("B9", "GET rate card returns entries with decimal strings", rcGet.status === 200 && rcGet.json.entries.length === 1 && DEC.test(rcGet.json.entries[0].unitAmount), `${rcGet.status}`);
for (const n of ["B", "C"]) await owner.call("POST", "/api/billing/rate-cards", { name: `P2 ${tag} ${n}`, effectiveFrom: "2026-01-01", reason: "paging" });
const pg1 = await owner.call("GET", "/api/billing/rate-cards?limit=2");
const pg2 = pg1.json?.nextCursor ? await owner.call("GET", `/api/billing/rate-cards?limit=2&cursor=${encodeURIComponent(pg1.json.nextCursor)}`) : null;
rec("B10", "rate-card paging: limit 2 returns a cursor and the next page has different rows", pg1.status === 200 && pg1.json.items.length === 2 && typeof pg1.json.nextCursor === "string" && pg2?.status === 200 && pg2.json.items.every((i) => !pg1.json.items.some((j) => j.id === i.id)), `p1 ${pg1.json?.items?.length} cursor=${!!pg1.json?.nextCursor} p2 ${pg2?.json?.items?.length}`);
const badCur = await owner.call("GET", "/api/billing/rate-cards?cursor=not-a-cursor");
const badLim = await owner.call("GET", "/api/billing/rate-cards?limit=0");
const wrongCur = await owner.call("GET", "/api/billing/candidates?cursor=" + Buffer.from(JSON.stringify({ name: "x", id: "y" })).toString("base64url"));
rec("B11", "malformed cursor and wrong-shape cursor are 422 INVALID_CURSOR; limit 0 is 422", badCur.code === "INVALID_CURSOR" && badCur.status === 422 && wrongCur.code === "INVALID_CURSOR" && badLim.status === 422, `${badCur.status}/${wrongCur.status}/${badLim.status}`);
const ovr = await owner.call("POST", "/api/billing/client-pricing/overrides", { clientServiceId: cs.none, unitAmount: "115.00", effectiveFrom: "2026-01-01", reason: "Synthetic override" });
const ovrId = ovr.json?.override?.id;
const ovrP = ovrId ? await owner.call("PATCH", `/api/billing/client-pricing/overrides/${ovrId}`, { unitAmount: "120.00", reason: "Synthetic renewal" }) : null;
const cp = await billing.call("GET", `/api/billing/client-pricing?clientId=${C1}`);
rec("B12", "client override create/patch and client-pricing read use decimal strings", ovr.status === 201 && ovr.json.override.unitAmount === "115.00" && ovrP?.json?.override?.unitAmount === "120.00" && cp.status === 200 && cp.json.overrides.some((o) => o.id === ovrId && o.unitAmount === "120.00"), `${ovr.status}/${ovrP?.status}/${cp.status}`);
const bundle = await owner.call("POST", "/api/billing/bundles", { name: `P2 ${tag} Package`, clientId: C1, unitAmount: "300.00", effectiveFrom: "2026-01-01", reason: "Synthetic package" });
const bundleId = bundle.json?.bundle?.id;
const comps = bundleId ? await owner.call("PUT", `/api/billing/bundles/${bundleId}/components`, { components: [{ clientServiceId: cs.b1 }, { clientServiceId: cs.b2 }], reason: "Synthetic components" }) : null;
const bget = bundleId ? await billing.call("GET", `/api/billing/bundles/${bundleId}`) : null;
rec("B13", "bundle create, components PUT and read", bundle.status === 201 && bundle.json.bundle.unitAmount === "300.00" && comps?.status === 200 && bget?.json?.bundle?.components?.length === 2, `${bundle.status}/${comps?.status}/${bget?.status}`);
const overlapB = await owner.call("POST", "/api/billing/bundles", { name: `P2 ${tag} Package`, clientId: C1, unitAmount: "310.00", effectiveFrom: "2026-03-01", reason: "overlap" });
rec("B14", "overlapping bundle is 409 EFFECTIVE_DATE_OVERLAP", overlapB.status === 409 && overlapB.code === "EFFECTIVE_DATE_OVERLAP", `${overlapB.status} ${overlapB.code}`);
const t0 = await billing.call("GET", "/api/billing/settings/terms");
rec("B15", "terms read: Net 15, service_period_end, America/Chicago", t0.status === 200 && t0.json.defaultNetDays === 15 && t0.json.billingDay === "service_period_end" && t0.json.timezone === "America/Chicago" && Array.isArray(t0.json.overrides), `${t0.status} ${JSON.stringify(t0.json)?.slice(0, 120)}`);
const tBad = await owner.call("PATCH", "/api/billing/settings/terms", { defaultNetDays: 15, billingDay: "month_end", reason: "x" });
rec("B16", "unsupported billingDay is 422", tBad.status === 422, `${tBad.status}`);
const rem = await owner.call("PATCH", "/api/billing/settings/remittance", { payeeName: "TAP Test LLC", address: "1 Synthetic Way", instructions: "Include invoice number", reason: "Synthetic remittance" });
const remGet = await billing.call("GET", "/api/billing/settings/remittance");
rec("B17", "remittance PATCH and GET return {remittance, updatedAt}", rem.status === 200 && rem.json.remittance.payeeName === "TAP Test LLC" && !!rem.json.updatedAt && remGet.status === 200 && remGet.json.remittance.instructions === "Include invoice number", `${rem.status}/${remGet.status}`);

// ---- C. Completion-source maps, generation, candidates -------------------------------------------------
const mapBody = (csId, extra = {}) => ({ clientServiceId: csId, adapter: "schedule", predicate: {}, identityFields: ["client_service_id", "period"], candidateDateRule: "period_end", effectiveFrom: "2026-01-01", reason: "Synthetic map", ...extra });
const g0 = await billing.call("POST", "/api/billing/candidates/generate", { clientServiceIds: [cs.none], from: "2026-11-01", to: "2026-11-30" });
rec("C1", "unmapped service is skipped as no_map and creates nothing", g0.status === 200 && g0.json.created === 0 && g0.json.skippedByReason?.no_map === 1 && g0.json.skipped === 1, JSON.stringify(g0.json));
const mBad = await owner.call("POST", "/api/billing/completion-source-maps", mapBody(cs.rec, { adapter: "arbitrary_sql", predicate: { q: "select 1" } }));
rec("C2", "invalid adapter is 422 INVALID_COMPLETION_SOURCE_MAP", mBad.status === 422 && mBad.code === "INVALID_COMPLETION_SOURCE_MAP", `${mBad.status} ${mBad.code}`);
const mBill = await billing.call("POST", "/api/billing/completion-source-maps", mapBody(cs.rec));
rec("C3", "Billing staff may configure maps via candidates.manage (201)", mBill.status === 201 && mBill.json?.map?.adapter === "schedule", `${mBill.status} ${mBill.code || ""}`);
for (const k of ["unp", "b1", "b2"]) await owner.call("POST", "/api/billing/completion-source-maps", mapBody(cs[k]));
const mOverlap = await owner.call("POST", "/api/billing/completion-source-maps", mapBody(cs.rec, { effectiveFrom: "2026-06-01" }));
rec("C4", "overlapping map for one client service is 409 EFFECTIVE_DATE_OVERLAP", mOverlap.status === 409 && mOverlap.code === "EFFECTIVE_DATE_OVERLAP", `${mOverlap.status} ${mOverlap.code}`);
const win = { from: "2026-11-01", to: "2026-11-30" };
const sched = await billing.call("GET", `/api/billing/candidates/schedule?from=${win.from}&to=${win.to}&clientId=${C1}`);
const beforeCount = sql(`select count(*) from tap_hub_project.billing_candidates where client_service_id in ('${cs.rec}','${cs.unp}')`);
rec("C5", "schedule projection is marked projected, has decimal strings and persists nothing", sched.status === 200 && sched.json.projection === "projected" && sched.json.items.some((i) => i.clientServiceId === cs.rec && i.unitAmount === "125.00") && beforeCount === "0", `${sched.status} items=${sched.json?.items?.length} persisted=${beforeCount}`);
const gen = await billing.call("POST", "/api/billing/candidates/generate", { clientServiceIds: [cs.rec, cs.unp], ...win });
rec("C6", "generate: 1 priced + 1 unpriced candidate, both counted as created; unpriced counted separately", gen.status === 200 && gen.json.created === 2 && gen.json.unpriced === 1 && gen.json.existing === 0 && gen.json.candidateIds.length === 2, JSON.stringify(gen.json));
const gen2 = await billing.call("POST", "/api/billing/candidates/generate", { clientServiceIds: [cs.rec, cs.unp], ...win });
rec("C7", "re-running generation is idempotent (created 0, existing 2, same identities)", gen2.status === 200 && gen2.json.created === 0 && gen2.json.existing === 2 && sql(`select count(*) from tap_hub_project.billing_candidates where client_service_id in ('${cs.rec}','${cs.unp}')`) === "2", JSON.stringify(gen2.json));
const gBad = await billing.call("POST", "/api/billing/candidates/generate", { clientServiceIds: [cs.rec], from: "2026-01-01", to: "2027-06-30" });
const gBad2 = await billing.call("POST", "/api/billing/candidates/generate", { clientServiceIds: [cs.rec], from: "2026-02-30", to: "2026-03-01" });
rec("C8", "window over 365 days and an impossible date are 422 GENERATION_WINDOW_INVALID", gBad.code === "GENERATION_WINDOW_INVALID" && gBad.status === 422 && gBad2.code === "GENERATION_WINDOW_INVALID", `${gBad.status}/${gBad2.status}`);
const list = await billing.call("GET", `/api/billing/candidates?clientId=${C1}&from=${win.from}&to=${win.to}&limit=1`);
const list2 = list.json?.nextCursor ? await billing.call("GET", `/api/billing/candidates?clientId=${C1}&from=${win.from}&to=${win.to}&limit=1&cursor=${encodeURIComponent(list.json.nextCursor)}`) : null;
const recCand = (await billing.call("GET", `/api/billing/candidates?clientId=${C1}&state=open&from=${win.from}&to=${win.to}&limit=100`)).json?.items?.find((i) => i.clientServiceId === cs.rec);
const unpCand = (await billing.call("GET", `/api/billing/candidates?clientId=${C1}&state=unpriced&limit=100`)).json?.items?.find((i) => i.clientServiceId === cs.unp);
rec("C9", "candidate list: camelCase, decimal strings, source object, cursor paging", list.status === 200 && list.json.items.length === 1 && typeof list.json.nextCursor === "string" && list2?.json?.items?.length === 1 && list2.json.items[0].id !== list.json.items[0].id && recCand?.unitAmount === "125.00" && recCand.state === "open" && recCand.candidateDate === "2026-11-30" && recCand.source?.adapter === "schedule" && unpCand?.unitAmount == null, `${list.status} rec=${recCand?.unitAmount} unp=${unpCand?.state}`);
const draftUnp = unpCand ? await billing.call("POST", "/api/billing/invoices/from-candidates", { candidateIds: [unpCand.id] }) : null;
rec("C10", "an unpriced candidate cannot become a draft (409 CANDIDATE_UNPRICED)", draftUnp?.status === 409 && draftUnp.code === "CANDIDATE_UNPRICED", `${draftUnp?.status} ${draftUnp?.code}`);
const d0 = await billing.call("POST", `/api/billing/candidates/${unpCand?.id}/dismiss`, { reason: "  " });
rec("C11", "dismiss without a reason is 422 CANDIDATE_DISMISS_REASON_REQUIRED", d0.status === 422 && d0.code === "CANDIDATE_DISMISS_REASON_REQUIRED", `${d0.status} ${d0.code}`);
const d1 = await billing.call("POST", `/api/billing/candidates/${unpCand?.id}/dismiss`, { reason: "Synthetic hold" });
rec("C12", "dismiss returns state dismissed and an audit id", d1.status === 200 && d1.json.candidate.state === "dismissed" && d1.json.auditId != null, `${d1.status} audit=${d1.json?.auditId}`);
const d2 = await billing.call("POST", `/api/billing/candidates/${unpCand?.id}/dismiss`, { reason: "again" });
rec("C13", "dismissing a dismissed candidate is 409 CANDIDATE_NOT_OPEN", d2.status === 409 && d2.code === "CANDIDATE_NOT_OPEN", `${d2.status} ${d2.code}`);
const r0 = await billing.call("POST", `/api/billing/candidates/${unpCand?.id}/reopen`, { reason: "" });
rec("C14", "reopen without a reason is 422 CANDIDATE_REOPEN_REASON_REQUIRED", r0.status === 422 && r0.code === "CANDIDATE_REOPEN_REASON_REQUIRED", `${r0.status} ${r0.code}`);
const r1 = await billing.call("POST", `/api/billing/candidates/${unpCand?.id}/reopen`, { reason: "Hold resolved" });
rec("C15", "reopen of an unpriced candidate returns it to unpriced with an audit id", r1.status === 200 && r1.json.candidate.state === "unpriced" && r1.json.auditId != null, `${r1.status} ${r1.json?.candidate?.state}`);
const rp0 = await billing.call("POST", `/api/billing/candidates/${unpCand?.id}/reprice`, { reason: "Rate correction" });
rec("C16", "reprice with no price available is 409 CANDIDATE_UNPRICED", rp0.status === 409 && rp0.code === "CANDIDATE_UNPRICED", `${rp0.status} ${rp0.code}`);
await owner.call("POST", `/api/billing/rate-cards/${rateCardId}/entries`, { serviceCode: serviceCode("UNP"), unit: "service", unitAmount: "120.00", effectiveFrom: "2026-01-01", reason: "Synthetic: price the candidate" });
const rp1 = await billing.call("POST", `/api/billing/candidates/${unpCand?.id}/reprice`, { reason: "Rate correction" });
rec("C17", "reprice after a price exists opens the candidate at the new decimal price", rp1.status === 200 && rp1.json.candidate.state === "open" && rp1.json.candidate.unitAmount === "120.00", `${rp1.status} ${rp1.json?.candidate?.unitAmount}`);
// One-off adapters against the synthetic Operations facts: work_periods use the stored 'YYYY-MM' text periods.
const wpMap = await owner.call("POST", "/api/billing/completion-source-maps", mapBody(cs.wp, { adapter: "work_period_done", predicate: { stage: "done" } }));
const wpGen = await billing.call("POST", "/api/billing/candidates/generate", { clientServiceIds: [cs.wp], from: "2026-10-01", to: "2026-10-31" });
rec("C18", "work_period_done adapter creates a candidate for a done 2026-10 work period (period stored as text YYYY-MM)", wpMap.status === 201 && wpGen.status === 200 && wpGen.json.created === 1, `map ${wpMap.status} ${JSON.stringify(wpGen.json)}`);
const cMap = await owner.call("POST", "/api/billing/completion-source-maps", mapBody(cs.cnt, { adapter: "period_count_threshold", predicate: { threshold: 2 } }));
const cGen = await billing.call("POST", "/api/billing/candidates/generate", { clientServiceIds: [cs.cnt], from: "2026-10-01", to: "2026-10-31" });
rec("C19", "period_count_threshold adapter creates a candidate when processed (3) meets the threshold (2) for 2026-10", cMap.status === 201 && cGen.status === 200 && cGen.json.created === 1, `map ${cMap.status} ${JSON.stringify(cGen.json)}`);

// ---- D. Manual confirmation ----------------------------------------------------------------------------
const mc = (extra = {}) => ({ idempotencyKey: randomUUID(), clientServiceId: cs.man, confirmedDate: "2026-11-03", sourceNote: "Synthetic confirmation note", reason: "Synthetic reason", ...extra });
const manMap = await owner.call("POST", "/api/billing/completion-source-maps", mapBody(cs.man, { adapter: "manual_confirmation", identityFields: ["confirmation_id"], candidateDateRule: "confirmed_date" }));
const m1 = await billing.call("POST", "/api/billing/candidates/manual-confirmations", mc({ clientServiceId: cs.none }));
rec("D1", "manual confirmation without a covering map is 409 COMPLETION_SOURCE_MAP_REQUIRED", m1.status === 409 && m1.code === "COMPLETION_SOURCE_MAP_REQUIRED", `${m1.status} ${m1.code}`);
const m2 = await billing.call("POST", "/api/billing/candidates/manual-confirmations", mc({ sourceNote: "" }));
const m2b = await billing.call("POST", "/api/billing/candidates/manual-confirmations", mc({ idempotencyKey: "not-a-uuid" }));
const m2c = await billing.call("POST", "/api/billing/candidates/manual-confirmations", mc({ confirmedDate: "2026-02-30" }));
rec("D2", "missing note, non-UUID key and impossible date are each 422", m2.status === 422 && m2b.status === 422 && m2c.status === 422, `${m2.status}/${m2b.status}/${m2c.status}`);
const key = randomUUID();
const m3 = await billing.call("POST", "/api/billing/candidates/manual-confirmations", mc({ idempotencyKey: key }));
rec("D3", "manual confirmation creates a candidate (201, created true, source manual_confirmation, refresh targets)", manMap.status === 201 && m3.status === 201 && m3.json.created === true && m3.json.candidate.source?.adapter === "manual_confirmation" && m3.json.candidate.candidateDate === "2026-11-03" && JSON.stringify(m3.json.refresh) === JSON.stringify(["candidates", "receivables"]), `map ${manMap.status} ${m3.status} ${JSON.stringify(m3.json?.candidate?.state)}`);
const m4 = await billing.call("POST", "/api/billing/candidates/manual-confirmations", mc({ idempotencyKey: key }));
rec("D4", "same key and body replays as 200 created:false with the same candidate", m4.status === 200 && m4.json.created === false && m4.json.candidate.id === m3.json?.candidate?.id, `${m4.status} created=${m4.json?.created}`);
const m5 = await billing.call("POST", "/api/billing/candidates/manual-confirmations", mc({ idempotencyKey: key, sourceNote: "A different note" }));
rec("D5", "same key with different data is 409 DUPLICATE_RESOURCE", m5.status === 409 && m5.code === "DUPLICATE_RESOURCE", `${m5.status} ${m5.code}`);
const m6 = await billing.call("POST", "/api/billing/candidates/manual-confirmations", mc());
rec("D6", "a second confirmation for the same service and date with a new key must not create a duplicate candidate (contract: 'cannot create a duplicate candidate')", m6.status === 409, `status ${m6.status} created=${m6.json?.created} candidates=${sql(`select count(*) from tap_hub_project.billing_candidates where client_service_id='${cs.man}' and candidate_date='2026-11-03'`)}`);
const m7 = await billing.call("POST", "/api/billing/candidates/manual-confirmations", mc({ idempotencyKey: randomUUID(), confirmedDate: "2031-01-15" }));
rec("D7", "a confirmation dated in the future is 422 CONFIRMATION_DATE_FUTURE", m7.status === 422 && m7.code === "CONFIRMATION_DATE_FUTURE", `status ${m7.status} ${m7.code || ""}`);
const m8 = await colls.call("POST", "/api/billing/candidates/manual-confirmations", mc());
rec("D8", "Collections-only staff cannot create a confirmation (403)", m8.status === 403, `${m8.status}`);
rec("D9", "confirmation is audited with the Billing actor", Number(sql(`select count(*) from tap_hub_project.audit_log where entity='billing_manual_confirmations' and actor='${BILLING_ID}'`)) >= 1, sql(`select count(*) from tap_hub_project.audit_log where entity='billing_manual_confirmations'`));

// ---- E. Draft, line rules, issue, void, delete ---------------------------------------------------------
const man = await billing.call("POST", "/api/billing/invoices", { clientId: C1, memo: "Synthetic manual draft" });
rec("E1", "POST /invoices {clientId, memo} creates a draft with null number and dates and no lines", man.status === 201 && man.json.invoice.status === "draft" && man.json.invoice.invoiceNumber === null && man.json.invoice.issueDate === null && man.json.invoice.dueDate === null && man.json.invoice.lines.length === 0 && man.json.refresh.includes("invoice"), `${man.status}`);
const manBad = await billing.call("POST", "/api/billing/invoices", { clientId: C1, invoice_number: "X-1", issue_date: "2026-11-01", due_date: "2026-11-16" });
rec("E2", "supplying number or dates is 422", manBad.status === 422, `${manBad.status} ${manBad.code}`);
const issueEmpty = await billing.call("POST", `/api/billing/invoices/${man.json?.invoice?.id}/issue`, {});
rec("E3", "issuing an empty draft is 409 ISSUE_PRECONDITION_FAILED", issueEmpty.status === 409 && issueEmpty.code === "ISSUE_PRECONDITION_FAILED", `${issueEmpty.status} ${issueEmpty.code}`);
const legacyDates = await billing.call("PATCH", `/api/billing/invoices/${man.json?.invoice?.id}`, { issue_date: "2026-11-01", due_date: "2026-11-16" });
rec("E4", "legacy PATCH of a draft with number/dates is rejected as a client error (422), not a server error", legacyDates.status >= 400 && legacyDates.status < 500, `status ${legacyDates.status} ${legacyDates.code}`);
const badIds = await billing.call("POST", "/api/billing/invoices/from-candidates", { candidateIds: ["not-a-uuid"] });
rec("E5", "a malformed candidate id is a 4xx, not a 500", badIds.status >= 400 && badIds.status < 500, `status ${badIds.status} ${badIds.code}`);
const dr = await billing.call("POST", "/api/billing/invoices/from-candidates", { candidateIds: [recCand?.id], memo: "Synthetic November" });
const line = dr.json?.invoice?.lines?.[0];
rec("E6", "draft from a candidate: null number/dates, one line, quantity 1.0000, decimal amounts, candidateIds, refresh targets", dr.status === 201 && dr.json.invoice.invoiceNumber === null && dr.json.invoice.lines.length === 1 && line.quantity === "1.0000" && line.unitAmount === "125.00" && line.amount === "125.00" && JSON.stringify(line.candidateIds) === JSON.stringify([recCand?.id]) && JSON.stringify(dr.json.refresh) === JSON.stringify(["invoice", "candidates", "receivables"]), `${dr.status} ${JSON.stringify(line)}`);
const drState = (await billing.call("GET", `/api/billing/candidates?clientId=${C1}&limit=100&from=${win.from}&to=${win.to}`)).json?.items?.find((i) => i.id === recCand?.id);
rec("E7", "the claimed candidate is drafted", drState?.state === "drafted", drState?.state);
const dr2 = await billing.call("POST", "/api/billing/invoices/from-candidates", { candidateIds: [recCand?.id] });
rec("E8", "claiming a drafted candidate again is 409 CANDIDATE_NOT_OPEN", dr2.status === 409 && dr2.code === "CANDIDATE_NOT_OPEN", `${dr2.status} ${dr2.code}`);
const edit = await billing.call("PATCH", "/api/billing/invoice-lines", { id: line?.id, description: "Corrected label" });
rec("E9", "PATCH of a candidate-linked line is 409 CANDIDATE_LINKED_LINE_IMMUTABLE", edit.status === 409 && edit.code === "CANDIDATE_LINKED_LINE_IMMUTABLE", `${edit.status} ${edit.code}`);
const dbEdit = (() => { try { sqlThrow(`update tap_hub_project.invoice_lines set description='tamper' where id='${line?.id}'`); return "allowed"; } catch (e) { return String(e.stderr).includes("candidate_linked_line_immutable") ? "rejected" : "other:" + String(e.stderr).slice(0, 80); } })();
rec("E10", "the database itself rejects editing a candidate-linked line", dbEdit === "rejected", dbEdit);
const rm = await billing.call("DELETE", "/api/billing/invoice-lines", { id: line?.id });
const afterRm = sql(`select state from tap_hub_project.billing_candidates where id='${recCand?.id}'`);
rec("E11", "removing a linked line returns its candidate to open and reports returnedCandidateIds and refresh", rm.status === 200 && JSON.stringify(rm.json.returnedCandidateIds) === JSON.stringify([recCand?.id]) && JSON.stringify(rm.json.refresh) === JSON.stringify(["invoice", "candidates", "receivables"]) && afterRm === "open", `${rm.status} state=${afterRm}`);
const dr3 = await billing.call("POST", "/api/billing/invoices/from-candidates", { candidateIds: [recCand?.id] });
const del = await billing.call("DELETE", `/api/billing/invoices/${dr3.json?.invoice?.id}`);
rec("E12", "deleting a draft built from a candidate returns it to open (returnedCandidateIds, refresh)", dr3.status === 201 && del.status === 200 && del.json.deleted === true && JSON.stringify(del.json.returnedCandidateIds) === JSON.stringify([recCand?.id]) && sql(`select state from tap_hub_project.billing_candidates where id='${recCand?.id}'`) === "open", `${del.status} ${JSON.stringify(del.json)}`);
const firmToday = firmDate();
const dr4 = await billing.call("POST", "/api/billing/invoices/from-candidates", { candidateIds: [recCand?.id] });
const iss = await billing.call("POST", `/api/billing/invoices/${dr4.json?.invoice?.id}/issue`, {});
const inv = iss.json?.invoice;
rec("E13", "issue assigns TAP-YYYY-####, the firm date, Net 15 due date and the remittance snapshot", iss.status === 200 && /^TAP-\d{4}-\d{4}$/.test(inv?.invoiceNumber) && inv.status === "issued" && inv.issueDate === firmToday && inv.dueDate === addDays(firmToday, 15) && inv.remittanceSnapshot?.payeeName === "TAP Test LLC" && JSON.stringify(iss.json.refresh) === JSON.stringify(["invoice", "candidates", "receivables"]), `${iss.status} ${inv?.invoiceNumber} ${inv?.issueDate} ${inv?.dueDate}`);
rec("E14", "issue moves the linked candidate to invoiced", sql(`select state from tap_hub_project.billing_candidates where id='${recCand?.id}'`) === "invoiced", "");
const delIssued = await billing.call("DELETE", `/api/billing/invoices/${inv?.id}`);
rec("E15", "an issued invoice cannot be deleted (409)", delIssued.status === 409, `${delIssued.status} ${delIssued.code}`);
const pay = await billing.call("POST", "/api/billing/payments", { client_id: C1, received_on: firmToday, amount: "10.00", method: "check", reference: `P2-${tag}` });
const alloc = await billing.call("POST", "/api/billing/allocations", { payment_id: pay.json?.payment?.id, invoice_id: inv?.id, amount: "10.00" });
const voidAlloc = await admin.call("POST", `/api/billing/invoices/${inv?.id}/void`, { reason: "Synthetic void" });
rec("E16", "void with an active allocation is 409 ACTIVE_PAYMENT_ALLOCATION", pay.status === 201 && alloc.status === 201 && voidAlloc.status === 409 && voidAlloc.code === "ACTIVE_PAYMENT_ALLOCATION", `${pay.status}/${alloc.status}/${voidAlloc.status} ${voidAlloc.code}`);
const bv = await billing.call("POST", `/api/billing/invoices/${inv?.id}/void`, { reason: "x" });
const bv2 = await billing.call("POST", `/api/billing/invoices/${inv?.id}`, { action: "void", reason: "x" });
rec("E17", "Billing staff cannot void through /void or the legacy adapter (403)", bv.status === 403 && bv2.status === 403, `${bv.status}/${bv2.status}`);
await admin.call("POST", `/api/billing/allocations/${alloc.json?.allocation_id}`);
const v0 = await admin.call("POST", `/api/billing/invoices/${inv?.id}/void`, {});
rec("E18", "void without a reason is 422 VOID_REASON_REQUIRED", v0.status === 422 && v0.code === "VOID_REASON_REQUIRED", `${v0.status} ${v0.code}`);
const v1 = await admin.call("POST", `/api/billing/invoices/${inv?.id}/void`, { reason: "Synthetic duplicate service" });
const linkActive = sql(`select count(*) from tap_hub_project.billing_candidate_line_links l join tap_hub_project.invoice_lines il on il.id=l.invoice_line_id where il.invoice_id='${inv?.id}' and l.active`);
rec("E19", "void returns candidates to open: returnedCandidateIds, refresh, link deactivated, void reason stored", v1.status === 200 && v1.json.invoice.status === "void" && v1.json.invoice.voidReason === "Synthetic duplicate service" && JSON.stringify(v1.json.returnedCandidateIds) === JSON.stringify([recCand?.id]) && sql(`select state from tap_hub_project.billing_candidates where id='${recCand?.id}'`) === "open" && linkActive === "0", `${v1.status} ${JSON.stringify(v1.json?.returnedCandidateIds)} active links ${linkActive}`);
await owner.call("POST", "/api/billing/settings/terms/overrides", { clientId: C1, clientServiceId: null, netDays: 30, effectiveFrom: "2026-01-01" });
const tov = await owner.call("POST", "/api/billing/settings/terms/overrides", { clientId: C1, clientServiceId: null, netDays: 30, effectiveFrom: "2026-01-01", reason: "Synthetic client terms" });
const tovP = await owner.call("PATCH", `/api/billing/settings/terms/overrides/${tov.json?.override?.id}`, { netDays: 30, reason: "Synthetic confirm" });
rec("E20", "terms override create and patch return {override} with camelCase netDays", tov.status === 201 && tov.json.override.netDays === 30 && tovP.status === 200 && tovP.json.override.netDays === 30, `${tov.status}/${tovP.status}`);
const dr5 = await billing.call("POST", "/api/billing/invoices/from-candidates", { candidateIds: [recCand?.id] });
const legacyIssue = await billing.call("POST", `/api/billing/invoices/${dr5.json?.invoice?.id}`, { action: "issue" });
const li = legacyIssue.json?.invoice;
rec("E21", "legacy adapter issue keeps the Phase 1 snake_case response and applies the client Net 30 override", legacyIssue.status === 200 && /^TAP-\d{4}-\d{4}$/.test(li?.invoice_number) && li.status === "issued" && li.due_date === addDays(li.issue_date, 30) && li.invoiceNumber === undefined, `${legacyIssue.status} ${li?.invoice_number} issue ${li?.issue_date} due ${li?.due_date}`);
const nums = sql(`select string_agg(invoice_number, ',' order by invoice_number) from tap_hub_project.invoices where invoice_number like 'TAP-%'`).split(",");
rec("E22", "invoice numbers are unique and sequential within the issue year", new Set(nums).size === nums.length && nums.every((n, i) => Number(n.slice(-4)) === Number(nums[0].slice(-4)) + i), nums.join(","));

// ---- F. Bundles ----------------------------------------------------------------------------------------
await billing.call("POST", "/api/billing/candidates/generate", { clientServiceIds: [cs.b1, cs.b2], ...win });
const bc = (await billing.call("GET", `/api/billing/candidates?clientId=${C1}&limit=100&from=${win.from}&to=${win.to}`)).json?.items?.filter((i) => [cs.b1, cs.b2].includes(i.clientServiceId)) || [];
const partial = await billing.call("POST", "/api/billing/invoices/from-candidates", { candidateIds: [bc[0]?.id] });
rec("F1", "bundle components must be drafted together (one alone is 409)", bc.length === 2 && partial.status === 409, `${bc.length} components, partial ${partial.status} ${partial.code}`);
const full = await billing.call("POST", "/api/billing/invoices/from-candidates", { candidateIds: bc.map((c) => c.id) });
rec("F2", "a bundle becomes ONE package line (quantity 1.0000, package price) linked to every component", full.status === 201 && full.json.invoice.lines.length === 1 && full.json.invoice.lines[0].unitAmount === "300.00" && full.json.invoice.lines[0].amount === "300.00" && full.json.invoice.lines[0].candidateIds.length === 2, `${full.status} lines=${full.json?.invoice?.lines?.length} ${full.json?.invoice?.lines?.[0]?.amount}`);
info("F3", "each bundle component candidate's own unitAmount (a UI summing candidates would overstate the package)", bc.map((c) => c.unitAmount).join(","));

// ---- G. Policy editor ----------------------------------------------------------------------------------
const pol = (policies, reason = "Synthetic policy change") => ({ policies, reason });
const p0 = await owner.call("PATCH", "/api/billing/permissions/policy", pol([{ actionKey: "policy.manage", allowedRoles: ["staff"], enabled: true }]));
const p1 = await owner.call("PATCH", "/api/billing/permissions/policy", pol([{ actionKey: "invoices.void", allowedRoles: ["staff"], enabled: true }]));
const p2 = await owner.call("PATCH", "/api/billing/permissions/policy", pol([{ actionKey: "pricing.manage", allowedRoles: ["owner"], enabled: true }]));
const p3 = await owner.call("PATCH", "/api/billing/permissions/policy", { policies: [{ actionKey: "pricing.manage", allowedRoles: ["staff"], enabled: true }] });
const p4 = await owner.call("PATCH", "/api/billing/permissions/policy", pol([{ actionKey: "pricing.manage", allowedRoles: ["staff", "staff"], enabled: true }]));
rec("G1", "policy edit refuses fixed actions, non-delegable roles, a missing reason and duplicate roles (all 422)", [p0, p1, p2, p3, p4].every((r) => r.status === 422), [p0, p1, p2, p3, p4].map((r) => r.status).join("/"));
const before = await billing.call("POST", "/api/billing/rate-cards", { name: `P2 ${tag} Delegated`, effectiveFrom: "2026-01-01", reason: "x" });
const grant = await owner.call("PATCH", "/api/billing/permissions/policy", pol([{ actionKey: "pricing.manage", allowedRoles: ["staff"], enabled: true }, { actionKey: "candidates.manage", allowedRoles: ["staff"], enabled: false }]));
const afterPerm = await billing.call("GET", "/api/billing/permissions");
const afterRc = await billing.call("POST", "/api/billing/rate-cards", { name: `P2 ${tag} Delegated`, effectiveFrom: "2026-01-01", reason: "Delegated by Owner" });
const revoked = await billing.call("POST", `/api/billing/candidates/${unpCand?.id}/dismiss`, { reason: "Policy test" });
rec("G2", "Owner delegates pricing.manage and disables candidates.manage; Billing staff permissions and access change accordingly", before.status === 403 && grant.status === 200 && grant.json.refresh?.includes("permissions") && afterPerm.json.actions.includes("pricing.manage") && !afterPerm.json.actions.includes("candidates.manage") && afterRc.status === 201 && revoked.status === 403, `before ${before.status}, grant ${grant.status}, rate card ${afterRc.status}, dismiss ${revoked.status}`);
const billPolicy = await billing.call("PATCH", "/api/billing/permissions/policy", pol([{ actionKey: "pricing.view", allowedRoles: ["staff"], enabled: true }]));
rec("G3", "a delegated pricing.manage does not let staff edit the policy (still 403)", billPolicy.status === 403, `${billPolicy.status}`);
const restore = await owner.call("PATCH", "/api/billing/permissions/policy", pol([{ actionKey: "pricing.manage", allowedRoles: [], enabled: true }, { actionKey: "candidates.manage", allowedRoles: ["staff"], enabled: true }], "Synthetic restore"));
const restored = await billing.call("GET", "/api/billing/permissions");
rec("G4", "policy restored: staff defaults return", restore.status === 200 && JSON.stringify([...restored.json.actions].sort()) === JSON.stringify([...STAFF8].sort()), `${restore.status} ${restored.json?.actions?.length}`);
rec("G5", "policy changes are audited with the Owner actor and reason", Number(sql(`select count(*) from tap_hub_project.audit_log where entity='billing_action_policy' and actor='${OWNER_ID}'`)) >= 2, "");

// ---- H. Audit and database boundary --------------------------------------------------------------------
const aud = (entity, actor) => Number(sql(`select count(*) from tap_hub_project.audit_log where entity='${entity}' and actor='${actor}'`));
rec("H1", "audit rows exist with the real actor for rate cards, candidates and the invoice lifecycle", aud("billing_rate_cards", OWNER_ID) >= 1 && aud("billing_candidates", BILLING_ID) >= 1 && aud("invoices", BILLING_ID) >= 1, `rate_cards ${aud("billing_rate_cards", OWNER_ID)}, candidates ${aud("billing_candidates", BILLING_ID)}, invoices ${aud("invoices", BILLING_ID)}`);
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
bad = [];
for (const t of ["billing_candidates", "billing_rate_cards", "billing_action_policy", "billing_manual_confirmations", "billing_terms_settings", "billing_remittance_settings"]) {
  const r = await fetch(`${API}/rest/v1/${t}?select=*&limit=1`, { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Accept-Profile": "tap_hub_project" } });
  const body = await r.text(); if (!(r.status >= 400 || body === "[]")) bad.push(`${t}=${r.status}`);
}
rec("H2", "the anon key cannot read any Phase 2 table", !bad.length, bad.join(" ") || "6 tables");
const numberReuse = sql(`select count(*) - count(distinct invoice_number) from tap_hub_project.invoices where invoice_number is not null`);
rec("H3", "no invoice number is shared by two invoices (voided numbers are never reused)", numberReuse === "0", numberReuse);

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
