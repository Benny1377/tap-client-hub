import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireBillingPowerUser } from "@/lib/billing-access";
import { collectionsError } from "@/lib/collections-route-error";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const access = await requireBillingPowerUser();
  if (access.response) return access.response;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body", code: "INVALID_JSON" }, { status: 400 }); }
  if (!body?.event_id || typeof body.event_type !== "string" || !["formal_notice_approved", "escalated"].includes(body.event_type)) return NextResponse.json({ error: "event_id and an approval event_type are required", code: "INVALID_INPUT" }, { status: 422 });
  const db = createAdminClient();
  const { data: eventId, error } = await db.rpc("approve_collection_event", {
    p_event_id: body.event_id, p_event_type: body.event_type, p_actor: access.identity!.id, p_detail: body.detail ?? {},
  });
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "This request has already been approved", code: "APPROVAL_CONFLICT" }, { status: 409 });
    const mapped = collectionsError(error, "APPROVAL_CONFLICT", "Unable to record Collections approval");
    return NextResponse.json({ error: mapped.error, code: mapped.status === 500 ? "APPROVAL_FAILED" : mapped.code }, { status: mapped.status });
  }
  const { data, error: readError } = await db.from("collection_events").select("*, invoice:invoices(invoice_number)").eq("id", eventId).single();
  if (readError) return NextResponse.json({ error: "Approval was recorded but could not be loaded", code: "READ_AFTER_WRITE_FAILED" }, { status: 500 });
  const { invoice, ...event } = data;
  return NextResponse.json({ event: { ...event, invoice_number: invoice?.invoice_number ?? null } }, { status: 201 });
}
