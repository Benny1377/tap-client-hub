import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireLedgerReadAccess } from "@/lib/billing-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await requireLedgerReadAccess();
  if (access.response) return access.response;
  const db = createAdminClient();
  const clientId = request.nextUrl.searchParams.get("client_id");
  const { data, error } = await db.rpc("get_billing_receivables", { p_client_id: clientId || null });
  if (error || !data) return NextResponse.json({ error: "Unable to load receivables", code: "READ_MODEL_FAILED" }, { status: 500 });
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
