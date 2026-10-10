// Pure presentation rules for the Billing and Collections UI. These decide what
// to show; the server still enforces every permission and invariant, and the UI
// shows its 403/409 responses when they differ.
import { isPowerUser } from "@/lib/access-policy";
import type { ApiErrorKind } from "./api";
import type { CollectionEvent, CollectionHold, Invoice, Numeric, Receivable, Viewer } from "./types";

export type SectionState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; kind: ApiErrorKind; message: string };

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

export type NoticeSendState = "blocked_by_hold" | "requires_owner_admin" | "can_record";

export interface ApprovedNotice {
  approval: CollectionEvent;
  state: NoticeSendState;
}

/**
 * Formal-notice approvals that have no matching "notice sent" record yet.
 * Recording the send is Owner/Admin only and is refused while a hold applies.
 */
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
    .map((approval) => {
      let state: NoticeSendState;
      if (holdBlocks(holds, today, approval.client_id, approval.invoice_id)) state = "blocked_by_hold";
      else if (!power) state = "requires_owner_admin";
      else state = "can_record";
      return { approval, state };
    });
}

/** Display names for the default ladder stages (the rules API is not available yet). */
export const STAGE_LABELS: Record<number, string> = {
  1: "Friendly reminder",
  2: "Professional reminder",
  3: "Firm reminder",
  4: "Owner escalation",
  5: "Formal notice",
};

export function stageLabel(stage: number | null | undefined) {
  if (!stage) return "—";
  return `${stage} · ${STAGE_LABELS[stage] || "Stage"}`;
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

export function todayIso(now = new Date()) {
  return now.toISOString().slice(0, 10);
}
