import { NextRequest, NextResponse } from "next/server";
import { requireCollectionsAccess } from "@/lib/billing-access";
import { canUseCollectionsImport, isPdfFile, recordImportAudit, sha256Hex } from "@/lib/collections-import";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
const MAX_BYTES = 25 * 1024 * 1024;

function fail(error: string, code: string, status: number) {
  return NextResponse.json({ error, code }, { status, headers: NO_STORE });
}

export async function GET() {
  const access = await requireCollectionsAccess();
  if (access.response) return access.response;
  if (!await canUseCollectionsImport(access.identity!, "review")) return fail("You are not allowed to view A/R reports", "IMPORT_REVIEW_FORBIDDEN", 403);
  const db = createAdminClient();
  const { data, error } = await db.from("collection_import_batches")
    .select("id,original_filename,report_type,source_as_of,status,uploaded_by,parsed_at,approved_by,approved_at,supersedes_batch_id,created_at,updated_at")
    .order("created_at", { ascending: false }).limit(100);
  if (error) return fail("Unable to load import batches", "IMPORT_BATCH_READ_FAILED", 500);
  try { await recordImportAudit({ actor: access.identity!.id, action: "pdf_batch_list_viewed", detail: { batch_count: data?.length || 0 } }); }
  catch { return fail("Report list loaded, but its access audit could not be recorded", "IMPORT_AUDIT_WRITE_FAILED", 500); }
  return NextResponse.json({ batches: data || [] }, { headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  const access = await requireCollectionsAccess();
  if (access.response) return access.response;
  if (!await canUseCollectionsImport(access.identity!, "upload")) return fail("You are not allowed to upload A/R reports", "IMPORT_UPLOAD_FORBIDDEN", 403);
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BYTES + 1024 * 1024) return fail("Upload exceeds the 25 MB report limit", "PDF_SIZE_INVALID", 413);

  let form: FormData;
  try { form = await request.formData(); } catch { return fail("Expected a multipart PDF upload", "INVALID_UPLOAD", 400); }
  const file = form.get("file");
  if (!(file instanceof File)) return fail("PDF file is required", "PDF_REQUIRED", 422);
  if (!isPdfFile(file)) return fail("Only PDF reports are accepted", "PDF_REQUIRED", 415);
  if (file.size < 8 || file.size > MAX_BYTES) return fail("PDF must be between 8 bytes and 25 MB", "PDF_SIZE_INVALID", 413);

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") return fail("File does not have a valid PDF signature", "PDF_INVALID", 415);
  const hash = await sha256Hex(bytes);
  const db = createAdminClient();
  const { data: existing, error: duplicateReadError } = await db.from("collection_import_batches")
    .select("id,status,created_at").eq("file_sha256", hash).maybeSingle();
  if (duplicateReadError) return fail("Unable to verify duplicate report", "IMPORT_DUPLICATE_CHECK_FAILED", 500);
  if (existing) {
    try { await recordImportAudit({ batchId: existing.id, actor: access.identity!.id, action: "duplicate_upload_detected", detail: { file_sha256: hash } }); }
    catch { return fail("Duplicate report found, but its audit record failed", "IMPORT_AUDIT_WRITE_FAILED", 500); }
    return NextResponse.json({ batch: existing, duplicate: true }, { status: 200, headers: NO_STORE });
  }

  const batchId = crypto.randomUUID();
  const safeName = file.name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "report.pdf";
  const storagePath = `${batchId}/${safeName}`;
  const { error: storageError } = await db.storage.from("collections-ar-pdfs").upload(storagePath, bytes, {
    contentType: "application/pdf", upsert: false,
  });
  if (storageError) return fail("Unable to store report securely", "IMPORT_STORAGE_FAILED", 503);

  const { data: batch, error: insertError } = await db.from("collection_import_batches").insert({
    id: batchId, file_sha256: hash, storage_path: storagePath,
    original_filename: file.name.slice(0, 255), content_type: "application/pdf",
    file_size_bytes: bytes.byteLength, uploaded_by: access.identity!.id, status: "uploaded",
  }).select("id,original_filename,status,created_at").single();
  if (insertError) {
    await db.storage.from("collections-ar-pdfs").remove([storagePath]);
    if (insertError.code === "23505") {
      const { data: racedBatch } = await db.from("collection_import_batches").select("id,status,created_at").eq("file_sha256", hash).maybeSingle();
      if (racedBatch) {
        try { await recordImportAudit({ batchId: racedBatch.id, actor: access.identity!.id, action: "duplicate_upload_detected", detail: { file_sha256: hash, concurrent: true } }); }
        catch { return fail("Duplicate report found, but its audit record failed", "IMPORT_AUDIT_WRITE_FAILED", 500); }
        return NextResponse.json({ batch: racedBatch, duplicate: true }, { status: 200, headers: NO_STORE });
      }
    }
    return fail("Unable to create import batch", "IMPORT_BATCH_CREATE_FAILED", 500);
  }
  try { await recordImportAudit({ batchId, actor: access.identity!.id, action: "pdf_uploaded", detail: { file_sha256: hash, file_size_bytes: bytes.byteLength } }); }
  catch { return fail("Report stored, but its audit record failed; do not retry blindly", "IMPORT_AUDIT_WRITE_FAILED", 500); }
  return NextResponse.json({ batch, duplicate: false }, { status: 201, headers: NO_STORE });
}
