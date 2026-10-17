// Phase 3 (test-only email delivery): consumer-side types and wording.
// Shapes follow docs/contracts/collections-phase-3-integrations.md ("Engineer A
// review answers", contract 43f2ea2). Wire-shape types are shared from
// lib/collections-api.ts; this module keeps UI labels and display helpers.
import type { ApiResult } from "./api";
import type {
  CollectionsDeliveryAttemptRef,
  CollectionsDeliveryAttemptSummary,
  CollectionsDeliveryHistoryResponse,
  CollectionsDeliveryMissingSetting,
  CollectionsDeliveryReasonCode,
  CollectionsDeliveryStatus,
  CollectionsDeliveryStatusResponse,
  CollectionsLastDelivery,
} from "@/lib/collections-api";

export type DeliveryStatus = CollectionsDeliveryStatus;

export const DELIVERY_STATUSES: DeliveryStatus[] = ["queued", "sending", "accepted", "suppressed", "needs_review", "failed"];

/** Contract wording, word for word. "Accepted" never claims delivery or reading. */
export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  queued: "Waiting to send",
  sending: "Sending",
  accepted: "Accepted by email provider",
  suppressed: "Not sent",
  needs_review: "Needs review",
  failed: "Failed",
};

export const DELIVERY_STATUS_TONES: Record<DeliveryStatus, "navy" | "blue" | "green" | "grey" | "amber" | "red"> = {
  queued: "navy",
  sending: "blue",
  accepted: "green",
  suppressed: "grey",
  needs_review: "amber",
  failed: "red",
};

/** Stable reason codes and their plain wording (contract table, word for word). */
export const DELIVERY_REASON_LABELS: Record<CollectionsDeliveryReasonCode, string> = {
  ACTIVE_HOLD: "On hold; no email sent.",
  UNALLOCATED_CREDIT_REVIEW: "Credit/payment needs review.",
  CONTACT_REVIEW_REQUIRED: "Choose one primary contact with an email.",
  EMAIL_CONTACT_MISSING: "No client email is available.",
  BELOW_MINIMUM_BALANCE: "Balance is below the configured minimum.",
  RULE_DISABLED: "This reminder stage is turned off.",
  APPROVAL_REQUIRED: "Owner/Admin approval is required.",
  ATTEMPT_ALREADY_EXISTS: "This invoice stage already has an attempt.",
  DELIVERY_DISABLED: "Email delivery is disabled.",
  PROVIDER_KEY_MISSING: "Email provider is not configured.",
  SENDER_NOT_VERIFIED: "Sender address is not verified.",
  TEST_RECIPIENT_MISSING: "Test mailbox is not configured.",
  SYNTHETIC_DATA_REQUIRED: "This test send requires a synthetic fixture.",
  PROVIDER_RATE_LIMITED: "Email provider is temporarily rate-limiting requests.",
  PROVIDER_TEMPORARY_FAILURE: "Email provider temporarily failed.",
  PROVIDER_REJECTED: "Email provider rejected the request.",
  PROVIDER_OUTCOME_UNKNOWN: "Provider outcome is unknown; review before retrying.",
  ATTEMPT_LIMIT_REACHED: "Retry limit reached.",
};

/** What still blocks test mode, from GET /api/collections/delivery-status `missing`. */
export const MISSING_SETTING_LABELS: Record<CollectionsDeliveryMissingSetting, string> = {
  DELIVERY_DISABLED: "Email delivery is turned off.",
  AUTOMATION_PAUSED: "Automation is paused.",
  PROVIDER_KEY_MISSING: "Email provider is not configured.",
  SENDER_NOT_VERIFIED: "Sender address is not verified.",
  REPLY_TO_MISSING: "Reply-to address is not set.",
  TEST_RECIPIENT_MISSING: "Test mailbox is not configured.",
  ENVIRONMENT_NOT_ALLOWLISTED: "This environment is not approved for test sends.",
};

