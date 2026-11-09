import { getPayrollSchedules } from "./payroll-run-progress";

export type WorklistKpi =
  | "all"
  | "in_progress"
  | "waiting"
  | "delayed"
  | "done"
  | "not_started"
  | "processed"
  | "remaining"
  | "current_month"
  | "runs"
  | "max_runs"
  | "incomplete"
  | "month_runs";

export type PayrollKpiCategory =
  | "completed"
  | "in_progress"
  | "not_started"
  | "delayed"
  | "waiting";

type Options = {
  serviceKey: string;
  variant?: "default" | "payroll" | "t9" | "tax_returns";
  currentMonth: number;
  stages: Record<string, string[]>;
  periodCounts: Record<string, number[]>;
};

function enabledService(client: any, serviceKey: string) {
  return client.services?.find((service: any) => service.key === serviceKey && service.enabled);
}

function activeMonths(service: any): Set<number> {
  const frequency = String(service?.frequency || "Monthly").toLowerCase();
  if (frequency.includes("quarter")) return new Set([0, 3, 6, 9]);
  if (frequency.includes("annual") || frequency.includes("year")) {
    const month = Number(service?.financialsMonth);
    return new Set([Number.isInteger(month) && month >= 1 && month <= 12 ? month - 1 : 11]);
  }
  return new Set(Array.from({ length: 12 }, (_, index) => index));
}

function hasStage(client: any, serviceKey: string, stage: string, stages: Record<string, string[]>) {
  const service = enabledService(client, serviceKey);
  if (!service) return false;
  const months = activeMonths(service);
  const values = stages[`${client.id}:${serviceKey}`] || [];
  return Array.from(months).some((month) => (values[month] || "") === stage);
}

/**
 * Canonical "expected runs" for a single payroll month, matching the worklist's
 * getMaxRunsPerMonth mapping (Weekly = 5, Bi-Weekly = 2, Semi-Monthly = 2,
 * Monthly/everything else = 1).
 */
export function payrollRunsPerMonth(frequency: unknown): number {
  const f = String(frequency || "").trim().toLowerCase();
  if (f === "weekly") return 5;
  if (f.includes("bi-weekly") || f.includes("biweekly")) return 2;
  if (f === "semi-monthly" || f === "semimonthly") return 2;
  return 1;
}

/**
 * Classify a single payroll month into one of the five workflow KPI categories.
 *
 * Explicit stage data is the source of truth. Both persisted `MonthStatus`
 * strings (`done`/`paid`, `in_progress`, `waiting`, `delayed`) and worklist
 * display-stage codes (`dn`, `ip`, `wc`, `dl`) map to their workflow category;
 * `billed`/`prepared`/`pp` and `na` are not part of the five workflow cards and
 * return null.
 *
 * For legacy rows with no explicit stage (`lock`, `""`, or undefined), only safe
 * states are derived from counts: completed when processed >= expected,
 * not started when processed === 0, in progress when 0 < processed < expected.
 * Waiting and delayed are never derived from counts.
 */
export function classifyPayrollMonth(
  monthStatus: unknown,
  processed: unknown,
  expected: number,
): PayrollKpiCategory | null {
  const s = String(monthStatus ?? "").trim().toLowerCase();
  switch (s) {
    case "done":
    case "paid":
    case "dn":
      return "completed";
    case "in_progress":
    case "ip":
      return "in_progress";
    case "waiting":
    case "waiting_client":
    case "wc":
      return "waiting";
    case "delayed":
    case "dl":
      return "delayed";
    case "billed":
    case "prepared":
    case "pp":
    case "na":
      return null;
    default:
      break;
  }
  const p = Number(processed) || 0;
  const e = Number(expected) || 0;
  if (e > 0 && p >= e) return "completed";
  if (p > 0) return "in_progress";
  return "not_started";
}

/**
 * Per-month (index 0..11) workflow category for a payroll service.
 * Returns null for disabled/missing services and for months whose explicit
 * stage is billed/prepared or na.
 */
