import { NextResponse } from "next/server";
import type { BillingAction } from "@/lib/billing-access";

export const REFRESH_LEDGER = ["invoice", "candidates", "receivables"] as const;
const MONEY_KEYS = new Set(["unit_amount", "unitAmount", "amount", "total_amount", "totalAmount"]);
const PRIVATE_AUDIT_KEYS = new Set(["created_by", "updated_by", "reason"]);
function decimalString(value: unknown, scale: number) {
  if (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value)) {
    const [whole, fraction = ""] = value.split(".");
    return `${whole}.${fraction.padEnd(scale, "0").slice(0, scale)}`;
  }
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(scale) : value;
}
export function moneyString(value: unknown) { return decimalString(value, 2); }
export function apiError(error: string, code: string, status: number) {
  return NextResponse.json({ error, code }, { status, headers: { "Cache-Control": "no-store" } });
}
type JsonRecord = Record<string, unknown>;
function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}
export function toCamel(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toCamel);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !PRIVATE_AUDIT_KEYS.has(key)).map(([key, entry]) => {
    const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    return [camelKey, MONEY_KEYS.has(key) || MONEY_KEYS.has(camelKey) ? moneyString(entry) : toCamel(entry)];
  }));
}
export function toPhase2Candidate(value: unknown): JsonRecord {
  const raw = asRecord(value);
  const candidate = asRecord(toCamel(raw));
  if (typeof raw.source_adapter === "string" && typeof raw.source_identity === "string") {
    candidate.source = { adapter: raw.source_adapter, identity: raw.source_identity };
    delete candidate.sourceAdapter;
    delete candidate.sourceIdentity;
  }
  return candidate;
}
export function toPhase2Bundle(value: unknown): JsonRecord {
  const raw = asRecord(value);
  const bundle = asRecord(toCamel(raw));
  const rawComponents = Array.isArray(raw.billing_bundle_components) ? raw.billing_bundle_components : [];
  delete bundle.billingBundleComponents;
  bundle.components = rawComponents.map((component) => ({ clientServiceId: asRecord(component).client_service_id }));
  return bundle;
}
export function mutationResponse(resource: string, path: string[], value: unknown): unknown {
  const converted = toCamel(value);
  if (resource === "rate-cards") return path[2] === "entries" ? { entry: converted } : { rateCard: converted };
  if (resource === "bundles") return path[2] === "components" ? converted : { bundle: converted };
  if (resource === "client-pricing") return { override: converted };
  if (resource === "completion-source-maps") return { map: converted };
  if (resource === "settings" && path[1] === "terms" && path[2] === "overrides") return { override: converted };
  if (resource === "settings" && path[1] === "remittance") {
    const remittance = asRecord(converted);
    return {
      remittance: { payeeName: remittance.payeeName, address: remittance.address, instructions: remittance.instructions },
      updatedAt: remittance.updatedAt,
    };
  }
  return converted;
}
export function toPhase2Invoice(value: unknown): JsonRecord {
  const rawInvoice = asRecord(value);
  const invoice = asRecord(toCamel(rawInvoice));
  const rawLines = Array.isArray(rawInvoice.invoice_lines) ? rawInvoice.invoice_lines : [];
  delete invoice.invoiceLines;
  invoice.lines = rawLines.map((lineValue: unknown) => {
    const raw = asRecord(lineValue);
    const line = asRecord(toCamel(raw));
    const links = Array.isArray(raw.billing_candidate_line_links) ? raw.billing_candidate_line_links.map(asRecord) : [];
    delete line.billingCandidateLineLinks;
    return { ...line, quantity: decimalString(line.quantity, 4), candidateIds: links.filter((link) => link.active !== false).map((link) => link.candidate_id) };
  });
  return invoice;
}
export function cursorEncode(value: Record<string, string>) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
export function cursorDecode<T extends Record<string, string>>(cursor: string | null): T | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as T;
  } catch { return null; }
}
export function boundedLimit(raw: string | null, fallback = 50) {
  const parsed = raw ? Number(raw) : fallback;
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : null;
}
export function isDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export function firmDateISO(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function permissionActionFor(resource: string, method: string): BillingAction {
  const read = method === "GET";
  if (resource === "policy") return "policy.manage";
  if (resource === "candidates" || resource === "completion-source-maps") return read ? "candidates.view" : "candidates.manage";
  if (resource === "rate-cards" || resource === "bundles" || resource === "client-pricing") return read ? "pricing.view" : "pricing.manage";
  if (resource === "terms") return read ? "billing.view" : "settings.terms.manage";
  if (resource === "remittance") return read ? "billing.view" : "settings.remittance.manage";
  return read ? "billing.view" : "invoices.draft.manage";
}
