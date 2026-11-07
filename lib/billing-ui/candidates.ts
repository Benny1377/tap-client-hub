// Billable candidates: how they are grouped and which can go on a draft. Prices come from the server as
// decimal strings and are only displayed here. A package's components each carry the full package price,
// so a package is shown once and its component prices are never added together.
import type { ApiResult } from "./api";
import type { BillingBundle, Candidate, CandidateState } from "./types";

export const CANDIDATE_FILTERS: Array<{ id: CandidateState; label: string }> = [
  { id: "open", label: "Ready" },
  { id: "unpriced", label: "No price" },
  { id: "dismissed", label: "Dismissed" },
  { id: "drafted", label: "On a draft" },
  { id: "invoiced", label: "Invoiced" },
];

export const CANDIDATE_STATE_LABELS: Record<CandidateState, string> = {
  open: "Ready", unpriced: "No price", dismissed: "Dismissed", drafted: "On a draft", invoiced: "Invoiced",
};

export interface CandidateUnit {
  key: string;
  /** Set when this row is a package; its candidates are selected and drafted together. */
  bundle: BillingBundle | null;
  candidates: Candidate[];
  candidateDate: string;
  description: string;
  unitAmount: string | null;
  state: CandidateState;
  selectable: boolean;
  /** Why a row that looks ready cannot be selected. */
  blockedReason: string | null;
}

function bundleFor(candidate: Candidate, bundles: BillingBundle[]) {
  return bundles.find((bundle) => bundle.active !== false
    && bundle.components.some((component) => component.clientServiceId === candidate.clientServiceId)
    && candidate.candidateDate >= bundle.effectiveFrom
    && (!bundle.effectiveTo || candidate.candidateDate <= bundle.effectiveTo)) || null;
}

const isDraftable = (candidate: Candidate) => candidate.state === "open" && candidate.unitAmount !== null;

/** The server refuses a package unless each component has exactly one open, priced candidate on that date. */
function packageBlockedReason(bundle: BillingBundle, candidates: Candidate[]): string | null {
  const ready = candidates.filter(isDraftable);
  const perService = bundle.components.map((component) => ready.filter((candidate) => candidate.clientServiceId === component.clientServiceId).length);
  if (perService.some((count) => count > 1)) return "This package has two candidates for one service on this date. Dismiss one first.";
  const present = perService.filter((count) => count === 1).length;
  if (present < bundle.components.length) return `This package needs all ${bundle.components.length} services on this date; ${present} ${present === 1 ? "is" : "are"} ready.`;
  return null;
}

/** One row per candidate, except that candidates of the same package and date share a row. */
export function candidateUnits(candidates: Candidate[], bundles: BillingBundle[]): CandidateUnit[] {
  const units = new Map<string, CandidateUnit>();
  for (const candidate of candidates) {
    const bundle = bundleFor(candidate, bundles);
    const key = bundle ? `bundle:${bundle.id}:${candidate.candidateDate}:${candidate.state}` : candidate.id;
    const unit = units.get(key);
    if (unit) { unit.candidates.push(candidate); continue; }
    units.set(key, {
      key, bundle, candidates: [candidate], candidateDate: candidate.candidateDate,
      description: bundle ? bundle.name : candidate.description,
      unitAmount: candidate.unitAmount, state: candidate.state, selectable: false, blockedReason: null,
    });
  }
  for (const unit of units.values()) {
    if (unit.state !== "open") continue;
    unit.blockedReason = unit.bundle ? packageBlockedReason(unit.bundle, unit.candidates) : null;
    unit.selectable = !unit.blockedReason && unit.candidates.every(isDraftable);
  }
  return [...units.values()];
}

/** Candidate ids behind the selected rows, dropping any row that is no longer selectable after a refresh. */
export function selectedCandidateIds(units: CandidateUnit[], selected: ReadonlySet<string>): string[] {
  return units.filter((unit) => unit.selectable && selected.has(unit.key)).flatMap((unit) => unit.candidates.map((candidate) => candidate.id));
}

export function candidateTypeLabel(type: string) {
  return type ? `${type[0].toUpperCase()}${type.slice(1).replace(/_/g, " ")}` : "—";
}

/**
 * The server caps a page at 100 and sorts newest first, so one page can hide one-off work behind recurring rows.
 * This reads on to a bounded limit; a nextCursor in the result means there was still more.
 */
export async function readPages<T>(fetchPage: (cursor: string | null) => Promise<ApiResult<{ items: T[]; nextCursor: string | null }>>, maxPages = 10): Promise<ApiResult<{ items: T[]; nextCursor: string | null }>> {
  const items: T[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page += 1) {
    const result = await fetchPage(cursor);
    if (!result.ok) return result;
    items.push(...result.data.items);
    cursor = result.data.nextCursor;
    if (!cursor) return { ...result, data: { items, nextCursor: null } };
  }
  return { ok: true, status: 200, data: { items, nextCursor: cursor } };
}
