import { NextRequest, NextResponse } from "next/server";
import { resolveAccessIdentity } from "@/lib/access-server";
import { createTicketsAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUSES = new Set(["open", "in_progress", "resolved", "closed"]);
const MAX_TICKETS = 250;

/**
 * TAP Hub support-team inbox. This is deliberately separate from the external
 * v1 integration API and must never surface tickets belonging to another app.
 */
export async function GET(req: NextRequest) {
  const identity = await resolveAccessIdentity();
  if (!identity) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["owner", "admin"].includes(identity.role)) {
    return NextResponse.json({ error: "Only TAP Hub owners and admins can view the TAP Hub support inbox." }, { status: 403 });
  }

  const status = (req.nextUrl.searchParams.get("status") || "").trim();
  if (status && !VALID_STATUSES.has(status)) {
    return NextResponse.json({ error: "Invalid ticket status." }, { status: 400 });
  }

  const admin = createTicketsAdminClient();
  const { data: apps, error: appsError } = await admin
    .from("support_apps")
    .select("key, display_name, active")
    .order("display_name", { ascending: true });
  if (appsError) {
    console.error("Support inbox app lookup failed:", appsError.message);
    return NextResponse.json({ error: "Unable to load support applications." }, { status: 500 });
  }

  let query = admin
    .from("support_tickets")
    .select("id, external_id, source_app_key, status, priority, category, summary, reporter_name, reporter_email, created_at, updated_at, last_activity_at, first_response_at, closed_at")
    .eq("source_app_key", "tap-hub")
    .order("last_activity_at", { ascending: false })
    .limit(MAX_TICKETS);
  if (status) query = query.eq("status", status);

  const { data: tickets, error: ticketsError } = await query;
  if (ticketsError) {
    console.error("Support inbox ticket lookup failed:", ticketsError.message);
    return NextResponse.json({ error: "Unable to load support tickets." }, { status: 500 });
  }

  return NextResponse.json({
    apps: (apps || [])
      .filter((row) => row.key === "tap-hub")
      .map((row) => ({ key: row.key, displayName: row.display_name, active: row.active })),
    tickets: (tickets || []).map((ticket) => ({
      id: ticket.id,
      number: ticket.external_id,
      appKey: ticket.source_app_key,
      status: ticket.status,
      priority: ticket.priority,
      category: ticket.category,
      title: ticket.summary,
      reporterName: ticket.reporter_name,
      reporterEmail: ticket.reporter_email,
      createdAt: ticket.created_at,
      updatedAt: ticket.updated_at,
      lastActivityAt: ticket.last_activity_at,
      firstResponseAt: ticket.first_response_at,
      closedAt: ticket.closed_at,
    })),
  }, { headers: { "Cache-Control": "no-store" } });
}
