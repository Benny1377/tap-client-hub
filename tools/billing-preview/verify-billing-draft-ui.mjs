// SANDBOX / VERCEL PREVIEW (or disposable local). Real-browser pass as Billing staff through the merged PracticeOps Billing screen:
// creates a draft on a marked synthetic client through the form, checks how it renders, then deletes it. Audit rows remain.
// Env: BILLING_PREVIEW_URL, BILLING_SANDBOX_HOST, BILLING_PREVIEW_CLIENT_ID, BILLING_PREVIEW_ALLOW_WRITES=yes,
// BILLING_PREVIEW_ENV_FILE, PUPPETEER_CORE, CHROME_PATH. Never prints credentials.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const BASE = (process.env.BILLING_PREVIEW_URL || "").replace(/\/$/, "");
const env = Object.fromEntries(readFileSync(process.env.BILLING_PREVIEW_ENV_FILE || ".env.preview.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_0-9]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const C1 = process.env.BILLING_PREVIEW_CLIENT_ID || "";
const API = (env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
if (process.env.BILLING_PREVIEW_ALLOW_WRITES !== "yes") throw new Error("Refusing: BILLING_PREVIEW_ALLOW_WRITES=yes is required");
if (!API || new URL(API).host !== process.env.BILLING_SANDBOX_HOST) throw new Error("Refusing: the Supabase host in the env file is not BILLING_SANDBOX_HOST");
const db = async (p) => (await fetch(`${API}/rest/v1/${p}`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Accept-Profile": "tap_hub_project" } })).json();
const client = (await db(`clients?select=name&id=eq.${C1}`))[0];
if (!client || !/synthetic|test/i.test(client.name)) throw new Error("Refusing: the client is not marked synthetic");
const { default: puppeteer } = await import(pathToFileURL(process.env.PUPPETEER_CORE).href);

const results = [];
const rec = (id, name, ok, ev = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${name} :: ${String(ev).slice(0, 200)}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const memo = `Synthetic UI smoke ${Date.now()}`;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true });
let draftId = null;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 140)));
  await page.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
  const status = await page.evaluate(async (identifier, password) => (await fetch("/api/auth/sign-in", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier, password }) })).status, env.TEST_STAFF_BILLING_EMAIL, env.TEST_STAFF_BILLING_PASSWORD);
  if (status !== 200) throw new Error(`sign-in ${status}`);
  await page.goto(BASE + "/billing", { waitUntil: "networkidle2", timeout: 60000 });
  await wait(1500);
  rec("B1", "/billing loads in the PracticeOps shell", await page.evaluate(() => /PracticeOps/.test(document.body.innerText) && !!document.querySelector(".bc-page")), new URL(page.url()).pathname);

  await page.waitForFunction((id) => [...document.querySelectorAll("select option")].some((o) => o.value === id), { timeout: 30000 }, C1);
  const sel = await page.evaluateHandle((id) => [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === id)), C1);
  await sel.asElement().select(C1);
  await wait(2000);
  await page.evaluate(() => { [...document.querySelectorAll("summary")].find((s) => /New draft invoice/.test(s.textContent))?.click(); });
  await wait(400);
  const form = await page.evaluate(() => { const d = [...document.querySelectorAll("details")].find((x) => /New draft invoice/.test(x.textContent)); return { labels: [...d.querySelectorAll("label")].map((l) => l.textContent.trim()), date: d.querySelectorAll("input[type=date]").length }; });
  rec("B2", "new-draft form asks for a memo only", form.date === 0 && !form.labels.some((l) => /number|issue|due/i.test(l)), form.labels.join(" | "));
  const ta = await page.$("details textarea");
  await ta.type(memo);
  await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => /Create draft invoice/.test(b.textContent))?.click(); });
  await wait(3500);
  const row = (await db(`invoices?select=id,status,invoice_number,issue_date,due_date&client_id=eq.${C1}&memo=eq.${encodeURIComponent(memo)}`))[0];
  draftId = row?.id ?? null;
  rec("B3", "the form created a draft with no number or dates", row?.status === "draft" && row.invoice_number === null && row.issue_date === null && row.due_date === null, row ? row.status : "no row");
  const view = await page.evaluate((id) => {
    const tr = document.querySelector(`[data-invoice-row="${id}"]`);
    const detail = [...document.querySelectorAll("section")].find((s) => s.getAttribute("aria-label") === "Invoice detail");
    return { cells: tr ? [...tr.children].map((c) => c.innerText.trim()) : null, heading: detail?.querySelector("h3")?.innerText.trim() || "", note: /assigned when the invoice is issued/i.test(detail?.innerText || "") };
  }, draftId);
  rec("B4", "list row shows Draft and a dash for each date, never a blank", !!view.cells && view.cells[0] === "Draft" && view.cells[1] === "—" && view.cells[3] === "—", JSON.stringify(view.cells));
  rec("B5", "detail names the draft and explains number and dates", /draft/i.test(view.heading.replace(/^Invoice detail/, "")) && view.note, JSON.stringify(view.heading));
  rec("B6", "no page errors", errors.length === 0, errors.join("; "));
  const del = await page.evaluate(async (id) => (await fetch(`/api/billing/invoices/${id}`, { method: "DELETE" })).status, draftId);
  const gone = (await db(`invoices?select=id&id=eq.${draftId}`)).length === 0;
  rec("Z", "the draft is deleted", del >= 200 && del < 300 && gone, del);
  if (gone) draftId = null;
} finally {
  await browser.close();
  if (draftId) console.log(`LEFT BEHIND draft ${draftId}`);
}
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
