// Read-only checks of the Phase 3 read endpoints. Never writes to the Preview or prints credentials.
// Env: BILLING_PREVIEW_URL, BILLING_PREVIEW_EXPECTED_HOST, BILLING_PREVIEW_CLIENT_ID,
// BILLING_PREVIEW_ENV_FILE (default .env.preview.local). Requires the TAB-HUB sandbox host.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const BASE = (process.env.BILLING_PREVIEW_URL || "").replace(/\/$/, "");
const env = Object.fromEntries(readFileSync(process.env.BILLING_PREVIEW_ENV_FILE || ".env.preview.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_0-9]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const C1 = process.env.BILLING_PREVIEW_CLIENT_ID;
const API = (env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const SANDBOX_HOST = "vuqgxotdccxivjmavsoj.supabase.co";
const expectedPreviewHost = process.env.BILLING_PREVIEW_EXPECTED_HOST;
if (!BASE || !expectedPreviewHost || !C1 || !API || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Set Preview URL/expected host, synthetic client ID, and sandbox env file before running");
const previewUrl = new URL(BASE), apiUrl = new URL(API);
if (previewUrl.protocol !== "https:" || previewUrl.host !== expectedPreviewHost) throw new Error("Preview URL does not match the explicitly expected HTTPS host");
if (apiUrl.protocol !== "https:" || apiUrl.host !== SANDBOX_HOST) throw new Error("Refusing to run: configured Supabase URL is not the TAB-HUB sandbox");
const db = async (p) => (await fetch(`${API}/rest/v1/${p}`, { method: "GET", headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Accept-Profile": "tap_hub_project" } })).json();
class Session {
  jar = new Map();
  async call(path) {
    const r = await fetch(BASE + path, { method: "GET", redirect: "manual", headers: this.jar.size ? { Cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {} });
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
const pol = await admin.call("/api/billing/permissions/policy");
const DELEGABLE = ["billing.view","pricing.view","pricing.manage","candidates.view","candidates.manage","invoices.draft.manage","invoices.issue","payments.record","payments.allocate","settings.terms.manage","settings.remittance.manage"];
rec("Q1", "policy: Admin 200, all 11 delegable actions, no fixed action, exact shape", pol.status === 200 && pol.json.policies.length === 11 && DELEGABLE.every((k) => pol.json.policies.some((p) => p.actionKey === k)) && pol.json.policies.every((p) => Object.keys(p).sort().join() === "actionKey,allowedRoles,enabled"), `${pol.status} rows=${pol.json?.policies?.length} stored=${before.length}`);
rec("Q1b", "policy: stored allowed roles are filtered to delegable roles", before.filter((r) => DELEGABLE.includes(r.action_key)).every((r) => { const p = pol.json.policies.find((x) => x.actionKey === r.action_key); const expected = r.allowed_roles.filter((role) => ["manager", "staff", "offshore"].includes(role)); return JSON.stringify(p.allowedRoles) === JSON.stringify(expected) && p.enabled === r.enabled; }), `stored=${before.length}`);
rec("Q1c", "policy: response roles are limited to manager, staff, offshore", pol.status === 200 && pol.json.policies.every((p) => p.allowedRoles.every((role) => ["manager", "staff", "offshore"].includes(role))), "read-only save-shape validation");
const mine = await billing.call("/api/billing/permissions");
const predicted = pol.json.policies.filter((p) => p.enabled && p.allowedRoles.includes("staff")).map((p) => p.actionKey).sort().join();
rec("Q1d", "policy: effective values predict what Billing staff actually get", predicted === [...mine.json.actions].sort().join(), `${mine.json?.actions?.length} actions`);
const st = [];
for (const s of [billing, collections, unassigned, anon]) st.push((await s.call("/api/billing/permissions/policy")).status);
rec("Q2", "policy: Billing, Collections, unassigned 403, anon 401", st.join() === "403,403,403,401", st.join());

const cs = await billing.call(`/api/billing/client-services?clientId=${C1}`);
rec("Q4", "client-services: Billing 200, exactly the five fields", cs.status === 200 && cs.json.items.every((i) => Object.keys(i).sort().join() === "active,frequency,id,serviceCode,serviceName"), `${cs.status} items=${cs.json?.items?.length} keys=${Object.keys(cs.json?.items?.[0] || {})}`);
const st2 = [];
for (const s of [collections, unassigned, anon]) st2.push((await s.call(`/api/billing/client-services?clientId=${C1}`)).status);
rec("Q5", "client-services: Collections, unassigned 403, anon 401", st2.join() === "403,403,401", st2.join());
const bad = await billing.call("/api/billing/client-services?clientId=nope"), miss = await billing.call("/api/billing/client-services"), unk = await billing.call(`/api/billing/client-services?clientId=${randomUUID()}`);
rec("Q6", "client-services: bad and missing id 422, unknown client empty", bad.status === 422 && miss.status === 422 && unk.status === 200 && unk.json.items.length === 0, `${bad.status}/${miss.status}/${unk.status}`);

for (const [n, s] of [["Admin", admin], ["Billing", billing], ["Collections", collections]]) {
  const inv = await s.call("/api/billing/invoices");
  const lines = (inv.json?.invoices || []).flatMap((i) => i.invoice_lines || []);
  rec(`Q7-${n}`, "invoices: 200, every line has candidateIds, no link payload", inv.status === 200 && lines.every((l) => Array.isArray(l.candidateIds)) && !inv.text.includes("billing_candidate_line_links"), `${inv.status} invoices=${inv.json?.invoices?.length} lines=${lines.length} linked=${lines.filter((l) => l.candidateIds?.length).length}`);
}
const inv = await admin.call("/api/billing/invoices");
const lines = inv.json.invoices.flatMap((i) => i.invoice_lines);
const links = await db("billing_candidate_line_links?select=candidate_id,invoice_line_id,active");
const want = new Map();
for (const l of links) if (l.active && l.invoice_line_id) want.set(l.invoice_line_id, [...(want.get(l.invoice_line_id) || []), l.candidate_id]);
const mismatched = lines.filter((l) => [...l.candidateIds].sort().join() !== [...(want.get(l.id) || [])].sort().join());
rec("Q8", "invoices: candidateIds equal the active links, inactive links excluded", mismatched.length === 0, `links=${links.length} active=${links.filter((l) => l.active).length} mismatched=${mismatched.length}`);
const legacy = "id,amount,period,quantity,created_by,invoice_id,sort_order,updated_by,description,unit_amount,client_service_id".split(",");
rec("Q9", "invoices: legacy line fields retained", lines.every((l) => legacy.every((k) => k in l)), `lines=${lines.length}`);
const after = await db("billing_action_policy?select=action_key,allowed_roles,enabled&order=action_key");
rec("Q10", "read checks changed nothing in policy", JSON.stringify(before) === JSON.stringify(after));

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
