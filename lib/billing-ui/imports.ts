// Phase 4 A/R PDF intake: response shapes of /api/collections/imports and the pure
// helpers the review screen uses. The parser never infers invoice fields, so every
// value here is something a reviewer typed or picked from an extracted cell.

export type ImportReportType = "aging_detail" | "aging_summary" | "unknown";
export type ImportBatchStatus = "uploaded" | "parsing" | "needs_review" | "approved" | "rejected" | "superseded" | "failed";
export type RowDisposition = "unreviewed" | "invoice" | "summary" | "header" | "ignored" | "duplicate";
export type ClassifyDisposition = "summary" | "header" | "ignored";

export interface ImportBatch {
  id: string;
  original_filename: string;
  report_type: ImportReportType | null;
  source_as_of: string | null;
  status: ImportBatchStatus;
  uploaded_by: string;
  parsed_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  supersedes_batch_id: string | null;
  metadata?: { page_count?: number; extracted_line_count?: number; detail_cross_check?: Partial<CrossCheckResult> } | null;
  created_at: string;
  updated_at: string;
}

export interface ImportRow {
  id: string;
  source_invoice_id: string | null;
  page_number: number;
  row_number: number;
  raw_text: string;
  parsed_fields: { cells?: string[] } & Record<string, unknown>;
  duplicate_of: string | null;
  exact_duplicate: boolean;
  review_disposition: RowDisposition;
}

export interface ImportInvoice {
  id: string;
  source_invoice_id: string;
  invoice_number: string | null;
  customer_name: string;
  transaction_type: string | null;
  transaction_date: string | null;
  due_date: string | null;
  terms: string | null;
  po_number: string | null;
  reported_aging: number | null;
  open_balance: string;
  source_as_of: string;
  source_row_key: string;
  review_status: "needs_review" | "ready" | "blocked" | "approved" | "superseded" | "rejected";
  discrepancy_status: "none" | "blocked" | "resolved";
  row_data: Record<string, unknown>;
  /** Billing invoice proposed in review; applied to the identity on approval. */
  proposed_linked_invoice_id?: string | null;
  /** Client and Billing link of the stable source identity, when the server returns them. */
  identity?: { client_id: string | null; linked_invoice_id: string | null; selected_source: "billing" | "pdf_import" } | null;
}

export interface ImportBatchDetail {
  batch: ImportBatch;
  rows: ImportRow[];
  invoices: ImportInvoice[];
  revisions: Array<{ id: string; batch_id: string; source_invoice_id: string; actor: string | null; snapshot: Record<string, unknown>; created_at: string }>;
}

export interface ImportInvoiceInput {
  source_row_id: string;
  client_id: string;
  customer_name: string;
  invoice_number?: string | null;
  transaction_type?: string | null;
  transaction_date?: string | null;
  due_date?: string | null;
  terms?: string | null;
  po_number?: string | null;
  reported_aging?: number | null;
  open_balance: number;
  linked_invoice_id?: string | null;
  confirmed: true;
  row_data?: Record<string, unknown>;
}

export interface CrossCheckResult {
  detail_batch_id: string;
  source_as_of: string;
  summary_reported_total: string;
  detail_invoice_total: string;
  /** Summary minus detail. */
  difference: string;
  status: "matched" | "mismatch";
  invoice_count: number;
  note: string;
}

export interface DiscrepancyResolution {
  source_invoice_id: string;
  selected_source: "billing" | "pdf_import";
  pdf_open_balance: string | number;
  billing_open_balance: string | number | null;
  discrepancy_status: "resolved";
}

export const REPORT_TYPE_LABELS: Record<string, string> = {
  aging_detail: "A/R Aging detail",
  aging_summary: "A/R Aging summary",
  unknown: "Unrecognized layout",
};

export const BATCH_STATUS_LABELS: Record<string, string> = {
  uploaded: "Uploaded, not read yet",
  parsing: "Reading",
  needs_review: "In review",
  approved: "Approved",
  rejected: "Rejected",
  superseded: "Replaced by a newer report",
  failed: "Text could not be read",
};

export const DISPOSITION_LABELS: Record<RowDisposition, string> = {
  unreviewed: "Not reviewed",
  invoice: "Invoice",
  summary: "Total / summary",
  header: "Title or heading",
  ignored: "Ignored",
  duplicate: "Repeated line",
};

export const IMPORT_ERROR_HEADLINES: Record<string, string> = {
  IMPORT_UPLOAD_FORBIDDEN: "Your role can't upload A/R reports.",
  IMPORT_REVIEW_FORBIDDEN: "Your role can't review A/R reports.",
  IMPORT_APPROVE_FORBIDDEN: "Approving reports and choosing a balance needs approve permission (Owner/Admin by default).",
  IMPORT_SEPARATION_OF_DUTIES: "Someone who uploaded or reviewed lines in this report can't approve it. Ask another Owner/Admin.",
  IMPORT_APPROVAL_BLOCKED: "This report isn't ready to approve yet. Work through the checklist above.",
  PDF_INVALID: "That file isn't a PDF.",
  PDF_REQUIRED: "Choose a PDF report to upload.",
  PDF_SIZE_INVALID: "Reports must be under 25 MB.",
  PDF_EXTRACTION_FAILED: "The text in this PDF couldn't be read. The file is kept; nothing was imported.",
  CLIENT_LINK_REQUIRED: "Pick an existing TAP Hub client for this customer.",
  BILLING_CLIENT_MISMATCH: "That Billing invoice belongs to a different client.",
  IMPORT_INVOICE_CONFLICT: "This line or Billing link conflicts with something already reviewed.",
  IMPORT_INVOICE_INVALID_DATE: "Dates must be real calendar dates.",
  IMPORT_CROSS_CHECK_CONFLICT: "These reports can't be cross-checked yet: they need the same as-of date and reviewed invoices.",
  DISCREPANCY_RESOLUTION_BLOCKED: "This invoice can't be resolved that way (for example, it has no Billing link).",
  BATCH_STATE_CONFLICT: "This report has moved on (approved or closed), so it can't be changed.",
};

