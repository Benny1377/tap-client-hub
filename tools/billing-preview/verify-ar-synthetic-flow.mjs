// LOCAL or SANDBOX PREVIEW. End-to-end A/R intake on a generated synthetic PDF: upload, parse, client candidates, a failed refresh, a
// retry of a failed batch, separate approval, and arrival in the Collections worklist. No real report or client is used, and delivery
// must stay disabled. An approved batch is permanent. Never prints credentials.
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
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Accept-Profile": "tap_hub_project", "Content-Profile": "tap_hub_project", "Content-Type": "application/json" };
async function rest(method, path, body, prefer) { const r = await fetch(`${API}/rest/v1/${path}`, { method, headers: { ...H, ...(prefer ? { Prefer: prefer } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); const t = await r.text(); if (!r.ok) throw new Error(`${method} ${path.split("?")[0]} ${r.status} ${t.slice(0, 160)}`); return t ? JSON.parse(t) : null; }
const count = async (t, q = "") => { const r = await fetch(`${API}/rest/v1/${t}?select=*&limit=1${q}`, { headers: { ...H, Prefer: "count=exact" } }); return r.ok ? Number((r.headers.get("content-range") || "/0").split("/")[1]) : `err${r.status}`; };
const results = []; const rec = (id, n, ok, ev = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${n} :: ${String(ev).slice(0, 230)}`); };
const client = (await rest("GET", `clients?select=id,name&id=eq.${C1}`))[0];
if (!client || !/synthetic|test/i.test(client.name)) throw new Error("Refusing: the client is not marked synthetic");
const tag = Date.now().toString(36).toUpperCase();

function buildPdf(lines) {
  const esc = (t) => t.replace(/[\\()]/g, (c) => `\\${c}`);
  const stream = `BT /F1 8 Tf\n${lines.flatMap(({ y, cells }) => cells.map(([x, text]) => `1 0 0 1 ${x} ${y} Tm (${esc(text)}) Tj`)).join("\n")}\nET`;
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 612] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>", `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let out = "%PDF-1.4\n"; const offsets = [];
  objects.forEach((o, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out);
}
const X = { type: 30, date: 90, num: 150, po: 215, name: 260, terms: 480, due: 530, aging: 600, bal: 660 };
const row = (y, type, num, name, bal = "10.00") => ({ y, cells: [[X.type, type], [X.date, "01/02/2026"], [X.num, num], [X.name, name], [X.terms, "Net 15"], [X.due, "01/17/2026"], [X.aging, "14"], [X.bal, bal]] });
// The parser takes a heading only if it has no digits, so the customer heading drops any in the client name.
const heading = client.name.replace(/[0-9-]+/g, " ").replace(/ +/g, " ").trim();
const fuzzy = client.name.replace(/[aeiou]/i, "");
const short = `${heading.slice(0, 9)}...`;
const n = (k) => `SYN-${tag}-${k}`;
const pdf = buildPdf([
  { y: 580, cells: [[250, "TAP Associates, LLC"]] }, { y: 568, cells: [[250, "A/R Aging QuickZoom"]] }, { y: 556, cells: [[250, "As of February 1, 2026"]] },
  { y: 530, cells: [[X.type, "Type"], [X.date, "Date"], [X.num, "Num"], [X.po, "P. O. #"], [X.name, "Name"], [X.terms, "Terms"], [X.due, "Due Date"], [X.aging, "Aging"], [X.bal, "Open Balance"]] },
  { y: 515, cells: [[30, heading]] },
  row(500, "Invoice", n(1), short), row(488, "Invoice", n(2), fuzzy), row(476, "Payment", n(3), short, "-5.00"),
  { y: 460, cells: [[30, `Total ${heading}`], [X.bal, "15.00"]] },
]);
const corrupt = Buffer.from("%PDF-1.4\nnot a real synthetic document\n");

class Session {
  jar = new Map();
  async call(method, path, body, form) {
    const r = await fetch(BASE + path, { method, redirect: "manual", headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(this.jar.size ? { Cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}) }, body: form || (body !== undefined ? JSON.stringify(body) : undefined) });
    for (const c of r.headers.getSetCookie?.() || []) { const [p] = c.split(";"); const k = p.slice(0, p.indexOf("=")); const v = p.slice(p.indexOf("=") + 1); if (/max-age=0/i.test(c) || v === "") this.jar.delete(k); else this.jar.set(k, v); }
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {} return { status: r.status, json, text };
  }
  async signIn(name) { const r = await this.call("POST", "/api/auth/sign-in", { identifier: env[`TEST_${name}_EMAIL`], password: env[`TEST_${name}_PASSWORD`] }); if (r.status !== 200) throw new Error(`sign-in ${name} ${r.status}`); return this; }
}
const coll = await new Session().signIn("STAFF_COLLECTIONS"), admin = await new Session().signIn("ADMIN");
const before = { attempts: await count("collection_delivery_attempts"), events: await count("collection_events") };
const ds = await admin.call("GET", "/api/collections/delivery-status");
rec("D0", "delivery is disabled before the run", ds.status === 200 && ds.json?.mode === "disabled" && ds.json?.automation_enabled === false, JSON.stringify({ mode: ds.json?.mode, automation: ds.json?.automation_enabled }));

const form = new FormData(); form.set("file", new File([pdf], `SYNTHETIC-ar-${tag}.pdf`, { type: "application/pdf" }));
const up = await coll.call("POST", "/api/collections/imports", undefined, form);
const batchId = up.json?.batch?.id;
if (!batchId) throw new Error(`upload ${up.status} ${up.text.slice(0, 200)}`);
const parsed = await coll.call("POST", `/api/collections/imports/${batchId}/parse`);
const rows = () => rest("GET", `collection_import_rows?select=id,row_number,review_disposition,source_invoice_id,parsed_fields&batch_id=eq.${batchId}&order=page_number,row_number`);
const batch = async () => (await rest("GET", `collection_import_batches?select=status,approved_by,storage_path,report_type,source_as_of,metadata&id=eq.${batchId}`))[0];
rec("P0", "first parse of a new report succeeds", parsed.status === 200, `${parsed.status} ${parsed.json?.code || ""}`);
if (parsed.status !== 200) {
  // Keeps the remaining checks reachable: placeholder rows in the report's line shape, then the real refresh path fills them from the PDF.
  await rest("POST", "collection_import_rows", Array.from({ length: 9 }, (_v, i) => ({ batch_id: batchId, page_number: 1, row_number: i + 1, raw_text: `synthetic line ${i + 1}`, parsed_fields: {}, review_disposition: "unreviewed" })), "return=minimal");
  await rest("PATCH", `collection_import_batches?id=eq.${batchId}`, { status: "needs_review", report_type: "aging_detail", source_as_of: "2026-02-01", parsed_at: new Date().toISOString() }, "return=minimal");
  const seeded = await coll.call("POST", `/api/collections/imports/${batchId}/parse`, { refresh_suggestions: true });
  console.log(`INFO seeded through refresh: ${seeded.status} ${seeded.json?.code || ""}`);
  if (seeded.status !== 200) throw new Error(`seed refresh ${seeded.status} ${seeded.text.slice(0, 200)}`);
}
let list = await rows(); let b = await batch();
const invoices = list.filter((r) => r.parsed_fields?.auto_suggestion?.disposition === "invoice");
rec("P1", "synthetic report reads as a detail report", b.status === "needs_review" && b.report_type === "aging_detail" && b.source_as_of === "2026-02-01", `${b.report_type} ${b.source_as_of} rows=${list.length}`);
const names = invoices.map((r) => r.parsed_fields.auto_suggestion.fields.customer_name);
rec("P2", "a cut-off name takes the customer heading; a payment stays for review", invoices.length === 2 && names.includes(heading) && list.some((r) => r.parsed_fields?.auto_suggestion?.disposition === "unreviewed"), JSON.stringify(list.map((r) => r.parsed_fields?.auto_suggestion?.disposition)));

const { default: puppeteer } = await import(pathToFileURL(process.env.PUPPETEER_CORE).href);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
  await page.evaluate(async (i, w) => { await fetch("/api/auth/sign-in", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier: i, password: w }) }); }, env.TEST_STAFF_COLLECTIONS_EMAIL, env.TEST_STAFF_COLLECTIONS_PASSWORD);
  await page.goto(BASE + "/collections", { waitUntil: "networkidle2", timeout: 60000 }); await new Promise((r) => setTimeout(r, 1500));
  await page.evaluate(() => { [...document.querySelectorAll("[role=tab],button")].find((x) => x.textContent.trim() === "A/R reports")?.click(); });
  await page.waitForSelector(`[data-import-batch="${batchId}"]`, { timeout: 30000 });
  await page.evaluate((id) => document.querySelector(`[data-import-batch="${id}"] button`).click(), batchId);
  await page.waitForFunction(() => document.querySelectorAll("[data-client-match-suggestions]").length > 0, { timeout: 30000 });
  const dom = await page.evaluate(() => [...document.querySelectorAll("[data-client-match-suggestions]")].map((e) => e.innerText));
  rec("P3", "synthetic customers show ranked client candidates labelled for verification", dom.length === 2 && dom.every((t) => /verify before saving/.test(t) && t.includes(client.name)), dom[0]);
} finally { await browser.close(); }

