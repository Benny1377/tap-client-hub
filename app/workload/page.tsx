"use client";

import { useState, useMemo, useEffect } from "react";
import { useClients } from "@/hooks/use-clients-context";
import { SERVICE_META } from "@/lib/data";
import type { ServiceKey } from "@/lib/types";
import { PageSkeleton } from "@/components/loading-skeleton";

// ── Types ──
interface Profile {
  id: string;
  name: string;
  role: string;
  location: string;
  mgr: string; // reporting manager display name
  modules: string[];
  status: string;
}

interface StaffSummary {
  name: string;
  initials: string;
  clientCount: number;
  totalTouchpoints: number;
  services: Record<string, number>;
  serviceClients: Record<string, string[]>;
  clients: string[];
}

interface TeamRollup {
  manager: string;
  members: StaffSummary[];
  totalEffort: number;
}

// ── Frequency → annual touchpoint multiplier ──
const FREQ_LOAD: Record<string, number> = {
  Weekly: 52,
  "Bi-Weekly": 26,
  "Bi-Weekly A": 26,
  "Bi-Weekly B": 26,
  "Semi-Monthly": 24,
  Monthly: 12,
  Quarterly: 4,
  Yearly: 1,
  Annually: 1,
};

function getFreqLoad(freq: string | undefined | null): number {
  if (!freq) return 12;
  // Normalize case
  const key = freq.trim();
  // Try exact match first
  if (FREQ_LOAD[key]) return FREQ_LOAD[key];
  // Case-insensitive fallback
  const lower = key.toLowerCase();
  if (lower === "weekly" || lower === "week") return 52;
  if (lower === "bi-weekly" || lower === "biweekly" || lower === "bi week" || lower === "bi-weekly a") return 26;
  if (lower === "bi-weekly b") return 26;
  if (lower === "semi-monthly" || lower === "semimonthly") return 24;
  if (lower === "monthly") return 12;
  if (lower === "quarterly") return 4;
  if (lower === "yearly" || lower === "annually" || lower === "annual") return 1;
  return 12;
}

// ── Service colors & metadata ──
const SVCMETA: Record<string, { l: string; ic: string; col: string }> = {
  financials:  { l: "Financials", ic: "📊", col: "var(--green)" },
  payroll:     { l: "Payroll", ic: "💵", col: "var(--blue)" },
  sales_tax:   { l: "Sales Tax", ic: "🧾", col: "var(--amber)" },
  tax_returns: { l: "Tax Return", ic: "📋", col: "#5a4a80" },
  "1099s":     { l: "1099s", ic: "📄", col: "#7a5436" },
  renditions:  { l: "Renditions", ic: "🏠", col: "#3a5a44" },
};

// ── Default initials from name ──
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.substring(0, 2).toUpperCase();
}

