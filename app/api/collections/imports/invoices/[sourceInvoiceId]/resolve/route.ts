import { NextResponse } from "next/server";
import { requireCollectionsAccess } from "@/lib/billing-access";
import { canUseCollectionsImport } from "@/lib/collections-import";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request, context: { params: Promise<{ sourceInvoiceId: string }> }) {
  const access = await requireCollectionsAccess();
  if (access.response) return access.response;
  if (!await canUseCollectionsImport(access.identity!, "review")) return NextResponse.json({ error: "You are not allowed to resolve A/R discrepancies", code: "IMPORT_REVIEW_FORBIDDEN" }, { status: 403, headers: NO_STORE });
  const { sourceInvoiceId } = await context.params;
  if (!UUID.test(sourceInvoiceId)) return NextResponse.json({ error: "Invalid source invoice id", code: "INVALID_SOURCE_INVOICE_ID" }, { status: 422, headers: NO_STORE });
  let body: { selected_source?: unknown; resolution_note?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body", code: "INVALID_JSON" }, { status: 400, headers: NO_STORE }); }
  if ((body.selected_source !== "billing" && body.selected_source !== "pdf_import") || typeof body.resolution_note !== "string" || body.resolution_note.trim().length < 8 || body.resolution_note.length > 2000) {
    return NextResponse.json({ error: "Choose a source and explain the reconciliation (8–2000 characters)", code: "DISCREPANCY_RESOLUTION_INVALID" }, { status: 422, headers: NO_STORE });
  }
  const db = createAdminClient();
  const { data, error } = await db.rpc("resolve_collection_import_discrepancy", {
    p_source_invoice_id: sourceInvoiceId, p_selected_source: body.selected_source,
    p_note: body.resolution_note.trim(), p_actor: access.identity!.id,
  });
  if (error) {
    const notFound = error.code === "P0002";
    const conflict = error.code === "P0001";
    return NextResponse.json({ error: notFound ? "Imported invoice not found" : conflict ? "The import is not eligible for this resolution" : "Unable to resolve import discrepancy", code: notFound ? "SOURCE_INVOICE_NOT_FOUND" : conflict ? "DISCREPANCY_RESOLUTION_BLOCKED" : "DISCREPANCY_RESOLUTION_FAILED" }, { status: notFound ? 404 : conflict ? 409 : 500, headers: NO_STORE });
  }
  return NextResponse.json(data, { headers: NO_STORE });
}
