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
  const { count: activeAllocations, error: allocationError } = await db.from("payment_allocations").select("id", { count: "exact", head: true }).eq("payment_id", id).is("reversed_at", null);
  if (allocationError) return NextResponse.json({ error: allocationError.message }, { status: 500 });
  if ((activeAllocations || 0) > 0) return NextResponse.json({ error: "Reverse active allocations before reversing this payment" }, { status: 409 });
  const { data, error } = await db.from("payments").update({ status: "reversed", reversed_by: access.identity!.id, reversed_at: new Date().toISOString(), reversal_reason: body.reason || null }).eq("id", id).eq("status", "recorded").select("*, payment_allocations(*)").single();
  if (error) return NextResponse.json({ error: error.code === "PGRST116" ? "Recorded payment not found" : error.message }, { status: error.code === "PGRST116" ? 409 : 500 });
  return NextResponse.json({ payment: data });
}
