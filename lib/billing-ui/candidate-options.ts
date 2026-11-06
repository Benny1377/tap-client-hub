import type { BillingBundle, BillingCandidate } from "./types";

export interface CandidateOption {
  key: string;
  candidateIds: string[];
  label: string;
  date: string;
  amount: string | null;
  description: string;
  selectable: boolean;
  note?: string;
}

/** Build safe, server-priced choices. Bundle components are one package, never separate charges. */
export function candidateOptions(candidates: BillingCandidate[], bundles: BillingBundle[] | null) {
  const openPriced = candidates.filter((row) => row.state === "open" && row.unitAmount !== null);
  const used = new Set<string>();
  const options: CandidateOption[] = [];

  for (const bundle of bundles || []) {
    const componentIds = [...new Set(bundle.components.map((item) => item.clientServiceId))];
    if (!bundle.active || componentIds.length === 0) continue;
    const dates = [...new Set(openPriced.filter((row) => row.priceSource === "bundle" && componentIds.includes(row.clientServiceId)).map((row) => row.candidateDate))];
    for (const date of dates) {
      const componentCandidates = componentIds.map((clientServiceId) => openPriced.filter((row) =>
        row.clientId === bundle.clientId && row.clientServiceId === clientServiceId && row.candidateDate === date &&
        row.priceSource === "bundle" && date >= bundle.effectiveFrom && (!bundle.effectiveTo || date <= bundle.effectiveTo)
      ));
      const flat = componentCandidates.flat();
      const complete = componentCandidates.every((matches) => matches.length === 1);
      const ids = flat.map((row) => row.id);
      ids.forEach((id) => used.add(id));
      options.push({
        key: `bundle:${bundle.id}:${date}`,
        candidateIds: complete ? ids : [],
        label: `${bundle.name} · ${date}`,
        date,
        amount: bundle.unitAmount,
        description: `${componentIds.length} service components`,
        selectable: complete,
        note: complete ? "One package charge" : "Waiting for every open component candidate",
      });
    }
  }

  for (const row of openPriced) {
    if (used.has(row.id)) continue;
    if (row.priceSource === "bundle") {
      options.push({ key: `unresolved-bundle:${row.id}`, candidateIds: [], label: row.description, date: row.candidateDate, amount: row.unitAmount, description: row.serviceCode || "Bundle", selectable: false, note: "Package membership could not be verified" });
      continue;
    }
    options.push({
      key: row.id,
      candidateIds: [row.id],
      label: row.description,
      date: row.candidateDate,
      amount: row.unitAmount,
      description: row.serviceCode ? `${row.serviceCode} · ${row.source?.adapter || row.sourceAdapter || "source"}` : (row.source?.adapter || row.sourceAdapter || "source"),
      selectable: true,
    });
  }
  return options.sort((a, b) => b.date.localeCompare(a.date) || a.label.localeCompare(b.label));
}
