import type { Client, ClientService, ServiceKey } from "@/lib/types";
import { financialsExportHeaders, financialsExportValues } from "@/lib/financials-export";

const SERVICE_LABELS: Partial<Record<ServiceKey, string>> = {
  tax_returns: "Tax Returns",
  sales_tax: "Sales Tax",
  payroll: "Payroll",
  financials: "Financials",
  renditions: "Annual Reports",
  annual_reports: "Annual Reports",
  "1099s": "1099s",
};

function csvCell(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function serviceFor(client: Client, serviceKey?: ServiceKey): ClientService | undefined {
  return serviceKey ? client.services?.find((service) => service.key === serviceKey) : undefined;
}

export function exportClientCsv(
  clients: Client[],
  options: {
    serviceKey?: ServiceKey;
    filenamePrefix?: string;
    year?: number;
    monthStatuses?: Record<string, readonly unknown[]>;
  },
): void {
  const { serviceKey, filenamePrefix = serviceKey ? SERVICE_LABELS[serviceKey] : "TAP Clients" } = options;
  const includeFinancialMonths = serviceKey === "financials";
  const headers = [
    "Name", "CID", "Type", "Group", "City", "State", "Assigned Staff", "Service",
    "Cadence", "Filing Type", "Filing Month", "Email", "Phone",
    ...(includeFinancialMonths ? financialsExportHeaders() : []),
  ];
  const rows = clients.map((client) => {
    const service = serviceFor(client, serviceKey);
    const row: unknown[] = [
      client.name,
      client.cid,
      client.type,
      client.group,
      client.city,
      client.state,
      service?.assignedTo || client.assignedStaff || "",
      serviceKey ? (SERVICE_LABELS[serviceKey] || serviceKey) : client.services?.filter((service) => service.enabled).map((service) => service.label || service.key).join(", "),
      service?.frequency || "",
      service?.filingType || "",
      service?.filingMonth || "",
      client.emails?.[0] || "",
      client.phones?.[0] || "",
    ];
    if (includeFinancialMonths) {
      row.push(...financialsExportValues(
        service || {},
        options.monthStatuses?.[client.id] || service?.months || [],
        options.year ?? new Date().getFullYear(),
      ));
    }
    return row.map(csvCell).join(",");
  });
  const csv = [headers.map(csvCell).join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${String(filenamePrefix).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${clients.length}-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function serviceLabel(serviceKey: ServiceKey): string {
  return SERVICE_LABELS[serviceKey] || serviceKey;
}
