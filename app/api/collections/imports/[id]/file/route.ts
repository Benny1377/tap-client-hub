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
  if (!await canUseCollectionsImport(access.identity!, "review")) return NextResponse.json({ error: "You are not allowed to access stored reports", code: "IMPORT_REVIEW_FORBIDDEN" }, { status: 403, headers: NO_STORE });
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid batch id", code: "INVALID_BATCH_ID" }, { status: 422, headers: NO_STORE });
  const db = createAdminClient();
  const { data: batch, error } = await db.from("collection_import_batches").select("storage_path,original_filename").eq("id", id).maybeSingle();
  if (error || !batch) return NextResponse.json({ error: "Import batch not found", code: "BATCH_NOT_FOUND" }, { status: 404, headers: NO_STORE });
  try { await recordImportAudit({ batchId: id, actor: access.identity!.id, action: "pdf_downloaded" }); }
  catch { return NextResponse.json({ error: "Unable to record report access", code: "IMPORT_AUDIT_WRITE_FAILED" }, { status: 500, headers: NO_STORE }); }
  const { data: signed, error: signError } = await db.storage.from("collections-ar-pdfs").createSignedUrl(batch.storage_path, 60, { download: batch.original_filename });
  if (signError || !signed) return NextResponse.json({ error: "Unable to grant temporary report access", code: "IMPORT_STORAGE_SIGN_FAILED" }, { status: 503, headers: NO_STORE });
  return NextResponse.json({ url: signed.signedUrl, expires_in_seconds: 60 }, { headers: NO_STORE });
}
