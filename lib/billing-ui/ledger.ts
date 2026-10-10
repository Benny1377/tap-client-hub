import type { CollectionsReceivablesResponse } from "@/lib/collections-api";
import type { ApiResult, BillingApi } from "./api";
import type { CollectionEvent, CollectionHold, Invoice, Payment, ReceivablesResponse } from "./types";
import type { SectionState } from "./view-model";

export type LedgerSection = "invoices" | "receivables" | "payments" | "holds" | "events" | "worklist";

export interface LedgerState {
  invoices: SectionState<Invoice[]>;
  receivables: SectionState<ReceivablesResponse>;
  payments: SectionState<Payment[]>;
  holds: SectionState<CollectionHold[]>;
  events: SectionState<CollectionEvent[]>;
  worklist: SectionState<CollectionsReceivablesResponse>;
}

export interface LedgerOptions {
  worklistLimit?: number;
  worklistOffset?: number;
}

export function loadingLedger(): LedgerState {
  return {
    invoices: { status: "loading" },
    receivables: { status: "loading" },
    payments: { status: "loading" },
    holds: { status: "loading" },
    events: { status: "loading" },
    worklist: { status: "loading" },
  };
}

function toSection<R, T>(result: ApiResult<R>, pick: (data: R) => T): SectionState<T> {
  return result.ok === false ? { status: "error", kind: result.kind, message: result.message } : { status: "ready", data: pick(result.data) };
}

/**
 * Load the requested sections from the API in parallel. Each section keeps its
 * own state so one failing route does not hide the others.
 */
export async function loadLedger(api: BillingApi, clientId: string | null, sections: LedgerSection[], options: LedgerOptions = {}): Promise<LedgerState> {
  const state = loadingLedger();
  const wanted = new Set(sections);
  await Promise.all([
    wanted.has("invoices") && api.invoices(clientId).then((r) => { state.invoices = toSection(r, (d) => d.invoices || []); }),
    wanted.has("receivables") && api.receivables(clientId).then((r) => { state.receivables = toSection(r, (d) => ({ ...d, receivables: d.receivables || [] })); }),
    wanted.has("payments") && api.payments(clientId).then((r) => { state.payments = toSection(r, (d) => d.payments || []); }),
    wanted.has("holds") && api.holds(clientId).then((r) => { state.holds = toSection(r, (d) => d.holds || []); }),
    wanted.has("events") && api.events(clientId).then((r) => { state.events = toSection(r, (d) => d.events || []); }),
    wanted.has("worklist") && api.worklist({ clientId, limit: options.worklistLimit, offset: options.worklistOffset })
      .then((r) => { state.worklist = toSection(r, (d) => d); }),
  ]);
  return state;
}

export function readyData<T>(section: SectionState<T>, fallback: T): T {
  return section.status === "ready" ? section.data : fallback;
}
