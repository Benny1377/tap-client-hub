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
  if (!await canUseCollectionsImport(access.identity!, "approve")) return NextResponse.json({ error: "You are not allowed to approve A/R reports", code: "IMPORT_APPROVE_FORBIDDEN" }, { status: 403, headers: NO_STORE });
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid batch id", code: "INVALID_BATCH_ID" }, { status: 422, headers: NO_STORE });
  let body: { summary_batch_id?: unknown };
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid body");
    body = parsed as { summary_batch_id?: unknown };
  } catch { return NextResponse.json({ error: "Choose the matching summary report", code: "SUMMARY_REPORT_REQUIRED" }, { status: 422, headers: NO_STORE }); }
  if (typeof body.summary_batch_id !== "string" || !UUID.test(body.summary_batch_id)) {
    return NextResponse.json({ error: "Upload and select the matching A/R summary report before approving the detail report", code: "SUMMARY_REPORT_REQUIRED" }, { status: 422, headers: NO_STORE });
  }
  const db = createAdminClient();
  const { data, error } = await db.rpc("approve_collection_import_pair", {
    p_detail_batch_id: id, p_summary_batch_id: body.summary_batch_id, p_actor: access.identity!.id,
  });
  if (error) {
    const forbidden = /uploader cannot approve|non-admin uploader|corrector cannot approve|batch corrector cannot approve/i.test(error.message);
    const conflict = error.code === "P0001";
    return NextResponse.json({ error: forbidden ? "A non-Admin uploader or anyone who corrected either report cannot approve this pair" : conflict ? "Upload both same-date reports and finish review before approval" : "Unable to reconcile and approve the report pair", code: forbidden ? "IMPORT_SEPARATION_OF_DUTIES" : conflict ? "IMPORT_APPROVAL_BLOCKED" : "IMPORT_APPROVAL_FAILED" }, { status: error.code === "P0002" ? 404 : conflict ? 409 : 500, headers: NO_STORE });
  }
  if (data?.status === "mismatch") {
    return NextResponse.json({ error: "The summary and detail report do not match; neither report was approved", code: "IMPORT_RECONCILIATION_MISMATCH", result: data }, { status: 409, headers: NO_STORE });
  }
  return NextResponse.json({ result: data }, { status: 200, headers: NO_STORE });
}
