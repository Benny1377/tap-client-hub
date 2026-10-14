import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireBillingPowerUser, requireLedgerReadAccess } from "@/lib/billing-access";
import { collectionsError } from "@/lib/collections-route-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await requireLedgerReadAccess();
  if (access.response) return access.response;
  const db = createAdminClient();
  let query = db.from("collection_holds").select("*, invoice:invoices(invoice_number)").order("placed_at", { ascending: false });
  const clientId = request.nextUrl.searchParams.get("client_id");
  if (clientId) query = query.eq("client_id", clientId);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Unable to load Collections holds", code: "READ_FAILED" }, { status: 500 });
  const holds = (data || []).map(({ invoice, ...hold }) => ({ ...hold, invoice_number: invoice?.invoice_number ?? null }));
  return NextResponse.json({ holds }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const access = await requireBillingPowerUser();
  if (access.response) return access.response;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body", code: "INVALID_JSON" }, { status: 400 }); }
  if (!body?.client_id || !body?.reason) return NextResponse.json({ error: "client_id and reason are required", code: "INVALID_INPUT" }, { status: 422 });
  const db = createAdminClient();
  const { data: holdId, error } = await db.rpc("place_collection_hold", {
    p_client_id: body.client_id, p_invoice_id: body.invoice_id ?? null,
    p_reason: body.reason, p_actor: access.identity!.id, p_expires_on: body.expires_on ?? null,
  });
  if (error) {
    const mapped = collectionsError(error, "HOLD_CREATE_FAILED", "Unable to place Collections hold");
    return NextResponse.json({ error: mapped.error, code: mapped.code }, { status: mapped.status });
  }
  const { data, error: readError } = await db.from("collection_holds").select("*, invoice:invoices(invoice_number)").eq("id", holdId).single();
  if (readError) return NextResponse.json({ error: "Hold was placed but could not be loaded", code: "READ_AFTER_WRITE_FAILED" }, { status: 500 });
  const { invoice, ...hold } = data;
  return NextResponse.json({ hold: { ...hold, invoice_number: invoice?.invoice_number ?? null } }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const access = await requireBillingPowerUser();
  if (access.response) return access.response;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body", code: "INVALID_JSON" }, { status: 400 }); }
  if (!body?.id) return NextResponse.json({ error: "id is required", code: "INVALID_INPUT" }, { status: 422 });
  const db = createAdminClient();
  const { data: holdId, error } = await db.rpc("release_collection_hold", { p_hold_id: body.id, p_actor: access.identity!.id });
  if (error) {
    const notActive = /conflict/i.test(error.message);
    return NextResponse.json(
      { error: notActive ? "Active hold not found" : "Unable to release hold", code: notActive ? "HOLD_NOT_ACTIVE" : "HOLD_RELEASE_FAILED" },
      { status: notActive ? 409 : 500 },
    );
  }
  const { data, error: readError } = await db.from("collection_holds").select("*, invoice:invoices(invoice_number)").eq("id", holdId).single();
  if (readError) return NextResponse.json({ error: "Hold was released but could not be loaded", code: "READ_AFTER_WRITE_FAILED" }, { status: 500 });
  const { invoice, ...hold } = data;
  return NextResponse.json({ hold: { ...hold, invoice_number: invoice?.invoice_number ?? null } });
}
