export type CanonicalRole = "owner" | "admin" | "manager" | "staff" | "offshore";

export const MODULE_ROUTES: Record<string, string> = {
  "Clients": "/",
  "Workload": "/workload",
  "Timesheet": "/time",
  "Financials": "/fin",
  "Payroll": "/pr",
  "Sales Tax": "/stx",
  "1099s": "/t9",
  "Tax Returns": "/tax",
  "Renditions": "/rend",
  "Annual Reports": "/annual",
  "Vault": "/vault",
  "Users & Access": "/users",
  "Support": "/support",
  "Billing": "/billing",
  "Collections": "/collections",
};

const MODULE_ALIASES: Record<string, string> = {
  clients: "Clients", workload: "Workload", timesheet: "Timesheet", time: "Timesheet",
  fin: "Financials", financials: "Financials", pr: "Payroll", payroll: "Payroll",
  stx: "Sales Tax", "sales tax": "Sales Tax", t9: "1099s", "1099s": "1099s",
  tax: "Tax Returns", btax: "Tax Returns", ptax: "Tax Returns", tax_returns: "Tax Returns",
  rend: "Renditions", renditions: "Renditions", annual: "Annual Reports", "annual reports": "Annual Reports",
  vault: "Vault", users: "Users & Access", "users & access": "Users & Access", support: "Support", billing: "Billing", collections: "Collections",
};

export function normalizeRole(value: unknown): CanonicalRole {
  const role = String(value || "").trim().toLowerCase();
  if (role.includes("owner")) return "owner";
  if (role.includes("admin")) return "admin";
  if (role.includes("manager")) return "manager";
  if (role.includes("offshore") || role.includes("india")) return "offshore";
  return "staff";
}

export function isPowerUser(role: unknown) {
  return ["owner", "admin"].includes(normalizeRole(role));
}

export function canManageUsers(role: unknown, explicitlyGranted = false) {
  return isPowerUser(role) || (normalizeRole(role) === "manager" && explicitlyGranted === true);
}

export function canonicalModule(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!raw || raw === "All") return null;
  return MODULE_ALIASES[raw.toLowerCase()] || (MODULE_ROUTES[raw] ? raw : null);
}

export function effectiveModules(role: unknown, assignedModules: unknown): string[] {
  if (isPowerUser(role)) return Object.keys(MODULE_ROUTES);
  const normalizedRole = normalizeRole(role);
  const assigned = Array.isArray(assignedModules) ? assignedModules : [];
  return [...new Set(assigned
    .map(canonicalModule)
    .filter((module): module is string => Boolean(module && (module !== "Users & Access" || normalizedRole === "manager")))
  )];
}

export function sanitizeModulesForRole(role: unknown, modules: unknown): string[] {
  return effectiveModules(role, modules);
}

/**
 * Manager-safe module sanitization. Managers may edit assigned modules for
 * existing non-power users, but they may never grant (or revoke) the
 * role-controlled "Users & Access" module — an existing assignment is
 * preserved, otherwise it is stripped.
 */
export function sanitizeManagerModules(
  targetRole: unknown,
  existingModules: unknown,
  requestedModules: unknown,
): string[] {
  const role = normalizeRole(targetRole);
  const existing = effectiveModules(role, existingModules);
  const hadUsersAccess = existing.includes("Users & Access");
  const requested = sanitizeModulesForRole(role, requestedModules).filter(
    (module) => module !== "Users & Access",
  );
  if (hadUsersAccess) requested.push("Users & Access");
  return [...new Set(requested)];
}

export function moduleForPathname(pathname: string): string | null {
  // Contacts is a second Clients surface, not an independently assignable module.
  if (pathname === "/contacts") return "Clients";
  if (pathname.startsWith("/support/")) return "Support";
  if (pathname.startsWith("/billing/")) return "Billing";
  if (pathname.startsWith("/collections/")) return "Collections";
  const exact = Object.entries(MODULE_ROUTES).find(([, route]) => route === pathname)?.[0];
  return exact || null;
}

export function isPublicOrSelfServicePath(pathname: string) {
  return pathname === "/settings" || pathname.startsWith("/login") || pathname.startsWith("/auth");
}

export function canAccessPathname(role: unknown, modules: unknown, pathname: string) {
  if (isPublicOrSelfServicePath(pathname)) return true;
  const module = moduleForPathname(pathname);
  return Boolean(module && effectiveModules(role, modules).includes(module));
}

export function firstAllowedRoute(role: unknown, modules: unknown) {
  return effectiveModules(role, modules).map(module => MODULE_ROUTES[module]).find(Boolean) || "/time";
}
