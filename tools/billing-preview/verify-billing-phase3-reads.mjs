// Checks of the Phase 3 read endpoints. Read-only unless BILLING_POLICY_ROUNDTRIP=yes, which saves the unchanged GET response and
// writes policy rows. Use that flag only on a disposable local database. Never prints credentials.
// Env: BILLING_PREVIEW_URL, BILLING_PREVIEW_CLIENT_ID, BILLING_PREVIEW_ENV_FILE (default .env.preview.local).
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const BASE = (process.env.BILLING_PREVIEW_URL || "").replace(/\/$/, "");
const env = Object.fromEntries(readFileSync(process.env.BILLING_PREVIEW_ENV_FILE || ".env.preview.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_0-9]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const C1 = process.env.BILLING_PREVIEW_CLIENT_ID;
const API = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
const db = async (p) => (await fetch(`${API}/rest/v1/${p}`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Accept-Profile": "tap_hub_project" } })).json();
class Session {
  jar = new Map();
  async call(method, path) {
    const r = await fetch(BASE + path, { method, redirect: "manual", headers: this.jar.size ? { Cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {} });
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, text };
  }
  async callJson(method, path, body) {
    const r = await fetch(BASE + path, { method, redirect: "manual", headers: { "Content-Type": "application/json", Cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ") }, body: JSON.stringify(body) });
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, text };
  }
  async signIn(name) {
    const r = await fetch(BASE + "/api/auth/sign-in", { method: "POST", redirect: "manual", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier: env[`TEST_${name}_EMAIL`], password: env[`TEST_${name}_PASSWORD`] }) });
    if (r.status !== 200) throw new Error(`sign-in ${name} ${r.status}`);
    for (const c of r.headers.getSetCookie()) { const [p] = c.split(";"); this.jar.set(p.slice(0, p.indexOf("=")), p.slice(p.indexOf("=") + 1)); }
    return this;
  }
}
const results = [];
const rec = (id, name, ok, ev = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${name} :: ${String(ev).slice(0, 240)}`); };
const admin = await new Session().signIn("ADMIN"), billing = await new Session().signIn("STAFF_BILLING"), collections = await new Session().signIn("STAFF_COLLECTIONS"), unassigned = await new Session().signIn("STAFF_UNASSIGNED"), anon = new Session();

const before = await db("billing_action_policy?select=action_key,allowed_roles,enabled&order=action_key");
const pol = await admin.call("GET", "/api/billing/permissions/policy");
const DELEGABLE = ["billing.view","pricing.view","pricing.manage","candidates.view","candidates.manage","invoices.draft.manage","invoices.issue","payments.record","payments.allocate","settings.terms.manage","settings.remittance.manage"];
rec("Q1", "policy: Admin 200, all 11 delegable actions, no fixed action, exact shape", pol.status === 200 && pol.json.policies.length === 11 && DELEGABLE.every((k) => pol.json.policies.some((p) => p.actionKey === k)) && pol.json.policies.every((p) => Object.keys(p).sort().join() === "actionKey,allowedRoles,enabled"), `${pol.status} rows=${pol.json?.policies?.length} stored=${before.length}`);
rec("Q1b", "policy: stored rows are returned, limited to delegable roles", before.filter((r) => DELEGABLE.includes(r.action_key)).every((r) => { const p = pol.json.policies.find((x) => x.actionKey === r.action_key); return JSON.stringify(p.allowedRoles) === JSON.stringify(r.allowed_roles.filter((x) => ["manager", "staff", "offshore"].includes(x))) && p.enabled === r.enabled; }), `stored=${before.length}`);
const mine = await billing.call("GET", "/api/billing/permissions");
const predicted = pol.json.policies.filter((p) => p.enabled && p.allowedRoles.includes("staff")).map((p) => p.actionKey).sort().join();
rec("Q1c", "policy: effective values predict what Billing staff actually get", predicted === [...mine.json.actions].sort().join(), `${mine.json?.actions?.length} actions`);
rec("Q1d", "policy: only delegable roles are returned", pol.json.policies.every((p) => p.allowedRoles.every((r) => ["manager", "staff", "offshore"].includes(r))));
if (process.env.BILLING_POLICY_ROUNDTRIP === "yes") {
  if (!BASE.startsWith("http://localhost")) throw new Error("Refusing: the policy save runs on local only");
  const save = await admin.callJson("PATCH", "/api/billing/permissions/policy", { policies: pol.json.policies, reason: "Synthetic unchanged save" });
  const again = await admin.call("GET", "/api/billing/permissions/policy");
  const sorted = (x) => JSON.stringify([...x].sort((m, n) => m.actionKey.localeCompare(n.actionKey)));
  rec("Q1e", "policy: saving the GET response unchanged succeeds and reads back the same", save.status === 200 && sorted(again.json.policies) === sorted(pol.json.policies), save.status);
  const mineAfter = await billing.call("GET", "/api/billing/permissions");
  rec("Q1f", "policy: the save changes no one's effective actions", [...mineAfter.json.actions].sort().join() === [...mine.json.actions].sort().join(), `${mineAfter.json?.actions?.length} actions`);
  const adminWrite = await admin.callJson("POST", "/api/billing/rate-cards", { name: `Synthetic round trip ${Date.now()}`, effectiveFrom: "2026-12-01", reason: "Synthetic check" });
  const staffWrite = await billing.callJson("POST", "/api/billing/rate-cards", { name: "Synthetic refused", effectiveFrom: "2026-12-01", reason: "Synthetic check" });
  rec("Q1g", "policy: Admin keeps pricing.manage with an empty role list, staff stay refused", adminWrite.status >= 200 && adminWrite.status < 300 && staffWrite.status === 403, `${adminWrite.status}/${staffWrite.status}`);
}
const st = [];
for (const s of [billing, collections, unassigned, anon]) st.push((await s.call("GET", "/api/billing/permissions/policy")).status);
rec("Q2", "policy: Billing, Collections, unassigned 403, anon 401", st.join() === "403,403,403,401", st.join());

const cs = await billing.call("GET", `/api/billing/client-services?clientId=${C1}`);
rec("Q4", "client-services: Billing 200, exactly the five fields", cs.status === 200 && cs.json.items.every((i) => Object.keys(i).sort().join() === "active,frequency,id,serviceCode,serviceName"), `${cs.status} items=${cs.json?.items?.length} keys=${Object.keys(cs.json?.items?.[0] || {})}`);
const st2 = [];
for (const s of [collections, unassigned, anon]) st2.push((await s.call("GET", `/api/billing/client-services?clientId=${C1}`)).status);
rec("Q5", "client-services: Collections, unassigned 403, anon 401", st2.join() === "403,403,401", st2.join());
const bad = await billing.call("GET", "/api/billing/client-services?clientId=nope"), miss = await billing.call("GET", "/api/billing/client-services"), unk = await billing.call("GET", `/api/billing/client-services?clientId=${randomUUID()}`);
rec("Q6", "client-services: bad and missing id 422, unknown client empty", bad.status === 422 && miss.status === 422 && unk.status === 200 && unk.json.items.length === 0, `${bad.status}/${miss.status}/${unk.status}`);

for (const [n, s] of [["Admin", admin], ["Billing", billing], ["Collections", collections]]) {
  const inv = await s.call("GET", "/api/billing/invoices");
  const lines = (inv.json?.invoices || []).flatMap((i) => i.invoice_lines || []);
  rec(`Q7-${n}`, "invoices: 200, every line has candidateIds, no link payload", inv.status === 200 && lines.every((l) => Array.isArray(l.candidateIds)) && !inv.text.includes("billing_candidate_line_links"), `${inv.status} invoices=${inv.json?.invoices?.length} lines=${lines.length} linked=${lines.filter((l) => l.candidateIds?.length).length}`);
}
const inv = await admin.call("GET", "/api/billing/invoices");
const lines = inv.json.invoices.flatMap((i) => i.invoice_lines);
const links = await db("billing_candidate_line_links?select=candidate_id,invoice_line_id,active");
const want = new Map();
for (const l of links) if (l.active && l.invoice_line_id) want.set(l.invoice_line_id, [...(want.get(l.invoice_line_id) || []), l.candidate_id]);
const mismatched = lines.filter((l) => [...l.candidateIds].sort().join() !== [...(want.get(l.id) || [])].sort().join());
rec("Q8", "invoices: candidateIds equal the active links, inactive links excluded", mismatched.length === 0, `links=${links.length} active=${links.filter((l) => l.active).length} mismatched=${mismatched.length}`);
const legacy = "id,amount,period,quantity,created_by,invoice_id,sort_order,updated_by,description,unit_amount,client_service_id".split(",");
rec("Q9", "invoices: legacy line fields retained", lines.every((l) => legacy.every((k) => k in l)), `lines=${lines.length}`);
const after = await db("billing_action_policy?select=action_key,allowed_roles,enabled&order=action_key");
if (process.env.BILLING_POLICY_ROUNDTRIP !== "yes") rec("Q10", "reads changed nothing in policy", JSON.stringify(before) === JSON.stringify(after));

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
