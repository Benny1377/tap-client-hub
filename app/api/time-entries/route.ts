import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAccessIdentity } from "@/lib/access-server";
import { NextResponse } from "next/server";

const TAP_ASSOCIATES_CLIENT_ID = "tap-associates";

function normalizeClientId(value: unknown): string | null {
  if (!value || value === TAP_ASSOCIATES_CLIENT_ID) return null;
  return String(value);
}

async function requireTimeEntryAccess() {
  const identity = await resolveAccessIdentity();
  if (!identity) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return identity;
}

function canManageTimeEntries(access: { role: string }) {
  return ["owner", "admin", "manager"].includes(access.role);
}

// GET /api/time-entries — list all time entries with joined profile/client names
export async function GET() {
  const access = await requireTimeEntryAccess();
  if (access instanceof NextResponse) return access;
  const supabase = createAdminClient();

  // Supabase/PostgREST responses are paged. A fixed 500-row cap silently
  // drops older timesheet entries and makes date-filtered CSV exports incomplete.
  // Read every page so the UI and export represent the complete history.
  const pageSize = 1000;
  const data: any[] = [];
  let offset = 0;
  while (true) {
    const { data: page, error } = await supabase
      .from("time_entries")
      .select(`*`)
      .order("started_at", { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    data.push(...(page || []));
    if (!page || page.length < pageSize) break;
    offset += pageSize;
  }

  // Batch fetch profiles and clients for name resolution
  const whoIds = [...new Set((data || []).map((e: any) => e.who).filter(Boolean))];
  const clientIds = [...new Set((data || []).map((e: any) => e.client_id).filter(Boolean))];

  let profiles: any[] = [];
  let clients: any[] = [];
  if (whoIds.length > 0) {
    const { data: pData } = await supabase.from("profiles").select("id, full_name").in("id", whoIds);
    if (pData) profiles = pData;
  }
  if (clientIds.length > 0) {
    const { data: cData } = await supabase.from("clients").select("id, name").in("id", clientIds);
    if (cData) clients = cData;
  }

  const profileMap: Record<string, string> = {};
  for (const p of profiles) profileMap[p.id] = p.full_name || "Unknown";
  const clientMap: Record<string, string> = {};
  for (const c of clients) clientMap[c.id] = c.name || "";

  const entries = (data || []).map((e: any) => ({
    id: e.id,
    personId: e.who,
    personName: profileMap[e.who] || "Unknown",
    clientId: e.client_id,
    clientName: e.client_id ? (clientMap[e.client_id] || e.client_id) : "Tap Associates",
    serviceLabel: e.task || "",
    duration: e.seconds || 0,
    date: e.started_at,
    note: e.note || "",
    edited: e.edited || false,
    manual: e.manual || false,
  }));

  return NextResponse.json({ entries });
}

// POST /api/time-entries — create a new time entry
export async function POST(request: Request) {
  const access = await requireTimeEntryAccess();
  if (access instanceof NextResponse) return access;
  const supabase = createAdminClient();
  const body = await request.json();

  if (!body.who || (!canManageTimeEntries(access) && body.who !== access.id)) {
    return NextResponse.json({ error: "You may only create time entries for yourself" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("time_entries")
    .insert({
      id: body.id || undefined,
      who: body.who,
      client_id: normalizeClientId(body.client_id),
      client_service_id: body.client_service_id || null,
      task: body.task || "",
      started_at: body.started_at || new Date().toISOString(),
      seconds: body.seconds || 0,
      note: body.note || "",
      edited: false,
      manual: body.manual === true,
    })
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message || "Insert failed" }, { status: 500 });
  }

  return NextResponse.json({ entry: data }, { status: 201 });
}

// DELETE /api/time-entries?id=UUID — delete a time entry
export async function DELETE(request: Request) {
  const access = await requireTimeEntryAccess();
  if (access instanceof NextResponse) return access;
  const supabase = createAdminClient();
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Missing id parameter" }, { status: 400 });
  }

  let query = supabase.from("time_entries").delete().eq("id", id);
  if (!canManageTimeEntries(access)) query = query.eq("who", access.id);
  const { error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

// PATCH /api/time-entries?id=UUID — update a time entry (including start time and the calculated duration)
export async function PATCH(request: Request) {
  const access = await requireTimeEntryAccess();
  if (access instanceof NextResponse) return access;
  const supabase = createAdminClient();
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Missing id parameter" }, { status: 400 });
  }

  const body = await request.json();
  const updates: Record<string, any> = {};

  if (body.who !== undefined) updates.who = body.who;
  if (body.client_id !== undefined) updates.client_id = normalizeClientId(body.client_id);
  if (body.task !== undefined) updates.task = body.task;
  if (body.seconds !== undefined) updates.seconds = body.seconds;
  if (body.note !== undefined) updates.note = body.note;
  if (body.started_at !== undefined) updates.started_at = body.started_at;
  if (body.edited !== undefined) updates.edited = body.edited;
  if (body.edited) {
    updates.edited_at = new Date().toISOString();
  }

  let query = supabase.from("time_entries").update(updates).eq("id", id);
  if (!canManageTimeEntries(access)) query = query.eq("who", access.id);
  const { data, error } = await query
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message || "Update failed" }, { status: 500 });
  }

  return NextResponse.json({ entry: data });
}
