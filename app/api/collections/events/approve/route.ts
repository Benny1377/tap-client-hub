import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireBillingPowerUser } from "@/lib/billing-access";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const access = await requireBillingPowerUser();
  if (access.response) return access.response;
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  if (!body?.event_id || !["formal_notice_approved", "escalated"].includes(body.event_type)) return NextResponse.json({ error: "event_id and an approval event_type are required" }, { status: 422 });
  const db = createAdminClient();
  const { data: source } = await db.from("collection_events").select("client_id, invoice_id, event_type").eq("id", body.event_id).maybeSingle();
  if (!source) return NextResponse.json({ error: "Source event not found" }, { status: 404 });
  const expected = source.event_type === "escalation_requested" ? "escalated" : source.event_type === "formal_notice_requested" ? "formal_notice_approved" : null;
  if (expected !== body.event_type) return NextResponse.json({ error: "Approval event does not match the source request" }, { status: 409 });
  const { data: existing } = await db.from("collection_events").select("id").eq("approves_event_id", body.event_id).limit(1).maybeSingle();
  if (existing) return NextResponse.json({ error: "Source request has already been approved" }, { status: 409 });
  const { data: holds } = await db.from("collection_holds").select("id, invoice_id, expires_on").eq("client_id", source.client_id).is("released_at", null);
  const activeHold = (holds || []).find((item: any) => (!item.expires_on || item.expires_on >= new Date().toISOString().slice(0, 10)) && (!item.invoice_id || item.invoice_id === source.invoice_id));
  if (activeHold) return NextResponse.json({ error: "Action blocked by an active Collections hold" }, { status: 409 });
  const { data, error } = await db.from("collection_events").insert({ client_id: source.client_id, invoice_id: source.invoice_id, event_type: body.event_type, actor: access.identity!.id, approves_event_id: body.event_id, detail: body.detail ?? {} }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ event: data }, { status: 201 });
}
