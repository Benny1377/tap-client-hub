import { NextResponse } from "next/server";
import { requireCollectionsAccess } from "@/lib/billing-access";
import { canUseCollectionsImport, recordImportAudit } from "@/lib/collections-import";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireCollectionsAccess();
  if (access.response) return access.response;
  if (!await canUseCollectionsImport(access.identity!, "review")) return NextResponse.json({ error: "You are not allowed to view A/R report contents", code: "IMPORT_REVIEW_FORBIDDEN" }, { status: 403, headers: NO_STORE });
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid batch id", code: "INVALID_BATCH_ID" }, { status: 422, headers: NO_STORE });
  const db = createAdminClient();
  const [{ data: batch, error: batchError }, { data: rows, error: rowsError }, { data: invoices, error: invoicesError }] = await Promise.all([
    db.from("collection_import_batches").select("id,original_filename,report_type,source_as_of,status,uploaded_by,parsed_at,approved_by,approved_at,supersedes_batch_id,metadata,created_at,updated_at").eq("id", id).maybeSingle(),
    db.from("collection_import_rows").select("id,source_invoice_id,page_number,row_number,raw_text,parsed_fields,duplicate_of,exact_duplicate,review_disposition,created_at").eq("batch_id", id).order("page_number").order("row_number"),
    db.from("collection_import_invoices").select("id,source_invoice_id,invoice_number,customer_name,customer_external_id,transaction_type,transaction_date,due_date,terms,po_number,reported_aging,open_balance,source_as_of,source_row_key,review_status,discrepancy_status,row_data,created_at,updated_at").eq("batch_id", id).order("created_at"),
  ]);
  if (batchError || rowsError || invoicesError) return NextResponse.json({ error: "Unable to load import review", code: "IMPORT_REVIEW_READ_FAILED" }, { status: 500, headers: NO_STORE });
  if (!batch) return NextResponse.json({ error: "Import batch not found", code: "BATCH_NOT_FOUND" }, { status: 404, headers: NO_STORE });
  const sourceInvoiceIds = Array.from(new Set((invoices || []).map((invoice) => invoice.source_invoice_id)));
  const { data: revisions, error: revisionsError } = sourceInvoiceIds.length
    ? await db.from("collection_import_invoice_revisions").select("id,batch_id,source_invoice_id,actor,snapshot,created_at")
      .in("source_invoice_id", sourceInvoiceIds).order("created_at", { ascending: false })
    : { data: [], error: null };
  if (revisionsError) return NextResponse.json({ error: "Unable to load prior reviewed values", code: "IMPORT_REVISION_READ_FAILED" }, { status: 500, headers: NO_STORE });
  try { await recordImportAudit({ batchId: id, actor: access.identity!.id, action: "pdf_review_opened" }); }
  catch { return NextResponse.json({ error: "Unable to record report access", code: "IMPORT_AUDIT_WRITE_FAILED" }, { status: 500, headers: NO_STORE }); }
  return NextResponse.json({ batch, rows: rows || [], invoices: invoices || [], revisions: revisions || [] }, { headers: NO_STORE });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireCollectionsAccess();
  if (access.response) return access.response;
  if (!await canUseCollectionsImport(access.identity!, "review")) return NextResponse.json({ error: "You are not allowed to review A/R reports", code: "IMPORT_REVIEW_FORBIDDEN" }, { status: 403, headers: NO_STORE });
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid batch id", code: "INVALID_BATCH_ID" }, { status: 422, headers: NO_STORE });
  let body: { row_id?: unknown; disposition?: unknown; note?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body", code: "INVALID_JSON" }, { status: 400, headers: NO_STORE }); }
  const allowed = new Set(["summary", "header", "ignored"]);
  if (typeof body.row_id !== "string" || !UUID.test(body.row_id) || typeof body.disposition !== "string" || !allowed.has(body.disposition)) {
    return NextResponse.json({ error: "Choose a report row and classify it as summary, header, or ignored", code: "IMPORT_ROW_REVIEW_INVALID" }, { status: 422, headers: NO_STORE });
  }
  const db = createAdminClient();
  const { data: row, error } = await db.rpc("classify_collection_import_row", {
    p_batch_id: id, p_row_id: body.row_id, p_disposition: body.disposition, p_actor: access.identity!.id,
    p_note: typeof body.note === "string" ? body.note.slice(0, 500) : null,
  });
  if (error) {
    const missing = error.code === "P0002";
    const conflict = error.code === "P0001";
    return NextResponse.json({ error: missing ? "Batch or source row not found" : conflict ? "Batch is not editable" : "Unable to classify report row", code: missing ? "SOURCE_ROW_NOT_FOUND" : conflict ? "BATCH_STATE_CONFLICT" : "IMPORT_ROW_REVIEW_WRITE_FAILED" }, { status: missing ? 404 : conflict ? 409 : 500, headers: NO_STORE });
  }
  return NextResponse.json({ row }, { headers: NO_STORE });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireCollectionsAccess();
  if (access.response) return access.response;
  if (!await canUseCollectionsImport(access.identity!, "review")) return NextResponse.json({ error: "You are not allowed to correct A/R reports", code: "IMPORT_REVIEW_FORBIDDEN" }, { status: 403, headers: NO_STORE });
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid batch id", code: "INVALID_BATCH_ID" }, { status: 422, headers: NO_STORE });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body", code: "INVALID_JSON" }, { status: 400, headers: NO_STORE }); }
  const requiredString = (key: string, max: number) => typeof body[key] === "string" && (body[key] as string).trim().length > 0 && (body[key] as string).length <= max;
  if (!requiredString("customer_name", 255) || !requiredString("client_id", 36) || !requiredString("source_row_id", 36)
    || typeof body.open_balance !== "number" || !Number.isFinite(body.open_balance) || Math.abs(body.open_balance) > 9999999999.99
    || typeof body.confirmed !== "boolean" || !body.confirmed) {
    return NextResponse.json({ error: "Confirm customer, client, source row, and finite balance before saving", code: "IMPORT_INVOICE_INVALID" }, { status: 422, headers: NO_STORE });
  }
  const db = createAdminClient();
  const [{ data: batch, error: batchError }, { data: client, error: clientError }] = await Promise.all([
    db.from("collection_import_batches").select("id,status,source_as_of,uploaded_by").eq("id", id).maybeSingle(),
    db.from("clients").select("id").eq("id", body.client_id as string).maybeSingle(),
  ]);
  if (batchError || !batch) return NextResponse.json({ error: "Import batch not found", code: "BATCH_NOT_FOUND" }, { status: 404, headers: NO_STORE });
  if (batch.status === "approved" || batch.status === "rejected" || batch.status === "superseded") return NextResponse.json({ error: "Approved or closed batches cannot be edited", code: "BATCH_STATE_CONFLICT" }, { status: 409, headers: NO_STORE });
  if (clientError || !client) return NextResponse.json({ error: "Select an existing TAP Hub client first", code: "CLIENT_LINK_REQUIRED" }, { status: 422, headers: NO_STORE });
  let linkedInvoiceId: string | null = null;
  if (body.linked_invoice_id !== undefined && body.linked_invoice_id !== null && body.linked_invoice_id !== "") {
    if (typeof body.linked_invoice_id !== "string" || !UUID.test(body.linked_invoice_id)) return NextResponse.json({ error: "linked_invoice_id must be a UUID", code: "INVALID_BILLING_LINK" }, { status: 422, headers: NO_STORE });
    const { data: billingInvoice, error: billingInvoiceError } = await db.from("invoices").select("id,client_id").eq("id", body.linked_invoice_id).maybeSingle();
    if (billingInvoiceError || !billingInvoice) return NextResponse.json({ error: "Billing invoice not found", code: "BILLING_INVOICE_NOT_FOUND" }, { status: 422, headers: NO_STORE });
    if (billingInvoice.client_id !== client.id) return NextResponse.json({ error: "Billing invoice belongs to a different client", code: "BILLING_CLIENT_MISMATCH" }, { status: 409, headers: NO_STORE });
    linkedInvoiceId = billingInvoice.id;
  }
  if (!UUID.test(body.source_row_id as string)) return NextResponse.json({ error: "Select a row from this report", code: "SOURCE_ROW_NOT_FOUND" }, { status: 422, headers: NO_STORE });
  const existingSourceId = body.existing_source_invoice_id;
  if (existingSourceId !== undefined && existingSourceId !== null && (typeof existingSourceId !== "string" || !UUID.test(existingSourceId))) return NextResponse.json({ error: "existing_source_invoice_id must be a UUID", code: "INVALID_SOURCE_INVOICE_ID" }, { status: 422, headers: NO_STORE });
  const numericDate = (value: unknown) => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value ? value : null;
  };
  for (const key of ["transaction_date", "due_date"] as const) {
    if (body[key] !== undefined && body[key] !== null && body[key] !== "" && !numericDate(body[key])) {
      return NextResponse.json({ error: `${key} must be a valid YYYY-MM-DD date`, code: "IMPORT_INVOICE_INVALID_DATE" }, { status: 422, headers: NO_STORE });
    }
  }
  const optionalText = (key: string, max: number) => typeof body[key] === "string" ? (body[key] as string).slice(0, max).trim() || null : null;
  const rowData = typeof body.row_data === "object" && body.row_data !== null && !Array.isArray(body.row_data) ? body.row_data : {};
  const { data, error } = await db.rpc("review_collection_import_invoice", {
    p_batch_id: id, p_source_row_id: body.source_row_id, p_actor: access.identity!.id, p_client_id: client.id,
    p_linked_invoice_id: linkedInvoiceId, p_existing_source_invoice_id: existingSourceId || null,
    p_fields: {
      invoice_number: optionalText("invoice_number", 100), customer_name: (body.customer_name as string).trim(),
      customer_external_id: optionalText("customer_external_id", 100), transaction_type: optionalText("transaction_type", 80),
      transaction_date: numericDate(body.transaction_date), due_date: numericDate(body.due_date), terms: optionalText("terms", 80),
      po_number: optionalText("po_number", 100), reported_aging: Number.isInteger(body.reported_aging) ? body.reported_aging : null,
      open_balance: body.open_balance, row_data: rowData,
    },
  });
  if (error) {
    const missing = error.code === "P0002";
    const conflict = error.code === "P0001";
    return NextResponse.json({ error: missing ? "Import row or linked record was not found" : conflict ? "Import row or source link conflicts with existing reviewed data" : "Unable to save reviewed invoice row", code: missing ? "SOURCE_ROW_NOT_FOUND" : conflict ? "IMPORT_INVOICE_CONFLICT" : "IMPORT_INVOICE_WRITE_FAILED" }, { status: missing ? 404 : conflict ? 409 : 500, headers: NO_STORE });
  }
  return NextResponse.json(data, { status: 201, headers: NO_STORE });
}
