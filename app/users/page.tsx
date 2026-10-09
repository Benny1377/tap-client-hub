"use client";

import { useState, useMemo, useEffect } from "react";
import { PageSkeleton } from "@/components/loading-skeleton";

interface User {
  id: string; name: string; email: string; username: string;
  role: string; location: string; mgr: string; mgrRaw?: string; modules: string[]; status: string; active?: boolean;
  displayName?: string;
  email_2fa_enabled?: boolean;
  allow_edit_client_data?: boolean;
}

interface CurrentUser {
  id: string; name: string; role: string; modules: string[]; canManageUsers?: boolean;
}

const MODULES_LIST = ["Tax Returns", "Clients", "Financials", "Payroll", "Sales Tax", "1099s", "Renditions", "Annual Reports", "Timesheet", "Vault", "Workload", "Users & Access", "Billing", "Collections", "Support"];
const ROLE_OPTIONS = ["Owner / Admin", "Manager", "Staff", "Offshore"];

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [ownerLoading, setOwnerLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalUser, setModalUser] = useState<User | "new" | null>(null);
  const [editForm, setEditForm] = useState<Partial<User & { password?: string }>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Delete confirm
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const isOwner = currentUser?.role === "owner" || currentUser?.role === "admin";
  const canManageUsers = isOwner || currentUser?.canManageUsers === true;
  const canViewUsers = canManageUsers || (currentUser?.role === "manager" && currentUser.modules?.includes("Users & Access"));
  // Managers with Users & Access may edit existing users; explicitly authorized managers can also add and delete.
  const canEditUsers = isOwner || canViewUsers;

  // ── Load current user (for owner check) ──
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/me");
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setCurrentUser(data);
        }
      } catch { /* ignore */ } finally {
        if (!cancelled) setOwnerLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // ── Load all users ──
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/profiles");
        if (!res.ok) throw new Error("Failed");
        const data = await res.json();
        if (!cancelled) { setUsers(Array.isArray(data) ? data : []); setLoading(false); }
      } catch (err: any) {
        if (!cancelled) { setError(err.message); setLoading(false); }
      }
    }
    if (!ownerLoading && canViewUsers) load();
    return () => { cancelled = true; };
  }, [ownerLoading, canViewUsers]);
  const isRestrictedRole = !["Owner / Admin", "owner", "admin", "Manager", "manager"].includes(editForm.role || "");

  const stats = useMemo(() => ({
    total: users.length,
    managers: users.filter(u => u.role === "Manager").length,
    offshore: users.filter(u => u.role === "Offshore").length,
    pending: users.filter(u => u.status !== "Active").length,
  }), [users]);

  function openModal(user: User | "new" | null) {
    setModalUser(user);
    setSaveError(null);
    setDeleteConfirm(null);
    if (user === "new") {
      setEditForm({
        name: "", location: "", role: "Staff", mgr: "—", username: "",
        email: "", password: "", modules: [], active: true, email_2fa_enabled: false, allow_edit_client_data: false,
      });
    } else if (user) {
      setEditForm({
        name: user.name, location: user.location, role: user.role,
        mgr: user.mgrRaw || "—", username: user.username, modules: [...user.modules],
        email: user.email, password: "", active: user.active !== false, email_2fa_enabled: user.email_2fa_enabled === true, allow_edit_client_data: user.allow_edit_client_data === true,
      });
    }
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      if (modalUser !== "new") {
        const res = await fetch("/api/profiles", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: modalUser!.id,
            full_name: editForm.name,
            role: (editForm.role === "Owner / Admin" ? "admin" : (editForm.role || "Staff").toLowerCase().replace(/ /g, "_")),
            location: editForm.location,
            reporting_manager: editForm.mgr === "—" || !editForm.mgr ? null : editForm.mgr,
            modules: editForm.modules || [],
            email: editForm.email,
            active: editForm.active === true,
            email_2fa_enabled: editForm.email_2fa_enabled === true,
            allow_edit_client_data: editForm.allow_edit_client_data === true,
            ...(editForm.password ? { password: editForm.password } : {}),
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to update");
        }
      } else {
        if (!editForm.email || !editForm.password || !editForm.name) {
          throw new Error("Name, email, and password are required");
        }
        const res = await fetch("/api/profiles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            full_name: editForm.name,
            email: editForm.email,
            password: editForm.password,
            role: (editForm.role === "Owner / Admin" ? "admin" : (editForm.role || "Staff").toLowerCase().replace(/ /g, "_")),
            location: editForm.location,
            reporting_manager: editForm.mgr === "—" || !editForm.mgr ? null : editForm.mgr,
            modules: editForm.modules || [],
            email_2fa_enabled: editForm.email_2fa_enabled === true,
            allow_edit_client_data: editForm.allow_edit_client_data === true,
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to create user");
        }
      }
      setModalUser(null);
      const res = await fetch("/api/profiles");
      if (res.ok) setUsers(await res.json());
    } catch (err: any) {
      setSaveError(err.message);
      const reloadRes = await fetch("/api/profiles");
      if (reloadRes.ok) setUsers(await reloadRes.json());
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(userId: string) {
    setDeleting(true);
    try {
      const res = await fetch(`/api/profiles/${userId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete user");
      }
      setModalUser(null);
      setDeleteConfirm(null);
      const reloadRes = await fetch("/api/profiles");
      if (reloadRes.ok) setUsers(await reloadRes.json());
    } catch (err: any) {
      setSaveError(err.message);
    } finally {
      setDeleting(false);
    }
  }

  async function handleCancelEdit() {
    setModalUser(null);
    // Discard optimistic status changes made while the modal was open.
    const res = await fetch("/api/profiles");
    if (res.ok) setUsers(await res.json());
  }

  // ── Loading / Not-owner states ──
  if (ownerLoading) return <PageSkeleton rows={6} />;
  if (!canViewUsers) {
    return (
      <div className="panel" style={{
        background: "var(--card)", border: "1px solid var(--line)",
        borderRadius: 16, overflow: "hidden",
      }}>
        <div className="empty" style={{
          padding: 60, textAlign: "center", color: "var(--muted)", fontSize: 15,
        }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>🔒</div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Access not assigned</div>
          <div style={{ fontSize: 13 }}>Ask an Owner or Admin to grant your profile access to the Users & Access module.</div>
        </div>
      </div>
    );
  }

  if (loading) return <PageSkeleton rows={6} />;
  if (error) return (
    <div className="panel" style={{
      background: "var(--card)", border: "1px solid var(--line)",
      borderRadius: 16, overflow: "hidden",
    }}>
      <div className="empty" style={{
        padding: 40, textAlign: "center", color: "var(--muted)",
      }}>
        Failed to load users.{' '}
        <button onClick={() => window.location.reload()} style={{
          all: "unset", cursor: "pointer", color: "var(--teal)", fontWeight: 600,
        }}>Retry</button>
      </div>
    </div>
  );

  return (
    <div>

      {/* ── Info banner ── */}
      <div className="vault-note" style={{
        background: "var(--amber-soft)", border: "1px solid #ead9b6", color: "#7a5210",
        borderRadius: 13, padding: "13px 16px", marginBottom: 14, fontSize: 13, display: "flex", gap: 10,
      }}>
        <span>🔐</span>
        <div>
          <b>How logins work.</b> You provision the account and choose exactly what each person can open; the system emails a one-time setup link and the user sets their own password on first login. Passwords are stored encrypted — never shown back, even to you — and the India web door also requires a second factor.
        </div>
      </div>

      {/* ── Stats ── */}
      <div className="stats" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {[
          [stats.total, "Users", "var(--ink)"],
          [stats.managers, "Managers", "var(--blue)"],
          [stats.offshore, "Offshore", "var(--teal)"],
          [stats.pending, "Pending invites", "var(--amber)"],
        ].map(([v, l, c]) => (
          <div key={l as string} className="statcard" style={{
            flex: 1, minWidth: 120, background: "var(--card)",
            border: "1px solid var(--line)", borderRadius: 13,
            padding: "13px 16px", boxShadow: "0 1px 2px rgba(33,31,26,0.04)",
          }}>
            <div style={{
              fontFamily: '"Fraunces",Georgia,serif', fontWeight: 600,
              fontSize: 26, lineHeight: 1, color: c as string,
            }}>{v as number}</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{l as string}</div>
          </div>
        ))}
      </div>

      {/* ── Count line ── */}
      <div className="count" style={{
        color: "var(--muted)", fontSize: 13, margin: "12px 2px 6px",
      }}>
        {canManageUsers ? "Click a user to edit their access · use ＋ Add user to provision a new login" : "Click a user to edit their details and module access · adding and deleting users requires explicit authorization"}
      </div>

      {/* ── Add button ── */}
      {canManageUsers && <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <button className="btn" onClick={() => openModal("new")} style={{
          all: "unset", cursor: "pointer", background: "var(--ink)", color: "#fff",
          padding: "10px 16px", borderRadius: 11, fontWeight: 600, fontSize: "13.5px",
          display: "inline-flex", gap: 7, alignItems: "center",
        }}>
          ＋ Add user
        </button>
      </div>}

      {/* ── Users table ── */}
      <div className="panel" style={{
        background: "var(--card)", border: "1px solid var(--line)",
        borderRadius: 16, overflow: "hidden", overflowX: "auto",
      }}>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Location</th>
              <th>Role</th>
              <th>Reports to</th>
              <th>Modules</th>
              <th>Username</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} onClick={canEditUsers ? () => openModal(u) : undefined} style={{ cursor: canEditUsers ? "pointer" : "default" }}>
                <td className="lname">{u.displayName || u.name}</td>
                <td>{u.location}</td>
                <td>
                  <span className="urole" style={{
                    fontSize: 11, fontWeight: 700, padding: "3px 9px",
                    borderRadius: 999, background: "var(--blue-soft)", color: "var(--blue)",
                  }}>{u.role}</span>
                </td>
                <td>{u.mgr}</td>
                <td>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
                    {u.modules.slice(0, 4).map(m => (
                      <span key={m} className="uchip" style={{
                        display: "inline-block", background: "var(--teal-soft)",
                        color: "var(--teal-ink)", fontSize: 11, fontWeight: 600,
                        padding: "2px 8px", borderRadius: 999, margin: "2px 3px 0 0",
                      }}>{m}</span>
                    ))}
                    {u.modules.length > 4 && (
                      <span className="uchip" style={{
                        display: "inline-block", background: "var(--teal-soft)",
                        color: "var(--teal-ink)", fontSize: 11, fontWeight: 600,
                        padding: "2px 8px", borderRadius: 999, margin: "2px 3px 0 0",
                      }}>+{u.modules.length - 4}</span>
                    )}
                  </div>
                </td>
                <td className="mono">{u.username}</td>
                <td>
                  <span className="ustat" style={{
                    fontSize: 11, fontWeight: 700, padding: "3px 9px",
                    borderRadius: 999, whiteSpace: "nowrap",
                    background: u.status === "Active" ? "var(--green-soft)" : "var(--amber-soft)",
                    color: u.status === "Active" ? "var(--green)" : "var(--amber)",
                  }}>{u.status}</span>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={7} className="empty">No users found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── User modal ── */}
      {modalUser !== null && (
        <>
          <div className="mscrim show" onClick={() => setModalUser(null)} />
          <div className="modal" style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
            zIndex: 61, background: "var(--paper)", borderRadius: 18, width: 520,
            maxWidth: "90vw", maxHeight: "calc(100dvh - 32px)", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "var(--shadow)",
          }} onClick={e => e.stopPropagation()}>
            <h2 style={{
              fontFamily: '"Fraunces",Georgia,serif', fontSize: 22, fontWeight: 600,
              padding: "20px 24px 4px", margin: 0,
            }}>
              {modalUser === "new" ? "Add a user" : "Edit user"}
            </h2>
            <div className="msub" style={{
              color: "var(--muted)", fontSize: 13, padding: "0 24px 14px",
              borderBottom: "1px solid var(--line)",
            }}>
              {modalUser === "new"
                ? "Provision a new login — the user signs in with their email and the password you set."
                : "Update their email, password, details, and access. The email address is where two-factor codes are sent."
              }
            </div>
            <div className="mform" style={{ padding: "18px 24px", overflowY: "auto", flex: 1, minHeight: 0 }}>
              {/* Full name */}
              <label className="el" style={{
                fontSize: 11, fontWeight: 700, letterSpacing: ".05em",
                textTransform: "uppercase", color: "var(--muted)",
                margin: "12px 0 4px", display: "block",
              }}>Full name</label>
              <input className="ef" style={{
                width: "100%", padding: "9px 11px", border: "1px solid var(--line)",
                borderRadius: 9, font: "inherit", fontSize: 14, background: "#fff", marginBottom: 4,
              }} value={editForm.name || ""} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} />

              {canManageUsers && modalUser !== "new" && (
                <>
                  <label className="el" style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)", margin: "12px 0 4px", display: "block" }}>Email address</label>
                  <input className="ef" type="email" style={{ width: "100%", padding: "9px 11px", border: "1px solid var(--line)", borderRadius: 9, font: "inherit", fontSize: 14, background: "#fff", marginBottom: 4 }} value={editForm.email || ""} onChange={e => setEditForm(p => ({ ...p, email: e.target.value }))} />
                  <p style={{ margin: "2px 0 0", color: "var(--muted)", fontSize: 12 }}>This is also the address that receives email two-factor codes.</p>
                </>
              )}

              {/* Email + Password (new user only) */}
              {modalUser === "new" && (
                <>
                  <label className="el" style={{
                    fontSize: 11, fontWeight: 700, letterSpacing: ".05em",
                    textTransform: "uppercase", color: "var(--muted)",
                    margin: "12px 0 4px", display: "block",
                  }}>Email address</label>
                  <input className="ef" type="email" style={{
                    width: "100%", padding: "9px 11px", border: "1px solid var(--line)",
                    borderRadius: 9, font: "inherit", fontSize: 14, background: "#fff", marginBottom: 4,
                  }} value={editForm.email || ""} onChange={e => setEditForm(p => ({ ...p, email: e.target.value }))} placeholder="user@tapallc.com" />

                  <label className="el" style={{
                    fontSize: 11, fontWeight: 700, letterSpacing: ".05em",
                    textTransform: "uppercase", color: "var(--muted)",
                    margin: "12px 0 4px", display: "block",
                  }}>Initial password</label>
                  <div style={{ position: "relative", marginBottom: 4 }}>
                    <input className="ef" type={showPassword ? "text" : "password"} style={{
                      width: "100%", padding: "9px 40px 9px 11px", border: "1px solid var(--line)",
                      borderRadius: 9, font: "inherit", fontSize: 14, background: "#fff", boxSizing: "border-box",
                    }} value={editForm.password || ""} onChange={e => setEditForm(p => ({ ...p, password: e.target.value }))} placeholder="Min 6 characters" />
                    <button
                      type="button"
                      onClick={() => setShowPassword(v => !v)}
                      style={{
                        position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
                        background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", justifyContent: "center",
                      }}
                      tabIndex={-1}
                    >
                      {showPassword ? (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/></svg>
                      ) : (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      )}
                    </button>
                  </div>
                </>
              )}

              {canManageUsers && (
                <label style={{ display: "flex", gap: 9, alignItems: "flex-start", margin: "14px 0 4px", cursor: "pointer", fontSize: 13, color: "var(--ink)" }}>
                  <input type="checkbox" checked={editForm.email_2fa_enabled === true} onChange={e => setEditForm(p => ({ ...p, email_2fa_enabled: e.target.checked }))} style={{ marginTop: 2 }} />
                  <span><b>Require email two-factor authentication</b><br /><span style={{ color: "var(--muted)", fontSize: 12 }}>A six-digit code is sent to the email address above after the password is accepted.</span></span>
                </label>
              )}

              {/* Location */}
              <label className="el" style={{
                fontSize: 11, fontWeight: 700, letterSpacing: ".05em",
                textTransform: "uppercase", color: "var(--muted)",
                margin: "12px 0 4px", display: "block",
              }}>Location</label>
              <input className="ef" style={{
                width: "100%", padding: "9px 11px", border: "1px solid var(--line)",
                borderRadius: 9, font: "inherit", fontSize: 14, background: "#fff", marginBottom: 4,
              }} value={editForm.location || ""} onChange={e => setEditForm(p => ({ ...p, location: e.target.value }))} placeholder="e.g. Houston, TX or Pune, India" />

              {/* Role + Reports to */}
              <div className="two-ef" style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label className="el" style={{
                    fontSize: 11, fontWeight: 700, letterSpacing: ".05em",
                    textTransform: "uppercase", color: "var(--muted)",
                    margin: "12px 0 4px", display: "block",
                  }}>Role</label>
                  <select className="ef" disabled={!canManageUsers} style={{
                    width: "100%", padding: "9px 11px", border: "1px solid var(--line)",
                    borderRadius: 9, font: "inherit", fontSize: 14, background: "#fff", marginBottom: 4,
                  }} value={editForm.role || ""} onChange={e => setEditForm(p => ({ ...p, role: e.target.value }))}>
                    {ROLE_OPTIONS.map(r => <option key={r}>{r}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label className="el" style={{
                    fontSize: 11, fontWeight: 700, letterSpacing: ".05em",
                    textTransform: "uppercase", color: "var(--muted)",
                    margin: "12px 0 4px", display: "block",
                  }}>Reports to</label>
                  <select className="ef" style={{
                    width: "100%", padding: "9px 11px", border: "1px solid var(--line)",
                    borderRadius: 9, font: "inherit", fontSize: 14, background: "#fff", marginBottom: 4,
                  }} value={editForm.mgr || ""} onChange={e => setEditForm(p => ({ ...p, mgr: e.target.value }))}>
                    <option value="—">—</option>
                    {users.filter(x => /Manager|Owner/.test(x.role)).map(x => (
                      <option key={x.id} value={x.name}>{x.displayName || x.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Username (readonly for edit, shown for both) */}
              <label className="el" style={{
                fontSize: 11, fontWeight: 700, letterSpacing: ".05em",
                textTransform: "uppercase", color: "var(--muted)",
                margin: "12px 0 4px", display: "block",
              }}>Username</label>
              {modalUser === "new" ? (
                <input className="ef" style={{
                  width: "100%", padding: "9px 11px", border: "1px solid var(--line)",
                  borderRadius: 9, font: "inherit", fontSize: 14, background: "#fff", marginBottom: 4,
                }} value={editForm.username || ""} onChange={e => setEditForm(p => ({ ...p, username: e.target.value }))} placeholder="Auto-generated from email" />
              ) : (
                <div style={{
                  padding: "9px 11px", border: "1px solid var(--line)",
                  borderRadius: 9, fontSize: 14, background: "var(--card)",
                  color: "var(--muted)", marginBottom: 4,
                }}>
                  {editForm.username || "—"} <span style={{ fontSize: 11, color: "var(--muted)" }}>(set on creation)</span>
                </div>
              )}

              {/* Modules checkboxes */}
              <label className="el" style={{
                fontSize: 11, fontWeight: 700, letterSpacing: ".05em",
                textTransform: "uppercase", color: "var(--muted)",
                margin: "16px 0 4px", display: "block",
              }}>Modules they can access</label>
              <div className="modgrid" style={{
                display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 7, marginTop: 6,
              }}>
                {MODULES_LIST.filter(m => !(m === "Users & Access" && (isRestrictedRole || !canManageUsers))).map(m => (
                  <label key={m} style={{
                    display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--ink)",
                  }}>
                    <input type="checkbox" checked={(editForm.modules || []).includes(m)}
                      onChange={e => {
                        setEditForm(p => ({
                          ...p,
                          modules: e.target.checked
                            ? [...(p.modules || []), m]
                            : (p.modules || []).filter(x => x !== m),
                        }));
                      }}
                      style={{ width: "auto" }} />
                    {m}
                  </label>
                ))}
              </div>

              {canManageUsers && modalUser !== "new" && (
                <label style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 16, fontSize: 13, fontWeight: 600 }}>
                  <input type="checkbox" checked={editForm.active === true}
                    onChange={e => {
                      const active = e.target.checked;
                      setEditForm(p => ({ ...p, active }));
                      // Reflect the requested status immediately in the table.
                      setUsers(prev => prev.map(user => user.id === (modalUser as User).id
                        ? { ...user, active, status: active ? "Active" : "Inactive" }
                        : user));
                    }}
                    style={{ width: "auto" }} />
                  Active user
                </label>
              )}

              {canManageUsers && (
                <label style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 16, fontSize: 13, fontWeight: 600 }}>
                  <input type="checkbox" checked={editForm.allow_edit_client_data === true}
                    onChange={e => setEditForm(p => ({ ...p, allow_edit_client_data: e.target.checked }))}
                    style={{ width: "auto" }} />
                  Allow editing client data
                </label>
              )}

              {/* Password change (edit mode) */}
              {canManageUsers && modalUser !== "new" && (
                <>
                  <label className="el" style={{
                    fontSize: 11, fontWeight: 700, letterSpacing: ".05em",
                    textTransform: "uppercase", color: "var(--muted)",
                    margin: "16px 0 4px", display: "block",
                  }}>New password (leave blank to keep current)</label>
                  <div style={{ position: "relative", marginBottom: 4 }}>
                    <input className="ef" type={showPassword ? "text" : "password"} style={{
                      width: "100%", padding: "9px 40px 9px 11px", border: "1px solid var(--line)",
                      borderRadius: 9, font: "inherit", fontSize: 14, background: "#fff", boxSizing: "border-box",
                    }} value={editForm.password || ""} onChange={e => setEditForm(p => ({ ...p, password: e.target.value }))} placeholder="Min 6 characters" />
                    <button
                      type="button"
                      onClick={() => setShowPassword(v => !v)}
                      style={{
                        position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
                        background: "none", border: "none", cursor: "pointer", padding: 0,
                      }}
                      tabIndex={-1}
                    >
                      {showPassword ? (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/></svg>
                      ) : (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      )}
                    </button>
                  </div>
                </>
              )}

              {/* Note about setup link (edit mode) */}
              {modalUser !== "new" && (
                <div style={{
                  background: "var(--blue-soft)", color: "var(--blue)",
                  padding: "10px 13px", borderRadius: 9, fontSize: 12, marginTop: 16,
                  lineHeight: 1.5,
                }}>
                  🔗 <b>Setup link.</b> The user logs in via <strong>portal.tapallc.com</strong>. Their one-time setup link was emailed at account creation. If they need a new one, reset their password — the system sends a fresh setup email automatically.
                </div>
              )}

              {saveError && (
                <div style={{
                  background: "var(--red-soft)", color: "var(--red)",
                  padding: "10px 13px", borderRadius: 9, fontSize: 13, marginTop: 14, fontWeight: 600,
                }}>
                  {saveError}
                </div>
              )}

              {/* Delete confirmation */}
              {deleteConfirm && (
                <div style={{
                  background: "var(--red-soft)", color: "var(--red)",
                  padding: "14px", borderRadius: 9, fontSize: 13, marginTop: 14,
                }}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>
                    ⚠️ Delete this user?
                  </div>
                  <div style={{ marginBottom: 10, lineHeight: 1.5, color: "var(--ink)" }}>
                    This permanently removes <strong>{deleteConfirm}</strong> and all their access. This cannot be undone.
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn" onClick={() => setDeleteConfirm(null)}
                      disabled={deleting}
                      style={{
                        all: "unset", cursor: "pointer", background: "var(--card)",
                        color: "var(--ink)", border: "1px solid var(--line)",
                        padding: "7px 14px", borderRadius: 9, fontWeight: 600, fontSize: 12,
                      }}>
                      Cancel
                    </button>
                    <button className="btn" onClick={() => handleDelete((modalUser as User).id)}
                      disabled={deleting}
                      style={{
                        all: "unset", cursor: "pointer", background: "var(--red)",
                        color: "#fff", padding: "7px 14px", borderRadius: 9, fontWeight: 600, fontSize: 12,
                      }}>
                      {deleting ? "Deleting..." : "Yes, delete"}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Footer buttons */}
            <div style={{
              display: "flex", gap: 10, padding: "14px 24px calc(14px + env(safe-area-inset-bottom))",
              justifyContent: "space-between", borderTop: "1px solid var(--line)", flexShrink: 0,
              background: "var(--paper)",
            }}>
              {/* Left: Delete button (edit mode only) */}
              {canManageUsers && modalUser !== "new" && !deleteConfirm && (
                <button className="btn alt" onClick={() => setDeleteConfirm((modalUser as User).name)}
                  style={{
                    all: "unset", cursor: "pointer", background: "transparent",
                    color: "var(--red)", padding: "10px 16px", borderRadius: 11,
                    fontWeight: 600, fontSize: "13.5px", marginRight: "auto",
                  }}>
                  🗑 Delete user
                </button>
              )}
              {/* Spacer when no delete button */}
              {modalUser !== "new" && !deleteConfirm && <div style={{ flex: 1 }} />}

              {/* Right: Cancel + Save */}
              <button className="btn alt" onClick={handleCancelEdit} disabled={saving}
                style={{
                  all: "unset", cursor: "pointer", background: "var(--card)",
                  color: "var(--ink)", border: "1px solid var(--line)",
                  padding: "10px 16px", borderRadius: 11, fontWeight: 600, fontSize: "13.5px",
                }}>
                Cancel
              </button>
              <button className="btn" onClick={handleSave} disabled={saving || !!deleteConfirm}
                style={{
                  all: "unset", cursor: "pointer",
                  background: saving || deleteConfirm ? "var(--line)" : "var(--ink)",
                  color: "#fff", padding: "10px 16px", borderRadius: 11,
                  fontWeight: 600, fontSize: "13.5px",
                }}>
                {saving ? "Saving..." : "Save changes"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
