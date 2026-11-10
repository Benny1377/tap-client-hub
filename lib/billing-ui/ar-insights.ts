// Shaping for the Collections AR Insights and "Who's where" views, following the PracticeOps design.
// Totals that the server reports (net AR, gross open balance, aging buckets) are used as given; the shares,
// rankings and call-list tiers below are derived from the server's per-invoice balances and priority scores.
import type { CollectionsAccount, CollectionsReceivablesResponse } from "@/lib/collections-api";
import type { CollectionRule } from "./types";

export const n = (value: string | number | null | undefined) => Number(value || 0);
export const pct = (part: number, whole: number) => Math.round((part / (whole || 1)) * 100);
/** Whole dollars, as the design shows them. */
export const dollars = (value: number) => `${value < 0 ? "-" : ""}$${Math.round(Math.abs(value)).toLocaleString("en-US")}`;
export const andList = (items: string[]) => (items.length < 2 ? items[0] || "" : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function dayMonth(iso: string | null | undefined, withYear = false) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return "—";
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  return `${day} ${MONTHS[month - 1]}${withYear ? ` ${year}` : ""}`;
}

export const isGateStage = (stage: number) => stage >= 4;
export function ladderOf(rules: CollectionRule[]) {
  return rules.filter((rule) => rule.enabled).sort((a, b) => a.days_past_due - b.days_past_due || a.stage - b.stage);
}
/** The first touch that hands the account to a person. Under it, the automated reminders handle the invoice. */
export function firstGate(rules: CollectionRule[]) {
  const ladder = ladderOf(rules);
  return (ladder.find((rule) => isGateStage(rule.stage)) || ladder[ladder.length - 1])?.days_past_due ?? 21;
}
export const reminderDays = (rules: CollectionRule[]) => ladderOf(rules).filter((rule) => !isGateStage(rule.stage)).map((rule) => rule.days_past_due);

/** Read-model fields proposed in the Phase 5 contract. Optional until the backend returns them; the UI only formats them. */
export type Phase5AccountFields = {
  note_count?: number;
  last_note_at?: string | null;
  late_beyond_final_count?: number;
  late_beyond_final?: { stage: number; label: string; days_past_due: number; window_months: number | null };
};
export type Account = CollectionsAccount & Phase5AccountFields;
export const net = (account: Account) => n(account.net_ar_estimate);
export const hasBillingInvoices = (account: Account) => account.invoices.some((invoice) => invoice.source === "billing");
/** Money an account has at or past the first hand-off day: what a call can bring in. */
export const callable = (account: Account, cut: number) => account.invoices.filter((invoice) => invoice.days_past_due >= cut).reduce((sum, invoice) => sum + n(invoice.balance), 0);

/** The latest report date behind the book, or the firm date when everything is read from Billing. */
export function asOfDate(worklist: CollectionsReceivablesResponse) {
  const dates = worklist.accounts.flatMap((account) => account.invoices.map((invoice) => (invoice as { source_as_of?: string | null }).source_as_of)).filter((value): value is string => Boolean(value)).sort();
  return dates[dates.length - 1] || worklist.as_of_date;
}

export function arStats(worklist: CollectionsReceivablesResponse, rules: CollectionRule[]) {
  const cut = firstGate(rules);
  const { summary, accounts } = worklist;
  const tot = n(summary.gross_open_balance);
  const total = n(summary.net_ar_estimate);
  const credits = -n(summary.unallocated_credit);
  let auto = 0;
  for (const invoice of accounts.flatMap((account) => account.invoices)) if (invoice.days_past_due < cut) auto += n(invoice.balance);
  const you = tot - auto;
  const pd = tot - n(summary.aging.current);
  const d30 = n(summary.aging.days_31_60) + n(summary.aging.days_61_90) + n(summary.aging.days_over_90);
  const d90 = n(summary.aging.days_over_90);
  const owe = accounts.filter((account) => net(account) > 0);
  const calls = accounts.filter((account) => n(account.call_priority_score) > 0).sort((a, b) => n(b.call_priority_score) - n(a.call_priority_score));
  return { cut, tot, net: total, credits, auto, you, pd, d30, d90, owe, calls };
}

/** What calling the top N on the call list brings in, and what the book drops to. */
export function tier(stats: ReturnType<typeof arStats>, count: number) {
  const got = stats.calls.slice(0, count).reduce((sum, account) => sum + callable(account, stats.cut), 0);
  return { count, got, share: pct(got, stats.net), after: stats.net - got };
}

