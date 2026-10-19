import { NextResponse } from "next/server";
import { requireCollectionsAccess } from "@/lib/billing-access";
import { canUseCollectionsImport } from "@/lib/collections-import";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireCollectionsAccess();
  if (access.response) return access.response;
  if (!await canUseCollectionsImport(access.identity!, "review")) {
    return NextResponse.json({ error: "You are not allowed to correct A/R report metadata", code: "IMPORT_REVIEW_FORBIDDEN" }, { status: 403, headers: NO_STORE });
  }

  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid batch id", code: "INVALID_BATCH_ID" }, { status: 422, headers: NO_STORE });
  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON body", code: "INVALID_JSON" }, { status: 400, headers: NO_STORE }); }

  if ((body.report_type !== "aging_summary" && body.report_type !== "aging_detail") || !isDate(body.source_as_of) || body.confirmed !== true) {
    return NextResponse.json({
      error: "Confirm a supported report type and a valid as-of date from the PDF",
      code: "IMPORT_METADATA_CORRECTION_INVALID",
    }, { status: 422, headers: NO_STORE });
  }

  const db = createAdminClient();
  const { data, error } = await db.rpc("correct_collection_import_batch_metadata", {
    p_batch_id: id,
    p_report_type: body.report_type,
    p_source_as_of: body.source_as_of,
    p_actor: access.identity!.id,
    p_confirmed: true,
  });
  if (error) {
    const missing = error.code === "P0002";
    const conflict = error.code === "P0001";
    const invalid = error.code === "22023";
    return NextResponse.json({
      error: missing ? "Import batch not found" : conflict ? "Batch metadata can no longer be corrected" : invalid ? "Corrected metadata must be valid and differ from the parsed values" : "Unable to correct report metadata",
      code: missing ? "BATCH_NOT_FOUND" : conflict ? "BATCH_METADATA_CORRECTION_BLOCKED" : invalid ? "IMPORT_METADATA_CORRECTION_INVALID" : "IMPORT_METADATA_CORRECTION_FAILED",
    }, { status: missing ? 404 : conflict ? 409 : invalid ? 422 : 500, headers: NO_STORE });
  }
  return NextResponse.json({ batch: data }, { headers: NO_STORE });
}