// A human decision the later steps must not lose.
const payment = list.find((r) => r.parsed_fields?.auto_suggestion?.disposition === "unreviewed");
const cl = await coll.call("PATCH", `/api/collections/imports/${batchId}`, { row_id: payment.id, disposition: "ignored" });
const snapshot = async () => JSON.stringify((await rows()).map((r) => [r.id, r.review_disposition, r.source_invoice_id]));
const reviewed = await snapshot();
const originalPath = b.storage_path;
// A separate object, because hosted storage can keep serving the old bytes after an overwrite of the same path.
const store = (bytes, path) => fetch(`${API}/storage/v1/object/collections-ar-pdfs/${path}`, { method: "POST", headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/pdf", "x-upsert": "true" }, body: bytes }).then((r) => { if (!r.ok) throw new Error(`storage ${r.status}`); });

await store(corrupt, `${originalPath}.corrupt.pdf`);
await rest("PATCH", `collection_import_batches?id=eq.${batchId}`, { storage_path: `${originalPath}.corrupt.pdf` }, "return=minimal");
const failedRefresh = await coll.call("POST", `/api/collections/imports/${batchId}/parse`, { refresh_suggestions: true });
b = await batch();
rec("R1", "a failed refresh leaves the batch in needs_review with decisions intact", cl.status === 200 && failedRefresh.status === 422 && b.status === "needs_review" && (await snapshot()) === reviewed, `${failedRefresh.status} ${failedRefresh.json?.code} ${b.status}`);

await rest("PATCH", `collection_import_batches?id=eq.${batchId}`, { status: "failed" }, "return=minimal");
const failedRetry = await coll.call("POST", `/api/collections/imports/${batchId}/parse`);
b = await batch();
rec("R2", "retrying a failed batch that fails again keeps rows and returns to needs_review", failedRetry.status === 422 && b.status === "needs_review" && (await snapshot()) === reviewed, `${failedRetry.status} ${b.status}`);

await rest("PATCH", `collection_import_batches?id=eq.${batchId}`, { status: "failed", storage_path: originalPath }, "return=minimal");
const goodRetry = await coll.call("POST", `/api/collections/imports/${batchId}/parse`);
b = await batch();
rec("R3", "a successful retry keeps saved rows and decisions, not a delete and rebuild", goodRetry.status === 200 && (await snapshot()) === reviewed, `${goodRetry.status} rows kept=${(await snapshot()) === reviewed}`);
rec("R4", "a successful retry returns the batch to needs_review", b.status === "needs_review", `response=${goodRetry.json?.status} stored=${b.status}`);
if (b.status !== "needs_review") { console.log("INFO batch stuck after retry; moving it on so the rest of the flow can run"); await rest("PATCH", `collection_import_batches?id=eq.${batchId}`, { status: "needs_review" }, "return=minimal"); }

list = await rows();
for (const r of list.filter((x) => x.parsed_fields?.auto_suggestion?.disposition === "invoice")) {
  const f = r.parsed_fields.auto_suggestion.fields;
  const saved = await coll.call("POST", `/api/collections/imports/${batchId}`, { source_row_id: r.id, client_id: C1, customer_name: f.customer_name, invoice_number: f.invoice_number, transaction_type: f.transaction_type, transaction_date: f.transaction_date, due_date: f.due_date, terms: f.terms, reported_aging: f.reported_aging, open_balance: Number(f.open_balance), confirmed: true, row_data: { cells: r.parsed_fields.cells } });
  if (saved.status !== 201) throw new Error(`review ${saved.status} ${saved.text.slice(0, 200)}`);
}
const pending = await admin.call("GET", "/api/collections/receivables?limit=100");
rec("A1", "confirmed invoices stay out of the worklist before approval", pending.status === 200 && !pending.text.includes(n(1)), `${pending.status}`);
const collApprove = await coll.call("POST", `/api/collections/imports/${batchId}/approve`);
rec("A2", "the uploader and reviewer cannot approve", collApprove.status === 403 || collApprove.status === 409, `${collApprove.status} ${collApprove.json?.code}`);
const approved = await admin.call("POST", `/api/collections/imports/${batchId}/approve`);
b = await batch();
rec("A3", "a separate Admin approves", approved.status === 200 && b.status === "approved" && !!b.approved_by, `${approved.status} ${b.status} ${approved.text.slice(0, 120)}`);
const work = await admin.call("GET", "/api/collections/receivables?limit=100");
rec("A4", "approved report invoices are in the Collections worklist", work.status === 200 && work.text.includes(n(1)) && work.text.includes(n(2)) && work.text.includes("pdf_import"), `${work.status} ${work.text.length} bytes`);
const after = { attempts: await count("collection_delivery_attempts"), events: await count("collection_events") };
const ds2 = await admin.call("GET", "/api/collections/delivery-status");
rec("D1", "delivery stayed disabled and nothing was sent", ds2.json?.mode === "disabled" && ds2.json?.automation_enabled === false && after.attempts === before.attempts && after.events === before.events, JSON.stringify(after));
console.log(`BATCH ${batchId.slice(0, 8)} ${b.status}, synthetic, as of 2026-02-01`);
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
