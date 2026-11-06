// LOCAL or SANDBOX PREVIEW. Real-browser pass of Phase 3 screen 1 against the real server rules, on a marked synthetic client.
// Seeds tagged services, a rate card, packages and candidates through the product API, then drives the UI as Billing staff and Admin.
// Issue and void leave permanent synthetic rows, so a hosted run needs BILLING_SCREEN1_ALLOW_PERMANENT=yes. Never prints credentials.
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
if (!local && process.env.BILLING_SCREEN1_ALLOW_PERMANENT !== "yes") throw new Error("Refusing: a hosted run leaves issued and void rows; set BILLING_SCREEN1_ALLOW_PERMANENT=yes");
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
  const ctx = await browser.createBrowserContext(); const page = await ctx.newPage(); await page.setViewport({ width: 1440, height: 1200 });
  page.errors = []; page.calls = [];
  page.on("pageerror", (e) => page.errors.push(String(e.message).slice(0, 140)));
  page.on("request", (q) => { if (q.url().includes("/api/billing/") && q.method() !== "GET") page.calls.push(`${q.method()} ${new URL(q.url()).pathname}`); });
  await page.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
  const st = await page.evaluate(async (i, w) => (await fetch("/api/auth/sign-in", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier: i, password: w }) })).status, env[`TEST_${account}_EMAIL`], env[`TEST_${account}_PASSWORD`]);
  if (st !== 200) throw new Error(`sign-in ${account} ${st}`);
  return page;
}
const call = (page, method, path, body) => page.evaluate(async (m, p, b) => { const r = await fetch(p, { method: m, headers: b ? { "Content-Type": "application/json" } : {}, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { status: r.status, json: j }; }, method, path, body);
const must = (r, what) => { if (r.status >= 300) throw new Error(`${what} ${r.status} ${JSON.stringify(r.json).slice(0, 160)}`); return r.json; };

async function openBilling(page) {
  await page.goto(BASE + "/billing", { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForFunction((id) => [...document.querySelectorAll("select option")].some((o) => o.value === id), { timeout: 30000 }, C1);
  await wait(800);
  const sel = await page.evaluateHandle((id) => [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === id)), C1);
  await sel.asElement().select(C1);
  await wait(500);
}
const filter = async (page, label) => { await page.waitForSelector("[data-candidates-panel]", { timeout: 20000 }); await page.evaluate((l) => { [...document.querySelectorAll("[data-candidates-panel] button")].find((b) => b.textContent.trim() === l).click(); }, label); await wait(2000); };
const rows = (page) => page.evaluate(() => [...document.querySelectorAll("[data-candidate-row]")].map((tr) => ({ text: tr.innerText.replace(/\s+/g, " "), checkbox: !!tr.querySelector("input[type=checkbox]"), disabled: !!tr.querySelector("input[type=checkbox]:disabled") })));
const has = (list, text) => list.find((row) => row.text.includes(text));
async function reasonAction(page, rowText, action, reason) {
  const details = await page.evaluateHandle((t, a) => { const tr = [...document.querySelectorAll("[data-candidate-row]")].find((r) => r.innerText.includes(t)); const d = tr.querySelector(`[data-candidate-action="${a}"]`); d.open = true; return d; }, rowText, action);
  const box = await details.asElement().$("textarea"); await box.type(reason);
  await details.asElement().evaluate((d) => d.querySelector("button[type=submit]").click());
  await wait(2500);
}
const tick = (page, text) => page.evaluate((t) => { [...document.querySelectorAll("[data-candidate-row]")].find((r) => r.innerText.includes(t)).querySelector("input[type=checkbox]").click(); }, text);
const clickText = (page, scope, text) => page.evaluate((s, t) => { [...document.querySelectorAll(`${s} button`)].find((b) => b.textContent.trim() === t).click(); }, scope, text);

const permanent = { invoice: null };
try {
  const admin = await login("ADMIN");
  await admin.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  const svc = {};
  for (const k of ["REC", "ALT", "UNP", "B1", "B2", "INC1", "INC2"]) {
    const s = (await rest("POST", "services", { code: `S1${tag}-${k}`, name: `Synthetic ${k} ${tag}`, tracking: "manual" }, "return=representation"))[0];
    svc[k] = (await rest("POST", "client_services", { client_id: C1, service_id: s.id, active: true, frequency: "monthly", financials_month: null }, "return=representation"))[0].id;
  }
  const rc = must(await call(admin, "POST", "/api/billing/rate-cards", { name: `S1 ${tag}`, currency: "USD", effectiveFrom: "2026-01-01", reason: "Synthetic" }), "rate card").rateCard.id;
  for (const [k, amount] of [["REC", "125.00"], ["ALT", "75.00"]]) must(await call(admin, "POST", `/api/billing/rate-cards/${rc}/entries`, { serviceCode: `S1${tag}-${k}`, unit: "service", unitAmount: amount, effectiveFrom: "2026-01-01", reason: "Synthetic" }), "entry");
  const addBundle = async (name, members) => { const id = must(await call(admin, "POST", "/api/billing/bundles", { name, clientId: C1, unitAmount: "300.00", effectiveFrom: "2026-01-01", reason: "Synthetic" }), "bundle").bundle.id; must(await call(admin, "PUT", `/api/billing/bundles/${id}/components`, { components: members.map((clientServiceId) => ({ clientServiceId })), reason: "Synthetic" }), "components"); };
  await addBundle(`Package ${tag}`, [svc.B1, svc.B2]);
  await addBundle(`Partial ${tag}`, [svc.INC1, svc.INC2]);
  for (const k of ["REC", "ALT", "UNP", "B1", "B2", "INC1"]) must(await call(admin, "POST", "/api/billing/completion-source-maps", { clientServiceId: svc[k], adapter: "schedule", predicate: {}, identityFields: ["client_service_id", "period"], candidateDateRule: "period_end", effectiveFrom: "2026-01-01", reason: "Synthetic map" }), "map");

  const page = await login("STAFF_BILLING");
  must(await call(page, "POST", "/api/billing/candidates/generate", { clientServiceIds: ["REC", "ALT", "UNP", "B1", "B2", "INC1"].map((k) => svc[k]), from: "2026-11-01", to: "2026-11-30" }), "generate");
  await openBilling(page); await filter(page, "Ready");
  let list = await rows(page);
  const pkg = has(list, `Package ${tag}`);
  rec("S1", "ordinary candidates appear and can be selected", has(list, `REC ${tag}`)?.checkbox && !has(list, `REC ${tag}`).disabled && has(list, `REC ${tag}`).text.includes("$125.00"), has(list, `REC ${tag}`)?.text);
  rec("S2", "a package is one row at one price, listing its services", !!pkg && (pkg.text.match(/\$300\.00/g) || []).length === 1 && pkg.text.includes(`B1 ${tag}`) && pkg.text.includes(`B2 ${tag}`) && !has(list, "$600"), pkg?.text);
  rec("S3", "an incomplete package cannot be selected and says why", has(list, `Partial ${tag}`)?.disabled && /needs all 2 services/.test(has(list, `Partial ${tag}`).text), has(list, `Partial ${tag}`)?.text);

  await filter(page, "No price");
  list = await rows(page);
  rec("S4", "an unpriced candidate shows No price and cannot be selected", has(list, `UNP ${tag}`) && !has(list, `UNP ${tag}`).checkbox && /No price/.test(has(list, `UNP ${tag}`).text), has(list, `UNP ${tag}`)?.text);
  must(await call(admin, "POST", `/api/billing/rate-cards/${rc}/entries`, { serviceCode: `S1${tag}-UNP`, unit: "service", unitAmount: "50.00", effectiveFrom: "2026-01-01", reason: "Synthetic" }), "unp entry");
  await reasonAction(page, `UNP ${tag}`, "Reprice", "Price added");
  const afterReprice = await rows(page);
  await filter(page, "Ready"); list = await rows(page);
  rec("S5", "repricing moves it to Ready at the server's price", !has(afterReprice, `UNP ${tag}`) && has(list, `UNP ${tag}`)?.text.includes("$50.00"), has(list, `UNP ${tag}`)?.text);

  await reasonAction(page, `ALT ${tag}`, "Dismiss", "Client on hold");
  list = await rows(page); const gone = !has(list, `ALT ${tag}`);
  await filter(page, "Dismissed"); const dismissed = has(await rows(page), `ALT ${tag}`);
  await reasonAction(page, `ALT ${tag}`, "Reopen", "Hold resolved");
  await filter(page, "Ready");
  rec("S6", "dismiss and reopen move a candidate between lists", gone && !!dismissed && !!has(await rows(page), `ALT ${tag}`));

  await tick(page, `REC ${tag}`); await tick(page, `Package ${tag}`); await wait(400);
  const summary = await page.evaluate(() => document.querySelector("[data-candidate-draft] h3")?.innerText || "");
  rec("S7", "selecting shows a count, with no browser-calculated total", /2 selected items/.test(summary) && !/\$/.test(summary), summary);
  const memoBox = await page.$("[data-candidate-draft] textarea"); await memoBox.type(`Synthetic screen 1 ${tag}`);
  await clickText(page, "[data-candidate-draft]", "Create draft"); await wait(3500);
  const inv = (await rest("GET", `invoices?select=id,status,invoice_number,invoice_lines(id,description,quantity,unit_amount,amount)&memo=eq.${encodeURIComponent(`Synthetic screen 1 ${tag}`)}`))[0];
  permanent.invoice = inv?.id;
  const pkgLine = inv?.invoice_lines.find((l) => l.description === `Package ${tag}`);
  rec("S8", "the server builds the draft: two lines, one package line at the package price", inv?.status === "draft" && inv.invoice_lines.length === 2 && Number(pkgLine?.amount) === 300, `lines=${inv?.invoice_lines.length} package=${pkgLine?.amount}`);
  const detail = await page.evaluate(() => { const d = document.querySelector("[data-invoice-detail]"); return d ? { locked: d.querySelectorAll("[data-line-locked]").length, edit: /Save line/.test(d.innerHTML), rows: d.querySelectorAll("[data-line-row]").length } : null; });
  rec("S9", "the new draft opens and its linked lines are locked", detail?.rows === 2 && detail.locked === 2 && !detail.edit, JSON.stringify(detail));
  list = await rows(page);
  rec("S10", "drafted candidates leave Ready", !has(list, `REC ${tag}`) && !has(list, `Package ${tag}`));

  const recLine = inv.invoice_lines.find((l) => l.description !== `Package ${tag}`);
  await page.evaluate((id) => { [...document.querySelector(`[data-line-row="${id}"]`).querySelectorAll("button")].find((b) => /Remove and return/.test(b.textContent)).click(); }, recLine.id); await wait(3000);
  rec("S11", "removing a linked line returns its candidate to Ready", !!has(await rows(page), `REC ${tag}`) && (await page.$$("[data-line-row]")).length === 1);

  page.calls.length = 0;
  await clickText(page, "[data-invoice-detail]", "Issue invoice"); await wait(3500);
  const issued = (await rest("GET", `invoices?select=status,invoice_number&id=eq.${inv.id}`))[0];
  rec("S12", "issue uses the explicit endpoint and the server assigns the number", issued.status === "issued" && !!issued.invoice_number && page.calls.some((c) => c.endsWith(`/invoices/${inv.id}/issue`)), `${issued.status} ${page.calls.join(" ")}`);
  rec("S13", "Billing staff get no void control", !(await page.$("[data-void-control]")));
  rec("S14", "no page errors as Billing staff", page.errors.length === 0, page.errors.join("; "));

  await openBilling(admin); await wait(1500);
  await admin.evaluate((id) => document.querySelector(`[data-invoice-row="${id}"] button`).click(), inv.id); await wait(800);
  await admin.evaluate(() => { document.querySelector("[data-void-control]").open = true; });
  const vbox = await admin.$("[data-void-control] textarea"); await vbox.type("Synthetic void");
  admin.calls.length = 0;
  await admin.evaluate(() => document.querySelector("[data-void-control] button[type=submit]").click()); await wait(3500);
  const voided = (await rest("GET", `invoices?select=status&id=eq.${inv.id}`))[0];
  await filter(admin, "Ready");
  rec("S15", "void uses the explicit endpoint and the package returns to Ready", voided.status === "void" && admin.calls.some((c) => c.endsWith(`/invoices/${inv.id}/void`)) && !!has(await rows(admin), `Package ${tag}`), `${voided.status} ${admin.calls.join(" ")}`);
  rec("S16", "no page errors as Admin", admin.errors.length === 0, admin.errors.join("; "));
} finally { await browser.close(); }
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
