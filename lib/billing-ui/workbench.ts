// Shaping for the Billing workbench views. Nothing here adds money together: the contract keeps amounts on the server, and a package's
// components each carry the full package price, so sums here would be wrong as well as out of bounds. Counts and dates only.
import type { BillingBundle, BillingCandidate, ClientOption, Numeric, Receivable } from "./types";

export type ProjectedItem = { clientServiceId: string; candidateDate: string; period?: string | null; description: string; serviceCode?: string | null; unitAmount?: Numeric | null };
export type PriceOverride = { id: string; clientServiceId: string; unitAmount: string; effectiveFrom: string; effectiveTo?: string | null };

/** Houston firm date, so a late evening in another timezone does not move it. */
export function firmToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function monthEnd(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).toISOString().slice(0, 10);
}

/** The next `count` billing days. Billing runs on the last day of the month. */
export function nextRunDates(today: string, count = 3) {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1;
  return Array.from({ length: count }, (_unused, index) => monthEnd(year, month + index));
}

export function shortDate(iso: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
}

export interface RunRow {
  /** The client service, or the package when several services bill as one. */
  key: string;
  description: string;
  serviceCode: string | null;
  packaged: boolean;
  /** Keyed by run date. A null amount means the work is expected but has no price yet. */
  cells: Record<string, { amount: Numeric | null } | undefined>;
  unpriced: boolean;
}

function packageOn(item: ProjectedItem, bundles: BillingBundle[]) {
  return bundles.find((bundle) => bundle.active !== false && bundle.components.some((part) => part.clientServiceId === item.clientServiceId)
    && item.candidateDate >= bundle.effectiveFrom && (!bundle.effectiveTo || item.candidateDate <= bundle.effectiveTo)) || null;
}

/**
 * One row per service across the run dates, and one row per package, because each of a package's services carries the full package
 * price. Work on another date sits in the run for its month.
 */
export function runRows(items: ProjectedItem[], runDates: string[], bundles: BillingBundle[] = []): RunRow[] {
  const rows = new Map<string, RunRow>();
  for (const item of items) {
    const run = runDates.find((date) => date.slice(0, 7) === item.candidateDate.slice(0, 7));
    if (!run) continue;
    const bundle = packageOn(item, bundles);
    const key = bundle ? bundle.id : item.clientServiceId;
    const row = rows.get(key) || { key, description: bundle ? bundle.name : item.description, serviceCode: bundle ? null : item.serviceCode ?? null, packaged: Boolean(bundle), cells: {}, unpriced: false };
    const amount = item.unitAmount ?? null;
    row.cells[run] = { amount };
    if (amount === null) row.unpriced = true;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => a.description.localeCompare(b.description));
}

/** The projection leaves out work that already has a candidate, so the runs need both to stay whole after generating. */
export function runItems(projected: ProjectedItem[], candidates: BillingCandidate[]): ProjectedItem[] {
  return [...projected, ...candidates.map((row) => ({ clientServiceId: row.clientServiceId, candidateDate: row.candidateDate, period: row.period, description: row.description, serviceCode: row.serviceCode, unitAmount: row.unitAmount }))];
}

export function whyItMoves(row: RunRow, runDates: string[]) {
  const reasons: string[] = [];
  const present = runDates.filter((date) => row.cells[date]);
  if (row.unpriced) reasons.push("No price yet, so it can't be drafted");
  if (present.length && present.length < runDates.length) reasons.push(`Bills in ${present.map(shortDate).join(", ")} only`);
  return reasons.join(" · ") || "—";
}

export type PricedHow = "Package" | "Own price" | "Rate card";

/** How a service gets its price on a date, in the server's order: package, then client override, then rate card. */
export function pricedHow(clientServiceId: string, date: string, overrides: PriceOverride[], bundles: BillingBundle[]): PricedHow {
  const within = (from: string, to?: string | null) => date >= from && (!to || date <= to);
  if (bundles.some((bundle) => bundle.active !== false && within(bundle.effectiveFrom, bundle.effectiveTo) && bundle.components.some((item) => item.clientServiceId === clientServiceId))) return "Package";
  if (overrides.some((item) => item.clientServiceId === clientServiceId && within(item.effectiveFrom, item.effectiveTo))) return "Own price";
  return "Rate card";
}

export interface ClientRow {
  id: string;
  name: string;
  openInvoices: number;
  daysPastDue: number;
  ready: number;
  noPrice: number;
}

export function clientRows(clients: ClientOption[], receivables: Receivable[], open: BillingCandidate[], unpriced: BillingCandidate[]): ClientRow[] {
  return clients.map((client) => {
    const owed = receivables.filter((row) => row.client_id === client.id && Number(row.balance) > 0);
    return {
      id: client.id,
      name: client.name,
      openInvoices: owed.length,
      daysPastDue: owed.reduce((most, row) => Math.max(most, row.days_past_due), 0),
      ready: open.filter((row) => row.clientId === client.id).length,
      noPrice: unpriced.filter((row) => row.clientId === client.id).length,
    };
  });
}

export function required(...names: string[]) {
  return (values: Record<string, string>) => Object.fromEntries(names.filter((name) => !values[name]?.trim()).map((name) => [name, "Required"]));
}
