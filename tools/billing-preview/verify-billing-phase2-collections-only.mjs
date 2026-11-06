// SANDBOX / VERCEL PREVIEW. Reruns only checks A3, A4 and D8 of verify-billing-phase2-preview.mjs for the Collections-only
// account, against the same deployment and synthetic client. Every call is expected to be refused with 403, so a passing run adds
// no rows. Never prints credentials. Same env file and pinning as the full matrix, plus:
//   BILLING_PREVIEW_MANIFEST   the manifest of the full run (supplies the synthetic MAN client service for D8)
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const BASE = (process.env.BILLING_PREVIEW_URL || "").replace(/\/$/, "");
const envFile = process.env.BILLING_PREVIEW_ENV_FILE || ".env.preview.local";
const env = Object.fromEntries(readFileSync(envFile, "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const C1 = process.env.BILLING_PREVIEW_CLIENT_ID || "";
const API = (env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
if (!/^https:\/\/[^/]+$/.test(BASE)) throw new Error("Refusing: BILLING_PREVIEW_URL must be an https origin");
if (!API || new URL(API).host !== process.env.BILLING_SANDBOX_HOST) throw new Error("Refusing: the Supabase host in the env file is not BILLING_SANDBOX_HOST");
const manifest = JSON.parse(readFileSync(process.env.BILLING_PREVIEW_MANIFEST, "utf8"));
if (manifest.client !== C1) throw new Error("Refusing: the manifest is for a different client");
const man = manifest.clientServices[manifest.services.findIndex((c) => c.endsWith("-MAN"))];
if (!man) throw new Error("Refusing: no MAN client service in the manifest");

class Session {
  constructor() { this.jar = new Map(); }
  async call(method, path, body) {
    const res = await fetch(BASE + path, { method, redirect: "manual", headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(this.jar.size ? { Cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    for (const c of res.headers.getSetCookie?.() || []) { const [pair] = c.split(";"); const n = pair.slice(0, pair.indexOf("=")); const v = pair.slice(pair.indexOf("=") + 1); if (/max-age=0/i.test(c) || v === "") this.jar.delete(n); else this.jar.set(n, v); }
    const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
    return { status: res.status, json };
  }
  async signIn(name) { const r = await this.call("POST", "/api/auth/sign-in", { identifier: env[`TEST_${name}_EMAIL`], password: env[`TEST_${name}_PASSWORD`] }); if (r.status !== 200) throw new Error(`sign-in ${name} ${r.status}`); return this; }
}
const results = [];
const rec = (id, name, ok, ev = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${name} :: ${String(ev).slice(0, 200)}`); };

// Pin: a Billing session must read the same remittance row as the sandbox before the Collections session makes any call.
const billing = await new Session().signIn("STAFF_BILLING");
const rem = await billing.call("GET", "/api/billing/settings/remittance");
const row = (await (await fetch(`${API}/rest/v1/billing_remittance_settings?select=updated_at`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Accept-Profile": "tap_hub_project" } })).json())?.[0];
if (rem.status !== 200 || new Date(rem.json?.updatedAt).getTime() !== new Date(row?.updated_at).getTime()) throw new Error("Refusing: the deployment is not reading the pinned sandbox");
rec("P-1", "the deployment reads the pinned sandbox (remittance updatedAt matches)", true, new URL(API).host);

const colls = await new Session().signIn("STAFF_COLLECTIONS");
const gets = ["/permissions", "/rate-cards", "/candidates", "/candidates/schedule?from=2026-11-01&to=2026-11-30&clientId=" + C1, "/completion-source-maps", "/settings/terms", "/settings/remittance", "/bundles", "/client-pricing?clientId=" + C1];
const writes = [["POST", "/candidates/generate", { from: "2026-11-01", to: "2026-11-30", clientId: C1 }], ["POST", "/rate-cards", { name: "x", effectiveFrom: "2026-11-01" }], ["PATCH", "/permissions/policy", { policies: [], reason: "x" }], ["POST", "/candidates/manual-confirmations", {}], ["POST", "/invoices/from-candidates", { candidateIds: [randomUUID()] }]];
let bad = [];
for (const p of gets) { const r = await colls.call("GET", "/api/billing" + p); if (r.status !== 403) bad.push(`${p}=${r.status}`); }
rec("A3-Collections-only", "Collections-only staff get 403 (no redacted body) on every Phase 2 read incl. /permissions", !bad.length, bad.join(" ") || `${gets.length} paths`);
bad = [];
for (const [m, p, b] of writes) { const r = await colls.call(m, "/api/billing" + p, b); if (r.status !== 403) bad.push(`${m} ${p}=${r.status}`); }
rec("A4-Collections-only", "Collections-only staff get 403 on Phase 2 writes", !bad.length, bad.join(" ") || `${writes.length} writes`);
const m8 = await colls.call("POST", "/api/billing/candidates/manual-confirmations", { idempotencyKey: randomUUID(), clientServiceId: man, confirmedDate: "2026-11-03", sourceNote: "Synthetic confirmation note", reason: "Synthetic reason" });
rec("D8", "Collections-only staff cannot create a confirmation (403)", m8.status === 403, `${m8.status}`);

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
