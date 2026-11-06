import { NextResponse } from "next/server";
import { requireCollectionsAccess } from "@/lib/billing-access";
import { canUseCollectionsImport } from "@/lib/collections-import";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireCollectionsAccess();
  if (access.response) return access.response;
  if (!await canUseCollectionsImport(access.identity!, "review")) {
    return NextResponse.json({ error: "You are not allowed to review A/R reports", code: "IMPORT_REVIEW_FORBIDDEN" }, { status: 403, headers: NO_STORE });
  }
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid batch id", code: "INVALID_BATCH_ID" }, { status: 422, headers: NO_STORE });

  const db = createAdminClient();
  const [{ data: batch, error: batchError }, { data: rows, error: rowsError }] = await Promise.all([
    db.from("collection_import_batches").select("id,status,report_type,source_as_of").eq("id", id).maybeSingle(),
    db.from("collection_import_rows").select("id,parsed_fields").eq("batch_id", id).is("source_invoice_id", null).eq("review_disposition", "unreviewed").order("page_number").order("row_number"),
  ]);
  if (batchError || !batch) return NextResponse.json({ error: "Import batch not found", code: "BATCH_NOT_FOUND" }, { status: 404, headers: NO_STORE });
  if (rowsError || !rows) return NextResponse.json({ error: "Unable to prepare invoice matches", code: "IMPORT_AUTO_MATCH_READ_FAILED" }, { status: 500, headers: NO_STORE });
  if (batch.status !== "needs_review" || batch.report_type !== "aging_detail" || !batch.source_as_of) {
    return NextResponse.json({ error: "Only a recognized detail report with a confirmed as-of date can be matched", code: "BATCH_STATE_CONFLICT" }, { status: 409, headers: NO_STORE });
  }

  const candidateIds = rows.filter((row) => {
    const fields = (row.parsed_fields as Record<string, unknown> | null)?.auto_suggestion as { disposition?: string; confidence?: string } | undefined;
    return fields?.disposition === "invoice" && fields.confidence === "high";
  }).map((row) => row.id);
  if (candidateIds.length === 0) {
    return NextResponse.json({ batch_id: id, matched: 0, uncertain: rows.length, unmatched_client: 0, requires_separate_owner_approval: true, message: "No high-confidence invoice rows were found. All remaining lines stay in manual review." }, { headers: NO_STORE });
  }

  const selectedIds = candidateIds.slice(0, 500);
  const { data, error } = await db.rpc("auto_match_collection_import_rows", {
    p_batch_id: id,
    p_actor: access.identity!.id,
    p_source_row_ids: selectedIds,
  });
  if (error || !data || typeof data !== "object") {
    return NextResponse.json({ error: "Automatic matching failed without approving or publishing this report. You can retry safely.", code: "IMPORT_AUTO_MATCH_FAILED" }, { status: 500, headers: NO_STORE });
  }
  const result = data as { matched?: number; uncertain?: number; unmatched_client?: number };
  const matched = Number(result.matched || 0);
  const uncertain = Math.max(0, rows.length - candidateIds.length) + Number(result.uncertain || 0);
  const unmatchedClient = Number(result.unmatched_client || 0);
  const unprocessed = candidateIds.length - selectedIds.length;
  return NextResponse.json({
    batch_id: id, matched, uncertain, unmatched_client: unmatchedClient,
    unprocessed,
    requires_separate_owner_approval: true,
    message: "Only high-confidence invoice rows with one exact existing client match were prepared. Other rows remain for manual review; this does not approve the report or add it to Collections.",
  }, { headers: NO_STORE });
}
