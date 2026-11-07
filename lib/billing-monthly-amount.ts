/** Exact decimal-to-cents conversion for Billing amounts, including credits. */
export function moneyToCents(value: unknown): bigint | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) return null;
  const cents = BigInt(match[2]) * 100n + BigInt((match[3] || "").padEnd(2, "0"));
  return match[1] === "-" ? -cents : cents;
}

export function centsToMoney(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}

/** Number of billing occurrences per year for supported recurring cadences. */
export function occurrencesPerYear(frequency: unknown): bigint | null {
  if (typeof frequency !== "string") return null;
  const normalized = frequency.trim().toLowerCase().replace(/[\s_-]/g, "");
  if (normalized === "weekly") return 52n;
  if (["biweekly", "biweeklya", "biweeklyb"].includes(normalized)) return 26n;
  if (normalized === "semimonthly") return 24n;
  if (normalized === "monthly") return 12n;
  if (normalized === "quarterly") return 4n;
  if (["semiannual", "halfyearly"].includes(normalized)) return 2n;
  if (["annual", "yearly", "annually"].includes(normalized)) return 1n;
  return null;
}

/** Average monthly amount, rounded half-up to cents without floating point. */
export function averageMonthlyCents(amountCents: bigint, occurrences: bigint): bigint {
  const numerator = amountCents * occurrences;
  const sign = numerator < 0n ? -1n : 1n;
  const absolute = numerator < 0n ? -numerator : numerator;
  return sign * ((absolute + 6n) / 12n);
}
