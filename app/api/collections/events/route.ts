import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireBillingPowerUser, requireCollectionsAccess, requireLedgerReadAccess } from "@/lib/billing-access";
import { collectionsError } from "@/lib/collections-route-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await requireLedgerReadAccess();
  if (access.response) return access.response;
  const db = createAdminClient();
  let query = db.from("collection_events").select("*, invoice:invoices(invoice_number)").order("occurred_at", { ascending: false }).limit(500);
  const clientId = request.nextUrl.searchParams.get("client_id");
  if (clientId) query = query.eq("client_id", clientId);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Unable to load Collections events", code: "READ_FAILED" }, { status: 500 });
  const events = (data || []).map(({ invoice, ...event }) => ({ ...event, invoice_number: invoice?.invoice_number ?? null }));
  return NextResponse.json({ events }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body", code: "INVALID_JSON" }, { status: 400 }); }
  // A notice is only considered sent after an owner/admin records it against
  // the approved notice event; regular Collections users can still request it.
  const access = body?.event_type === "formal_notice_sent"
    ? await requireBillingPowerUser()
    : await requireCollectionsAccess();
  if (access.response) return access.response;
  if (!body?.client_id || !body?.event_type) return NextResponse.json({ error: "client_id and event_type are required", code: "INVALID_INPUT" }, { status: 422 });
  const allowed = new Set(["note", "reminder_logged", "call_logged", "promise_to_pay", "escalation_requested", "formal_notice_requested", "formal_notice_sent"]);
  if (typeof body.event_type !== "string" || !allowed.has(body.event_type)) return NextResponse.json({ error: "Invalid event_type", code: "INVALID_EVENT" }, { status: 422 });
  const db = createAdminClient();
  if (body.event_type === "formal_notice_sent" && !body.approval_event_id) return NextResponse.json({ error: "An approved notice event is required", code: "APPROVAL_REQUIRED" }, { status: 422 });
  const { data: eventId, error } = await db.rpc("record_collection_event", {
    p_client_id: body.client_id, p_invoice_id: body.invoice_id ?? null, p_event_type: body.event_type,
    p_actor: access.identity?.id || null, p_stage: body.stage ?? null,
    p_detail: body.detail ?? {}, p_approval_event_id: body.approval_event_id ?? null,
  });
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "This Collections event has already been recorded", code: "EVENT_CONFLICT" }, { status: 409 });
    }
    const mapped = collectionsError(error, "COLLECTIONS_CONFLICT", "Unable to record Collections event");
    return NextResponse.json({ error: mapped.error, code: mapped.code, }, { status: mapped.status });
  }
  const { data, error: readError } = await db.from("collection_events").select("*, invoice:invoices(invoice_number)").eq("id", eventId).single();
  if (readError) return NextResponse.json({ error: "Event was recorded but could not be loaded", code: "READ_AFTER_WRITE_FAILED" }, { status: 500 });
  const { invoice, ...event } = data;
  return NextResponse.json({ event: { ...event, invoice_number: invoice?.invoice_number ?? null } }, { status: 201 });
}
