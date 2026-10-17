export type Money = string;

export type CollectionsDeliveryStatus = "queued" | "sending" | "accepted" | "suppressed" | "needs_review" | "failed";
export type CollectionsDeliveryReasonCode =
  | "ACTIVE_HOLD" | "UNALLOCATED_CREDIT_REVIEW" | "CONTACT_REVIEW_REQUIRED" | "EMAIL_CONTACT_MISSING"
  | "BELOW_MINIMUM_BALANCE" | "RULE_DISABLED" | "APPROVAL_REQUIRED" | "ATTEMPT_ALREADY_EXISTS"
  | "DELIVERY_DISABLED" | "PROVIDER_KEY_MISSING" | "SENDER_NOT_VERIFIED" | "TEST_RECIPIENT_MISSING"
  | "SYNTHETIC_DATA_REQUIRED" | "PROVIDER_RATE_LIMITED" | "PROVIDER_TEMPORARY_FAILURE"
  | "PROVIDER_REJECTED" | "PROVIDER_OUTCOME_UNKNOWN" | "ATTEMPT_LIMIT_REACHED";
export type CollectionsDeliveryAttemptRef = {
  attempt_id: string; status: CollectionsDeliveryStatus; reason_code: CollectionsDeliveryReasonCode | null;
  retryable: boolean; updated_at: string;
};
export type CollectionsLastDelivery = { stage: 1 | 2 | 3 | 4 | 5; status: CollectionsDeliveryStatus; occurred_at: string };
export type CollectionsDeliveryAttemptSummary = {
  attempt_id: string; invoice_id: string; invoice_number: string; client_id: string; stage: 1 | 2 | 3 | 4 | 5;
  status: CollectionsDeliveryStatus; reason_code: CollectionsDeliveryReasonCode | null; reason_text: string | null;
  attempt_count: number; retryable: boolean; created_at: string; updated_at: string;
  next_attempt_at: string | null; accepted_at: string | null;
};
export type CollectionsDeliveryHistoryResponse = {
  items: CollectionsDeliveryAttemptSummary[]; pagination: { limit: number; offset: number; total: number };
};
export type CollectionsDeliveryMissingSetting =
  | "DELIVERY_DISABLED" | "AUTOMATION_PAUSED" | "PROVIDER_KEY_MISSING" | "SENDER_NOT_VERIFIED"
  | "REPLY_TO_MISSING" | "TEST_RECIPIENT_MISSING" | "ENVIRONMENT_NOT_ALLOWLISTED";
export type CollectionsDeliveryStatusResponse = {
  mode: "disabled" | "test"; automation_enabled: boolean; test_ready: boolean;
  missing: CollectionsDeliveryMissingSetting[]; test_recipient_masked: string | null;
};

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

export type CollectionsAwaitingApproval = {
  event_id: string;
  event_type: "escalation_requested" | "formal_notice_requested";
  stage: 4 | 5;
  requested_at: string;
};

export type CollectionsRule = {
  stage: number;
  label: string;
  days_past_due: number;
  automatic: boolean;
  enabled: boolean;
  subject_template: string;
  body_template: string;
};

export type CollectionsRulesResponse = {
  rules: CollectionsRule[];
  firm_timezone: string;
  settings: CollectionsRuleSettingsData;
};

export type CollectionsRuleSettingsData = {
  minimum_balance: Money;
  direct_escalation_threshold: Money;
  send_start: string;
  send_end: string;
  weekdays_only: boolean;
};

export type CollectionsRuleUpdate = Partial<Pick<CollectionsRule, "label" | "days_past_due" | "automatic" | "enabled" | "subject_template" | "body_template">> & { stage: number };

export type CollectionsSettingsUpdate = {
  timezone?: string;
  minimum_balance?: number;
  direct_escalation_threshold?: number;
  send_start?: string;
  send_end?: string;
  weekdays_only?: boolean;
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
  completed_stage: number;
  upcoming_stage: number | null;
  next_stage: number | null;
  awaiting_approval: CollectionsAwaitingApproval | null;
  on_hold: boolean;
  credit_review_required: boolean;
  contact_review_required: boolean;
  below_minimum: boolean;
  last_delivery?: CollectionsLastDelivery | null;
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
  delivery_attempt: CollectionsDeliveryAttemptRef | null;
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
