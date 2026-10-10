import { NextRequest, NextResponse } from "next/server";
import { requireBillingPowerUser } from "@/lib/billing-access";
import { createAdminClient } from "@/lib/supabase/admin";

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
  on_hold: boolean;
  credit_review_required: boolean;
  invoices: WorklistInvoice[];
};

export async function POST(request: NextRequest) {
  const access = await requireBillingPowerUser();
  if (access.response) return access.response;

  let body: { as_of_date?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body", code: "INVALID_JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Request body must be a JSON object", code: "INVALID_INPUT" }, { status: 422 });
  }
  const asOfDate = body.as_of_date;
  if (asOfDate !== undefined && (typeof asOfDate !== "string" || !isValidDate(asOfDate))) {
    return NextResponse.json({ error: "as_of_date must use YYYY-MM-DD", code: "INVALID_AS_OF_DATE" }, { status: 422 });
  }

  const db = createAdminClient();
  const { data, error } = await db.rpc("get_collections_worklist", {
    p_client_id: null,
    p_as_of_date: asOfDate || null,
    p_limit: 200,
    p_offset: 0,
  });
  if (error || !data) {
    return NextResponse.json({ error: "Unable to build Collections action preview", code: "PREVIEW_READ_FAILED" }, { status: 500 });
  }

  const accounts = (Array.isArray(data.accounts) ? data.accounts : []) as WorklistAccount[];
  const actions = accounts.flatMap((account) => account.invoices.flatMap((invoice) => {
    const stage = invoice.next_stage;
    if (!stage || !invoice.balance) return [];

    const suppressionReasons: string[] = [];
    // The invoice flag already includes both account- and invoice-scoped holds.
    // The account aggregate is true when any one invoice is held and must not
    // suppress sibling invoices.
    if (invoice.on_hold) suppressionReasons.push("active_hold");
    if (invoice.credit_review_required || account.credit_review_required) suppressionReasons.push("unallocated_credit_review");
    if (invoice.contact_review_required) suppressionReasons.push("contact_review_required");
    if (invoice.below_minimum) suppressionReasons.push("below_minimum_balance");

    const actionType = stage <= 3 ? "reminder_candidate" : stage === 4 ? "owner_escalation_review" : "formal_notice_approval_review";
    return [{
      client_id: account.client_id,
      client_name: account.client_name,
      invoice_id: invoice.invoice_id,
      invoice_number: invoice.invoice_number,
      balance: invoice.balance,
      days_past_due: invoice.days_past_due,
      stage,
      action_type: actionType,
      disposition: suppressionReasons.length ? "suppressed" : stage <= 3 ? "preview_only" : "approval_required",
      suppression_reasons: suppressionReasons,
      delivery_performed: false,
    }];
  }));

  return NextResponse.json({
    as_of_date: data.as_of_date,
    automation_enabled: false,
    delivery_mode: "disabled",
    actions,
    pagination_limited: Number(data?.pagination?.total_accounts || 0) > 200,
  }, { headers: { "Cache-Control": "no-store" } });
}
