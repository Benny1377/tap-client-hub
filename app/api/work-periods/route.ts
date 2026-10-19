import { createAdminClient } from "@/lib/supabase/admin";
import { requireClientDataEditAccess, requireClientDataReadAccess } from "@/lib/access-server";
import { NextResponse } from "next/server";

// Same access as the client worklists: reading needs a module, writing needs the
// client-data edit permission that GET/PATCH /api/clients already require.

// GET /api/work-periods?client_id=X&service_code=FIN&year=2026
export async function GET(request: Request) {
  const access = await requireClientDataReadAccess();
  if (access.status) return NextResponse.json({ error: access.status === 401 ? "Unauthorized" : "Forbidden" }, { status: access.status });
  try {
    const supabase = createAdminClient();
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("client_id") || searchParams.get("clientId");
    const serviceCode = searchParams.get("service_code");
    const year = searchParams.get("year");

    let serviceId: string | null = null;
    if (serviceCode) {
      const { data: service, error: serviceError } = await supabase
        .from("services")
        .select("id")
        .eq("code", serviceCode.toUpperCase())
        .maybeSingle();
      if (serviceError) return NextResponse.json({ error: serviceError.message }, { status: 500 });
      if (!service) return NextResponse.json({ periods: [] });
      serviceId = service.id;
    }

    let filteredClientServiceIds: string[] | null = null;
    if (clientId || serviceId) {
      let serviceQuery = supabase.from("client_services").select("id");
      if (clientId) serviceQuery = serviceQuery.eq("client_id", clientId);
      if (serviceId) serviceQuery = serviceQuery.eq("service_id", serviceId);
      const { data: clientServices, error: clientServiceError } = await serviceQuery;
      if (clientServiceError) return NextResponse.json({ error: clientServiceError.message }, { status: 500 });
      filteredClientServiceIds = (clientServices || []).map((row: any) => row.id);
      if (filteredClientServiceIds.length === 0) return NextResponse.json({ periods: [] });
    }

    let periodQuery = supabase.from("work_periods").select("*").order("period", { ascending: true });
    if (filteredClientServiceIds) periodQuery = periodQuery.in("client_service_id", filteredClientServiceIds);
    if (year) {
      const yearInt = parseInt(year, 10) * 100;
      periodQuery = periodQuery.gte("period", yearInt + 1).lte("period", yearInt + 12);
    }

    const { data, error } = await periodQuery;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const ids = Array.from(new Set((data || []).map((row: any) => row.client_service_id).filter(Boolean)));
    const serviceById = new Map<string, any>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data: rows, error: mappingError } = await supabase
        .from("client_services")
        .select("id, client_id, service_id, assigned_to, active, frequency, processor, service:services(id, code, name)")
        .in("id", ids.slice(i, i + 200));
      if (mappingError) return NextResponse.json({ error: mappingError.message }, { status: 500 });
      for (const row of rows || []) serviceById.set(row.id, row);
    }

    const periods = (data || []).map((row: any) => {
      const clientService = serviceById.get(row.client_service_id) || null;
      return {
        id: row.id,
        clientServiceId: row.client_service_id,
        period: row.period,
        stage: row.stage,
        doneBy: row.done_by,
        doneAt: row.done_at,
        clientService: clientService ? {
          id: clientService.id,
          clientId: clientService.client_id,
          serviceId: clientService.service_id,
          assignedTo: clientService.assigned_to,
          active: clientService.active,
          frequency: clientService.frequency,
          processor: clientService.processor,
          service: clientService.service,
        } : null,
      };
    });

    return NextResponse.json({ periods });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/work-periods - upsert a work period.
// The snake_case fields are the established frontend contract. Camel-case aliases
// remain accepted for compatibility with older callers.
export async function POST(request: Request) {
  const access = await requireClientDataEditAccess();
  if (access.status) return NextResponse.json({ error: access.status === 401 ? "Unauthorized" : "Forbidden" }, { status: access.status });
  try {
    const supabase = createAdminClient();
    const body = await request.json();
    const clientServiceId = body.client_service_id || body.clientServiceId;
    const rawPeriod = body.period || (body.year && body.month ? `${body.year}-${String(body.month).padStart(2, "0")}` : null);
    const { stage, done_by } = body;

    if (!clientServiceId || !rawPeriod || !stage) {
      return NextResponse.json(
        { error: "Missing required fields: client_service_id, period, stage" },
        { status: 400 },
      );
    }

    const normalizedPeriod = String(rawPeriod).replace("-", "");
    const periodInt = parseInt(normalizedPeriod, 10);
    const month = periodInt % 100;
    if (!/^\d{6}$/.test(normalizedPeriod) || month < 1 || month > 12) {
      return NextResponse.json({ error: "period must be YYYY-MM or YYYYMM" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("work_periods")
      .upsert({
        client_service_id: clientServiceId,
        period: periodInt,
        stage,
        done_by: done_by || null,
        done_at: stage === "done" ? new Date().toISOString() : null,
      }, { onConflict: "client_service_id,period" })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ period: data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
