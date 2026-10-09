"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ClientsProvider } from "@/hooks/use-clients-context";
import { canAccessPathname, effectiveModules, firstAllowedRoute, normalizeRole } from "@/lib/access-policy";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";
import "./globals.css";

interface NavItem {
  label: string;
  href: string;
  icon?: string;
  role?: "owner" | "admin" | "manager" | "all";
  module?: string;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Clients", href: "/", icon: "👥", module: "Clients" },
  { label: "Contacts", href: "/contacts", icon: "👤", module: "Clients" },
  { label: "Team Workload", href: "/workload", icon: "⚖️", module: "Workload" },
  { label: "Timesheet", href: "/time", icon: "⏱️", module: "Timesheet" },
  { label: "---", href: "" },
  { label: "Financials", href: "/fin", icon: "📊", module: "Financials" },
  { label: "Payroll", href: "/pr", icon: "💵", module: "Payroll" },
  { label: "Sales Tax", href: "/stx", icon: "🧾", module: "Sales Tax" },
  { label: "1099s", href: "/t9", icon: "📄", module: "1099s" },
  { label: "Tax Returns", href: "/tax", icon: "📋", module: "Tax Returns" },
  { label: "Renditions", href: "/rend", icon: "🏠", module: "Renditions" },
  { label: "Annual Reports", href: "/annual", icon: "📄", module: "Annual Reports" },
  { label: "---", href: "" },
  { label: "Billing", href: "/billing", icon: "🧾", module: "Billing" },
  { label: "Collections", href: "/collections", icon: "📬", module: "Collections" },
  { label: "---", href: "" },
  { label: "Password Vault", href: "/vault", icon: "🔒", module: "Vault" },
  { label: "Users & Access", href: "/users", icon: "🪪", module: "Users & Access" },
  { label: "Help & Support", href: "/support", icon: "🛟", module: "Support" },
  { label: "Support Inbox", href: "/support/inbox", icon: "📥", role: "admin", module: "Support" },
  { label: "Settings", href: "/settings", icon: "⚙️" },
];

const PAGE_TITLES: Record<string, { title: string; subtitle: string }> = {
  "/": { title: "Clients", subtitle: "Your single source of truth - every client, business and personal, in one list." },
  "/contacts": { title: "Contacts", subtitle: "A shared directory for every client contact - organized for quick lookup and follow-through." },
  "/workload": { title: "Team Workload", subtitle: "Who\u2019s carrying what — by client count and by estimated effort. Spot overload before it bites." },
  "/time": { title: "Timesheet", subtitle: "Live time tracking by person and client — lean by design; profitability analytics come next." },
  "/fin": { title: "Financials", subtitle: "Bread & butter. Everyone here was flagged \u2018Financials\u2019 on their client card." },
  "/pr": { title: "Payroll", subtitle: "Runs counted by month — weekly 4\u20135\u00d7, bi-weekly up to 2\u00d7. Rolls up to a monthly status." },
  "/stx": { title: "Sales Tax", subtitle: "Auto-populated from clients with Sales Tax switched on." },
  "/t9": { title: "1099s", subtitle: "Clients flagged for 1099 filing." },
  "/tax": { title: "Tax Returns", subtitle: "Annual returns — clients flagged for tax prep." },
  "/rend": { title: "Renditions", subtitle: "Clients flagged for renditions filing." },
  "/annual": { title: "Annual Reports", subtitle: "State renewals — clients flagged for annual filings." },
  "/vault": { title: "Password Vault", subtitle: "Portal logins. Kept separate from client files, on purpose." },
  "/users": { title: "Users & Access", subtitle: "Who can get into the platform, what they can see, and who they report to. Owner-controlled." },
  "/support": { title: "Help & Support", subtitle: "Stuck on something? Open a ticket and our team will jump on it." },
  "/support/inbox": { title: "Support Inbox", subtitle: "Firm-wide support tickets, grouped by application." },
  "/settings": { title: "Settings", subtitle: "Your account details, password, and security settings." },
};

async function logoutAndRedirect() {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5000);

  try {
    // The API clears the HttpOnly session cookie. The redirect must not depend
    // on this request succeeding, otherwise a stalled API leaves the button
    // looking inactive.
    await fetch("/api/demo-login", {
      method: "DELETE",
      credentials: "include",
      signal: controller.signal,
    });
  } catch {
    // Continue clearing browser-visible cookies and leave the app regardless
    // of a network error or a slow serverless response.
  } finally {
    window.clearTimeout(timeout);
    document.cookie = "tap_demo_user=; path=/; max-age=0";
    document.cookie = "tap_demo_email=; path=/; max-age=0";
    document.cookie.split("; ").forEach((cookie) => {
      const name = cookie.split("=")[0];
      if (name.includes("sb-") || name.includes("supabase")) {
        document.cookie = `${name}=; path=/; max-age=0`;
      }
    });
    window.location.replace("/login");
  }
}

