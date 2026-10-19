// ── TAP Client Hub · shared labels and client-list helpers ──
// (The former mock clients and seed vault logins were removed; all data comes from the API.)

import type { Client, ClientStats, ClientType, ServiceKey } from "./types";

// ── Month labels ──
export const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// ── Service labels & pill colors ──
export const SERVICE_META: Record<ServiceKey, { label: string; pillColor: string; pillBg: string }> = {
  financials:  { label: "Financials",  pillColor: "#1d5734",            pillBg: "var(--green-soft)"  },
  payroll:     { label: "Payroll",     pillColor: "#214b6e",            pillBg: "var(--blue-soft)"   },
  sales_tax:   { label: "Sales Tax",   pillColor: "#8a560f",            pillBg: "var(--amber-soft)"  },
  "1099s":     { label: "1099s",       pillColor: "#7a5436",            pillBg: "#f0e8e2"             },
  renditions:     { label: "Renditions",     pillColor: "#3a5a44",            pillBg: "#e7eee8"             },
  annual_reports: { label: "Annual Reports", pillColor: "#4a4a80",            pillBg: "#e7eaf0"             },
  tax_returns: { label: "Tax Returns", pillColor: "#5a4a80",            pillBg: "#ece7f3"             },
};

// ── Query helpers ──

function normalizeSearchValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(normalizeSearchValue).join(" ");
  return value == null ? "" : String(value).toLowerCase();
}

export function matchesClientSearch(client: Client, search: string): boolean {
  const query = normalizeSearchValue(search);
  if (!query) return true;

  const phoneQuery = query.replace(/\D/g, "");
  if (phoneQuery.length >= 7 && client.phones) {
    for (const phone of client.phones) {
      if (phone.replace(/\D/g, "").includes(phoneQuery)) return true;
    }
  }

  return normalizeSearchValue([
    client.name,
    client.cid,
    client.group,
    client.groupName,
    client.contact,
    client.address,
    client.city,
    client.state,
    client.zip,
  ]).includes(query);
}

export function filterClients(
  clients: Client[],
  opts: {
    search?: string;
    type?: ClientType | "All";
    group?: string;
    staff?: string;
    status?: string;
  } = {},
): Client[] {
  let result = [...clients];

  if (opts.search) {
    const q = opts.search.toLowerCase();
    result = result.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.cid.toLowerCase().includes(q) ||
        c.city.toLowerCase().includes(q) ||
        c.group.toLowerCase().includes(q),
    );
  }

  if (opts.type && opts.type !== "All") {
    result = result.filter((c) => c.type === opts.type);
  }

  if (opts.group) {
    result = result.filter((c) => c.group === opts.group);
  }

  if (opts.staff) {
    result = result.filter((c) => c.assignedStaff === opts.staff);
  }

  if (opts.status === "active") {
    result = result.filter((c) => c.active !== false);
  }

  if (opts.status === "inactive") {
    result = result.filter((c) => c.active === false);
  }

  return result;
}

export function getStats(clients: Client[]): ClientStats {
  const currentMonth = new Date().getMonth(); // 0-indexed

  let monthlyFinancials = 0;
  let behindThisMonth = 0;
  let financialsCount = 0;
  let payrollCount = 0;
  let salesTaxCount = 0;
  let t9Count = 0;
  let renditionsCount = 0;
  let taxReturnsCount = 0;
  let annualReportsCount = 0;

  for (const client of clients) {
    for (const svc of client.services) {
      if (!svc.enabled) continue;
      if (svc.key === "financials") financialsCount++;
      if (svc.key === "payroll") payrollCount++;
      if (svc.key === "sales_tax") salesTaxCount++;
      if (svc.key === "1099s") t9Count++;
      if (svc.key === "renditions") renditionsCount++;
      if (svc.key === "annual_reports") { if ((svc as any).stateRenewal) annualReportsCount++; }
      if (svc.key === "tax_returns") taxReturnsCount++;
    }

    // Financials: check if financials service exists and is active
    const fin = client.services.find((s) => s.key === "financials");
    if (fin?.enabled) {
      const status = fin.months[currentMonth];
      if (status && status !== "na" && status !== "lock") {
        monthlyFinancials++;
      }
    }

    // Behind: any service that's not done/paid/na/lock in current month
    let behind = false;
    for (const svc of client.services) {
      if (!svc.enabled) continue;
      const s = svc.months[currentMonth];
      if (s && s !== "done" && s !== "paid" && s !== "na" && s !== "lock") {
        behind = true;
        break;
      }
    }
    if (behind) behindThisMonth++;
  }

  return {
    total: clients.length,
    business: clients.filter((c) => (c.type || "").toLowerCase() === "business").length,
    personal: clients.filter((c) => (c.type || "").toLowerCase() === "personal").length,
    monthlyFinancials,
    behindThisMonth,
    financialsCount,
    payrollCount,
    salesTaxCount,
    t9Count,
    renditionsCount,
    taxReturnsCount,
    annualReportsCount,
  };
}

export function getGroups(clients: any[]): string[] {
  return [...Array.from(new Set(clients.map((c: any) => c.group)))].sort();
}

/** Get unique staff names from clients */
export function getStaffOptions(clients: any[]): string[] {
  return [...Array.from(new Set(clients.map((c: any) => c.assignedStaff)))].sort();
}
