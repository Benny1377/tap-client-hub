import { NextRequest, NextResponse } from "next/server";
import { requireLedgerReadAccess } from "@/lib/billing-access";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CollectionsReceivablesResponse } from "@/lib/collections-api";
import { mergeApprovedPdfReceivables } from "@/lib/collections-import-worklist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value: string) {
  if (!DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function badRequest(message: string, code: string) {
  return NextResponse.json({ error: message, code }, { status: 422, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest) {
  const access = await requireLedgerReadAccess();
  if (access.response) return access.response;

  const params = request.nextUrl.searchParams;
  const clientId = params.get("client_id");
  const asOfDate = params.get("as_of_date");
  const rawLimit = params.get("limit");
  const rawOffset = params.get("offset");
  const limit = rawLimit === null ? 100 : Number(rawLimit);
  const offset = rawOffset === null ? 0 : Number(rawOffset);

  if (clientId && !UUID.test(clientId)) return badRequest("client_id must be a UUID", "INVALID_CLIENT_ID");
  if (asOfDate && !isValidDate(asOfDate)) {
    return badRequest("as_of_date must use YYYY-MM-DD", "INVALID_AS_OF_DATE");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) return badRequest("limit must be an integer from 1 to 200", "INVALID_LIMIT");
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000) return badRequest("offset must be a non-negative integer", "INVALID_OFFSET");

  const db = createAdminClient();
  let response: CollectionsReceivablesResponse | null = null;
  const allAccounts: CollectionsReceivablesResponse["accounts"] = [];
  for (let pageOffset = 0; ; pageOffset += 200) {
    const { data, error } = await db.rpc("get_collections_worklist", {
      p_client_id: clientId || null, p_as_of_date: asOfDate || null, p_limit: 200, p_offset: pageOffset,
    });
    if (error || !data) return NextResponse.json(
      { error: "Unable to load Collections receivables", code: "COLLECTIONS_READ_MODEL_FAILED" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
    const page = data as CollectionsReceivablesResponse;
    response ||= { ...page, accounts: [] };
    allAccounts.push(...(page.accounts || []));
    if (!page.accounts?.length || pageOffset + page.accounts.length >= Number(page.pagination?.total_accounts || 0)) break;
  }
  if (!response) return NextResponse.json({ error: "Unable to load Collections receivables", code: "COLLECTIONS_READ_MODEL_FAILED" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  response.accounts = allAccounts;
  response = await mergeApprovedPdfReceivables(db, response);
  response.pagination = { limit, offset, total_accounts: response.accounts.length };
  response.accounts = response.accounts.slice(offset, offset + limit);
  const invoices = (response.accounts || []).flatMap((account) => account.invoices || []);
  for (const invoice of invoices) {
    if (invoice.source !== "pdf_import") {
      // Billing-selected rows keep what the PDF merge attached (linked source
      // invoice, batch, discrepancy, an earlier canonical identity); only fill gaps.
      invoice.source = "billing";
      invoice.source_invoice_id ??= null;
      invoice.canonical_collection_identity ||= `billing:${invoice.invoice_id}`;
      invoice.row_key ||= `collection:${invoice.canonical_collection_identity}`;
      invoice.source_batch_id ??= null;
      invoice.source_as_of ??= null;
      invoice.discrepancy_status ||= "none";
    }
  }
  const billingInvoices = invoices.filter((invoice) => invoice.source !== "pdf_import" && invoice.invoice_id);
  const billingIds = billingInvoices.map((invoice) => invoice.invoice_id as string);
  if (billingIds.length) {
    const latest = await db.from("collection_delivery_attempts")
      .select("id,invoice_id,source_invoice_id,canonical_collection_identity,stage,status,created_at,updated_at")
      .in("canonical_collection_identity", billingInvoices.map((invoice) => invoice.canonical_collection_identity))
      .order("updated_at", { ascending: false }).order("id", { ascending: false });
    if (latest.error) {
      return NextResponse.json({ error: "Unable to load delivery summary", code: "DELIVERY_SUMMARY_READ_FAILED" }, { status: 500, headers: { "Cache-Control": "no-store" } });
    }
    const byIdentity = new Map<string, NonNullable<(typeof invoices)[number]["last_delivery"]>>();
    for (const attempt of latest.data || []) {
      if (attempt.canonical_collection_identity && !byIdentity.has(attempt.canonical_collection_identity)) byIdentity.set(attempt.canonical_collection_identity, {
        stage: attempt.stage, status: attempt.status, occurred_at: attempt.updated_at || attempt.created_at,
      });
    }
    // PDF-sourced rows already carry last_delivery from the merge.
    for (const invoice of billingInvoices) invoice.last_delivery = byIdentity.get(invoice.canonical_collection_identity) || null;
  } else {
    for (const invoice of billingInvoices) invoice.last_delivery = null;
  }
  return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
}
