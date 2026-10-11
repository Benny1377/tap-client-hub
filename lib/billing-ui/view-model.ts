// Pure presentation rules for the Billing and Collections UI. These decide what
// to show; the server still enforces every permission and invariant, and the UI
// shows its 403/409 responses when they differ.
import { isPowerUser } from "@/lib/access-policy";
import type { ApiErrorKind } from "./api";
import type { AwaitingApproval, CollectionEvent, CollectionHold, CollectionRule, Invoice, Numeric, Receivable, Viewer } from "./types";

export type SectionState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; kind: ApiErrorKind; message: string; code?: string };

export function viewerIsPowerUser(viewer: Viewer | null) {
  return Boolean(viewer && isPowerUser(viewer.role));
}

/** Format a server money value for display without doing arithmetic on it. */
export function formatMoney(value: Numeric | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  const raw = typeof value === "number" ? value.toFixed(2) : String(value).trim();
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) return raw;
  const [, sign, whole, fraction = ""] = match;
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign ? "-" : ""}$${grouped}.${fraction.padEnd(2, "0").slice(0, 2)}`;
}

export function formatFirmDate(value: string, timezone = "America/Chicago") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return value.slice(0, 10);
  }
}

export function formatFirmDateTime(value: string, timezone = "America/Chicago") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16).replace("T", " ");
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "short",
    }).format(date);
  } catch {
    return value.slice(0, 16).replace("T", " ");
  }
}

export const EVENT_LABELS: Record<string, string> = {
  note: "Note",
  reminder_logged: "Reminder logged",
  call_logged: "Call logged",
  promise_to_pay: "Promise to pay",
  escalation_requested: "Escalation requested",
  escalated: "Escalated",
  formal_notice_requested: "Formal notice requested",
  formal_notice_approved: "Formal notice approved",
  formal_notice_sent: "Formal notice sent",
  hold_placed: "Hold placed",
  hold_released: "Hold released",
};

export const AGING_LABELS: Record<string, string> = { current: "Current", "1_30": "1–30 days", "31_60": "31–60 days", "61_90": "61–90 days", "90_plus": "90+ days" };

export const STATUS_LABELS: Record<string, string> = { draft: "Draft", issued: "Issued", void: "Void", recorded: "Recorded", reversed: "Reversed" };

export interface InvoiceActions {
  editable: boolean;
  canIssue: boolean;
  issueBlockedReason: string | null;
  canVoid: boolean;
  voidRequiresOwnerAdmin: boolean;
}

export function invoiceActions(invoice: Invoice, viewer: Viewer | null): InvoiceActions {
  const power = viewerIsPowerUser(viewer);
  const draft = invoice.status === "draft";
  const hasLines = (invoice.invoice_lines || []).length > 0;
  return {
    editable: draft,
    canIssue: draft && hasLines,
    issueBlockedReason: draft && !hasLines ? "Add at least one line before issuing." : null,
    canVoid: invoice.status === "issued" && power,
    voidRequiresOwnerAdmin: invoice.status === "issued" && !power,
  };
}

export function receivableFor(invoiceId: string, receivables: Receivable[]) {
  return receivables.find((row) => row.id === invoiceId) || null;
}

/** True when the hold's review date has passed. Matches the server's UTC date comparison. */
export function holdExpiryPassed(hold: CollectionHold, today: string) {
  return Boolean(hold.expires_on && hold.expires_on < today);
}

/** An unreleased hold whose review date has not passed. */
export function holdInForce(hold: CollectionHold, today: string) {
  return !hold.released_at && !holdExpiryPassed(hold, today);
}

/** Holds in force, optionally only those for one client. */
export function activeHolds(holds: CollectionHold[], today: string, clientId?: string | null) {
  return holds.filter((hold) => holdInForce(hold, today) && (!clientId || hold.client_id === clientId));
}

/**
 * Whether a hold blocks an escalation or formal notice for this client and invoice.
 * Mirrors the approve and request routes: a client-wide hold blocks everything for
 * the client; an invoice hold blocks only requests about that invoice.
 */
export function holdBlocks(holds: CollectionHold[], today: string, clientId: string, invoiceId: string | null) {
  return activeHolds(holds, today, clientId).some((hold) => !hold.invoice_id || hold.invoice_id === invoiceId);
}

const APPROVAL_FOR: Record<string, "escalated" | "formal_notice_approved"> = {
  escalation_requested: "escalated",
  formal_notice_requested: "formal_notice_approved",
};

export function approvalTypeFor(eventType: string) {
  return APPROVAL_FOR[eventType] || null;
}

export type ApprovalState = "approved" | "blocked_by_hold" | "requires_owner_admin" | "can_approve";

export interface PendingRequest {
  request: CollectionEvent;
  approvalType: "escalated" | "formal_notice_approved";
  state: ApprovalState;
}

/** Escalation and formal-notice requests with their approval state for this viewer. */
export function approvalRequests(events: CollectionEvent[], holds: CollectionHold[], viewer: Viewer | null, today: string): PendingRequest[] {
  const power = viewerIsPowerUser(viewer);
  const approvedIds = new Set(events.map((event) => event.approves_event_id).filter(Boolean));
  return events.flatMap((request) => {
    const approvalType = approvalTypeFor(request.event_type);
    if (!approvalType) return [];
    let state: ApprovalState;
    if (approvedIds.has(request.id)) state = "approved";
    else if (holdBlocks(holds, today, request.client_id, request.invoice_id)) state = "blocked_by_hold";
    else if (!power) state = "requires_owner_admin";
    else state = "can_approve";
    return [{ request, approvalType, state }];
  });
}

export type NoticeSendState = "requires_owner_admin" | "can_record";

export interface ApprovedNotice {
  approval: CollectionEvent;
  state: NoticeSendState;
}

/**
 * Formal-notice approvals that have no matching "notice sent" record yet.
 * Recording the send is Owner/Admin only. It records a historical fact, so a
 * hold placed afterwards does not block it (contract, 20261010140000).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for a stable call signature
export function noticesAwaitingSend(events: CollectionEvent[], holds: CollectionHold[], viewer: Viewer | null, today: string): ApprovedNotice[] {
  const power = viewerIsPowerUser(viewer);
  const sentFor = new Set(
    events
      .filter((event) => event.event_type === "formal_notice_sent")
      .map((event) => (typeof event.detail?.approval_event_id === "string" ? event.detail.approval_event_id : null))
      .filter(Boolean),
  );
  return events
    .filter((event) => event.event_type === "formal_notice_approved" && !sentFor.has(event.id))
    .map((approval) => ({ approval, state: (power ? "can_record" : "requires_owner_admin") as NoticeSendState }));
}

/** Default ladder names, used until GET /api/collections/rules has loaded. */
export const STAGE_LABELS: Record<number, string> = {
  1: "Friendly reminder",
  2: "Professional reminder",
  3: "Firm reminder",
  4: "Owner escalation",
  5: "Formal notice",
};

export type StageLabels = Record<number, string>;

/** Stage names from the configured ladder, falling back to the defaults. */
export function stageLabelsFrom(rules: CollectionRule[] | null | undefined): StageLabels {
  return { ...STAGE_LABELS, ...Object.fromEntries((rules || []).map((rule) => [rule.stage, rule.label])) };
}

export function stageLabel(stage: number | null | undefined, labels: StageLabels = STAGE_LABELS) {
  if (!stage) return "—";
  return `${stage} · ${labels[stage] || STAGE_LABELS[stage] || "Stage"}`;
}

/**
 * The next enabled ladder step that is not yet due, from the configured rules.
 * The worklist returns next_stage only when a step is due now; when it is null and
 * nothing awaits approval, this says what comes next instead of "complete".
 * Reminders logged without a stage are stored at or below the stage due that day,
 * so a rule beyond today's days past due has not been completed.
 */
export function upcomingStage(rules: CollectionRule[] | null | undefined, daysPastDue: number) {
  return (rules || [])
    .filter((rule) => rule.enabled && rule.days_past_due > daysPastDue)
    .sort((a, b) => a.days_past_due - b.days_past_due || a.stage - b.stage)[0] || null;
}

/** What the call list shows for an invoice's next step. */
export function nextStepText(
  invoice: { next_stage: number | null; upcoming_stage?: number | null; days_past_due: number; awaiting_approval?: AwaitingApproval | null },
  rules: CollectionRule[] | null | undefined,
  labels: StageLabels = STAGE_LABELS,
  firmTimezone = "America/Chicago",
) {
  if (invoice.awaiting_approval) return awaitingApprovalLabel(invoice.awaiting_approval, labels, firmTimezone);
  if (invoice.next_stage) return stageLabel(invoice.next_stage, labels);
  if (invoice.days_past_due <= 0) return "Not due yet";
  if (invoice.upcoming_stage) {
    const rule = (rules || []).find((candidate) => candidate.stage === invoice.upcoming_stage && candidate.enabled);
    return rule
      ? `Next: ${stageLabel(invoice.upcoming_stage, labels)} at ${rule.days_past_due} days`
      : `Next: ${stageLabel(invoice.upcoming_stage, labels)}`;
  }
  if (invoice.upcoming_stage === null) return "Ladder complete — follow up manually";
  const upcoming = upcomingStage(rules, invoice.days_past_due);
  return upcoming ? `Next: ${stageLabel(upcoming.stage, labels)} at ${upcoming.days_past_due} days` : "Ladder complete — follow up manually";
}

/** "Awaiting Owner/Admin approval: 4 · Owner escalation (requested 2026-10-01)". */
export function awaitingApprovalLabel(pending: AwaitingApproval, labels: StageLabels = STAGE_LABELS, firmTimezone = "America/Chicago") {
  return `Awaiting Owner/Admin approval: ${stageLabel(pending.stage, labels)} (requested ${formatFirmDate(pending.requested_at, firmTimezone)})`;
}

export const PREVIEW_REASON_LABELS: Record<string, string> = {
  active_hold: "Active hold",
  unallocated_credit_review: "Unallocated credit to review",
  below_minimum_balance: "Below minimum balance",
  contact_review_required: "Primary contact or email missing",
  email_contact_missing: "No client email on file",
};

export const DISPOSITION_LABELS: Record<string, string> = {
  suppressed: "Suppressed",
  preview_only: "Would be a reminder candidate",
  approval_required: "Needs Owner/Admin review",
};

export function errorHeadline(kind: ApiErrorKind) {
  switch (kind) {
    case "unauthorized":
      return "Your session has ended. Sign in again to continue.";
    case "forbidden":
      return "You don't have access to this. Ask an Owner or Admin to assign the module or perform the action.";
    case "not_found":
      return "That record no longer exists.";
    case "conflict":
      return "This change conflicts with the record's current state. The latest data has been reloaded.";
    case "invalid":
      return "Some of the details are not valid.";
    case "network":
      return "Could not reach TAP Hub.";
    default:
      return "Something went wrong on the server.";
  }
}

/** Plain-language headlines for the server's stable error codes. */
const CODE_HEADLINES: Record<string, string> = {
  INVOICE_NUMBER_EXISTS: "That invoice number is already in use. Choose a different number.",
  INVOICE_NOT_DRAFT: "This invoice is no longer a draft, so it can't be changed that way.",
  INVOICE_NOT_ISSUED: "Only issued invoices can be voided.",
  INVOICE_HAS_NO_LINES: "Add at least one line before issuing.",
  INVOICE_REFERENCED: "This draft has Collections history, so it can't be deleted.",
  LEDGER_CONFLICT: "That change would break the ledger's rules.",
  COLLECTIONS_CONFLICT: "Collections can't record that right now.",
  APPROVAL_CONFLICT: "That approval can't be recorded right now.",
  APPROVAL_REQUIRED: "A matching approval is required first.",
  EVENT_CONFLICT: "That Collections event has already been recorded.",
  HOLD_NOT_ACTIVE: "That hold is no longer active.",
  INVALID_AMOUNT: "Check the amount: it must be positive with at most two decimals.",
  INVALID_DATE_RANGE: "The due date must be on or after the issue date.",
};

const GENERIC_MESSAGES = new Set(["forbidden", "unauthorized"]);

/** Strip internal prefixes such as "invariant_violation:" from a server message. */
export function cleanServerMessage(message: string | undefined) {
  const raw = String(message || "").trim();
  const cleaned = raw.replace(/^(invariant_violation|conflict|not_found|invalid_input)\s*:\s*/i, "");
  // Capitalise only text we unwrapped; other messages may start with a field name.
  return cleaned !== raw && cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : cleaned;
}

/** Headline from the stable code when known, else from the HTTP kind; detail is the cleaned server text. */
export function friendlyError(kind: ApiErrorKind, code?: string, message?: string) {
  const headline = (code && CODE_HEADLINES[code]) || errorHeadline(kind);
  let detail = cleanServerMessage(message);
  if (GENERIC_MESSAGES.has(detail.toLowerCase()) || headline.toLowerCase().includes(detail.toLowerCase())) detail = "";
  return { headline, detail };
}

export function todayIso(now = new Date()) {
  return now.toISOString().slice(0, 10);
}
