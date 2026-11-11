import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireBillingPowerUser, requireCollectionsAccess, requireLedgerReadAccess } from "@/lib/billing-access";
import { collectionsError } from "@/lib/collections-route-error";
import { loadImportInvoiceLabels } from "@/lib/collections-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await requireLedgerReadAccess();
  if (access.response) return access.response;
  const db = createAdminClient();
  const params = request.nextUrl.searchParams;
  const clientId = request.nextUrl.searchParams.get("client_id");
  const eventType = params.get("event_type");
  const limit = params.has("limit") ? Number(params.get("limit")) : 50;
  const offset = params.has("offset") ? Number(params.get("offset")) : 0;
  const validTypes = new Set(["note", "reminder_logged", "call_logged", "promise_to_pay", "escalation_requested", "escalated", "formal_notice_requested", "formal_notice_approved", "formal_notice_sent", "hold_placed", "hold_released"]);
  const bad = (message: string, code: string) => NextResponse.json({ error: message, code }, { status: 422, headers: { "Cache-Control": "no-store" } });
  if (!clientId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientId)) return bad("client_id must be a UUID", "INVALID_CLIENT_ID");
  if (eventType && !validTypes.has(eventType)) return bad("event_type is not supported", "INVALID_EVENT_TYPE");
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) return bad("limit must be an integer from 1 to 200", "INVALID_LIMIT");
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000) return bad("offset must be a non-negative integer", "INVALID_OFFSET");
  let query = db.from("collection_events").select("*, invoice:invoices(invoice_number)", { count: "exact" })
    .eq("client_id", clientId).order("occurred_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + limit - 1);
  if (eventType) query = query.eq("event_type", eventType);
  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: "Unable to load Collections events", code: "READ_FAILED" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  const labels = await loadImportInvoiceLabels((data || []).flatMap((event) => event.source_invoice_id ? [event.source_invoice_id] : []));
  const events = (data || []).map(({ invoice, ...event }) => {
    const imported = event.source_invoice_id ? labels.get(event.source_invoice_id) : null;
    return { ...event, row_key: event.canonical_collection_identity ? `collection:${event.canonical_collection_identity}` : null,
      invoice_number: invoice?.invoice_number ?? imported?.invoice_number ?? null,
      source_batch_id: imported?.source_batch_id ?? null, source_as_of: imported?.source_as_of ?? null };
  });
  return NextResponse.json({ events, pagination: { limit, offset, total: count || 0 } }, { headers: { "Cache-Control": "no-store" } });
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
  const target = body.target && typeof body.target === "object" ? body.target as Record<string, unknown>
    : body.invoice_id ? { source: "billing", invoice_id: body.invoice_id } : null;
  const source = target ? target.source : null;
  const invoiceId = target?.invoice_id ?? null;
  const sourceInvoiceId = target?.source_invoice_id ?? null;
  if (target && !((source === "billing" && typeof invoiceId === "string" && !sourceInvoiceId)
    || (source === "pdf_import" && typeof sourceInvoiceId === "string" && !invoiceId))) {
    return NextResponse.json({ error: "target must contain exactly one supported invoice identity", code: "INVALID_INVOICE_TARGET" }, { status: 422 });
  }
  const rpcName = target ? "record_collection_event_for_source" : "record_collection_event";
  const rpcArgs = target ? {
    p_client_id: body.client_id, p_source: source, p_invoice_id: invoiceId, p_source_invoice_id: sourceInvoiceId,
    p_event_type: body.event_type, p_actor: access.identity?.id || null, p_stage: body.stage ?? null,
    p_detail: body.detail ?? {}, p_approval_event_id: body.approval_event_id ?? null,
  } : {
    p_client_id: body.client_id, p_invoice_id: null, p_event_type: body.event_type,
    p_actor: access.identity?.id || null, p_stage: body.stage ?? null,
    p_detail: body.detail ?? {}, p_approval_event_id: body.approval_event_id ?? null,
  };
  const { data: eventId, error } = await db.rpc(rpcName, rpcArgs);
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
  const labels = await loadImportInvoiceLabels(event.source_invoice_id ? [event.source_invoice_id] : []);
  const imported = event.source_invoice_id ? labels.get(event.source_invoice_id) : null;
  return NextResponse.json({ event: { ...event, row_key: event.canonical_collection_identity ? `collection:${event.canonical_collection_identity}` : null,
    invoice_number: invoice?.invoice_number ?? imported?.invoice_number ?? null,
    source_batch_id: imported?.source_batch_id ?? null, source_as_of: imported?.source_as_of ?? null } }, { status: 201 });
}
