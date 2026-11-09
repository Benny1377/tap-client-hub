type PayrollScheduleLike = {
  key?: string;
  csId?: string | number;
  frequency?: string;
  payPeriodFrequency?: string;
  paydate?: string;
  payStartDate?: string;
  periodCounts?: number[];
  financialsMonth?: number;
};

export function getPayrollSchedules<T extends PayrollScheduleLike>(services: readonly T[] | null | undefined): (T & { key: "payroll"; csId: string | number })[] {
  return (services || []).filter((service): service is T & { key: "payroll"; csId: string | number } =>
    service.key === "payroll" && service.csId !== undefined && service.csId !== null && String(service.csId).length > 0,
  );
}

export function getPayrollScheduleCountKey(clientId: string, clientServiceId: string | number): string {
  return `${clientId}:payroll:${clientServiceId}`;
}

export function adjustPayrollRunCount(current: number, maximum: number, delta: number): number {
  const boundedMaximum = Math.max(0, Math.trunc(Number.isFinite(maximum) ? maximum : 0));
  const currentCount = Math.max(0, Math.trunc(Number.isFinite(current) ? current : 0));
  const increment = Math.trunc(Number.isFinite(delta) ? delta : 0);
  return Math.min(boundedMaximum, Math.max(0, currentCount + increment));
}
