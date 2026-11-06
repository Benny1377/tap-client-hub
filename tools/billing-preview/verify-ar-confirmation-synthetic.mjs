// SANDBOX / VERCEL PREVIEW. Uses a tagged synthetic A/R batch, never a real report. Checks that a client candidate is shown and prefilled
// only as a suggestion, that confirming stages a review entry without approving anything or reaching the Collections pipeline, and that
// the separate-approver rule refuses each ineligible account. Approval is attempted only by accounts that must be refused, and an
// unreviewed guard row keeps the batch unready. The synthetic batch is removed afterwards where the database allows it, else closed.
// Env: BILLING_PREVIEW_URL, BILLING_SANDBOX_HOST, BILLING_PREVIEW_ENV_FILE, BILLING_PREVIEW_CLIENT_ID, PUPPETEER_CORE, CHROME_PATH.
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const BASE = (process.env.BILLING_PREVIEW_URL || "").replace(/\/$/, "");
const env = Object.fromEntries(readFileSync(process.env.BILLING_PREVIEW_ENV_FILE || ".env.preview.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_0-9]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const API = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
const C1 = process.env.BILLING_PREVIEW_CLIENT_ID;
if (new URL(API).host !== process.env.BILLING_SANDBOX_HOST) throw new Error("Refusing: the Supabase host in the env file is not BILLING_SANDBOX_HOST");
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Accept-Profile": "tap_hub_project", "Content-Profile": "tap_hub_project", "Content-Type": "application/json" };
async function rest(method, path, body, prefer) {
  const r = await fetch(`${API}/rest/v1/${path}`, { method, headers: { ...H, ...(prefer ? { Prefer: prefer } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) { const e = new Error(`${method} ${path.split("?")[0]} ${r.status} ${t.slice(0, 140)}`); e.status = r.status; throw e; }
  return t ? JSON.parse(t) : null;
}
const count = async (t, q = "") => { const r = await fetch(`${API}/rest/v1/${t}?select=*&limit=1${q}`, { headers: { ...H, Prefer: "count=exact" } }); return r.ok ? Number((r.headers.get("content-range") || "/0").split("/")[1]) : `err${r.status}`; };
const results = []; const rec = (id, n, ok, ev = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${n} :: ${String(ev).slice(0, 220)}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const client = (await rest("GET", `clients?select=id,name&id=eq.${C1}`))[0];
if (!client || !/synthetic|test/i.test(client.name)) throw new Error("Refusing: the client is not marked synthetic");
const profile = async (e) => (await rest("GET", `profiles?select=id&email=eq.${encodeURIComponent(e)}`))[0].id;
const adminId = await profile(env.TEST_ADMIN_EMAIL);
const ownerId = (await rest("GET", "profiles?select=id&role=eq.owner"))[0].id;
const tag = randomUUID().slice(0, 8);
const fuzzy = client.name.replace("Matrix", "Matrx");
const suggestion = (n) => ({ disposition: "invoice", confidence: "high", reason: "Invoice row matches all required report columns", fields: { transaction_type: "Invoice", transaction_date: "2026-01-02", invoice_number: `SYN-${tag}-${n}`, customer_name: fuzzy, terms: null, po_number: null, due_date: "2026-01-17", reported_aging: 14, open_balance: "10.00" } });
const realBefore = JSON.stringify(await rest("GET", "collection_import_batches?select=id,status,approved_by&original_filename=not.like.SYNTHETIC*&order=id"));
const pipeBefore = { attempts: await count("collection_delivery_attempts"), events: await count("collection_events") };

const batchId = randomUUID();
await rest("POST", "collection_import_batches", { id: batchId, file_sha256: createHash("sha256").update(tag).digest("hex"), storage_path: `synthetic/${tag}.pdf`, original_filename: `SYNTHETIC candidate check ${tag}.pdf`, content_type: "application/pdf", file_size_bytes: 1, report_type: "aging_detail", source_as_of: "2026-01-31", status: "needs_review", uploaded_by: adminId, parsed_at: new Date().toISOString(), metadata: { suggestion_parser: "quickbooks-aging-detail-v2", synthetic: true } }, "return=minimal");
const cellsOf = (n) => ["Invoice", "01/02/2026", `SYN-${tag}-${n}`, fuzzy, "01/17/2026", "14", "10.00"];
await rest("POST", "collection_import_rows", [1, 2, 3].map((n) => ({ batch_id: batchId, page_number: 1, row_number: n, raw_text: cellsOf(n).join(" | "), parsed_fields: { cells: cellsOf(n), cell_positions: [], auto_suggestion: suggestion(n) } })), "return=minimal");
const rows = await rest("GET", `collection_import_rows?select=id,row_number&batch_id=eq.${batchId}&order=row_number`);
const r1 = rows[0].id, r3 = rows[2].id;
const staged = () => count("collection_import_invoices", `&batch_id=eq.${batchId}`);
const batchState = async () => (await rest("GET", `collection_import_batches?select=status,approved_by,approved_at&id=eq.${batchId}`))[0];

const { default: puppeteer } = await import(pathToFileURL(process.env.PUPPETEER_CORE).href);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true });
async function login(account) {
  const ctx = await browser.createBrowserContext(); const page = await ctx.newPage(); await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
  const st = await page.evaluate(async (i, w) => (await fetch("/api/auth/sign-in", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier: i, password: w }) })).status, env[`TEST_${account}_EMAIL`], env[`TEST_${account}_PASSWORD`]);
  if (st !== 200) throw new Error(`sign-in ${account} ${st}`);
  return page;
}
const call = (page, method, path, body) => page.evaluate(async (m, p, b) => { const r = await fetch(p, { method: m, headers: b ? { "Content-Type": "application/json" } : {}, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, text: await r.text() }; }, method, path, body);
let approvedSomething = false;
const tryApprove = async (page) => { const r = await call(page, "POST", `/api/collections/imports/${batchId}/approve`); if (r.status === 200) approvedSomething = true; return r; };

try {
  const page = await login("STAFF_COLLECTIONS");
  await page.goto(BASE + "/collections", { waitUntil: "networkidle2", timeout: 60000 }); await wait(1500);
  await page.evaluate(() => { [...document.querySelectorAll("[role=tab],button")].find((b) => b.textContent.trim() === "A/R reports")?.click(); });
  await page.waitForSelector(`[data-import-batch="${batchId}"]`, { timeout: 30000 });
  await page.evaluate((id) => document.querySelector(`[data-import-batch="${id}"] button`).click(), batchId);
  await page.waitForSelector(`[data-import-review="${batchId}"]`, { timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll("[data-client-match-suggestions]").length > 0, { timeout: 30000 });
  const shown = await page.evaluate(() => ({ n: document.querySelectorAll("[data-client-match-suggestions]").length, text: document.querySelector("[data-client-match-suggestions]").innerText }));
  rec("C1", "candidate is shown, ranked and labelled as needing verification", shown.n === 3 && /ranked by name similarity; verify before saving/.test(shown.text) && shown.text.includes(client.name), shown.text);

  await page.evaluate((id) => { const tr = [...document.querySelectorAll("[data-import-lines] tbody tr")].find((t) => t.querySelector(`[data-client-match-suggestions="${id}"]`)); [...tr.querySelectorAll("button")].find((b) => /Review suggestion/.test(b.textContent)).click(); }, r1);
  await page.waitForSelector(`[data-mapping-form="${r1}"]`, { timeout: 15000 });
  const form = await page.evaluate((id, c) => { const f = document.querySelector(`[data-mapping-form="${id}"]`); return { selected: [...f.querySelectorAll("select")].some((s) => s.value === c), note: !!f.querySelector("[data-client-candidate-note]"), confirmed: f.querySelector('[data-field="confirmed"]')?.checked ?? f.querySelector("input[type=checkbox]")?.checked ?? null }; }, r1, C1);
  rec("C2", "form prefills the candidate, says it is not a link, and leaves confirmation unticked", form.selected && form.note && form.confirmed === false, JSON.stringify(form));
  rec("C3", "opening and prefilling writes nothing", (await staged()) === 0, `staged=${await staged()}`);

  await page.evaluate((id) => document.querySelector(`[data-mapping-form="${id}"] button[type=submit]`).click(), r1); await wait(1500);
  rec("C4", "saving without ticking confirmation is blocked", (await staged()) === 0, `staged=${await staged()}`);

  await page.evaluate((id) => { const f = document.querySelector(`[data-mapping-form="${id}"]`); (f.querySelector('[data-field="confirmed"]') || f.querySelector("input[type=checkbox]")).click(); }, r1); await wait(300);
  await page.evaluate((id) => document.querySelector(`[data-mapping-form="${id}"] button[type=submit]`).click(), r1); await wait(3500);
  const row1 = (await rest("GET", `collection_import_rows?select=review_disposition,source_invoice_id&id=eq.${r1}`))[0];
  const st1 = await batchState();
  rec("C5", "confirming stages one review entry for this row", (await staged()) === 1 && row1.review_disposition === "invoice" && !!row1.source_invoice_id, `staged=${await staged()} row=${row1.review_disposition}`);
  rec("C6", "confirming does not approve the batch", st1.status === "needs_review" && !st1.approved_by && !st1.approved_at, st1.status);
  const pipe = await call(page, "GET", "/api/collections/receivables");
  rec("C7", "the confirmed invoice is not in the Collections pipeline", pipe.status === 200 && !pipe.text.includes(`SYN-${tag}`), `receivables ${pipe.status}, ${pipe.text.length} bytes`);
  rec("C8", "no delivery attempts or events were created", (await count("collection_delivery_attempts")) === pipeBefore.attempts && (await count("collection_events")) === pipeBefore.events, JSON.stringify(pipeBefore));

  const a1 = await tryApprove(page);
  rec("A1", "the reviewer who confirmed cannot approve (no approve permission)", a1.status === 403, `${a1.status} ${a1.text.slice(0, 110)}`);
  const admin = await login("ADMIN");
  const a2 = await tryApprove(admin);
  rec("A2", "the uploader cannot approve, even as Admin", a2.status !== 200 && /uploader or a batch corrector/i.test(a2.text), `${a2.status} ${a2.text.slice(0, 110)}`);
  await rest("PATCH", `collection_import_batches?id=eq.${batchId}`, { uploaded_by: ownerId }, "return=minimal");
  const cl = await call(admin, "PATCH", `/api/collections/imports/${batchId}`, { row_id: r3, disposition: "ignored" });
  const a3 = await tryApprove(admin);
  rec("A3", "a reviewer who classified a line cannot approve, even as Admin", cl.status === 200 && a3.status !== 200 && /uploader or a batch corrector/i.test(a3.text), `classify ${cl.status}, approve ${a3.status} ${a3.text.slice(0, 110)}`);
  const end = await batchState();
  rec("A4", "the batch is still not approved", end.status === "needs_review" && !end.approved_by && !approvedSomething, end.status);
  const realAfter = JSON.stringify(await rest("GET", "collection_import_batches?select=id,status,approved_by&original_filename=not.like.SYNTHETIC*&order=id"));
  rec("A5", "real report batches are unchanged", realAfter === realBefore);
} finally {
  await browser.close();
  let cleaned = "removed";
  try {
    const inv = await rest("GET", `collection_import_invoices?select=source_invoice_id&batch_id=eq.${batchId}`);
    await rest("PATCH", `collection_import_rows?batch_id=eq.${batchId}`, { source_invoice_id: null }, "return=minimal");
    await rest("DELETE", `collection_import_invoice_revisions?batch_id=eq.${batchId}`, undefined, "return=minimal");
    await rest("DELETE", `collection_import_invoices?batch_id=eq.${batchId}`, undefined, "return=minimal");
    for (const i of inv) await rest("DELETE", `collection_source_invoice_identities?source_invoice_id=eq.${i.source_invoice_id}`, undefined, "return=minimal");
    await rest("DELETE", `collection_import_rows?batch_id=eq.${batchId}`, undefined, "return=minimal");
    await rest("DELETE", `collection_import_audit?batch_id=eq.${batchId}`, undefined, "return=minimal");
    await rest("DELETE", `collection_import_batches?id=eq.${batchId}`, undefined, "return=minimal");
  } catch (e) {
    cleaned = `not fully removed (${e.message.slice(0, 120)})`;
    try { await rest("PATCH", `collection_import_batches?id=eq.${batchId}`, { status: "rejected" }, "return=minimal"); cleaned += ", closed as rejected"; } catch (e2) { cleaned += `, close failed ${e2.status}`; }
  }
  console.log(`CLEANUP ${cleaned} batch=${batchId.slice(0, 8)}`);
}
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
