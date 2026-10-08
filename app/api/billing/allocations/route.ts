import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireBillingAccess } from "@/lib/billing-access";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const access = await requireBillingAccess();
  if (access.response) return access.response;
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  if (!body?.payment_id || !body?.invoice_id || body.amount == null) {
    return NextResponse.json({ error: "payment_id, invoice_id, and amount are required" }, { status: 422 });
  }
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || Math.round(amount * 100) !== amount * 100) {
    return NextResponse.json({ error: "amount must be positive and have at most two decimals" }, { status: 422 });
  }
  const db = createAdminClient();
  const { data, error } = await db.rpc("allocate_payment", {
    p_payment_id: body.payment_id, p_invoice_id: body.invoice_id, p_amount: amount.toFixed(2), p_created_by: access.identity?.id || null,
  });
  if (error) {
    const status = /not_found/i.test(error.message) ? 404 : /invariant|invalid_input/i.test(error.message) ? 409 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json({ allocation_id: data }, { status: 201 });
}
