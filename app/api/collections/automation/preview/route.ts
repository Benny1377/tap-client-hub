import { NextRequest, NextResponse } from "next/server";
import { requireBillingPowerUser } from "@/lib/billing-access";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CollectionsAutomationPreviewResponse, CollectionsPreviewAction } from "@/lib/collections-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
function isValidDate(value: string) {
  if (!DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}
type WorklistInvoice = {
  invoice_id: string;
  invoice_number: string;
  balance: string;
  days_past_due: number;
  next_stage: number | null;
  on_hold: boolean;
  credit_review_required: boolean;
  contact_review_required: boolean;
  below_minimum: boolean;
};
type WorklistAccount = {
  client_id: string;
  client_name: string;
  contact_phone: string | null;
  on_hold: boolean;
  credit_review_required: boolean;
  invoices: WorklistInvoice[];
};
type WorklistPage = { accounts?: WorklistAccount[]; as_of_date?: string; pagination?: { total_accounts?: number } };
const NO_STORE = { "Cache-Control": "no-store" };

function apiError(error: string, code: string, status: number) {
  return NextResponse.json({ error, code }, { status, headers: NO_STORE });
}

function parseBoundedInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) return null;
  return value;
}

export async function POST(request: NextRequest) {
  const access = await requireBillingPowerUser();
  if (access.response) return access.response;

  let body: { as_of_date?: unknown; limit?: unknown; offset?: unknown };
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON body", "INVALID_JSON", 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return apiError("Request body must be a JSON object", "INVALID_INPUT", 422);
  }
  const asOfDate = body.as_of_date;
  if (asOfDate !== undefined && (typeof asOfDate !== "string" || !isValidDate(asOfDate))) {
    return apiError("as_of_date must use YYYY-MM-DD", "INVALID_AS_OF_DATE", 422);
  }
  const limit = parseBoundedInteger(body.limit, 100, 1, 200);
  const offset = parseBoundedInteger(body.offset, 0, 0, 100000);
  if (limit === null) return apiError("limit must be an integer from 1 to 200", "INVALID_LIMIT", 422);
  if (offset === null) return apiError("offset must be a non-negative integer", "INVALID_OFFSET", 422);

  const db = createAdminClient();
  const accounts: WorklistAccount[] = [];
  let totalAccounts = 0;
  let resolvedAsOfDate = "";
  for (let pageOffset = 0; ; pageOffset += 200) {
    const { data, error } = await db.rpc("get_collections_worklist", {
      p_client_id: null,
      p_as_of_date: asOfDate || null,
      p_limit: 200,
      p_offset: pageOffset,
      p_sort_order: "stable",
    });
    if (error || !data) {
      return apiError("Unable to build Collections action preview", "PREVIEW_READ_FAILED", 500);
    }
    const page = data as WorklistPage;
    const rows = Array.isArray(page.accounts) ? page.accounts : [];
    accounts.push(...rows);
    totalAccounts = Number(page.pagination?.total_accounts || 0);
    resolvedAsOfDate ||= page.as_of_date || "";
    if (rows.length === 0 || pageOffset + rows.length >= totalAccounts) break;
  }

  const allActions: CollectionsPreviewAction[] = accounts.flatMap((account) => account.invoices.flatMap((invoice) => {
    const stage = invoice.next_stage;
    if (!stage || !invoice.balance) return [];

    const suppressionReasons: string[] = [];
    const reviewWarnings: string[] = [];
    // The invoice flag already includes both account- and invoice-scoped holds.
    // The account aggregate is true when any one invoice is held and must not
    // suppress sibling invoices.
    if (invoice.on_hold) suppressionReasons.push("active_hold");
    if (invoice.credit_review_required || account.credit_review_required) {
      (stage <= 3 ? suppressionReasons : reviewWarnings).push("unallocated_credit_review");
    }
    if (invoice.contact_review_required) {
      (stage <= 3 ? suppressionReasons : reviewWarnings).push(stage <= 3 ? "contact_review_required" : "email_contact_missing");
    }
    if (invoice.below_minimum) {
      (stage <= 3 ? suppressionReasons : reviewWarnings).push("below_minimum_balance");
    }

    const actionType = stage <= 3 ? "reminder_candidate" : stage === 4 ? "owner_escalation_review" : "formal_notice_approval_review";
    return [{
      client_id: account.client_id,
      client_name: account.client_name,
      contact_phone: account.contact_phone,
      invoice_id: invoice.invoice_id,
      invoice_number: invoice.invoice_number,
      balance: invoice.balance,
      days_past_due: invoice.days_past_due,
      stage,
      action_type: actionType,
      disposition: suppressionReasons.length ? "suppressed" : stage <= 3 ? "preview_only" : "approval_required",
      suppression_reasons: suppressionReasons,
      review_warnings: reviewWarnings,
      delivery_performed: false,
    } as CollectionsPreviewAction];
  }));
  const actions = allActions.slice(offset, offset + limit);

  const response: CollectionsAutomationPreviewResponse = {
    as_of_date: resolvedAsOfDate,
    automation_enabled: false,
    delivery_mode: "disabled",
    actions,
    pagination: { limit, offset, total_actions: allActions.length, has_more: offset + actions.length < allActions.length },
  };
  return NextResponse.json(response, { headers: NO_STORE });
}
