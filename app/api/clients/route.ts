import { NextResponse } from "next/server";
import type { ServiceKey } from "@/lib/types";
import { SERVICE_META } from "@/lib/data";
import { randomUUID } from "crypto";
import { requireClientDataEditAccess, resolveAccessIdentity } from "@/lib/access-server";
import { isPowerUser } from "@/lib/access-policy";
import { calculatePayrollStartDate, normalizePayDay } from "@/lib/payroll-schedule";

// ── Helper: create a Supabase client ──
async function getSupabase() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { db: { schema: "tap_hub_project" } }
  );
}

const CODE_TO_KEY: Record<string, ServiceKey> = {
  FIN: "financials", PR: "payroll", STX: "sales_tax",
  T9: "1099s", REND: "renditions", TAX: "tax_returns",
  RENEWAL: "annual_reports", ANNUAL: "annual_reports",
};

export const dynamic = "force-dynamic"; // Never cache — data changes frequently

export async function GET(request: Request) {
  const identity = await resolveAccessIdentity();
  if (!identity) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isPowerUser(identity.role) && identity.modules.length === 0) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const supabase = await getSupabase();

    const { searchParams } = new URL(request.url);
    const typeFilter = searchParams.get("type")?.toLowerCase();
    const limit = parseInt(searchParams.get("limit") || "1000");
    const lite = searchParams.get("fields") === "lite";
    const offset = parseInt(searchParams.get("offset") || "0");

    // These independent queries used to run serially before the client payload query.
    // Run them together so the request spends one database round trip here, not two.
    const [{ count: totalCount }, { data: typeData }] = await Promise.all([
      supabase.from("clients").select("type", { count: "exact", head: true }).eq("status", "active"),
      supabase.from("clients").select("type").eq("status", "active"),
    ]);
    let bizCount = 0, persCount = 0;
    for (const r of typeData || []) {
      if (r.type?.toLowerCase() === "business") bizCount++;
      else if (r.type?.toLowerCase() === "personal") persCount++;
    }

    let query = supabase.from("clients").select("*").eq("status", "active");

    if (typeFilter === "business" || typeFilter === "personal") {
      query = query.filter("type", "ilike", typeFilter);
    }
    const { data: dbClients } = await query.order("name").range(offset, offset + limit - 1);
    if (!dbClients || dbClients.length === 0) return NextResponse.json({ clients: [], stats: { total: totalCount || 0, business: bizCount, personal: persCount } });

    const ids = dbClients.map((c: any) => c.id);

    // Batch IN queries — keep under ~200 UUIDs to stay below Supabase's ~16KB URL header limit
    const BATCH_SIZE = 200;
    // Requests for different ID batches do not depend on one another. Fetch them
    // concurrently instead of adding one Supabase round trip per batch to TTFB.
    const serviceBatches = await Promise.all(
      Array.from({ length: Math.ceil(ids.length / BATCH_SIZE) }, (_, index) => {
        const batch = ids.slice(index * BATCH_SIZE, (index + 1) * BATCH_SIZE);
        return supabase.from("client_services")
          .select("*, service:services(*)")
          .eq("active", true)
          .in("client_id", batch);
      }),
    );
    const dbServices = serviceBatches.flatMap(({ data }) => data || []);

    const svcByClient: Record<string, any[]> = {};
    for (const cs of dbServices || []) {
      if (!svcByClient[cs.client_id]) svcByClient[cs.client_id] = [];
      svcByClient[cs.client_id].push(cs);
    }

    const allCsIds = (dbServices || []).map((cs: any) => cs.id);
    const periodByCsId: Record<string, Record<number, string>> = {};
    if (allCsIds.length > 0) {
      const BATCH_SIZE_WP = 200;
      const periodBatches = await Promise.all(
        Array.from({ length: Math.ceil(allCsIds.length / BATCH_SIZE_WP) }, (_, index) => {
          const batch = allCsIds.slice(index * BATCH_SIZE_WP, (index + 1) * BATCH_SIZE_WP);
          return supabase.from("work_periods")
            .select("client_service_id, stage, period")
            .in("client_service_id", batch);
        }),
      );
      const allPeriods = periodBatches.flatMap(({ data }) => data || []);
      for (const wp of allPeriods) {
        const s = String(wp.period ?? "");
        const m = s.match(/^(\d{4})-?(\d{2})$/);
        if (!m) continue;
        const mi = parseInt(m[2]) - 1;
        if (mi >= 0 && mi < 12) {
          if (!periodByCsId[wp.client_service_id]) periodByCsId[wp.client_service_id] = {};
          periodByCsId[wp.client_service_id][mi] = wp.stage;
        }
      }
    }

    // Fetch period_counts (processed counts for payroll, 1099s, etc.)
    const countByCsId: Record<string, number[]> = {};
    if (allCsIds.length > 0) {
      const BATCH_SIZE_PC = 200;
      const countBatches = await Promise.all(
        Array.from({ length: Math.ceil(allCsIds.length / BATCH_SIZE_PC) }, (_, index) => {
          const batch = allCsIds.slice(index * BATCH_SIZE_PC, (index + 1) * BATCH_SIZE_PC);
          return supabase.from("period_counts")
            .select("client_service_id, period, processed")
            .in("client_service_id", batch);
        }),
      );
      const allCounts = countBatches.flatMap(({ data }) => data || []);
      for (const pc of allCounts) {
        const s = String(pc.period ?? "");
        const m = s.match(/^(\d{4})-?(\d{2})$/);
        if (!m) continue;
        const mi = parseInt(m[2]) - 1;
        if (mi >= 0 && mi < 12) {
          if (!countByCsId[pc.client_service_id]) countByCsId[pc.client_service_id] = Array(12).fill(0);
          countByCsId[pc.client_service_id][mi] = Math.max(0, pc.processed || 0);
        }
      }
    }

    const { data: staffRows } = await supabase.from("profiles").select("id, full_name");
    const staffNames: Record<string, string> = {};
    for (const s of staffRows || []) {
      staffNames[s.id] = s.full_name;
      // Also map "First Last" format back to "Last, First" — some older rows
      // store names directly instead of UUIDs in the assigned_to column.
      const fn = s.full_name || "";
      const parts = fn.split(",").map(x => x.trim()).filter(Boolean);
      if (parts.length === 2) {
        const alt = parts[1] + " " + parts[0]; // "Lizette Esparza" → "Esparza, Lizette"
        if (alt !== fn) staffNames[alt] = fn;
      }
    }

    // EIN is now stored directly on clients table — no need for client_tax_ids lookup

    // ── v7 normalized tables: sales_tax_registration + unified comments ──
    const normStxByCsId: Record<string, any[]> = {};
    const normCommentsByCsId: Record<string, any[]> = {};
    const normSrByCsId: Record<string, any[]> = {};
    const seenStxIds = new Set<string>();
    const seenSrIds = new Set<string>();
    if (allCsIds.length > 0) {
      for (let i = 0; i < allCsIds.length; i += BATCH_SIZE) {
        const batch = allCsIds.slice(i, i + BATCH_SIZE);
        // sales_tax_registration
        const { data: stxBatch } = await supabase.from("sales_tax_registration")
          .select("*").in("client_service_id", batch).order("id");
        if (stxBatch) {
          for (const stx of stxBatch) {
            if (!normStxByCsId[stx.client_service_id]) normStxByCsId[stx.client_service_id] = [];
            normStxByCsId[stx.client_service_id].push({
              id: stx.id, serviceName: stx.service_name || stx.rt_number || "",
              taxId: stx.tax_reg_id,
              rt: stx.rt_number, frequency: stx.frequency,
              bankName: stx.bank_name, bankAccount: stx.bank_account_ref,
              bankRouting: stx.bank_routing_ref,
              notes: stx.notes || "",
              comments: [], // filled below from unified comments table
              assignedTo: staffNames[stx.assigned_to || ""] || stx.assigned_to || "",
            });
          }
        }
        // state_renewals
        const { data: srBatch } = await supabase.from("state_renewals")
          .select("*").in("client_service_id", batch).order("id");
        if (srBatch) {
          for (const sr of srBatch) {
            if (!normSrByCsId[sr.client_service_id]) normSrByCsId[sr.client_service_id] = [];
            normSrByCsId[sr.client_service_id].push({
              id: sr.id,
              isStateRenewal: true,
              state: sr.state,
              dueMonth: sr.due_month,
              dueDay: sr.due_day,
              identifiers: sr.identifiers,
              serviceName: `${sr.state} Renewal`,
              assignedTo: sr.assigned_to || "",
              frequency: sr.frequency || "Yearly",
              comments: [], // filled below from unified comments table
            });
          }
        }
        // STX per-line-item comments from unified table (only new items from this batch)
        const stxItemIds = Object.values(normStxByCsId).flat().map((s: any) => s.id);
        const newStxIds = stxItemIds.filter(id => !seenStxIds.has(id));
        newStxIds.forEach(id => seenStxIds.add(id));
        if (newStxIds.length > 0) {
          for (let j = 0; j < newStxIds.length; j += BATCH_SIZE) {
            const idBatch = newStxIds.slice(j, j + BATCH_SIZE);
            const { data: stxCmts } = await supabase.from("comments")
              .select("*").eq("entity_type", "stx_line_item").in("entity_id", idBatch);
            if (stxCmts) {
              for (const cmt of stxCmts) {
                // Find the STX item and push comment
                for (const csId in normStxByCsId) {
                  const item = normStxByCsId[csId].find((s: any) => s.id === cmt.entity_id);
                  if (item) {
                    item.comments.push({
                      id: cmt.id,
                      month: typeof cmt.month === 'string' ? parseInt(cmt.month, 10) : cmt.month,
                      text: cmt.body,
                      body: cmt.body,
                      author: cmt.author_label || "",
                      category: cmt.category || "Other",
                      createdAt: cmt.created_at,
                    });
                    break;
                  }
                }
              }
            }
          }
        }
        // State renewal per-item comments from unified table
        const srItemIds = Object.values(normSrByCsId).flat().map((s: any) => s.id);
        const newSrIds = srItemIds.filter(id => !seenSrIds.has(id));
        newSrIds.forEach(id => seenSrIds.add(id));
        if (newSrIds.length > 0) {
          for (let j = 0; j < newSrIds.length; j += BATCH_SIZE) {
            const idBatch = newSrIds.slice(j, j + BATCH_SIZE);
            const { data: srCmts } = await supabase.from("comments")
              .select("*").eq("entity_type", "state_renewal_item").in("entity_id", idBatch);
            if (srCmts) {
              for (const cmt of srCmts) {
                for (const csId in normSrByCsId) {
                  const item = normSrByCsId[csId].find((s: any) => s.id === cmt.entity_id);
                  if (item) {
                    item.comments.push({
                      id: cmt.id,
                      month: typeof cmt.month === 'string' ? parseInt(cmt.month, 10) : cmt.month,
                      text: cmt.body,
                      body: cmt.body,
                      author: cmt.author_label || "",
                      createdAt: cmt.created_at,
                    });
                    break;
                  }
                }
              }
            }
          }
        }
        // unified comments table (service-level)
        const { data: cmtBatch } = await supabase.from("comments")
          .select("*").eq("entity_type", "service").in("entity_id", batch);
        if (cmtBatch) {
          for (const cmt of cmtBatch) {
            if (!normCommentsByCsId[cmt.entity_id]) normCommentsByCsId[cmt.entity_id] = [];
            normCommentsByCsId[cmt.entity_id].push({
              id: cmt.id, month: typeof cmt.month === 'string' ? parseInt(cmt.month, 10) : cmt.month, body: cmt.body,
              text: cmt.body, author: cmt.author_label || "",
              createdAt: cmt.created_at,
              stx_item_idx: cmt.stx_item_idx ?? undefined,
            });
          }
        }
      }
    }

    const clients = dbClients.map((db: any) => {
      const svcs = svcByClient[db.id] || [];
      const services = svcs.map((cs: any) => {
        const key = CODE_TO_KEY[cs.service?.code || ""] || "financials";
        return {
          csId: cs.id, key, label: SERVICE_META[key]?.label,
          enabled: true, frequency: (() => {
            const f = cs.frequency || "Monthly";
            if (f === "weekly" || f === "Weekly") return "Weekly";
            if (f === "Bi-Weekly" || f === "bi_weekly-A" || f === "bi-weekly-a") return "Bi-Weekly A";
            if (f === "Bi-Weekly B" || f === "bi_weekly-B" || f === "bi-weekly-b") return "Bi-Weekly B";
            if (f === "Bi-weekly" || f === "bi-weekly" || f === "Biweekly" || f === "biweekly") return "Bi-Weekly A";
            if (f === "monthly" || f === "Monthly") return "Monthly";
            if (f === "semi-monthly" || f === "Semi-Monthly") return "Semi-Monthly";
            if (f === "quarterly" || f === "Quarterly") return "Quarterly";
            if (f === "yearly" || f === "Yearly" || f === "annual" || f === "Annual") return "Yearly";
            return f;
          })(),
          processor: cs.processor || "", assignedTo: staffNames[cs.assigned_to || ""] || cs.assigned_to || "",
          expectedAnnual: cs.expected_annual ? Number(cs.expected_annual) || 0 : 0,
          financialsMonth: cs.financials_month ?? 0,
          paydate: cs.paydate || "",
          payrollPassword: cs.payroll_password || "",
          eftps: cs.eftps || "",
          biweeklyCode: cs.biweekly_code || "",
          payStartDate: cs.pay_start_date || "",
          payPeriodFrequency: cs.pay_period_frequency || "",
          reportingMethod: cs.reporting_method || "",
          payrollCategory: cs.payroll_category || "",
          qbLicense: cs.qb_license || "",
          reportingNotes: cs.reporting_notes || "",
          filingState: cs.filing_state || "",
          filingMonth: cs.due_month ? String(cs.due_month) : "",
          filingType: cs.return_type || "",
          payEmails: (() => { const pe = cs.pay_emails; if (!pe) return []; if (Array.isArray(pe)) return pe; try { const p = JSON.parse(pe); return Array.isArray(p) ? p : pe ? [String(pe)] : []; } catch { return pe ? [String(pe)] : []; } })(),
          comments: lite ? [] : (() => {
            const oldCmts = Array.isArray(cs.comments) ? cs.comments : [];
            const newCmts = normCommentsByCsId[cs.id] || [];
            return [...oldCmts, ...newCmts];
          })(),
          salesTaxLineItems: lite ? [] : (() => {
            const newStx = (normStxByCsId[cs.id] || []);
            if (newStx.length > 0) return newStx;
            const oldStx = Array.isArray(cs.sales_tax_line_items)
              ? cs.sales_tax_line_items.map((item: any) => ({
                  ...item,
                  assignedTo: staffNames[item.assignedTo || ""] || item.assignedTo || "",
                }))
              : [];
            return oldStx;
          })(),
          currentStage: (periodByCsId[cs.id]?.[new Date().getMonth()] || "not_started"),
          months: lite ? Array(12).fill("lock") : Array.from({ length: 12 }, (_, i) => {
            const s = periodByCsId[cs.id]?.[i];
            return !s ? "lock" : s === "done" ? "done" : s === "na" ? "na" : s === "in_progress" ? "in_progress" : s === "waiting_client" ? "waiting" : s === "prepared" ? "billed" : s === "delayed" ? "delayed" : "lock";
          }),
          periodCounts: countByCsId[cs.id] || Array(12).fill(0),
          svcNotes: cs.notes || "",
          stateRenewal: cs.state_renewal ?? null,
          renewalState: cs.renewal_state || null,
          renewalDueMonth: cs.renewal_due_month || null,
          renewalDueDay: cs.renewal_due_day || null,
          renewalIdentifiers: cs.renewal_identifiers || null,
          stateRenewalItems: lite ? [] : (normSrByCsId[cs.id] || []),
          serviceName: cs.service_name || "",
        };
      });
      const seen = new Set(services.map((s: any) => s.key));
      // Merge duplicate services: keep the first occurrence but prefer non-empty values from later ones
      const mergedSvcs: any[] = [];
      const mergedKeys = new Set<string>();
      for (const svc of services) {
        if (mergedKeys.has(svc.key)) {
          // Merge fields from duplicate into the first occurrence
          const existing = mergedSvcs.find((s: any) => s.key === svc.key);
          if (!existing) continue;
          // Merge salesTaxLineItems
          if (svc.salesTaxLineItems?.length) {
            existing.salesTaxLineItems = [...(existing.salesTaxLineItems || []), ...svc.salesTaxLineItems];
          }
          // Prefer non-empty values from the duplicate for other fields
          const copyFields = ["filingState","filingMonth","filingType","frequency","processor",
            "assignedTo","expectedAnnual","financialsMonth","paydate","payrollPassword",
            "eftps","biweeklyCode","payStartDate","payPeriodFrequency","reportingMethod",
            "payrollCategory","qbLicense","reportingNotes","filingState","filingMonth",
            "filingType","currentStage","stateRenewal","renewalState","renewalDueMonth",
            "renewalDueDay","renewalIdentifiers","stateRenewalItems","serviceName"];
          for (const f of copyFields) {
            if (svc[f] && !existing[f]) existing[f] = svc[f];
          }
          if (svc.svcNotes && !existing.svcNotes) existing.svcNotes = svc.svcNotes;
          if (svc.payEmails?.length && !existing.payEmails?.length) existing.payEmails = svc.payEmails;
          if (svc.comments?.length) existing.comments = [...(existing.comments || []), ...svc.comments];
        } else {
          mergedKeys.add(svc.key);
          mergedSvcs.push(svc);
        }
      }
      // Workload, timesheet, and vault only need real active services. Do not
      // serialize placeholder services for every client in their lightweight view.
      if (!lite) {
        for (const key of Object.keys(SERVICE_META) as ServiceKey[]) {
          if (!mergedKeys.has(key)) mergedSvcs.push({ csId: "", key, label: SERVICE_META[key].label, enabled: false, frequency: "Monthly", processor: "", assignedTo: "", expectedAnnual: 0, financialsMonth: 0, paydate: "", payrollPassword: "", eftps: "", biweeklyCode: "", payStartDate: "", payPeriodFrequency: "", reportingMethod: "", payrollCategory: "", qbLicense: "", reportingNotes: "", svcNotes: "", filingState: "", filingMonth: "", filingType: "", payEmails: [], comments: [], salesTaxLineItems: [], stateRenewal: null, renewalState: null, renewalDueMonth: null, renewalDueDay: null, renewalIdentifiers: null, stateRenewalItems: [], serviceName: "", currentStage: "not_started", months: Array(12).fill("lock"), periodCounts: Array(12).fill(0) });
        }
      }
      return {
        id: db.id, cid: db.cid || "CID-" + db.id.substring(0, 4),
        clientCode: db.client_code || db.cid || "",
        name: db.name, type: (db.type || "").toLowerCase() === "business" ? "Business" : "Personal",
        group: db.group_name || db.group_owner || "Unassigned",
        groupName: db.group_name || db.group_owner || "",
        contact: db.key_name || "", status: db.status || "active",
        city: db.city || "", state: db.state || "TX", zip: db.zip || "",
        emails: db.emails ? db.emails.replace(/[{}"]/g,'').split(',').filter(Boolean) : [],
        phones: db.phones ? db.phones.replace(/[{}"]/g,'').split(',').filter(Boolean) : [],
        address: db.address || "",
        assignedStaff: staffNames[svcs[0]?.assigned_to || ""] || svcs[0]?.assigned_to || "Unassigned",
        notes: db.notes || "",
        ein: db.ein || "",
        active: db.active !== false,  // default true for existing clients
        activeUpdatedAt: db.active_updated_at || null,
        activeUpdatedBy: db.active_updated_by || null,
        services: mergedSvcs,
      };
    });

    return NextResponse.json({ clients, stats: { total: totalCount, business: bizCount, personal: persCount } }, {
      headers: { 'Cache-Control': 'no-store, max-age=0' }
    });
  } catch (e: any) {
    return NextResponse.json({ error: "ERR: " + (e?.message || String(e)) }, { status: 500 });
  }
}

// ── PUT /api/clients — update client services (e.g. service toggle on/off) ──
export async function PUT(request: Request) {
  const access = await requireClientDataEditAccess();
  if (access.status) return NextResponse.json({ error: access.status === 401 ? "Unauthorized" : "Forbidden" }, { status: access.status });
  try {
    const supabase = await getSupabase();
    const body = await request.json();
    const { id: clientId, services, name, type, group, contact, emails, phones, email, phone, address, city, state, zip, assignedStaff, ein, notes, active, authorName } = body;

    if (!clientId) {
      return NextResponse.json({ error: "client id is required" }, { status: 400 });
    }

    // Normalize: accept both singular and plural forms
    const normEmails = emails ?? (email !== undefined ? [email] : undefined);
    const normPhones = phones ?? (phone !== undefined ? [phone] : undefined);

    // Update client-level fields if provided
    const clientUpdates: Record<string, any> = {};
    if (name !== undefined) clientUpdates.name = name;
    if (type !== undefined) clientUpdates.type = type;
    if (group !== undefined) clientUpdates.group_name = group;
    if (contact !== undefined) clientUpdates.key_name = contact;
    if (address !== undefined) clientUpdates.address = address;
    if (city !== undefined) clientUpdates.city = city;
    if (state !== undefined) clientUpdates.state = state;
    if (zip !== undefined) clientUpdates.zip = zip;
    if (notes !== undefined) clientUpdates.notes = notes;
    if (normEmails !== undefined) {
      const arr = Array.isArray(normEmails) ? normEmails : [normEmails];
      clientUpdates.emails = arr.filter(Boolean).join(", ");
    }
    if (normPhones !== undefined) {
      const arr = Array.isArray(normPhones) ? normPhones : [normPhones];
      clientUpdates.phones = arr.filter(Boolean).join(", ");
    }
    if (assignedStaff !== undefined) {
      // assigned_staff is derived from first service's assigned_to in GET handler.
      // Update the first service's assigned_to in client_services.
      // We'll set a flag to handle this in the service processing loop.
      clientUpdates._assignedStaff = assignedStaff;
    }
    if (ein !== undefined) clientUpdates.ein = ein;
    if (active !== undefined) {
      clientUpdates.active = active;
      clientUpdates.active_updated_at = new Date().toISOString();
      if (authorName) clientUpdates.active_updated_by = authorName;
    }

    if (Object.keys(clientUpdates).length > 0) {
      // Strip _assignedStaff before DB write — handled separately
      const assignedStaffVal = clientUpdates._assignedStaff;
      delete clientUpdates._assignedStaff;
      
      if (Object.keys(clientUpdates).length > 0) {
        const { error: updateErr } = await supabase.from("clients").update(clientUpdates).eq("id", clientId);
        if (updateErr) {
          return NextResponse.json({ error: "DB update failed: " + updateErr.message }, { status: 500 });
        }
      }

      // Handle assignedStaff: update first active service's assigned_to
      if (assignedStaffVal !== undefined) {
        let staffId = assignedStaffVal || null;
        if (assignedStaffVal) {
          const { data: staffProfile, error: staffLookupError } = await supabase
            .from("profiles")
            .select("id")
            .eq("full_name", assignedStaffVal)
            .maybeSingle();
          if (staffLookupError) throw new Error(`Staff lookup failed: ${staffLookupError.message}`);
          if (staffProfile?.id) staffId = staffProfile.id;
        }

        const { data: firstSvc, error: firstSvcError } = await supabase.from("client_services")
          .select("id").eq("client_id", clientId).limit(1).maybeSingle();
        if (firstSvcError) throw new Error(`Service lookup failed: ${firstSvcError.message}`);
        if (firstSvc) {
          const { error: svcErr } = await supabase.from("client_services")
            .update({ assigned_to: staffId }).eq("id", firstSvc.id);
          if (svcErr) throw new Error(`Assigned staff update failed: ${svcErr.message}`);
        }
      }
    }

    // Reverse map: frontend key -> service code
    const KEY_TO_CODE: Record<string, string> = {
      financials: "FIN", payroll: "PR", sales_tax: "STX",
      "1099s": "T9", renditions: "REND", tax_returns: "TAX",
      annual_reports: "RENEWAL",
    };

    // Build unique codes we need
    const safeServices = Array.isArray(services) ? services : [];
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const assigneeNames = [...new Set(safeServices
      .map((svc: any) => svc.assignedTo)
      .filter((assignedTo: unknown): assignedTo is string => typeof assignedTo === "string" && assignedTo !== "" && assignedTo !== "Unassigned" && !uuidRegex.test(assignedTo))
    )];
    const assigneeIdsByName: Record<string, string> = {};
    if (assigneeNames.length > 0) {
      const { data: assigneeProfiles, error: assigneeProfilesError } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("full_name", assigneeNames);
      if (assigneeProfilesError) throw new Error(`Assignee lookup failed: ${assigneeProfilesError.message}`);
      for (const profile of assigneeProfiles || []) assigneeIdsByName[profile.full_name] = profile.id;
    }
    const normalizeAssignedTo = (assignedTo: unknown): string | null => {
      if (typeof assignedTo !== "string" || assignedTo === "" || assignedTo === "Unassigned") return null;
      return uuidRegex.test(assignedTo) ? assignedTo : assigneeIdsByName[assignedTo] || null;
    };
    const codes = [...new Set(safeServices
      .filter((s: any) => KEY_TO_CODE[s.key])
      .map((s: any) => KEY_TO_CODE[s.key])
    )];

    // Get service IDs for codes
    const { data: svcRows } = await supabase
      .from("services")
      .select("id, code")
      .in("code", codes);

    if (!svcRows) {
      return NextResponse.json({ error: "Failed to fetch services" }, { status: 500 });
    }

    const svcCodeToId: Record<string, string> = {};
    for (const sr of svcRows) svcCodeToId[sr.code] = sr.id;

    // Get existing client_services rows for this client
    const { data: existingRows, error: existingRowsError } = await supabase
      .from("client_services")
      .select("*")
      .eq("client_id", clientId);
    if (existingRowsError) throw new Error(`Service lookup failed: ${existingRowsError.message}`);

    const existingByServiceId: Record<string, any> = {};
    for (const row of existingRows || []) {
      existingByServiceId[row.service_id] = row;
    }

    const results: { key: string; action: string; csId?: string }[] = [];
// Helper to sync comments
    async function syncComments(csId: string, comments: any[]) {
      if (!comments || !Array.isArray(comments)) return;
      // Use unified comments table
      for (const cm of comments) {
        const body = cm.text || cm.body || "";
        if (!body) continue;
        const month = cm.month ?? null;
        const author = cm.author || "";
        // Skip if identical comment already exists
        const { data: existing, error: commentLookupError } = await supabase.from("comments")
          .select("id").eq("entity_type", "service").eq("entity_id", csId)
          .eq("month", month).eq("body", body).eq("author_label", author);
        if (commentLookupError) throw new Error(`Comment lookup error: ${commentLookupError.message}`);
        if (existing && existing.length > 0) continue;
        const { error: commentInsertError } = await supabase.from("comments").insert({
          entity_type: "service",
          entity_id: csId,
          month,
          body,
          author_label: author,
          created_at: cm.createdAt ? new Date(cm.createdAt).toISOString() : new Date().toISOString(),
        });
        if (commentInsertError) throw new Error(`Comment insert error: ${commentInsertError.message}`);
      }
    }
// Helper to sync sales tax line items and their normalized comments
    async function syncStxLineItems(csId: string, items: any[]) {
      if (!items || !Array.isArray(items)) return;
      const normalizedItems = items.map((item: any) => ({ ...item, itemId: item.id || randomUUID() }));
      const { data: existingRows, error: existingErr } = await supabase
        .from("sales_tax_registration").select("id").eq("client_service_id", csId);
      if (existingErr) throw new Error(`STX lookup error: ${existingErr.message}`);

      const commentEntityIds = [...new Set([
        ...(existingRows || []).map((row: any) => row.id),
        ...normalizedItems.map((item: any) => item.itemId),
      ])];
      if (commentEntityIds.length > 0) {
        const { error: commentDeleteErr } = await supabase.from("comments").delete()
          .eq("entity_type", "stx_line_item").in("entity_id", commentEntityIds);
        if (commentDeleteErr) throw new Error(`STX comment delete error: ${commentDeleteErr.message}`);
      }

      const { error: delErr } = await supabase.from("sales_tax_registration").delete().eq("client_service_id", csId);
      if (delErr) throw new Error(`STX delete error: ${delErr.message}`);

      for (const item of normalizedItems) {
        const itemId = item.itemId;
        const { error: insErr } = await supabase.from("sales_tax_registration").insert({
          id: itemId,
          client_service_id: csId,
          rt_number: item.rt || item.rt_number || "",
          service_name: item.serviceName || "",
          tax_reg_id: item.taxId || item.tax_reg_id || "",
          frequency: item.frequency || null,
          assigned_to: item.assignedTo || null,
          bank_name: item.bankName || "",
          bank_account_ref: item.bankAccount || "",
          bank_routing_ref: item.bankRouting || "",
          notes: item.notes || "",
        });
        if (insErr) throw new Error(`STX insert error: ${insErr.message}`);

        for (const cm of Array.isArray(item.comments) ? item.comments : []) {
          const body = cm.text || cm.body || "";
          if (!body) continue;
          const { error: commentInsertErr } = await supabase.from("comments").insert({
            entity_type: "stx_line_item",
            entity_id: itemId,
            month: cm.month ?? null,
            body,
            author_label: cm.author || "",
            category: cm.category || "Other",
            created_at: cm.createdAt ? new Date(cm.createdAt).toISOString() : new Date().toISOString(),
          });
          if (commentInsertErr) throw new Error(`STX comment insert error: ${commentInsertErr.message}`);
        }
      }
    }
// Helper to sync state renewal items
    async function syncStateRenewals(csId: string, items: any[]) {
      if (!items || !Array.isArray(items)) return;

      const normalizedItems = items.map((item: any) => ({ ...item, itemId: item.id || randomUUID() }));
      const { data: existingRows, error: existingErr } = await supabase
        .from("state_renewals").select("id").eq("client_service_id", csId);
      if (existingErr) throw new Error(`SR lookup error: ${existingErr.message}`);

      // Remove comments for deleted items as well as items being rewritten. This must
      // happen before the parent rows are deleted so removed renewals cannot orphan notes.
      const commentEntityIds = [...new Set([
        ...(existingRows || []).map((row: any) => row.id),
        ...normalizedItems.map((item: any) => item.itemId),
      ])];
      if (commentEntityIds.length > 0) {
        const { error: commentDeleteErr } = await supabase.from("comments").delete()
          .eq("entity_type", "state_renewal_item").in("entity_id", commentEntityIds);
        if (commentDeleteErr) throw new Error(`SR comment delete error: ${commentDeleteErr.message}`);
      }

      const { error: delErr } = await supabase.from("state_renewals").delete().eq("client_service_id", csId);
      if (delErr) throw new Error(`SR delete error: ${delErr.message}`);

      for (const item of normalizedItems) {
        const itemId = item.itemId;
        const { error: insErr } = await supabase.from("state_renewals").insert({
          id: itemId,
          client_service_id: csId,
          state: item.state || "TX",
          due_month: item.dueMonth || null,
          due_day: item.dueDay || null,
          identifiers: item.identifiers || null,
          assigned_to: item.assignedTo || null,
          frequency: item.frequency || "Yearly",
        });
        if (insErr) throw new Error(`SR insert error: ${insErr.message}`);

        for (const cm of Array.isArray(item.comments) ? item.comments : []) {
          const body = cm.text || cm.body || "";
          if (!body) continue;
          const { error: commentInsertErr } = await supabase.from("comments").insert({
          entity_type: "state_renewal_item",
          entity_id: itemId,
          month: cm.month ?? null,
          body,
          author_label: cm.author || "",
          created_at: cm.createdAt ? new Date(cm.createdAt).toISOString() : new Date().toISOString(),
        });
        if (commentInsertErr) throw new Error(`SR comment insert error: ${commentInsertErr.message}`);
        }
      }
    }


    for (const svc of safeServices) {
      const code = KEY_TO_CODE[svc.key];
      if (!code) continue;
      const serviceId = svcCodeToId[code];
      if (!serviceId) {
        results.push({ key: svc.key, action: "skipped (no service row)" });
        continue;
      }

      const existing = existingByServiceId[serviceId];
      const wantsEnabled = svc.enabled === true;

      if (wantsEnabled) {
        if (existing) {
              // Already exists — activate if inactive
          if (!existing.active) {
            const { error: activationError } = await supabase.from("client_services").update({
                active: true,
                frequency: svc.frequency || existing.frequency || "Monthly",
                assigned_to: normalizeAssignedTo(svc.assignedTo) ?? existing.assigned_to ?? null,
                processor: svc.processor || existing.processor || null,
                financials_month: svc.financialsMonth ?? existing.financials_month ?? null,
                expected_annual: svc.expectedAnnual ?? existing.expected_annual ?? null,
                notes: svc.svcNotes ?? existing.notes ?? null,
                filing_state: svc.filingState ?? existing.filing_state ?? null,
                due_month: svc.filingMonth ?? existing.due_month ?? null,
                return_type: svc.filingType ?? existing.return_type ?? null,
                service_name: svc.serviceName ?? existing.service_name ?? null,
                state_renewal: svc.stateRenewal ?? existing.state_renewal ?? null,
                renewal_state: svc.renewalState ?? existing.renewal_state ?? null,
                renewal_due_month: svc.renewalDueMonth ?? existing.renewal_due_month ?? null,
                renewal_due_day: svc.renewalDueDay ?? existing.renewal_due_day ?? null,
                renewal_identifiers: svc.renewalIdentifiers ?? existing.renewal_identifiers ?? null,
            }).eq("id", existing.id);
            if (activationError) throw new Error(`Service activation failed: ${activationError.message}`);
            if (svc.key === "payroll") {
                const prUpdate: Record<string,any> = {};
                if (svc.paydate !== undefined) prUpdate.paydate = svc.paydate || null;
                if (svc.payrollPassword !== undefined) prUpdate.payroll_password = svc.payrollPassword || null;
                if (svc.eftps !== undefined) prUpdate.eftps = svc.eftps || null;
                if (svc.payStartDate !== undefined) prUpdate.pay_start_date = svc.payStartDate || null;
                if (svc.payPeriodFrequency !== undefined) prUpdate.pay_period_frequency = svc.payPeriodFrequency || null;
                if (svc.reportingMethod !== undefined) prUpdate.reporting_method = svc.reportingMethod || null;
                if (svc.payrollCategory !== undefined) prUpdate.payroll_category = svc.payrollCategory || null;
                if (svc.qbLicense !== undefined) prUpdate.qb_license = svc.qbLicense || null;
                if (svc.reportingNotes !== undefined) prUpdate.reporting_notes = svc.reportingNotes || null;
                if (svc.payEmails !== undefined) prUpdate.pay_emails = Array.isArray(svc.payEmails) ? JSON.stringify(svc.payEmails) : (svc.payEmails || null);
                if (svc.biweeklyCode !== undefined) prUpdate.biweekly_code = svc.biweeklyCode || null;
                if (Object.keys(prUpdate).length > 0) {
                    const { error: payrollActivationError } = await supabase.from("client_services").update(prUpdate).eq("id", existing.id);
                    if (payrollActivationError) throw new Error(`Payroll activation update failed: ${payrollActivationError.message}`);
                }
            }
            results.push({ key: svc.key, action: "activated", csId: existing.id });
            if (svc.key === "sales_tax" && svc.salesTaxLineItems) await syncStxLineItems(existing.id, svc.salesTaxLineItems);
            if ((svc.key === "renditions" || svc.key === "annual_reports") && svc.stateRenewalItems) await syncStateRenewals(existing.id, svc.stateRenewalItems);
            if (svc.comments) await syncComments(existing.id, svc.comments);
          } else {
            // Base fields update
            const { error: serviceUpdateError } = await supabase.from("client_services").update({
                frequency: svc.frequency ?? existing.frequency ?? null,
                assigned_to: normalizeAssignedTo(svc.assignedTo) ?? existing.assigned_to ?? null,
                processor: svc.processor ?? existing.processor ?? null,
                financials_month: svc.financialsMonth ?? existing.financials_month ?? null,
                expected_annual: svc.expectedAnnual ?? existing.expected_annual ?? null,
                notes: svc.svcNotes ?? existing.notes ?? null,
                filing_state: svc.filingState ?? existing.filing_state ?? null,
                due_month: svc.filingMonth ?? existing.due_month ?? null,
                return_type: svc.filingType ?? existing.return_type ?? null,
                service_name: svc.serviceName ?? existing.service_name ?? null,
                state_renewal: svc.stateRenewal ?? existing.state_renewal ?? null,
                renewal_state: svc.renewalState ?? existing.renewal_state ?? null,
                renewal_due_month: svc.renewalDueMonth ?? existing.renewal_due_month ?? null,
                renewal_due_day: svc.renewalDueDay ?? existing.renewal_due_day ?? null,
                renewal_identifiers: svc.renewalIdentifiers ?? existing.renewal_identifiers ?? null,
            }).eq("id", existing.id);
            if (serviceUpdateError) throw new Error(`Service update failed: ${serviceUpdateError.message}`);
            // Payroll fields update (separate call — proven to work)
            if (svc.key === "payroll") {
                const prUpdate: Record<string,any> = {};
                if (svc.paydate !== undefined) prUpdate.paydate = svc.paydate || null;
                if (svc.payrollPassword !== undefined) prUpdate.payroll_password = svc.payrollPassword || null;
                if (svc.eftps !== undefined) prUpdate.eftps = svc.eftps || null;
                if (svc.payStartDate !== undefined) prUpdate.pay_start_date = svc.payStartDate || null;
                if (svc.payPeriodFrequency !== undefined) prUpdate.pay_period_frequency = svc.payPeriodFrequency || null;
                if (svc.reportingMethod !== undefined) prUpdate.reporting_method = svc.reportingMethod || null;
                if (svc.payrollCategory !== undefined) prUpdate.payroll_category = svc.payrollCategory || null;
                if (svc.qbLicense !== undefined) prUpdate.qb_license = svc.qbLicense || null;
                if (svc.reportingNotes !== undefined) prUpdate.reporting_notes = svc.reportingNotes || null;
                if (svc.payEmails !== undefined) prUpdate.pay_emails = Array.isArray(svc.payEmails) ? JSON.stringify(svc.payEmails) : (svc.payEmails || null);
                if (svc.biweeklyCode !== undefined) prUpdate.biweekly_code = svc.biweeklyCode || null;
                if (Object.keys(prUpdate).length > 0) {
                    const { error: payrollUpdateError } = await supabase.from("client_services").update(prUpdate).eq("id", existing.id);
                    if (payrollUpdateError) throw new Error(`Payroll update failed: ${payrollUpdateError.message}`);
                }
            }
            if (svc.key === "sales_tax" && svc.salesTaxLineItems) {
              await syncStxLineItems(existing.id, svc.salesTaxLineItems);
            }
            results.push({ key: svc.key, action: "already_active", csId: existing.id });
            if ((svc.key === "renditions" || svc.key === "annual_reports") && svc.stateRenewalItems) await syncStateRenewals(existing.id, svc.stateRenewalItems);
            if (svc.comments) await syncComments(existing.id, svc.comments);
          }
        } else {
          // No row — create one
          const newCsId = randomUUID();
          const { error: insErr } = await supabase
            .from("client_services")
            .insert({
              id: newCsId,
              client_id: clientId,
              service_id: serviceId,
              active: true,
              frequency: svc.frequency || "Monthly",
              assigned_to: normalizeAssignedTo(svc.assignedTo),
              processor: svc.processor || null,
              financials_month: svc.financialsMonth ?? null,
              expected_annual: svc.expectedAnnual || null,
              notes: svc.svcNotes || null,
              filing_state: svc.filingState || null,
              due_month: svc.filingMonth || null,
              return_type: svc.filingType || null,
              service_name: svc.serviceName || null,
              paydate: svc.paydate || null,
              payroll_password: svc.payrollPassword || null,
              eftps: svc.eftps || null,
              pay_start_date: svc.payStartDate || null,
              pay_period_frequency: svc.payPeriodFrequency || null,
              reporting_method: svc.reportingMethod || null,
              payroll_category: svc.payrollCategory || null,
              qb_license: svc.qbLicense || null,
              reporting_notes: svc.reportingNotes || null,
              pay_emails: Array.isArray(svc.payEmails) ? JSON.stringify(svc.payEmails) : (svc.payEmails || null),
              biweekly_code: svc.biweeklyCode || null,
              state_renewal: svc.stateRenewal ?? null,
              renewal_state: svc.renewalState ?? null,
              renewal_due_month: svc.renewalDueMonth ?? null,
              renewal_due_day: svc.renewalDueDay ?? null,
              renewal_identifiers: svc.renewalIdentifiers ?? null,
            });
          if (insErr) {
            throw new Error(`Service create failed: ${insErr.message}`);
          } else {
            results.push({ key: svc.key, action: "created", csId: newCsId });
            if (svc.key === "sales_tax" && svc.salesTaxLineItems) await syncStxLineItems(newCsId as string, svc.salesTaxLineItems);
            if ((svc.key === "renditions" || svc.key === "annual_reports") && svc.stateRenewalItems) await syncStateRenewals(newCsId as string, svc.stateRenewalItems);
            if (svc.comments) await syncComments(newCsId as string, svc.comments);
          }
        }
      } else {
        // Want disabled
        if (existing && existing.active) {
          const { error: deactivationError } = await supabase
            .from("client_services")
            .update({ active: false })
            .eq("id", existing.id);
          if (deactivationError) throw new Error(`Service deactivation failed: ${deactivationError.message}`);
          results.push({ key: svc.key, action: "deactivated" });
        } else {
          results.push({ key: svc.key, action: "already_inactive" });
        }
      }
    }

    return NextResponse.json({ success: true, results, clientUpdates: { ...clientUpdates, _assignedStaff: undefined }, srKeyPresent: !!process.env.SUPABASE_SERVICE_ROLE_KEY });
  } catch (e: any) {
    return NextResponse.json({ error: "ERR: " + (e?.message || String(e)) }, { status: 500 });
  }
}


// ── POST /api/clients — create a new client ──
export async function POST(request: Request) {
  const access = await requireClientDataEditAccess();
  if (access.status) return NextResponse.json({ error: access.status === 401 ? "Unauthorized" : "Forbidden" }, { status: access.status });
  try {
    const supabase = await getSupabase();
    const body = await request.json();
    const { name, type, group, contact, emails, phones, address, city, state, zip, ein, assignedStaff } = body;

    if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

    const clientId = crypto.randomUUID();
    const clientCode = String(Math.floor(1000 + Math.random() * 90000));

    const clientRecord: Record<string, any> = {
      id: clientId, name, type: type || "Business",
      group_name: group || "", key_name: contact || "", status: "active",
      city: city || "", state: state || "", zip: zip || "",
      address: address || "", ein: ein || "", notes: "",
      client_code: clientCode,
    };

    if (emails !== undefined) {
      const arr = Array.isArray(emails) ? emails : [emails];
      clientRecord.emails = arr.filter(Boolean).join(", ");
    }
    if (phones !== undefined) {
      const arr = Array.isArray(phones) ? phones : [phones];
      clientRecord.phones = arr.filter(Boolean).join(", ");
    }

    const { error: insErr } = await supabase.from("clients").insert(clientRecord);
    if (insErr) return NextResponse.json({ error: "INSERT failed: " + insErr.message }, { status: 500 });

    return NextResponse.json({ success: true, client: { id: clientId, cid: "CID-" + clientCode, clientCode } });
  } catch (e: any) {
    return NextResponse.json({ error: "ERR: " + (e?.message || String(e)) }, { status: 500 });
  }
}


// ── PATCH /api/clients — update a client service field (assigned_to, processor, frequency) ──
export async function PATCH(request: Request) {
  const access = await requireClientDataEditAccess();
  if (access.status) return NextResponse.json({ error: access.status === 401 ? "Unauthorized" : "Forbidden" }, { status: access.status });
  try {
    const supabase = await getSupabase();
    const body = await request.json();
    const { csId, assignedTo, processor, frequency, financialsMonth, expectedAnnual, salesTaxLineItems, comments, filingState, filingMonth, filingType, serviceName, payrollPassword, eftps, paydate, payStartDate, payPeriodFrequency, reportingMethod, payrollCategory, qbLicense, reportingNotes, payEmails, biweeklyCode, stateRenewal, renewalState, renewalDueMonth, renewalDueDay, renewalIdentifiers, stateRenewalItems } = body;

    if (!csId) {
      return NextResponse.json({ error: "csId is required" }, { status: 400 });
    }

    const updates: Record<string, any> = {};

    // If assignedTo is provided, resolve display name to profile UUID
    if (assignedTo !== undefined) {
      let assignedToId: string | null = null;
      if (assignedTo && assignedTo !== "Unassigned" && assignedTo !== "") {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (uuidRegex.test(assignedTo)) {
          assignedToId = assignedTo;
        } else {
          const { data: profile } = await supabase
            .from("profiles")
            .select("id")
            .eq("full_name", assignedTo)
            .maybeSingle();
          assignedToId = profile?.id || null;
        }
      }
      updates.assigned_to = assignedToId;
    }

    if (processor !== undefined) {
      updates.processor = processor || null;
    }

    if (frequency !== undefined) {
      updates.frequency = frequency || null;
    }

    if (financialsMonth !== undefined) updates.financials_month = financialsMonth || null;
    if (expectedAnnual !== undefined) updates.expected_annual = expectedAnnual || null;

    if (filingState !== undefined) {
      updates.filing_state = filingState || null;
    }

    if (filingMonth !== undefined) {
      updates.due_month = filingMonth || null;
    }

    if (filingType !== undefined) {
      updates.return_type = filingType || null;
    }

    if (serviceName !== undefined) {
      updates.service_name = serviceName || null;
    }

    // Payroll-specific fields
    if (payrollPassword !== undefined) updates.payroll_password = payrollPassword || null;
    if (eftps !== undefined) updates.eftps = eftps || null;
    if (paydate !== undefined) updates.paydate = paydate ? normalizePayDay(paydate) : null;
    if (payStartDate !== undefined) {
      updates.pay_start_date = payStartDate || null;
    } else if (paydate !== undefined || payPeriodFrequency !== undefined) {
      const nextPayDay = paydate !== undefined ? normalizePayDay(paydate || "") : "";
      const nextFrequency = payPeriodFrequency || frequency || "";
      const calculatedStart = calculatePayrollStartDate(nextFrequency, nextPayDay);
      if (calculatedStart) updates.pay_start_date = calculatedStart;
    }
    if (payPeriodFrequency !== undefined) updates.pay_period_frequency = payPeriodFrequency || null;
    if (reportingMethod !== undefined) updates.reporting_method = reportingMethod || null;
    if (payrollCategory !== undefined) updates.payroll_category = payrollCategory || null;
    if (qbLicense !== undefined) updates.qb_license = qbLicense || null;
    if (reportingNotes !== undefined) updates.reporting_notes = reportingNotes || null;
    if (payEmails !== undefined) updates.pay_emails = Array.isArray(payEmails) ? JSON.stringify(payEmails) : (payEmails || null);
    if (biweeklyCode !== undefined) updates.biweekly_code = biweeklyCode || null;

    // State renewal fields
    if (stateRenewal !== undefined) updates.state_renewal = stateRenewal;
    if (renewalState !== undefined) updates.renewal_state = renewalState || null;
    if (renewalDueMonth !== undefined) updates.renewal_due_month = renewalDueMonth || null;
    if (renewalDueDay !== undefined) updates.renewal_due_day = renewalDueDay || null;
    if (renewalIdentifiers !== undefined) updates.renewal_identifiers = renewalIdentifiers || null;

    if (Object.keys(updates).length === 0 && salesTaxLineItems === undefined && comments === undefined && stateRenewalItems === undefined) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    // Use direct PostgREST call to bypass schema cache for new columns
    const pgrestUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/client_services?select=*&id=eq.${csId}`;
    const { error } = await fetch(pgrestUrl, {
      method: "PATCH",
      headers: {
        "apikey": process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
        "Accept-Profile": "tap_hub_project",
        "Content-Profile": "tap_hub_project",
      },
      body: JSON.stringify(updates),
    }).then(async r => { const txt = await r.text(); return r.ok ? { error: null } : { error: { message: txt, status: r.status } }; });

    // ── Dual-write to normalized v7 tables ──
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Append new service comments in the deployed unified comments table.
    if (comments !== undefined) {
      const cmts = Array.isArray(comments) ? comments : [];
      for (const c of cmts) {
        const body = c.text || c.body || "";
        if (!body) continue;
        const month = c.month ?? null;
        const author = c.author || "";
        const { data: existingComments, error: commentLookupErr } = await supabase.from("comments")
          .select("id").eq("entity_type", "service").eq("entity_id", csId)
          .eq("month", month).eq("body", body).eq("author_label", author);
        if (commentLookupErr) throw new Error(`Comment lookup error: ${commentLookupErr.message}`);
        if (existingComments && existingComments.length > 0) continue;

        const { error: commentInsertErr } = await supabase.from("comments").insert({
          entity_type: "service",
          entity_id: csId,
          month,
          body,
          author_label: author,
          created_at: c.createdAt ? new Date(c.createdAt).toISOString() : new Date().toISOString(),
        });
        if (commentInsertErr) throw new Error(`Comment insert error: ${commentInsertErr.message}`);
      }
    }

    // Sync salesTaxLineItems → sales_tax_registration + comments (normalized, mirrors stateRenewalItems)
    if (salesTaxLineItems !== undefined) {
      const stxItems = Array.isArray(salesTaxLineItems) ? salesTaxLineItems : [];
      const normalizedItems = stxItems.map((item: any) => ({ ...item, itemId: item.id || randomUUID() }));

      // Gather existing registration IDs so we can clean up their comments
      const { data: existingRows, error: existingErr } = await supabase
        .from("sales_tax_registration").select("id").eq("client_service_id", csId);
      if (existingErr) throw new Error(`STX lookup error: ${existingErr.message}`);

      // Delete comments for both old and new item IDs before touching parent rows
      const commentEntityIds = [...new Set([
        ...(existingRows || []).map((row: any) => row.id),
        ...normalizedItems.map((item: any) => item.itemId),
      ])];
      if (commentEntityIds.length > 0) {
        const { error: commentDeleteErr } = await supabase.from("comments").delete()
          .eq("entity_type", "stx_line_item").in("entity_id", commentEntityIds);
        if (commentDeleteErr) throw new Error(`STX comment delete error: ${commentDeleteErr.message}`);
      }

      // Delete old registrations
      const { error: delErr } = await supabase.from("sales_tax_registration").delete().eq("client_service_id", csId);
      if (delErr) throw new Error(`STX delete error: ${delErr.message}`);

      // Re-insert registrations + their comments
      for (const item of normalizedItems) {
        const itemId = item.itemId;
        const { error: insErr } = await supabase.from("sales_tax_registration").insert({
          id: itemId,
          client_service_id: csId,
          rt_number: item.rt || item.rt_number || "",
          service_name: item.serviceName || "",
          tax_reg_id: item.taxId || item.tax_reg_id || "",
          frequency: item.frequency || null,
          assigned_to: item.assignedTo || null,
          bank_name: item.bankName || "",
          bank_account_ref: item.bankAccount || "",
          bank_routing_ref: item.bankRouting || "",
          notes: item.notes || "",
        });
        if (insErr) throw new Error(`STX insert error: ${insErr.message}`);

        for (const cm of Array.isArray(item.comments) ? item.comments : []) {
          const body = cm.text || cm.body || "";
          if (!body) continue;
          const { error: commentInsertErr } = await supabase.from("comments").insert({
            entity_type: "stx_line_item",
            entity_id: itemId,
            month: cm.month ?? null,
            body,
            author_label: cm.author || "",
            category: cm.category || "Other",
            created_at: cm.createdAt ? new Date(cm.createdAt).toISOString() : new Date().toISOString(),
          });
          if (commentInsertErr) throw new Error(`STX comment insert error: ${commentInsertErr.message}`);
        }
      }
    }

    // Sync stateRenewalItems → state_renewals
    if (stateRenewalItems !== undefined) {
      const srItems = Array.isArray(stateRenewalItems) ? stateRenewalItems : [];
      const normalizedItems = srItems.map((item: any) => ({ ...item, itemId: item.id || randomUUID() }));
      const { data: existingRows, error: existingErr } = await supabase
        .from("state_renewals").select("id").eq("client_service_id", csId);
      if (existingErr) throw new Error(`SR lookup error: ${existingErr.message}`);

      const commentEntityIds = [...new Set([
        ...(existingRows || []).map((row: any) => row.id),
        ...normalizedItems.map((item: any) => item.itemId),
      ])];
      if (commentEntityIds.length > 0) {
        const { error: commentDeleteErr } = await supabase.from("comments").delete()
          .eq("entity_type", "state_renewal_item").in("entity_id", commentEntityIds);
        if (commentDeleteErr) throw new Error(`SR comment delete error: ${commentDeleteErr.message}`);
      }

      const { error: renewalDeleteErr } = await supabase.from("state_renewals").delete().eq("client_service_id", csId);
      if (renewalDeleteErr) throw new Error(`SR delete error: ${renewalDeleteErr.message}`);

      // Auto-set state_renewal=true so the client shows on Annual Reports tab
      const { error: renewalFlagErr } = await supabase.from("client_services").update({ state_renewal: true }).eq("id", csId);
      if (renewalFlagErr) throw new Error(`SR flag update error: ${renewalFlagErr.message}`);

      for (const item of normalizedItems) {
        const itemId = item.itemId;
        const { error: renewalInsertErr } = await supabase.from("state_renewals").insert({
          id: itemId,
          client_service_id: csId,
          state: item.state || "TX",
          due_month: item.dueMonth || null,
          due_day: item.dueDay || null,
          identifiers: item.identifiers || null,
          assigned_to: item.assignedTo || null,
          frequency: item.frequency || "Yearly",
        });
        if (renewalInsertErr) throw new Error(`SR insert error: ${renewalInsertErr.message}`);

        for (const cm of Array.isArray(item.comments) ? item.comments : []) {
          const body = cm.text || cm.body || "";
          if (!body) continue;
          const { error: commentInsertErr } = await supabase.from("comments").insert({
          entity_type: "state_renewal_item",
          entity_id: itemId,
          month: cm.month ?? null,
          body,
          author_label: cm.author || "",
          created_at: cm.createdAt ? new Date(cm.createdAt).toISOString() : new Date().toISOString(),
        });
        if (commentInsertErr) throw new Error(`SR comment insert error: ${commentInsertErr.message}`);
        }
      }
    }

return NextResponse.json({ success: true, ...updates });
  } catch (e: any) {
    return NextResponse.json({ error: "ERR: " + (e?.message || String(e)) }, { status: 500 });
  }
}

// ── DELETE /api/clients?id=... or ?ids=a,b,c — cascade-delete client(s) + all associated records ──
export async function DELETE(request: Request) {
  const access = await requireClientDataEditAccess();
  if (access.status) return NextResponse.json({ error: access.status === 401 ? "Unauthorized" : "Forbidden" }, { status: access.status });
  try {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("id");
    const idsParam = searchParams.get("ids");
    
    const clientIds: string[] = clientId
      ? [clientId]
      : idsParam ? idsParam.split(",").map((s: string) => s.trim()).filter(Boolean)
      : [];
    
    if (clientIds.length === 0) {
      return NextResponse.json({ error: "id or ids is required" }, { status: 400 });
    }

    // Use service_role for cascade deletes (RLS may block anon key)
    const srKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      srKey || anonKey || "",
      { db: { schema: "tap_hub_project" } }
    );

    let totalResults: string[] = [];
    let errors: string[] = [];

    for (const cid of clientIds) {
      const results: string[] = [];

      // 0. Collect all client_service IDs to cascade manually
      const { data: svcs } = await supabase.from("client_services").select("id").eq("client_id", cid);
      const csIds = (svcs || []).map((s: any) => s.id);

      if (csIds.length > 0) {
        let { error: e } = await supabase.from("period_counts").delete().in("client_service_id", csIds);
        if (e) results.push("period_counts: " + e.message);

        e = (await supabase.from("work_periods").delete().in("client_service_id", csIds)).error;
        if (e) results.push("work_periods: " + e.message);

        e = (await supabase.from("comments").delete()
          .eq("entity_type", "service").in("entity_id", csIds)).error;
        if (e) results.push("comments(service): " + e.message);

        const { data: stxRows } = await supabase.from("sales_tax_registration")
          .select("id").in("client_service_id", csIds);
        const stxIds = (stxRows || []).map((row: any) => row.id);
        if (stxIds.length > 0) {
          e = (await supabase.from("comments").delete()
            .eq("entity_type", "stx_line_item").in("entity_id", stxIds)).error;
          if (e) results.push("comments(stx): " + e.message);
        }

        const { data: renewalRows } = await supabase.from("state_renewals")
          .select("id").in("client_service_id", csIds);
        const renewalIds = (renewalRows || []).map((row: any) => row.id);
        if (renewalIds.length > 0) {
          e = (await supabase.from("comments").delete()
            .eq("entity_type", "state_renewal_item").in("entity_id", renewalIds)).error;
          if (e) results.push("comments(renewal): " + e.message);
        }

        e = (await supabase.from("sales_tax_registration").delete().in("client_service_id", csIds)).error;
        if (e) results.push("sales_tax_registration: " + e.message);

        e = (await supabase.from("state_renewals").delete().in("client_service_id", csIds)).error;
        if (e) results.push("state_renewals: " + e.message);
      }

      let { error: e1 } = await supabase.from("client_services").delete().eq("client_id", cid);
      if (e1) { errors.push(cid + ": " + e1.message); continue; }
      results.push("client_services");

      let { error: e2 } = await supabase.from("credentials").delete().eq("client_id", cid);
      if (!e2) results.push("credentials");

      let { error: e3 } = await supabase.from("clients").delete().eq("id", cid);
      if (e3) { errors.push(cid + ": " + e3.message); continue; }
      results.push("clients");

      totalResults = totalResults.concat(results);
    }

    if (errors.length > 0 && totalResults.length === 0) {
      return NextResponse.json({ error: errors.join("; "), cascaded: [] }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      deleted: clientIds.length,
      errors: errors,
      cascaded: totalResults,
    });
  } catch (e: any) {
    return NextResponse.json({ error: "ERR: " + (e?.message || String(e)) }, { status: 500 });
  }
}
// DEPLOY_MARKER: payroll_fix_v9_1783782597
// STX_FIX_MARKER_v2