export default function WorkloadPage() {
  const { clients, loading: clientsLoading } = useClients();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [expandedService, setExpandedService] = useState<{ name: string; svcKey: string } | null>(null);

  // ── Fetch profiles for reporting manager info ──
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/profile-directory");
        if (!res.ok) throw new Error("Failed to load profiles");
        const data = await res.json();
        if (!cancelled) {
          setProfiles(Array.isArray(data) ? data : []);
          setProfilesLoading(false);
        }
      } catch {
        if (!cancelled) setProfilesLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const loading = clientsLoading || profilesLoading;

  // ── Build staff workload summaries from clients data ──
  const staffLoads = useMemo(() => {
    const byStaff: Record<string, StaffSummary> = {};
    const serviceKeys = Object.keys(SVCMETA) as ServiceKey[];

    for (const client of clients) {
      // Determine assigned staff from client-level field, fallback to first service's assignedTo
      let staffName = (client as any).assignedStaff || "Unassigned";
      if (!staffName || staffName.trim() === "") staffName = "Unassigned";

      if (!byStaff[staffName]) {
        byStaff[staffName] = {
          name: staffName,
          initials: getInitials(staffName),
          clientCount: 0,
          totalTouchpoints: 0,
          services: {},
          serviceClients: {},
          clients: [],
        };
        for (const k of serviceKeys) {
          byStaff[staffName].services[k] = 0;
          byStaff[staffName].serviceClients[k] = [];
        }
      }

      const s = byStaff[staffName];
      s.clientCount++;
      s.clients.push(client.name);

      // Sum loads across all enabled services
      for (const svc of (client as any).services || []) {
        if (svc.enabled === false) continue;
        const key = svc.key as ServiceKey;
        if (!key || !SVCMETA[key]) continue;
        const load = getFreqLoad(svc.frequency);
        s.totalTouchpoints += load;
        s.services[key] = (s.services[key] || 0) + load;
        if (!s.serviceClients[key]) s.serviceClients[key] = [];
        s.serviceClients[key].push(client.name);
      }
    }

    // Sort: real staff by total touchpoints descending, then unassigned at end
    const realStaff = Object.values(byStaff).filter(s => s.name !== "Unassigned" && s.name !== "Boss");
    realStaff.sort((a, b) => b.totalTouchpoints - a.totalTouchpoints);

    const unassigned = byStaff["Unassigned"];
    const result = [...realStaff];
    if (unassigned) result.push(unassigned);

    return result;
  }, [clients]);

  const maxLoad = useMemo(() => Math.max(1, ...staffLoads.map(s => s.totalTouchpoints)), [staffLoads]);
  const avgLoad = useMemo(() => {
    const real = staffLoads.filter(s => s.name !== "Unassigned" && s.name !== "Boss").length;
    if (!real) return 0;
    const total = staffLoads.filter(s => s.name !== "Unassigned" && s.name !== "Boss").reduce((a, s) => a + s.totalTouchpoints, 0);
    return Math.round(total / real);
  }, [staffLoads]);

  const realStaff = staffLoads.filter(s => s.name !== "Unassigned" && s.name !== "Boss");
  const busiest = realStaff[0];
  const lightest = realStaff[realStaff.length - 1];
  const unassigned = staffLoads.find(s => s.name === "Unassigned");

  // ── Count of clients with active monthly financials ──
  const monthlyFinCount = useMemo(() => {
    let count = 0;
    for (const client of clients) {
      for (const svc of (client as any).services || []) {
        if (svc.key === "financials" && svc.enabled !== false && svc.frequency === "Monthly") {
          count++;
          break;
        }
      }
    }
    return count;
  }, [clients]);

  // ── Team rollups by reporting manager ──
  const teamRollups = useMemo(() => {
    // Build a map: manager name → list of staff member names under them
    const mgrToStaff: Record<string, string[]> = {};
    for (const p of profiles) {
      const mgr = p.mgr || "—";
      if (mgr === "—") continue;
      if (!mgrToStaff[mgr]) mgrToStaff[mgr] = [];
      mgrToStaff[mgr].push(p.name);
    }

    const teams: TeamRollup[] = [];
    // Only include managers who have staff with workload data
    for (const [manager, memberNames] of Object.entries(mgrToStaff)) {
      const members = memberNames
        .map(n => staffLoads.find(s => s.name === n))
        .filter((s): s is StaffSummary => !!s && s.name !== "Unassigned" && s.name !== "Boss");
      if (members.length === 0) continue;
      const totalEffort = members.reduce((a, m) => a + m.totalTouchpoints, 0);
      teams.push({ manager, members, totalEffort });
    }

    // Sort by total effort descending
    teams.sort((a, b) => b.totalEffort - a.totalEffort);
    return teams;
  }, [profiles, staffLoads]);

  if (loading) return <PageSkeleton rows={6} />;

  return (
    <div>
      {/* ── Stats Row ── */}
      <div className="stats" style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
        <div className="statcard">
          <div className="sn">{realStaff.length}</div>
          <div className="sl">Team members</div>
        </div>
        <div className="statcard">
          <div className="sn" style={{ color: "var(--green)" }}>{monthlyFinCount}</div>
          <div className="sl">Monthly Fin Revenue</div>
        </div>
        <div className="statcard">
          <div className="sn" style={{ color: "var(--amber)", fontSize: 20 }}>{busiest?.name || "—"}</div>
          <div className="sl">Busiest</div>
        </div>
        <div className="statcard">
          <div className="sn" style={{ color: "var(--red)" }}>{unassigned?.clientCount || 0}</div>
          <div className="sl">Unassigned</div>
        </div>
      </div>

      {/* ── Insight Card (amber) ── */}
      {busiest && lightest && busiest !== lightest && avgLoad > 0 && (
        <div className="insight" style={{ marginTop: 16 }}>
          <span>💡</span>
          <div>
            <b>{busiest.name}</b> is carrying the heaviest load (~{busiest.totalTouchpoints} touchpoints/yr,
            {Math.round((busiest.totalTouchpoints / avgLoad - 1) * 100)}% above average), while <b>{lightest.name}</b>
            {" "}sits at ~{lightest.totalTouchpoints}. Moving a couple of recurring clients from {busiest.name.split(",")[0]} to{" "}
            {lightest.name.split(",")[0]} would even the team out{unassigned ? `. You also have ${unassigned.clientCount} unassigned client${unassigned.clientCount !== 1 ? "s" : ""} with no owner.` : "."}
          </div>
        </div>
      )}

      {/* ── By team (reporting manager) section ── */}
      {teamRollups.length > 0 && (
        <>
          <div className="sect2" style={{ margin: "26px 0 10px" }}>By team (reporting manager)</div>
          {teamRollups.map(t => (
            <div key={t.manager} className="team">
              <div className="th">
                <span>{t.manager}</span>
                <span className="tt">{t.members.length} member{t.members.length !== 1 ? "s" : ""} · {t.totalEffort} effort pts</span>
              </div>
              {t.members.map(m => (
                <div key={m.name} className="tm">
                  <span style={{ fontWeight: 600 }}>{m.name}</span>
                  <span style={{ color: "var(--muted)" }}>{m.clientCount} client{m.clientCount !== 1 ? "s" : ""} · {m.totalTouchpoints} pts</span>
                </div>
              ))}
            </div>
          ))}
        </>
      )}

      {/* ── Workload by estimated effort ── */}
      <div className="sect2" style={{ margin: "26px 0 10px" }}>Workload by estimated effort</div>

      {/* Legend */}
      <div className="legend">
        {Object.entries(SVCMETA).map(([k, v]) => (
          <span key={k} className="lgd">
            <i style={{ background: v.col }}></i>{v.l}
          </span>
        ))}
        <span className="lgd-note" style={{ marginLeft: "auto", fontStyle: "italic", opacity: .8 }}>bar length = est. annual touchpoints (recurring filings + jobs)</span>
      </div>

      {/* Bars */}
      <div className="panel" style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 16, overflow: "hidden", marginTop: 6, padding: "14px 18px" }}>
        {staffLoads.map(s => {
          const isU = s.name === "Unassigned";
          const diff = avgLoad ? Math.round((s.totalTouchpoints / avgLoad - 1) * 100) : 0;
          const diffTxt = isU ? "unassigned — needs an owner" : (diff > 0 ? `+${diff}% vs avg` : `${diff}% vs avg`);
          const diffColor = isU ? "var(--red)" : diff > 15 ? "var(--amber)" : diff < -15 ? "var(--green)" : "var(--muted)";
          return (
            <div key={s.name} className={`wrow ${isU ? "wrow-u" : ""}`}>
              <div className="wname">
                {isU ? "⚠️ " : ""}{s.name}
                <span className="wsub">{s.clientCount} client{s.clientCount !== 1 ? "s" : ""}</span>
              </div>
              <div className="wtrack">
                {Object.entries(SVCMETA).map(([k, v]) => {
                  const val = s.services[k];
                  if (!val) return null;
                  return <div key={k} className="wseg" style={{ width: `${(val / maxLoad) * 100}%`, background: v.col }}
                    title={`${v.l}: ${val} touchpoints`} />;
                })}
                {Object.values(s.services).reduce((a, b) => a + b, 0) === 0 && (
                  <div className="wseg" style={{ width: 2, background: "var(--line)" }} />
                )}
              </div>
              <div className="wload">
                <b>{s.totalTouchpoints}</b>
                <span className="wdiff" style={{ color: diffColor }}>{diffTxt}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Service mix by person ── */}
      <div className="sect2" style={{ margin: "26px 0 10px" }}>Service mix by person</div>
      <div className="panel" style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 16, overflow: "hidden", marginTop: 6 }}>
        <table>
          <thead>
            <tr>
              <th>Team member</th><th>Clients</th><th>Load / yr</th><th>Services handled</th>
            </tr>
          </thead>
          <tbody>
            {realStaff.map(s => (
              <tr key={s.name}>
                <td className="lname2" style={{ fontWeight: 600 }}>{s.name}</td>
                <td style={{ fontVariantNumeric: "tabular-nums" }}>{s.clientCount}</td>
                <td style={{ fontVariantNumeric: "tabular-nums" }}><b>{s.totalTouchpoints}</b></td>
                <td>
                  <div className="chips2">
                    {Object.entries(SVCMETA).map(([k, v]) => {
                      const cnt = s.services[k];
                      if (!cnt) return null;
                      const isExpanded = expandedService?.name === s.name && expandedService?.svcKey === k;
                      return (
                        <div key={k} style={{ position: "relative" }}>
                          <span
                            className="schip"
                            onClick={() => setExpandedService(isExpanded ? null : { name: s.name, svcKey: k })}
                            style={{
                              "--c": v.col,
                              fontSize: "11.5px", fontWeight: 500, padding: "3px 9px", borderRadius: 20,
                              background: isExpanded ? v.col : "color-mix(in srgb, " + v.col + " 12%, var(--card))",
                              color: isExpanded ? "#fff" : v.col,
                              border: isExpanded ? `1px solid ${v.col}` : `1px solid color-mix(in srgb, ${v.col} 25%, var(--card))`,
                              cursor: "pointer", transition: ".12s", display: "inline-block",
                          } as React.CSSProperties}>
                            {v.ic} {v.l} <b style={{ fontWeight: 700 }}>{cnt}</b>
                          </span>
                          {isExpanded && s.serviceClients?.[k] && (
                            <div style={{
                              position: "absolute", top: "100%", left: 0, zIndex: 10,
                              background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10,
                              boxShadow: "0 4px 16px rgba(0,0,0,.1)", padding: "8px 0",
                              minWidth: 220, maxHeight: 240, overflowY: "auto", marginTop: 4,
                            }}>
                              {s.serviceClients[k].map((cl: string) => (
                                <div key={cl} style={{ padding: "4px 12px", fontSize: 12, whiteSpace: "nowrap" }}>
                                  {cl}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {Object.values(s.services).reduce((a, b) => a + b, 0) === 0 && (
                      <span className="schip" style={{ "--c": "var(--faint)", fontSize: "11.5px", fontWeight: 500, padding: "3px 9px", borderRadius: 20, background: "color-mix(in srgb, var(--faint) 12%, var(--card))", color: "var(--faint)", border: "1px solid color-mix(in srgb, var(--faint) 25%, var(--card))" } as React.CSSProperties}>none</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Fine print ── */}
      <p className="fineprint">
        &ldquo;Load&rdquo; is an estimate of yearly touchpoints: financials = 12, weekly payroll = 52,
        bi-weekly = 26, quarterly sales tax = 4, plus a flat weight for tax returns, 1099s and renditions.
        Adjust the weights to match how your firm actually scopes effort.
      </p>
    </div>
  );
}
