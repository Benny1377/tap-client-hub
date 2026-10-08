import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireBillingPowerUser } from "@/lib/billing-access";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireBillingPowerUser();
  if (access.response) return access.response;
  const { id } = await params;
  const db = createAdminClient();
  const { data, error } = await db.from("payment_allocations").update({ reversed_at: new Date().toISOString() }).eq("id", id).is("reversed_at", null).select().single();
  if (error) return NextResponse.json({ error: error.code === "PGRST116" ? "Active allocation not found" : error.message }, { status: error.code === "PGRST116" ? 409 : 500 });
  return NextResponse.json({ allocation: data });
}
