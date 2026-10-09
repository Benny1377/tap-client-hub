import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireBillingPowerUser } from "@/lib/billing-access";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireBillingPowerUser();
  if (access.response) return access.response;
  const { id } = await params;
  const db = createAdminClient();
  const { error } = await db.rpc("reverse_payment_allocation", { p_allocation_id: id, p_actor: access.identity!.id });
  if (error) return NextResponse.json({ error: error.message }, { status: /not_found/i.test(error.message) ? 404 : /invariant/i.test(error.message) ? 409 : 500 });
  const { data } = await db.from("payment_allocations").select().eq("id", id).single();
  return NextResponse.json({ allocation: data });
}
