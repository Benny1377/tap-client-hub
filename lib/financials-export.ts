const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const STATUS_LABELS: Record<string, string> = {
  dn: "Completed",
  done: "Completed",
  paid: "Completed",
  pp: "Billed",
  billed: "Billed",
  dl: "Delayed",
  delayed: "Delayed",
  ip: "In progress",
  in_progress: "In progress",
  wc: "Waiting on client",
  waiting: "Waiting on client",
  na: "N/A",
};

function activeMonthIndices(frequency: unknown, financialsMonth: unknown): number[] {
  const value = String(frequency || "").trim().toLowerCase();
  const parsedStart = Number(financialsMonth);
  const hasStart = financialsMonth !== null && financialsMonth !== undefined &&
    financialsMonth !== "" && Number.isInteger(parsedStart) && parsedStart >= 0 && parsedStart < 12;

  if (["monthly", "weekly", "bi-weekly", "bi-weekly a", "bi-weekly b", "semi-monthly"].includes(value)) {
    const start = hasStart ? parsedStart : 0;
    return Array.from({ length: 12 - start }, (_, index) => start + index);
  }
  if (value === "quarterly") {
    const start = hasStart ? parsedStart : 0;
    return [0, 3, 6, 9].map(offset => (start + offset) % 12);
  }
  // Annual work may be completed in any month; match the Financials worklist.
  return MONTHS.map((_, index) => index);
}

function isComplete(status: unknown): boolean {
  const normalized = String(status || "").trim().toLowerCase();
  return normalized === "dn" || normalized === "done" || normalized === "paid";
}

function statusLabel(status: unknown): string {
  const normalized = String(status || "").trim().toLowerCase();
  return STATUS_LABELS[normalized] || (normalized ? String(status) : "Not started");
}

export function financialsExportHeaders(): string[] {
  return [
    "Year",
    "Months Included",
    "Completed Months",
    "Completed Through",
    ...MONTHS.map(month => `${month} Status`),
  ];
}

export function financialsExportValues(
  service: { frequency?: unknown; financialsMonth?: unknown },
  statuses: readonly unknown[] = [],
  year: number,
): Array<string | number> {
  const active = activeMonthIndices(service.frequency, service.financialsMonth);
  const activeSet = new Set(active);
  const completed = active.filter(index => isComplete(statuses[index]));
  const through = [] as number[];
  for (const index of active) {
    if (!isComplete(statuses[index])) break;
    through.push(index);
  }

  return [
    year,
    active.map(index => MONTHS[index]).join(", "),
    completed.map(index => MONTHS[index]).join(", "),
    through.length ? MONTHS[through[through.length - 1]] : "—",
    ...MONTHS.map((_, index) => activeSet.has(index) ? statusLabel(statuses[index]) : ""),
  ];
}
