// LOCAL or SANDBOX PREVIEW. Real-browser pass of Phase 3 screens 2 to 4 on a marked synthetic client, plus a role check across the tabs.
// Creates tagged services, rate cards, overrides, packages, maps and candidates. Shared firm settings (terms, remittance, policy) are
// saved only on local: a hosted run reads them and leaves them alone. Never prints credentials.
// Env: BILLING_PREVIEW_URL, BILLING_SANDBOX_HOST, BILLING_PREVIEW_CLIENT_ID, BILLING_PREVIEW_ENV_FILE, BILLING_PREVIEW_ALLOW_WRITES=yes,
// PUPPETEER_CORE, CHROME_PATH.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const BASE = (process.env.BILLING_PREVIEW_URL || "").replace(/\/$/, "");
const env = Object.fromEntries(readFileSync(process.env.BILLING_PREVIEW_ENV_FILE || ".env.preview.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_0-9]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const C1 = process.env.BILLING_PREVIEW_CLIENT_ID || "";
const API = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
if (process.env.BILLING_PREVIEW_ALLOW_WRITES !== "yes") throw new Error("Refusing: BILLING_PREVIEW_ALLOW_WRITES=yes is required");
if (new URL(API).host !== process.env.BILLING_SANDBOX_HOST) throw new Error("Refusing: the Supabase host in the env file is not BILLING_SANDBOX_HOST");
const local = BASE.startsWith("http://localhost");
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Accept-Profile": "tap_hub_project", "Content-Profile": "tap_hub_project", "Content-Type": "application/json" };
async function rest(method, path, body, prefer) { const r = await fetch(`${API}/rest/v1/${path}`, { method, headers: { ...H, ...(prefer ? { Prefer: prefer } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); const t = await r.text(); if (!r.ok) throw new Error(`${method} ${path.split("?")[0]} ${r.status} ${t.slice(0, 160)}`); return t ? JSON.parse(t) : null; }
const client = (await rest("GET", `clients?select=id,name&id=eq.${C1}`))[0];
if (!client || !/synthetic|test/i.test(client.name)) throw new Error("Refusing: the client is not marked synthetic");
const results = []; const rec = (id, n, ok, ev = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${n} :: ${String(ev).slice(0, 220)}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tag = Date.now().toString(36).toUpperCase();
const { default: puppeteer } = await import(pathToFileURL(process.env.PUPPETEER_CORE).href);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true });

async function login(account) {
  const ctx = await browser.createBrowserContext(); const page = await ctx.newPage(); await page.setViewport({ width: 1440, height: 1400 });
  page.errors = []; page.on("pageerror", (e) => page.errors.push(String(e.message).slice(0, 140)));
  await page.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
  const st = await page.evaluate(async (i, w) => (await fetch("/api/auth/sign-in", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier: i, password: w }) })).status, env[`TEST_${account}_EMAIL`], env[`TEST_${account}_PASSWORD`]);
  if (st !== 200) throw new Error(`sign-in ${account} ${st}`);
  return page;
}
async function open(page) {
  await page.goto(BASE + "/billing", { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForFunction((id) => [...document.querySelectorAll("select option")].some((o) => o.value === id), { timeout: 30000 }, C1);
  await wait(800);
  const sel = await page.evaluateHandle((id) => [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === id)), C1);
  await sel.asElement().select(C1); await wait(800);
}
const tab = async (page, label) => { await page.evaluate((l) => { [...document.querySelectorAll("[role=tab]")].find((t) => t.textContent.trim().startsWith(l)).click(); }, label); await wait(1800); };
const panel = (label) => `[role=tabpanel]:not([hidden])`;
const text = (page) => page.evaluate((s) => document.querySelector(s)?.innerText || "", panel());
const button = async (page, label) => { const ok = await page.evaluate((s, l) => { const b = [...document.querySelectorAll(`${s} button`)].find((x) => x.textContent.trim() === l && !x.disabled); if (b) b.click(); return !!b; }, panel(), label); await wait(2500); return ok; };
// React reads the native value setter, so this works for controlled and uncontrolled fields alike.
const set = (page, selector, value) => page.evaluate((q, v) => { const el = document.querySelector(q); if (!el) return false; const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); return true; }, selector, value);
const reason = async (page, value) => { await page.evaluate((s, v) => { const l = [...document.querySelectorAll(`${s} label`)].find((x) => x.textContent.trim().startsWith("Reason")); const i = l.querySelector("input"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, v); i.dispatchEvent(new Event("input", { bubbles: true })); }, panel(), value); await wait(250); };
const count = async (t, q) => { const r = await fetch(`${API}/rest/v1/${t}?select=*&limit=1&${q}`, { headers: { ...H, Prefer: "count=exact" } }); return Number((r.headers.get("content-range") || "/0").split("/")[1]); };

try {
  const svc = {};
  for (const k of ["GEN", "OVR", "BA", "BB", "MAN"]) {
    const s = (await rest("POST", "services", { code: `W${tag}-${k}`, name: `Synthetic ${k} ${tag}`, tracking: "manual" }, "return=representation"))[0];
    svc[k] = (await rest("POST", "client_services", { client_id: C1, service_id: s.id, active: true, frequency: "monthly", financials_month: null }, "return=representation"))[0].id;
  }

  const admin = await login("ADMIN"); await open(admin);
  await tab(admin, "Clients & prices");
  let t = await text(admin);
  rec("P1", "client services list shows the client's services", t.includes(`GEN ${tag}`) && t.includes(`W${tag}-GEN`), `${t.length} chars`);
  await set(admin, "#billing-rate-card-name", `W ${tag} card`); await set(admin, "#billing-rate-card-from", "2026-01-01"); await reason(admin, "Synthetic");
  const madeCard = await button(admin, "Create rate card");
  const card = (await rest("GET", `billing_rate_cards?select=id&name=eq.${encodeURIComponent(`W ${tag} card`)}`))[0];
  rec("P2", "a rate card can be created", madeCard && !!card, card?.id?.slice(0, 8));
  await admin.evaluate((s, n) => { [...document.querySelectorAll(`${s} button`)].find((b) => b.textContent.trim() === n).click(); }, panel(), `W ${tag} card`); await wait(1800);
  await set(admin, "#billing-entry-code", `W${tag}-GEN`); await set(admin, "#billing-entry-unit", "service"); await set(admin, "#billing-entry-amount", "125.00"); await set(admin, "#billing-entry-from", "2026-01-01"); await reason(admin, "Synthetic");
  await button(admin, "Add rate entry");
  rec("P3", "a rate entry can be added", (await count("billing_rate_card_entries", `rate_card_id=eq.${card.id}`)) === 1);
  await set(admin, "#billing-entry-code", `W${tag}-GEN`); await set(admin, "#billing-entry-unit", "service"); await set(admin, "#billing-entry-amount", "126.00"); await set(admin, "#billing-entry-from", "2026-06-01"); await reason(admin, "Synthetic");
  await button(admin, "Add rate entry");
  t = await text(admin);
  rec("P4", "an overlapping entry shows the server's error and saves nothing", (await count("billing_rate_card_entries", `rate_card_id=eq.${card.id}`)) === 1 && /overlap/i.test(t), (t.match(/[^\n]*overlap[^\n]*/i) || [""])[0]);
  await set(admin, "#billing-price-service", svc.OVR); await set(admin, "#billing-price-amount", "88.00"); await set(admin, "#billing-price-from", "2026-01-01"); await reason(admin, "Synthetic");
  await button(admin, "Save override");
  rec("P5", "a client price override can be saved", (await count("billing_client_service_overrides", `client_service_id=eq.${svc.OVR}`)) === 1);
  await set(admin, "#billing-bundle-name", `W ${tag} package`); await set(admin, "#billing-bundle-amount", "300.00"); await set(admin, "#billing-bundle-from", "2026-01-01"); await reason(admin, "Synthetic");
  await button(admin, "Create bundle");
  const bundle = (await rest("GET", `billing_bundles?select=id&name=eq.${encodeURIComponent(`W ${tag} package`)}`))[0];
  rec("P6", "a package can be created", !!bundle, bundle?.id?.slice(0, 8));
  await admin.evaluate((s, n) => { const tr = [...document.querySelectorAll(`${s} tr`)].find((r) => r.innerText.includes(n)); [...tr.querySelectorAll("button")].find((b) => /Edit components/.test(b.textContent)).click(); }, panel(), `W ${tag} package`); await wait(1000);
  await admin.evaluate((s, names) => { for (const n of names) [...document.querySelectorAll(`${s} label`)].find((l) => l.textContent.includes(n) && l.querySelector("input[type=checkbox]")).querySelector("input").click(); }, panel(), [`BA ${tag}`, `BB ${tag}`]); await wait(300);
  await reason(admin, "Synthetic");
  await button(admin, "Save components");
  rec("P7", "package components can be set", (await count("billing_bundle_components", `bundle_id=eq.${bundle.id}`)) === 2);

  await tab(admin, "Settings");
  t = await text(admin);
  rec("T1", "settings show terms, remittance, policy and completion maps", /Firm payment terms/.test(t) && /remittance/i.test(t) && /Delegated Billing permissions/.test(t) && /Completion-source maps/.test(t));
  const policyKeys = await admin.evaluate((s) => [...document.querySelectorAll(`${s} code`)].map((c) => c.textContent).filter((c) => /\./.test(c)).length, panel());
  rec("T2", "the policy editor lists all 11 delegable actions and no fixed one", policyKeys === 11 && !/policy\.manage\n/.test(t), policyKeys);
  if (local) {
    const before = await rest("GET", "billing_action_policy?select=action_key");
    await reason(admin, "Synthetic unchanged save");
    await button(admin, "Save permission policy");
    t = await text(admin);
    const after = await rest("GET", "billing_action_policy?select=action_key");
    rec("T3", "saving the policy unchanged succeeds", after.length >= before.length && /Saved\./.test(t), `rows ${before.length} to ${after.length}`);
    await set(admin, "#billing-net-days", "15"); await reason(admin, "Synthetic"); await button(admin, "Save firm terms");
    rec("T4", "firm terms save", /Saved\./.test(await text(admin)));
    await admin.evaluate((s) => { const l = [...document.querySelectorAll(`${s} label`)].find((x) => x.textContent.trim().startsWith("Payee")); const i = l.querySelector("input"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "Synthetic Payee"); i.dispatchEvent(new Event("input", { bubbles: true })); }, panel()); await wait(200);
    await reason(admin, "Synthetic"); await button(admin, "Save remittance");
    const rem = (await rest("GET", "billing_remittance_settings?select=payee_name"))[0];
    rec("T5", "remittance saves", rem.payee_name === "Synthetic Payee");
  }
  for (const [k, adapter, rule] of [["GEN", "schedule", "period_end"], ["BA", "schedule", "period_end"], ["BB", "schedule", "period_end"], ["MAN", "manual_confirmation", "confirmed_date"]]) {
    await set(admin, "#billing-map-service", svc[k]); await set(admin, "#billing-map-adapter", adapter); await set(admin, "#billing-map-date-rule", rule); await set(admin, "#billing-map-from", "2026-01-01"); await reason(admin, "Synthetic map");
    await button(admin, "Create map");
  }
  rec("T6", "completion maps can be created", (await count("billing_completion_source_maps", `client_service_id=in.(${[svc.GEN, svc.BA, svc.BB, svc.MAN].join(",")})`)) === 4, await text(admin).then((x) => (x.match(/[^\n]*(error|invalid|required)[^\n]*/i) || [""])[0]));
  await set(admin, "#billing-map-service", svc.MAN); await set(admin, "#billing-confirm-date", "2026-11-05"); await set(admin, "#billing-confirm-note", "Synthetic confirmation"); await reason(admin, "Synthetic confirmation");
  await button(admin, "Confirm completion");
  rec("T7", "a manual confirmation creates a candidate", (await count("billing_candidates", `client_service_id=eq.${svc.MAN}`)) === 1);

  await tab(admin, "What bills next");
  const before = await count("billing_candidates", `client_id=eq.${C1}`);
  const dates = await admin.evaluate((s) => [...document.querySelectorAll(`${s} input[type=date]`)].length, panel());
  await admin.evaluate((s) => { const [a, b] = document.querySelectorAll(`${s} input[type=date]`); const put = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); }; put(a, "2026-11-01"); put(b, "2026-11-30"); }, panel()); await wait(300);
  await button(admin, "Preview projection"); await wait(1500);
  t = await text(admin);
  rec("W1", "projection shows expected work, labelled projected, and writes nothing", dates === 2 && t.includes(`GEN ${tag}`) && /Projected/i.test(t) && (await count("billing_candidates", `client_id=eq.${C1}`)) === before, `${t.includes(`GEN ${tag}`)} candidates ${before}`);
  await button(admin, "Generate candidates"); await wait(2000);
  t = await text(admin);
  const made = await count("billing_candidates", `client_id=eq.${C1}`);
  rec("W2", "generate is explicit and reports its totals", made > before && /Created \d+/.test(t) && /Skip reasons/.test(t), (t.match(/Created[^\n]*/) || [""])[0]);
  await button(admin, "Generate candidates"); await wait(2000);
  t = await text(admin);
  rec("W3", "generating again creates nothing new", (await count("billing_candidates", `client_id=eq.${C1}`)) === made && /Created 0/.test(t), (t.match(/Created[^\n]*/) || [""])[0]);
  await tab(admin, "Invoices"); await wait(1500);
  const inv = await admin.evaluate(() => document.querySelector("[data-candidates-panel]")?.innerText || "");
  rec("W4", "generated work reaches the Invoices tab, the package as one row", inv.includes(`GEN ${tag}`) && inv.includes(`W ${tag} package`) && (inv.match(/\$300\.00/g) || []).length >= 1);
  rec("W5", "no page errors as Admin", admin.errors.length === 0, admin.errors.join("; "));

  const staff = await login("STAFF_BILLING"); await open(staff);
  await tab(staff, "Clients & prices"); t = await text(staff);
  const manage = await staff.evaluate((s) => [...document.querySelectorAll(`${s} button`)].filter((b) => /Create rate card|Save override|Create bundle/.test(b.textContent)).length, panel());
  rec("R1", "Billing staff see prices read-only", t.includes(`GEN ${tag}`) && manage === 0, `manage controls ${manage}`);
  await tab(staff, "Settings"); t = await text(staff);
  rec("R2", "Billing staff get no policy editor or terms and remittance saves", /restricted to Owner\/Admin/.test(t) && !/Save permission policy|Save firm terms|Save remittance/.test(t));
  await tab(staff, "What bills next"); t = await text(staff);
  rec("R3", "Billing staff keep the default generate action", /Generate candidates/.test(t));
  rec("R4", "no page errors as Billing staff", staff.errors.length === 0, staff.errors.join("; "));
  for (const [id, account] of [["R5", "STAFF_COLLECTIONS"], ["R6", "STAFF_UNASSIGNED"]]) {
    const p = await login(account);
    await p.goto(BASE + "/billing", { waitUntil: "networkidle2", timeout: 60000 }); await wait(1500);
    rec(id, `${account} cannot open Billing`, new URL(p.url()).pathname !== "/billing", new URL(p.url()).pathname);
  }
  const small = await login("STAFF_BILLING"); await small.setViewport({ width: 375, height: 800 }); await open(small);
  let wide = [];
  for (const label of ["Invoices", "What bills next", "Clients & prices", "Settings"]) { await tab(small, label); const w = await small.evaluate(() => document.documentElement.scrollWidth); if (w > 375) wide.push(`${label}=${w}`); }
  rec("L1", "no page-wide horizontal scroll at phone width on any Phase 3 tab", wide.length === 0, wide.join(" "));
} finally { await browser.close(); }
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
