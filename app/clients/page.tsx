"use client";

import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import type { Client, ClientType } from "@/lib/types";
import {
  filterClients,
  matchesClientSearch,
  getGroups,
  getStaffOptions,
  getStats,
} from "@/lib/data";
import { useClients } from "@/hooks/use-clients-context";
import ClientSlideover from "@/components/client-slideover";
import ClientModal from "@/components/client-modal";
import { PageSkeleton } from "@/components/loading-skeleton";
import { clientKpiFilter, type ClientKpi } from "@/lib/client-kpi-filter";
import { exportClientCsv } from "@/lib/export-csv";
import { Icon } from "@/components/practiceops/icons";

type DisplayItem =
  | { kind: "group"; name: string; clients: Client[] }
  | { kind: "single"; client: Client };

export default function ClientsPage() {
  const [canEditClientData, setCanEditClientData] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/me").then(r => r.ok ? r.json() : null).then(me => {
      if (!cancelled) setCanEditClientData(me?.allowEditClientData === true);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // ── State from Supabase API ──
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<ClientType | "All">("All");
  const [staffFilter, setStaffFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("All"); // "All" | "active" | "inactive"
  const [kpiFilter, setKpiFilter] = useState<ClientKpi>("all");
  const { clients, setClients, updateClient, updateServiceMonth, deleteClient: deleteFromState, addClient, loading, stats } = useClients();
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkMode, setBulkMode] = useState(false);
  const [slideoverOpen, setSlideoverOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const debounceRef = useRef<Record<string, any>>({});

  // Compute stats from full client data
  const computedStats = useMemo(() => getStats(clients), [clients]);

  // ── Bulk selection helpers ──
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const selectAll = () => {
    const allIds = new Set(filteredClients.map((c: any) => c.id));
    setSelectedIds(prev => prev.size === allIds.size ? new Set() : allIds);
  };
  const bulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} selected client(s)? This cannot be undone.`)) return;
    const ids = Array.from(selectedIds).join(",");
    const r = await fetch(`/api/clients?ids=${ids}`, { method: "DELETE" });
    const json = await r.json();
    if (json.success) {
      setSelectedIds(new Set());
      // Remove from local state
      setClients((prev: any[]) => prev.filter((c: any) => !selectedIds.has(c.id)));
    } else {
      alert("Delete failed: " + (json.error || "unknown error"));
    }
  };

  const groups = useMemo(() => getGroups(clients), [clients]);
  const staffOptions = useMemo(() => getStaffOptions(clients), [clients]);

  const filteredClients = useMemo(() => {
    const clientsMatchingFilters = filterClients(clientKpiFilter(clients, kpiFilter), {
      type: typeFilter,
      staff: staffFilter,
      status: statusFilter,
    });

    return clientsMatchingFilters.filter(client => matchesClientSearch(client, search));
  }, [clients, kpiFilter, search, typeFilter, staffFilter, statusFilter]);

  // Group filtered clients: multi-client groups become one group card, singles stay as-is
  const displayItems = useMemo((): DisplayItem[] => {
    const grouped = new Map<string, Client[]>();
    const singles: Client[] = [];
    for (const c of filteredClients) {
      const g = (c.group || "").trim();
      if (g && g.toLowerCase() !== "unassigned") {
        if (!grouped.has(g)) grouped.set(g, []);
        grouped.get(g)!.push(c);
      } else {
        singles.push(c);
      }
    }
    const items: DisplayItem[] = [];
    for (const [name, members] of grouped) {
      items.push({ kind: "group", name, clients: members });
    }
    singles.sort((a, b) => a.name.localeCompare(b.name));
    for (const c of singles) items.push({ kind: "single", client: c });
    const groupItems = items.filter((i): i is { kind: "group"; name: string; clients: Client[] } => i.kind === "group");
    const singleItems = items.filter((i): i is { kind: "single"; client: Client } => i.kind === "single");
    groupItems.sort((a, b) => a.name.localeCompare(b.name));
    return [...groupItems, ...singleItems];
  }, [filteredClients]);

  const selectedClient = useMemo(
    () => (selectedClientId ? clients.find(c => c.id === selectedClientId) ?? null : null),
    [clients, selectedClientId],
  );

  // ── CSV Export ──
  const exportCSV = useCallback(() => {
    exportClientCsv(filteredClients, { filenamePrefix: "TAP Clients" });
  }, [filteredClients]);

  // ── Handlers ──
  function openSlideover(id: string) {
    setSelectedClientId(id);
    setSlideoverOpen(true);
  }

  function closeSlideover() {
    setSlideoverOpen(false);
    setSelectedClientId(null);
  }

  function openAddModal() {
    if (!canEditClientData) return;
    setModalOpen(true);
  }

  const handleSlideoverSave = useCallback((updated: Client) => {
    // Debounce both local state AND network persist - avoid re-render on every keystroke
    const key = `save_${updated.id}`;
    if (debounceRef.current[key]) clearTimeout(debounceRef.current[key]);
    debounceRef.current[key] = setTimeout(async () => {
      delete debounceRef.current[key];
      updateClient(updated.id, updated);
      try {
        const res = await fetch("/api/clients", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updated),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          console.error("PUT /api/clients failed:", res.status, errData);
        }
      } catch (e) {
        console.error("Failed to save client:", e);
      }
    }, 400);
  }, [updateClient]);

  const handleSlideoverDelete = useCallback(async (clientId: string) => {
    try {
      await fetch(`/api/clients?id=${clientId}`, { method: "DELETE" });
    } catch {}
    deleteFromState(clientId);
    setSelectedClientId(null);
  }, [deleteFromState]);

  const handleModalSave = useCallback(async (data: Omit<Client, "id" | "cid">) => {
    const services = (data as any).services || [];
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error || `Client creation failed (${res.status})`);
      }
      const { client } = await res.json();
      const newClient: Client = {
        ...data,
        id: client.id || "c" + Date.now(),
        cid: client.cid || "CID-" + Math.floor(1000 + Math.random() * 9000),
        status: "active",
      } as Client;
      // Persist services before treating the client as saved in UI state.
      if (services.length > 0) {
        const servicesRes = await fetch("/api/clients", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: newClient.id, services }),
        });
        if (!servicesRes.ok) {
          const error = await servicesRes.json().catch(() => ({}));
          throw new Error(error.error || `Client services failed to save (${servicesRes.status})`);
        }
      }
      addClient(newClient);
    } catch (e) {
      console.error("POST /api/clients failed:", e);
      throw e;
    }
  }, [addClient]);

  return (
    <div>
      {loading ? (
        <PageSkeleton rows={6} />
      ) : (
        <>
          {/* ── Stats: each card filters the list (design: .stat in a grid) ── */}
          <div className="gauto">
            <StatCard label="Total clients" detail="in your view" value={computedStats.total} active={kpiFilter === "all"} onClick={() => setKpiFilter("all")} />
            <StatCard label="Business" detail="entities" value={computedStats.business} active={kpiFilter === "business"} onClick={() => setKpiFilter("business")} />
            <StatCard label="Personal" detail="individuals" value={computedStats.personal} active={kpiFilter === "personal"} onClick={() => setKpiFilter("personal")} />
            <StatCard label="Financials" detail="the recurring core" value={computedStats.financialsCount} active={kpiFilter === "financials"} onClick={() => setKpiFilter("financials")} />
            <StatCard label="Payroll" value={computedStats.payrollCount} active={kpiFilter === "payroll"} onClick={() => setKpiFilter("payroll")} />
            <StatCard label="Sales Tax" value={computedStats.salesTaxCount} color="var(--amber)" active={kpiFilter === "sales_tax"} onClick={() => setKpiFilter("sales_tax")} />
            <StatCard label="1099s" value={computedStats.t9Count} active={kpiFilter === "1099s"} onClick={() => setKpiFilter("1099s")} />
            <StatCard label="Renditions" value={computedStats.renditionsCount} active={kpiFilter === "renditions"} onClick={() => setKpiFilter("renditions")} />
            <StatCard label="Annual Reports" value={computedStats.annualReportsCount} active={kpiFilter === "annual_reports"} onClick={() => setKpiFilter("annual_reports")} />
          </div>

          {/* ── Controls: search, filters, actions ── */}
          <div className="controls">
            <div className="searchbox">
              <Icon name="search" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search client or group…"
              />
            </div>

            <div className="seg">
              {(["All", "Business", "Personal"] as const).map((t) => (
                <button key={t} onClick={() => setTypeFilter(t)} className={typeFilter === t ? "on" : ""}>{t}</button>
              ))}
            </div>

            <select value={staffFilter} onChange={(e) => setStaffFilter(e.target.value)} className="inp" style={{ width: "auto" }}>
              <option value="">All staff</option>
              {staffOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>

            <div className="seg">
              {(["All", "active", "inactive"] as const).map((s) => (
                <button key={s} onClick={() => setStatusFilter(s)} className={statusFilter === s ? "on" : ""}>
                  {s === "All" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>

            <button onClick={exportCSV} className="btn alt" title={`Export ${filteredClients.length} filtered clients (CSV)`}>Export to Excel</button>
            {canEditClientData && <button onClick={openAddModal} className="btn brand">＋ Add client</button>}
          </div>

          {/* ── Count line + bulk actions ── */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div className="count">
              {filteredClients.length} client{filteredClients.length !== 1 ? "s" : ""} shown
            </div>
            {canEditClientData && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
                <button onClick={() => { setBulkMode(!bulkMode); setSelectedIds(new Set()); }} className={`btn sm ${bulkMode ? "brand" : "alt"}`}>
                  {bulkMode ? "✓ Bulk mode on" : "Bulk actions"}
                </button>
                {bulkMode && (
                  <>
                    <button onClick={selectAll} className="lnk">
                      {selectedIds.size === filteredClients.length && filteredClients.length > 0
                        ? "Deselect all"
                        : `Select all (${filteredClients.length})`}
                    </button>
                    {selectedIds.size > 0 && (
                      <button onClick={bulkDelete} className="btn sm" style={{ background: "var(--red)", borderColor: "var(--red)", color: "#fff" }}>
                        Delete {selectedIds.size} selected
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* ── Client cards ── */}
          {displayItems.length > 0 ? (
            <div className="cgrid">
              {displayItems.map((item) =>
                item.kind === "group" ? (
                  <GroupCard
                    key={item.name}
                    groupName={item.name}
                    clients={item.clients}
                    onClientClick={(id) => openSlideover(id)}
                    selectedIds={bulkMode ? selectedIds : undefined}
                    toggleSelect={bulkMode ? toggleSelect : undefined}
                  />
                ) : (
                  <ClientCard
                    key={item.client.id}
                    client={item.client}
                    onClick={() => openSlideover(item.client.id)}
                    selected={bulkMode ? selectedIds.has(item.client.id) : undefined}
                    onToggleSelect={bulkMode ? toggleSelect : undefined}
                  />
                )
              )}
            </div>
          ) : (
            <div className="bare">
              {search
                ? `No results for "${search}". Try a different search term.`
                : "Nothing matches those filters. Try clearing the search."}
              {(search || typeFilter !== "All" || staffFilter || statusFilter !== "All") && (
                <div style={{ marginTop: 12 }}>
                  <button onClick={() => { setSearch(""); setTypeFilter("All"); setStaffFilter(""); setStatusFilter("All"); }} className="lnk">
                    Clear all filters
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Slide-over detail panel ── */}
          {selectedClient && (
            <ClientSlideover
              client={selectedClient}
              open={slideoverOpen}
              onClose={closeSlideover}
              onSave={canEditClientData ? handleSlideoverSave : undefined}
              onDelete={canEditClientData ? handleSlideoverDelete : undefined}
              onStageChange={canEditClientData ? ((clientId, serviceKey, monthIdx, stage) => updateServiceMonth(clientId, serviceKey as any, monthIdx, stage as any)) : undefined}
              canEditClientData={canEditClientData}
            />
          )}

          {/* ── Add Client modal ── */}
          {canEditClientData && <ClientModal
            open={modalOpen}
            onClose={() => setModalOpen(false)}
            onSave={handleModalSave}
          />}
        </>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════
// ── Shared bits (PracticeOps design classes) ──
// ══════════════════════════════════════════════
const PILL: Record<string, [className: string, label: string]> = {
  financials: ["p-fin", "FINANCIALS"],
  payroll: ["p-pr", "PAYROLL"],
  sales_tax: ["p-stx", "SALES TAX"],
  tax_returns: ["p-tax", "TAX RETURN"],
  "1099s": ["p-t9", "1099S"],
  renditions: ["p-rend", "RENDITIONS"],
  annual_reports: ["p-rend", "ANNUAL REPORT"],
};

function ServicePills({ keys }: { keys: string[] }) {
  if (keys.length === 0) return <span className="pill p-rend">NO SERVICES</span>;
  return (
    <>
      {keys.map((key) => {
        const [className, label] = PILL[key] || ["p-rend", key.toUpperCase()];
        return <span key={key} className={`pill ${className}`}>{label}</span>;
      })}
    </>
  );
}

function TypeTag({ type }: { type: Client["type"] }) {
  return <span className={`tag ${type === "Business" ? "t-biz" : "t-per"}`}>{type === "Business" ? "BIZ" : "PERS"}</span>;
}

function SelectBox({ checked, onToggle }: { checked: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      aria-label={checked ? "Deselect" : "Select"}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      style={{
        width: 20, height: 20, borderRadius: 5, flex: "none", display: "grid", placeItems: "center",
        border: `1.5px solid ${checked ? "var(--brand)" : "var(--line)"}`,
        background: checked ? "var(--brand)" : "var(--card)", color: "#fff", fontSize: 11, cursor: "pointer",
      }}
    >
      {checked && "✓"}
    </button>
  );
}

function zip4(zip: unknown) {
  const clean = String(zip || "").replace(/\.0+$/, "");
  return clean.length === 5 ? ` ${clean.substring(0, 4)}` : "";
}

// ══════════════════════════════════════════════
// ── Stat Card ──
// ══════════════════════════════════════════════
function StatCard({
  label,
  value,
  detail,
  color,
  active = false,
  onClick,
}: {
  label: string;
  value: number;
  detail?: string;
  color?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className="stat"
      onClick={onClick}
      aria-pressed={active}
      title={`Show ${label.toLowerCase()} clients`}
      style={{
        textAlign: "left",
        cursor: onClick ? "pointer" : "default",
        borderColor: active ? "var(--brand)" : undefined,
        boxShadow: active ? "0 0 0 3px var(--brand-soft)" : undefined,
      }}
    >
      <div className="k">{label}</div>
      <div className="v num" style={{ color }}>{value}</div>
      {detail && <div className="d">{detail}</div>}
    </button>
  );
}

// ══════════════════════════════════════════════
// ── Group Card ──
// ══════════════════════════════════════════════
function GroupCard({
  groupName,
  clients,
  onClientClick,
  selectedIds,
  toggleSelect,
}: {
  groupName: string;
  clients: Client[];
  onClientClick: (id: string) => void;
  selectedIds?: Set<string>;
  toggleSelect?: (id: string) => void;
}) {
  const [popupOpen, setPopupOpen] = useState(false);
  const locations = [...new Set(clients.map((c) => `${c.city}, ${c.state}`).filter(Boolean))];
  const allServices = new Set<string>();
  clients.forEach((c) => c.services.filter((s) => s.enabled && s.key).forEach((s) => allServices.add(s.key!)));
  const services = [...allServices];

  return (
    <>
      <button type="button" className="ccard" onClick={() => setPopupOpen(true)}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 9, alignItems: "flex-start" }}>
          <span className="nm">{groupName}</span>
          <span className="chip c-brand">{clients.length} entities</span>
        </div>
        <div className="meta">{locations.slice(0, 3).join(" · ")}{locations.length > 3 ? ` +${locations.length - 3} more` : ""}</div>
        <div className="pills">
          <ServicePills keys={services.slice(0, 5)} />
          {services.length > 5 && <span className="pill p-rend">+{services.length - 5}</span>}
        </div>
        <div className="who">Click to view <b>{clients.length} entities</b> →</div>
      </button>

      {popupOpen && (
        <div className="mscrim show" onClick={() => setPopupOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={groupName}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, paddingRight: 18 }}>
              <h3>{groupName}</h3>
              <button className="ox" style={{ marginTop: 18 }} onClick={() => setPopupOpen(false)} aria-label="Close">×</button>
            </div>
            <p className="msub">{clients.length} entities · {locations.slice(0, 3).join(" · ")}</p>
            <div className="mform" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {clients.map((c) => {
                const keys = c.services.filter((s) => s.enabled && s.key).map((s) => s.key!);
                const selected = selectedIds?.has(c.id) || false;
                return (
                  <div
                    key={c.id}
                    className="svcrow"
                    style={{ cursor: "pointer", marginBottom: 0, background: selected ? "var(--brand-soft)" : undefined }}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest?.("button")) return;
                      setPopupOpen(false); onClientClick(c.id);
                    }}
                  >
                    {toggleSelect && <SelectBox checked={selected} onToggle={() => toggleSelect(c.id)} />}
                    <div className="sm">
                      <div className="t">{c.name}</div>
                      <div className="d">{c.city}, {c.state}{zip4(c.zip)}</div>
                      {keys.length > 0 && <div className="pills" style={{ marginTop: 6 }}><ServicePills keys={keys} /></div>}
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flex: "none" }}>
                      <TypeTag type={c.type} />
                      {c.active === false && <span className="chip c-red">INACTIVE</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ══════════════════════════════════════════════
// ── Client Card ──
// ══════════════════════════════════════════════
function ClientCard({ client, onClick, selected, onToggleSelect }: { client: Client; onClick: () => void; selected?: boolean; onToggleSelect?: (id: string) => void }) {
  const enabledServices = client.services.filter((s) => s.enabled && s.key);

  // State renewal is tracked on the renditions service.
  const rendSvc = client.services.find(s => s.key === "renditions" && s.enabled);
  const hasStateRenewal = rendSvc?.stateRenewal || false;
  const renewalState = rendSvc?.renewalState || rendSvc?.filingState || "";

  const assignees = [...new Set(enabledServices.map((svc) => svc.processor || svc.assignedTo || "").filter((who) => who && who !== "-"))];

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      className="ccard"
      style={{
        background: selected ? "var(--brand-soft)" : undefined,
        borderColor: selected ? "var(--brand)" : undefined,
        opacity: client.active === false ? 0.6 : 1,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 9, alignItems: "flex-start" }}>
        <span className="nm">{client.name}</span>
        <span style={{ display: "flex", gap: 6, alignItems: "center", flex: "none" }}>
          {client.active === false && <span className="chip c-red">INACTIVE</span>}
          <TypeTag type={client.type} />
          {onToggleSelect && <SelectBox checked={selected || false} onToggle={() => onToggleSelect(client.id)} />}
        </span>
      </div>
      <div className="meta">
        <span className="mono">{client.cid || `TP|BS|${String(client.id).padStart(4, "0")}`}</span>
        {" · "}{client.city}, {client.state}{zip4(client.zip)}
      </div>
      <div className="pills">
        <ServicePills keys={enabledServices.map((svc) => svc.key!)} />
        {hasStateRenewal && <span className="pill p-stx">STATE RENEWAL{renewalState ? ` · ${renewalState}` : ""}</span>}
      </div>
      <div className="who">Handled by <b>{assignees.length ? assignees.join(", ") : "Unassigned"}</b></div>
    </div>
  );
}
