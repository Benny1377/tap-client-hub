// LOCAL ONLY. Engineer A Phase 4 integration checks: a synthetic A/R detail PDF
// is generated in memory (never written to disk), then driven through upload,
// access, parse, review, approval, worklist/preview, discrepancy resolution,
// download and source-aware hold/event routes. No real report is used.
//
//   APP_URL=http://localhost:3001 node tools/collections-local/validate-phase4.mjs
//
// Run after `reset.sh --local` and `create-test-users.mjs`. Outcomes: PASS, FAIL.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const BASE = process.env.APP_URL || "http://localhost:3000";
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
if (!/^http:\/\/127\.0\.0\.1:55321\/?$/.test(env.NEXT_PUBLIC_SUPABASE_URL)) throw new Error("Refusing: app is not pointed at the local Supabase");
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\/?$/.test(BASE)) throw new Error("Refusing: APP_URL must be a local address");

const DB = "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
const sql = (q) => execFileSync(process.env.PSQL || "psql", [DB, "-X", "-A", "-t", "-c", q], { encoding: "utf8" }).split(String.fromCharCode(13)).join("").trim();
const C1 = "10000000-0000-4000-8000-000000000001"; // Example Orchard LLC (synthetic)
const I1 = "20000000-0000-4000-8000-000000000001"; // LOCAL-001, Billing balance 125.00

class Session {
  constructor() { this.jar = new Map(); }
  store(res) {
    for (const raw of res.headers.getSetCookie?.() || []) {
      const [pair] = raw.split(";");
      const name = pair.slice(0, pair.indexOf("="));
      const value = pair.slice(pair.indexOf("=") + 1);
      if (/max-age=0/i.test(raw) || value === "") this.jar.delete(name); else this.jar.set(name, value);
    }
  }
  async call(method, path, body, form) {
    const headers = this.jar.size ? { Cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(BASE + path, { method, redirect: "manual", headers, body: form || (body !== undefined ? JSON.stringify(body) : undefined) });
    this.store(res);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json };
  }
  async signIn(name) {
    const email = env[`TEST_${name}_EMAIL`];
    const resolved = await this.call("POST", "/api/auth/resolve-login", { identifier: email });
    const r = await this.call("POST", "/api/auth/sign-in", { email: resolved.json?.email || email, password: env[`TEST_${name}_PASSWORD`] });
    if (r.status !== 200) throw new Error(`${name} could not sign in (${r.status})`);
    return this;
  }
}

/** Minimal one-page PDF with positioned Helvetica text lines, built in memory. */
function syntheticPdf(lines) {
  const esc = (t) => t.replace(/[\\()]/g, (c) => `\\${c}`);
  const content = lines.map(({ x, y, text }) => `BT /F1 9 Tf ${x} ${y} Td (${esc(text)}) Tj ET`).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, "latin1"));
}
const row = (y, cells) => cells.map((text, i) => ({ x: [40, 120, 220, 300, 400][i], y, text }));
const PDF = syntheticPdf([
  { x: 40, y: 750, text: "Synthetic Test Firm" },
  { x: 40, y: 735, text: "A/R Aging QuickZoom" },
  { x: 40, y: 720, text: "As of August 28, 2026" },
  ...row(690, ["Date", "Transaction Type", "Num", "Due Date", "Open Balance"]),
  ...row(670, ["08/01/2026", "Invoice", "SYN-1001", "08/31/2026", "150.00"]),
  ...row(655, ["07/15/2026", "Invoice", "SYN-1002", "08/14/2026", "100.00"]),
]);
const upload = (session, bytes = PDF, name = "synthetic-ar-detail.pdf") => {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "application/pdf" }), name);
  return session.call("POST", "/api/collections/imports", undefined, form);
};

