import { NextRequest, NextResponse } from "next/server";
import { requireBillingPowerUser } from "@/lib/billing-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { getDeliveryStatus } from "@/lib/collections-delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  const access = await requireBillingPowerUser();
  if (access.response) return access.response;
  if ((await request.text()).trim()) return NextResponse.json({ error: "This endpoint accepts no request body", code: "INVALID_INPUT" }, { status: 422, headers: NO_STORE });
  const db = createAdminClient();
  const { error } = await db.rpc("pause_collections_automation", { p_actor: access.identity!.id });
  if (error) return NextResponse.json({ error: "Unable to pause Collections automation", code: "AUTOMATION_PAUSE_FAILED" }, { status: 500, headers: NO_STORE });
  const status = await getDeliveryStatus();
  if (!status) return NextResponse.json({ error: "Automation was paused but status could not be loaded", code: "READ_AFTER_WRITE_FAILED" }, { status: 500, headers: NO_STORE });
  return NextResponse.json(status, { headers: NO_STORE });
}
