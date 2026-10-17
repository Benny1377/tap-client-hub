import { NextRequest, NextResponse } from "next/server";
import { requireBillingPowerUser } from "@/lib/billing-access";
import { getDeliveryStatus } from "@/lib/collections-delivery";
import { runCollectionsTestDelivery } from "@/lib/collections-test-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  const access = await requireBillingPowerUser();
  if (access.response) return access.response;
  if ((await request.text()).trim()) return NextResponse.json({ error: "Run test now accepts no request body", code: "INVALID_INPUT" }, { status: 422, headers: NO_STORE });
  const status = await getDeliveryStatus();
  if (!status) return NextResponse.json({ error: "Unable to check test-delivery readiness", code: "DELIVERY_STATUS_READ_FAILED" }, { status: 500, headers: NO_STORE });
  if (!status.test_ready) return NextResponse.json({ error: "Test delivery is not ready", code: "DELIVERY_NOT_READY", missing: status.missing }, { status: 409, headers: NO_STORE });
  const result = await runCollectionsTestDelivery(access.identity!.id, 50);
  if (!result) return NextResponse.json({ error: "Test delivery could not start safely", code: "TEST_RUN_FAILED_CLOSED" }, { status: 409, headers: NO_STORE });
  return NextResponse.json(result, { headers: NO_STORE });
}
