import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireBillingPowerUser, requireBillingAccess } from "@/lib/billing-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await requireBillingAccess();
  if (access.response) return access.response;
  const db = createAdminClient();
  let query = db.from("collection_holds").select("*").order("placed_at", { ascending: false });
  const clientId = request.nextUrl.searchParams.get("client_id");
  if (clientId) query = query.eq("client_id", clientId);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Unable to load Collections holds" }, { status: 500 });
  return NextResponse.json({ holds: data || [] }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const access = await requireBillingPowerUser();
  if (access.response) return access.response;
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  if (!body?.client_id || !body?.reason) return NextResponse.json({ error: "client_id and reason are required" }, { status: 422 });
  const db = createAdminClient();
  const { data, error } = await db.from("collection_holds").insert({ client_id: body.client_id, invoice_id: body.invoice_id ?? null, reason: body.reason, placed_by: access.identity!.id, expires_on: body.expires_on ?? null }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ hold: data }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const access = await requireBillingPowerUser();
  if (access.response) return access.response;
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  if (!body?.id) return NextResponse.json({ error: "id is required" }, { status: 422 });
  const db = createAdminClient();
  const { data, error } = await db.from("collection_holds").update({ released_by: access.identity!.id, released_at: new Date().toISOString() }).eq("id", body.id).is("released_at", null).select().single();
  if (error) return NextResponse.json({ error: error.code === "PGRST116" ? "Active hold not found" : error.message }, { status: error.code === "PGRST116" ? 404 : 500 });
  return NextResponse.json({ hold: data });
}