/** "$1,234.50", "(1,234.50)", "-1234.5" → 1234.5 / -1234.5. Anything else is null, never a guess. */
export function parseAmount(text: string): number | null {
  const trimmed = text.trim();
  const negative = /^\(.*\)$/.test(trimmed) || /^-/.test(trimmed);
  const unsigned = trimmed.replace(/^\((.*)\)$/, "$1").replace(/^-/, "").replace(/^\$/, "");
  // Commas only as thousands separators: "1,234.50" yes, "12,34" no.
  if (!/^(\d+|\d{1,3}(,\d{3})+)(\.\d{1,2})?$/.test(unsigned)) return null;
  const value = Number(unsigned.replace(/,/g, ""));
  return negative ? -value : value;
}

/** "08/31/2026" or "2026-08-31" → "2026-08-31" when it is a real date; otherwise null. */
export function parseReportDate(text: string): string | null {
  const trimmed = text.trim();
  let iso: string | null = null;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (us) iso = `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  else if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) iso = trimmed;
  if (!iso) return null;
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}

/** The text cells of an extracted line, falling back to splitting the joined text. */
export function rowCells(row: Pick<ImportRow, "parsed_fields" | "raw_text">): string[] {
  const cells = row.parsed_fields?.cells;
  if (Array.isArray(cells) && cells.every((cell) => typeof cell === "string")) return cells;
  return row.raw_text.split(" | ");
}

export interface ReviewProgress {
  total: number;
  invoices: number;
  classified: number;
  duplicates: number;
  unreviewed: number;
}

export function reviewProgress(rows: ImportRow[]): ReviewProgress {
  const count = (disposition: RowDisposition) => rows.filter((row) => row.review_disposition === disposition).length;
  return {
    total: rows.length,
    invoices: count("invoice"),
    classified: count("summary") + count("header") + count("ignored"),
    duplicates: count("duplicate"),
    unreviewed: count("unreviewed"),
  };
}

export interface ApprovalCheck {
  id: string;
  label: string;
  ok: boolean;
}

/**
 * The approval rules the server enforces, as a checklist the reviewer can see
 * before trying. The server stays the authority; this only explains its answer.
 */
export function approvalChecklist(detail: ImportBatchDetail, viewerId: string | null): ApprovalCheck[] {
  const { batch, rows, invoices } = detail;
  const progress = reviewProgress(rows);
  const checks: ApprovalCheck[] = [
    { id: "layout", label: "Recognized as an A/R Aging detail report", ok: batch.report_type === "aging_detail" },
    { id: "as_of", label: "The report's as-of date was read", ok: Boolean(batch.source_as_of) },
    { id: "invoices", label: "At least one invoice confirmed", ok: invoices.length > 0 },
    { id: "ready", label: "Every confirmed invoice is ready", ok: invoices.length > 0 && invoices.every((invoice) => invoice.review_status === "ready") },
    { id: "lines", label: progress.unreviewed === 0 ? "Every extracted line is classified" : `${progress.unreviewed} line${progress.unreviewed === 1 ? "" : "s"} still to classify`, ok: progress.unreviewed === 0 },
  ];
  if (viewerId) checks.push({ id: "uploader", label: "You didn't upload this report", ok: batch.uploaded_by !== viewerId });
  return checks;
}

export interface BalanceComparison {
  pdf: number;
  billing: number;
  /** PDF minus Billing, rounded to cents. */
  difference: number;
  matches: boolean;
}

export function compareBalances(pdfBalance: string | number, billingBalance: string | number): BalanceComparison {
  const pdf = Math.round(Number(pdfBalance) * 100) / 100;
  const billing = Math.round(Number(billingBalance) * 100) / 100;
  const difference = Math.round((pdf - billing) * 100) / 100;
  return { pdf, billing, difference, matches: difference === 0 };
}

/** The Billing invoice an imported row is (or will be on approval) linked to. */
export function linkedBillingInvoiceId(invoice: ImportInvoice): string | null {
  return invoice.identity?.linked_invoice_id || invoice.proposed_linked_invoice_id || null;
}

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Checks the browser can make before uploading; the server re-checks the signature. */
export function uploadProblem(file: { name: string; size: number; type: string }): string | null {
  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") return "Choose a PDF file.";
  if (file.size < 8) return "That file is empty.";
  if (file.size > MAX_UPLOAD_BYTES) return "Reports must be under 25 MB.";
  return null;
}
