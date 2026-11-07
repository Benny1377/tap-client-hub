import { NextRequest, NextResponse } from "next/server";
import { DELEGABLE_BILLING_ROLES, effectiveBillingPolicy, requireBillingAccess, requireBillingAction, requireBillingPowerUser, resolveBillingActions, type BillingPolicyRow } from "@/lib/billing-access";
import { apiError, boundedLimit, cursorDecode, cursorEncode, firmDateISO, isDateOnly, moneyString, mutationResponse, permissionActionFor, toCamel, toPhase2Bundle, toPhase2Candidate } from "@/lib/billing-phase2";
import { createAdminClient } from "@/lib/supabase/admin";
import { averageMonthlyCents, centsToMoney, moneyToCents, occurrencesPerYear } from "@/lib/billing-monthly-amount";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ path: string[] }> };
// Supabase's admin client is intentionally not generated with the Operations schema;
// confine its dynamic JSON row shape to this adapter boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
// Dynamic table names are restricted to the static TABLES allowlist below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DynamicQuery = any;
const TABLES: Record<string,string> = { "rate-cards":"billing_rate_cards", "bundles":"billing_bundles", candidates:"billing_candidates", "completion-source-maps":"billing_completion_source_maps" };
const MONEY = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function pathParts(ctx: Ctx) { return ctx.params.then(({path}) => path); }
async function readObjectBody(request: NextRequest): Promise<Row | null> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body as Row : null;
  } catch { return null; }
}
function dbError(error: Row) {
  const overlap = error?.constraint === "billing_effective_date_overlap" || /effective date overlap/i.test(error?.message || "");
  const code = error?.code === "23505" ? (overlap ? "EFFECTIVE_DATE_OVERLAP" : "DUPLICATE_RESOURCE") : error?.code === "23503" || error?.code === "P0002" ? "NOT_FOUND" : error?.code === "22023" ? "INVALID_INPUT" : error?.code === "42501" ? "FORBIDDEN" : "BILLING_WRITE_FAILED";
  const status = error?.code === "23505" || error?.code === "23503" ? 409 : error?.code === "P0002" ? 404 : error?.code === "22023" ? 422 : error?.code === "42501" ? 403 : 500;
  return apiError(overlap ? "Effective date range overlaps an existing record" : error?.code === "P0002" || error?.code === "23503" ? "Referenced resource not found" : error?.code === "22023" ? "Invalid Billing request" : error?.code === "42501" ? "Forbidden" : "Billing request could not be saved", code, status);
}
function cleanReason(body: Row) { return typeof body.reason === "string" && body.reason.trim().length > 0 ? body.reason.trim() : null; }
function validSourceMap(body: Row) {
  const identityFields = Array.isArray(body.identityFields) ? [...body.identityFields].sort().join(",") : "";
  if (body.adapter === "schedule") return identityFields === "client_service_id,period" && body.candidateDateRule === "period_end" && Object.keys(body.predicate || {}).length === 0;
  if (body.adapter === "work_period_done") return identityFields === "client_service_id,period" && ["period_end","completion_date"].includes(body.candidateDateRule) && body.predicate?.stage === "done" && Object.keys(body.predicate).length === 1;
  if (body.adapter === "period_count_threshold") return identityFields === "client_service_id,period" && body.candidateDateRule === "period_end" && Number.isInteger(body.predicate?.threshold) && body.predicate.threshold > 0 && Object.keys(body.predicate).length === 1;
  if (body.adapter === "manual_confirmation") return identityFields === "confirmation_id" && body.candidateDateRule === "confirmed_date" && Object.keys(body.predicate || {}).length === 0;
  return false;
}
function normalizeOperationsPeriod(value: unknown): string | null {
  const raw = typeof value === "number" && Number.isInteger(value) ? String(value) : value;
  if (typeof raw !== "string") return null;
  const match = /^(\d{4})-?(\d{2})$/.exec(raw);
  if (!match) return null;
  const [, yearText, monthText] = match;
  const year = Number(yearText), month = Number(monthText);
  if (year < 1900 || month < 1 || month > 12) return null;
  return `${yearText}-${monthText}`;
}
function firmMidnightISO(date: string) {
  const guess = new Date(`${date}T06:00:00.000Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(guess);
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value);
  const representedAsUtc = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
  const firmOffset = representedAsUtc - guess.getTime();
  return new Date(Date.parse(`${date}T00:00:00.000Z`) - firmOffset).toISOString();
}
function nextDate(date: string) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}
function periodEnd(period: string) {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}
function inWindow(date: string, from: string, to: string) { return date >= from && date <= to; }
function scheduledMonths(frequency: unknown, financialsMonth: unknown): number[] | null {
  const value = typeof frequency === "string" ? frequency.trim().toLowerCase() : "";
  if (value === "monthly") return Array.from({ length: 12 }, (_, index) => index + 1);
  if (value === "quarterly") return [1, 4, 7, 10];
  if (value === "annual" || value === "yearly") {
    const month = Number(financialsMonth);
    return [Number.isInteger(month) && month >= 1 && month <= 12 ? month : 12];
  }
  return null;
}
export async function generateFromOperations(db: ReturnType<typeof createAdminClient>, actor: string, input: Row) {
  const from = input.from as string, to = input.to as string;
  const selectedIds = Array.isArray(input.clientServiceIds) ? input.clientServiceIds.filter((id: unknown) => typeof id === "string") : [];
  // Use the stable services.name field rather than optional client_services
  // display labels; local Operations fixtures predate that optional column.
  let servicesQuery = db.from("client_services").select("id,client_id,active,frequency,financials_month,services!inner(code,name,tracking)").eq("active", true);
  if (selectedIds.length) servicesQuery = servicesQuery.in("id", selectedIds);
  if (typeof input.clientId === "string" && UUID.test(input.clientId)) servicesQuery = servicesQuery.eq("client_id", input.clientId);
  const { data: serviceRows, error: serviceError } = await servicesQuery;
  if (serviceError) return { error: apiError("Unable to read Operations service assignments", "BILLING_READ_FAILED", 500) };
  const serviceById = new Map<string, Row>((serviceRows || []).map((row: Row) => [row.id, row]));
  const clientServiceIds = [...serviceById.keys()];
  if (!clientServiceIds.length) return { result: { created: 0, unpriced: 0, existing: 0, skipped: 0, skippedByReason: { no_map: 0, map_disabled: 0, source_incomplete: 0, outside_window: 0 }, candidateIds: [] as string[] } };

  const { data: maps, error: mapsError } = await db.from("billing_completion_source_maps").select("*")
    .in("client_service_id", clientServiceIds).lte("effective_from", to).or(`effective_to.is.null,effective_to.gte.${from}`).order("effective_from", { ascending: false });
  if (mapsError) return { error: apiError("Unable to read Billing source maps", "BILLING_READ_FAILED", 500) };
  const mapsByService = new Map<string, Row[]>();
  for (const map of maps || []) mapsByService.set(map.client_service_id, [...(mapsByService.get(map.client_service_id) || []), map]);

  const skippedByReason = { no_map: 0, map_disabled: 0, source_incomplete: 0, outside_window: 0 };
  const candidates: Row[] = [];
  for (const clientServiceId of clientServiceIds) {
    const service = serviceById.get(clientServiceId);
    const applicableMaps = mapsByService.get(clientServiceId) || [];
    const enabledMaps = applicableMaps.filter((map) => map.enabled && (!map.effective_to || map.effective_to >= from));
    if (!enabledMaps.length) {
      skippedByReason[applicableMaps.length ? "map_disabled" : "no_map"]++;
      continue;
    }
    for (const map of enabledMaps) {
      const serviceInfo = Array.isArray(service.services) ? service.services[0] : service.services;
      if (!service.client_id || !serviceInfo?.code || !serviceInfo?.name) { skippedByReason.source_incomplete++; continue; }
      if (map.adapter === "schedule") {
        const months = scheduledMonths(service.frequency, service.financials_month);
        if (!months) { skippedByReason.source_incomplete++; continue; }
        const cursor = new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, 1));
        const last = new Date(Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, 1));
        while (cursor <= last) {
          const month = cursor.getUTCMonth() + 1, period = `${cursor.getUTCFullYear()}-${String(month).padStart(2, "0")}`, candidateDate = periodEnd(period);
          if (months.includes(month)) {
            if (!inWindow(candidateDate, from, to)) skippedByReason.outside_window++;
            else if (candidateDate < map.effective_from || (map.effective_to && candidateDate > map.effective_to)) skippedByReason.map_disabled++;
            else candidates.push({ map, service, serviceInfo, period, candidateDate, identity: `${clientServiceId}:${period}`, candidateType: "recurring", adapter: "schedule", unit: "service", description: serviceInfo.name });
          }
          cursor.setUTCMonth(cursor.getUTCMonth() + 1);
        }
      } else if (map.adapter === "work_period_done") {
        let workPeriodQuery = db.from("work_periods").select("client_service_id,period,stage,done_at").eq("client_service_id", clientServiceId);
        if (map.candidate_date_rule === "completion_date") {
          // Completion can happen after the service period. Filter by the actual
          // Houston-local completion window, not by the period's YYYYMM value.
          workPeriodQuery = workPeriodQuery.gte("done_at", firmMidnightISO(from)).lt("done_at", firmMidnightISO(nextDate(to)));
        } else {
          // Operations deployments store periods as either YYYYMM or YYYY-MM.
          // Normalize per service before applying the requested date window.
        }
        const { data: workRows, error } = await workPeriodQuery;
        if (error) return { error: apiError("Unable to read Operations work periods", "BILLING_READ_FAILED", 500) };
        for (const row of workRows || []) {
          const period = normalizeOperationsPeriod(row.period);
          if (!period) { skippedByReason.source_incomplete++; continue; }
          if (row.stage !== "done") { skippedByReason.source_incomplete++; continue; }
          const candidateDate = map.candidate_date_rule === "completion_date" ? (row.done_at ? firmDateISO(new Date(row.done_at)) : null) : periodEnd(period);
          if (!candidateDate) { skippedByReason.source_incomplete++; continue; }
          if (!inWindow(candidateDate, from, to)) { skippedByReason.outside_window++; continue; }
          if (candidateDate < map.effective_from || (map.effective_to && candidateDate > map.effective_to)) { skippedByReason.map_disabled++; continue; }
          candidates.push({ map, service, serviceInfo, period, candidateDate, identity: `${clientServiceId}:${period}`, candidateType: "completion", adapter: map.adapter, unit: "service", description: serviceInfo.name });
        }
      } else if (map.adapter === "period_count_threshold") {
        const threshold = Number(map.predicate?.threshold);
        if (!Number.isInteger(threshold) || threshold <= 0) { skippedByReason.source_incomplete++; continue; }
        const { data: countRows, error } = await db.from("period_counts").select("client_service_id,period,processed")
          .eq("client_service_id", clientServiceId);
        if (error) return { error: apiError("Unable to read Operations period counts", "BILLING_READ_FAILED", 500) };
        for (const row of countRows || []) {
          const period = normalizeOperationsPeriod(row.period);
          if (!period || !Number.isInteger(row.processed)) { skippedByReason.source_incomplete++; continue; }
          if (row.processed < threshold) continue;
          const candidateDate = periodEnd(period);
          if (!inWindow(candidateDate, from, to)) { skippedByReason.outside_window++; continue; }
          if (candidateDate < map.effective_from || (map.effective_to && candidateDate > map.effective_to)) { skippedByReason.map_disabled++; continue; }
          candidates.push({ map, service, serviceInfo, period, candidateDate, identity: `${clientServiceId}:${period}`, candidateType: "completion", adapter: map.adapter, unit: "count", description: serviceInfo.name });
        }
      } else if (map.adapter === "manual_confirmation") {
        // Confirmations are explicit Billing-owned inputs, not Operations facts
        // to be discovered by a generation scan. They enter as candidates at
        // the audited manual-confirmation endpoint below.
        continue;
      }
    }
  }

  const candidateIds: string[] = [], projectedItems: Row[] = []; let created = 0, unpriced = 0, existing = 0;
  let previewCandidates = candidates;
  if (input.preview && candidates.length) {
    const { data: persisted, error } = await db.from("billing_candidates").select("client_service_id,source_identity")
      .in("client_service_id", [...new Set(candidates.map((candidate) => candidate.service.id))]);
    if (error) return { error: apiError("Unable to read existing Billing candidates", "BILLING_READ_FAILED", 500) };
    const existingKeys = new Set((persisted || []).map((row: Row) => `${row.client_service_id}:${row.source_identity}`));
    previewCandidates = candidates.filter((candidate) => !existingKeys.has(`${candidate.service.id}:${candidate.identity}`));
  }
  for (const candidate of previewCandidates) {
    const { data: priceData, error: priceError } = await db.rpc("resolve_billing_price", {
      p_client_service_id: candidate.service.id,
      p_client_id: candidate.service.client_id,
      p_service_code: candidate.serviceInfo.code,
      p_unit: candidate.unit,
      p_on: candidate.candidateDate,
    });
    if (priceError) return { error: apiError("Unable to resolve candidate price", "PRICE_RESOLUTION_FAILED", 500) };
    const price = Array.isArray(priceData) ? priceData[0] : priceData;
    if (input.preview) {
      projectedItems.push({ clientServiceId: candidate.service.id, candidateDate: candidate.candidateDate, period: candidate.period, description: candidate.description, serviceCode: candidate.serviceInfo.code, unit: candidate.unit, unitAmount: price?.unit_amount == null ? null : moneyString(price.unit_amount), state: price ? "priced" : "unpriced", source: { adapter: candidate.adapter, identity: candidate.identity } });
      continue;
    }
    const row = {
      client_id: candidate.service.client_id, client_service_id: candidate.service.id,
      candidate_type: candidate.candidateType, source_adapter: candidate.adapter,
      source_identity: candidate.identity, period: candidate.period, candidate_date: candidate.candidateDate,
      description: candidate.description, state: price ? "open" : "unpriced", service_code: candidate.serviceInfo.code,
      unit: candidate.unit, unit_amount: price?.unit_amount ?? null, price_source: price?.price_source ?? null,
      created_by: actor, updated_by: actor,
    };
    const { data: inserted, error: insertError } = await db.from("billing_candidates")
      .upsert(row, { onConflict: "client_service_id,candidate_type,source_identity", ignoreDuplicates: true }).select("id,state").maybeSingle();
    if (insertError) return { error: apiError("Unable to save generated candidate", "BILLING_WRITE_FAILED", 500) };
    if (!inserted) { existing++; continue; }
    created++; candidateIds.push(inserted.id); if (inserted.state === "unpriced") unpriced++;
  }
  return { result: input.preview ? { projection: "projected", items: projectedItems } : { created, unpriced, existing, skipped: Object.values(skippedByReason).reduce((sum, value) => sum + value, 0), skippedByReason, candidateIds } };
}
function cursorFilter(query: DynamicQuery, table: string, cursor: Row | null) {
  if (!cursor) return query;
  if (table === "billing_candidates") {
    if (!isDateOnly(cursor.candidateDate) || typeof cursor.id !== "string" || !UUID.test(cursor.id)) throw new Error("INVALID_CURSOR");
    return query.or(`candidate_date.lt.${cursor.candidateDate},and(candidate_date.eq.${cursor.candidateDate},id.lt.${cursor.id})`);
  }
  if (typeof cursor.name !== "string" || typeof cursor.id !== "string" || !UUID.test(cursor.id) || cursor.name.length > 200) throw new Error("INVALID_CURSOR");
  const quoted = `"${cursor.name.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
  return query.or(`name.gt.${quoted},and(name.eq.${quoted},id.gt.${cursor.id})`);
}
async function authorized(path: string[], method: string) {
  const resource = path[0] === "settings" || (path[0] === "permissions" && path[1] === "policy") ? path[1] : path[0];
  const action = permissionActionFor(resource, method);
  return requireBillingAction(action);
}
async function permissionGet() {
  // This endpoint reports effective actions, including an explicit revocation
  // of billing.view, so it is gated by Billing module access instead.
  const access = await requireBillingAccess();
  if (access.response || !access.identity) return access.response;
  const actions = await resolveBillingActions(access.identity);
  return NextResponse.json({role:access.identity.role,modules:access.identity.modules,actions},{headers:{"Cache-Control":"no-store"}});
}
async function policyGet() {
  const access = await requireBillingAction("policy.manage");
  if (access.response || !access.identity) return access.response;
  const { data, error } = await createAdminClient()
    .from("billing_action_policy")
    .select("action_key,allowed_roles,enabled")
    .order("action_key", { ascending: true });
  if (error) return apiError("Unable to load Billing permission policy", "BILLING_READ_FAILED", 500);
  return NextResponse.json({ policies: effectiveBillingPolicy((data || []) as BillingPolicyRow[]) }, { headers: { "Cache-Control": "no-store" } });
}
async function clientServicesGet(request: NextRequest) {
  const pricingAccess = await requireBillingAction("pricing.view");
  if (pricingAccess.response) {
    const candidateAccess = await requireBillingAction("candidates.view");
    if (candidateAccess.response) return candidateAccess.response;
  }
  const clientId = request.nextUrl.searchParams.get("clientId");
  if (!clientId || !UUID.test(clientId)) return apiError("clientId must be a UUID", "INVALID_INPUT", 422);
  const { data, error } = await createAdminClient()
    .from("client_services")
    .select("id,active,frequency,service:services(code,name)")
    .eq("client_id", clientId)
    .order("id", { ascending: true });
  if (error) return apiError("Unable to load client services", "BILLING_READ_FAILED", 500);
  return NextResponse.json({ items: (data || []).map((row: Row) => {
    const service = Array.isArray(row.service) ? row.service[0] : row.service;
    return { id: row.id, active: row.active, frequency: row.frequency, serviceCode: service?.code ?? null, serviceName: service?.name ?? null };
  }) }, { headers: { "Cache-Control": "no-store" } });
}
async function presentationGet() {
  const access = await requireBillingAction("billing.view");
  if (access.response) return access.response;
  const { data, error } = await createAdminClient().from("billing_presentation_settings")
    .select("firm_name,tagline,invoice_footer,updated_at").eq("singleton", true).maybeSingle();
  if (error) return apiError("Unable to load invoice presentation settings", "BILLING_READ_FAILED", 500);
  if (!data) return apiError("Invoice presentation settings are not initialized", "BILLING_READ_FAILED", 500);
  return NextResponse.json({ firmName: data.firm_name, tagline: data.tagline, invoiceFooter: data.invoice_footer, invoiceNumberPrefix: "TAP", updatedAt: data.updated_at }, { headers: { "Cache-Control": "no-store" } });
}
async function presentationPatch(request: NextRequest) {
  const access = await requireBillingPowerUser();
  if (access.response || !access.identity) return access.response;
  const body = await readObjectBody(request);
  if (!body) return apiError("Invalid JSON body", "INVALID_JSON", 400);
  const allowed = new Set(["firmName", "tagline", "invoiceFooter", "reason"]);
  if (Object.keys(body).some((key) => !allowed.has(key))) return apiError("Unsupported presentation setting", "INVALID_INPUT", 422);
  const firmName = typeof body.firmName === "string" ? body.firmName.trim() : "";
  const tagline = body.tagline === null ? null : typeof body.tagline === "string" ? body.tagline.trim() : undefined;
  const invoiceFooter = body.invoiceFooter === null ? null : typeof body.invoiceFooter === "string" ? body.invoiceFooter.trim() : undefined;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!firmName || firmName.length > 160 || tagline === undefined || (tagline !== null && tagline.length > 500) || invoiceFooter === undefined || (invoiceFooter !== null && invoiceFooter.length > 500) || !reason || reason.length > 1000) {
    return apiError("firmName, optional tagline/footer, and reason must meet the documented length limits", "INVALID_INPUT", 422);
  }
  const { data, error } = await createAdminClient().from("billing_presentation_settings").update({
    firm_name: firmName, tagline: tagline ?? null, invoice_footer: invoiceFooter ?? null,
    updated_by: access.identity.id, updated_at: new Date().toISOString(), reason,
  }).eq("singleton", true).select("firm_name,tagline,invoice_footer,updated_at").maybeSingle();
  if (error) return apiError("Unable to save invoice presentation settings", "BILLING_WRITE_FAILED", 500);
  if (!data) return apiError("Invoice presentation settings are not initialized", "BILLING_WRITE_FAILED", 500);
  return NextResponse.json({ firmName: data.firm_name, tagline: data.tagline, invoiceFooter: data.invoice_footer, invoiceNumberPrefix: "TAP", updatedAt: data.updated_at }, { headers: { "Cache-Control": "no-store" } });
}
async function clientSummaryGet(request: NextRequest) {
  const pricing = await requireBillingAction("pricing.view");
  if (pricing.response) return pricing.response;
  const candidates = await requireBillingAction("candidates.view");
  if (candidates.response) return candidates.response;
  const clientId = request.nextUrl.searchParams.get("clientId");
  if (!clientId || !UUID.test(clientId)) return apiError("clientId must be a UUID", "INVALID_INPUT", 422);
  const db = createAdminClient(), today = firmDateISO();
  const [{ data: client, error: clientError }, { data: serviceRows, error: serviceError }, { data: termSettings, error: termsError }, { data: termRows, error: termRowsError }, { data: bundleRows, error: bundleError }] = await Promise.all([
    db.from("clients").select("id,name").eq("id", clientId).maybeSingle(),
    db.from("client_services").select("id,active,frequency,financials_month,service:services(code,name)").eq("client_id", clientId).eq("active", true).order("id"),
    db.from("billing_terms_settings").select("default_net_days").eq("singleton", true).maybeSingle(),
    db.from("billing_terms_overrides").select("id,client_service_id,net_days,effective_from,effective_to").eq("client_id", clientId).lte("effective_from", today).or(`effective_to.is.null,effective_to.gte.${today}`).order("effective_from", { ascending: false }),
    db.from("billing_bundles").select("id,name,unit_amount,effective_from,effective_to,billing_bundle_components(client_service_id)").eq("client_id", clientId).eq("active", true).lte("effective_from", today).or(`effective_to.is.null,effective_to.gte.${today}`).order("effective_from", { ascending: false }),
  ]);
  if (clientError) return apiError("Unable to load client summary", "BILLING_READ_FAILED", 500);
  if (!client) return apiError("Client not found", "NOT_FOUND", 404);
  if (serviceError || termsError || termRowsError || bundleError) return apiError("Unable to load client summary", "BILLING_READ_FAILED", 500);
  const services: Row[] = [];
  for (const row of serviceRows || []) {
    const service = Array.isArray(row.service) ? row.service[0] : row.service;
    if (!service?.code || !service?.name) continue;
    const { data: resolved, error } = await db.rpc("resolve_billing_price", { p_client_service_id: row.id, p_client_id: clientId, p_service_code: service.code, p_unit: "service", p_on: today });
    if (error) return apiError("Unable to resolve client price", "PRICING_READ_FAILED", 500);
    const price = Array.isArray(resolved) ? resolved[0] : resolved;
    services.push({ clientServiceId: row.id, serviceCode: service.code, serviceName: service.name, active: row.active, frequency: row.frequency, priceState: price?.unit_amount == null ? "unpriced" : "priced", unitAmount: price?.unit_amount == null ? null : moneyString(price.unit_amount), bundleName: null });
  }
  type ClientSummaryBundle = Row & { id: string; name: string; unit_amount: string | number; componentIds: string[] };
  const bundles: ClientSummaryBundle[] = (bundleRows || []).map((row: Row) => ({
    ...row,
    componentIds: (row.billing_bundle_components || []).map((component: Row) => String(component.client_service_id)),
  }));
  const bundledServiceIds = new Set<string>();
  let monthlyCents = 0n;
  let monthlyAmountComplete = true;
  let unpricedServiceCount = 0;
  for (const bundle of bundles) {
    const components = bundle.componentIds.filter((id: string) => services.some((service) => service.clientServiceId === id));
    if (!components.length) continue;
    const componentRows = components.map((id: string) => serviceRows?.find((row: Row) => row.id === id)).filter(Boolean);
    const frequencies = [...new Set(componentRows.map((row: Row) => occurrencesPerYear(row.frequency)))];
    const priceCents = moneyToCents(bundle.unit_amount);
    const occurrences = frequencies[0];
    if (frequencies.length === 1 && occurrences !== null && priceCents !== null) monthlyCents += averageMonthlyCents(priceCents, occurrences);
    else monthlyAmountComplete = false;
    for (const id of components) {
      bundledServiceIds.add(id);
      const item = services.find((service) => service.clientServiceId === id);
      if (item) item.bundleName = bundle.name;
    }
  }
  for (const service of services) {
    if (bundledServiceIds.has(service.clientServiceId)) continue;
    const occurrences = occurrencesPerYear(service.frequency), cents = moneyToCents(service.unitAmount);
    if (cents === null) { monthlyAmountComplete = false; unpricedServiceCount++; }
    if (occurrences === null) monthlyAmountComplete = false;
    else if (cents !== null) monthlyCents += averageMonthlyCents(cents, occurrences);
  }
  const overrides = termRows || [];
  const clientOverride = overrides.find((row: Row) => row.client_service_id == null);
  const termsByClientService = services.map((service) => {
    const override = overrides.find((row: Row) => row.client_service_id === service.clientServiceId) || clientOverride;
    return { clientServiceId: service.clientServiceId, netDays: override?.net_days ?? termSettings?.default_net_days ?? 15, source: override?.client_service_id ? "client_service" : override ? "client" : "firm_default" };
  });
  const { data: receivables, error: receivablesError } = await db.rpc("get_billing_receivables", { p_client_id: clientId });
  if (receivablesError) return apiError("Unable to load client receivables", "BILLING_READ_FAILED", 500);
  const aging = (receivables?.client_aging || []).find((row: Row) => row.client_id === clientId);
  const openCents = [aging?.current, aging?.["1_30"], aging?.["31_60"], aging?.["61_90"], aging?.["90_plus"]].reduce((sum: bigint, amount: unknown) => sum + (moneyToCents(amount) ?? 0n), 0n);
  const pastDueCents = [aging?.["1_30"], aging?.["31_60"], aging?.["61_90"], aging?.["90_plus"]].reduce((sum: bigint, amount: unknown) => sum + (moneyToCents(amount) ?? 0n), 0n);
  const end = new Date(`${today}T00:00:00.000Z`); end.setUTCDate(end.getUTCDate() + 364);
  const projection = await generateFromOperations(db, "", { from: today, to: end.toISOString().slice(0, 10), clientId, preview: true });
  if (projection.error) return projection.error;
  const { data: existing, error: candidatesError } = await db.from("billing_candidates").select("candidate_date").eq("client_id", clientId).in("state", ["open", "unpriced"]).gte("candidate_date", today).lte("candidate_date", end.toISOString().slice(0, 10)).order("candidate_date").limit(1000);
  if (candidatesError) return apiError("Unable to load next invoice date", "BILLING_READ_FAILED", 500);
  const dates = [...(existing || []).map((row: Row) => row.candidate_date), ...(projection.result?.items || []).map((row: Row) => row.candidateDate)].filter((date) => isDateOnly(date)).sort();
  return NextResponse.json({
    clientId, clientName: client.name, services, terms: { defaultNetDays: termSettings?.default_net_days ?? 15, byClientService: termsByClientService },
    monthlyAmount: centsToMoney(monthlyCents), monthlyAmountComplete, unpricedServiceCount, nextInvoiceDate: dates[0] || null,
    openBalance: centsToMoney(openCents), pastDueAmount: centsToMoney(pastDueCents),
  }, { headers: { "Cache-Control": "no-store" } });
}
async function firmScheduleGet(request: NextRequest) {
  const candidates = await requireBillingAction("candidates.view");
  if (candidates.response) return candidates.response;
  const pricing = await requireBillingAction("pricing.view");
  if (pricing.response) return pricing.response;
  const query = request.nextUrl.searchParams, from = query.get("from"), to = query.get("to");
  if (!isDateOnly(from) || !isDateOnly(to) || from > to) return apiError("A valid from/to date window is required", "GENERATION_WINDOW_INVALID", 422);
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;
  if (days > 364) return apiError("Schedule window cannot exceed 365 days", "GENERATION_WINDOW_INVALID", 422);
  const limit = boundedLimit(query.get("limit"));
  if (!limit) return apiError("limit must be between 1 and 100", "INVALID_INPUT", 422);
  let cursor: Row | null = null;
  try {
    cursor = cursorDecode<Row>(query.get("cursor"));
    if (query.get("cursor") && (!cursor || !isDateOnly(cursor.candidateDate) || typeof cursor.clientName !== "string" || cursor.clientName.length > 200 || typeof cursor.clientServiceId !== "string" || !UUID.test(cursor.clientServiceId) || typeof cursor.sourceIdentity !== "string" || cursor.sourceIdentity.length > 200)) throw new Error("INVALID_CURSOR");
  } catch { return apiError("Cursor is invalid for this list", "INVALID_CURSOR", 422); }
  const { data, error } = await createAdminClient().rpc("project_billing_firm_schedule", {
    p_from: from, p_to: to, p_limit: limit,
    p_after_date: cursor?.candidateDate ?? null, p_after_client: cursor?.clientName ?? null,
    p_after_service: cursor?.clientServiceId ?? null, p_after_identity: cursor?.sourceIdentity ?? null,
  });
  if (error || !data || !Array.isArray(data.items) || !data.summary) return apiError("Unable to load firm schedule", "BILLING_READ_FAILED", 500);
  const items = data.items as Row[];
  const nextCursor = data.hasMore && items.length ? cursorEncode({ candidateDate: items.at(-1)!.candidateDate, clientName: items.at(-1)!.clientName, clientServiceId: items.at(-1)!.clientServiceId, sourceIdentity: items.at(-1)!.sourceIdentity }) : null;
  return NextResponse.json({ items, nextCursor, summary: data.summary }, { headers: { "Cache-Control": "no-store" } });
}
async function listResource(request: NextRequest, path: string[]) {
  const db=createAdminClient(), q=request.nextUrl.searchParams, limit=boundedLimit(q.get("limit"));
  if (!limit) return apiError("limit must be between 1 and 100","INVALID_INPUT",422);
  const table=TABLES[path[0]];
  let query: DynamicQuery;
  if (path[0]==="client-pricing") {
    const clientId=q.get("clientId"); if(!clientId||!UUID.test(clientId)) return apiError("clientId must be a UUID","INVALID_INPUT",422);
    if(q.get("clientServiceId")&&!UUID.test(q.get("clientServiceId")!))return apiError("clientServiceId must be a UUID","INVALID_INPUT",422);
    const [overrides,bundles]=await Promise.all([
      db.from("billing_client_service_overrides").select("*,client_services!inner(client_id)").order("effective_from",{ascending:false}),
      db.from("billing_bundles").select("*,billing_bundle_components(client_service_id)").eq("client_id",clientId).order("name").order("id")
    ]);
    if(overrides.error||bundles.error) return apiError("Unable to load client pricing","PRICING_READ_FAILED",500);
    const selected=(overrides.data||[]).filter((row:Row)=>row.client_services?.client_id===clientId&&(q.get("clientServiceId") ? row.client_service_id===q.get("clientServiceId") : true)).map((row:Row)=>{const copy={...row};delete copy.client_services;return copy;});
    return NextResponse.json({clientId,overrides:toCamel(selected),bundles:(bundles.data||[]).map(toPhase2Bundle)},{headers:{"Cache-Control":"no-store"}});
  }
  if(path[0]==="settings"&&path[1]==="terms") {
    const [settings,overrides]=await Promise.all([db.from("billing_terms_settings").select("default_net_days,billing_day,timezone,updated_at").eq("singleton",true).single(),db.from("billing_terms_overrides").select("*").order("effective_from",{ascending:false})]);
    if(settings.error||overrides.error) return apiError("Unable to load terms settings","SETTINGS_READ_FAILED",500);
    return NextResponse.json({...toCamel(settings.data) as Row,overrides:toCamel(overrides.data||[])},{headers:{"Cache-Control":"no-store"}});
  }
  if(path[0]==="settings"&&path[1]==="remittance") {
    const {data,error}=await db.from("billing_remittance_settings").select("payee_name,address,instructions,updated_at").eq("singleton",true).single();
    if(error) return apiError("Unable to load remittance settings","SETTINGS_READ_FAILED",500);
    const {updated_at,...remittance}=data; return NextResponse.json({remittance:toCamel(remittance),updatedAt:updated_at},{headers:{"Cache-Control":"no-store"}});
  }
  if(path[0]==="candidates"&&path[1]==="schedule") {
    const from=q.get("from"),to=q.get("to");
    if(!isDateOnly(from)||!isDateOnly(to)||from>to)return apiError("A valid from/to window is required","GENERATION_WINDOW_INVALID",422);
    const clientId=q.get("clientId"),clientServiceId=q.get("clientServiceId");
    if((clientId&&!UUID.test(clientId))||(clientServiceId&&!UUID.test(clientServiceId))||(!clientId&&!clientServiceId))return apiError("A valid clientId or clientServiceId scope is required","INVALID_INPUT",422);
    const maxDays=(Date.parse(`${to}T00:00:00Z`)-Date.parse(`${from}T00:00:00Z`))/86400000;
    if(maxDays>364)return apiError("Schedule window cannot exceed 365 days","GENERATION_WINDOW_INVALID",422);
    const clientServiceIds = clientServiceId ? [clientServiceId] : [];
    const projected = await generateFromOperations(createAdminClient(), "", { from, to, clientServiceIds, clientId, preview: true });
    return projected.error || NextResponse.json(projected.result, { headers: { "Cache-Control": "no-store" } });
  }
  if(path[0]==="rate-cards"&&path.length===2) {
    const [card,entries]=await Promise.all([db.from("billing_rate_cards").select("*").eq("id",path[1]).maybeSingle(),db.from("billing_rate_card_entries").select("*").eq("rate_card_id",path[1]).order("service_code").order("unit").order("effective_from")]);
    if(card.error||entries.error)return apiError("Unable to load rate card","BILLING_READ_FAILED",500);
    if(!card.data)return apiError("Rate card not found","NOT_FOUND",404);
    return NextResponse.json({rateCard:toCamel(card.data),entries:toCamel(entries.data||[])},{headers:{"Cache-Control":"no-store"}});
  }
  if(path[0]==="bundles"&&path.length===2) {
    const {data,error}=await db.from("billing_bundles").select("*,billing_bundle_components(client_service_id)").eq("id",path[1]).maybeSingle();
    if(error)return apiError("Unable to load bundle","BILLING_READ_FAILED",500);
    if(!data)return apiError("Bundle not found","NOT_FOUND",404);
    return NextResponse.json({bundle:toPhase2Bundle(data)},{headers:{"Cache-Control":"no-store"}});
  }
  if(path[0]==="completion-source-maps") {
    let maps=db.from("billing_completion_source_maps").select("*").order("effective_from",{ascending:false}).order("id");
    if(q.get("clientServiceId"))maps=maps.eq("client_service_id",q.get("clientServiceId"));
    if(q.get("includeEnded")!=="true")maps=maps.or(`effective_to.is.null,effective_to.gte.${firmDateISO()}`);
    const {data,error}=await maps;
    if(error)return apiError("Unable to load completion maps","BILLING_READ_FAILED",500);
    return NextResponse.json({items:toCamel(data||[])},{headers:{"Cache-Control":"no-store"}});
  }
  if(path[0]==="client-pricing") return apiError("Not found","NOT_FOUND",404);
  if(!table) return apiError("Not found","NOT_FOUND",404);
  query=db.from(table).select(path[0]==="bundles"?"*,billing_bundle_components(client_service_id)":"*");
  if(path[0]==="candidates") {
    if(q.get("state")&&!['unpriced','open','drafted','invoiced','dismissed'].includes(q.get("state")!))return apiError("Invalid candidate state","INVALID_INPUT",422);
    if(q.get("clientId")&&!UUID.test(q.get("clientId")!))return apiError("clientId must be a UUID","INVALID_INPUT",422);
    for(const field of ["clientId","state"]) if(q.get(field)) query=query.eq(field==="clientId"?"client_id":"state",q.get(field));
    for(const [param,col] of [["from","candidate_date"],["to","candidate_date"]]) if(q.get(param)) { if(!isDateOnly(q.get(param))) return apiError("Invalid date filter","INVALID_INPUT",422); query=query[param==="from"?"gte":"lte"](col,q.get(param)); }
    query=query.order("candidate_date",{ascending:false}).order("id",{ascending:false});
  } else {
    if(q.get("active")) query=query.eq("active",q.get("active")==="true");
    if(path[0]==="bundles"&&q.get("clientId")) {
      if(!UUID.test(q.get("clientId")!)) return apiError("clientId must be a UUID","INVALID_INPUT",422);
      query=query.eq("client_id",q.get("clientId"));
    }
    query=query.order("name").order("id");
  }
  let cursor:Row|null=null; try { cursor=cursorDecode<Row>(q.get("cursor")); if(q.get("cursor")&&!cursor) throw new Error(); query=cursorFilter(query,table,cursor); } catch { return apiError("Cursor is invalid for this list","INVALID_CURSOR",422); }
  const {data,error}=await query.limit(limit+1);
  if(error) return apiError("Unable to load Billing records","BILLING_READ_FAILED",500);
  const rows=data||[], hasMore=rows.length>limit, page=rows.slice(0,limit), last=page.at(-1);
  const nextCursor=hasMore&&last?cursorEncode(path[0]==="candidates"?{candidateDate:last.candidate_date,id:last.id}:{name:last.name,id:last.id}):null;
  return NextResponse.json({items:path[0]==="candidates"?page.map(toPhase2Candidate):path[0]==="bundles"?page.map(toPhase2Bundle):toCamel(page),nextCursor},{headers:{"Cache-Control":"no-store"}});
}
async function mutate(request: NextRequest,path:string[],method:string) {
  const db=createAdminClient(); let body:Row={};
  if(method!=="DELETE") try {const parsed:unknown=await request.json();if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))return apiError("Invalid JSON body","INVALID_JSON",400);body=parsed as Row;} catch {return apiError("Invalid JSON body","INVALID_JSON",400);}
  const resource=path[0], id=path[1], actor=(await authorized(path,method)).identity?.id;
  if(!actor) return apiError("Forbidden","FORBIDDEN",403);
  const reason=cleanReason(body);
  if(resource!=="candidates"&&method!=="GET"&&!reason) return apiError("A non-empty reason is required","INVALID_INPUT",422);
  const insert=(table:string,row:Row)=>db.from(table).insert({...row,created_by:actor,updated_by:actor,reason}).select("*").single();
  const update=(table:string,values:Row)=>db.from(table).update({...values,updated_by:actor,updated_at:new Date().toISOString(),reason}).eq("id",id).select("*").single();
  let result: DynamicQuery;
  if(resource==="rate-cards") {
    if(path.length===1&&method==="POST") {if(typeof body.name!=="string"||!body.name.trim()||!isDateOnly(body.effectiveFrom)) return apiError("name and effectiveFrom are required","INVALID_INPUT",422); result=await insert("billing_rate_cards",{name:body.name.trim(),currency:"USD",active:true,effective_from:body.effectiveFrom,effective_to:null});}
    else if(path.length===2&&method==="PATCH") {if((body.name!==undefined&&typeof body.name!=="string")||(body.active!==undefined&&typeof body.active!=="boolean")||Object.keys(body).some((key)=>!["name","active","reason"].includes(key)))return apiError("Invalid rate-card update","INVALID_INPUT",422);const values:Row={};if(body.name!==undefined)values.name=body.name;if(body.active!==undefined)values.active=body.active;result=await update("billing_rate_cards",values);}
    else if(path[2]==="entries"&&method==="POST") {if(!body.serviceCode||!body.unit||!MONEY.test(String(body.unitAmount))||!isDateOnly(body.effectiveFrom)||(body.effectiveTo!==undefined&&!isDateOnly(body.effectiveTo)))return apiError("Invalid rate entry","INVALID_INPUT",422);result=await insert("billing_rate_card_entries",{rate_card_id:id,service_code:body.serviceCode,unit:body.unit,unit_amount:body.unitAmount,effective_from:body.effectiveFrom,effective_to:body.effectiveTo??null});}
    else if(path[2]==="entries"&&method==="PATCH") {if((body.unitAmount!==undefined&&!MONEY.test(String(body.unitAmount)))||(body.effectiveTo!==undefined&&!isDateOnly(body.effectiveTo))||(body.unitAmount===undefined&&body.effectiveTo===undefined))return apiError("No valid rate update supplied","INVALID_INPUT",422);result=await db.from("billing_rate_card_entries").update({...(body.unitAmount!==undefined?{unit_amount:body.unitAmount}:{}),...(body.effectiveTo!==undefined?{effective_to:body.effectiveTo}:{}),updated_by:actor,updated_at:new Date().toISOString(),reason}).eq("id",path[3]).eq("rate_card_id",id).select("*").single();}
    else return apiError("Not found","NOT_FOUND",404);
  } else if(resource==="bundles") {
    if(path.length===1&&method==="POST") {if(!body.name||typeof body.clientId!=="string"||!UUID.test(body.clientId)||!MONEY.test(String(body.unitAmount))||!isDateOnly(body.effectiveFrom)||(body.effectiveTo!==undefined&&!isDateOnly(body.effectiveTo)))return apiError("Invalid bundle","INVALID_INPUT",422);result=await insert("billing_bundles",{name:body.name,client_id:body.clientId,unit_amount:body.unitAmount,active:true,effective_from:body.effectiveFrom,effective_to:body.effectiveTo??null});}
    else if(path.length===2&&method==="PATCH") {if((body.name!==undefined&&typeof body.name!=="string")||(body.unitAmount!==undefined&&!MONEY.test(String(body.unitAmount)))||(body.effectiveTo!==undefined&&!isDateOnly(body.effectiveTo))||(body.active!==undefined&&typeof body.active!=="boolean"))return apiError("Invalid bundle update","INVALID_INPUT",422);const values:Row={};for(const [a,b] of [["name","name"],["unitAmount","unit_amount"],["effectiveTo","effective_to"],["active","active"]])if(body[a]!==undefined)values[b]=body[a];result=await update("billing_bundles",values);}
    else if(path[2]==="components"&&method==="PUT") {if(!Array.isArray(body.components)||body.components.some((x:Row)=>typeof x?.clientServiceId!=="string"||!UUID.test(x.clientServiceId))||new Set(body.components.map((x:Row)=>x.clientServiceId)).size!==body.components.length)return apiError("components must contain unique clientServiceId UUIDs","INVALID_INPUT",422);const {error}=await db.rpc("set_billing_bundle_components",{p_bundle_id:id,p_client_service_ids:body.components.map((x:Row)=>x.clientServiceId),p_actor:actor,p_reason:reason});if(error)return dbError(error);result={bundleId:id,components:body.components};}
    else return apiError("Not found","NOT_FOUND",404);
  } else if(resource==="client-pricing") {
    if(path[1]==="overrides"&&method==="POST") {if(typeof body.clientServiceId!=="string"||!UUID.test(body.clientServiceId)||!MONEY.test(String(body.unitAmount))||!isDateOnly(body.effectiveFrom)||(body.effectiveTo!==undefined&&!isDateOnly(body.effectiveTo)))return apiError("Invalid client price override","INVALID_INPUT",422);result=await insert("billing_client_service_overrides",{client_service_id:body.clientServiceId,unit_amount:body.unitAmount,effective_from:body.effectiveFrom,effective_to:body.effectiveTo??null});}
    else if(path[1]==="overrides"&&path[2]&&method==="PATCH") {if((body.unitAmount!==undefined&&!MONEY.test(String(body.unitAmount)))||(body.effectiveTo!==undefined&&!isDateOnly(body.effectiveTo))||(body.unitAmount===undefined&&body.effectiveTo===undefined))return apiError("Invalid client price update","INVALID_INPUT",422);const v:Row={};if(body.unitAmount!==undefined)v.unit_amount=body.unitAmount;if(body.effectiveTo!==undefined)v.effective_to=body.effectiveTo;result=await db.from("billing_client_service_overrides").update({...v,updated_by:actor,updated_at:new Date().toISOString(),reason}).eq("id",path[2]).select("*").single();}
    else return apiError("Not found","NOT_FOUND",404);
  } else if(resource==="settings"&&path[1]==="terms"&&path[2]==="overrides") {
    if(method==="POST") {if(typeof body.clientId!=="string"||!UUID.test(body.clientId)||(body.clientServiceId!=null&&(typeof body.clientServiceId!=="string"||!UUID.test(body.clientServiceId)))||!Number.isInteger(body.netDays)||body.netDays<0||body.netDays>365||!isDateOnly(body.effectiveFrom)||(body.effectiveTo!==undefined&&!isDateOnly(body.effectiveTo)))return apiError("Invalid terms override","INVALID_INPUT",422);result=await insert("billing_terms_overrides",{client_id:body.clientId,client_service_id:body.clientServiceId??null,net_days:body.netDays,effective_from:body.effectiveFrom,effective_to:body.effectiveTo??null});}
    else if(method==="PATCH"&&path[3]) {if((body.netDays!==undefined&&(!Number.isInteger(body.netDays)||body.netDays<0||body.netDays>365))||(body.effectiveTo!==undefined&&!isDateOnly(body.effectiveTo))||(body.netDays===undefined&&body.effectiveTo===undefined))return apiError("Invalid terms override update","INVALID_INPUT",422);const v:Row={};if(body.netDays!==undefined)v.net_days=body.netDays;if(body.effectiveTo!==undefined)v.effective_to=body.effectiveTo;result=await db.from("billing_terms_overrides").update({...v,updated_by:actor,updated_at:new Date().toISOString(),reason}).eq("id",path[3]).select("*").single();}
    else return apiError("Not found","NOT_FOUND",404);
  } else if(resource==="settings"&&path[1]==="terms"&&method==="PATCH") {
    if(!Number.isInteger(body.defaultNetDays)||body.defaultNetDays<0||body.defaultNetDays>365||body.billingDay!=="service_period_end")return apiError("Invalid terms settings","INVALID_INPUT",422);
    result=await db.from("billing_terms_settings").update({default_net_days:body.defaultNetDays,billing_day:body.billingDay,updated_by:actor,updated_at:new Date().toISOString(),reason}).eq("singleton",true).select("*").single();
  } else if(resource==="settings"&&path[1]==="remittance"&&method==="PATCH") {
    for(const key of ["payeeName","address","instructions"])if(body[key]!==undefined&&typeof body[key]!=="string")return apiError("Remittance fields must be text","INVALID_INPUT",422);
    result=await db.from("billing_remittance_settings").update({payee_name:body.payeeName??null,address:body.address??null,instructions:body.instructions??null,updated_by:actor,updated_at:new Date().toISOString(),reason}).eq("singleton",true).select("*").single();
  } else if(resource==="completion-source-maps") {
    const allowedAdapters=["schedule","work_period_done","period_count_threshold","manual_confirmation"];
    if(method==="POST") {if(typeof body.clientServiceId!=="string"||!UUID.test(body.clientServiceId)||!allowedAdapters.includes(body.adapter)||!isDateOnly(body.effectiveFrom)||!validSourceMap(body)||!body.identityFields.length||!(["period_end","completion_date","confirmed_date"].includes(body.candidateDateRule)))return apiError("Invalid completion source map","INVALID_COMPLETION_SOURCE_MAP",422);result=await insert("billing_completion_source_maps",{client_service_id:body.clientServiceId,adapter:body.adapter,predicate:body.predicate||{},identity_fields:body.identityFields,candidate_date_rule:body.candidateDateRule,effective_from:body.effectiveFrom,effective_to:body.effectiveTo??null,enabled:true});}
    else if(method==="PATCH") {if((body.enabled!==undefined&&typeof body.enabled!=="boolean")||(body.effectiveTo!==undefined&&!isDateOnly(body.effectiveTo))||(body.enabled===undefined&&body.effectiveTo===undefined))return apiError("Invalid completion map update","INVALID_COMPLETION_SOURCE_MAP",422);const v:Row={};if(body.enabled!==undefined)v.enabled=body.enabled;if(body.effectiveTo!==undefined)v.effective_to=body.effectiveTo;result=await update("billing_completion_source_maps",v);}
    else return apiError("Not found","NOT_FOUND",404);
  } else return apiError("Not found","NOT_FOUND",404);
  if(result?.error)return dbError(result.error);
  const output=resource==="bundles"&&path.length===1&&method==="POST"
    ? {bundle:toPhase2Bundle(result?.data)}
    : mutationResponse(resource,path,result?.data??result);
  return NextResponse.json(output,{status:method==="POST"?201:200});
}
async function handler(request:NextRequest,ctx:Ctx,method:string) {
  const path=await pathParts(ctx);
  if(path.length===1&&path[0]==="permissions"&&method==="GET")return permissionGet();
  if(path.length===2&&path[0]==="permissions"&&path[1]==="policy"&&method==="GET")return policyGet();
  if(path.length===1&&path[0]==="client-services"&&method==="GET")return clientServicesGet(request);
  if(path.length===2&&path[0]==="clients"&&path[1]==="summary"&&method==="GET")return clientSummaryGet(request);
  if(path.length===2&&path[0]==="candidates"&&path[1]==="firm-schedule"&&method==="GET")return firmScheduleGet(request);
  if(path.length===2&&path[0]==="settings"&&path[1]==="presentation"&&method==="GET")return presentationGet();
  if(path.length===2&&path[0]==="settings"&&path[1]==="presentation"&&method==="PATCH")return presentationPatch(request);
  const access=await authorized(path,method);
  if(access.response)return access.response;
  let resourceId: string | undefined;
  if(path[0]==="candidates"&&path[1]&&!['generate','schedule','manual-confirmations'].includes(path[1])) resourceId=path[1];
  else if(["rate-cards","bundles","completion-source-maps"].includes(path[0])&&path[1]) resourceId=path[1];
  else if(path[0]==="client-pricing"&&path[1]==="overrides"&&method==="PATCH") resourceId=path[2];
  else if(path[0]==="settings"&&path[1]==="terms"&&path[2]==="overrides") resourceId=path[3];
  if(resourceId&&!UUID.test(resourceId))return apiError("Resource ID must be a UUID","INVALID_INPUT",422);
  if(path[0]==="rate-cards"&&path[2]==="entries"&&path[3]&&!UUID.test(path[3]))return apiError("Entry ID must be a UUID","INVALID_INPUT",422);
  if(path.length===2&&path[0]==="candidates"&&path[1]==="manual-confirmations"&&method==="POST") {
    const body=await readObjectBody(request);if(!body)return apiError("Invalid JSON body","INVALID_JSON",400);
    if(typeof body.idempotencyKey!=="string"||!UUID.test(body.idempotencyKey)||typeof body.clientServiceId!=="string"||!UUID.test(body.clientServiceId)||!isDateOnly(body.confirmedDate)||typeof body.sourceNote!=="string"||!body.sourceNote.trim()||body.sourceNote.length>2000||typeof body.reason!=="string"||!body.reason.trim()) return apiError("idempotencyKey, clientServiceId, confirmedDate, sourceNote, and reason are required","INVALID_INPUT",422);
    if(body.confirmedDate>firmDateISO())return apiError("Manual confirmations must be dated today or earlier in Houston time","CONFIRMATION_DATE_FUTURE",422);
    const db=createAdminClient(),actor=access.identity?.id;
    const {data,error}=await db.rpc("create_billing_manual_confirmation",{p_id:body.idempotencyKey,p_client_service_id:body.clientServiceId,p_confirmed_date:body.confirmedDate,p_source_note:body.sourceNote.trim(),p_reason:body.reason.trim(),p_actor:actor});
    if(error) {
      if(error.code==="P0002")return apiError("Active client service not found","NOT_FOUND",404);
      if(error.code==="22023"&&/confirmation_date_future/i.test(error.message||""))return apiError("Manual confirmations must be dated today or earlier in Houston time","CONFIRMATION_DATE_FUTURE",422);
      if(error.code==="22023")return apiError("Invalid manual confirmation","INVALID_INPUT",422);
      if(error.code==="23505")return apiError(/billing_manual_confirmation_service_date_key/i.test(`${error.message||""} ${error.details||""}`)?"A manual confirmation already exists for this client service and date":"Idempotency key was already used for different confirmation data","DUPLICATE_RESOURCE",409);
      if(/source_map_missing/i.test(error.message||""))return apiError("No active manual-confirmation rule covers this date","COMPLETION_SOURCE_MAP_REQUIRED",409);
      return apiError("Manual confirmation could not be saved","BILLING_WRITE_FAILED",500);
    }
    const {data:candidate,error:readError}=await db.from("billing_candidates").select("*").eq("id",data.candidateId).single();
    if(readError)return apiError("Manual confirmation saved but candidate could not be loaded","BILLING_READ_FAILED",500);
    return NextResponse.json({created:data.created,confirmationId:data.confirmationId,candidate:toPhase2Candidate(candidate),refresh:["candidates","receivables"]},{status:data.created?201:200,headers:{"Cache-Control":"no-store"}});
  }
  if(path.length===2&&path[0]==="permissions"&&path[1]==="policy"&&method==="PATCH") {
    const body=await readObjectBody(request);if(!body)return apiError("Invalid JSON body","INVALID_JSON",400);
    const roles=DELEGABLE_BILLING_ROLES;
    const fixed=new Set(["policy.manage","invoices.void","payments.reverse"]);
    if(!Array.isArray(body.policies)||body.policies.length<1||body.policies.length>14||typeof body.reason!=="string"||!body.reason.trim())return apiError("policies and a non-empty reason are required","INVALID_INPUT",422);
    const seen=new Set<string>();
    for(const policy of body.policies) {
      if(!policy||typeof policy.actionKey!=="string"||!Array.isArray(policy.allowedRoles)||typeof policy.enabled!=="boolean"||seen.has(policy.actionKey)||fixed.has(policy.actionKey)||!(["billing.view","pricing.view","pricing.manage","candidates.view","candidates.manage","invoices.draft.manage","invoices.issue","payments.record","payments.allocate","settings.terms.manage","settings.remittance.manage"].includes(policy.actionKey))||policy.allowedRoles.some((role:unknown)=>typeof role!=="string"||!roles.includes(role))||new Set(policy.allowedRoles).size!==policy.allowedRoles.length) return apiError("Policy contains an unsupported action or role","INVALID_INPUT",422);
      seen.add(policy.actionKey);
    }
    const {data,error}=await createAdminClient().rpc("set_billing_action_policies",{p_policies:body.policies.map((policy:Row)=>({actionKey:policy.actionKey,allowedRoles:policy.allowedRoles,enabled:policy.enabled})),p_actor:access.identity?.id,p_reason:body.reason.trim()});
    if(error)return dbError(error);
    return NextResponse.json({policies:toCamel(data||[]),refresh:["permissions"]},{headers:{"Cache-Control":"no-store"}});
  }
  if(path[0]==="candidates"&&path[1]==="generate"&&method==="POST") {
    const body=await readObjectBody(request);if(!body)return apiError("Invalid JSON body","INVALID_JSON",400);
    if(!isDateOnly(body?.from)||!isDateOnly(body?.to))return apiError("Valid from/to dates are required","GENERATION_WINDOW_INVALID",422);
    const days=(Date.parse(`${body.to}T00:00:00Z`)-Date.parse(`${body.from}T00:00:00Z`))/86400000;
    if(days<0||days>364)return apiError("Generation window must be within 365 days","GENERATION_WINDOW_INVALID",422);
    if(body.clientServiceIds!==undefined&&(!Array.isArray(body.clientServiceIds)||body.clientServiceIds.length===0||body.clientServiceIds.length>500||body.clientServiceIds.some((id:unknown)=>typeof id!=="string"||!UUID.test(id))))return apiError("clientServiceIds must contain 1 to 500 UUIDs","INVALID_INPUT",422);
    if(body.clientId!==undefined&&(typeof body.clientId!=="string"||!UUID.test(body.clientId)))return apiError("clientId must be a UUID","INVALID_INPUT",422);
    if(!body.clientServiceIds&&!body.clientId)return apiError("A clientServiceIds or clientId scope is required","INVALID_INPUT",422);
    const generated=await generateFromOperations(createAdminClient(),access.identity?.id||"",body);
    return generated.error||NextResponse.json(generated.result);
  }
  if(path[0]==="candidates"&&path.length===3&&method==="POST"&&["dismiss","reopen","reprice"].includes(path[2])) {
    const body=await readObjectBody(request);if(!body)return apiError("Invalid JSON body","INVALID_JSON",400);
    const reason=typeof body.reason==="string"?body.reason.trim():"";
    if(!reason)return apiError("A non-empty reason is required",path[2]==="dismiss"?"CANDIDATE_DISMISS_REASON_REQUIRED":"CANDIDATE_REOPEN_REASON_REQUIRED",422);
    const db=createAdminClient(),id=path[1];
    const {data:candidate,error:read}=await db.from("billing_candidates").select("*").eq("id",id).maybeSingle();
    if(read)return apiError("Unable to load candidate","BILLING_READ_FAILED",500);
    if(!candidate)return apiError("Candidate not found","NOT_FOUND",404);
    let state=candidate.state;
    if(path[2]==="dismiss") {if(!["open","unpriced"].includes(state))return apiError("Candidate cannot be dismissed in its current state","CANDIDATE_NOT_OPEN",409);state="dismissed";}
    if(path[2]==="reopen") {if(state!=="dismissed")return apiError("Only dismissed candidates can be reopened","CANDIDATE_NOT_OPEN",409);state=candidate.unit_amount===null?"unpriced":"open";}
    if(path[2]==="reprice") {
      if(!["open","unpriced"].includes(state))return apiError("Only open or unpriced candidates can be repriced; reopen a dismissed candidate first","CANDIDATE_NOT_OPEN",409);
      if(!candidate.service_code||!candidate.unit)return apiError("Candidate source metadata is incomplete","CANDIDATE_UNPRICED",409);
      const {data:price,error:priceError}=await db.rpc("resolve_billing_price",{p_client_service_id:candidate.client_service_id,p_client_id:candidate.client_id,p_service_code:candidate.service_code,p_unit:candidate.unit,p_on:candidate.candidate_date});
      if(priceError)return apiError("Unable to resolve candidate price","PRICE_RESOLUTION_FAILED",500);
      const resolved=Array.isArray(price)?price[0]:price;
      if(!resolved)return apiError("Candidate has no active price","CANDIDATE_UNPRICED",409);
      const {data,error}=await db.rpc("mutate_billing_candidate",{p_id:id,p_action:"reprice",p_expected_state:state,p_reason:reason,p_actor:access.identity?.id,p_unit_amount:resolved.unit_amount,p_price_source:resolved.price_source});
      if(error)return apiError("Candidate could not be repriced",error.code==="42501"?"FORBIDDEN":"CANDIDATE_NOT_OPEN",error.code==="42501"?403:409);
      return NextResponse.json({candidate:toPhase2Candidate(data.candidate),auditId:data.auditId});
    }
    const {data,error}=await db.rpc("mutate_billing_candidate",{p_id:id,p_action:path[2],p_expected_state:candidate.state,p_reason:reason,p_actor:access.identity?.id,p_unit_amount:null,p_price_source:null});
    if(error)return apiError("Candidate update failed",error.code==="42501"?"FORBIDDEN":"CANDIDATE_NOT_OPEN",error.code==="42501"?403:409);
    return NextResponse.json({candidate:toPhase2Candidate(data.candidate),auditId:data.auditId});
  }
  if(method==="GET")return listResource(request,path);
  return mutate(request,path,method);
}
export const GET=(request:NextRequest,ctx:Ctx)=>handler(request,ctx,"GET");
export const POST=(request:NextRequest,ctx:Ctx)=>handler(request,ctx,"POST");
export const PATCH=(request:NextRequest,ctx:Ctx)=>handler(request,ctx,"PATCH");
export const PUT=(request:NextRequest,ctx:Ctx)=>handler(request,ctx,"PUT");
