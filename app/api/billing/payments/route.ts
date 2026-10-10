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
  if (error) return NextResponse.json({ error: "Unable to load payments", code: "PAYMENT_READ_FAILED" }, { status: 500 });
  const { data: readModel, error: readModelError } = await db.rpc("get_billing_receivables", { p_client_id: clientId || null });
  if (readModelError) return NextResponse.json({ error: "Unable to load unallocated payment balances", code: "READ_MODEL_FAILED" }, { status: 500 });
  const available = new Map((readModel?.unallocated_payment_balances || []).map((item: any) => [item.payment_id, item.unallocated]));
  const payments = (data || []).map((payment: any) => ({
    ...payment,
    unallocated_amount: payment.status === "recorded" ? available.get(payment.id) ?? "0.00" : "0.00",
  }));
  return NextResponse.json({ payments }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const access = await requireBillingAccess();
  if (access.response) return access.response;
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body", code: "INVALID_JSON" }, { status: 400 }); }
  if (!body?.client_id || !body?.received_on || !body?.amount || !body?.method) {
    return NextResponse.json({ error: "client_id, received_on, amount, and method are required", code: "INVALID_INPUT" }, { status: 422 });
  }
  const amount = String(body.amount).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) {
    return NextResponse.json({ error: "amount must be positive and have at most two decimals", code: "INVALID_AMOUNT" }, { status: 422 });
  }
  const db = createAdminClient();
  const { data, error } = await db.from("payments").insert({
    client_id: body.client_id, received_on: body.received_on, amount,
    method: body.method, reference: body.reference ?? null, created_by: access.identity?.id || null,
  }).select("*, payment_allocations(*)").single();
  if (error) return NextResponse.json({ error: error.message, code: error.code === "23514" ? "INVALID_PAYMENT" : "PAYMENT_CREATE_FAILED" }, { status: error.code === "23514" ? 422 : 500 });
  return NextResponse.json({ payment: data }, { status: 201 });
}
