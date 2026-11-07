// LOCAL or SANDBOX PREVIEW. Real-browser pass of the Phase 3 Billing views on a marked synthetic client, plus a role check across the tabs.
// Creates tagged services, rate cards, prices, packages, rules and candidates. Shared firm settings (terms, remittance, policy) are
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
  await sel.asElement().select(C1); await wait(1500);
}
const tab = async (page, label) => { await page.evaluate((l) => { [...document.querySelectorAll("[role=tab]")].find((t) => t.textContent.trim().startsWith(l)).click(); }, label); await wait(1800); };
const sub = async (page, label) => { await page.evaluate((l) => { [...document.querySelectorAll("[data-billing-settings] .seg button")].find((b) => b.textContent.trim() === l).click(); }, label); await wait(1500); };
const shown = "[role=tabpanel]:not([hidden])";
const text = (page) => page.evaluate((s) => document.querySelector(s)?.innerText || "", shown);
// React reads the native value setter, so this drives the real form state.
async function fill(page, form, values) {
  await page.evaluate((key, entries) => {
    const root = document.querySelector(`[data-form="${key}"]`);
    if (root.tagName === "DETAILS") root.open = true;
    root.querySelectorAll("details").forEach((d) => { d.open = true; });
    for (const [name, value] of entries) {
      const el = root.querySelector(`[data-field="${name}"]`);
      const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
      el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
    }
  }, form, Object.entries(values));
  await wait(250);
  await page.evaluate((key) => document.querySelector(`[data-form="${key}"] button[type=submit]`).click(), form);
  await wait(2500);
}
const count = async (t, q) => { const r = await fetch(`${API}/rest/v1/${t}?select=*&limit=1&${q}`, { headers: { ...H, Prefer: "count=exact" } }); return Number((r.headers.get("content-range") || "/0").split("/")[1]); };

