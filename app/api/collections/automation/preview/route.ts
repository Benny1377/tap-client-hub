import { NextRequest, NextResponse } from "next/server";
import { requireBillingPowerUser } from "@/lib/billing-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { deliveryReasonText, isRetryableDelivery } from "@/lib/collections-delivery";
import type { CollectionsAutomationPreviewResponse, CollectionsDeliveryAttemptRef, CollectionsPreviewAction, CollectionsReceivablesResponse } from "@/lib/collections-api";
import { mergeApprovedPdfReceivables } from "@/lib/collections-import-worklist";

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
  invoice_id: string | null;
  source_invoice_id?: string | null;
  source?: "billing" | "pdf_import";
  row_key?: string;
  canonical_collection_identity?: string;
  source_batch_id?: string | null;
  source_as_of?: string | null;
  discrepancy_status?: "none" | "blocked" | "resolved";
  invoice_number: string;
  balance: string;
  days_past_due: number;
  completed_stage: number;
  next_stage: number | null;
  awaiting_approval: { stage: number } | null;
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
  const [{ data: ruleRows, error: rulesError }, { data: settings, error: settingsError }] = await Promise.all([
    db.from("collection_ladder_rules").select("stage, automatic, enabled"),
    db.from("collection_settings").select("direct_escalation_threshold").eq("id", "default").maybeSingle(),
  ]);
  if (rulesError || settingsError || !settings) return apiError("Unable to load Collections preview rules", "PREVIEW_RULES_READ_FAILED", 500);
  const automaticByStage = new Map((ruleRows || []).map((rule) => [rule.stage, rule.enabled && rule.automatic]));
  const directThreshold = Number(settings.direct_escalation_threshold);
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

  const merged = await mergeApprovedPdfReceivables(db, {
    as_of_date: resolvedAsOfDate,
    currency: "USD",
    summary: { gross_open_balance: "0", unallocated_credit: "0", net_ar_estimate: "0", aging: { current: "0", days_1_30: "0", days_31_60: "0", days_61_90: "0", days_over_90: "0" }, open_invoice_count: 0, owing_accounts: 0, credit_review_accounts: 0, chronic_accounts: 0, oldest_days_past_due: 0 },
    accounts: accounts as unknown as CollectionsReceivablesResponse["accounts"],
    pagination: { limit: 200, offset: 0, total_accounts: totalAccounts },
  });
  accounts.splice(0, accounts.length, ...(merged.accounts as unknown as WorklistAccount[]));

  const allActions: CollectionsPreviewAction[] = accounts.flatMap((account) => account.invoices.flatMap((invoice) => {
    const directOwnerEscalation = Number(invoice.balance) >= directThreshold
      && invoice.completed_stage < 4
      && !invoice.awaiting_approval;
    const stage = directOwnerEscalation ? 4 : invoice.next_stage;
    if (!stage || !invoice.balance) return [];

    const suppressionReasons: string[] = [];
    const reviewWarnings: string[] = [];
    if (invoice.discrepancy_status === "blocked") suppressionReasons.push("source_discrepancy_blocked");
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
    const requiresApproval = stage >= 4 || automaticByStage.get(stage) !== true;
    const canonicalIdentity = invoice.canonical_collection_identity
      || (invoice.invoice_id ? `billing:${invoice.invoice_id}` : invoice.source_invoice_id ? `pdf_import:${invoice.source_invoice_id}` : null);
    if (!canonicalIdentity) return [];
    return [{
      client_id: account.client_id,
      client_name: account.client_name,
      contact_phone: account.contact_phone,
      invoice_id: invoice.invoice_id,
      source_invoice_id: invoice.source_invoice_id || null,
      source: invoice.source || "billing",
      row_key: invoice.row_key || `collection:${canonicalIdentity}`,
      canonical_collection_identity: canonicalIdentity,
      source_batch_id: invoice.source_batch_id || null,
      source_as_of: invoice.source_as_of || null,
      discrepancy_status: invoice.discrepancy_status || "none",
      reason_code: invoice.discrepancy_status === "blocked" ? "SOURCE_DISCREPANCY_BLOCKED" : null,
      reason_text: invoice.discrepancy_status === "blocked" ? deliveryReasonText("SOURCE_DISCREPANCY_BLOCKED") : null,
      invoice_number: invoice.invoice_number,
      balance: invoice.balance,
      days_past_due: invoice.days_past_due,
      stage,
      action_type: actionType,
      disposition: suppressionReasons.length ? "suppressed" : requiresApproval ? "approval_required" : "preview_only",
      suppression_reasons: suppressionReasons,
      review_warnings: reviewWarnings,
      delivery_attempt: null,
      delivery_performed: false,
    } as CollectionsPreviewAction];
  }));
  const actions = allActions.slice(offset, offset + limit);
  if (actions.length) {
    const identities = Array.from(new Set(actions.map((action) => action.canonical_collection_identity)));
    const { data: attempts, error: attemptError } = await db.from("collection_delivery_attempts")
      .select("id,canonical_collection_identity,stage,status,reason_code,last_error_code,attempt_count,created_at,updated_at")
      .in("canonical_collection_identity", identities);
    if (attemptError) return apiError("Unable to load existing delivery attempts", "PREVIEW_DELIVERIES_READ_FAILED", 500);
    const byIdentityStage = new Map<string, { id: string; status: string; reason_code: string | null; last_error_code: string | null; attempt_count: number; created_at: string; updated_at: string }>(
      ((attempts || []) as Array<{ id: string; canonical_collection_identity: string; stage: number; status: string; reason_code: string | null; last_error_code: string | null; attempt_count: number; created_at: string; updated_at: string }>)
        .map((attempt) => [`${attempt.canonical_collection_identity}:${attempt.stage}`, attempt]),
    );
    for (const action of actions) {
      const attempt = byIdentityStage.get(`${action.canonical_collection_identity}:${action.stage}`);
      (action as CollectionsPreviewAction).delivery_attempt = attempt ? {
        attempt_id: attempt.id,
        status: attempt.status as CollectionsDeliveryAttemptRef["status"],
        reason_code: (attempt.reason_code || attempt.last_error_code || null) as CollectionsDeliveryAttemptRef["reason_code"],
        retryable: attempt.status === "failed" && isRetryableDelivery(attempt.reason_code || attempt.last_error_code, Number(attempt.attempt_count || 0), attempt.created_at),
        updated_at: attempt.updated_at,
      } : null;
    }
  } else {
    // Keep a stable shape even when this page has no actions.
  }

  const response: CollectionsAutomationPreviewResponse = {
    as_of_date: resolvedAsOfDate,
    automation_enabled: false,
    delivery_mode: "disabled",
    actions,
    pagination: { limit, offset, total_actions: allActions.length, has_more: offset + actions.length < allActions.length },
  };
  return NextResponse.json(response, { headers: NO_STORE });
}
