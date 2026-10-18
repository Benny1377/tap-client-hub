import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireBillingPowerUser } from "@/lib/billing-access";
import { collectionsError } from "@/lib/collections-route-error";
import { loadImportInvoiceLabels } from "@/lib/collections-import";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const access = await requireBillingPowerUser();
  if (access.response) return access.response;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body", code: "INVALID_JSON" }, { status: 400 }); }
  if (!body?.event_id || typeof body.event_type !== "string" || !["formal_notice_approved", "escalated"].includes(body.event_type)) return NextResponse.json({ error: "event_id and an approval event_type are required", code: "INVALID_INPUT" }, { status: 422 });
  if (body.target !== undefined) {
    const target = body.target && typeof body.target === "object" ? body.target as Record<string, unknown> : {};
    if (!((target.source === "billing" && typeof target.invoice_id === "string" && !target.source_invoice_id)
      || (target.source === "pdf_import" && typeof target.source_invoice_id === "string" && !target.invoice_id))) {
      return NextResponse.json({ error: "target must contain exactly one supported invoice identity", code: "INVALID_INVOICE_TARGET" }, { status: 422 });
    }
  }
  const db = createAdminClient();
  const { data: eventId, error } = await db.rpc("approve_collection_event_for_source", {
    p_event_id: body.event_id, p_event_type: body.event_type, p_actor: access.identity!.id, p_detail: body.detail ?? {},
    p_source: body.target && typeof body.target === "object" ? (body.target as Record<string, unknown>).source : null,
    p_invoice_id: body.target && typeof body.target === "object" ? (body.target as Record<string, unknown>).invoice_id ?? null : null,
    p_source_invoice_id: body.target && typeof body.target === "object" ? (body.target as Record<string, unknown>).source_invoice_id ?? null : null,
  });
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "This request has already been approved", code: "APPROVAL_CONFLICT" }, { status: 409 });
    const mapped = collectionsError(error, "APPROVAL_CONFLICT", "Unable to record Collections approval");
    return NextResponse.json({ error: mapped.error, code: mapped.status === 500 ? "APPROVAL_FAILED" : mapped.code }, { status: mapped.status });
  }
  const { data, error: readError } = await db.from("collection_events").select("*, invoice:invoices(invoice_number)").eq("id", eventId).single();
  if (readError) return NextResponse.json({ error: "Approval was recorded but could not be loaded", code: "READ_AFTER_WRITE_FAILED" }, { status: 500 });
  const { invoice, ...event } = data;
  const labels = await loadImportInvoiceLabels(event.source_invoice_id ? [event.source_invoice_id] : []);
  const imported = event.source_invoice_id ? labels.get(event.source_invoice_id) : null;
  return NextResponse.json({ event: { ...event, row_key: event.canonical_collection_identity ? `collection:${event.canonical_collection_identity}` : null,
    invoice_number: invoice?.invoice_number ?? imported?.invoice_number ?? null,
    source_batch_id: imported?.source_batch_id ?? null, source_as_of: imported?.source_as_of ?? null } }, { status: 201 });
}