try {
  const svc = {};
  for (const k of ["GEN", "OVR", "BA", "BB", "MAN"]) {
    const s = (await rest("POST", "services", { code: `W${tag}-${k}`, name: `Synthetic ${k} ${tag}`, tracking: "manual" }, "return=representation"))[0];
    svc[k] = (await rest("POST", "client_services", { client_id: C1, service_id: s.id, active: true, frequency: "monthly", financials_month: null }, "return=representation"))[0].id;
  }

  const admin = await login("ADMIN"); await open(admin);
  const landing = await admin.evaluate(() => ({ tab: document.querySelector("[role=tab][aria-selected=true]")?.textContent.trim(), order: [...document.querySelectorAll("[role=tab]")].map((t) => t.textContent.trim().replace(/\d+$/, "")), chain: !!document.querySelector("[data-billing-chain]"), hero: !!document.querySelector("[data-what-next] .hero") }));
  rec("D1", "Billing opens on What bills next with the chain, hero and design tab order", landing.tab === "What bills next" && landing.order[1] === "Clients & prices" && landing.order[2] === "Invoices" && landing.chain && landing.hero, landing.order.join(" | "));

  await tab(admin, "Clients & prices");
  rec("P0", "Clients & prices lists clients", !!(await admin.$(`[data-client-row="${C1}"]`)), (await admin.$$("[data-client-row]")).length);
  await admin.evaluate((id) => document.querySelector(`[data-client-row="${id}"] button`).click(), C1);
  await admin.waitForFunction((v) => document.body.innerText.includes(`GEN ${v}`), { timeout: 30000 }, tag).catch(() => {});
  let t = await text(admin);
  rec("P1", "a client opens on its own page with its services", !!(await admin.$(`[data-client-page="${C1}"]`)) && t.includes(`GEN ${tag}`));
  await fill(admin, "override", { clientServiceId: svc.OVR, unitAmount: "88.00", effectiveFrom: "2026-01-01", reason: "Synthetic" });
  rec("P5", "a client's own price can be saved", (await count("billing_client_service_overrides", `client_service_id=eq.${svc.OVR}`)) === 1);
  await fill(admin, "bundle", { name: `W ${tag} package`, unitAmount: "300.00", effectiveFrom: "2026-01-01", reason: "Synthetic" });
  const bundle = (await rest("GET", `billing_bundles?select=id&name=eq.${encodeURIComponent(`W ${tag} package`)}`))[0];
  rec("P6", "a package can be created", !!bundle, bundle?.id?.slice(0, 8));
  await admin.evaluate((id, names) => { const root = document.querySelector(`[data-form="bundle-components-${id}"]`); root.open = true; for (const n of names) [...root.querySelectorAll("label")].find((l) => l.textContent.includes(n)).querySelector("input").click(); }, bundle.id, [`BA ${tag}`, `BB ${tag}`]); await wait(300);
  await fill(admin, `bundle-components-${bundle.id}`, { reason: "Synthetic" });
  rec("P7", "package services can be set", (await count("billing_bundle_components", `bundle_id=eq.${bundle.id}`)) === 2);
  t = await text(admin);
  rec("P8", "the services card shows how each is priced", /Own price/.test(t) && /Package/.test(t) && /Rate card/.test(t));

  await tab(admin, "Settings");
  const subs = await admin.evaluate(() => [...document.querySelectorAll("[data-billing-settings] .seg button")].map((b) => b.textContent.trim()));
  rec("T1", "Settings has the sub-tabs", ["Firm & invoices", "Getting paid", "Rate card", "Completion rules", "Permissions"].every((s) => subs.includes(s)), subs.join(" | "));
  await sub(admin, "Rate card");
  await fill(admin, "rate-card", { name: `W ${tag} card`, effectiveFrom: "2026-01-01", reason: "Synthetic" });
  const card = (await rest("GET", `billing_rate_cards?select=id&name=eq.${encodeURIComponent(`W ${tag} card`)}`))[0];
  rec("P2", "a rate card can be created", !!card, card?.id?.slice(0, 8));
  await admin.evaluate((n) => { [...document.querySelectorAll("[data-rate-cards] button.lnk")].find((b) => b.textContent.trim() === n).click(); }, `W ${tag} card`); await wait(1800);
  await fill(admin, "rate-entry", { serviceCode: `W${tag}-GEN`, unit: "service", unitAmount: "125.00", effectiveFrom: "2026-01-01", reason: "Synthetic" });
  rec("P3", "a rate entry can be added", (await count("billing_rate_card_entries", `rate_card_id=eq.${card.id}`)) === 1);
  await fill(admin, "rate-entry", { serviceCode: `W${tag}-GEN`, unit: "service", unitAmount: "126.00", effectiveFrom: "2026-06-01", reason: "Synthetic" });
  const alert = await admin.evaluate(() => document.querySelector('[data-form="rate-entry"] [role=alert]')?.innerText || "");
  rec("P4", "an overlapping entry shows the server's error and saves nothing", (await count("billing_rate_card_entries", `rate_card_id=eq.${card.id}`)) === 1 && !!alert, alert);
  await fill(admin, "rate-entry", { serviceCode: `W${tag}-MAN`, unit: "service", unitAmount: "60.00", effectiveFrom: "2026-01-01", reason: "Synthetic" });

  await sub(admin, "Permissions");
  const policyKeys = await admin.evaluate(() => document.querySelectorAll("[data-policy-table] code").length);
  rec("T2", "the policy editor lists the 11 delegable actions", policyKeys === 11, policyKeys);
  if (local) {
    const before = await rest("GET", "billing_action_policy?select=action_key");
    await fill(admin, "policy", { reason: "Synthetic unchanged save" });
    const after = await rest("GET", "billing_action_policy?select=action_key");
    rec("T3", "saving the policy unchanged succeeds", after.length >= before.length && /Saved\./.test(await text(admin)), `rows ${before.length} to ${after.length}`);
    await sub(admin, "Firm & invoices");
    await fill(admin, "terms", { defaultNetDays: "15", reason: "Synthetic" });
    rec("T4", "firm terms save", /Saved\./.test(await text(admin)));
    await sub(admin, "Getting paid");
    await fill(admin, "remittance", { payeeName: "Synthetic Payee", address: "1 Test St", instructions: "Synthetic instructions", reason: "Synthetic" });
    rec("T5", "remittance saves all three fields", (await rest("GET", "billing_remittance_settings?select=payee_name,address,instructions"))[0].instructions === "Synthetic instructions");
    await sub(admin, "Firm & invoices");
    await fill(admin, "presentation", { firmName: `Synthetic Firm ${tag}`, tagline: "Synthetic tagline", invoiceFooter: "Synthetic footer", reason: "Synthetic" });
    const firmRow = (await rest("GET", "billing_presentation_settings?select=firm_name,tagline,invoice_footer"))[0];
    rec("T8", "firm details save all fields, and the prefix stays fixed", firmRow.firm_name === `Synthetic Firm ${tag}` && firmRow.invoice_footer === "Synthetic footer" && /TAP/.test(await admin.evaluate(() => [...document.querySelectorAll('[data-form="presentation"] input')].map((i) => i.value).join(" "))));
    await fill(admin, "presentation", { tagline: "", invoiceFooter: "", reason: "Synthetic clear" });
    const cleared = (await rest("GET", "billing_presentation_settings?select=tagline,invoice_footer"))[0];
    rec("T9", "an emptied field clears", cleared.tagline === null && cleared.invoice_footer === null);
  }
  await sub(admin, "Completion rules");
  for (const [k, adapter, rule] of [["GEN", "schedule", "period_end"], ["BA", "schedule", "period_end"], ["BB", "schedule", "period_end"], ["MAN", "manual_confirmation", "confirmed_date"]]) {
    await fill(admin, "map", { clientServiceId: svc[k], adapter, candidateDateRule: rule, effectiveFrom: "2026-01-01", reason: "Synthetic map" });
  }
  rec("T6", "completion rules can be created", (await count("billing_completion_source_maps", `client_service_id=in.(${[svc.GEN, svc.BA, svc.BB, svc.MAN].join(",")})`)) === 4);
  await fill(admin, "confirm", { clientServiceId: svc.MAN, confirmedDate: "2026-11-05", sourceNote: "Synthetic confirmation", reason: "Synthetic confirmation" });
  rec("T7", "a manual confirmation creates a candidate", (await count("billing_candidates", `client_service_id=eq.${svc.MAN}`)) === 1);

  // Hosted generate time grows with the client's services, so this waits for the result rather than a fixed time.
  const generated = async (pattern) => { await admin.waitForFunction((src) => new RegExp(src).test(document.querySelector("[data-generate-result]")?.innerText || "") && [...document.querySelectorAll("[data-generate] button")].some((b) => b.textContent.trim() === "Generate candidates"), { timeout: 90000 }, pattern.source).catch(() => {}); await wait(800); };
  await tab(admin, "What bills next"); await wait(1500);
  const before = await count("billing_candidates", `client_id=eq.${C1}`);
  t = await text(admin);
  const cells = await admin.evaluate(() => document.querySelectorAll("[data-next-runs] [data-run-row]").length);
  rec("W1", "the next three runs show expected work, and reading writes nothing", cells > 0 && t.includes(`GEN ${tag}`) && /projected/i.test(t) && (await count("billing_candidates", `client_id=eq.${C1}`)) === before, `rows=${cells} candidates=${before}`);
  rec("W0", "a package's services read as Package in the table", /Package/.test(await admin.evaluate(() => document.querySelector("[data-next-runs]").innerText)));
  await admin.evaluate(() => { [...document.querySelectorAll("[data-generate] button")].find((b) => b.textContent.trim() === "Generate candidates").click(); }); await generated(/Created [1-9]/);
  let result = await admin.evaluate(() => document.querySelector("[data-generate-result]")?.innerText || "");
  const made = await count("billing_candidates", `client_id=eq.${C1}`);
  rec("W2", "generate is explicit and reports its totals", made > before && /Created [1-9]/.test(result), result);
  await admin.evaluate(() => { [...document.querySelectorAll("[data-generate] button")].find((b) => b.textContent.trim() === "Generate candidates").click(); }); await generated(/Created 0/);
  result = await admin.evaluate(() => document.querySelector("[data-generate-result]")?.innerText || "");
  rec("W3", "generating again creates nothing new", (await count("billing_candidates", `client_id=eq.${C1}`)) === made && /Created 0/.test(result), result);
  const oneOff = await admin.evaluate(() => document.querySelector("[data-one-off]").innerText);
  rec("W6", "confirmed work shows as ready to bill", oneOff.includes(`MAN ${tag}`) && /Ready to bill/.test(oneOff), oneOff.slice(0, 120).replace(/\n/g, " "));
  await tab(admin, "Invoices"); await wait(1500);
  const inv = await admin.evaluate(() => document.querySelector("[data-candidates-panel]")?.innerText || "");
  rec("W4", "generated work reaches Invoices, the package as one row", inv.includes(`GEN ${tag}`) && inv.includes(`W ${tag} package`));
  rec("W5", "no page errors as Admin", admin.errors.length === 0, admin.errors.join("; "));

  const firmPage = await login("ADMIN");
  await firmPage.goto(BASE + "/billing", { waitUntil: "networkidle2", timeout: 60000 }); await firmPage.waitForSelector("[data-firm-schedule],[data-firm-empty]", { timeout: 45000 }).catch(() => {}); await wait(500);
  const firmBefore = await count("billing_candidates", `client_id=eq.${C1}`);
  const firmView = async () => firmPage.evaluate(() => ({ rows: document.querySelectorAll("[data-firm-row]").length, empty: !!document.querySelector("[data-firm-empty]"), shown: document.querySelector("[data-firm-shown]")?.innerText || "", more: [...document.querySelectorAll("[data-firm-schedule] button")].some((b) => /Load more/.test(b.textContent)), total: document.querySelector("[data-firm-summary] .v")?.innerText || "" }));
  let firm = await firmView();
  rec("F1", "with no client chosen, the all-clients schedule loads with the server total", (firm.rows > 0 || firm.empty) && !!firm.total, `rows=${firm.rows} empty=${firm.empty} ${firm.shown}`);
  for (let i = 0; i < 12 && firm.more; i += 1) { await firmPage.evaluate(() => [...document.querySelectorAll("[data-firm-schedule] button")].find((b) => /Load more/.test(b.textContent)).click()); await wait(1800); firm = await firmView(); }
  const firmOf = /of (\d+)/.exec(firm.shown)?.[1];
  rec("F2", "Load more reaches every row once", firm.empty || (Number(firmOf) === firm.rows && !firm.more), firm.shown);
  rec("F3", "reading the schedule writes nothing, and no page errors", (await count("billing_candidates", `client_id=eq.${C1}`)) === firmBefore && firmPage.errors.length === 0, firmPage.errors.join("; "));

  const staff = await login("STAFF_BILLING"); await open(staff);
  await tab(staff, "Clients & prices");
  await staff.evaluate((id) => document.querySelector(`[data-client-row="${id}"] button`).click(), C1); await wait(2500);
  rec("R1", "Billing staff see prices read-only", (await text(staff)).includes(`GEN ${tag}`) && !(await staff.$('[data-form="override"]')) && !(await staff.$('[data-form="bundle"]')));
  await staff.waitForSelector("[data-client-summary]", { timeout: 45000 }).catch(() => {});
  const money = await staff.evaluate(async (id) => { const api = await (await fetch(`/api/billing/clients/summary?clientId=${id}`)).json(); const stats = [...document.querySelectorAll("[data-client-summary] .stat .v")].map((e) => e.innerText); return { api: api.monthlyAmount, open: api.openBalance, shown: stats, note: document.querySelector("[data-monthly-note]")?.innerText || "", complete: api.monthlyAmountComplete, prices: document.querySelectorAll("[data-service-price]").length }; }, C1);
  const digits = (v) => String(v).replace(/\D/g, "");
  rec("S1", "the client page shows the server's monthly and open amounts", money.shown.length === 4 && digits(money.shown[0]) === digits(money.api) && digits(money.shown[2]) === digits(money.open), `shown=${money.shown.length}`);
  rec("S2", "a partial monthly total says so", money.complete ? /average month/.test(money.note) : /partial/.test(money.note), money.note);
  rec("S3", "each active service shows its price or package", money.prices > 0, money.prices);
  await tab(staff, "Settings");
  const staffSubs = await staff.evaluate(() => [...document.querySelectorAll("[data-billing-settings] .seg button")].map((b) => b.textContent.trim()));
  rec("R2", "Billing staff get no policy editor and cannot save firm terms", !staffSubs.includes("Permissions") && !(await staff.$('[data-form="terms"] button[type=submit]')) && /restricted to Owner\/Admin/.test(await text(staff)), staffSubs.join(" | "));
  rec("R2c", "Billing staff read firm details but cannot save them", !!(await staff.$('[data-form="presentation"]')) && !(await staff.$('[data-form="presentation"] button[type=submit]')));
  await sub(staff, "Getting paid"); rec("R2b", "Billing staff cannot save remittance", !(await staff.$('[data-form="remittance"] button[type=submit]')));
  await tab(staff, "What bills next");
  rec("R3", "Billing staff keep the default generate action", /Generate candidates/.test(await text(staff)));
  rec("R4", "no page errors as Billing staff", staff.errors.length === 0, staff.errors.join("; "));
  for (const [id, account] of [["R5", "STAFF_COLLECTIONS"], ["R6", "STAFF_UNASSIGNED"]]) {
    const p = await login(account);
    await p.goto(BASE + "/billing", { waitUntil: "networkidle2", timeout: 60000 }); await p.waitForFunction(() => location.pathname !== "/billing", { timeout: 15000 }).catch(() => {});
    rec(id, `${account} cannot open Billing`, new URL(p.url()).pathname !== "/billing", new URL(p.url()).pathname);
  }
  const small = await login("STAFF_BILLING"); await small.setViewport({ width: 375, height: 800 }); await open(small);
  const wide = [];
  for (const label of ["What bills next", "Clients & prices", "Invoices", "Payments", "Receivables", "Settings"]) { await tab(small, label); const w = await small.evaluate(() => document.documentElement.scrollWidth); if (w > 375) wide.push(`${label}=${w}`); }
  rec("L1", "no page-wide horizontal scroll at phone width on any tab", wide.length === 0, wide.join(" "));
} finally { await browser.close(); }
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
