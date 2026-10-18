import { NextResponse } from "next/server";
import { requireCollectionsAccess } from "@/lib/billing-access";
import { canUseCollectionsImport, recordImportAudit } from "@/lib/collections-import";
import { parseCollectionsPdf } from "@/lib/collections-pdf-parser";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireCollectionsAccess();
  if (access.response) return access.response;
  if (!await canUseCollectionsImport(access.identity!, "review")) return NextResponse.json({ error: "You are not allowed to parse A/R reports", code: "IMPORT_REVIEW_FORBIDDEN" }, { status: 403, headers: NO_STORE });
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid batch id", code: "INVALID_BATCH_ID" }, { status: 422, headers: NO_STORE });
  const db = createAdminClient();
  const { data: batch, error: batchError } = await db.from("collection_import_batches").select("id,storage_path,status").eq("id", id).maybeSingle();
  if (batchError || !batch) return NextResponse.json({ error: "Import batch not found", code: "BATCH_NOT_FOUND" }, { status: 404, headers: NO_STORE });
  if (batch.status !== "uploaded" && batch.status !== "failed") return NextResponse.json({ error: "Batch is not available for parsing", code: "BATCH_STATE_CONFLICT" }, { status: 409, headers: NO_STORE });

  const { data: file, error: downloadError } = await db.storage.from("collections-ar-pdfs").download(batch.storage_path);
  if (downloadError || !file) return NextResponse.json({ error: "Unable to read stored report", code: "IMPORT_STORAGE_READ_FAILED" }, { status: 503, headers: NO_STORE });
  let parsed;
  try { parsed = await parseCollectionsPdf(new Uint8Array(await file.arrayBuffer())); }
  catch {
    await db.from("collection_import_batches").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", id);
    try { await recordImportAudit({ batchId: id, actor: access.identity!.id, action: "pdf_parse_failed" }); } catch { /* the failing operation is reported below */ }
    return NextResponse.json({ error: "PDF text extraction failed; the stored report remains available for manual review", code: "PDF_EXTRACTION_FAILED" }, { status: 422, headers: NO_STORE });
  }

  const pageRows = new Map<number, number>();
  const rows = parsed.lines.map((line) => {
    const rowNumber = (pageRows.get(line.page) || 0) + 1;
    pageRows.set(line.page, rowNumber);
    return { batch_id: id, page_number: line.page, row_number: rowNumber, raw_text: line.text, parsed_fields: { cells: line.cells } };
  });
  const { error: clearError } = await db.from("collection_import_rows").delete().eq("batch_id", id);
  if (clearError) return NextResponse.json({ error: "Unable to replace the previous extraction", code: "IMPORT_ROWS_RESET_FAILED" }, { status: 500, headers: NO_STORE });
  if (rows.length) {
    const { data: savedRows, error: rowError } = await db.from("collection_import_rows").insert(rows).select("id,page_number,row_number,raw_text");
    if (rowError || !savedRows) return NextResponse.json({ error: "Unable to save extracted report rows", code: "IMPORT_ROWS_WRITE_FAILED" }, { status: 500, headers: NO_STORE });
    const firstByText = new Map<string, string>();
    const duplicates = new Map<string, string[]>();
    for (const row of savedRows) {
      const fingerprint = row.raw_text.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase();
      if (!fingerprint) continue;
      const firstId = firstByText.get(fingerprint);
      if (firstId) duplicates.set(firstId, [...(duplicates.get(firstId) || []), row.id]);
      else firstByText.set(fingerprint, row.id);
    }
    for (const [firstId, duplicateIds] of duplicates) {
      const { error: duplicateError } = await db.from("collection_import_rows").update({ duplicate_of: firstId, exact_duplicate: true, review_disposition: "duplicate" }).in("id", duplicateIds);
      if (duplicateError) return NextResponse.json({ error: "Rows extracted, but duplicate markers could not be saved", code: "IMPORT_DUPLICATE_MARK_FAILED" }, { status: 500, headers: NO_STORE });
    }
  }
  const status = parsed.report_type === "unknown" || !parsed.source_as_of ? "needs_review" : "needs_review";
  const { error: updateError } = await db.from("collection_import_batches").update({
    report_type: parsed.report_type, source_as_of: parsed.source_as_of, status, parsed_at: new Date().toISOString(),
    metadata: { page_count: parsed.page_count, extracted_line_count: rows.length, parser: "pdfjs-dist", requires_human_confirmation: true },
  }).eq("id", id);
  if (updateError) return NextResponse.json({ error: "Unable to update import status", code: "IMPORT_BATCH_UPDATE_FAILED" }, { status: 500, headers: NO_STORE });
  try {
    await recordImportAudit({ batchId: id, actor: access.identity!.id, action: "pdf_parsed", detail: { report_type: parsed.report_type, source_as_of: parsed.source_as_of, page_count: parsed.page_count, extracted_line_count: rows.length } });
  } catch {
    return NextResponse.json({ error: "Extraction saved, but its audit record failed", code: "IMPORT_AUDIT_WRITE_FAILED" }, { status: 500, headers: NO_STORE });
  }
  return NextResponse.json({ batch_id: id, status, report_type: parsed.report_type, source_as_of: parsed.source_as_of, page_count: parsed.page_count, extracted_line_count: rows.length, requires_human_confirmation: true }, { headers: NO_STORE });
}