/** One contact on several owing accounts: the pair (or more) worth the most in a single call. */
export function sharedContact(owe: Account[]) {
  const byContact = new Map<string, Account[]>();
  for (const account of owe) {
    const key = (account.contact_name || "").trim().toLowerCase();
    if (!key) continue;
    byContact.set(key, [...(byContact.get(key) || []), account]);
  }
  const groups = [...byContact.values()].filter((group) => group.length > 1);
  groups.sort((a, b) => b.reduce((sum, x) => sum + net(x), 0) - a.reduce((sum, x) => sum + net(x), 0));
  return groups[0] || null;
}

export function biggerPicture(stats: ReturnType<typeof arStats>) {
  const { owe, tot } = stats;
  const top20 = [...owe].sort((a, b) => net(b) - net(a)).slice(0, 20).reduce((sum, account) => sum + net(account), 0);
  const chronic = owe.filter((account) => account.open_invoice_count >= 3);
  const stubs = owe.filter((account) => net(account) < 150 && account.oldest_days_past_due >= 120);
  return { top20Share: pct(top20, tot), chronic: chronic.length, chronicTotal: chronic.reduce((sum, account) => sum + net(account), 0), stubs: stubs.length };
}

type StepFields = { completed_stage?: number | null; next_stage?: number | null };
/**
 * The touch an invoice is on, from the server's ladder history: the next touch when one is due,
 * otherwise the last touch completed; 0 before any touch. Never worked out from days past due,
 * so a first upload starts every invoice at the first touch the server proposes.
 */
export function ladderStep(invoice: StepFields) {
  return invoice.next_stage ?? invoice.completed_stage ?? 0;
}

export type RungChip = { label: string; tone: string; gate: boolean };
const RUNG_TONES = ["c-blue", "c-blue", "c-amber", "c-amber", "c-red"];
/** Where an account sits on the ladder: its furthest invoice's touch, as "<touch> due" or "<touch> sent". */
export function rungChip(account: Account, rules: CollectionRule[]): RungChip {
  if (net(account) < 0) return { label: "In credit", tone: "c-grey", gate: false };
  if (account.on_hold) return { label: "On hold", tone: "c-grey", gate: false };
  const labels = new Map(rules.map((rule) => [rule.stage, rule.label]));
  let best: { stage: number; due: boolean } | null = null;
  for (const invoice of account.invoices) {
    const stage = ladderStep(invoice);
    if (!stage) continue;
    const due = invoice.next_stage != null;
    if (!best || stage > best.stage || (stage === best.stage && due && !best.due)) best = { stage, due };
  }
  if (!best) return account.oldest_days_past_due > 0 ? { label: "Past due · no touch yet", tone: "c-grey", gate: false } : { label: "Current", tone: "c-green", gate: false };
  const label = labels.get(best.stage) || `Touch ${best.stage}`;
  return { label: `${label} ${best.due ? "due" : "sent"}`, tone: RUNG_TONES[Math.min(best.stage - 1, 4)], gate: isGateStage(best.stage) };
}

/** Notes per client from loaded Collections events; the server's note_count wins when it is returned. */
export function noteCounts(events: { client_id: string; event_type: string }[]) {
  const counts = new Map<string, number>();
  for (const event of events) if (event.event_type === "note") counts.set(event.client_id, (counts.get(event.client_id) || 0) + 1);
  return counts;
}
export const noteCountOf = (account: Account, counts: Map<string, number>) => account.note_count ?? counts.get(account.client_id) ?? 0;

/** The design's late-payment marker: amber from 3, red from 5. */
export const lateTone = (count: number) => (count >= 5 ? "var(--red)" : count >= 3 ? "var(--amber)" : "var(--ink)");
export const hasLateCounts = (accounts: Account[]) => accounts.some((account) => typeof account.late_beyond_final_count === "number");

export type SortKey = "score" | "name" | "net" | "oldest" | "open";
export function sortAccounts(accounts: Account[], key: SortKey, ascending: boolean) {
  const value = (account: Account) => (key === "net" ? net(account) : key === "oldest" ? account.oldest_days_past_due : key === "open" ? account.open_invoice_count : n(account.call_priority_score));
  return [...accounts].sort((a, b) => {
    if (key === "name") { const x = a.client_name.toLowerCase(), y = b.client_name.toLowerCase(); return ascending ? (x < y ? -1 : x > y ? 1 : 0) : (x > y ? -1 : x < y ? 1 : 0); }
    return ascending ? value(a) - value(b) : value(b) - value(a);
  });
}

/** Every account across all pages, with the first page's summary (the server computes it over the whole book). */
export function mergePages(pages: CollectionsReceivablesResponse[]): CollectionsReceivablesResponse | null {
  if (!pages.length) return null;
  const accounts = pages.flatMap((page) => page.accounts);
  return { ...pages[0], accounts, pagination: { ...pages[0].pagination, offset: 0, limit: accounts.length } };
}