// ── Mobile sidebar ──
function MobileSidebar({
  visibleNav,
  pathname,
  open,
  onClose,
  onNavigate,
}: {
  visibleNav: NavItem[];
  pathname: string;
  open: boolean;
  onClose: () => void;
  onNavigate: (href: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={onClose} />
      <div
        ref={ref}
        className="fixed top-0 left-0 z-50 h-full w-64 flex flex-col shadow-2xl md:hidden"
        style={{
          background: "linear-gradient(180deg, var(--sidebar-start) 0%, var(--sidebar-end) 100%)",
          color: "#eef2fb",
        }}
      >
        <div className="px-4 pt-[22px] pb-6 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-white m-0" style={{ fontFamily: '"Fraunces", Georgia, serif' }}>TAP</h2>
            <p className="text-[10.5px] uppercase tracking-[0.13em] font-medium mt-1.5" style={{ color: "#9fb0d8", fontFamily: '"Public Sans", sans-serif' }}>Associates, LLC · Est. 1999</p>
          </div>
          <button
            onClick={onClose}
            className="text-[#c4cee8] hover:text-white text-lg leading-none p-1"
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>
        <nav className="nav flex-1 px-3 space-y-[3px] overflow-y-auto" style={{ marginTop: 6 }}>
          {visibleNav.map((item, i) => {
            if (item.label === "---") {
              return <div key={`sep-m-${i}`} className="sep" />;
            }
            const isActive = pathname === item.href.split("?")[0];
            return (
              <button
                key={item.label}
                onClick={() => { onNavigate(item.href); onClose(); }}
                className={isActive ? "on" : ""}
              >
                {item.icon && (
                  <span className="ic">{item.icon}</span>
                )}
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="px-3 pb-3">
          <button
            onClick={() => { void logoutAndRedirect(); }}
            className="flex items-center gap-2 px-3 py-2.5 rounded-[10px] text-sm font-medium text-[#c4cee8] hover:bg-white/10 hover:text-white transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.9 }}>
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Log out
          </button>
        </div>
        <div className="px-4 pb-[22px] pt-4 text-[11px]" style={{ color: "#8a9bc6" }}>Demo prototype · one entry, flows everywhere · no formulas</div>
      </div>
    </>
  );
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const isAuthPage = pathname === "/login" || pathname.startsWith("/auth");
  const [accessLoading, setAccessLoading] = useState(!isAuthPage);
  const [role, setRole] = useState<string>("staff");
  const [realRole, setRealRole] = useState<string>("staff");
  const [userModules, setUserModules] = useState<string[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");

  useEffect(() => {
    if (isAuthPage) {
      setAccessLoading(false);
      return;
    }
    let cancelled = false;
    setAccessLoading(true);
    fetch("/api/me", { credentials: "include", cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error("Unauthorized");
        return response.json();
      })
      .then(data => {
        if (cancelled) return;
        const resolvedRole = normalizeRole(data.role);
        setRealRole(resolvedRole);
        setRole(resolvedRole);
        setUserModules(Array.isArray(data.modules) ? data.modules : []);
        setUserName(String(data.name || ""));
        setUserEmail(String(data.email || ""));
        setAccessLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setAccessLoading(false);
        router.replace("/login");
      });
    return () => { cancelled = true; };
  }, [isAuthPage, router]);

  const allowedModules = useMemo(() => effectiveModules(role, userModules), [role, userModules]);
  const visibleNav = useMemo(
    () => accessLoading ? [] : NAV_ITEMS.filter((item) => {
      const allowedByModule = !item.module || allowedModules.includes(item.module);
      const allowedByRole = !item.role || item.role === "all" || item.role === role || (item.role === "admin" && ["owner", "admin"].includes(role));
      return allowedByModule && allowedByRole;
    }),
    [accessLoading, allowedModules, role],
  );

  useEffect(() => {
    if (isAuthPage || accessLoading || canAccessPathname(role, userModules, pathname)) return;
    router.replace(firstAllowedRoute(role, userModules));
  }, [accessLoading, isAuthPage, pathname, role, router, userModules]);

  // The full client dataset is several megabytes. Pages that do not consume it
  // should render without paying for that request.
  const needsClientData = ["/", "/workload", "/time", "/fin", "/pr", "/stx", "/t9", "/tax", "/rend", "/annual", "/vault"].includes(pathname);
  const canUseLightweightClientData = ["/workload", "/time", "/vault"].includes(pathname);
  const pageInfo = PAGE_TITLES[pathname] || PAGE_TITLES["/"];

  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Public+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className="h-screen flex flex-col md:flex-row overflow-hidden" style={{ backgroundColor: "var(--paper)" }}>
        <ServiceWorkerRegistration />
        {/* ── Desktop Sidebar ── */}
        {!isAuthPage && (
          <aside
            className="hidden md:flex sticky top-0 h-screen flex-col shrink-0 select-none overflow-hidden"
            style={{
              width: "var(--sidebar-width)",
              background: "linear-gradient(180deg, var(--sidebar-start) 0%, var(--sidebar-end) 100%)",
              color: "#eef2fb",
              padding: "22px 16px",
            }}
          >
            {/* Brand */}
            <div className="shrink-0" style={{ fontFamily: '"Fraunces", Georgia, serif', fontWeight: 600, fontSize: 24, color: "#fff", lineHeight: 1 }}>
              TAP
              <div style={{ display: "block", fontFamily: '"Public Sans", sans-serif', fontWeight: 500, fontSize: "10.5px", letterSpacing: "0.13em", textTransform: "uppercase", color: "#9fb0d8", marginTop: 6 }}>
                Associates, LLC · Est. 1999
              </div>
            </div>

            {/* Nav — min-h-0 + overflow-y-auto so short viewports can scroll the menu */}
            <nav className="nav flex flex-col gap-[3px] flex-1 min-h-0 overflow-y-auto" style={{ marginTop: 28 }}>
              {accessLoading && (
                <div className="space-y-3 px-2" aria-label="Loading navigation">
                  {[72, 88, 64, 92, 76, 84].map((width, index) => (
                    <div key={index} className="h-8 rounded-lg animate-pulse" style={{ width: `${width}%`, background: "rgba(255,255,255,.10)" }} />
                  ))}
                </div>
              )}
              {visibleNav.map((item, i) => {
                if (item.label === "---") {
                  return <div key={`sep-${i}`} className="sep" />;
                }
                const isActive = pathname === item.href.split("?")[0];
                return (
                  <button
                    key={item.label}
                    onClick={() => router.push(item.href)}
                    className={isActive ? "on" : ""}
                  >
                    {item.icon && (
                      <span className="ic">{item.icon}</span>
                    )}
                    <span>{item.label}</span>
                  </button>
                );
              })}
        </nav>

        {/* Logout */}
        <div className="pb-3 shrink-0">
          <button
            onClick={() => { void logoutAndRedirect(); }}
            className="flex items-center gap-2 px-3 py-[10px] rounded-[10px] text-sm font-medium transition-colors w-full"
                style={{ color: "#c4cee8" }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.10)"; e.currentTarget.style.color = "#fff"; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "#c4cee8"; }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.9 }}>
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                Log out
              </button>
            </div>

            {/* Footer */}
            <div className="text-[11px] shrink-0" style={{ color: "#8a9bc6", lineHeight: 1.5 }}>
              Demo prototype · one entry,<br />flows everywhere · no formulas
            </div>
          </aside>
        )}

        {/* ── Mobile sidebar drawer ── */}
        {!isAuthPage && (
          <MobileSidebar visibleNav={visibleNav} pathname={pathname} open={sidebarOpen} onClose={() => setSidebarOpen(false)} onNavigate={href => router.push(href)} />
        )}

        {/* ── Main content ── */}
        <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
          {/* Top bar */}
          {!isAuthPage && (
            <header
              className="flex items-end justify-between shrink-0"
              style={{
                padding: "22px 32px 0",
              }}
            >
              <div className="flex items-center gap-4 min-w-0">
                {/* Hamburger */}
                <button
                  className="md:hidden flex items-center justify-center w-8 h-8 rounded-lg hover:bg-[var(--teal-soft)] transition-colors shrink-0"
                  onClick={() => setSidebarOpen(true)}
                  aria-label="Open menu"
                >
                  <svg width="20" height="16" viewBox="0 0 20 16" fill="none">
                    <rect y="0" width="20" height="2" rx="1" fill="var(--ink)" />
                    <rect y="7" width="20" height="2" rx="1" fill="var(--ink)" />
                    <rect y="14" width="20" height="2" rx="1" fill="var(--ink)" />
                  </svg>
                </button>

                <div className="min-w-0">
                  <h1 className="text-[30px] font-semibold text-[var(--ink)] m-0 leading-tight truncate" style={{ fontFamily: '"Fraunces", Georgia, serif' }}>
                    {pageInfo.title}
                  </h1>
                  <p className="hidden sm:block text-[13.5px] text-[var(--muted)] m-0 mt-[3px]">{pageInfo.subtitle}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {(userName || userEmail) && (
                  <div className="flex flex-col items-end min-w-0 max-w-[220px] leading-tight" aria-label="Signed-in user">
                    {userName && (
                      <span className="text-[13px] font-semibold text-[var(--ink)] truncate max-w-full">
                        {userName}
                      </span>
                    )}
                    {userEmail && (
                      <span className="text-[11px] text-[var(--muted)] truncate max-w-full">
                        {userEmail}
                      </span>
                    )}
                  </div>
                )}
                {/* ── Year selector for worklist pages ── */}
                {["/fin", "/pr", "/stx", "/t9", "/rend", "/tax"].includes(pathname) && (
                  <div className="hidden sm:flex items-center gap-2">
                    <span className="text-[12px] font-bold uppercase tracking-[0.04em] text-[var(--muted)]">Year</span>
                    <select
                      className="text-[13.5px] rounded-[11px] px-3 py-[10px] border border-[var(--line)] bg-[var(--card)] text-[var(--ink)] cursor-pointer"
                      style={{ appearance: "none", paddingRight: 30 }}
                      value={new URLSearchParams(typeof window !== "undefined" ? window.location.search : "").get("year") || String(new Date().getFullYear())}
                      onChange={(e) => {
                        const url = new URL(window.location.href);
                        url.searchParams.set("year", e.target.value);
                        window.location.href = url.toString();
                      }}
                    >
                      {(() => {
                        const currentYear = new Date().getFullYear();
                        return [currentYear].filter(y => y >= 2024).map((y, idx) => (
                          <option key={y} value={y}>{y}{idx === 0 ? " (current)" : ""}</option>
                        ));
                      })()}
                    </select>
                  </div>
                )}
                {/* Viewing as — visible only for real admin/owner users */}
                {(realRole === "admin" || realRole === "owner") && (
              <div className="flex items-center gap-2">
                  <span className="text-[12px] text-[var(--muted)]">Viewing as</span>
                  <select
                    value={role}
                    onChange={(e) => {
                      setRole(e.target.value);
                      document.cookie = `tap_demo_role=${e.target.value}; path=/; max-age=86400; SameSite=Lax`;
                    }}
                    className="text-[13px] rounded-[10px] px-3 py-[9px] border border-[var(--line)] bg-white text-[var(--ink)] cursor-pointer"
                    style={{ appearance: "none", paddingRight: 30 }}
                  >
                  <option value="owner">Owner</option>
                  <option value="admin">Admin</option>
                  <option value="manager">Manager</option>
                  <option value="staff">Staff</option>
                  <option value="offshore">India (Offshore)</option>
                </select>
              </div>
                )}
            </div>
            </header>
          )}

          {/* Page content */}
          <main className={`flex-1 ${isAuthPage ? "" : "px-8 py-[18px]"}`}>
            {!isAuthPage && accessLoading ? (
              <div className="space-y-4" aria-label="Loading page access">
                <div className="h-8 w-52 rounded-lg bg-[var(--line)] animate-pulse" />
                <div className="h-40 rounded-xl bg-[var(--card)] border border-[var(--line)] animate-pulse" />
              </div>
            ) : !isAuthPage && canAccessPathname(role, userModules, pathname) ? (
              <ClientsProvider enabled={needsClientData} lite={canUseLightweightClientData}>
                <div className="tip-container" style={{ margin: "0px 0px 14px 0px" }}>
                  {role === "india" && (
                    <div className="doorbar">
                      <span className="lk">🔐</span>
                      <span><b>Secure Web Door</b> — You are viewing as India (Offshore). All data is encrypted in transit and at rest. Do not share credentials.</span>
                    </div>
                  )}
                  {/* ── Tip banner ── */}
                  <div
                    className="hidden sm:flex gap-3 items-start rounded-[14px] border px-4 py-[13px]"
                    style={{
                      backgroundColor: "var(--teal-soft)",
                      borderColor: "#cdd6ec",
                      color: "var(--teal-ink)",
                    }}
                  >
                    <span>👋</span>
                    <div style={{ fontSize: "13.5px", lineHeight: 1.5 }}>
                      <b>Try this:</b> open any client → flip <b>Payroll</b> or <b>Sales&nbsp;Tax</b> on, then check that
                      service in the left menu. The client moves there automatically — nobody re-types anything.
                    </div>
                    <button
                      className="ml-auto cursor-pointer border-none bg-none text-lg opacity-60 hover:opacity-100"
                      style={{ color: "var(--teal-ink)", lineHeight: 1, fontSize: 18 }}
                      onClick={(e) => {
                        (e.currentTarget.parentElement!.parentElement as HTMLElement).style.display = "none";
                      }}
                    >
                      ×
                    </button>
                  </div>
                </div>
                {children}
              </ClientsProvider>
            ) : isAuthPage ? (
              children
            ) : null}
          </main>
        </div>
      </body>
    </html>
  );
}
