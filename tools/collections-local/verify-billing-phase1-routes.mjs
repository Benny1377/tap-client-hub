// LOCAL ONLY. Independent authenticated-HTTP check of Billing Phase 1 on the disposable local harness.
// Signs in through POST /api/auth/sign-in as Owner, Admin, Billing, Collections and unassigned staff,
// then calls the real /api/billing/* routes of the running app; RLS checks use the anon key on PostgREST.
//
// Setup (repo root):
//   1. bash tools/collections-local/reset.sh
//   2. node tools/collections-local/create-test-users.mjs   (writes TEST_* credentials to the ignored .env.local)
//   3. npm run dev
//   4. node tools/collections-local/verify-billing-phase1-routes.mjs
// Cleanup: adds synthetic LOCAL-V* invoices and payments and reverses its own test payment; run reset.sh for a clean database.
// Optional env: BILLING_VERIFY_BASE_URL (default http://localhost:3000), BILLING_VERIFY_API_URL (default http://127.0.0.1:55321),
// BILLING_VERIFY_DB_URL (default postgresql://postgres:postgres@127.0.0.1:55322/postgres), BILLING_VERIFY_PSQL (default psql).
// Never prints secrets.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const BASE = process.env.BILLING_VERIFY_BASE_URL || "http://localhost:3000";
const API = process.env.BILLING_VERIFY_API_URL || "http://127.0.0.1:55321";
const DB = process.env.BILLING_VERIFY_DB_URL || "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
const PSQL = process.env.BILLING_VERIFY_PSQL || "psql";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const loopback = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;
if (!loopback.test(API) || !loopback.test(BASE) || !/^postgresql:\/\/[^@]*@(127\.0\.0\.1|localhost)[:/]/.test(DB) || env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") !== API) throw new Error("Refusing: not the local harness");

const sql = (q, tolerateError = false) => {
  try { return execFileSync(PSQL, [DB, "-X", "-A", "-t", "-F", " | ", "-c", q], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).replace(/\r/g, "").trim(); }
  catch (e) { if (tolerateError) return "ERR:" + String(e.stderr || e.message).replace(/\s+/g, " ").slice(0, 160); throw e; }
};

class Session {
  constructor() { this.jar = new Map(); }
  async call(method, path, body) {
    const res = await fetch(BASE + path, { method, redirect: "manual", headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(this.jar.size ? { Cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}) }, body: body ? JSON.stringify(body) : undefined });
    for (const raw of res.headers.getSetCookie?.() || []) { const [pair] = raw.split(";"); const n = pair.slice(0, pair.indexOf("=")); const v = pair.slice(pair.indexOf("=") + 1); if (/max-age=0/i.test(raw) || v === "") this.jar.delete(n); else this.jar.set(n, v); }
    const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, code: json?.code };
  }
  async signIn(name) { const r = await this.call("POST", "/api/auth/sign-in", { identifier: env[`TEST_${name}_EMAIL`], password: env[`TEST_${name}_PASSWORD`] }); if (r.status !== 200) throw new Error(`sign-in ${name} ${r.status}`); return this; }
}

