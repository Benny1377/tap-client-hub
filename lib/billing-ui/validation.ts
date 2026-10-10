// Client-side checks that mirror the server's 422 rules so obvious mistakes are
// caught before a request. The server remains authoritative for every rule.

export type FieldErrors = Record<string, string>;

const MONEY = /^\d+(\.\d{1,2})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

export const PAYMENT_METHODS = ["check", "ach", "wire", "card", "cash", "other"] as const;

/** Event types a user may log directly. Holds and approvals have dedicated controls. */
export const LOGGABLE_EVENT_TYPES = [
  "note",
  "reminder_logged",
  "call_logged",
  "promise_to_pay",
  "escalation_requested",
  "formal_notice_requested",
] as const;

function blank(value: unknown) {
  return value === undefined || value === null || String(value).trim() === "";
}

export function isPositiveMoney(value: unknown) {
  const raw = String(value ?? "").trim();
  return MONEY.test(raw) && /[1-9]/.test(raw);
}

export function validateInvoiceDraft(input: { client_id?: string; invoice_number?: string; issue_date?: string; due_date?: string }): FieldErrors {
  const errors: FieldErrors = {};
  if (blank(input.client_id)) errors.client_id = "Choose a client.";
  if (blank(input.invoice_number)) errors.invoice_number = "Invoice number is required.";
  if (blank(input.issue_date)) errors.issue_date = "Issue date is required.";
  else if (!DATE.test(String(input.issue_date))) errors.issue_date = "Use the YYYY-MM-DD format.";
  if (blank(input.due_date)) errors.due_date = "Due date is required.";
  else if (!DATE.test(String(input.due_date))) errors.due_date = "Use the YYYY-MM-DD format.";
  if (!errors.issue_date && !errors.due_date && String(input.due_date) < String(input.issue_date)) {
    errors.due_date = "Due date must be on or after the issue date.";
  }
  return errors;
}

export function validateLine(input: { description?: string; quantity?: string; unit_amount?: string; period?: string }): FieldErrors {
  const errors: FieldErrors = {};
  if (blank(input.description)) errors.description = "Description is required.";
  if (!isPositiveMoney(input.quantity ?? "1")) errors.quantity = "Quantity must be a positive number with at most two decimals.";
  if (!MONEY.test(String(input.unit_amount ?? "").trim())) errors.unit_amount = "Unit amount must be a number with at most two decimals.";
  if (!blank(input.period) && !PERIOD.test(String(input.period))) errors.period = "Period must look like 2026-10.";
  return errors;
}

export function validatePayment(input: { client_id?: string; received_on?: string; amount?: string; method?: string }): FieldErrors {
  const errors: FieldErrors = {};
  if (blank(input.client_id)) errors.client_id = "Choose a client.";
  if (blank(input.received_on)) errors.received_on = "Received date is required.";
  else if (!DATE.test(String(input.received_on))) errors.received_on = "Use the YYYY-MM-DD format.";
  if (!isPositiveMoney(input.amount)) errors.amount = "Amount must be positive with at most two decimals.";
  if (!PAYMENT_METHODS.includes(String(input.method) as (typeof PAYMENT_METHODS)[number])) errors.method = "Choose a payment method.";
  return errors;
}

export function validateAllocation(input: { payment_id?: string; invoice_id?: string; amount?: string }): FieldErrors {
  const errors: FieldErrors = {};
  if (blank(input.payment_id)) errors.payment_id = "Choose a payment.";
  if (blank(input.invoice_id)) errors.invoice_id = "Choose an issued invoice.";
  if (!isPositiveMoney(input.amount)) errors.amount = "Amount must be positive with at most two decimals.";
  return errors;
}

/** `today` is the server's firm date (as_of_date); the server rejects review dates before it. */
export function validateHold(input: { client_id?: string; reason?: string; expires_on?: string }, today?: string): FieldErrors {
  const errors: FieldErrors = {};
  if (blank(input.client_id)) errors.client_id = "Choose a client.";
  if (blank(input.reason)) errors.reason = "A reason is required.";
  if (!blank(input.expires_on)) {
    if (!DATE.test(String(input.expires_on))) errors.expires_on = "Use the YYYY-MM-DD format.";
    else if (today && String(input.expires_on) < today) errors.expires_on = `The review date can't be before ${today}.`;
  }
  return errors;
}

/** Requests that move an invoice up the Collections ladder must name the invoice. */
export const INVOICE_REQUIRED_EVENT_TYPES = ["escalation_requested", "formal_notice_requested"] as const;

export function validateEvent(input: { client_id?: string; event_type?: string; invoice_id?: string }): FieldErrors {
  const errors: FieldErrors = {};
  if (blank(input.client_id)) errors.client_id = "Choose a client.";
  if (!LOGGABLE_EVENT_TYPES.includes(String(input.event_type) as (typeof LOGGABLE_EVENT_TYPES)[number])) {
    errors.event_type = "Choose an activity type.";
  } else if (INVOICE_REQUIRED_EVENT_TYPES.includes(String(input.event_type) as (typeof INVOICE_REQUIRED_EVENT_TYPES)[number]) && blank(input.invoice_id)) {
    errors.invoice_id = "Choose the invoice this request is about.";
  }
  return errors;
}

export function validateReason(reason: string | undefined): FieldErrors {
  return blank(reason) ? { reason: "A reason is required." } : {};
}

export function hasErrors(errors: FieldErrors) {
  return Object.keys(errors).length > 0;
}
