// Response shapes of the Phase 1 Billing and Collections routes as implemented on
// codex/collections-phase-1-billing-ledger. Numeric columns arrive from PostgREST
// as numbers or strings; the UI only formats them and never does balance math.

export type Numeric = string | number;

export type InvoiceStatus = "draft" | "issued" | "void";

export interface InvoiceLine {
  id: string;
  invoice_id: string;
  client_service_id: string | null;
  period: string | null;
  description: string;
  quantity: Numeric;
  unit_amount: Numeric;
  amount: Numeric;
  sort_order: number;
}

export interface Invoice {
  id: string;
  client_id: string;
  invoice_number: string;
  status: InvoiceStatus;
  issue_date: string;
  due_date: string;
  memo: string | null;
  created_by: string | null;
  created_at: string;
  voided_by: string | null;
  voided_at: string | null;
  void_reason: string | null;
  invoice_lines: InvoiceLine[];
}

export interface PaymentAllocation {
  id: string;
  payment_id: string;
  invoice_id: string;
  amount: Numeric;
  created_by: string | null;
  created_at: string;
  reversed_at: string | null;
}

export type PaymentMethod = "check" | "ach" | "wire" | "card" | "cash" | "other";

export interface Payment {
  id: string;
  client_id: string;
  received_on: string;
  amount: Numeric;
  method: PaymentMethod;
  reference: string | null;
  status: "recorded" | "reversed";
  reversed_by: string | null;
  reversed_at: string | null;
  reversal_reason: string | null;
  created_by: string | null;
  payment_allocations: PaymentAllocation[];
}

/** One row of GET /api/billing/receivables. Totals are server-derived strings. */
export interface Receivable {
  id: string;
  client_id: string;
  invoice_number: string;
  status: InvoiceStatus;
  issue_date: string;
  due_date: string;
  total: string;
  allocated: string;
  balance: string;
  days_past_due: number;
  aging_bucket?: AgingBucket;
}

export type AgingBucket = "current" | "1_30" | "31_60" | "61_90" | "90_plus";

export interface CollectionHold {
  id: string;
  client_id: string;
  invoice_id: string | null;
  reason: string;
  placed_by: string | null;
  placed_at: string;
  expires_on: string | null;
  released_by: string | null;
  released_at: string | null;
}

export type CollectionEventType =
  | "note"
  | "reminder_logged"
  | "call_logged"
  | "promise_to_pay"
  | "escalation_requested"
  | "escalated"
  | "formal_notice_requested"
  | "formal_notice_approved"
  | "formal_notice_sent"
  | "hold_placed"
  | "hold_released";

export interface CollectionEvent {
  id: string;
  client_id: string;
  invoice_id: string | null;
  event_type: CollectionEventType;
  stage: string | null;
  occurred_at: string;
  actor: string | null;
  detail: Record<string, unknown> | null;
  approves_event_id: string | null;
}

export interface ClientOption {
  id: string;
  name: string;
}

export interface Viewer {
  role: string;
  modules: string[];
}
