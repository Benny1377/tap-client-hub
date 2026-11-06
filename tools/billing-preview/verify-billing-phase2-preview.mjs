// SANDBOX / VERCEL PREVIEW. Authenticated-HTTP matrix for Billing Phase 2 against a deployed Preview that is
// connected to the shared TAB-HUB Supabase sandbox. Generated from tools/collections-local/verify-billing-phase2-routes.mjs
// (same checks); database reads and the synthetic Operations fixtures go through the sandbox REST API with the service-role
// key instead of psql. Synthetic data only. Never prints credentials.
//
// WRITES TO A SHARED, FORWARD-ONLY SANDBOX. Everything it adds is tagged P2<tag>. Billing rows cannot be deleted (issued
// invoices and audit rows are immutable), so there is no cleanup: the run prints a manifest of what it added. It temporarily
// delegates a Billing action to staff and edits the remittance settings, and restores both at the end (see G and Z).
//
// Required (nothing is guessed):
//   BILLING_PREVIEW_URL            https URL of the Preview deployment (no trailing slash)
//   BILLING_SANDBOX_HOST           host of the TAB-HUB sandbox Supabase URL (e.g. abcd1234.supabase.co); must equal the host in the env file
//   BILLING_PREVIEW_CLIENT_ID      id of a SYNTHETIC client (its name must contain "synthetic" or "test"); use a fresh one per run
//   BILLING_PREVIEW_ALLOW_WRITES   must be "yes"
// Optional:
//   BILLING_PREVIEW_COMMIT         the commit the Preview was built from (from the Vercel dashboard); printed in the report
//   BILLING_PREVIEW_ENV_FILE       default .env.preview.local (git-ignored). Keys: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
//                                  SUPABASE_SERVICE_ROLE_KEY, TEST_{OWNER,ADMIN,STAFF_BILLING,STAFF_COLLECTIONS,STAFF_UNASSIGNED}_{EMAIL,PASSWORD}
// Run: BILLING_PREVIEW_URL=... BILLING_SANDBOX_HOST=... BILLING_PREVIEW_CLIENT_ID=... BILLING_PREVIEW_ALLOW_WRITES=yes \
//        node tools/billing-preview/verify-billing-phase2-preview.mjs
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const BASE = (process.env.BILLING_PREVIEW_URL || "").replace(/\/$/, "");
const envFile = process.env.BILLING_PREVIEW_ENV_FILE || ".env.preview.local";
const env = Object.fromEntries(readFileSync(envFile, "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const C1 = process.env.BILLING_PREVIEW_CLIENT_ID || "";
const UUIDRE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (!/^https:\/\/[^/]+$/.test(BASE) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) throw new Error("Refusing: BILLING_PREVIEW_URL must be an https origin (plain http only for localhost)");
if (process.env.BILLING_PREVIEW_ALLOW_WRITES !== "yes") throw new Error("Refusing: set BILLING_PREVIEW_ALLOW_WRITES=yes (this run writes synthetic rows to the shared sandbox)");
if (!UUIDRE.test(C1)) throw new Error("Refusing: BILLING_PREVIEW_CLIENT_ID must be the UUID of a synthetic client");
const API = (env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
if (!API || new URL(API).host !== process.env.BILLING_SANDBOX_HOST) throw new Error("Refusing: the Supabase host in the env file is not BILLING_SANDBOX_HOST");
if (!env.SUPABASE_SERVICE_ROLE_KEY || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) throw new Error("Refusing: env file lacks the sandbox keys");

const SRK = env.SUPABASE_SERVICE_ROLE_KEY;
const rest = async (method, table, query = "", body) => {
  const r = await fetch(`${API}/rest/v1/${table}${query ? "?" + query : ""}`, { method, headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Accept-Profile": "tap_hub_project", "Content-Profile": "tap_hub_project", "Content-Type": "application/json", Prefer: method === "GET" ? "count=exact" : "return=representation" }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, count: Number((r.headers.get("content-range") || "").split("/")[1]) };
};
const getRows = async (table, query) => { const r = await rest("GET", table, query); return (r.status === 200 || r.status === 206) && Array.isArray(r.json) ? r.json : null; };
const countRows = async (table, query) => { const r = await rest("GET", table, `${query}&select=*&limit=1`); return r.status === 200 || r.status === 206 ? r.count : NaN; };
const insertOne = async (table, row) => { const r = await rest("POST", table, "", row); if (r.status !== 201 || !r.json?.[0]) throw new Error(`fixture insert into ${table} failed: ${r.status} ${r.text.slice(0, 160)}`); return r.json[0]; };
const candState = async (id) => (await getRows("billing_candidates", `id=eq.${id}&select=state`))?.[0]?.state;
const aud = (entity, actor) => countRows("audit_log", `entity=eq.${entity}&actor=eq.${actor}`);
const added = { services: [], clientServices: [], workPeriods: [], periodCounts: [] };

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
let OWNER_ID, BILLING_ID;
const firmDate = (d = new Date()) => { const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(d); return p; };
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mkService = async (suffix, frequency) => {
  const s = await insertOne("services", { code: `P2${tag}-${suffix}`, name: `Synthetic ${suffix} ${tag}`, tracking: "manual" });
  const c = await insertOne("client_services", { client_id: C1, service_id: s.id, active: true, frequency: frequency ?? null, financials_month: null });
  added.services.push(s.code); added.clientServices.push(c.id);
  return c.id;
};
const serviceCode = (suffix) => `P2${tag}-${suffix}`;

{
  const cl = (await getRows("clients", `id=eq.${C1}&select=*`))?.[0];
  const label = cl && (cl.name ?? cl.client_name ?? cl.display_name ?? cl.legal_name);
  if (!cl || typeof label !== "string" || !/synthetic|test/i.test(label)) throw new Error("Refusing: BILLING_PREVIEW_CLIENT_ID is not an existing client whose name contains 'synthetic' or 'test'");
  if ((await countRows("billing_terms_overrides", `client_id=eq.${C1}`)) !== 0) throw new Error("This synthetic client already holds a Phase 2 run (terms overrides exist). Use a fresh synthetic client.");
}

const anon = new Session();
const owner = await new Session().signIn("OWNER");
const admin = await new Session().signIn("ADMIN");
const billing = await new Session().signIn("STAFF_BILLING");
const colls = await new Session().signIn("STAFF_COLLECTIONS");
const unassigned = await new Session().signIn("STAFF_UNASSIGNED");
{
  const ur = await fetch(`${API}/auth/v1/admin/users?per_page=1000`, { headers: { apikey: SRK, Authorization: `Bearer ${SRK}` } });
  const users = (await ur.json())?.users || [];
  OWNER_ID = users.find((u) => u.email?.toLowerCase() === env.TEST_OWNER_EMAIL?.toLowerCase())?.id;
  BILLING_ID = users.find((u) => u.email?.toLowerCase() === env.TEST_STAFF_BILLING_EMAIL?.toLowerCase())?.id;
  if (!OWNER_ID || !BILLING_ID) throw new Error("Could not resolve the Owner and Billing test user ids in the sandbox");
}
const base = { mc: await aud("billing_manual_confirmations", BILLING_ID), pol: await aud("billing_action_policy", OWNER_ID), rc: await aud("billing_rate_cards", OWNER_ID), cand: await aud("billing_candidates", BILLING_ID), inv: await aud("invoices", BILLING_ID) };
const remBefore = await owner.call("GET", "/api/billing/settings/remittance");
const hdr = await fetch(BASE + "/", { redirect: "manual" });
info("P-INFO", "Preview", `${BASE} commit(declared)=${process.env.BILLING_PREVIEW_COMMIT || "not given"} vercel-id=${hdr.headers.get("x-vercel-id") ? "present" : "absent"}`);

// ---- Operations fixtures (synthetic, via psql) --------------------------------------------------------
const cs = {};
for (const [k, suf, f] of [["rec", "REC", "monthly"], ["unp", "UNP", "monthly"], ["wp", "WP", null], ["cnt", "CNT", null], ["man", "MAN", null], ["none", "NOMAP", "monthly"], ["b1", "B1", "monthly"], ["b2", "B2", "monthly"]]) cs[k] = await mkService(suf, f);
// The real Operations tables store periods as text YYYYMM; Billing normalizes them to YYYY-MM.
added.workPeriods.push((await insertOne("work_periods", { client_service_id: cs.wp, period: "202610", stage: "done", done_at: "2026-10-20T15:00:00+00:00" })).id);
added.periodCounts.push((await insertOne("period_counts", { client_service_id: cs.cnt, period: "202610", processed: 3, expected: 3 })).id);

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
const sbRc = rateCardId ? await getRows("billing_rate_cards", `id=eq.${rateCardId}&select=id`) : null;
rec("P0", "the Preview wrote to the sandbox database named in the env file (a rate card created over HTTP is visible there)", sbRc?.length === 1, `rows ${sbRc?.length}`);
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
const beforeCount = String(await countRows("billing_candidates", `client_service_id=in.(${cs.rec},${cs.unp})`));
rec("C5", "schedule projection is marked projected, has decimal strings and persists nothing", sched.status === 200 && sched.json.projection === "projected" && sched.json.items.some((i) => i.clientServiceId === cs.rec && i.unitAmount === "125.00") && beforeCount === "0", `${sched.status} items=${sched.json?.items?.length} persisted=${beforeCount}`);
const gen = await billing.call("POST", "/api/billing/candidates/generate", { clientServiceIds: [cs.rec, cs.unp], ...win });
rec("C6", "generate: 1 priced + 1 unpriced candidate, both counted as created; unpriced counted separately", gen.status === 200 && gen.json.created === 2 && gen.json.unpriced === 1 && gen.json.existing === 0 && gen.json.candidateIds.length === 2, JSON.stringify(gen.json));
const gen2 = await billing.call("POST", "/api/billing/candidates/generate", { clientServiceIds: [cs.rec, cs.unp], ...win });
rec("C7", "re-running generation is idempotent (created 0, existing 2, same identities)", gen2.status === 200 && gen2.json.created === 0 && gen2.json.existing === 2 && (await countRows("billing_candidates", `client_service_id=in.(${cs.rec},${cs.unp})`)) === 2, JSON.stringify(gen2.json));
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
rec("C18", "work_period_done adapter creates a candidate for a done 2026-10 work period (Operations stores text YYYYMM = 202610)", wpMap.status === 201 && wpGen.status === 200 && wpGen.json.created === 1, `map ${wpMap.status} ${JSON.stringify(wpGen.json)}`);
const cMap = await owner.call("POST", "/api/billing/completion-source-maps", mapBody(cs.cnt, { adapter: "period_count_threshold", predicate: { threshold: 2 } }));
const cGen = await billing.call("POST", "/api/billing/candidates/generate", { clientServiceIds: [cs.cnt], from: "2026-10-01", to: "2026-10-31" });
rec("C19", "period_count_threshold adapter creates a candidate when processed (3) meets the threshold (2) for 202610", cMap.status === 201 && cGen.status === 200 && cGen.json.created === 1, `map ${cMap.status} ${JSON.stringify(cGen.json)}`);

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
rec("D6", "a second confirmation for the same service and date with a new key must not create a duplicate candidate (contract: 'cannot create a duplicate candidate')", m6.status === 409, `status ${m6.status} created=${m6.json?.created} candidates=${await countRows("billing_candidates", `client_service_id=eq.${cs.man}&candidate_date=eq.2026-11-03`)}`);
const m7 = await billing.call("POST", "/api/billing/candidates/manual-confirmations", mc({ idempotencyKey: randomUUID(), confirmedDate: "2031-01-15" }));
rec("D7", "a confirmation dated in the future is 422 CONFIRMATION_DATE_FUTURE", m7.status === 422 && m7.code === "CONFIRMATION_DATE_FUTURE", `status ${m7.status} ${m7.code || ""}`);
const m8 = await colls.call("POST", "/api/billing/candidates/manual-confirmations", mc());
rec("D8", "Collections-only staff cannot create a confirmation (403)", m8.status === 403, `${m8.status}`);
rec("D9", "confirmation is audited with the Billing actor", (await aud("billing_manual_confirmations", BILLING_ID)) > base.mc, `before ${base.mc}`);

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
const dbEdit = await (async () => { const r = await rest("PATCH", "invoice_lines", `id=eq.${line?.id}`, { description: "tamper" }); return r.status >= 400 && /candidate_linked_line_immutable/i.test(r.text) ? "rejected" : `status ${r.status} ${r.text.slice(0, 80)}`; })();
rec("E10", "the database itself rejects editing a candidate-linked line", dbEdit === "rejected", dbEdit);
const rm = await billing.call("DELETE", "/api/billing/invoice-lines", { id: line?.id });
const afterRm = await candState(recCand?.id);
rec("E11", "removing a linked line returns its candidate to open and reports returnedCandidateIds and refresh", rm.status === 200 && JSON.stringify(rm.json.returnedCandidateIds) === JSON.stringify([recCand?.id]) && JSON.stringify(rm.json.refresh) === JSON.stringify(["invoice", "candidates", "receivables"]) && afterRm === "open", `${rm.status} state=${afterRm}`);
const dr3 = await billing.call("POST", "/api/billing/invoices/from-candidates", { candidateIds: [recCand?.id] });
const del = await billing.call("DELETE", `/api/billing/invoices/${dr3.json?.invoice?.id}`);
rec("E12", "deleting a draft built from a candidate returns it to open (returnedCandidateIds, refresh)", dr3.status === 201 && del.status === 200 && del.json.deleted === true && JSON.stringify(del.json.returnedCandidateIds) === JSON.stringify([recCand?.id]) && (await candState(recCand?.id)) === "open", `${del.status} ${JSON.stringify(del.json)}`);
const firmToday = firmDate();
const dr4 = await billing.call("POST", "/api/billing/invoices/from-candidates", { candidateIds: [recCand?.id] });
const iss = await billing.call("POST", `/api/billing/invoices/${dr4.json?.invoice?.id}/issue`, {});
const inv = iss.json?.invoice;
rec("E13", "issue assigns TAP-YYYY-####, the firm date, Net 15 due date and the remittance snapshot", iss.status === 200 && /^TAP-\d{4}-\d{4}$/.test(inv?.invoiceNumber) && inv.status === "issued" && inv.issueDate === firmToday && inv.dueDate === addDays(firmToday, 15) && inv.remittanceSnapshot?.payeeName === "TAP Test LLC" && JSON.stringify(iss.json.refresh) === JSON.stringify(["invoice", "candidates", "receivables"]), `${iss.status} ${inv?.invoiceNumber} ${inv?.issueDate} ${inv?.dueDate}`);
rec("E14", "issue moves the linked candidate to invoiced", (await candState(recCand?.id)) === "invoiced", "");
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
const invLineIds = ((await getRows("invoice_lines", `invoice_id=eq.${inv?.id}&select=id`)) || []).map((x) => x.id);
const linkActive = invLineIds.length ? await countRows("billing_candidate_line_links", `invoice_line_id=in.(${invLineIds.join(",")})&active=eq.true`) : 0;
rec("E19", "void returns candidates to open: returnedCandidateIds, refresh, link deactivated, void reason stored", v1.status === 200 && v1.json.invoice.status === "void" && v1.json.invoice.voidReason === "Synthetic duplicate service" && JSON.stringify(v1.json.returnedCandidateIds) === JSON.stringify([recCand?.id]) && (await candState(recCand?.id)) === "open" && linkActive === 0, `${v1.status} ${JSON.stringify(v1.json?.returnedCandidateIds)} active links ${linkActive}`);
await owner.call("POST", "/api/billing/settings/terms/overrides", { clientId: C1, clientServiceId: null, netDays: 30, effectiveFrom: "2026-01-01" });
const tov = await owner.call("POST", "/api/billing/settings/terms/overrides", { clientId: C1, clientServiceId: null, netDays: 30, effectiveFrom: "2026-01-01", reason: "Synthetic client terms" });
const tovP = await owner.call("PATCH", `/api/billing/settings/terms/overrides/${tov.json?.override?.id}`, { netDays: 30, reason: "Synthetic confirm" });
rec("E20", "terms override create and patch return {override} with camelCase netDays", tov.status === 201 && tov.json.override.netDays === 30 && tovP.status === 200 && tovP.json.override.netDays === 30, `${tov.status}/${tovP.status}`);
const dr5 = await billing.call("POST", "/api/billing/invoices/from-candidates", { candidateIds: [recCand?.id] });
const legacyIssue = await billing.call("POST", `/api/billing/invoices/${dr5.json?.invoice?.id}`, { action: "issue" });
const li = legacyIssue.json?.invoice;
rec("E21", "legacy adapter issue keeps the Phase 1 snake_case response and applies the client Net 30 override", legacyIssue.status === 200 && /^TAP-\d{4}-\d{4}$/.test(li?.invoice_number) && li.status === "issued" && li.due_date === addDays(li.issue_date, 30) && li.invoiceNumber === undefined, `${legacyIssue.status} ${li?.invoice_number} issue ${li?.issue_date} due ${li?.due_date}`);
const nums = [inv?.invoiceNumber, li?.invoice_number];
const dupNums = await getRows("invoices", `invoice_number=in.(${nums.join(",")})&select=id`);
rec("E22", "the two numbers issued in this run are unique and consecutive (TAP-YYYY-####)", nums.every((n) => /^TAP-\d{4}-\d{4}$/.test(n || "")) && Number(nums[1].slice(-4)) === Number(nums[0].slice(-4)) + 1 && dupNums?.length === 2, nums.join(","));

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
rec("G5", "policy changes are audited with the Owner actor and reason", (await aud("billing_action_policy", OWNER_ID)) - base.pol >= 2, "");

// ---- H. Audit and database boundary --------------------------------------------------------------------
rec("H1", "audit rows exist with the real actor for rate cards, candidates and the invoice lifecycle", (await aud("billing_rate_cards", OWNER_ID)) > base.rc && (await aud("billing_candidates", BILLING_ID)) > base.cand && (await aud("invoices", BILLING_ID)) > base.inv, "counts increased over the pre-run baseline");
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
bad = [];
for (const t of ["billing_candidates", "billing_rate_cards", "billing_action_policy", "billing_manual_confirmations", "billing_terms_settings", "billing_remittance_settings"]) {
  const r = await fetch(`${API}/rest/v1/${t}?select=*&limit=1`, { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Accept-Profile": "tap_hub_project" } });
  const body = await r.text(); if (!(r.status >= 400 || body === "[]")) bad.push(`${t}=${r.status}`);
}
rec("H2", "the anon key cannot read any Phase 2 table", !bad.length, bad.join(" ") || "6 tables");
const allNums = ((await getRows("invoices", "invoice_number=not.is.null&select=invoice_number&limit=100000")) || []).map((x) => x.invoice_number);
rec("H3", "no invoice number is shared by two invoices (voided numbers are never reused)", allNums.length > 0 && new Set(allNums).size === allNums.length, `${allNums.length} numbered invoices`);

// ---- Z. Restore shared settings and report what was added -----------------------------------------------
if (remBefore.status === 200 && remBefore.json?.remittance) {
  const restoreRem = await owner.call("PATCH", "/api/billing/settings/remittance", { ...Object.fromEntries(Object.entries(remBefore.json.remittance).filter(([, v]) => typeof v === "string")), reason: "Restore sandbox remittance after the Phase 2 matrix" });
  info("Z1", "remittance settings restored to their pre-run values", `status ${restoreRem.status}`);
}
console.log("\nAdded by this run (tag P2" + tag + "): " + JSON.stringify({ ...added, client: C1 }));
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
