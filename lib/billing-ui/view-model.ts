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

/**
 * A hold is active until it is released. This matches the server, which blocks
 * approvals for any unreleased hold on the client even after its expiry date.
 */
export function activeHolds(holds: CollectionHold[], clientId?: string | null) {
  return holds.filter((hold) => !hold.released_at && (!clientId || hold.client_id === clientId));
}

export function holdExpiryPassed(hold: CollectionHold, today: string) {
  return Boolean(hold.expires_on && hold.expires_on < today);
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
export function approvalRequests(events: CollectionEvent[], holds: CollectionHold[], viewer: Viewer | null): PendingRequest[] {
  const power = viewerIsPowerUser(viewer);
  const approvedIds = new Set(events.map((event) => event.approves_event_id).filter(Boolean));
  return events.flatMap((request) => {
    const approvalType = approvalTypeFor(request.event_type);
    if (!approvalType) return [];
    let state: ApprovalState;
    if (approvedIds.has(request.id)) state = "approved";
    else if (activeHolds(holds, request.client_id).length > 0) state = "blocked_by_hold";
    else if (!power) state = "requires_owner_admin";
    else state = "can_approve";
    return [{ request, approvalType, state }];
  });
}

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
