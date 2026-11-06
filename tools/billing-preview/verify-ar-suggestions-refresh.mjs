// SANDBOX / VERCEL PREVIEW. Refreshes parser suggestions on one existing A/R batch through the real UI as Collections staff and proves
// reviewer decisions, approval state and the Collections pipeline are unchanged. Report content is restricted: this prints counts and
// statuses only, never customer names, amounts, file names or row text, and takes no screenshots.
// Env: BILLING_PREVIEW_URL, BILLING_SANDBOX_HOST, BILLING_PREVIEW_ENV_FILE, AR_BATCH_ID, PUPPETEER_CORE, CHROME_PATH.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const BASE = (process.env.BILLING_PREVIEW_URL || "").replace(/\/$/, "");
const env = Object.fromEntries(readFileSync(process.env.BILLING_PREVIEW_ENV_FILE || ".env.preview.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_0-9]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const API = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
if (new URL(API).host !== process.env.BILLING_SANDBOX_HOST) throw new Error("Refusing: the Supabase host in the env file is not BILLING_SANDBOX_HOST");
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Accept-Profile": "tap_hub_project", Prefer: "count=exact" };
const db = async (p) => { const r = await fetch(`${API}/rest/v1/${p}`, { headers: H }); if (!r.ok) throw new Error(`${p.split("?")[0]} ${r.status}`); return r.json(); };
const batches = await db("collection_import_batches?select=id,status,approved_by,approved_at,report_type,source_as_of,metadata");
const batch = batches.find((b) => b.id.startsWith(process.env.AR_BATCH_ID));
if (!batch) throw new Error("batch not found");
const allRows = async () => { const out = []; for (let from = 0; ; from += 1000) { const r = await fetch(`${API}/rest/v1/collection_import_rows?select=id,review_disposition,source_invoice_id,parsed_fields&batch_id=eq.${batch.id}&order=page_number,row_number`, { headers: { ...H, Range: `${from}-${from + 999}` } }); const j = await r.json(); out.push(...j); if (j.length < 1000) return out; } };
const count = async (t) => { const r = await fetch(`${API}/rest/v1/${t}?select=*&limit=1`, { headers: H }); if (!r.ok) return `err${r.status}`; return Number((r.headers.get("content-range") || "/0").split("/")[1]); };
const pipeline = async () => ({ invoices: await count("collection_import_invoices"), identities: await count("collection_source_invoice_identities"), attempts: await count("collection_delivery_attempts"), events: await count("collection_events") });
const tally = (rows, f) => rows.reduce((m, r) => { const k = f(r); m[k] = (m[k] || 0) + 1; return m; }, {});
const sug = (r) => { const s = r.parsed_fields?.auto_suggestion; return s ? `${s.disposition}/${s.confidence}` : "none"; };

const before = await allRows(); const pipeBefore = await pipeline();
const decided = new Map(before.filter((r) => r.review_disposition !== "unreviewed").map((r) => [r.id, r.review_disposition]));
console.log("BEFORE", JSON.stringify({ status: batch.status, parser: batch.metadata?.suggestion_parser, rows: before.length, dispositions: tally(before, (r) => r.review_disposition), suggestions: tally(before, sug), pipeline: pipeBefore }));

const { default: puppeteer } = await import(pathToFileURL(process.env.PUPPETEER_CORE).href);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = []; const rec = (id, n, ok, ev = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${n} :: ${String(ev).slice(0, 220)}`); };
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 1000 });
  const errors = []; page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 100)));
  let parseStatus = null; page.on("response", (r) => { if (/\/imports\/[^/]+\/parse$/.test(r.url())) parseStatus = r.status(); });
  await page.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
  const st = await page.evaluate(async (i, w) => (await fetch("/api/auth/sign-in", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier: i, password: w }) })).status, env.TEST_STAFF_COLLECTIONS_EMAIL, env.TEST_STAFF_COLLECTIONS_PASSWORD);
  if (st !== 200) throw new Error(`sign-in ${st}`);
  await page.goto(BASE + "/collections", { waitUntil: "networkidle2", timeout: 60000 }); await wait(1500);
  await page.evaluate(() => { [...document.querySelectorAll("[role=tab],button")].find((b) => b.textContent.trim() === "A/R reports")?.click(); });
  await page.waitForSelector(`[data-import-batch="${batch.id}"]`, { timeout: 30000 });
  await page.evaluate((id) => document.querySelector(`[data-import-batch="${id}"] button`).click(), batch.id);
  await page.waitForSelector(`[data-import-review="${batch.id}"]`, { timeout: 30000 }); await wait(2500);
  const hadButton = await page.evaluate(() => !!document.querySelector("[data-refresh-suggestions] button"));
  rec("S1", "existing batch opens and offers the refresh", hadButton, `refresh offered=${hadButton}`);
  if (hadButton) {
    await page.evaluate(() => document.querySelector("[data-refresh-suggestions] button").click());
    for (let i = 0; i < 120 && parseStatus === null; i += 1) await wait(1000);
    await wait(4000);
  }
  rec("S2", "the refresh request succeeded", parseStatus === 200, `parse status=${parseStatus}`);
  const after = await allRows(); const pipeAfter = await pipeline();
  const fresh = (await db(`collection_import_batches?select=status,approved_by,approved_at,metadata&id=eq.${batch.id}`))[0];
  const changed = [...decided].filter(([id, d]) => after.find((r) => r.id === id)?.review_disposition !== d).length;
  console.log("AFTER", JSON.stringify({ status: fresh.status, parser: fresh.metadata?.suggestion_parser, rows: after.length, dispositions: tally(after, (r) => r.review_disposition), suggestions: tally(after, sug), pipeline: pipeAfter }));
  rec("S3", "every existing decision is unchanged", after.length === before.length && changed === 0, `decided=${decided.size} changed=${changed}`);
  rec("S4", "no row was linked or staged, batch not approved, pipeline unchanged", after.every((r) => !r.source_invoice_id) && fresh.status === "needs_review" && !fresh.approved_by && !fresh.approved_at && JSON.stringify(pipeAfter) === JSON.stringify(pipeBefore), fresh.status);
  rec("S5", "the batch is recorded on parser v2", fresh.metadata?.suggestion_parser === "quickbooks-aging-detail-v2", fresh.metadata?.suggestion_parser);
  await page.reload({ waitUntil: "networkidle2", timeout: 60000 }); await wait(1500);
  await page.evaluate(() => { [...document.querySelectorAll("[role=tab],button")].find((b) => b.textContent.trim() === "A/R reports")?.click(); });
  await page.waitForSelector(`[data-import-batch="${batch.id}"]`, { timeout: 30000 });
  await page.evaluate((id) => document.querySelector(`[data-import-batch="${id}"] button`).click(), batch.id);
  await page.waitForSelector(`[data-import-review="${batch.id}"]`, { timeout: 30000 }); await wait(3000);
  const dom = await page.evaluate(() => ({
    lines: document.querySelectorAll("[data-import-lines] tbody tr").length,
    invoice: document.querySelectorAll('[data-auto-suggestion="invoice"]').length,
    uncertain: document.querySelectorAll('[data-auto-suggestion="uncertain"]').length,
    candidates: document.querySelectorAll("[data-client-match-suggestions]").length,
    labelSuggested: /Suggested fields:/.test(document.body.innerText),
    labelNeedsReview: /Needs review:/.test(document.body.innerText),
    humanNotice: /confirm|verify|review/i.test(document.querySelector("[data-import-review]")?.innerText || ""),
    approvalBox: document.querySelector("[data-approval-box]")?.getAttribute("data-approval-box") || null,
    approveButton: [...document.querySelectorAll("[data-approval-box] button")].length,
    refreshStillOffered: !!document.querySelector("[data-refresh-suggestions] button"),
  }));
  console.log("DOM", JSON.stringify(dom));
  rec("S6", "suggestions show with labels, and uncertain rows ask for review", dom.invoice > 0 && dom.labelSuggested && dom.labelNeedsReview, `invoice=${dom.invoice} uncertain=${dom.uncertain}`);
  rec("S7", "no page errors", errors.length === 0, errors.join("; "));
} finally { await browser.close(); }
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
