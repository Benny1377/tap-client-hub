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
  if (!await canUseCollectionsImport(access.identity!, "approve")) return NextResponse.json({ error: "You are not allowed to approve A/R reports", code: "IMPORT_APPROVE_FORBIDDEN" }, { status: 403, headers: NO_STORE });
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid batch id", code: "INVALID_BATCH_ID" }, { status: 422, headers: NO_STORE });
  const db = createAdminClient();
  const { data, error } = await db.rpc("approve_collection_import_batch", { p_batch_id: id, p_actor: access.identity!.id });
  if (error) {
    const forbidden = /uploader cannot approve|corrector cannot approve|batch corrector cannot approve/i.test(error.message);
    const conflict = error.code === "P0001";
    return NextResponse.json({ error: forbidden ? "The uploader or a batch corrector cannot approve this report" : conflict ? "Batch is not ready for approval" : "Unable to approve import batch", code: forbidden ? "IMPORT_SEPARATION_OF_DUTIES" : conflict ? "IMPORT_APPROVAL_BLOCKED" : "IMPORT_APPROVAL_FAILED" }, { status: error.code === "P0002" ? 404 : conflict ? 409 : 500, headers: NO_STORE });
  }
  return NextResponse.json({ batch: data }, { status: 200, headers: NO_STORE });
}
