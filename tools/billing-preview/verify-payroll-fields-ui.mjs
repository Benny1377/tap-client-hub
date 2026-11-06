// SANDBOX / VERCEL PREVIEW (or disposable local). Drives real browser sessions to check Payroll PIN and EFTPS visibility and what the
// client panels submit, per role. Uses the same temporary account changes and sentinel row as verify-payroll-credential-access.mjs,
// restored in finally. Never prints credentials or sentinel values.
// Env: BILLING_PREVIEW_URL, BILLING_SANDBOX_HOST, BILLING_PREVIEW_CLIENT_ID, BILLING_PREVIEW_ALLOW_WRITES=yes,
// BILLING_PREVIEW_ENV_FILE, PUPPETEER_CORE (path to puppeteer-core), CHROME_PATH.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const BASE = (process.env.BILLING_PREVIEW_URL || "").replace(/\/$/, "");
const env = Object.fromEntries(readFileSync(process.env.BILLING_PREVIEW_ENV_FILE || ".env.preview.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_0-9]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const C1 = process.env.BILLING_PREVIEW_CLIENT_ID || "";
const API = (env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
if (process.env.BILLING_PREVIEW_ALLOW_WRITES !== "yes") throw new Error("Refusing: BILLING_PREVIEW_ALLOW_WRITES=yes is required");
if (!API || new URL(API).host !== process.env.BILLING_SANDBOX_HOST) throw new Error("Refusing: the Supabase host in the env file is not BILLING_SANDBOX_HOST");
const { default: puppeteer } = await import(pathToFileURL(process.env.PUPPETEER_CORE).href);

const SR = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Accept-Profile": "tap_hub_project", "Content-Profile": "tap_hub_project", "Content-Type": "application/json" };
async function rest(method, path, body, prefer) {
  const r = await fetch(`${API}/rest/v1/${path}`, { method, headers: { ...SR, ...(prefer ? { Prefer: prefer } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path.split("?")[0]} ${r.status}`);
  return t ? JSON.parse(t) : null;
}
const results = [];
const rec = (id, name, ok, ev = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${name} :: ${String(ev).slice(0, 200)}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const client = (await rest("GET", `clients?select=*&id=eq.${C1}`))[0];
if (!client || !/synthetic|test/i.test(client.name)) throw new Error("Refusing: the client is not marked synthetic");
const accounts = { billing: env.TEST_STAFF_BILLING_EMAIL, collections: env.TEST_STAFF_COLLECTIONS_EMAIL, payroll: env.TEST_STAFF_UNASSIGNED_EMAIL };
const profiles = {};
for (const [k, e] of Object.entries(accounts)) { const p = (await rest("GET", `profiles?select=id,modules,allow_edit_client_data&email=eq.${encodeURIComponent(e)}`))[0]; if (!p) throw new Error(`no profile for ${k}`); profiles[k] = p; }
const setProfile = (p, patch) => rest("PATCH", `profiles?id=eq.${p.id}`, patch, "return=minimal");

const PIN = `SYNTH-PIN-${randomBytes(6).toString("hex")}`, EFT = `SYNTH-EFT-${randomBytes(6).toString("hex")}`;
let createdService = null, createdRow = null, row = null, snapshot = null;
const stored = async () => (await rest("GET", `client_services?select=payroll_password,eftps&id=eq.${row.id}`))[0];

async function session(browser, account, path) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const log = { writes: [], sentinelInResponses: false, errors: [] };
  page.on("request", (q) => { if (q.url().includes("/api/clients") && q.method() !== "GET") log.writes.push({ method: q.method(), body: q.postData() || "" }); });
  page.on("response", async (r) => { if (!r.url().includes("/api/") || r.url().includes("sign-in")) return; try { const t = await r.text(); if (t.includes(PIN) || t.includes(EFT)) log.sentinelInResponses = true; } catch {} });
  page.on("pageerror", (e) => log.errors.push(String(e.message).slice(0, 120)));
  await page.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
  const status = await page.evaluate(async (identifier, password) => (await fetch("/api/auth/sign-in", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier, password }) })).status, env[`TEST_${account}_EMAIL`], env[`TEST_${account}_PASSWORD`]);
  if (status !== 200) throw new Error(`sign-in ${account} ${status}`);
  await page.goto(BASE + path, { waitUntil: "networkidle2", timeout: 60000 });
  return { ctx, page, log };
}
const openClient = async (page) => {
  const present = (n) => [...document.querySelectorAll("button,a,td,span,div,h3,h4")].some((e) => e.textContent.trim() === n);
  await wait(1500);
  if (!(await page.evaluate(present, client.name))) {
    // The clients page groups entities: open the client's group first.
    const group = client.group_name || client.group_owner || "Unassigned";
    await page.waitForFunction(present, { timeout: 30000 }, group);
    await page.evaluate((g) => { const hits = [...document.querySelectorAll("button,a,td,span,div,h3,h4")].filter((e) => e.textContent.trim() === g); hits[hits.length - 1].click(); }, group);
    await wait(800);
  }
  await page.waitForFunction(present, { timeout: 30000 }, client.name);
  await page.evaluate((n) => { const hits = [...document.querySelectorAll("button,a,td,span,div,h3,h4")].filter((e) => e.textContent.trim() === n); hits[hits.length - 1].click(); }, client.name);
  await wait(2500);
};
const panel = (page) => page.evaluate((pin, eft) => ({
  labels: /Payroll PIN|EFTPS/i.test(document.body.innerText),
  values: [...document.querySelectorAll("input")].filter((i) => i.value === pin || i.value === eft).length,
  html: document.documentElement.outerHTML.includes(pin) || document.documentElement.outerHTML.includes(eft),
}), PIN, EFT);
const openPayrollSection = (page) => page.evaluate(() => { const t = [...document.querySelectorAll("button,[role=tab],summary,div,span")].filter((e) => e.textContent.trim() === "Payroll" && e.offsetParent); if (t.length) t[t.length - 1].click(); return t.length; });
// Opens the add-client form and turns on Payroll. Throws unless the form really opened, so a hidden-fields check cannot pass by accident.
async function openAddClientPayroll(page) {
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /Add client/.test(b.textContent)), { timeout: 30000 });
  await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => /Add client/.test(b.textContent)).click(); });
  await page.waitForFunction(() => [...document.querySelectorAll("label,span,div")].some((e) => e.textContent.trim() === "Payroll" && e.offsetParent && e.closest("[role=dialog],.modal,.overlay")), { timeout: 15000 });
  await page.evaluate(() => { const l = [...document.querySelectorAll("label,span,div")].filter((e) => e.textContent.trim() === "Payroll" && e.offsetParent && e.closest("[role=dialog],.modal,.overlay")); l[l.length - 1].click(); });
  await wait(600);
}
const leaks = (log) => log.writes.filter((w) => /payrollPassword|eftps|payroll_password/.test(w.body)).length;

// Change one client text field, leave it, and close the panel, so autosave and flush both run.
async function editAndSave(page) {
  const done = await page.evaluate(() => {
    const el = [...document.querySelectorAll("textarea,input[type=text],input:not([type])")].find((i) => i.offsetParent && !i.readOnly && !i.disabled && /address|city|notes|contact/i.test(`${i.placeholder} ${i.name} ${i.closest(".field,div")?.innerText || ""}`));
    if (!el) return false;
    el.scrollIntoView(); el.focus(); return true;
  });
  if (!done) return false;
  await page.keyboard.type(" x");
  await page.keyboard.press("Tab");
  await wait(1800);
  await page.keyboard.press("Escape");
  await wait(1200);
  return true;
}

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ["--no-first-run"] });
try {
  let service = (await rest("GET", "services?select=id&code=eq.PR"))[0];
  if (!service) { service = (await rest("POST", "services", { code: "PR", name: "SYNTHETIC payroll credential check", tracking: "manual" }, "return=representation"))[0]; createdService = service.id; }
  row = (await rest("GET", `client_services?select=id,active,payroll_password,eftps&client_id=eq.${C1}&service_id=eq.${service.id}`))[0];
  if (row) { const { id, ...kept } = row; snapshot = kept; }
  else { row = (await rest("POST", "client_services", { client_id: C1, service_id: service.id, active: true, frequency: "Monthly" }, "return=representation"))[0]; createdRow = row.id; }
  await rest("PATCH", `client_services?id=eq.${row.id}`, { active: true, payroll_password: PIN, eftps: EFT }, "return=minimal");

  // Billing-only and Collections-only: default accounts.
  for (const [n, acct, home] of [["Billing-only", "STAFF_BILLING", "/billing"], ["Collections-only", "STAFF_COLLECTIONS", "/collections"]]) {
    const { ctx, page, log } = await session(browser, acct, home);
    const homeState = await panel(page);
    await page.goto(BASE + "/clients", { waitUntil: "networkidle2", timeout: 60000 }); await wait(1500);
    const url = new URL(page.url()).pathname;
    await page.goto(BASE + "/pr", { waitUntil: "networkidle2", timeout: 60000 }); await wait(1500);
    const url2 = new URL(page.url()).pathname;
    rec(`U-${n}`, `${n}: client panels unreachable, no field, no sentinel in pages or API responses`, url !== "/clients" && url2 !== "/pr" && !homeState.html && !log.sentinelInResponses && !log.writes.length, `/clients->${url} /pr->${url2} writes=${log.writes.length}`);
    await ctx.close();
  }

  // Non-Payroll editors: the case the UI change exists for. Billing or Collections plus the Clients module and client edit.
  for (const [n, acct, p, mod] of [["Billing+Clients editor", "STAFF_BILLING", profiles.billing, "Billing"], ["Collections+Clients editor", "STAFF_COLLECTIONS", profiles.collections, "Collections"]]) {
    await setProfile(p, { modules: [mod, "Clients"], allow_edit_client_data: true });
    const { ctx, page, log } = await session(browser, acct, "/clients");
    await openClient(page); await openPayrollSection(page); await wait(800);
    const s = await panel(page);
    rec(`U-${n}-hidden`, `${n}: PIN and EFTPS controls absent, sentinel absent`, !s.labels && !s.values && !s.html && !log.sentinelInResponses, JSON.stringify(s));
    const saved = await editAndSave(page);
    const after = await stored();
    rec(`U-${n}-payload`, `${n}: a real edit saves and no request carries either field`, saved && log.writes.length > 0 && leaks(log) === 0 && after.payroll_password === PIN && after.eftps === EFT, `edited=${saved} writes=${log.writes.map((w) => w.method).join(",")} carrying=${leaks(log)}`);
    await page.goto(BASE + "/clients", { waitUntil: "networkidle2", timeout: 60000 });
    await openAddClientPayroll(page);
    const m = await page.evaluate(() => /Payroll PIN|EFTPS/i.test(document.body.innerText));
    rec(`U-${n}-modal`, `${n}: the add-client form shows no PIN or EFTPS control (not submitted)`, !m, m);
    await ctx.close();
    await setProfile(p, { modules: p.modules, allow_edit_client_data: p.allow_edit_client_data });
  }

  // Payroll staff.
  await setProfile(profiles.payroll, { modules: ["Payroll"], allow_edit_client_data: true });
  {
    const { ctx, page, log } = await session(browser, "STAFF_UNASSIGNED", "/pr");
    await openClient(page); await wait(800);
    const s = await panel(page);
    rec("U-Payroll-visible", "Payroll staff: PIN and EFTPS controls present with stored values", s.labels && s.values === 2, JSON.stringify(s));
    await ctx.close();
  }
  // Owner/Admin.
  {
    const { ctx, page } = await session(browser, "ADMIN", "/clients");
    await openClient(page); await openPayrollSection(page); await wait(800);
    const s = await panel(page);
    rec("U-Admin-visible", "Owner/Admin: PIN and EFTPS controls present with stored values", s.labels && s.values === 2, JSON.stringify(s));
    const before = (await stored());
    const saved = await editAndSave(page);
    const a = await stored();
    rec("U-Admin-keeps", "Owner/Admin: a normal edit keeps stored values", saved && a.payroll_password === before.payroll_password && a.eftps === before.eftps, `edited=${saved}`);
    await page.goto(BASE + "/clients", { waitUntil: "networkidle2", timeout: 60000 });
    await openAddClientPayroll(page);
    rec("U-Admin-modal", "Owner/Admin: the add-client form does show the controls (control for the hidden check, not submitted)", await page.evaluate(() => /Payroll PIN|EFTPS/i.test(document.body.innerText)));
    await ctx.close();
  }
} finally {
  await browser.close();
  for (const p of Object.values(profiles)) await setProfile(p, { modules: p.modules, allow_edit_client_data: p.allow_edit_client_data });
  if (createdRow) await rest("DELETE", `client_services?id=eq.${createdRow}`, undefined, "return=minimal");
  else if (row) await rest("PATCH", `client_services?id=eq.${row.id}`, snapshot, "return=minimal");
  if (createdService) await rest("DELETE", `services?id=eq.${createdService}`, undefined, "return=minimal");
  const now = (await rest("GET", `clients?select=*&id=eq.${C1}`))[0];
  const changed = Object.fromEntries(Object.keys(client).filter((k) => k !== "updated_at" && JSON.stringify(now[k]) !== JSON.stringify(client[k])).map((k) => [k, client[k]]));
  if (Object.keys(changed).length) await rest("PATCH", `clients?id=eq.${C1}`, changed, "return=minimal");
  let ok = true;
  for (const p of Object.values(profiles)) { const n = (await rest("GET", `profiles?select=modules,allow_edit_client_data&id=eq.${p.id}`))[0]; ok &&= JSON.stringify(n.modules) === JSON.stringify(p.modules) && n.allow_edit_client_data === p.allow_edit_client_data; }
  if (createdRow) ok &&= (await rest("GET", `client_services?select=id&id=eq.${createdRow}`)).length === 0;
  rec("Z", "test accounts and client service restored", ok);
}
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
