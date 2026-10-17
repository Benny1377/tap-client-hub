import { NextResponse } from "next/server";
import { requireBillingPowerUser } from "@/lib/billing-access";
import { getDeliveryStatus } from "@/lib/collections-delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  const access = await requireBillingPowerUser();
  if (access.response) return access.response;
  const status = await getDeliveryStatus();
  if (!status) return NextResponse.json({ error: "Unable to read delivery status", code: "DELIVERY_STATUS_READ_FAILED" }, { status: 500, headers: NO_STORE });
  return NextResponse.json(status, { headers: NO_STORE });
}