const results = [];
const rec = (id, name, ok, ev) => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${name} :: ${ev}`); };
const C1 = "10000000-0000-4000-8000-000000000001";
const tag = Date.now().toString(36).toUpperCase();

const anon = new Session();
const owner = await new Session().signIn("OWNER");
const admin = await new Session().signIn("ADMIN");
const billing = await new Session().signIn("STAFF_BILLING");
const colls = await new Session().signIn("STAFF_COLLECTIONS");
const unassigned = await new Session().signIn("STAFF_UNASSIGNED");

// ---- A. Access matrix ---------------------------------------------------------------
// Phase 2: a draft is created from a client only; the number and dates are assigned at issue.
const draftBody = () => ({ clientId: C1 });
rec("A1", "signed-out ledger read is 401", (await anon.call("GET", "/api/billing/invoices")).status === 401, "GET invoices");
rec("A2", "signed-out draft create is 401", (await anon.call("POST", "/api/billing/invoices", draftBody("a"))).status === 401, "POST invoices");
const ur = await unassigned.call("GET", "/api/billing/invoices");
rec("A3", "staff with no Billing/Collections module cannot read the ledger", ur.status === 403, `status ${ur.status}`);
rec("A4", "Collections staff can read the ledger", (await colls.call("GET", "/api/billing/invoices")).status === 200, "GET invoices");
const cw = await colls.call("POST", "/api/billing/invoices", draftBody("b"));
rec("A5", "Collections staff cannot create an invoice", cw.status === 403, `status ${cw.status}`);

// ---- B. Billing staff happy path + invariants ----------------------------------------
const d1 = await billing.call("POST", "/api/billing/invoices", draftBody("1"));
const inv1 = d1.json?.invoice?.id;
rec("B1", "Billing staff create a draft", d1.status === 201 && !!inv1, `status ${d1.status}`);
const l1 = await billing.call("POST", "/api/billing/invoice-lines", { invoice_id: inv1, description: "Synthetic rounding", quantity: "1.2345", unit_amount: "10.00" });
rec("B2", "line amount is server-derived with 4-decimal quantity (1.2345 x 10.00 = 12.35)", l1.status === 201 && Number(l1.json?.line?.amount) === 12.35, `status ${l1.status} amount ${l1.json?.line?.amount}`);
const l1b = await billing.call("POST", "/api/billing/invoice-lines", { invoice_id: inv1, description: "Synthetic half-up", quantity: "3", unit_amount: "0.15" });
rec("B3", "half-up rounding (3 x 0.15 = 0.45) and exact cents", l1b.status === 201 && Number(l1b.json?.line?.amount) === 0.45, `amount ${l1b.json?.line?.amount}`);
const sentAmount = await billing.call("POST", "/api/billing/invoice-lines", { invoice_id: inv1, description: "Client-sent amount ignored", quantity: "2", unit_amount: "5.00", amount: "999.99" });
rec("B4", "a client-sent amount is ignored", sentAmount.status === 201 && Number(sentAmount.json?.line?.amount) === 10, `amount ${sentAmount.json?.line?.amount}`);
const big = await billing.call("POST", "/api/billing/invoice-lines", { invoice_id: inv1, description: "Too big", quantity: "999999999", unit_amount: "1.00" });
rec("B5", "quantity beyond the column is 422 AMOUNT_OUT_OF_RANGE", big.status === 422 && big.code === "AMOUNT_OUT_OF_RANGE", `${big.status} ${big.code}`);
const bigAmt = await billing.call("POST", "/api/billing/invoice-lines", { invoice_id: inv1, description: "Too big total", quantity: "99999999", unit_amount: "9999999999.00" });
rec("B6", "computed amount beyond the column is 422 AMOUNT_OUT_OF_RANGE", bigAmt.status === 422 && bigAmt.code === "AMOUNT_OUT_OF_RANGE", `${bigAmt.status} ${bigAmt.code}`);
const zeroQ = await billing.call("POST", "/api/billing/invoice-lines", { invoice_id: inv1, description: "Zero", quantity: "0", unit_amount: "1.00" });
rec("B7", "zero quantity is rejected 422", zeroQ.status === 422, `${zeroQ.status} ${zeroQ.code}`);
const iss1 = await billing.call("POST", `/api/billing/invoices/${inv1}`, { action: "issue" });
rec("B8", "Billing staff issue the invoice", iss1.status === 200 && iss1.json?.invoice?.status === "issued", `status ${iss1.status}`);
const lineId = l1.json?.line?.id;
const addAfter = await billing.call("POST", "/api/billing/invoice-lines", { invoice_id: inv1, description: "late", quantity: "1", unit_amount: "1.00" });
rec("B9", "adding a line to an issued invoice is 409", addAfter.status === 409, `${addAfter.status} ${addAfter.code}`);
const patchAfter = await billing.call("PATCH", "/api/billing/invoice-lines", { id: lineId, description: "tamper" });
rec("B10", "editing a line on an issued invoice is 409", patchAfter.status === 409, `${patchAfter.status} ${patchAfter.code}`);
const delAfter = await billing.call("DELETE", `/api/billing/invoice-lines?id=${lineId}`);
rec("B11", "deleting a line on an issued invoice is 409", delAfter.status === 409, `${delAfter.status} ${delAfter.code}`);

// ---- C. Direct database writes cannot bypass (service-role-equivalent path) ----------
const dbEdit = sql(`update tap_hub_project.invoice_lines set amount = 1 where id = '${lineId}'`, true);
rec("C1", "database rejects editing a line on an issued invoice", dbEdit.startsWith("ERR:") && /invariant_violation/.test(dbEdit), dbEdit.slice(0, 110));
const dbMismatch = sql(`insert into tap_hub_project.invoice_lines (invoice_id, description, quantity, unit_amount, amount) values ('${inv1}','x',2,10,5)`, true);
rec("C2", "database rejects an insert on an issued invoice / mismatched amount", dbMismatch.startsWith("ERR:") && /invariant_violation/.test(dbMismatch), dbMismatch.slice(0, 110));
const draftMismatch = await billing.call("POST", "/api/billing/invoices", draftBody("m"));
const dm = draftMismatch.json?.invoice?.id;
const dbMis2 = sql(`insert into tap_hub_project.invoice_lines (invoice_id, description, quantity, unit_amount, amount) values ('${dm}','x',2,10,5)`, true);
rec("C3", "database rejects a draft line whose amount differs from quantity x unit", dbMis2.startsWith("ERR:") && /amount must equal/.test(dbMis2), dbMis2.slice(0, 110));

// ---- D. Draft delete (the regression fixed in 73f4d2a) -------------------------------
const dl = await billing.call("POST", "/api/billing/invoice-lines", { invoice_id: dm, description: "to be deleted", quantity: "1", unit_amount: "5.00" });
const del = await billing.call("DELETE", `/api/billing/invoices/${dm}`);
const gone = sql(`select count(*) from tap_hub_project.invoices where id='${dm}'`) === "0" && sql(`select count(*) from tap_hub_project.invoice_lines where invoice_id='${dm}'`) === "0";
rec("D1", "deleting a draft that has lines succeeds and removes the lines", dl.status === 201 && del.status === 200 && gone, `line ${dl.status} delete ${del.status} removed=${gone}`);
const delIssued = await billing.call("DELETE", `/api/billing/invoices/${inv1}`);
rec("D2", "deleting an issued invoice via the route is refused", delIssued.status === 409, `${delIssued.status} ${delIssued.code}`);

// ---- E. Void rules -------------------------------------------------------------------
const bv = await billing.call("POST", `/api/billing/invoices/${inv1}`, { action: "void", reason: "x" });
rec("E1", "Billing staff cannot void (Owner/Admin only)", bv.status === 403, `status ${bv.status}`);
const noReason = await admin.call("POST", `/api/billing/invoices/${inv1}`, { action: "void" });
rec("E2", "void without a reason is 422 VOID_REASON_REQUIRED", noReason.status === 422 && noReason.code === "VOID_REASON_REQUIRED", `${noReason.status} ${noReason.code}`);
const blank = await admin.call("POST", `/api/billing/invoices/${inv1}`, { action: "void", reason: "   " });
rec("E3", "a blank reason is 422 VOID_REASON_REQUIRED", blank.status === 422 && blank.code === "VOID_REASON_REQUIRED", `${blank.status} ${blank.code}`);
const pay = await billing.call("POST", "/api/billing/payments", { client_id: C1, received_on: "2026-10-05", amount: "5.00", method: "check", reference: `V-${tag}` });
const payId = pay.json?.payment?.id;
const alloc = await billing.call("POST", "/api/billing/allocations", { payment_id: payId, invoice_id: inv1, amount: "5.00" });
const allocId = alloc.json?.allocation_id;
rec("E4", "Billing staff record and allocate a payment", pay.status === 201 && alloc.status === 201 && !!allocId, `pay ${pay.status} alloc ${alloc.status}`);
const voidAlloc = await admin.call("POST", `/api/billing/invoices/${inv1}`, { action: "void", reason: "Synthetic void" });
rec("E5", "void with an active allocation is 409 ACTIVE_PAYMENT_ALLOCATION", voidAlloc.status === 409 && voidAlloc.code === "ACTIVE_PAYMENT_ALLOCATION", `${voidAlloc.status} ${voidAlloc.code}`);
const rb = await billing.call("POST", `/api/billing/allocations/${allocId}`);
rec("E6", "Billing staff cannot reverse an allocation", rb.status === 403, `status ${rb.status}`);
const ra = await admin.call("POST", `/api/billing/allocations/${allocId}`);
rec("E7", "Admin reverses the allocation", ra.status === 200, `status ${ra.status}`);
const voided = await admin.call("POST", `/api/billing/invoices/${inv1}`, { action: "void", reason: "Synthetic void" });
rec("E8", "Admin voids once nothing is allocated", voided.status === 200 && voided.json?.invoice?.status === "void" && voided.json.invoice.void_reason === "Synthetic void", `status ${voided.status}`);
const allocVoid = await billing.call("POST", "/api/billing/allocations", { payment_id: payId, invoice_id: inv1, amount: "1.00" });
rec("E9", "allocating to a void invoice is 409", allocVoid.status === 409, `${allocVoid.status} ${allocVoid.code}`);
const rp = await admin.call("POST", `/api/billing/payments/${payId}`, { reason: "Synthetic cleanup" });
rec("E10", "Admin reverses the payment", rp.status === 200, `status ${rp.status}`);

// ---- F. RLS and audit -----------------------------------------------------------------
for (const t of ["invoices", "invoice_lines", "payments", "payment_allocations"]) {
  const r = await fetch(`${API}/rest/v1/${t}?select=id&limit=1`, { headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`, "Accept-Profile": "tap_hub_project" } });
  const body = await r.text();
  rec(`F-${t}`, `anon key cannot read ${t}`, r.status >= 400 || body === "[]", `status ${r.status}`);
}
const w = await fetch(`${API}/rest/v1/invoices`, { method: "POST", headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`, "Content-Type": "application/json", "Content-Profile": "tap_hub_project" }, body: JSON.stringify({ client_id: C1, invoice_number: "ANON-X", issue_date: "2026-10-01", due_date: "2026-10-16" }) });
rec("F5", "anon key cannot write invoices", w.status >= 400, `status ${w.status}`);
const audit = sql(`select string_agg(distinct action, ',') from tap_hub_project.audit_log where entity_id = '${inv1}' or (entity_id = '${payId}')`);
const voidAudit = sql(`select count(*) from tap_hub_project.audit_log where entity_id='${inv1}' and detail->'new'->>'void_reason' = 'Synthetic void'`);
rec("F6", "audit rows exist for the invoice lifecycle and the void reason", /insert/i.test(audit) && Number(voidAudit) >= 1, `actions=${audit} void-reason-rows=${voidAudit}`);

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