/** Route error codes from test-run / retry (Engineer B, af2a52e), in plain words. */
export const DELIVERY_ACTION_ERROR_LABELS: Record<string, string> = {
  DELIVERY_NOT_READY: "Test sends aren't ready yet. The list on the left shows what is still missing.",
  TEST_RUN_FAILED_CLOSED: "The test run stopped before sending anything because a safety check failed. Nothing was sent.",
  OUTSIDE_SEND_WINDOW: "It's outside the firm's sending hours, so nothing was queued. Try again during the send window.",
  DELIVERY_NOT_RETRYABLE: "This attempt can't be retried. Only temporary provider failures with tries left can be retried.",
  DELIVERY_RETRY_CONFLICT: "This attempt changed while you were looking. The list has been refreshed.",
  DELIVERY_ATTEMPT_NOT_FOUND: "That attempt no longer exists. The list has been refreshed.",
};

/** Replace a known route error code's server text with our wording; keep everything else. */
export function withDeliveryActionWording<T>(result: ApiResult<T>): ApiResult<T> {
  if (result.ok === false && result.code && DELIVERY_ACTION_ERROR_LABELS[result.code]) {
    return { ...result, message: DELIVERY_ACTION_ERROR_LABELS[result.code] };
  }
  return result;
}

/** One-line summary of a finished test run; never claims delivery. */
export function testRunSummary(run: DeliveryTestRunResult) {
  const parts = [
    `${run.claimed} picked up`,
    `${run.accepted} accepted by the email provider`,
    `${run.suppressed} not sent`,
    `${run.needs_review} need review`,
    `${run.failed} failed`,
  ];
  if (run.remaining > 0) parts.push(`${run.remaining} left for the next run`);
  return parts.join(" · ");
}

/** Shared producer/consumer contract types; keep route wire-shapes defined once. */
export type DeliverySetup = CollectionsDeliveryStatusResponse;
export type DeliveryAttemptSummary = CollectionsDeliveryAttemptSummary;
export type DeliveriesResponse = CollectionsDeliveryHistoryResponse;

/** POST /automation/test-run result (pinned by Engineer B in af2a52e). */
export interface DeliveryTestRunResult {
  run_id: string;
  claimed: number;
  accepted: number;
  suppressed: number;
  needs_review: number;
  failed: number;
  remaining: number;
}

export interface DeliveriesQuery {
  invoiceId?: string | null;
  status?: DeliveryStatus | null;
  limit?: number;
  offset?: number;
}

/** Worklist invoices gain a sanitized `last_delivery` (readable by every Collections reader). */
export type LastDelivery = CollectionsLastDelivery;

/** Preview items gain the invoice/stage's existing attempt, if any, so nothing looks like a second send. */
export type PreviewDeliveryAttempt = CollectionsDeliveryAttemptRef;

export function deliveryStatusLabel(status: string) {
  return DELIVERY_STATUS_LABELS[status as DeliveryStatus] || status;
}

/** Our wording for a stable code first, then the server's generated text, then the raw code. */
export function deliveryReasonLabel(code: string | null | undefined, serverText?: string | null) {
  if (code && DELIVERY_REASON_LABELS[code]) return DELIVERY_REASON_LABELS[code];
  return serverText || code || "";
}

export function missingSettingLabel(code: string) {
  return MISSING_SETTING_LABELS[code] || DELIVERY_REASON_LABELS[code] || code;
}

/**
 * True when the route itself does not exist yet (Phase 3 backend not installed):
 * a 404 without a machine-readable code. A real "record not found" carries a code.
 */
export function endpointMissing(result: ApiResult<unknown>) {
  return result.ok === false && result.kind === "not_found" && !result.code;
}

/** Attempts that already cover an invoice/stage, so the preview must not look like a new send. */
export function attemptBlocksNewSend(attempt: PreviewDeliveryAttempt | null | undefined) {
  return Boolean(attempt && ["accepted", "queued", "sending", "needs_review"].includes(attempt.status));
}
