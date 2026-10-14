import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireBillingPowerUser } from "@/lib/billing-access";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireBillingPowerUser();
  if (access.response) return access.response;
  const { id } = await params;
  let body: any = {};
  try { body = await request.json(); } catch { /* empty body is valid */ }
  const db = createAdminClient();
  const { error } = await db.rpc("reverse_payment", { p_payment_id: id, p_actor: access.identity!.id, p_reason: body.reason || null });
  if (error) return NextResponse.json({ error: error.message, code: /not_found/i.test(error.message) ? "NOT_FOUND" : /invariant/i.test(error.message) ? "LEDGER_CONFLICT" : "PAYMENT_REVERSAL_FAILED" }, { status: /not_found/i.test(error.message) ? 404 : /invariant/i.test(error.message) ? 409 : 500 });
  const { data } = await db.from("payments").select("*, payment_allocations(*)").eq("id", id).single();
  return NextResponse.json({ payment: data });
}
