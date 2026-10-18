"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import type { VaultEntry } from "@/lib/types";
import { useClients } from "@/hooks/use-clients-context";
import VaultModal from "@/components/vault-modal";
import User2faList from "@/components/user-2fa-list";
import { PageSkeleton } from "@/components/loading-skeleton";

export default function VaultPage() {
  const [unlocked, setUnlocked] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [vaultEntries, setVaultEntries] = useState<VaultEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<VaultEntry | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [visiblePws, setVisiblePws] = useState<Set<string>>(new Set());

  const { clients: supabaseClients } = useClients();

  const canEdit = userRole === "admin" || userRole === "manager";

  const loadCredentials = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/credentials");
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setVaultEntries(Array.isArray(data) ? data : []);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadCredentials(); }, [loadCredentials]);

  // Group entries by client name
  const grouped = useMemo(() => {
    const map = new Map<string, VaultEntry[]>();
    for (const entry of vaultEntries) {
      const name = entry.clientId
        ? supabaseClients.find(c => c.id === entry.clientId)?.name || entry.groupLabel || "Unassigned"
        : entry.groupLabel || "Unassigned";
      if (!map.has(name)) map.set(name, []);
      map.get(name)!.push(entry);
    }
    const q = searchQuery.toLowerCase().trim();
    if (!q) return Array.from(map.entries()).sort((a, b) => {
      if (a[0] === "Firm-wide") return 1;
      if (b[0] === "Firm-wide") return -1;
      return a[0].localeCompare(b[0]);
    });
    return Array.from(map.entries()).filter(([n, entries]) =>
      n.toLowerCase().includes(q) || entries.some(e => e.site.toLowerCase().includes(q))
    ).sort((a, b) => a[0].localeCompare(b[0]));
  }, [vaultEntries, supabaseClients, searchQuery]);

  const totalEntries = useMemo(() => grouped.reduce((s, [, e]) => s + e.length, 0), [grouped]);
  const entityCount = grouped.length;

  function handleAdd() { setEditingEntry(null); setSaveError(null); setModalOpen(true); }
  function handleEdit(entry: VaultEntry) { setEditingEntry(entry); setSaveError(null); setModalOpen(true); }

  // Read the sanitized `error` message from an API response. Credential values
  // are never echoed back, so only the error string is surfaced to the UI.
  async function readApiError(res: Response): Promise<string> {
    try {
      const data = await res.json();
      if (data && typeof data.error === "string" && data.error.trim()) {
        return data.error.trim();
      }
    } catch {
      // fall through to a generic message
    }
    return "Save failed — please try again.";
  }

  async function handleDelete(entry: VaultEntry) {
    if (!confirm(`Delete credential for "${entry.site}"?\n\nThis cannot be undone.`)) return;
    try {
      await fetch(`/api/credentials?id=${encodeURIComponent(entry.id)}`, { method: "DELETE" });
      await loadCredentials();
    } catch (err: any) { alert("Failed to delete"); }
  }

  const handleSave = useCallback(async (entry: VaultEntry | Omit<VaultEntry, "id">) => {
    setSaving(true);
    try {
      const hasId = "id" in entry && entry.id;
      const res = await fetch("/api/credentials", {
        method: hasId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry),
      });
      if (!res.ok) {
        // Show the real (sanitized) API error and keep the modal open.
        setSaveError(await readApiError(res));
        return;
      }
      setSaveError(null);
      setModalOpen(false);
      await loadCredentials();
    } catch {
      setSaveError("Network error — could not reach the server. Please try again.");
    } finally {
      setSaving(false);
    }
  }, [loadCredentials]);

  const clientOptions = useMemo(
    () => supabaseClients.map(c => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name)),
    [supabaseClients],
  );

  // ── Locked state ──
  if (!unlocked) {
    return (
      <div className="panel" style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 16, overflow: "hidden" }}>
        <div className="vault-lock" style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", padding: "70px 20px", textAlign: "center",
        }}>
          <div className="big" style={{ fontSize: 46 }}>🔒</div>
          <h2 style={{ fontFamily: '"Fraunces",Georgia,serif', fontSize: 24, margin: "14px 0 6px" }}>Restricted area</h2>
          <p style={{ color: "var(--muted)", maxWidth: 440, marginBottom: 18 }}>
            Portal logins live behind a separate lock with their own permission list — so the rest of
            the team can use the client files without ever seeing passwords.
          </p>
          <button className="btn" onClick={() => { setUnlocked(true); setUserRole("admin"); }} style={{
            all: "unset", cursor: "pointer", background: "var(--ink)", color: "var(--paper)",
            padding: "10px 16px", borderRadius: 11, fontWeight: 600, fontSize: "13.5px",
            display: "inline-flex", gap: 7, alignItems: "center",
          }}>
            Unlock (demo)
          </button>
        </div>
      </div>
    );
  }

  if (loading) return <PageSkeleton rows={6} />;
  if (error) {
    return (
      <div className="panel" style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 16, overflow: "hidden" }}>
        <div className="empty" style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>
          Failed to load credentials.{' '}
          <button onClick={() => loadCredentials()} style={{ all: "unset", cursor: "pointer", color: "var(--teal)", fontWeight: 600 }}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Vault note banner ── */}
      <div className="vault-note" style={{
        background: "var(--amber-soft)", border: "1px solid var(--amber-line)", color: "var(--amber)",
        borderRadius: 13, padding: "13px 16px", fontSize: 13, display: "flex", gap: 10,
      }}>
        <span style={{ fontSize: 18, lineHeight: "20px" }}>🏦</span>
        <div>
          <b>Grouped by client.</b> One entity can hold several logins — expand a client to see them all.{' '}
          <b>Bank logins aren&apos;t stored here</b>: they link out to <b>TAP Bank</b>, your separate in-office secure system.
        </div>
      </div>

      {/* ── Toolbar: count + search + add ── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <div className="count" style={{ color: "var(--muted)", fontSize: 13, marginRight: "auto" }}>
          {totalEntries} login{totalEntries !== 1 ? "s" : ""} across {entityCount} entit{entityCount !== 1 ? "ies" : "y"}
        </div>

        <div className="search" style={{ flex: 1, minWidth: 200, position: "relative" }}>
          <span style={{ position: "absolute", left: 13, top: 11, opacity: 0.45 }}>🔍</span>
          <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search by client, site, or email..."
            style={{ width: "100%", padding: "11px 14px 11px 38px", border: "1px solid var(--line)", borderRadius: 11, background: "var(--card)", font: "inherit", fontSize: 14 }} />
        </div>

        {canEdit && (
          <button className="btn" onClick={handleAdd} disabled={saving} style={{
            all: "unset", cursor: "pointer", background: "var(--ink)", color: "var(--paper)",
            padding: "10px 16px", borderRadius: 11, fontWeight: 600, fontSize: "13.5px",
            display: "inline-flex", gap: 7, alignItems: "center", whiteSpace: "nowrap",
          }}>
            ＋ Add credential
          </button>
        )}
      </div>

      {/* ── 2FA Admin Management ── */}
      <details className="vgroup" style={{
        background: "var(--card)", border: "1px solid var(--line)", borderRadius: 13,
        marginBottom: 10, overflow: "hidden",
      }}>
        <summary style={{
          cursor: "pointer", listStyle: "none", display: "flex", alignItems: "center",
          gap: 10, padding: "13px 16px", fontSize: 14,
        }}>
          <span style={{ fontSize: 16 }}>🔐</span>
          <b>User 2FA Status</b>
          <span className="vcount" style={{
            marginLeft: "auto", background: "var(--teal-soft)", color: "var(--teal-ink)",
            fontSize: "11.5px", fontWeight: 700, padding: "3px 10px", borderRadius: 999,
          }}>Admin manage</span>
        </summary>
        <div style={{ padding: "0 14px 14px" }}>
          <User2faList />
        </div>
      </details>

      {/* ── Vault groups (details/summary) ── */}
      {grouped.map(([name, entries]) => (
        <details key={name} className="vgroup" style={{
          background: "var(--card)", border: "1px solid var(--line)", borderRadius: 13,
          marginBottom: 10, overflow: "hidden",
        }}>
          <summary style={{
            cursor: "pointer", listStyle: "none", display: "flex", alignItems: "center",
            gap: 10, padding: "13px 16px", fontSize: 14,
          }}>
            <b>{name}</b>
            <span className="vcount" style={{
              marginLeft: "auto", background: "var(--teal-soft)", color: "var(--teal-ink)",
              fontSize: "11.5px", fontWeight: 700, padding: "3px 10px", borderRadius: 999,
            }}>
              {entries.length} login{entries.length !== 1 ? "s" : ""}
            </span>
          </summary>
          <div style={{ margin: "0 6px 8px" }}>
            <div className="vault-table-wrap" style={{ overflowX: "auto" }}>
              <table className="vault-table">
                <thead>
                  <tr>
                    <th>Portal</th>
                    <th>Username</th>
                    <th>Password</th>
                    {canEdit && <th style={{ width: 80, textAlign: "center" }}>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {entries.map(entry => {
                    const isBank = entry.isBank || entry.site === "TAP Bank";
                    // Bank credentials stay in the separate TAP Bank system. Prefer
                    // a per-entry URL, then the deployment-level portal URL.
                    const bankUrl = entry.url?.trim() || process.env.NEXT_PUBLIC_TAP_BANK_URL?.trim() || "";
                    const pwKey = entry.id;
                    const pwVisible = visiblePws.has(pwKey);
                    return (
                      <tr key={entry.id}>
                        <td><b>{entry.site}</b></td>
                        {isBank ? (
                          <>
                            <td className="vt-mono vt-muted">— linked —</td>
                            <td>
                              <a
                                href={bankUrl || undefined}
                                target={bankUrl ? "_blank" : undefined}
                                rel={bankUrl ? "noopener noreferrer" : undefined}
                                onClick={e => {
                                  if (!bankUrl) {
                                    e.preventDefault();
                                    alert("TAP Bank portal URL is not configured. Ask an administrator to set NEXT_PUBLIC_TAP_BANK_URL.");
                                  }
                                }}
                                className="vt-bank-link"
                                aria-disabled={!bankUrl}
                              >
                                Open in TAP&nbsp;Bank ↗
                              </a>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="vt-mono">{entry.email || "—"}</td>
                            <td className="vt-pw">
                              <span className="vt-pw-val">{pwVisible ? (entry.password || "—") : "••••••••"}</span>
                              <button className="vt-pw-toggle" onClick={() => {
                                setVisiblePws(prev => { const next = new Set(prev); if (next.has(pwKey)) next.delete(pwKey); else next.add(pwKey); return next; });
                              }}>
                                {pwVisible ? "hide" : "show"}
                              </button>
                            </td>
                          </>
                        )}
                        {canEdit && (
                          <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                            <button onClick={() => handleEdit(entry)}
                              style={{ all: "unset", cursor: "pointer", color: "var(--teal)", fontWeight: 600, fontSize: 11, marginRight: 8 }}
                              title="Edit">✏️</button>
                            <button onClick={() => handleDelete(entry)}
                              style={{ all: "unset", cursor: "pointer", color: "var(--red)", fontSize: 11 }}
                              title="Delete">🗑️</button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <style jsx>{`
              .vault-table-wrap {
                overflow-x: auto;
              }
              .vault-table {
                width: 100%;
                border-collapse: collapse;
                font-size: 13px;
              }
              .vault-table thead th {
                text-align: left;
                font-weight: 600;
                color: var(--muted);
                font-size: 10px;
                letter-spacing: 0.04em;
                text-transform: uppercase;
                padding: 11px 12px;
                background: var(--card2);
                border-bottom: 1px solid var(--line);
              }
              .vault-table tbody td {
                padding: 10px 12px;
                border-bottom: 1px solid #efeade;
                vertical-align: middle;
              }
              .vault-table tbody tr:last-child td {
                border-bottom: none;
              }
              .vault-table tbody tr:hover {
                background: var(--card2);
              }
              .vt-mono {
                font-family: "SF Mono","Fira Code","Consolas",monospace;
                font-size: 11.5px;
                color: var(--ink);
              }
              .vt-muted {
                color: var(--muted);
              }
              .vt-pw {
                white-space: nowrap;
              }
              .vt-pw-val {
                font-family: "SF Mono","Fira Code","Consolas",monospace;
                font-size: 11.5px;
              }
              .vt-pw-toggle {
                all: unset;
                cursor: pointer;
                color: var(--teal);
                font-weight: 600;
                font-size: 11px;
                margin-left: 8px;
              }
              .vt-pw-toggle:hover {
                opacity: 0.8;
              }
              .vt-bank-link {
                color: var(--teal);
                font-weight: 600;
                font-size: 11.5px;
                white-space: nowrap;
                text-decoration: none;
              }
              .vt-bank-link:hover {
                text-decoration: underline;
              }
            `}</style>
          </div>
        </details>
      ))}
      {grouped.length === 0 && (
        <div className="panel" style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 16, overflow: "hidden" }}>
          <div className="empty" style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>
            No credentials found{searchQuery ? " matching your search" : ""}.<br />
            <button onClick={handleAdd} style={{ all: "unset", cursor: "pointer", color: "var(--teal)", fontWeight: 600 }}>Add your first credential</button>
          </div>
        </div>
      )}

      {saving && <div className="fixed bottom-4 right-4 px-4 py-2 rounded-lg text-sm font-semibold text-white" style={{ backgroundColor: "var(--teal)" }}>Saving…</div>}

      <VaultModal open={modalOpen} vaultEntry={editingEntry} clients={clientOptions} onClose={() => setModalOpen(false)} onSave={handleSave} saveError={saveError} />
    </div>
  );
}
