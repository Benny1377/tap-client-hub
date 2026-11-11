import { NextRequest, NextResponse } from "next/server";
import { requireCollectionsAccess } from "@/lib/billing-access";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const invalid = (message: string, code: string) => NextResponse.json({ error: message, code }, { status: 422, headers: NO_STORE });

type Attempt = {
  id: string; invoice_id: string | null; source_invoice_id: string | null; source: "billing" | "pdf_import";
  canonical_collection_identity: string; stage: number; status: string; reason_code: string | null;
  accepted_at: string | null; created_at: string; updated_at: string;
  invoice: { invoice_number: string } | { invoice_number: string }[] | null;
};

export async function GET(request: NextRequest) {
  const access = await requireCollectionsAccess();
  if (access.response) return access.response;
  const params = request.nextUrl.searchParams;
  const clientId = params.get("client_id");
  const limit = params.has("limit") ? Number(params.get("limit")) : 50;
  const offset = params.has("offset") ? Number(params.get("offset")) : 0;
  if (!clientId || !UUID.test(clientId)) return invalid("client_id must be a UUID", "INVALID_CLIENT_ID");
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) return invalid("limit must be an integer from 1 to 200", "INVALID_LIMIT");
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000) return invalid("offset must be a non-negative integer", "INVALID_OFFSET");

  const db = createAdminClient();
  const [{ data: rules, error: ruleError }, { data: settings, error: settingsError }] = await Promise.all([
    db.from("collection_ladder_rules").select("stage,label").in("stage", [1, 2, 3]).order("stage"),
    db.from("collection_settings").select("delivery_mode").eq("id", "default").maybeSingle(),
  ]);
  if (ruleError || settingsError) return NextResponse.json({ error: "Unable to load Collections email log", code: "DELIVERY_SUMMARY_FAILED" }, { status: 500, headers: NO_STORE });
  const attempts: Attempt[] = [];
  const events: Array<{ canonical_collection_identity: string | null; invoice_id: string | null; source_invoice_id: string | null; stage: number | null; occurred_at: string; invoice: { invoice_number: string } | { invoice_number: string }[] | null }> = [];
  let readError = false;
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.from("collection_delivery_attempts").select("id,invoice_id,source_invoice_id,source,canonical_collection_identity,stage,status,reason_code,accepted_at,created_at,updated_at,invoice:invoices(invoice_number)")
      .eq("client_id", clientId).in("stage", [1, 2, 3]).order("created_at", { ascending: false }).range(offset, offset + 999);
    if (error) { readError = true; break; }
    attempts.push(...((data || []) as Attempt[]));
    if (!data || data.length < 1000) break;
  }
  if (!readError) for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.from("collection_events").select("canonical_collection_identity,invoice_id,source_invoice_id,stage,occurred_at,invoice:invoices(invoice_number)")
      .eq("client_id", clientId).eq("event_type", "formal_notice_sent").order("occurred_at", { ascending: false }).range(offset, offset + 999);
    if (error) { readError = true; break; }
    events.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  if (readError) return NextResponse.json({ error: "Unable to load Collections email log", code: "DELIVERY_SUMMARY_FAILED" }, { status: 500, headers: NO_STORE });
  const sourceIds = Array.from(new Set([...attempts.flatMap((row) => row.source_invoice_id ? [row.source_invoice_id] : []), ...events.flatMap((row) => row.source_invoice_id ? [row.source_invoice_id] : [])]));
  const [{ data: imports, error: importError }, { data: sourceIdentities, error: identityError }] = await Promise.all([
    sourceIds.length ? db.from("collection_import_invoices").select("source_invoice_id,invoice_number,source_as_of,batch_id").in("source_invoice_id", sourceIds).order("source_as_of", { ascending: false }).order("updated_at", { ascending: false }) : { data: [], error: null },
    sourceIds.length ? db.from("collection_source_invoice_identities").select("source_invoice_id,linked_invoice_id,selected_source,canonical_collection_identity").in("source_invoice_id", sourceIds) : { data: [], error: null },
  ]);
  if (importError || identityError) return NextResponse.json({ error: "Unable to load Collections email log", code: "DELIVERY_SUMMARY_FAILED" }, { status: 500, headers: NO_STORE });
  const importById = new Map<string, NonNullable<typeof imports>[number]>();
  for (const row of imports || []) if (!importById.has(row.source_invoice_id)) importById.set(row.source_invoice_id, row);
  const labels = new Map((rules || []).map((rule) => [rule.stage, rule.label]));
  const identityDetails = new Map((sourceIdentities || []).map((row) => [row.source_invoice_id, row]));
  const byIdentity = new Map<string, { row_key: string; invoice_id: string | null; source_invoice_id: string | null; invoice_number: string; source: "billing" | "pdf_import"; accepted: Array<Record<string, unknown>>; not_accepted: Array<Record<string, unknown>>; formal_notice: { recorded_count: number; last_recorded_at: string | null } }>();
  const ensure = (identity: string, row: { invoice_id: string | null; source_invoice_id: string | null; source: "billing" | "pdf_import"; invoice_number: string }) => {
    let item = byIdentity.get(identity);
    if (!item) {
      item = { row_key: `collection:${identity}`, invoice_id: row.invoice_id, source_invoice_id: row.source_invoice_id,
        invoice_number: row.invoice_number, source: row.source, accepted: [], not_accepted: [], formal_notice: { recorded_count: 0, last_recorded_at: null } };
      byIdentity.set(identity, item);
    }
    return item;
  };
  for (const row of attempts) {
    const invoice = Array.isArray(row.invoice) ? row.invoice[0] : row.invoice;
    const imported = row.source_invoice_id ? importById.get(row.source_invoice_id) : null;
    const item = ensure(row.canonical_collection_identity, { invoice_id: row.invoice_id, source_invoice_id: row.source_invoice_id,
      source: row.source, invoice_number: invoice?.invoice_number || imported?.invoice_number || "" });
    const label = labels.get(row.stage) || `Stage ${row.stage}`;
    if (row.status === "accepted") item.accepted.push({ stage: row.stage, label, accepted_at: row.accepted_at, mode: settings?.delivery_mode || "disabled" });
    else item.not_accepted.push({ stage: row.stage, status: row.status, reason_code: row.reason_code });
  }
  for (const event of events) {
    const canonicalIdentity = event.canonical_collection_identity || (event.invoice_id ? `billing:${event.invoice_id}` : null);
    if (!canonicalIdentity) continue;
    const detail = event.source_invoice_id ? identityDetails.get(event.source_invoice_id) : null;
    const imported = event.source_invoice_id ? importById.get(event.source_invoice_id) : null;
    const invoice = Array.isArray(event.invoice) ? event.invoice[0] : event.invoice;
    const item = ensure(canonicalIdentity, { invoice_id: event.invoice_id || detail?.linked_invoice_id || null,
      source_invoice_id: event.source_invoice_id, source: detail?.selected_source || "billing", invoice_number: imported?.invoice_number || invoice?.invoice_number || "" });
    item.formal_notice.recorded_count += 1;
    if (!item.formal_notice.last_recorded_at || item.formal_notice.last_recorded_at < event.occurred_at) item.formal_notice.last_recorded_at = event.occurred_at;
  }
  const invoices = [...byIdentity.values()].sort((a, b) => a.invoice_number.localeCompare(b.invoice_number) || a.row_key.localeCompare(b.row_key));
  const stages = [1, 2, 3].map((stage) => {
    const accepted = attempts.filter((row) => row.stage === stage && row.status === "accepted");
    return { stage, label: labels.get(stage) || `Stage ${stage}`, accepted_count: accepted.length,
      last_accepted_at: accepted.map((row) => row.accepted_at).filter(Boolean).sort().at(-1) || null };
  });
  return NextResponse.json({ client_id: clientId, delivery_mode: settings?.delivery_mode || "disabled", stages,
    invoices: invoices.slice(offset, offset + limit), pagination: { limit, offset, total_invoices: invoices.length } }, { headers: NO_STORE });
}
