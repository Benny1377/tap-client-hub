"use client";

import { useRouter } from "next/navigation";
import { useClients } from "@/hooks/use-clients-context";
import { Icon } from "./icons";
import { FIRM, type RailItem } from "./apps";

/** Which client service each worklist rail item counts (design: count badge per module). */
const SERVICE_FOR_PATH: Record<string, string> = {
  "/fin": "financials",
  "/pr": "payroll",
  "/stx": "sales_tax",
  "/t9": "1099s",
  "/tax": "tax_returns",
  "/rend": "renditions",
  "/annual": "annual_reports",
};

/** The Operations rail. Counts appear only once the page has loaded client data. */
export function OpsRail({ items, pathname, footer }: { items: Array<RailItem | "sep">; pathname: string; footer: string }) {
  const router = useRouter();
  const { clients, loading } = useClients();
  const hasData = !loading && clients.length > 0;
  const countFor = (href: string): number | null => {
    if (!hasData) return null;
    if (href === "/clients") return clients.length;
    const key = SERVICE_FOR_PATH[href];
    return key ? clients.filter((client) => client.services.some((svc) => svc.key === key && svc.enabled)).length : null;
  };

  return (
    <aside className="rail">
      <div className="rail-lab">Operations</div>
      {items.map((item, index) => {
        if (item === "sep") return <div key={`sep-${index}`} className="rsep" />;
        const count = countFor(item.href);
        return (
          <button key={item.href} className={pathname === item.href ? "on" : ""} onClick={() => router.push(item.href)}>
            <Icon name={item.icon} className="ri" /><span>{item.label}</span>
            {count != null ? <span className="rc">{count}</span> : null}
          </button>
        );
      })}
      <div className="rail-foot">{FIRM.name}<br />{footer}</div>
    </aside>
  );
}
