import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireBillingAccess } from "@/lib/billing-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await requireBillingAccess();
  if (access.response) return access.response;
  const db = createAdminClient();
  let query = db.from("collection_events").select("*").order("occurred_at", { ascending: false }).limit(500);
  const clientId = request.nextUrl.searchParams.get("client_id");
  if (clientId) query = query.eq("client_id", clientId);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Unable to load Collections events" }, { status: 500 });
  return NextResponse.json({ events: data || [] }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const access = await requireBillingAccess(true);
  if (access.response) return access.response;
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  if (!body?.client_id || !body?.event_type) return NextResponse.json({ error: "client_id and event_type are required" }, { status: 422 });
  const allowed = new Set(["note", "reminder_logged", "call_logged", "promise_to_pay", "escalation_requested", "formal_notice_requested", "hold_placed", "hold_released"]);
  if (!allowed.has(body.event_type)) return NextResponse.json({ error: "Invalid event_type" }, { status: 422 });
  const db = createAdminClient();
  const { data, error } = await db.from("collection_events").insert({
    client_id: body.client_id, invoice_id: body.invoice_id ?? null, event_type: body.event_type,
    stage: body.stage ?? null, actor: access.identity?.id || null, detail: body.detail ?? {},
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ event: data }, { status: 201 });
}