export function payrollMonthCategories(
  client: any,
  serviceKey: string,
  periodCounts: Record<string, number[]>,
  stages?: Record<string, string[]>,
): (PayrollKpiCategory | null)[] {
  const service = enabledService(client, serviceKey);
  if (!service) return Array(12).fill(null);
  const key = `${client.id}:${serviceKey}`;
  const counts = periodCounts[key] || [];
  const schedules = getPayrollSchedules(client.payrollSchedules?.length ? client.payrollSchedules : client.services);
  const expected = (schedules.length ? schedules : [service]).reduce(
    (total, schedule) => total + payrollRunsPerMonth(schedule.frequency || schedule.payPeriodFrequency),
    0,
  );
  // Explicit stage data (the rendered worklist display state) is the source of
  // truth when supplied; otherwise fall back to the raw persisted months.
  const displayStages = stages && Array.isArray(stages[key]) ? stages[key] : null;
  const months = Array.isArray(service.months) ? service.months : [];
  return Array.from({ length: 12 }, (_, m) =>
    classifyPayrollMonth(displayStages ? displayStages[m] : months[m], counts[m], expected),
  );
}

const WORKFLOW_TARGET: Record<string, PayrollKpiCategory> = {
  done: "completed",
  in_progress: "in_progress",
  waiting: "waiting",
  delayed: "delayed",
  not_started: "not_started",
};

export function filterWorklistKpi(clients: any[], kpi: WorklistKpi, options: Options): any[] {
  if (kpi === "all") return clients;
  const { serviceKey, variant, currentMonth, stages, periodCounts } = options;

  return clients.filter((client) => {
    const service = enabledService(client, serviceKey);
    if (!service) return false;
    const counts = periodCounts[`${client.id}:${serviceKey}`] || [];

    if (variant === "t9") {
      const expected = Number(service.expectedAnnual || 0);
      const processed = counts.reduce((sum, count) => sum + Number(count || 0), 0);
      if (kpi === "processed") return processed > 0;
      if (kpi === "remaining") return expected - processed > 0;
      if (kpi === "current_month") return Number(counts[currentMonth] || 0) > 0;
      return false;
    }

    if (variant === "payroll") {
      const workflowKpis: WorklistKpi[] = ["done", "in_progress", "waiting", "delayed", "not_started"];
      if (workflowKpis.includes(kpi)) {
        const categories = payrollMonthCategories(client, serviceKey, periodCounts, stages);
        const target = WORKFLOW_TARGET[kpi];
        // Current selected month is the single source of truth for payroll cards
        // and filtering, in both the current and historical years.
        return categories[currentMonth] === target;
      }
      // Legacy count-based payroll KPIs (retained for backward compatibility).
      const runs = counts.reduce((sum, count) => sum + Number(count || 0), 0);
      const schedules = getPayrollSchedules(client.payrollSchedules?.length ? client.payrollSchedules : client.services);
      const maxPerMonth = (schedules.length ? schedules : [service]).reduce(
        (total, schedule) => total + payrollRunsPerMonth(schedule.frequency || schedule.payPeriodFrequency),
        0,
      );
      const maxRuns = maxPerMonth * 12;
      if (kpi === "runs") return runs > 0;
      if (kpi === "max_runs") return maxRuns > runs;
      if (kpi === "incomplete") return runs < maxRuns;
      if (kpi === "month_runs") return Number(counts[currentMonth] || 0) > 0;
      return false;
    }

    if (kpi === "in_progress") return hasStage(client, serviceKey, "ip", stages);
    if (kpi === "waiting") return hasStage(client, serviceKey, "wc", stages);
    if (kpi === "delayed") return hasStage(client, serviceKey, "dl", stages);
    if (kpi === "done" || kpi === "processed") return hasStage(client, serviceKey, "dn", stages);
    if (kpi === "not_started") {
      const months = activeMonths(service);
      const values = stages[`${client.id}:${serviceKey}`] || [];
      return months.has(currentMonth) && (values[currentMonth] || "") === "";
    }
    return false;
  });
}
