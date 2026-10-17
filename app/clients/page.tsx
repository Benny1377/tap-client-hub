"use client";

import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import type { Client, ClientType, ServiceKey } from "@/lib/types";
import {
  SERVICE_META,
  filterClients,
  matchesClientSearch,
  getGroups,
  getStaffOptions,
  getStats,
  deleteVaultEntriesByClient,
} from "@/lib/data";
import { useClients } from "@/hooks/use-clients-context";
import ClientSlideover from "@/components/client-slideover";
import ClientModal from "@/components/client-modal";
import { PageSkeleton } from "@/components/loading-skeleton";
import { clientKpiFilter, type ClientKpi } from "@/lib/client-kpi-filter";
import { exportClientCsv } from "@/lib/export-csv";

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
    try {
      deleteVaultEntriesByClient(clientId);
    } catch {}
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
    <div className="space-y-6">
      {loading ? (
        <PageSkeleton rows={6} />
      ) : (
        <>
          {/* ── Stats row: Total · Business · Personal · Monthly Financials · Behind this month ── */}
          <div className="flex flex-wrap gap-[10px] mt-4">
            <StatCard label="Total clients" value={computedStats.total} color="var(--ink)" active={kpiFilter === "all"} onClick={() => setKpiFilter("all")} />
            <StatCard label="Business" value={computedStats.business} color="var(--teal)" active={kpiFilter === "business"} onClick={() => setKpiFilter("business")} />
            <StatCard label="Personal" value={computedStats.personal} color="var(--blue)" active={kpiFilter === "personal"} onClick={() => setKpiFilter("personal")} />
            <StatCard label="Financials" value={computedStats.financialsCount} color="var(--teal)" active={kpiFilter === "financials"} onClick={() => setKpiFilter("financials")} />
            <StatCard label="Payroll" value={computedStats.payrollCount} color="var(--blue)" active={kpiFilter === "payroll"} onClick={() => setKpiFilter("payroll")} />
            <StatCard label="Sales Tax" value={computedStats.salesTaxCount} color="var(--amber)" active={kpiFilter === "sales_tax"} onClick={() => setKpiFilter("sales_tax")} />
            <StatCard label="1099s" value={computedStats.t9Count} color="var(--ink)" active={kpiFilter === "1099s"} onClick={() => setKpiFilter("1099s")} />
            <StatCard label="Renditions" value={computedStats.renditionsCount} color="var(--green)" active={kpiFilter === "renditions"} onClick={() => setKpiFilter("renditions")} />
            <StatCard label="Annual Reports" value={computedStats.annualReportsCount} color="#7c3aed" active={kpiFilter === "annual_reports"} onClick={() => setKpiFilter("annual_reports")} />
          </div>

          {/* ── Controls: Search + Filters + Actions ── */}
          <div className="flex flex-wrap gap-[10px] items-center mt-4 mb-1">
            {/* Search with magnifier icon */}
            <div className="search">
              <span className="mag">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </span>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search client or group…"
              />
            </div>

            {/* Type filter segmented toggle */}
            <div className="seg">
              {(["All", "Business", "Personal"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTypeFilter(t)}
                  className={typeFilter === t ? "on" : ""}
                >
                  {t}
                </button>
              ))}
            </div>

            {/* Staff dropdown */}
            <select
              value={staffFilter}
              onChange={(e) => setStaffFilter(e.target.value)}
              className="pick"
            >
              <option value="">All staff</option>
              {staffOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>

            {/* Status filter */}
            <div className="seg">
              {(["All", "active", "inactive"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={statusFilter === s ? "on" : ""}
                >
                  {s === "All" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>

            {/* Actions */}
            {canEditClientData && <button onClick={openAddModal} className="btn" style={{
              all: "unset", cursor: "pointer", background: "var(--ink)", color: "#fff",
              padding: "10px 16px", borderRadius: 11, fontWeight: 600, fontSize: "13.5px",
              display: "inline-flex", gap: 7, alignItems: "center",
            }}>
              ＋ Add client
            </button>}

            <button onClick={exportCSV} title="Export to Excel (CSV)" style={{
              all: "unset", cursor: "pointer", background: "var(--card)", color: "var(--ink)",
              padding: "10px 14px", borderRadius: 11, fontWeight: 500, fontSize: "13px",
              border: "1px solid var(--line)", display: "inline-flex", gap: 6, alignItems: "center",
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Export {filteredClients.length} filtered
            </button>
          </div>

          {/* ── Count line ── */}
          <div className="count" style={{ color: "var(--muted)", fontSize: 13, margin: "12px 2px 6px" }}>
            {filteredClients.length} client{filteredClients.length !== 1 ? "s" : ""} shown
          </div>

          {/* ── Bulk action bar ── */}
          {canEditClientData && <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 2px 6px", minHeight: 30 }}>
            <button
              onClick={() => { setBulkMode(!bulkMode); setSelectedIds(new Set()); }}
              style={{
                fontSize: 12, fontWeight: 600, cursor: "pointer",
                background: bulkMode ? "var(--teal)" : "none",
                border: bulkMode ? "1px solid var(--teal)" : "1px solid var(--line)",
                color: bulkMode ? "#fff" : "var(--muted)",
                padding: "4px 12px", borderRadius: 6,
              }}
            >
              {bulkMode ? "✓ Bulk Mode On" : "Bulk Actions"}
            </button>
            {bulkMode && (
              <>
                <button
                  onClick={selectAll}
                  style={{
                    fontSize: 12, fontWeight: 600, cursor: "pointer",
                    background: "none", border: "none", color: "var(--muted)",
                    padding: "4px 8px", borderRadius: 6,
                  }}
                >
                  {selectedIds.size === filteredClients.length && filteredClients.length > 0
                    ? "Deselect all"
                    : `Select all (${filteredClients.length})`}
                </button>
                {selectedIds.size > 0 && (
                  <button
                    onClick={bulkDelete}
                    style={{
                      fontSize: 12, fontWeight: 700, cursor: "pointer",
                      background: "var(--red)", border: "none", color: "#fff",
                      padding: "4px 12px", borderRadius: 6,
                    }}
                  >
                    Delete {selectedIds.size} selected
                  </button>
                )}
              </>
            )}
          </div>}

          {/* ── Client cards grid ── */}
          {displayItems.length > 0 ? (
            <div className="grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))", gap: 12 }}>
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
            /* ── Empty state ── */
            <div className="flex flex-col items-center justify-center py-20 px-6 rounded-xl text-center"
              style={{ backgroundColor: "var(--card)", boxShadow: "var(--shadow)" }}>
              <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: "var(--teal-soft)" }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="1.5">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </div>
              <h3 className="text-base font-semibold text-[var(--ink)] mb-1">No clients found</h3>
              <p className="text-sm text-[var(--muted)] max-w-xs">
                {search
                  ? `No results for "${search}". Try a different search term.`
                  : "No clients match the current filters. Try adjusting your filters."}
              </p>
              {(search || typeFilter !== "All" || staffFilter || statusFilter !== "All") && (
                <button
                  onClick={() => { setSearch(""); setTypeFilter("All"); setStaffFilter(""); setStatusFilter("All"); }}
                  className="mt-4 text-sm font-medium text-[var(--teal)] hover:underline"
                >
                  Clear all filters
                </button>
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
// ── Stat Card ──
// ══════════════════════════════════════════════
function StatCard({
  label,
  value,
  color,
  active = false,
  onClick,
}: {
  label: string;
  value: number;
  color?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className="statcard"
      onClick={onClick}
      aria-pressed={active}
      title={`Show ${label.toLowerCase()} clients`}
      style={{
        cursor: onClick ? "pointer" : "default",
        border: active ? `2px solid ${color || "var(--teal)"}` : "1px solid var(--line)",
        boxShadow: active ? "0 0 0 2px var(--teal-soft)" : undefined,
      }}
    >
      <div className="sn" style={{ color: color || "var(--ink)" }}>
        {value}
      </div>
      <div className="sl">
        {label}
      </div>
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

  return (
    <>
      <div
        className="group p-[15px_16px] border"
        style={{
          backgroundColor: "var(--card)",
          borderColor: "var(--line)",
          borderRadius: "14px",
          boxShadow: "0 1px 2px rgba(33,31,26,0.04)",
          transition: "transform 0.14s, box-shadow 0.14s, border-color 0.14s",
          cursor: "pointer",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "translateY(-2px)";
          e.currentTarget.style.boxShadow = "var(--shadow)";
          e.currentTarget.style.borderColor = "#cfc7b5";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "";
          e.currentTarget.style.boxShadow = "0 1px 2px rgba(33,31,26,0.04)";
          e.currentTarget.style.borderColor = "var(--line)";
        }}
        onClick={() => setPopupOpen(true)}
      >
        <div className="flex items-start justify-between gap-2 mb-[3px]">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <h3 className="text-[16.5px] font-semibold text-[var(--ink)] leading-tight truncate"
              style={{ fontFamily: '"Fraunces", Georgia, serif' }}>
              {groupName}
            </h3>
          </div>
          <span className="shrink-0 inline-flex text-[10.5px] font-bold px-[9px] py-[3px] rounded-[20px]"
            style={{ backgroundColor: "var(--teal-soft)", color: "var(--teal)", letterSpacing: "0.02em" }}>
            {clients.length} entities
          </span>
        </div>

        <div className="flex items-center gap-2 text-[11px] text-[var(--muted)] mb-2">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
          <span>{locations.slice(0, 3).join(" · ")}{locations.length > 3 ? ` +${locations.length - 3} more` : ""}</span>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {[...allServices].slice(0, 5).map((key) => {
            const meta = SERVICE_META[key as ServiceKey];
            if (!meta) return null;
            return (
              <span key={key}
                className="inline-flex text-[10.5px] font-bold px-2 py-[3px] rounded-[20px]"
                style={{ backgroundColor: meta.pillBg, color: meta.pillColor, letterSpacing: "0.02em" }}
                title={meta.label}>
                {meta.label}
              </span>
            );
          })}
          {allServices.size > 5 && (
            <span className="text-[10px] text-[var(--muted)]">+{allServices.size - 5} more</span>
          )}
          {allServices.size === 0 && (
            <span className="text-[10px] text-[var(--muted)] italic">No services</span>
          )}
        </div>

        <div className="mt-2 text-[10px] text-[var(--muted)]" style={{ letterSpacing: "0.02em" }}>
          Click to view {clients.length} entities →
        </div>
      </div>

      {popupOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.35)" }}
          onClick={() => setPopupOpen(false)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full mx-4 max-h-[80vh] flex flex-col"
            style={{ animation: "fadeIn 0.12s ease-out" }}
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--line)] shrink-0">
              <h2 className="text-lg font-semibold text-[var(--ink)] truncate"
                style={{ fontFamily: '"Fraunces", Georgia, serif' }}>
                {groupName}
              </h2>
              <span className="shrink-0 inline-flex text-[10.5px] font-bold px-[9px] py-[3px] rounded-[20px]"
                style={{ backgroundColor: "var(--teal-soft)", color: "var(--teal)" }}>
                {clients.length} entities
              </span>
              <button onClick={() => setPopupOpen(false)}
                className="shrink-0 ml-3 p-1 rounded-lg hover:bg-[var(--teal-soft)] transition-colors"
                style={{ lineHeight: 1, fontSize: 18, color: "var(--muted)" }}>
                ✕
              </button>
            </div>
            <div className="overflow-y-auto p-3 space-y-2 flex-1">
              {clients.map((c) => {
                const enabledSvcs = c.services.filter((s) => s.enabled && s.key).map((s) => SERVICE_META[s.key as ServiceKey]).filter(Boolean);
                return (
                <div key={c.id}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest?.("button")) return;
                    setPopupOpen(false); onClientClick(c.id);
                  }}
                  className="flex items-center justify-between p-3 rounded-lg cursor-pointer hover:bg-[var(--teal-soft)]/30 transition-colors border border-[var(--line)]"
                  style={{ backgroundColor: selectedIds?.has(c.id) ? "var(--teal-soft)" : undefined }}
                >
                  {toggleSelect && (
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleSelect(c.id); }}
                      style={{
                        width: 18, height: 18, borderRadius: 4, flexShrink: 0, marginRight: 10,
                        border: selectedIds?.has(c.id) ? "1.5px solid var(--teal)" : "1.5px solid var(--line)",
                        background: selectedIds?.has(c.id) ? "var(--teal)" : "transparent",
                        cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 10, color: "#fff", lineHeight: 1,
                      }}
                    >
                      {selectedIds?.has(c.id) && "✓"}
                    </button>
                  )}
                  <div className="min-w-0 flex-1 pr-2">
                    <p className="text-sm font-semibold text-[var(--ink)]">{c.name}</p>
                    <p className="text-[11px] text-[var(--muted)]">{c.city}, {c.state}{c.zip && String(c.zip).replace(/\.0+$/, "").length === 5 ? ` ${String(c.zip).replace(/\.0+$/, "").substring(0, 4)}` : ""}</p>
                    {enabledSvcs.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {enabledSvcs.map((m) => (
                          <span key={m.label}
                            className="inline-flex text-[9.5px] font-bold px-[6px] py-[2px] rounded-[20px]"
                            style={{ backgroundColor: m.pillBg, color: m.pillColor, letterSpacing: "0.02em" }}>
                            {m.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`badge ${c.type === "Business" ? "b-biz" : "b-per"}`}>
                      {c.type === "Business" ? "BIZ" : "PERS"}
                    </span>
                    {c.active === false && (
                      <span style={{
                        fontSize: "9px", fontWeight: 700, letterSpacing: "0.05em",
                        padding: "2px 7px", borderRadius: 10,
                        background: "#fce8e6", color: "#c62828",
                        border: "1px solid #f5c6cb",
                      }}>
                        INACTIVE
                      </span>
                    )}
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </>
  );
}

// ══════════════════════════════════════════════
// ── Client Card ──
// ══════════════════════════════════════════════
function ClientCard({ client, onClick, selected, onToggleSelect }: { client: Client; onClick: () => void; selected?: boolean; onToggleSelect?: (id: string) => void }) {
  const enabledServices = client.services.filter((s) => s.enabled && s.key);

  // Check for state renewal on annual reports (renditions)
  const rendSvc = client.services.find(s => s.key === "renditions" && s.enabled);
  const hasStateRenewal = rendSvc?.stateRenewal || false;
  const renewalState = rendSvc?.renewalState || rendSvc?.filingState || "";

  // Get unique assignees across all enabled services
  const assignees = useMemo(() => {
    const set = new Set<string>();
    for (const svc of enabledServices) {
      const who = svc.processor || svc.assignedTo || "-";
      if (who && who !== "-") set.add(who);
    }
    return [...set];
  }, [client]);

  const pillClass = (key: string): string => {
    const map: Record<string, string> = {
      financials: "p-fin",
      payroll: "p-pr",
      sales_tax: "p-stx",
      tax_returns: "p-tax",
      "1099s": "p-9",
      renditions: "p-rn",
    };
    return map[key] || "";
  };

  const pillLabel = (key: string): string => {
    const map: Record<string, string> = {
      financials: "FINANCIALS",
      payroll: "PAYROLL",
      sales_tax: "SALES TAX",
      tax_returns: "TAX RETURNS",
      "1099s": "1099",
      renditions: "RENDITION",
    };
    return map[key] || key;
  };

  return (
    <div onClick={onClick} className="ccard" style={{
      backgroundColor: selected ? "var(--teal-soft)" : "var(--card)",
      border: selected ? "2px solid var(--teal)" : "1px solid var(--line)",
      borderRadius: 14,
      padding: "15px 16px",
      boxShadow: "0 1px 2px rgba(33,31,26,0.04)",
      transition: ".14s",
      cursor: "pointer",
      position: "relative",
      opacity: client.active === false ? 0.55 : 1,
      filter: client.active === false ? "grayscale(60%)" : "none",
    }}>
      {/* Selection checkbox */}
      {onToggleSelect && (
        <button
          onClick={(e) => { e.stopPropagation(); onToggleSelect(client.id); }}
          style={{
            position: "absolute", top: 8, right: 8,
            width: 20, height: 20, borderRadius: 4,
            border: selected ? "1.5px solid var(--teal)" : "1.5px solid var(--line)",
            background: selected ? "var(--teal)" : "transparent",
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 11, color: "#fff", lineHeight: 1,
          }}
        >
          {selected && "✓"}
        </button>
      )}
      {/* Name only */}
      <div className="nm" style={{ fontFamily: '"Fraunces",Georgia,serif', fontWeight: 600, fontSize: "16.5px", lineHeight: 1.2, marginBottom: 3 }}>
        {client.name}
      </div>

      {/* Meta row: CID · city, state */}
      <div className="meta" style={{ color: "var(--muted)", fontSize: "12.5px" }}>
        <span className="mono" style={{ color: "#9a9484" }}>{client.cid || `TP|BS|${String(client.id).padStart(4,"0")}`}</span>
        {" · "}{client.city}, {client.state}{client.zip && String(client.zip).replace(/\.0+$/, "").length === 5 ? ` ${String(client.zip).replace(/\.0+$/, "").substring(0, 4)}` : ""}
      </div>

      {/* Service pills + type badge at bottom-right */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 10 }}>
        <div className="pills" style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {enabledServices.map((svc) => {
            const key = svc.key!;
            const pc = pillClass(key);
            return (
              <span key={key} className={`pill ${pc}`} style={{
                fontSize: "10.5px", fontWeight: 700, letterSpacing: "0.02em", padding: "3px 8px", borderRadius: 20,
              }}>
                {pillLabel(key)}
              </span>
            );
          })}
          {enabledServices.length === 0 && (
            <span className="pill" style={{ fontSize: "10.5px", fontWeight: 700, padding: "3px 8px", borderRadius: 20, background: "#eee", color: "#888" }}>
              No services
            </span>
          )}
          {hasStateRenewal && (
            <span style={{
              fontSize: "9.5px", fontWeight: 700, letterSpacing: "0.03em",
              padding: "3px 8px", borderRadius: 20,
              background: "#fef3c7", color: "#92400e",
              whiteSpace: "nowrap",
            }}>
              STATE RENEWAL{renewalState ? ` · ${renewalState}` : ""}
            </span>
          )}
        </div>
        <span className={`badge ${client.type === "Business" ? "b-biz" : "b-per"}`} style={{ flexShrink: 0 }}>
          {client.type === "Business" ? "BIZ" : "PERS"}
        </span>
        {client.active === false && (
          <span style={{
            flexShrink: 0, fontSize: "9px", fontWeight: 700, letterSpacing: "0.05em",
            padding: "2px 7px", borderRadius: 10,
            background: "#fce8e6", color: "#c62828",
            border: "1px solid #f5c6cb",
          }}>
            INACTIVE
          </span>
        )}
      </div>
    </div>
  );
}
