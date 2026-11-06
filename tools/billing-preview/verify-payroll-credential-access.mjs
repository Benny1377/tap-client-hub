// SANDBOX / VERCEL PREVIEW (or disposable local). Checks that payrollPassword and eftps reach only Payroll staff and Owner/Admin.
// Uses a marked synthetic client. Writes generated sentinel values to one client service, and temporarily changes modules and the
// client-edit flag on test accounts so the credential guard itself is reached. Everything is restored in finally and verified.
// Never prints credentials or sentinel values. Env: BILLING_PREVIEW_URL, BILLING_SANDBOX_HOST, BILLING_PREVIEW_CLIENT_ID,
// BILLING_PREVIEW_ALLOW_WRITES=yes, BILLING_PREVIEW_ENV_FILE (default .env.preview.local).
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

const BASE = (process.env.BILLING_PREVIEW_URL || "").replace(/\/$/, "");
const env = Object.fromEntries(readFileSync(process.env.BILLING_PREVIEW_ENV_FILE || ".env.preview.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_0-9]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const C1 = process.env.BILLING_PREVIEW_CLIENT_ID || "";
const API = (env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const local = /^http:\/\/localhost(:\d+)?$/.test(BASE);
if (!local && !/^https:\/\/[^/]+$/.test(BASE)) throw new Error("Refusing: BILLING_PREVIEW_URL must be an https origin");
if (process.env.BILLING_PREVIEW_ALLOW_WRITES !== "yes") throw new Error("Refusing: BILLING_PREVIEW_ALLOW_WRITES=yes is required");
if (!API || new URL(API).host !== process.env.BILLING_SANDBOX_HOST) throw new Error("Refusing: the Supabase host in the env file is not BILLING_SANDBOX_HOST");

const SR = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Accept-Profile": "tap_hub_project", "Content-Profile": "tap_hub_project", "Content-Type": "application/json" };
async function rest(method, path, body, prefer) {
  const r = await fetch(`${API}/rest/v1/${path}`, { method, headers: { ...SR, ...(prefer ? { Prefer: prefer } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path.split("?")[0]} ${r.status}`);
  return t ? JSON.parse(t) : null;
}
class Session {
  constructor() { this.jar = new Map(); }
  async call(method, path, body) {
    const res = await fetch(BASE + path, { method, redirect: "manual", headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(this.jar.size ? { Cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    for (const c of res.headers.getSetCookie?.() || []) { const [pair] = c.split(";"); const n = pair.slice(0, pair.indexOf("=")); const v = pair.slice(pair.indexOf("=") + 1); if (/max-age=0/i.test(c) || v === "") this.jar.delete(n); else this.jar.set(n, v); }
    const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, text };
  }
  async signIn(name) { const r = await this.call("POST", "/api/auth/sign-in", { identifier: env[`TEST_${name}_EMAIL`], password: env[`TEST_${name}_PASSWORD`] }); if (r.status !== 200) throw new Error(`sign-in ${name} ${r.status}`); return this; }
}
const results = [];
const rec = (id, name, ok, ev = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${name} :: ${String(ev).slice(0, 160)}`); };

const client = (await rest("GET", `clients?select=id,name&id=eq.${C1}`))[0];
if (!client || !/synthetic|test/i.test(client.name)) throw new Error("Refusing: the client is not marked synthetic");

// Pin: the deployment must read this database before any write.
const billing = await new Session().signIn("STAFF_BILLING");
const rem = await billing.call("GET", "/api/billing/settings/remittance");
const remRow = (await rest("GET", "billing_remittance_settings?select=updated_at"))[0];
if (rem.status !== 200 || new Date(rem.json?.updatedAt).getTime() !== new Date(remRow?.updated_at).getTime()) throw new Error("Refusing: the deployment is not reading the pinned sandbox");
rec("P-1", "the deployment reads the pinned sandbox", true, new URL(API).host);

const emails = { billing: env.TEST_STAFF_BILLING_EMAIL, collections: env.TEST_STAFF_COLLECTIONS_EMAIL, payroll: env.TEST_STAFF_UNASSIGNED_EMAIL };
const profiles = {};
for (const [k, e] of Object.entries(emails)) { const p = (await rest("GET", `profiles?select=id,email,modules,allow_edit_client_data&email=eq.${encodeURIComponent(e)}`))[0]; if (!p) throw new Error(`no profile for ${k}`); profiles[k] = p; }
const setProfile = (p, patch) => rest("PATCH", `profiles?id=eq.${p.id}`, patch, "return=minimal");

let createdService = null, createdRow = null, row = null, snapshot = null;
async function restore() {
  for (const p of Object.values(profiles)) await setProfile(p, { modules: p.modules, allow_edit_client_data: p.allow_edit_client_data });
  if (createdRow) await rest("DELETE", `client_services?id=eq.${createdRow}`, undefined, "return=minimal");
  else if (row) await rest("PATCH", `client_services?id=eq.${row.id}`, snapshot, "return=minimal");
  if (createdService) await rest("DELETE", `services?id=eq.${createdService}`, undefined, "return=minimal");
}
const PIN = `SYNTH-PIN-${randomBytes(6).toString("hex")}`, EFT = `SYNTH-EFT-${randomBytes(6).toString("hex")}`;
const stored = async () => (await rest("GET", `client_services?select=payroll_password,eftps,processor&id=eq.${row.id}`))[0];
const intact = async (pin = PIN, eft = EFT) => { const s = await stored(); return s.payroll_password === pin && s.eftps === eft; };
const hasKeys = (v) => { if (Array.isArray(v)) return v.some(hasKeys); if (v && typeof v === "object") return Object.entries(v).some(([k, x]) => k === "payrollPassword" || k === "eftps" || k === "payroll_password" || hasKeys(x)); return false; };
const svcOf = (r) => (r.json?.clients || r.json || []).find?.((c) => c.id === C1)?.services?.find((s) => s.csId === row.id);

try {
  let service = (await rest("GET", "services?select=id&code=eq.PR"))[0];
  if (!service) { service = (await rest("POST", "services", { code: "PR", name: "SYNTHETIC payroll credential check", tracking: "manual" }, "return=representation"))[0]; createdService = service.id; }
  row = (await rest("GET", `client_services?select=id,active,payroll_password,eftps,processor,frequency&client_id=eq.${C1}&service_id=eq.${service.id}`))[0];
  if (row) { const { id, ...kept } = row; snapshot = kept; }
  else { row = (await rest("POST", "client_services", { client_id: C1, service_id: service.id, active: true, frequency: "Monthly" }, "return=representation"))[0]; createdRow = row.id; }
  await rest("PATCH", `client_services?id=eq.${row.id}`, { active: true, payroll_password: PIN, eftps: EFT }, "return=minimal");

  // Default accounts: no client-edit flag.
  const collections = await new Session().signIn("STAFF_COLLECTIONS");
  for (const [n, s] of [["Billing", billing], ["Collections", collections]]) {
    for (const q of ["", "?fields=lite"]) {
      const r = await s.call("GET", "/api/clients" + q);
      rec(`R-${n}${q ? "-lite" : ""}`, `${n}-only: /api/clients${q} has neither field and no sentinel`, r.status === 200 && !hasKeys(r.json) && !r.text.includes(PIN) && !r.text.includes(EFT), `${r.status}, ${r.text.length} bytes`);
    }
    const p = await s.call("PATCH", "/api/clients", { csId: row.id, payrollPassword: "x" });
    const u = await s.call("PUT", "/api/clients", { id: C1, services: [{ key: "payroll", enabled: true, payrollPassword: "x", eftps: "x" }] });
    rec(`W0-${n}`, `${n}-only default account: PATCH and PUT refused`, p.status === 403 && u.status === 403 && await intact(), `${p.status}/${u.status}`);
  }
  const anon = await new Session().call("GET", "/api/clients");
  const unassigned = await (await new Session().signIn("STAFF_UNASSIGNED")).call("GET", "/api/clients");
  rec("R-anon-unassigned", "anon 401, unassigned 403", anon.status === 401 && unassigned.status === 403, `${anon.status}/${unassigned.status}`);

  // Client-edit flag on, so the credential guard itself is what refuses.
  await setProfile(profiles.billing, { allow_edit_client_data: true });
  await setProfile(profiles.collections, { allow_edit_client_data: true });
  for (const [n, s] of [["Billing", billing], ["Collections", collections]]) {
    for (const [f, v] of [["payrollPassword", "changed"], ["eftps", "changed"], ["payrollPassword", ""], ["eftps", ""]]) {
      const r = await s.call("PATCH", "/api/clients", { csId: row.id, [f]: v });
      rec(`W1-${n}-${f}-${v ? "set" : "clear"}`, `${n} with client edit: PATCH ${f} refused, stored values unchanged`, r.status === 403 && await intact(), r.status);
    }
    const mixed = await s.call("PATCH", "/api/clients", { csId: row.id, processor: "SYNTH-MIXED", eftps: "changed" });
    const afterMixed = await stored();
    rec(`W2-${n}`, `${n} with client edit: PATCH mixing a credential with another field changes nothing`, mixed.status === 403 && afterMixed.processor !== "SYNTH-MIXED" && await intact(), mixed.status);
    for (const v of ["changed", "", null]) {
      const r = await s.call("PUT", "/api/clients", { id: C1, services: [{ key: "payroll", enabled: true, payrollPassword: v, eftps: v }] });
      rec(`W3-${n}-${v === null ? "null" : v ? "set" : "clear"}`, `${n} with client edit: PUT keeps stored values`, r.status === 200 && await intact(), r.status);
    }
    const ok = await s.call("PATCH", "/api/clients", { csId: row.id, processor: `SYNTH-${n}` });
    rec(`W4-${n}`, `${n} with client edit: an unrelated edit still saves`, ok.status === 200 && (await stored()).processor === `SYNTH-${n}` && await intact(), ok.status);
    const put = await s.call("PUT", "/api/clients", { id: C1, services: [{ key: "payroll", enabled: true, processor: `SYNTH-PUT-${n}`, payrollPassword: "changed" }] });
    rec(`W5-${n}`, `${n} with client edit: unrelated PUT edit saves, credential ignored`, put.status === 200 && (await stored()).processor === `SYNTH-PUT-${n}` && await intact(), put.status);
  }

  // Payroll staff: reuses the no-module test account with Payroll assigned.
  await setProfile(profiles.payroll, { modules: ["Payroll"], allow_edit_client_data: true });
  const payroll = await new Session().signIn("STAFF_UNASSIGNED");
  const pr = await payroll.call("GET", "/api/clients"); const ps = svcOf(pr);
  rec("A-Payroll-read", "Payroll staff read both fields", pr.status === 200 && ps?.payrollPassword === PIN && ps?.eftps === EFT, pr.status);
  const pw = await payroll.call("PATCH", "/api/clients", { csId: row.id, payrollPassword: `${PIN}a`, eftps: `${EFT}a` });
  rec("A-Payroll-patch", "Payroll staff change both fields with PATCH", pw.status === 200 && await intact(`${PIN}a`, `${EFT}a`), pw.status);
  const pu = await payroll.call("PUT", "/api/clients", { id: C1, services: [{ key: "payroll", enabled: true, payrollPassword: PIN, eftps: EFT }] });
  rec("A-Payroll-put", "Payroll staff change both fields with PUT", pu.status === 200 && await intact(), pu.status);
  await setProfile(profiles.payroll, { allow_edit_client_data: false });
  const pd = await payroll.call("PATCH", "/api/clients", { csId: row.id, eftps: "changed" });
  rec("A-Payroll-no-edit", "Payroll staff without client edit: can still read, cannot write", pd.status === 403 && svcOf(await payroll.call("GET", "/api/clients"))?.eftps === EFT && await intact(), pd.status);

  const admin = await new Session().signIn("ADMIN");
  const ar = await admin.call("GET", "/api/clients"); const as = svcOf(ar);
  rec("A-Admin-read", "Owner/Admin read both fields", ar.status === 200 && as?.payrollPassword === PIN && as?.eftps === EFT, ar.status);
  const aw = await admin.call("PATCH", "/api/clients", { csId: row.id, payrollPassword: `${PIN}b`, eftps: `${EFT}b` });
  rec("A-Admin-patch", "Owner/Admin change both fields", aw.status === 200 && await intact(`${PIN}b`, `${EFT}b`), aw.status);
  const wl = await admin.call("GET", "/api/workload");
  rec("O-workload", "/api/workload carries neither value", !wl.text.includes(PIN) && !wl.text.includes(EFT) && !hasKeys(wl.json), wl.status);
} finally {
  await restore();
  let ok = true;
  for (const p of Object.values(profiles)) { const n = (await rest("GET", `profiles?select=modules,allow_edit_client_data&id=eq.${p.id}`))[0]; ok &&= JSON.stringify(n.modules) === JSON.stringify(p.modules) && n.allow_edit_client_data === p.allow_edit_client_data; }
  if (createdRow) ok &&= (await rest("GET", `client_services?select=id&id=eq.${createdRow}`)).length === 0;
  else if (row) { const n = (await rest("GET", `client_services?select=active,payroll_password,eftps,processor,frequency&id=eq.${row.id}`))[0]; ok &&= JSON.stringify(Object.entries(n).sort()) === JSON.stringify(Object.entries(snapshot).sort()); }
  rec("Z", "test accounts and the client service are restored exactly", ok, createdRow ? "synthetic service row removed" : "row restored");
}
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
