export type PayrollCredentialSession = {
  role: string;
  allowedModules: string[];
};

export function canViewPayrollCredentials(session: PayrollCredentialSession): boolean {
  return ["owner", "admin"].includes(session.role.toLowerCase()) || session.allowedModules.includes("Payroll");
}

export function omitPayrollCredentialsFromClientUpdate<T extends { services?: unknown }>(data: T, allowed: boolean): T {
  if (allowed || !Array.isArray(data.services)) return data;
  return {
    ...data,
    services: data.services.map((service: unknown) => {
      if (!service || typeof service !== "object" || (service as Record<string, unknown>).key !== "payroll") return service;
      const safeService = { ...(service as Record<string, unknown>) };
      delete safeService.payrollPassword;
      delete safeService.eftps;
      return safeService;
    }),
  } as T;
}
