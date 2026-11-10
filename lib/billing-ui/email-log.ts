// Email log (Collections Phase 5, item 5): how many reminders of each type went out per client and invoice, and when.
// Built from delivery history (GET /api/collections/deliveries); no email content is read or stored.
// Only `accepted` attempts count as sent. Everything else is listed as not sent, with its status.
import type { CollectionsDeliveryAttemptSummary, CollectionsDeliveryStatus } from "@/lib/collections-api";

export type EmailLogSent = { stage: number; label: string; sent_at: string };
export type EmailLogNotSent = { stage: number; label: string; status: CollectionsDeliveryStatus; reason_text: string | null; updated_at: string };
export type EmailLogInvoice = { row_key: string; invoice_number: string; sent: EmailLogSent[]; not_sent: EmailLogNotSent[] };
export type EmailLogStageCount = { stage: number; label: string; sent_count: number; last_sent_at: string | null };
export type EmailLogClient = { client_id: string; client_name: string; stages: EmailLogStageCount[]; total_sent: number; last_sent_at: string | null; invoices: EmailLogInvoice[] };

const later = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);

/** Groups delivery attempts into client → invoice → touches. Stage 4 is internal and never an email, so it is left out. */
export function groupEmailLog(
  items: CollectionsDeliveryAttemptSummary[],
  stageLabels: Record<number, string>,
  clientNames: Record<string, string>,
): EmailLogClient[] {
  const label = (stage: number) => stageLabels[stage] || `Touch ${stage}`;
  const clients = new Map<string, EmailLogClient>();
  for (const item of items) {
    if (item.stage === 4) continue;
    let client = clients.get(item.client_id);
    if (!client) {
      client = { client_id: item.client_id, client_name: clientNames[item.client_id] || "Unknown client", stages: [], total_sent: 0, last_sent_at: null, invoices: [] };
      clients.set(item.client_id, client);
    }
    let invoice = client.invoices.find((row) => row.row_key === item.row_key);
    if (!invoice) {
      invoice = { row_key: item.row_key, invoice_number: item.invoice_number, sent: [], not_sent: [] };
      client.invoices.push(invoice);
    }
    if (item.status === "accepted") {
      const sentAt = item.accepted_at || item.updated_at;
      invoice.sent.push({ stage: item.stage, label: label(item.stage), sent_at: sentAt });
      let count = client.stages.find((row) => row.stage === item.stage);
      if (!count) { count = { stage: item.stage, label: label(item.stage), sent_count: 0, last_sent_at: null }; client.stages.push(count); }
      count.sent_count += 1;
      count.last_sent_at = later(count.last_sent_at, sentAt);
      client.total_sent += 1;
      client.last_sent_at = later(client.last_sent_at, sentAt);
    } else {
      invoice.not_sent.push({ stage: item.stage, label: label(item.stage), status: item.status, reason_text: item.reason_text, updated_at: item.updated_at });
    }
  }
  const result = [...clients.values()];
  for (const client of result) {
    client.stages.sort((a, b) => a.stage - b.stage);
    for (const invoice of client.invoices) { invoice.sent.sort((a, b) => a.stage - b.stage); invoice.not_sent.sort((a, b) => a.stage - b.stage); }
    client.invoices.sort((a, b) => a.invoice_number.localeCompare(b.invoice_number, "en", { numeric: true }));
  }
  // Most recently emailed first; clients with nothing sent yet go last, by name.
  return result.sort((a, b) => (b.last_sent_at || "").localeCompare(a.last_sent_at || "") || a.client_name.localeCompare(b.client_name));
}

/** A timestamp as a firm-calendar date with the year, e.g. "3 Nov 2026". */
export function firmDate(iso: string, timeZone: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone }).format(date);
}
