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
  let failedBatchHasRows = false;
  if (batch.status === "failed") {
    const { data: savedRows, error: savedRowsError } = await db.from("collection_import_rows")
      .select("id").eq("batch_id", id).limit(1);
    if (savedRowsError || !savedRows) return NextResponse.json({ error: "Unable to safely retry this report", code: "IMPORT_RETRY_READ_FAILED" }, { status: 500, headers: NO_STORE });
    failedBatchHasRows = savedRows.length > 0;
  }
  // A failed batch with saved rows may be a refresh that failed under an older build.
  // Never let that retry take the destructive initial-parse path.
  const refreshingReview = (batch.status === "needs_review" && refreshSuggestions) || (batch.status === "failed" && failedBatchHasRows);
  if (batch.status !== "uploaded" && batch.status !== "failed" && !refreshingReview) return NextResponse.json({ error: "Batch is not available for parsing", code: "BATCH_STATE_CONFLICT" }, { status: 409, headers: NO_STORE });

  const { data: file, error: downloadError } = await db.storage.from("collections-ar-pdfs").download(batch.storage_path);
  if (downloadError || !file) return NextResponse.json({ error: "Unable to read stored report", code: "IMPORT_STORAGE_READ_FAILED" }, { status: 503, headers: NO_STORE });
  let parsed;
  try { parsed = await parseCollectionsPdf(new Uint8Array(await file.arrayBuffer())); }
  catch {
    const failureStatus = refreshingReview ? "needs_review" : "failed";
    await db.from("collection_import_batches").update({ status: failureStatus, updated_at: new Date().toISOString() }).eq("id", id).eq("status", batch.status);
    try { await recordImportAudit({ batchId: id, actor: access.identity!.id, action: "pdf_parse_failed" }); } catch { /* the failing operation is reported below */ }
    return NextResponse.json({ error: "PDF text extraction failed; the stored report remains available for manual review", code: "PDF_EXTRACTION_FAILED" }, { status: 422, headers: NO_STORE });
  }

  let summaryLines: Array<{ page: number; text: string; cells: string[]; cell_positions?: number[] }> = [];
  let summaryContextBatchId: string | null = null;
  if (parsed.report_type === "aging_detail" && parsed.source_as_of) {
    const { data: summaryBatches } = await db.from("collection_import_batches")
      .select("id").eq("report_type", "aging_summary").eq("source_as_of", parsed.source_as_of)
      .eq("status", "needs_review").neq("id", id).limit(2);
    // Use a companion summary only when exactly one same-date report is available.
    // Ambiguous or unreadable context leaves the customer name for manual review.
    if (summaryBatches?.length === 1) {
      const { data: sourceRows } = await db.from("collection_import_rows")
        .select("page_number,raw_text,parsed_fields").eq("batch_id", summaryBatches[0].id)
        .order("page_number").order("row_number");
      if (sourceRows?.length) {
        try {
          await recordImportAudit({ batchId: summaryBatches[0].id, actor: access.identity!.id, action: "pdf_summary_matching_context_read", detail: { detail_batch_id: id } });
        } catch {
          return NextResponse.json({ error: "Unable to record summary report access", code: "IMPORT_AUDIT_WRITE_FAILED" }, { status: 500, headers: NO_STORE });
        }
        summaryContextBatchId = summaryBatches[0].id;
        summaryLines = sourceRows.map((row) => {
          const fields = row.parsed_fields as { cells?: unknown; cell_positions?: unknown } | null;
          return {
            page: row.page_number,
            text: row.raw_text,
            cells: Array.isArray(fields?.cells) ? fields.cells.filter((cell): cell is string => typeof cell === "string") : [],
            ...(Array.isArray(fields?.cell_positions) ? { cell_positions: fields.cell_positions.filter((position): position is number => typeof position === "number") } : {}),
          };
        });
      }
    }
  }
  const suggestions = parsed.report_type === "aging_detail"
    ? suggestCollectionsPdfRows(parsed.lines, summaryLines)
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
      // The database column is NOT NULL; every extracted line needs an explicit
      // state, including invoice suggestions and rows needing human review.
      review_disposition: autoClassified ? suggestion.disposition : "unreviewed",
    };
  });
  const autoClassifiedCount = suggestions.filter((suggestion) => suggestion.disposition === "header" || suggestion.disposition === "summary" || suggestion.disposition === "ignored").length;
  const highConfidenceInvoiceCount = suggestions.filter((suggestion) => suggestion.disposition === "invoice" && suggestion.confidence === "high").length;
  const summaryBackedCustomerCount = suggestions.filter((suggestion) => suggestion.disposition === "invoice" && suggestion.reason.includes("unique summary name")).length;
  if (refreshingReview) {
    if (batch.report_type !== parsed.report_type || batch.source_as_of !== parsed.source_as_of) {
      return NextResponse.json({ error: "The refreshed read disagrees with the report details already confirmed. Nothing was changed.", code: "IMPORT_REFRESH_METADATA_CONFLICT" }, { status: 409, headers: NO_STORE });
    }
    const { data: existingRows, error: existingRowsError } = await db.from("collection_import_rows")
      .select("id,page_number,row_number,source_invoice_id,review_disposition,duplicate_of,exact_duplicate").eq("batch_id", id).order("page_number").order("row_number");
    if (existingRowsError || !existingRows) return NextResponse.json({ error: "Unable to safely refresh existing report rows", code: "IMPORT_REFRESH_READ_FAILED" }, { status: 500, headers: NO_STORE });
    if (existingRows.length !== rows.length || existingRows.some((row, index) => row.page_number !== rows[index].page_number || row.row_number !== rows[index].row_number)) {
      return NextResponse.json({ error: "The refreshed extraction has different line boundaries. Existing review was preserved.", code: "IMPORT_REFRESH_SHAPE_CHANGED" }, { status: 409, headers: NO_STORE });
    }
    let updatedSuggestions = 0;
    for (let index = 0; index < existingRows.length; index += 1) {
      const existing = existingRows[index];
      if (existing.source_invoice_id) continue;
      const suggestion = suggestions[index];
      const parsedFields = rows[index].parsed_fields;
      const update: Record<string, unknown> = { parsed_fields: parsedFields };
      // Older builds marked repeated raw text as duplicate without enough
      // evidence to distinguish a repeated transaction from a repeated line.
      // These were machine-only flags (the review API never writes duplicate_of).
      if (existing.review_disposition === "duplicate" && existing.duplicate_of && existing.exact_duplicate) {
        update.review_disposition = suggestion.disposition;
        update.duplicate_of = null;
        update.exact_duplicate = false;
      }
      if (existing.review_disposition === "unreviewed" && (suggestion.disposition === "header" || suggestion.disposition === "summary" || suggestion.disposition === "ignored")) {
        update.review_disposition = suggestion.disposition;
      }
      const { error: refreshError } = await db.from("collection_import_rows").update(update).eq("id", existing.id).is("source_invoice_id", null)
        .eq("review_disposition", existing.review_disposition);
      if (refreshError) return NextResponse.json({ error: "Some suggestions may have refreshed. Retry to continue; existing review decisions were preserved.", code: "IMPORT_REFRESH_PARTIAL", updated_suggestions: updatedSuggestions }, { status: 500, headers: NO_STORE });
      updatedSuggestions += 1;
    }
    const refreshedMetadata = { ...(batch.metadata || {}), suggestion_parser: COLLECTIONS_PDF_SUGGESTION_PARSER_VERSION, auto_classified_count: autoClassifiedCount, high_confidence_invoice_suggestions: highConfidenceInvoiceCount, summary_backed_customer_suggestions: summaryBackedCustomerCount, summary_context_batch_id: summaryContextBatchId };
    const { data: updatedBatch, error: metadataError } = await db.from("collection_import_batches")
      .update({ status: "needs_review", metadata: refreshedMetadata, updated_at: new Date().toISOString() })
      .eq("id", id).eq("status", batch.status).select("id").maybeSingle();
    if (metadataError || !updatedBatch) return NextResponse.json({ error: "Rows were refreshed, but the batch status could not be restored", code: "IMPORT_BATCH_UPDATE_FAILED" }, { status: 500, headers: NO_STORE });
    try { await recordImportAudit({ batchId: id, actor: access.identity!.id, action: "pdf_suggestions_refreshed", detail: { updated_suggestions: updatedSuggestions, auto_classified_count: autoClassifiedCount, high_confidence_invoice_suggestions: highConfidenceInvoiceCount } }); }
    catch { return NextResponse.json({ error: "Suggestions refreshed, but the audit record failed", code: "IMPORT_AUDIT_WRITE_FAILED" }, { status: 500, headers: NO_STORE }); }
    return NextResponse.json({ batch_id: id, status: "needs_review", report_type: parsed.report_type, source_as_of: parsed.source_as_of, page_count: parsed.page_count, extracted_line_count: rows.length, updated_suggestions: updatedSuggestions, auto_classified_count: autoClassifiedCount, high_confidence_invoice_suggestions: highConfidenceInvoiceCount, summary_backed_customer_suggestions: summaryBackedCustomerCount, requires_human_confirmation: true }, { headers: NO_STORE });
  }
  const { error: clearError } = await db.from("collection_import_rows").delete().eq("batch_id", id);
  if (clearError) return NextResponse.json({ error: "Unable to replace the previous extraction", code: "IMPORT_ROWS_RESET_FAILED" }, { status: 500, headers: NO_STORE });
  if (rows.length) {
    const chunkSize = 200;
    for (let offset = 0; offset < rows.length; offset += chunkSize) {
      const chunk = rows.slice(offset, offset + chunkSize);
      const { data, error: rowError } = await db.from("collection_import_rows").insert(chunk).select("id,page_number,row_number,raw_text");
      if (rowError || !data) {
        const { error: cleanupError } = await db.from("collection_import_rows").delete().eq("batch_id", id);
        // Keep diagnostics useful without logging customer names, raw PDF text, or PostgREST details.
        console.error("[collections-import] row insert failed", {
          database_code: rowError?.code || "unknown",
          row_count: rows.length,
          chunk_size: chunk.length,
          failed_chunk: Math.floor(offset / chunkSize) + 1,
          payload_bytes: Buffer.byteLength(JSON.stringify(chunk)),
          partial_rows_cleanup_failed: Boolean(cleanupError),
        });
        return NextResponse.json({ error: "Unable to save extracted report rows", code: "IMPORT_ROWS_WRITE_FAILED" }, { status: 500, headers: NO_STORE });
      }
    }
    // Do not infer duplicates from identical PDF text. Repeated payment and
    // invoice rows can be legitimate and participate in report reconciliation.
  }
  const status = parsed.report_type === "unknown" || !parsed.source_as_of ? "needs_review" : "needs_review";
  const { error: updateError } = await db.from("collection_import_batches").update({
    report_type: parsed.report_type, source_as_of: parsed.source_as_of, status, parsed_at: new Date().toISOString(),
    metadata: {
      page_count: parsed.page_count, extracted_line_count: rows.length, parser: "pdfjs-dist",
      suggestion_parser: COLLECTIONS_PDF_SUGGESTION_PARSER_VERSION, auto_classified_count: autoClassifiedCount,
      high_confidence_invoice_suggestions: highConfidenceInvoiceCount, summary_backed_customer_suggestions: summaryBackedCustomerCount,
      summary_context_batch_id: summaryContextBatchId, requires_human_confirmation: true,
    },
  }).eq("id", id);
  if (updateError) return NextResponse.json({ error: "Unable to update import status", code: "IMPORT_BATCH_UPDATE_FAILED" }, { status: 500, headers: NO_STORE });
  try {
    await recordImportAudit({ batchId: id, actor: access.identity!.id, action: "pdf_parsed", detail: {
      report_type: parsed.report_type, source_as_of: parsed.source_as_of, page_count: parsed.page_count,
      extracted_line_count: rows.length, auto_classified_count: autoClassifiedCount,
      high_confidence_invoice_suggestions: highConfidenceInvoiceCount, summary_backed_customer_suggestions: summaryBackedCustomerCount,
    } });
  } catch {
    return NextResponse.json({ error: "Extraction saved, but its audit record failed", code: "IMPORT_AUDIT_WRITE_FAILED" }, { status: 500, headers: NO_STORE });
  }
  return NextResponse.json({
    batch_id: id, status, report_type: parsed.report_type, source_as_of: parsed.source_as_of,
    page_count: parsed.page_count, extracted_line_count: rows.length, auto_classified_count: autoClassifiedCount,
    high_confidence_invoice_suggestions: highConfidenceInvoiceCount, summary_backed_customer_suggestions: summaryBackedCustomerCount,
    requires_human_confirmation: true,
  }, { headers: NO_STORE });
}