const results = [];
const record = (id, name, ok, evidence) => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${name} :: ${evidence}`); };

const anon = new Session();
const owner = await new Session().signIn("OWNER");
const admin = await new Session().signIn("ADMIN");
const staffC = await new Session().signIn("STAFF_COLLECTIONS");
const staffB = await new Session().signIn("STAFF_BILLING");
const staffU = await new Session().signIn("STAFF_UNASSIGNED");
const attemptsBefore = Number(sql("select count(*) from tap_hub_project.collection_delivery_attempts"));

// ---- Upload and access ----------------------------------------------------------
const up = await upload(owner);
const batchId = up.json?.batch?.id;
record("UP1", "Owner uploads a synthetic A/R detail PDF", up.status === 201 && !!batchId && up.json?.duplicate === false, `${up.status} duplicate=${up.json?.duplicate}`);
const again = await upload(owner);
record("UP2", "re-uploading the identical file is idempotent", again.status === 200 && again.json?.duplicate === true && again.json?.batch?.id === batchId, `${again.status} duplicate=${again.json?.duplicate}`);
const notPdf = await upload(owner, new Uint8Array(Buffer.from("hello, not a pdf")), "fake.pdf");
record("UP3", "a non-PDF with a .pdf name is rejected by signature", notPdf.status === 415 && notPdf.json?.code === "PDF_INVALID", `${notPdf.status} ${notPdf.json?.code}`);
const stored = sql(`select public::text || ' ' || coalesce((select count(*)::text from storage.objects where bucket_id = 'collections-ar-pdfs'), '0') from storage.buckets where id = 'collections-ar-pdfs'`);
record("UP4", "the stored PDF sits in a private bucket", stored.startsWith("false ") && Number(stored.split(" ")[1]) >= 1, `public objects -> ${stored}`);
for (const [label, s, expected] of [["anonymous", anon, 401], ["unassigned staff", staffU, 403]]) {
  const list = await s.call("GET", "/api/collections/imports");
  record("AC1", `${label} cannot list imports`, list.status === expected, `${list.status} ${list.json?.code || ""}`);
}
const billingUpload = await upload(staffB);
record("AC2", "Billing staff cannot upload (default policy)", billingUpload.status === 403, `${billingUpload.status} ${billingUpload.json?.code}`);
const staffList = await staffC.call("GET", "/api/collections/imports");
record("AC3", "Collections staff can list imports", staffList.status === 200 && Array.isArray(staffList.json?.batches), `${staffList.status}`);
const policyStaff = await staffC.call("GET", "/api/collections/imports/permissions");
record("AC4", "only Owner/Admin read or edit the permission policy", policyStaff.status === 403, `${policyStaff.status}`);

// ---- Parse and review ------------------------------------------------------------
const parse = await owner.call("POST", `/api/collections/imports/${batchId}/parse`, {});
record("PA1", "parse recognizes the detail layout and as-of date", parse.status === 200 && parse.json?.report_type === "aging_detail" && parse.json?.source_as_of === "2026-08-28", `${parse.status} ${parse.json?.report_type} ${parse.json?.source_as_of} lines=${parse.json?.extracted_line_count}`);
const review = await owner.call("GET", `/api/collections/imports/${batchId}`);
const rows = review.json?.rows || [];
const rowA = rows.find((r) => /SYN-1001/.test(r.raw_text));
const rowB = rows.find((r) => /SYN-1002/.test(r.raw_text));
record("PA2", "extracted rows keep page/row provenance", !!rowA && !!rowB && rowA.page_number === 1 && Number.isInteger(rowA.row_number), `${rows.length} rows; A=${rowA?.raw_text}`);
const unassignedReview = await staffU.call("GET", `/api/collections/imports/${batchId}`);
record("PA3", "unassigned staff cannot open a report's extracted rows", unassignedReview.status === 403, `${unassignedReview.status}`);

const reviewA = await owner.call("POST", `/api/collections/imports/${batchId}`, {
  source_row_id: rowA?.id, client_id: C1, customer_name: "Example Orchard LLC", invoice_number: "SYN-1001",
  transaction_type: "Invoice", transaction_date: "2026-08-01", due_date: "2026-08-31", open_balance: 150, confirmed: true,
});
const sourceA = reviewA.json?.source_invoice_id || reviewA.json?.invoice?.source_invoice_id;
record("RV1", "a reviewer confirms a PDF-only invoice linked to a TAP Hub client", reviewA.status === 201 && !!sourceA, `${reviewA.status} ${reviewA.json?.code || ""} source=${sourceA}`);
const reviewB = await owner.call("POST", `/api/collections/imports/${batchId}`, {
  source_row_id: rowB?.id, client_id: C1, customer_name: "Example Orchard LLC", invoice_number: "SYN-1002", linked_invoice_id: I1,
  transaction_type: "Invoice", transaction_date: "2026-07-15", due_date: "2026-08-14", open_balance: 100, confirmed: true,
});
const sourceB = reviewB.json?.source_invoice_id || reviewB.json?.invoice?.source_invoice_id;
record("RV2", "a reviewer links a PDF invoice to its Billing invoice", reviewB.status === 201 && !!sourceB, `${reviewB.status} ${reviewB.json?.code || ""} source=${sourceB}`);
const noClient = await owner.call("POST", `/api/collections/imports/${batchId}`, { source_row_id: rowA?.id, client_id: "10000000-0000-4000-8000-0000000000ff", customer_name: "Nobody", open_balance: 1, confirmed: true });
record("RV3", "an invoice cannot be confirmed without an existing TAP Hub client", noClient.status === 422 && noClient.json?.code === "CLIENT_LINK_REQUIRED", `${noClient.status} ${noClient.json?.code}`);

// Every other extracted line (title, as-of, column headings) is classified explicitly.
const afterReview = await owner.call("GET", `/api/collections/imports/${batchId}`);
const unreviewed = (afterReview.json?.rows || []).filter((r) => !r.source_invoice_id && r.review_disposition === "unreviewed");
const classified = await Promise.all(unreviewed.map((r) => owner.call("PATCH", `/api/collections/imports/${batchId}`, { row_id: r.id, disposition: "header", note: "Report title or column heading" })));
record("RV4", "non-invoice lines are classified as headers", classified.length > 0 && classified.every((r) => r.status === 200), `${classified.length} line(s): ${classified.map((r) => r.status).join(",")}`);

// ---- Approval separation of duties -------------------------------------------------
const selfApprove = await owner.call("POST", `/api/collections/imports/${batchId}/approve`, {});
record("AP1", "the uploader/corrector cannot approve the batch", selfApprove.status === 409, `${selfApprove.status} ${selfApprove.json?.code} "${selfApprove.json?.error}"`);
const staffApprove = await staffC.call("POST", `/api/collections/imports/${batchId}/approve`, {});
record("AP2", "Collections staff cannot approve (default policy)", staffApprove.status === 403, `${staffApprove.status} ${staffApprove.json?.code}`);
const approve = await admin.call("POST", `/api/collections/imports/${batchId}/approve`, {});
record("AP3", "a different Owner/Admin approves the batch", approve.status === 200, `${approve.status} ${approve.json?.code || JSON.stringify(approve.json).slice(0, 160)}`);

// ---- Worklist and preview ------------------------------------------------------------
const wl = await owner.call("GET", "/api/collections/receivables");
const invoices = (wl.json?.accounts || []).flatMap((a) => a.invoices || []);
const pdfOnly = invoices.find((i) => i.source_invoice_id === sourceA);
record("WL1", "the approved PDF-only invoice appears once with its source identity", !!pdfOnly && pdfOnly.source === "pdf_import" && pdfOnly.invoice_id === null
  && pdfOnly.row_key === `collection:pdf_import:${sourceA}` && invoices.filter((i) => i.source_invoice_id === sourceA).length === 1, JSON.stringify(pdfOnly && { source: pdfOnly.source, invoice_id: pdfOnly.invoice_id, row_key: pdfOnly.row_key, as_of: pdfOnly.source_as_of }));
const linkedRows = invoices.filter((i) => i.invoice_id === I1 || i.source_invoice_id === sourceB);
const linked = linkedRows[0];
record("WL2", "the linked invoice appears once, blocked by the 150 vs 125 difference", linkedRows.length === 1 && linked?.discrepancy_status === "blocked" && linked?.canonical_collection_identity === `billing:${I1}`,
  `${linkedRows.length} row(s): ${JSON.stringify(linked && { source: linked.source, discrepancy: linked.discrepancy_status, canonical: linked.canonical_collection_identity, balance: linked.balance })}`);
const pv = await owner.call("POST", "/api/collections/automation/preview", {});
const pvLinked = (pv.json?.actions || []).filter((a) => a.invoice_id === I1 || a.source_invoice_id === sourceB);
record("PV1", "the blocked linked invoice is not proposed as a send", pv.status === 200 && pvLinked.every((a) => a.disposition === "suppressed" && a.suppression_reasons.includes("source_discrepancy_blocked")),
  `${pv.status} ${JSON.stringify(pvLinked.map((a) => ({ d: a.disposition, r: a.suppression_reasons })))}`);
const staffWl = await staffC.call("GET", "/api/collections/receivables");
record("WL3", "Collections staff see the same source fields", ((staffWl.json?.accounts || []).flatMap((a) => a.invoices || [])).some((i) => i.source_invoice_id === sourceA && i.row_key), `${staffWl.status}`);

// ---- Discrepancy resolution ------------------------------------------------------------
const resolve = await owner.call("POST", `/api/collections/imports/invoices/${sourceB}/resolve`, { selected_source: "billing", resolution_note: "Billing reflects the payment applied after the report" });
record("RS1", "an authorized reviewer resolves the discrepancy by choosing Billing", resolve.status === 200 && resolve.json?.discrepancy_status === "resolved", `${resolve.status} ${resolve.json?.code || ""} ${resolve.json?.error || ""}`);

// A Billing payment after the report's as-of date re-blocks the resolved invoice.
const pay = await owner.call("POST", "/api/billing/payments", { client_id: C1, received_on: new Date().toISOString().slice(0, 10), amount: "10.00", method: "check", reference: "SYN-STALE" });
const payId = pay.json?.payment?.id;
const alloc = payId ? await owner.call("POST", "/api/billing/allocations", { payment_id: payId, invoice_id: I1, amount: "10.00" }) : { status: 0 };
const afterPay = await owner.call("GET", "/api/collections/receivables");
const reblocked = ((afterPay.json?.accounts || []).flatMap((a) => a.invoices || [])).find((i) => i.invoice_id === I1);
const staleAudit = sql(`select count(*) from tap_hub_project.collection_import_audit where source_invoice_id = '${sourceB}' and action = 'billing_snapshot_stale'`);
record("RS2", "a later Billing payment re-blocks the resolved invoice and records the math", alloc.status === 201 && reblocked?.discrepancy_status === "blocked" && Number(staleAudit) >= 1,
  `payment ${pay.status}, allocation ${alloc.status}, discrepancy=${reblocked?.discrepancy_status}, stale audit rows=${staleAudit}`);

// ---- Stored file access ------------------------------------------------------------------
const fileOwner = await owner.call("GET", `/api/collections/imports/${batchId}/file`);
record("FL1", "an authorized reviewer gets a short-lived signed download link", fileOwner.status === 200 && /token=/.test(JSON.stringify(fileOwner.json || {})), `${fileOwner.status}`);
const fileU = await staffU.call("GET", `/api/collections/imports/${batchId}/file`);
const fileAnon = await anon.call("GET", `/api/collections/imports/${batchId}/file`);
record("FL2", "unassigned staff and anonymous users cannot download", fileU.status === 403 && fileAnon.status === 401, `${fileU.status} / ${fileAnon.status}`);
const downloads = sql(`select count(*) from tap_hub_project.collection_import_audit where batch_id = '${batchId}' and action ilike '%download%'`);
record("FL3", "the download is audited", Number(downloads) >= 1, `${downloads} download audit row(s)`);

// ---- Source-aware holds and events for a PDF-only invoice ----------------------------------
const hold = await owner.call("POST", "/api/collections/holds", { client_id: C1, target: { source: "pdf_import", source_invoice_id: sourceA }, reason: "Synthetic dispute on the imported invoice" });
const holdId = hold.json?.hold?.id;
record("HO1", "a hold can target a PDF-only invoice", hold.status === 201 && !!holdId, `${hold.status} ${hold.json?.code || ""}`);
const reqDuringHold = await staffC.call("POST", "/api/collections/events", { client_id: C1, target: { source: "pdf_import", source_invoice_id: sourceA }, event_type: "escalation_requested", detail: { note: "Escalate" } });
record("HO2", "the hold blocks an escalation request on that invoice", reqDuringHold.status === 409, `${reqDuringHold.status} ${reqDuringHold.json?.code}`);
const release = holdId ? await owner.call("PATCH", "/api/collections/holds", { id: holdId }) : { status: 0 };
const rem = await staffC.call("POST", "/api/collections/events", { client_id: C1, target: { source: "pdf_import", source_invoice_id: sourceA }, event_type: "reminder_logged", detail: { note: "Called about the imported invoice" } });
const remStage = rem.json?.event?.id ? sql(`select coalesce(stage::text, 'null') || ' ' || canonical_collection_identity from tap_hub_project.collection_events where id = '${rem.json.event.id}'`) : "";
record("EV1", "a reminder on a PDF-only invoice records its catch-up stage and canonical identity", rem.status === 201 && /^\d /.test(remStage) && remStage.endsWith(`pdf_import:${sourceA}`), `release ${release.status}; ${rem.status} ${rem.json?.code || ""} stage/identity=${remStage}`);

// ---- Safety -------------------------------------------------------------------------------
const attemptsAfter = Number(sql("select count(*) from tap_hub_project.collection_delivery_attempts"));
record("SF1", "no delivery attempts were created", attemptsAfter === attemptsBefore, `attempts ${attemptsBefore} -> ${attemptsAfter}`);
const billingTouched = sql(`select count(*) from tap_hub_project.invoices where invoice_number like 'SYN-%'`);
record("SF2", "imported invoices never become Billing invoices", billingTouched === "0", `${billingTouched} Billing invoice(s) named SYN-*`);

const passed = results.filter(Boolean).length;
console.log(`\nPHASE 4 SUMMARY: ${passed} PASS, ${results.length - passed} FAIL`);
