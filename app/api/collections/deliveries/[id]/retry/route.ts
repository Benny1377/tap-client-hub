import { NextRequest, NextResponse } from "next/server";
import { requireBillingPowerUser } from "@/lib/billing-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { isRetryableDelivery } from "@/lib/collections-delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await requireBillingPowerUser();
  if (access.response) return access.response;
  if ((await request.text()).trim()) return NextResponse.json({ error: "Retry accepts no request body", code: "INVALID_INPUT" }, { status: 422, headers: NO_STORE });
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Attempt id must be a UUID", code: "INVALID_ATTEMPT_ID" }, { status: 422, headers: NO_STORE });
  const db = createAdminClient();
  const { data: attempt, error: readError } = await db.from("collection_delivery_attempts")
    .select("id,status,reason_code,last_error_code,attempt_count").eq("id", id).maybeSingle();
  if (readError) return NextResponse.json({ error: "Unable to read delivery attempt", code: "DELIVERY_ATTEMPT_READ_FAILED" }, { status: 500, headers: NO_STORE });
  if (!attempt) return NextResponse.json({ error: "Delivery attempt not found", code: "DELIVERY_ATTEMPT_NOT_FOUND" }, { status: 404, headers: NO_STORE });
  const reason = attempt.reason_code || attempt.last_error_code;
  if (attempt.status !== "failed" || !isRetryableDelivery(reason, Number(attempt.attempt_count || 0))) {
    return NextResponse.json({ error: "This delivery is not eligible for retry", code: "DELIVERY_NOT_RETRYABLE" }, { status: 409, headers: NO_STORE });
  }
  const { data, error } = await db.from("collection_delivery_attempts").update({
    status: "queued", reason_code: null, last_error_code: null, next_attempt_at: new Date().toISOString(), actor: access.identity!.id,
  }).eq("id", id).eq("status", "failed").select("id").maybeSingle();
  if (error) return NextResponse.json({ error: "Unable to queue delivery retry", code: "DELIVERY_RETRY_FAILED" }, { status: 500, headers: NO_STORE });
  if (!data) return NextResponse.json({ error: "Delivery changed; reload history before retrying", code: "DELIVERY_RETRY_CONFLICT" }, { status: 409, headers: NO_STORE });
  return NextResponse.json({ attempt_id: id, status: "queued" }, { status: 202, headers: NO_STORE });
}
