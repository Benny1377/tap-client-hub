"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { PageSkeleton } from "@/components/loading-skeleton";

interface UserDetails {
  id: string; email: string; name: string; role: string;
  location: string; email_2fa_enabled: boolean;
}

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserDetails | null>(null);
  const [loading, setLoading] = useState(true);

  // Password change
  const [newPassword, setNewPassword] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // 2FA
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"loading" | "setup" | "verify" | "done">("loading");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        // Load user details
        const res = await fetch("/api/me");
        if (!res.ok) throw new Error("Not authenticated");
        const data = await res.json();
        if (cancelled) return;
        setUser(data);

        // Load 2FA status
        const res2fa = await fetch("/api/2fa/status");
        const status = await res2fa.json();
        if (cancelled) return;
        // /api/2fa/status is the authoritative source for this field. Keep the
        // user state in sync because the render branches use email_2fa_enabled.
        setUser(p => p ? { ...p, email_2fa_enabled: status.enabled === true } : p);
        if (status.enabled) setStep("done");
        else setStep("setup");
      } catch {
        if (!cancelled) router.push("/login");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [router]);

  // ── Password change ──
  async function handleChangePassword() {
    if (!newPassword.trim() || newPassword.length < 6) {
      setPwError("Password must be at least 6 characters");
      return;
    }
    setPwSaving(true); setPwError(""); setPwSuccess("");
    try {
      const res = await fetch(`/api/profiles/${user!.id}/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPassword.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed");
      }
      setPwSuccess("Password updated successfully.");
      setNewPassword("");
    } catch (err: any) {
      setPwError(err.message);
    } finally {
      setPwSaving(false);
    }
  }

  // ── 2FA: start setup ──
  async function startSetup() {
    setSaving(true); setError("");
    try {
      const res = await fetch("/api/2fa/setup", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setEmail(data.email || "");
      setMessage(data.message || "Code sent");
      setCode("");
      setStep("verify");
    } catch (err: any) {
      setError(err.message || "Failed");
    } finally { setSaving(false); }
  }

  // ── 2FA: verify code ──
  async function verifyCode() {
    if (code.length !== 6) { setError("Enter the 6-digit code"); return; }
    setSaving(true); setError("");
    try {
      const res = await fetch("/api/2fa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      setStep("done");
      setUser(p => p ? { ...p, email_2fa_enabled: true } : p);
    } catch (err: any) {
      setError(err.message);
    } finally { setSaving(false); }
  }

  // ── 2FA: start disable ──
  async function startDisable() {
    setSaving(true); setError(""); setCode("");
    try {
      const res = await fetch("/api/2fa/disable", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setEmail(data.email || "");
      setMessage(data.message || "Code sent");
      setStep("verify");
    } catch (err: any) {
      setError(err.message);
    } finally { setSaving(false); }
  }

  // ── 2FA: confirm disable ──
  async function confirmDisable() {
    if (code.length !== 6) { setError("Enter the 6-digit code"); return; }
    setSaving(true); setError("");
    try {
      const res = await fetch("/api/2fa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      setStep("setup");
      setCode("");
      setUser(p => p ? { ...p, email_2fa_enabled: false } : p);
    } catch (err: any) {
      setError(err.message);
    } finally { setSaving(false); }
  }

  if (loading) return <PageSkeleton rows={6} />;

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      {/* ── User Details ── */}
      <section>
        <h2 style={{ fontFamily: '"Fraunces",Georgia,serif', fontSize: 20, fontWeight: 600, marginBottom: 4 }}>Your Account</h2>
        <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 16 }}>Profile details linked to your login.</p>
        <div className="panel" style={{
          background: "var(--card)", border: "1px solid var(--line)", borderRadius: 16, overflow: "hidden",
        }}>
          <table style={{ width: "100%" }}>
            <tbody>
              {[
                ["Name", user?.name || "—"],
                ["Email", user?.email || "—"],
                ["Role", user?.role || "—"],
                ["Location", user?.location || "—"],
              ].map(([label, value]) => (
                <tr key={label} style={{ borderBottom: "1px solid var(--line)" }}>
                  <td style={{ padding: "12px 18px", fontWeight: 600, fontSize: 13, color: "var(--muted)", width: 140 }}>{label}</td>
                  <td style={{ padding: "12px 18px", fontSize: 14 }}>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Change Password ── */}
      <section>
        <h2 style={{ fontFamily: '"Fraunces",Georgia,serif', fontSize: 20, fontWeight: 600, marginBottom: 4 }}>Password</h2>
        <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 16 }}>Set a new password for your account.</p>
        <div className="panel" style={{
          background: "var(--card)", border: "1px solid var(--line)", borderRadius: 16, padding: 20,
        }}>
          <div style={{ position: "relative", marginBottom: 12 }}>
            <input
              type={showPassword ? "text" : "password"} value={newPassword}
              onChange={e => { setNewPassword(e.target.value); setPwError(""); setPwSuccess(""); }}
              placeholder="New password (min 6 characters)"
              style={{ width: "100%", padding: "10px 40px 10px 13px", border: "1px solid var(--line)", borderRadius: 9, font: "inherit", fontSize: 14, background: "var(--card)", boxSizing: "border-box" }}
            />
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
          {pwError && <div style={{ background: "var(--red-soft)", color: "var(--red)", padding: "10px 13px", borderRadius: 9, fontSize: 13, marginBottom: 12, fontWeight: 600 }}>{pwError}</div>}
          {pwSuccess && <div style={{ background: "var(--green-soft)", color: "var(--green)", padding: "10px 13px", borderRadius: 9, fontSize: 13, marginBottom: 12, fontWeight: 600 }}>{pwSuccess}</div>}
          <button
            onClick={handleChangePassword}
            disabled={pwSaving || !newPassword.trim()}
            style={{
              all: "unset", cursor: "pointer", background: !newPassword.trim() ? "var(--line)" : "var(--ink)", color: "#fff",
              padding: "10px 16px", borderRadius: 11, fontWeight: 600, fontSize: "13.5px",
            }}
          >{pwSaving ? "Updating..." : "Update Password"}</button>
        </div>
      </section>

      {/* ── Two-Factor Authentication ── */}
      <section>
        <h2 style={{ fontFamily: '"Fraunces",Georgia,serif', fontSize: 20, fontWeight: 600, marginBottom: 4 }}>Two-Factor Authentication</h2>
        <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 16 }}>Add an extra layer of security to your account.</p>
        <div className="panel" style={{
          background: "var(--card)", border: "1px solid var(--line)", borderRadius: 16, padding: 20,
        }}>
          {step === "done" && user?.email_2fa_enabled && (
            <div>
              <div style={{ background: "var(--green-soft)", border: "1px solid var(--green)", borderRadius: 11, padding: 14, marginBottom: 14, textAlign: "center" }}>
                <span style={{ fontSize: 20 }}>✅</span>
                <p style={{ fontWeight: 600, fontSize: 14, marginTop: 6, color: "var(--green)" }}>2FA is enabled on your account</p>
                <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>You'll receive a verification code via email when signing in.</p>
              </div>
              <button onClick={startDisable} disabled={saving}
                style={{ all: "unset", cursor: "pointer", background: "var(--red-soft)", color: "var(--red)", padding: "9px 16px", borderRadius: 9, fontWeight: 600, fontSize: 13 }}>
                {saving ? "Sending code..." : "Disable 2FA"}
              </button>
            </div>
          )}

          {step === "setup" && !user?.email_2fa_enabled && (
            <div>
              <div style={{ background: "var(--amber-soft)", border: "1px solid var(--amber-line)", borderRadius: 11, padding: 14, marginBottom: 14 }}>
                <p style={{ fontSize: 13, color: "var(--amber)" }}><strong>Recommended</strong> — When enabled, you'll receive a 6-digit code via email each time you sign in.</p>
              </div>
              {error && <div style={{ background: "var(--red-soft)", color: "var(--red)", padding: "10px 13px", borderRadius: 9, fontSize: 13, marginBottom: 12, fontWeight: 600 }}>{error}</div>}
              <button onClick={startSetup} disabled={saving}
                style={{ all: "unset", cursor: "pointer", background: "var(--teal)", color: "#fff", padding: "10px 16px", borderRadius: 11, fontWeight: 600, fontSize: 13 }}>
                {saving ? "Sending code..." : "Enable Email 2FA"}
              </button>
            </div>
          )}

          {step === "verify" && (
            <div>
              <div style={{ background: "var(--teal-soft)", border: "1px solid var(--teal)", borderRadius: 11, padding: 14, marginBottom: 14 }}>
                <p style={{ fontWeight: 600, fontSize: 13, color: "var(--teal)" }}>Check your email</p>
                <p style={{ fontSize: 13, marginTop: 4 }}>{message}{email ? ` — sent to ${email}` : ""}</p>
                <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>Enter the 6-digit code. Expires in 10 minutes.</p>
              </div>
              {error && <div style={{ background: "var(--red-soft)", color: "var(--red)", padding: "10px 13px", borderRadius: 9, fontSize: 13, marginBottom: 12, fontWeight: 600 }}>{error}</div>}
              <input type="text" inputMode="numeric" maxLength={6} value={code}
                onChange={e => { setCode(e.target.value.replace(/\D/g, "")); setError(""); }}
                onKeyDown={e => { if (e.key === "Enter") user?.email_2fa_enabled ? confirmDisable() : verifyCode(); }}
                placeholder="000000" autoFocus
                style={{ width: "100%", padding: "11px 14px", border: "1px solid var(--line)", borderRadius: 9, font: "inherit", fontSize: 18, textAlign: "center", letterSpacing: "0.3em", fontFamily: "monospace", marginBottom: 12 }}
              />
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => { setStep(user?.email_2fa_enabled ? "done" : "setup"); setError(""); setCode(""); }}
                  style={{ all: "unset", cursor: "pointer", flex: 1, textAlign: "center", padding: "10px 16px", border: "1px solid var(--line)", borderRadius: 11, fontWeight: 600, fontSize: 13, color: "var(--ink)" }}>
                  Cancel
                </button>
                <button onClick={user?.email_2fa_enabled ? confirmDisable : verifyCode} disabled={saving || code.length !== 6}
                  style={{ all: "unset", cursor: "pointer", flex: 1, textAlign: "center", padding: "10px 16px", background: "var(--teal)", color: "#fff", borderRadius: 11, fontWeight: 600, fontSize: 13, opacity: saving || code.length !== 6 ? 0.6 : 1 }}>
                  {saving ? "Verifying..." : user?.email_2fa_enabled ? "Confirm Disable" : "Verify & Enable"}
                </button>
              </div>
              <button onClick={user?.email_2fa_enabled ? startDisable : startSetup} disabled={saving}
                style={{ all: "unset", cursor: "pointer", display: "block", width: "100%", textAlign: "center", marginTop: 10, color: "var(--teal)", fontWeight: 600, fontSize: 13 }}>
                Resend code
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
