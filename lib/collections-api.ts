export type Money = string;

export type CollectionsAging = {
  current: Money;
  days_1_30: Money;
  days_31_60: Money;
  days_61_90: Money;
  days_over_90: Money;
};

export type CollectionsScoreComponent = {
  balance: Money;
  weight: "1.0" | "1.3" | "1.6" | "2.0" | "2.4";
  weighted_amount: Money;
};

export type CollectionsInvoice = {
  invoice_id: string;
  invoice_number: string;
  issue_date: string;
  due_date: string;
  invoice_total: Money;
  allocated: Money;
  balance: Money;
  days_past_due: number;
  current_stage: number;
  next_stage: number | null;
  on_hold: boolean;
  credit_review_required: boolean;
  contact_review_required: boolean;
  below_minimum: boolean;
};

export type CollectionsAccount = {
  client_id: string;
  client_name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  primary_contact_count: number;
  gross_open_balance: Money;
  unallocated_credit: Money;
  net_ar_estimate: Money;
  open_invoice_count: number;
  oldest_days_past_due: number;
  aging: CollectionsAging;
  call_priority_score: Money;
  priority_score_components: {
    "21_30": CollectionsScoreComponent;
    "31_60": CollectionsScoreComponent;
    "61_90": CollectionsScoreComponent;
    "91_180": CollectionsScoreComponent;
    over_180: CollectionsScoreComponent;
    score_zero_before_days_past_due: 21;
  };
  on_hold: boolean;
  credit_review_required: boolean;
  contact_review_required: boolean;
  largest_high_balance_invoice: Money;
  invoices: CollectionsInvoice[];
};

export type CollectionsReceivablesResponse = {
  as_of_date: string;
  currency: "USD";
  summary: {
    gross_open_balance: Money;
    unallocated_credit: Money;
    net_ar_estimate: Money;
    aging: CollectionsAging;
    open_invoice_count: number;
    owing_accounts: number;
    credit_review_accounts: number;
    chronic_accounts: number;
    oldest_days_past_due: number;
  };
  accounts: CollectionsAccount[];
  pagination: { limit: number; offset: number; total_accounts: number };
};

export type CollectionsPreviewAction = {
  client_id: string;
  client_name: string;
  /** Kept visible for internal phone follow-up when client email is unavailable. */
  contact_phone: string | null;
  invoice_id: string;
  invoice_number: string;
  balance: Money;
  days_past_due: number;
  stage: 1 | 2 | 3 | 4 | 5;
  action_type: "reminder_candidate" | "owner_escalation_review" | "formal_notice_approval_review";
  disposition: "suppressed" | "preview_only" | "approval_required";
  suppression_reasons: Array<"active_hold" | "unallocated_credit_review" | "below_minimum_balance" | "contact_review_required">;
  review_warnings: Array<"unallocated_credit_review" | "email_contact_missing" | "below_minimum_balance">;
  delivery_performed: false;
};

export type CollectionsAutomationPreviewResponse = {
  as_of_date: string;
  automation_enabled: false;
  delivery_mode: "disabled";
  actions: CollectionsPreviewAction[];
  pagination: { limit: number; offset: number; total_actions: number; has_more: boolean };
};

export type CollectionsApiErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "INVALID_JSON"
  | "INVALID_INPUT"
  | "INVALID_CLIENT_ID"
  | "INVALID_AS_OF_DATE"
  | "INVALID_LIMIT"
  | "INVALID_OFFSET"
  | "COLLECTIONS_READ_MODEL_FAILED"
  | "PREVIEW_READ_FAILED";

export type CollectionsApiError = { error: string; code: CollectionsApiErrorCode };
