import { NextRequest, NextResponse } from "next/server";
import { requireCollectionsAccess } from "@/lib/billing-access";
import { canUseCollectionsImport } from "@/lib/collections-import";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await requireCollectionsAccess();
  if (access.response) return access.response;
  if (!await canUseCollectionsImport(access.identity!, "approve")) return NextResponse.json({ error: "You are not allowed to preview report approval", code: "IMPORT_APPROVE_FORBIDDEN" }, { status: 403, headers: NO_STORE });
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid batch id", code: "INVALID_BATCH_ID" }, { status: 422, headers: NO_STORE });
  const params = request.nextUrl.searchParams;
  const limit = params.has("limit") ? Number(params.get("limit")) : 50;
  const offset = params.has("offset") ? Number(params.get("offset")) : 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) return NextResponse.json({ error: "limit must be an integer from 1 to 200", code: "INVALID_LIMIT" }, { status: 422, headers: NO_STORE });
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000) return NextResponse.json({ error: "offset must be a non-negative integer", code: "INVALID_OFFSET" }, { status: 422, headers: NO_STORE });
  const db = createAdminClient();
  const { data, error } = await db.rpc("preview_collection_import_clear", { p_detail_batch_id: id, p_limit: limit, p_offset: offset });
  if (error) return NextResponse.json({ error: "Unable to preview omitted invoices", code: "IMPORT_CLEAR_PREVIEW_FAILED" }, { status: error.code === "P0002" ? 404 : error.code === "22023" ? 422 : 500, headers: NO_STORE });
  return NextResponse.json({ would_clear: data }, { headers: NO_STORE });
}
