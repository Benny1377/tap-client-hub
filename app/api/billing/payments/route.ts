import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireBillingAccess, requireLedgerReadAccess } from "@/lib/billing-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await requireLedgerReadAccess();
  if (access.response) return access.response;
  const db = createAdminClient();
  let query = db.from("payments").select("*, payment_allocations(*)").order("received_on", { ascending: false });
  const clientId = request.nextUrl.searchParams.get("client_id");
  if (clientId) query = query.eq("client_id", clientId);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Unable to load payments" }, { status: 500 });
  return NextResponse.json({ payments: data || [] }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const access = await requireBillingAccess();
  if (access.response) return access.response;
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  if (!body?.client_id || !body?.received_on || !body?.amount || !body?.method) {
    return NextResponse.json({ error: "client_id, received_on, amount, and method are required" }, { status: 422 });
  }
  const amount = String(body.amount).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) {
    return NextResponse.json({ error: "amount must be positive and have at most two decimals" }, { status: 422 });
  }
  const db = createAdminClient();
  const { data, error } = await db.from("payments").insert({
    client_id: body.client_id, received_on: body.received_on, amount,
    method: body.method, reference: body.reference ?? null, created_by: access.identity?.id || null,
  }).select("*, payment_allocations(*)").single();
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "23514" ? 422 : 500 });
  return NextResponse.json({ payment: data }, { status: 201 });
}
