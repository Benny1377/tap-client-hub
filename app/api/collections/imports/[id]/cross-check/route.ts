import { NextResponse } from "next/server";
import { requireCollectionsAccess } from "@/lib/billing-access";
import { canUseCollectionsImport } from "@/lib/collections-import";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireCollectionsAccess();
  if (access.response) return access.response;
  if (!await canUseCollectionsImport(access.identity!, "review")) return NextResponse.json({ error: "You are not allowed to cross-check A/R reports", code: "IMPORT_REVIEW_FORBIDDEN" }, { status: 403, headers: NO_STORE });
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid summary batch id", code: "INVALID_BATCH_ID" }, { status: 422, headers: NO_STORE });
  let body: { detail_batch_id?: unknown; summary_total?: unknown; note?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body", code: "INVALID_JSON" }, { status: 400, headers: NO_STORE }); }
  if (typeof body.detail_batch_id !== "string" || !UUID.test(body.detail_batch_id)
    || typeof body.summary_total !== "number" || !Number.isFinite(body.summary_total) || Math.abs(body.summary_total) > 9999999999.99
    || typeof body.note !== "string" || body.note.trim().length < 8 || body.note.length > 2000) {
    return NextResponse.json({ error: "Choose a detail report, enter its matching summary total, and explain the check", code: "IMPORT_CROSS_CHECK_INVALID" }, { status: 422, headers: NO_STORE });
  }
  const db = createAdminClient();
  const { data, error } = await db.rpc("cross_check_collection_import_reports", {
    p_summary_batch_id: id, p_detail_batch_id: body.detail_batch_id,
    p_summary_total: Math.round(body.summary_total * 100) / 100,
    p_note: body.note.trim(), p_actor: access.identity!.id,
  });
  if (error) {
    const missing = error.code === "P0002";
    const conflict = error.code === "P0001";
    return NextResponse.json({ error: missing ? "Summary or detail batch not found" : conflict ? "Reports are not ready for cross-check" : "Unable to cross-check reports", code: missing ? "BATCH_NOT_FOUND" : conflict ? "IMPORT_CROSS_CHECK_CONFLICT" : "IMPORT_CROSS_CHECK_FAILED" }, { status: missing ? 404 : conflict ? 409 : 500, headers: NO_STORE });
  }
  return NextResponse.json({ cross_check: data }, { headers: NO_STORE });
}
