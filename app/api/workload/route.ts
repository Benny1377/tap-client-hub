import { createClient } from "@/lib/supabase/server";
import { resolveAccessIdentity } from "@/lib/access-server";
import { isPowerUser } from "@/lib/access-policy";
import { NextResponse } from "next/server";

const FREQ_TOUCHPOINTS: Record<string, number> = {
  monthly: 12, quarterly: 4, yearly: 1, annually: 1, "n/a": 0,
};

const CODE_TO_KEY: Record<string, string> = {
  FIN: "financials", PR: "payroll", STX: "sales_tax",
  T9: "1099s", REND: "renditions", TAX: "tax_returns",
};

/**
 * GET /api/workload
 * Returns per-staff workload summary with monthly touchpoint distribution.
 */
export async function GET() {
  const identity = await resolveAccessIdentity();
  if (!identity) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isPowerUser(identity.role) && !identity.modules.includes("Workload")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const supabase = await createClient();

  const { data: dbClients, error: clientsError } = await supabase
    .from("clients")
    .select("*")
    .eq("status", "active")
    .order("name");

  const { data: dbServices, error: servicesError } = await supabase
    .from("client_services")
    .select("*, service:services(*)")
    .eq("active", true);

  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("*")
    .eq("active", true)
    .order("full_name");

  const queryError = clientsError || servicesError || profilesError;
  if (queryError) {
    return NextResponse.json({ error: queryError.message }, { status: 500 });
  }

  if (!dbClients) {
    return NextResponse.json({ staffLoads: [], totalClients: 0, staffCount: 0 });
  }

  // Build staff name lookup maps
  const staffMap = new Map<string, { name: string; initials: string }>();
  const uuidToName = new Map<string, string>();
  for (const p of profiles || []) {
    const name = String(p.full_name || "Unknown");
    const initials = name
      .split(" ")
      .map((n: string) => n[0] || "")
      .join("")
      .toUpperCase() || "??";
    staffMap.set(name, { name, initials });
    if (p.id) uuidToName.set(p.id, name);
  }

  // Group services by client
  const servicesByClient: Record<string, any[]> = {};
  for (const cs of dbServices || []) {
    if (!servicesByClient[cs.client_id]) servicesByClient[cs.client_id] = [];
    servicesByClient[cs.client_id].push(cs);
  }

  // Compute loads with monthly breakdown
  const loads = new Map<
    string,
    {
      totalTouchpoints: number;
      clientCount: number;
      services: Record<string, number>;
      serviceClients: Record<string, string[]>;
      monthCounts: number[];
      clients: string[];
    }
  >();
  const counted = new Set<string>();
  const NON_PERSON_PROCESSORS = new Set(["adp", "qbo", "quickbooks desktop", "quickbooks desktop 24"]);

  for (const c of dbClients) {
    const clientServices = servicesByClient[c.id] || [];
    for (const cs of clientServices) {
      const freq = FREQ_TOUCHPOINTS[String(cs.frequency || "").toLowerCase()] || 0;
      const proc = String(cs.processor || "").trim();

      // Determine who this service is assigned to
      let staffName = "";

      // First try processor field (used by payroll, financials, etc.)
      if (proc && !NON_PERSON_PROCESSORS.has(proc.toLowerCase())) {
        staffName = proc;
        for (const [sName, sInfo] of staffMap) {
          if (sInfo.initials === proc || sName === proc || sName.split(" ")[0] === proc) {
            staffName = sName;
            break;
          }
        }
      }

      // Fallback to assigned_to UUID (used by sales tax, etc.)
      if (!staffName && cs.assigned_to) {
        staffName = uuidToName.get(cs.assigned_to) || "";
      }

      if (!staffName) continue;

      const load = loads.get(staffName) || {
        totalTouchpoints: 0,
        clientCount: 0,
        services: {} as Record<string, number>,
        serviceClients: {} as Record<string, string[]>,
        monthCounts: Array(12).fill(0),
        clients: [] as string[],
      };

      const key = CODE_TO_KEY[cs.service?.code || ""] || "financials";
      load.services[key] = (load.services[key] || 0) + freq;
      load.totalTouchpoints += freq;

      // Track which clients belong to each service for this staff member
      if (!load.serviceClients[key]) load.serviceClients[key] = [];
      if (!load.serviceClients[key].includes(c.name || "")) {
        load.serviceClients[key].push(c.name || "");
      }

      // Distribute touchpoints across months based on frequency
      if (freq > 0) {
        const touchPerMonth = Math.ceil(freq / 12);
        for (let m = 0; m < 12; m++) {
          const activeMonths = getActiveMonths(freq);
          if (activeMonths.has(m)) {
            load.monthCounts[m] += touchPerMonth;
          }
        }
      }

      const cid = String(c.id) + staffName;
      if (!counted.has(cid)) {
        load.clientCount++;
        load.clients.push(c.name || "");
        counted.add(cid);
      }
      loads.set(staffName, load);
    }
  }

  for (const [name] of staffMap) {
    if (!loads.has(name)) {
      loads.set(name, { totalTouchpoints: 0, clientCount: 0, services: {}, serviceClients: {}, monthCounts: Array(12).fill(0), clients: [] });
    }
  }

  const staffLoads = Array.from(loads.entries())
    .map(([name, data]) => ({
      name,
      initials: staffMap.get(name)?.initials || "??",
      ...data,
    }))
    .sort((a, b) => b.totalTouchpoints - a.totalTouchpoints);

  return NextResponse.json({
    staffLoads,
    totalClients: dbClients.length,
    staffCount: profiles?.length || 0,
  });
}

function getActiveMonths(freq: number): Set<number> {
  if (freq >= 12) return new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  if (freq >= 4) return new Set([0, 3, 6, 9]); // Quarterly
  return new Set([3]); // Annually (April)
}
