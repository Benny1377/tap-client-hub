"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type AppOption = { key: string; displayName: string; active: boolean };
type Ticket = {
  id: string;
  number: string;
  appKey: string;
  status: "open" | "in_progress" | "resolved" | "closed";
  priority: "normal" | "urgent";
  category: string | null;
  title: string;
  reporterName: string;
  reporterEmail: string | null;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string | null;
  firstResponseAt: string | null;
  closedAt: string | null;
};
type InboxPayload = { apps: AppOption[]; tickets: Ticket[]; error?: string };

const STATUS_LABELS: Record<Ticket["status"], string> = {
  open: "Open", in_progress: "In progress", resolved: "Resolved", closed: "Closed",
};

function displayDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "-" : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

export default function SupportInboxPage() {
  const [apps, setApps] = useState<AppOption[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const search = new URLSearchParams();
      if (status) search.set("status", status);
      const response = await fetch(`/api/support/inbox${search.size ? `?${search}` : ""}`, { credentials: "include", cache: "no-store" });
      const payload = await response.json().catch(() => null) as InboxPayload | null;
      if (!response.ok || !payload) throw new Error(payload?.error || "Unable to load the support inbox.");
      setApps(payload.apps || []);
      setTickets(payload.tickets || []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load the support inbox.");
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    // Schedule the first fetch after paint so the effect only owns a timer,
    // avoiding a synchronous state transition during React's effect phase.
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return tickets;
    return tickets.filter((ticket) => [ticket.number, ticket.title, ticket.reporterName, ticket.reporterEmail || "", ticket.category || "", ticket.appKey]
      .some((value) => value.toLowerCase().includes(needle)));
  }, [query, tickets]);

  const appNames = useMemo(() => new Map(apps.map((entry) => [entry.key, entry.displayName])), [apps]);
  const counts = useMemo(() => ({
    total: tickets.length,
    open: tickets.filter((ticket) => ticket.status === "open").length,
    inProgress: tickets.filter((ticket) => ticket.status === "in_progress").length,
    urgent: tickets.filter((ticket) => ticket.priority === "urgent" && !["resolved", "closed"].includes(ticket.status)).length,
  }), [tickets]);

  return (
    <div style={{ maxWidth: 1400 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 18, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: '"Fraunces", Georgia, serif', fontSize: 22, color: "var(--ink)" }}>AI FusionIQ Labs support inbox</h2>
          <p style={{ margin: "5px 0 0", color: "var(--muted)", fontSize: 13.5 }}>TAP Hub support tickets for the TAP Hub team.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} style={buttonStyle}>{loading ? "Refreshing..." : "Refresh"}</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(150px, 1fr))", gap: 12, marginBottom: 16 }}>
        <Metric label="Tickets shown" value={counts.total} />
        <Metric label="Open" value={counts.open} accent="#9a5a00" />
        <Metric label="In progress" value={counts.inProgress} accent="#255bb5" />
        <Metric label="Urgent unresolved" value={counts.urgent} accent="#b42318" />
      </div>

      <section style={panelStyle}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end", marginBottom: 16 }}>
          <Field label="Status"><select value={status} onChange={(event) => setStatus(event.target.value)} style={inputStyle}><option value="">All statuses</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
          <Field label="Search"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ticket, reporter, subject..." style={{ ...inputStyle, minWidth: 245 }} /></Field>
        </div>

        {error && <div role="alert" style={{ border: "1px solid #f5c2c7", background: "#fff1f2", color: "#9f1239", borderRadius: 10, padding: "12px 14px", fontSize: 13.5 }}>{error}</div>}
        {loading && <p style={{ color: "var(--muted)", margin: 0 }}>Loading tickets...</p>}
        {!loading && !error && filtered.length === 0 && <p style={{ color: "var(--muted)", margin: 0 }}>No tickets match these filters.</p>}
        {!loading && !error && filtered.length > 0 && <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr>{["Ticket", "Application", "Subject / reporter", "Priority", "Status", "Last activity", "First response"].map((label) => <th key={label} style={headerStyle}>{label}</th>)}</tr></thead>
            <tbody>{filtered.map((ticket) => <tr key={ticket.id} style={{ borderTop: "1px solid var(--line)" }}>
              <td style={cellStyle}><b style={{ fontFamily: "monospace", color: "var(--teal)" }}>{ticket.number}</b></td>
              <td style={cellStyle}>{appNames.get(ticket.appKey) || ticket.appKey}</td>
              <td style={{ ...cellStyle, minWidth: 280 }}><b>{ticket.title}</b><div style={{ color: "var(--muted)", marginTop: 3 }}>{ticket.reporterName}{ticket.category ? ` · ${ticket.category}` : ""}</div></td>
              <td style={cellStyle}><Badge text={ticket.priority === "urgent" ? "Urgent" : "Normal"} tone={ticket.priority === "urgent" ? "red" : "gray"} /></td>
              <td style={cellStyle}><Badge text={STATUS_LABELS[ticket.status]} tone={ticket.status === "open" ? "amber" : ticket.status === "in_progress" ? "blue" : "green"} /></td>
              <td style={cellStyle}>{displayDate(ticket.lastActivityAt || ticket.createdAt)}</td>
              <td style={cellStyle}>{ticket.firstResponseAt ? displayDate(ticket.firstResponseAt) : <span style={{ color: "#9a5a00" }}>Awaiting response</span>}</td>
            </tr>)}</tbody>
          </table>
        </div>}
      </section>
    </div>
  );
}

function Metric({ label, value, accent = "var(--ink)" }: { label: string; value: number; accent?: string }) { return <div style={{ ...panelStyle, padding: "14px 16px" }}><div style={{ color: "var(--muted)", fontSize: 12 }}>{label}</div><div style={{ color: accent, fontSize: 25, lineHeight: 1.25, fontWeight: 700, marginTop: 3 }}>{value}</div></div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label style={{ display: "grid", gap: 5, color: "var(--muted)", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em" }}>{label}{children}</label>; }
function Badge({ text, tone }: { text: string; tone: "red" | "gray" | "amber" | "blue" | "green" }) { const colors = { red: ["#fff1f2", "#b42318"], gray: ["#f3f4f6", "#4b5563"], amber: ["#fff7e6", "#9a5a00"], blue: ["#eff6ff", "#1d4ed8"], green: ["#ecfdf3", "#15803d"] } as const; return <span style={{ display: "inline-block", padding: "4px 8px", borderRadius: 999, background: colors[tone][0], color: colors[tone][1], fontSize: 12, fontWeight: 700 }}>{text}</span>; }

const panelStyle: React.CSSProperties = { background: "var(--card)", border: "1px solid var(--line)", borderRadius: 14, padding: 18 };
const inputStyle: React.CSSProperties = { color: "var(--ink)", background: "#fff", border: "1px solid var(--line)", borderRadius: 9, font: "inherit", fontSize: 13, padding: "9px 10px", minWidth: 160 };
const buttonStyle: React.CSSProperties = { border: "none", borderRadius: 9, padding: "10px 14px", color: "#fff", background: "var(--ink)", cursor: "pointer", fontWeight: 700, fontSize: 13 };
const headerStyle: React.CSSProperties = { textAlign: "left", color: "var(--muted)", fontSize: 11, letterSpacing: ".04em", textTransform: "uppercase", padding: "10px 8px", whiteSpace: "nowrap" };
const cellStyle: React.CSSProperties = { color: "var(--ink)", padding: "12px 8px", verticalAlign: "top", whiteSpace: "nowrap" };
