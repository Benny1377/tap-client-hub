import { createAdminClient } from "@/lib/supabase/admin";
import { requireClientDataEditAccess, requireClientDataReadAccess } from "@/lib/access-server";
import { NextResponse } from "next/server";

// Same access as the client worklists: reading needs a module, writing needs the
// client-data edit permission that GET/PATCH /api/clients already require.

// GET /api/period-counts?client_service_id=X&year=2026
// GET /api/period-counts?year=2026 (batch: all counts for that year)
export async function GET(request: Request) {
  const access = await requireClientDataReadAccess();
  if (access.status) return NextResponse.json({ error: access.status === 401 ? "Unauthorized" : "Forbidden" }, { status: access.status });
  const supabase = createAdminClient();
  const { searchParams } = new URL(request.url);
  const csId = searchParams.get("client_service_id");
  const year = searchParams.get("year");

  let query = supabase.from("period_counts").select("*");
  if (csId) query = query.eq("client_service_id", csId);
  if (year) {
    const yearInt = parseInt(year) * 100;
    query = query.gte("period", yearInt + 1).lte("period", yearInt + 12);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ counts: data || [] });
}

// Helper: convert "YYYY-MM" string to integer YYYYMM for the DB column
function periodToInt(period: string): number {
  const parts = period.split("-");
  if (parts.length === 2) return parseInt(parts[0]) * 100 + parseInt(parts[1]);
  return parseInt(period) || 0;
}

// Helper: convert integer YYYYMM back to "YYYY-MM" string
function intToPeriod(n: number): string {
  const year = Math.floor(n / 100);
  const month = n % 100;
  return `${year}-${String(month).padStart(2, "0")}`;
}

// POST /api/period-counts — upsert a count for a month
// Body: { client_service_id, period: "YYYY-MM", processed }
export async function POST(request: Request) {
  const access = await requireClientDataEditAccess();
  if (access.status) return NextResponse.json({ error: access.status === 401 ? "Unauthorized" : "Forbidden" }, { status: access.status });
  const supabase = createAdminClient();
  const body = await request.json();
  const { client_service_id, period, processed } = body;

  if (!client_service_id || !period || processed === undefined) {
    return NextResponse.json({ error: "Missing client_service_id, period, or processed" }, { status: 400 });
  }

  const periodInt = periodToInt(period);

  const { data: existing } = await supabase
    .from("period_counts")
    .select("client_service_id, period")
    .eq("client_service_id", client_service_id)
    .eq("period", periodInt)
    .maybeSingle();

  let result;
  if (existing) {
    result = await supabase
      .from("period_counts")
      .update({ processed: Math.max(0, processed), updated_at: new Date().toISOString() })
      .eq("client_service_id", client_service_id)
      .eq("period", periodInt)
      .select()
      .single();
  } else {
    result = await supabase
      .from("period_counts")
      .insert({ client_service_id, period: periodInt, processed: Math.max(0, processed) })
      .select()
      .single();
  }

  const { data, error } = result;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ count: data });
}
