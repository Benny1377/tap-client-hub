import { NextResponse } from "next/server";
import { requireCollectionsAccess } from "@/lib/billing-access";
import { canUseCollectionsImport } from "@/lib/collections-import";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONEY = /^(-?)(\d{1,10})(?:\.(\d{1,2}))?$/;

function money(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const match = MONEY.exec(String(value).trim());
  if (!match) return null;
  if (BigInt(match[2]) > 9999999999n) return null;
  return `${match[1]}${match[2]}.${(match[3] || "").padEnd(2, "0")}`;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireCollectionsAccess();
  if (access.response) return access.response;
  if (!await canUseCollectionsImport(access.identity!, "review")) {
    return NextResponse.json({ error: "You are not allowed to correct summary rows", code: "IMPORT_REVIEW_FORBIDDEN" }, { status: 403, headers: NO_STORE });
  }
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid summary batch id", code: "INVALID_BATCH_ID" }, { status: 422, headers: NO_STORE });
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid body");
    body = parsed as Record<string, unknown>;
  } catch { return NextResponse.json({ error: "Invalid JSON body", code: "INVALID_JSON" }, { status: 400, headers: NO_STORE }); }
  const balances = body.balances;
  const balanceFields = ["current", "days_1_30", "days_31_60", "days_61_90", "over_90", "total_open_balance"] as const;
  if (typeof body.row_id !== "string" || !UUID.test(body.row_id)
    || typeof body.customer_name !== "string" || !body.customer_name.trim() || body.customer_name.length > 255
    || body.confirmed !== true || !balances || typeof balances !== "object" || Array.isArray(balances)) {
    return NextResponse.json({ error: "Confirm the summary customer and all aging balances before saving", code: "SUMMARY_ROW_CORRECTION_INVALID" }, { status: 422, headers: NO_STORE });
  }
  const fields: Record<string, string> = {};
  for (const key of balanceFields) {
    const normalized = money((balances as Record<string, unknown>)[key]);
    if (normalized === null) return NextResponse.json({ error: "Enter valid currency values for every aging bucket and total", code: "SUMMARY_ROW_CORRECTION_INVALID" }, { status: 422, headers: NO_STORE });
    fields[key] = normalized;
  }
  const db = createAdminClient();
  const { data, error } = await db.rpc("review_collection_import_summary_row", {
    p_batch_id: id, p_row_id: body.row_id, p_actor: access.identity!.id,
    p_customer_name: body.customer_name.trim(), p_fields: fields,
  });
  if (error) {
    const missing = error.code === "P0002";
    const conflict = error.code === "P0001";
    return NextResponse.json({ error: missing ? "Summary report or row not found" : conflict ? "This summary row is not editable" : "Unable to save summary correction", code: missing ? "SUMMARY_ROW_NOT_FOUND" : conflict ? "BATCH_STATE_CONFLICT" : "SUMMARY_ROW_CORRECTION_FAILED" }, { status: missing ? 404 : conflict ? 409 : 500, headers: NO_STORE });
  }
  return NextResponse.json({ row: data }, { headers: NO_STORE });
}
