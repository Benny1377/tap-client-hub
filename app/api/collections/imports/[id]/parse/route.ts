import { NextResponse } from "next/server";
import { requireCollectionsAccess } from "@/lib/billing-access";
import { canUseCollectionsImport, recordImportAudit } from "@/lib/collections-import";
import { parseCollectionsPdf } from "@/lib/collections-pdf-parser";
import { COLLECTIONS_PDF_SUGGESTION_PARSER_VERSION, suggestCollectionsPdfRows } from "@/lib/collections-pdf-suggestions";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireCollectionsAccess();
  if (access.response) return access.response;
  if (!await canUseCollectionsImport(access.identity!, "review")) return NextResponse.json({ error: "You are not allowed to parse A/R reports", code: "IMPORT_REVIEW_FORBIDDEN" }, { status: 403, headers: NO_STORE });
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid batch id", code: "INVALID_BATCH_ID" }, { status: 422, headers: NO_STORE });
  const db = createAdminClient();
  const { data: batch, error: batchError } = await db.from("collection_import_batches").select("id,storage_path,status,report_type,source_as_of,metadata").eq("id", id).maybeSingle();
  if (batchError || !batch) return NextResponse.json({ error: "Import batch not found", code: "BATCH_NOT_FOUND" }, { status: 404, headers: NO_STORE });
  let refreshSuggestions = false;
  if (request.headers.get("content-type")?.includes("application/json")) {
    try { refreshSuggestions = (await request.json())?.refresh_suggestions === true; } catch { /* optional body */ }
  }
  const refreshingReview = batch.status === "needs_review" && refreshSuggestions;
  if (batch.status !== "uploaded" && batch.status !== "failed" && !refreshingReview) return NextResponse.json({ error: "Batch is not available for parsing", code: "BATCH_STATE_CONFLICT" }, { status: 409, headers: NO_STORE });

  const { data: file, error: downloadError } = await db.storage.from("collections-ar-pdfs").download(batch.storage_path);
  if (downloadError || !file) return NextResponse.json({ error: "Unable to read stored report", code: "IMPORT_STORAGE_READ_FAILED" }, { status: 503, headers: NO_STORE });
  let parsed;
  try { parsed = await parseCollectionsPdf(new Uint8Array(await file.arrayBuffer())); }
  catch {
    await db.from("collection_import_batches").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", id);
    try { await recordImportAudit({ batchId: id, actor: access.identity!.id, action: "pdf_parse_failed" }); } catch { /* the failing operation is reported below */ }
    return NextResponse.json({ error: "PDF text extraction failed; the stored report remains available for manual review", code: "PDF_EXTRACTION_FAILED" }, { status: 422, headers: NO_STORE });
  }

  const suggestions = parsed.report_type === "aging_detail"
    ? suggestCollectionsPdfRows(parsed.lines)
    : parsed.report_type === "aging_summary"
      ? parsed.lines.map(() => ({ disposition: "ignored" as const, confidence: "high" as const, reason: "Summary reports are aggregate cross-check evidence, not invoice rows" }))
      : parsed.lines.map(() => ({ disposition: "unreviewed" as const, confidence: "low" as const, reason: "Automatic invoice mapping is available only for recognized QuickBooks layouts" }));
  const pageRows = new Map<number, number>();
  const rows = parsed.lines.map((line, index) => {
    const rowNumber = (pageRows.get(line.page) || 0) + 1;
    pageRows.set(line.page, rowNumber);
    const suggestion = suggestions[index];
    const autoClassified = suggestion.disposition === "header" || suggestion.disposition === "summary" || suggestion.disposition === "ignored";
    return {
      batch_id: id, page_number: line.page, row_number: rowNumber, raw_text: line.text,
      parsed_fields: { cells: line.cells, cell_positions: line.cell_positions, auto_suggestion: suggestion },
      ...(autoClassified ? { review_disposition: suggestion.disposition } : {}),
    };
  });
  const autoClassifiedCount = suggestions.filter((suggestion) => suggestion.disposition === "header" || suggestion.disposition === "summary" || suggestion.disposition === "ignored").length;
  const highConfidenceInvoiceCount = suggestions.filter((suggestion) => suggestion.disposition === "invoice" && suggestion.confidence === "high").length;
  if (refreshingReview) {
    if (batch.report_type !== parsed.report_type || batch.source_as_of !== parsed.source_as_of) {
      return NextResponse.json({ error: "The refreshed read disagrees with the report details already confirmed. Nothing was changed.", code: "IMPORT_REFRESH_METADATA_CONFLICT" }, { status: 409, headers: NO_STORE });
    }
    const { data: existingRows, error: existingRowsError } = await db.from("collection_import_rows")
      .select("id,page_number,row_number,source_invoice_id,review_disposition").eq("batch_id", id).order("page_number").order("row_number");
    if (existingRowsError || !existingRows) return NextResponse.json({ error: "Unable to safely refresh existing report rows", code: "IMPORT_REFRESH_READ_FAILED" }, { status: 500, headers: NO_STORE });
    if (existingRows.length !== rows.length || existingRows.some((row, index) => row.page_number !== rows[index].page_number || row.row_number !== rows[index].row_number)) {
      return NextResponse.json({ error: "The refreshed extraction has different line boundaries. Existing review was preserved.", code: "IMPORT_REFRESH_SHAPE_CHANGED" }, { status: 409, headers: NO_STORE });
    }
    let updatedSuggestions = 0;
    for (let index = 0; index < existingRows.length; index += 1) {
      const existing = existingRows[index];
      if (existing.source_invoice_id || existing.review_disposition === "duplicate") continue;
      const suggestion = suggestions[index];
      const parsedFields = rows[index].parsed_fields;
      const update: Record<string, unknown> = { parsed_fields: parsedFields };
      if (existing.review_disposition === "unreviewed" && (suggestion.disposition === "header" || suggestion.disposition === "summary" || suggestion.disposition === "ignored")) {
        update.review_disposition = suggestion.disposition;
      }
      const { error: refreshError } = await db.from("collection_import_rows").update(update).eq("id", existing.id).is("source_invoice_id", null)
        .eq("review_disposition", existing.review_disposition);
      if (refreshError) return NextResponse.json({ error: "Some suggestions may have refreshed. Retry to continue; existing review decisions were preserved.", code: "IMPORT_REFRESH_PARTIAL", updated_suggestions: updatedSuggestions }, { status: 500, headers: NO_STORE });
      updatedSuggestions += 1;
    }
    const refreshedMetadata = { ...(batch.metadata || {}), suggestion_parser: COLLECTIONS_PDF_SUGGESTION_PARSER_VERSION, auto_classified_count: autoClassifiedCount, high_confidence_invoice_suggestions: highConfidenceInvoiceCount };
    const { error: metadataError } = await db.from("collection_import_batches").update({ metadata: refreshedMetadata, updated_at: new Date().toISOString() }).eq("id", id).eq("status", "needs_review");
    if (metadataError) return NextResponse.json({ error: "Rows were refreshed, but parser-version metadata could not be saved", code: "IMPORT_BATCH_UPDATE_FAILED" }, { status: 500, headers: NO_STORE });
    try { await recordImportAudit({ batchId: id, actor: access.identity!.id, action: "pdf_suggestions_refreshed", detail: { updated_suggestions: updatedSuggestions, auto_classified_count: autoClassifiedCount, high_confidence_invoice_suggestions: highConfidenceInvoiceCount } }); }
    catch { return NextResponse.json({ error: "Suggestions refreshed, but the audit record failed", code: "IMPORT_AUDIT_WRITE_FAILED" }, { status: 500, headers: NO_STORE }); }
    return NextResponse.json({ batch_id: id, status: "needs_review", report_type: parsed.report_type, source_as_of: parsed.source_as_of, page_count: parsed.page_count, extracted_line_count: rows.length, updated_suggestions: updatedSuggestions, auto_classified_count: autoClassifiedCount, high_confidence_invoice_suggestions: highConfidenceInvoiceCount, requires_human_confirmation: true }, { headers: NO_STORE });
  }
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
    metadata: {
      page_count: parsed.page_count, extracted_line_count: rows.length, parser: "pdfjs-dist",
      suggestion_parser: COLLECTIONS_PDF_SUGGESTION_PARSER_VERSION, auto_classified_count: autoClassifiedCount,
      high_confidence_invoice_suggestions: highConfidenceInvoiceCount, requires_human_confirmation: true,
    },
  }).eq("id", id);
  if (updateError) return NextResponse.json({ error: "Unable to update import status", code: "IMPORT_BATCH_UPDATE_FAILED" }, { status: 500, headers: NO_STORE });
  try {
    await recordImportAudit({ batchId: id, actor: access.identity!.id, action: "pdf_parsed", detail: {
      report_type: parsed.report_type, source_as_of: parsed.source_as_of, page_count: parsed.page_count,
      extracted_line_count: rows.length, auto_classified_count: autoClassifiedCount,
      high_confidence_invoice_suggestions: highConfidenceInvoiceCount,
    } });
  } catch {
    return NextResponse.json({ error: "Extraction saved, but its audit record failed", code: "IMPORT_AUDIT_WRITE_FAILED" }, { status: 500, headers: NO_STORE });
  }
  return NextResponse.json({
    batch_id: id, status, report_type: parsed.report_type, source_as_of: parsed.source_as_of,
    page_count: parsed.page_count, extracted_line_count: rows.length, auto_classified_count: autoClassifiedCount,
    high_confidence_invoice_suggestions: highConfidenceInvoiceCount, requires_human_confirmation: true,
  }, { headers: NO_STORE });
}
