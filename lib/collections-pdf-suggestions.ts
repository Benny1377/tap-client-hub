import type { PdfTextLine } from "@/lib/collections-pdf-parser";

export const COLLECTIONS_PDF_SUGGESTION_PARSER_VERSION = "quickbooks-aging-detail-v2";

export type SuggestedInvoiceFields = {
  transaction_type: string;
  invoice_number: string;
  transaction_date: string;
  customer_name: string;
  terms: string | null;
  po_number: string | null;
  due_date: string;
  reported_aging: number;
  open_balance: string;
};

export type PdfRowSuggestion =
  | { disposition: "header" | "summary"; confidence: "high"; reason: string }
  | { disposition: "invoice"; confidence: "high"; reason: string; fields: SuggestedInvoiceFields }
  | { disposition: "unreviewed"; confidence: "low"; reason: string };

type HeaderMap = Partial<Record<keyof SuggestedInvoiceFields | "po_number", number>>;

const norm = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function headerMap(cells: string[]): HeaderMap | null {
  const labels = cells.map(norm);
  const find = (...patterns: RegExp[]) => labels.findIndex((label) => patterns.some((pattern) => pattern.test(label)));
  const map: HeaderMap = {
    transaction_type: find(/^(transaction )?type$/),
    transaction_date: find(/^(transaction )?date$/),
    invoice_number: find(/^(invoice )?(num|number|no)$/),
    customer_name: find(/^(customer|name)$/),
    terms: find(/^terms?$/),
    due_date: find(/^due date$/),
    reported_aging: find(/^aging( days)?$/),
    open_balance: find(/^open balance$/),
    po_number: find(/^(p o|po)( number| no| #)?$/),
  };
  const required: Array<keyof SuggestedInvoiceFields> = ["transaction_type", "transaction_date", "invoice_number", "customer_name", "due_date", "reported_aging", "open_balance"];
  return required.every((key) => (map[key] ?? -1) >= 0) ? map : null;
}

function dateValue(value: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(value.trim());
  if (!m) return null;
  const year = Number(m[3].length === 2 ? `20${m[3]}` : m[3]);
  const month = Number(m[1]);
  const day = Number(m[2]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year.toString().padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function amountValue(value: string): string | null {
  const trimmed = value.trim();
  const negative = /^\(.*\)$/.test(trimmed) || /^-/.test(trimmed);
  const unsigned = trimmed.replace(/^\((.*)\)$/, "$1").replace(/^-/, "").replace(/^\$/, "");
  if (!/^(\d+|\d{1,3}(,\d{3})+)(\.\d{1,2})?$/.test(unsigned)) return null;
  const amount = Number(unsigned.replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount > 9999999999.99) return null;
  return `${negative ? "-" : ""}${amount.toFixed(2)}`;
}

const read = (cells: string[], index: number | undefined) => index === undefined || index < 0 ? "" : (cells[index] || "").trim();

function customerGroupLabel(text: string): boolean {
  const value = text.trim();
  if (!value || /\b(aging|quickzoom|tap associates|page|as of|invoice|payment|total|current|over 90)\b/i.test(value)) return false;
  if (/\d{1,2}:\d{2}\s*(am|pm)|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/i.test(value)) return false;
  return /[\p{L}]/u.test(value) && !/[\d$]/.test(value);
}

function isTruncatedCustomerName(value: string): boolean {
  return /(?:\.\.\.|…)$/.test(value.trim());
}

function isKnownReportHeading(text: string): boolean {
  return /\b(?:tap associates|a\/r aging quickzoom|page\s+\d+)\b/i.test(text)
    || /^\s*\d{1,2}:\d{2}\s*(?:am|pm)\b/i.test(text)
    || /^\s*as of\s+(?:\w+\s+)?\d{1,2},?\s+\d{4}\s*$/i.test(text);
}

/** QuickBooks A/R Aging QuickZoom classifier. It uses the report's column positions and adjacent
 * customer-group labels to complete abbreviated customer names. Payment rows stay unresolved because
 * this report does not identify which invoice(s) those credits should reduce. */
export function suggestCollectionsPdfRows(lines: PdfTextLine[]): PdfRowSuggestion[] {
  let columns: HeaderMap | null = null;
  let headerPositions: number[] | null = null;
  let currentPage: number | null = null;
  let customerGroup = "";
  return lines.map((line) => {
    if (currentPage !== line.page) {
      currentPage = line.page;
      customerGroup = "";
    }
    const cells = line.cells.map((cell) => cell.trim());
    const text = norm(line.text);
    const foundHeader = headerMap(cells);
    if (foundHeader) {
      columns = foundHeader;
      headerPositions = line.cell_positions || null;
      return { disposition: "header", confidence: "high", reason: "Recognized QuickBooks detail column headings" };
    }
    if (/^(total|grand total|total open balance|report total)(\b|\s)/i.test(text)) {
      return { disposition: "summary", confidence: "high", reason: "Explicit report total label" };
    }
    if (isKnownReportHeading(line.text)) {
      return { disposition: "header", confidence: "high", reason: "Recognized page or report heading" };
    }
    if (columns && cells.length === 1) {
      const label = cells[0];
      if (customerGroupLabel(label)) {
        customerGroup = label;
        return { disposition: "header", confidence: "high", reason: "Standalone customer group heading in the recognized detail report" };
      }
    }
    if (columns) {
      const atColumn = (key: keyof SuggestedInvoiceFields) => {
        const columnIndex = columns?.[key];
        if (columnIndex === undefined || columnIndex < 0) return "";
        const positions = line.cell_positions;
        if (!headerPositions || !positions || positions.length !== cells.length || columnIndex >= headerPositions.length) return read(cells, columnIndex);
        const anchors = Object.entries(columns || {}).map(([name, index]) => ({ name, index: index as number, x: headerPositions?.[index as number] })).filter((item) => Number.isFinite(item.x)).sort((a, b) => (a.x as number) - (b.x as number));
        const current = anchors.find((item) => item.index === columnIndex);
        if (!current) return read(cells, columnIndex);
        const order = anchors.indexOf(current);
        const previous = anchors[order - 1];
        const next = anchors[order + 1];
        const lower = previous ? ((previous.x as number) + (current.x as number)) / 2 : Number.NEGATIVE_INFINITY;
        const upper = next ? ((next.x as number) + (current.x as number)) / 2 : Number.POSITIVE_INFINITY;
        const matched = cells.filter((_cell, index) => positions[index] >= lower && positions[index] < upper);
        return matched.join(" ").trim();
      };
      const type = atColumn("transaction_type");
      const kind = norm(type);
      if (/^invoice$/.test(kind)) {
        const agingText = atColumn("reported_aging").replace(/\s*(days?)$/i, "").trim();
        const agingValue = /^\d{1,4}$/.test(agingText) ? Number(agingText) : null;
        const rawCustomerName = atColumn("customer_name");
        const fields: SuggestedInvoiceFields = {
          transaction_type: type,
          transaction_date: dateValue(atColumn("transaction_date")) || "",
          invoice_number: atColumn("invoice_number"),
          customer_name: isTruncatedCustomerName(rawCustomerName) && customerGroup ? customerGroup : rawCustomerName,
          terms: atColumn("terms") || null,
          po_number: atColumn("po_number") || null,
          due_date: dateValue(atColumn("due_date")) || "",
          reported_aging: agingValue ?? -1,
          open_balance: amountValue(atColumn("open_balance")) || "",
        };
        if (fields.transaction_date && fields.invoice_number && fields.customer_name && !isTruncatedCustomerName(fields.customer_name) && fields.due_date
          && agingValue !== null && fields.open_balance) {
          return { disposition: "invoice", confidence: "high", reason: "Invoice row matches all required report columns", fields };
        }
        return { disposition: "unreviewed", confidence: "low", reason: "Invoice row has missing or ambiguous required fields" };
      }
    }
    return { disposition: "unreviewed", confidence: "low", reason: "No safe row classification" };
  });
}

export function normalizeImportedCustomerName(value: string): string {
  return norm(value).replace(/\b(llc|incorporated|inc|ltd|limited|corp|corporation)\b/g, " ").replace(/\s+/g, " ").trim();
}

export type ImportedClientMatch = { id: string; name: string; similarity: number };

function editSimilarity(left: string, right: string): number {
  if (!left || !right) return 0;
  let previous = Array.from({ length: right.length + 1 }, (_unused, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return 1 - previous[right.length] / Math.max(left.length, right.length);
}

/** Ranked name-only candidates for a reviewer to inspect; this never links an invoice or changes data. */
export function suggestImportedClientMatches(
  customerName: string,
  clients: Array<{ id: string; name: string }>,
  limit = 3,
): ImportedClientMatch[] {
  const normalized = normalizeImportedCustomerName(customerName);
  if (normalized.length < 3) return [];
  const customerTokens = new Set(normalized.split(/\s+/).filter(Boolean));
  return clients.map((client) => {
    const candidate = normalizeImportedCustomerName(client.name);
    if (candidate.length < 3) return { id: client.id, name: client.name, similarity: 0 };
    const candidateTokens = new Set(candidate.split(/\s+/).filter(Boolean));
    const overlap = [...customerTokens].filter((token) => candidateTokens.has(token)).length;
    const tokenSimilarity = (2 * overlap) / Math.max(1, customerTokens.size + candidateTokens.size);
    const characterSimilarity = editSimilarity(normalized, candidate);
    return {
      id: client.id,
      name: client.name,
      similarity: normalized === candidate ? 1 : Math.max(tokenSimilarity, characterSimilarity),
    };
  }).filter((match) => match.similarity >= 0.35)
    .sort((left, right) => right.similarity - left.similarity || left.name.localeCompare(right.name))
    .slice(0, Math.max(0, limit))
    .map((match) => ({ ...match, similarity: Math.round(match.similarity * 100) }));
}
