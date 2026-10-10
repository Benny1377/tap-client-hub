import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireBillingPowerUser } from "@/lib/billing-access";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const access = await requireBillingPowerUser();
  if (access.response) return access.response;
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body", code: "INVALID_JSON" }, { status: 400 }); }
  if (!body?.event_id || !["formal_notice_approved", "escalated"].includes(body.event_type)) return NextResponse.json({ error: "event_id and an approval event_type are required", code: "INVALID_INPUT" }, { status: 422 });
  const db = createAdminClient();
  const { data: eventId, error } = await db.rpc("approve_collection_event", {
    p_event_id: body.event_id, p_event_type: body.event_type, p_actor: access.identity!.id, p_detail: body.detail ?? {},
  });
  if (error) {
    const missing = /not_found/i.test(error.message);
    const conflict = /conflict/i.test(error.message) || error.code === "23505";
    return NextResponse.json({ error: error.message, code: missing ? "NOT_FOUND" : conflict ? "APPROVAL_CONFLICT" : "APPROVAL_FAILED" }, { status: missing ? 404 : conflict ? 409 : 500 });
  }
  const { data, error: readError } = await db.from("collection_events").select("*").eq("id", eventId).single();
  if (readError) return NextResponse.json({ error: "Approval was recorded but could not be loaded", code: "READ_AFTER_WRITE_FAILED" }, { status: 500 });
  return NextResponse.json({ event: data }, { status: 201 });
}
