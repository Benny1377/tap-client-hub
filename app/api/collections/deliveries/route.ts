import { NextRequest, NextResponse } from "next/server";
import { requireBillingPowerUser } from "@/lib/billing-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { deliveryReasonText, isRetryableDelivery } from "@/lib/collections-delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = new Set(["queued", "sending", "accepted", "suppressed", "needs_review", "failed"]);
type HistoryRow = {
  id: string; client_id: string; invoice_id: string; stage: number; status: string; reason_code: string | null;
  last_error_code: string | null; attempt_count: number; created_at: string; updated_at: string;
  next_attempt_at: string | null; accepted_at: string | null; invoice: { invoice_number: string } | { invoice_number: string }[] | null;
};
const error = (message: string, code: string) => NextResponse.json({ error: message, code }, { status: 422, headers: NO_STORE });

export async function GET(request: NextRequest) {
  const access = await requireBillingPowerUser();
  if (access.response) return access.response;
  const params = request.nextUrl.searchParams;
  const limit = params.has("limit") ? Number(params.get("limit")) : 50;
  const offset = params.has("offset") ? Number(params.get("offset")) : 0;
  const invoiceId = params.get("invoice_id");
  const status = params.get("status");
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) return error("limit must be an integer from 1 to 200", "INVALID_LIMIT");
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000) return error("offset must be a non-negative integer", "INVALID_OFFSET");
  if (invoiceId && !UUID.test(invoiceId)) return error("invoice_id must be a UUID", "INVALID_INVOICE_ID");
  if (status && !STATUSES.has(status)) return error("status is not supported", "INVALID_STATUS");

  const db = createAdminClient();
  let query = db.from("collection_delivery_attempts")
    .select("id, client_id, invoice_id, stage, status, reason_code, last_error_code, attempt_count, created_at, updated_at, next_attempt_at, accepted_at, invoice:invoices(invoice_number)", { count: "exact" })
    .order("created_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + limit - 1);
  if (invoiceId) query = query.eq("invoice_id", invoiceId);
  if (status) query = query.eq("status", status);
  const { data, error: dbError, count } = await query;
  if (dbError) return NextResponse.json({ error: "Unable to load delivery history", code: "DELIVERY_HISTORY_READ_FAILED" }, { status: 500, headers: NO_STORE });
  const items = ((data || []) as HistoryRow[]).map((row) => {
    const code = row.reason_code || row.last_error_code || null;
    const invoice = Array.isArray(row.invoice) ? row.invoice[0] : row.invoice;
    const attemptCount = Number(row.attempt_count || 0);
    return {
      attempt_id: row.id, invoice_id: row.invoice_id, invoice_number: invoice?.invoice_number || "",
      client_id: row.client_id, stage: row.stage, status: row.status, reason_code: code,
      reason_text: deliveryReasonText(code), attempt_count: attemptCount,
      retryable: row.status === "failed" && isRetryableDelivery(code, attemptCount),
      created_at: row.created_at, updated_at: row.updated_at,
      next_attempt_at: row.next_attempt_at, accepted_at: row.accepted_at,
    };
  });
  return NextResponse.json({ items, pagination: { limit, offset, total: count || 0 } }, { headers: NO_STORE });
}
