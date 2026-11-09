/** Exact decimal-to-cents conversion for Billing amounts, including credits. */
export function moneyToCents(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) return null;
  const cents = Number(match[2]) * 100 + Number((match[3] || "").padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) return null;
  return match[1] === "-" ? -cents : cents;
}

export function centsToMoney(value: number): string {
  if (!Number.isSafeInteger(value)) throw new RangeError("Money cents must be a safe integer");
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

/** Number of billing occurrences per year for supported recurring cadences. */
export function occurrencesPerYear(frequency: unknown): number | null {
  if (typeof frequency !== "string") return null;
  const normalized = frequency.trim().toLowerCase().replace(/[\s_-]/g, "");
  if (normalized === "weekly") return 52;
  if (["biweekly", "biweeklya", "biweeklyb"].includes(normalized)) return 26;
  if (normalized === "semimonthly") return 24;
  if (normalized === "monthly") return 12;
  if (normalized === "quarterly") return 4;
  if (["semiannual", "halfyearly"].includes(normalized)) return 2;
  if (["annual", "yearly", "annually"].includes(normalized)) return 1;
  return null;
}

/** Average monthly amount, rounded half-up to cents without floating point. */
export function averageMonthlyCents(amountCents: number, occurrences: number): number {
  const numerator = amountCents * occurrences;
  if (!Number.isSafeInteger(numerator)) throw new RangeError("Monthly amount exceeds safe integer precision");
  const sign = numerator < 0 ? -1 : 1;
  const absolute = Math.abs(numerator);
  return sign * Math.floor((absolute + 6) / 12);
}
