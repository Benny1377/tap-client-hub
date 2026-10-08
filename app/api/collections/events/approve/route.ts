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
  const { data: source } = await db.from("collection_events").select("client_id, invoice_id").eq("id", body.event_id).maybeSingle();
  if (!source) return NextResponse.json({ error: "Source event not found" }, { status: 404 });
  const { data: hold } = await db.from("collection_holds").select("id").eq("client_id", source.client_id).is("released_at", null).limit(1).maybeSingle();
  if (hold) return NextResponse.json({ error: "Action blocked by an active Collections hold" }, { status: 409 });
  const { data, error } = await db.from("collection_events").insert({ client_id: source.client_id, invoice_id: source.invoice_id, event_type: body.event_type, actor: access.identity!.id, approves_event_id: body.event_id, detail: body.detail ?? {} }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ event: data }, { status: 201 });
}
