"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ClientsProvider } from "@/hooks/use-clients-context";
import { canAccessPathname, effectiveModules, firstAllowedRoute, normalizeRole } from "@/lib/access-policy";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";
import { Icon } from "@/components/practiceops/icons";
import { SessionContext } from "@/components/practiceops/session";
import { OpsRail } from "@/components/practiceops/ops-rail";
import { FIRM, OPS_NAV, OPS_PATHS, PAGE_HEADS, YEAR_PATHS, appForPath, type RailItem } from "@/components/practiceops/apps";
import "./globals.css";
import "./practiceops.css";

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

// Help & Support tabs. The inbox is the firm-wide dashboard, for owners and admins.
const SUPPORT_TABS = [
  { label: "Raise a ticket", href: "/support", role: "all" },
  { label: "Support inbox", href: "/support/inbox", role: "admin" },
];

const VIEW_AS_OPTIONS: Array<[string, string]> = [
  ["owner", "Owner"],
  ["admin", "Admin"],
  ["manager", "Manager"],
  ["staff", "Staff"],
  ["offshore", "Offshore"],
];

function YearSelect() {
  const current = new Date().getFullYear();
  const selected = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "").get("year") || String(current);
  return (
    <>
      <span className="flab">Year</span>
      <select
        className="inp"
        style={{ width: "auto" }}
        value={selected}
        onChange={(e) => {
          const url = new URL(window.location.href);
          url.searchParams.set("year", e.target.value);
          window.location.href = url.toString();
        }}
      >
        {[current].map((year, index) => (
          <option key={year} value={year}>{year}{index === 0 ? " (current)" : ""}</option>
        ))}
      </select>
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
  // True only once /api/me has answered. After signing in, the layout moves from
  // /login to the app before the new identity loads; redirecting on the default
  // (staff, no modules) would send every user to the fallback page.
  const [accessKnown, setAccessKnown] = useState(false);
  const [role, setRole] = useState<string>("staff");
  const [realRole, setRealRole] = useState<string>("staff");
  const [userModules, setUserModules] = useState<string[]>([]);
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
        setAccessKnown(true);
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
  const railItems = useMemo(
    () => OPS_NAV.filter((item): item is RailItem | "sep" => item === "sep" || allowedModules.includes(item.module))
      // Drop separators that would sit at the top, bottom, or next to each other.
      .filter((item, index, list) => item !== "sep" || (index > 0 && index < list.length - 1 && list[index - 1] !== "sep")),
    [allowedModules],
  );

  useEffect(() => {
    if (isAuthPage || accessLoading || !accessKnown || canAccessPathname(role, userModules, pathname)) return;
    router.replace(firstAllowedRoute(role, userModules));
  }, [accessKnown, accessLoading, isAuthPage, pathname, role, router, userModules]);

  // The full client dataset is several megabytes. Pages that do not consume it
  // should render without paying for that request.
  const needsClientData = ["/clients", "/workload", "/time", "/fin", "/pr", "/stx", "/t9", "/tax", "/rend", "/annual", "/vault"].includes(pathname);
  const canUseLightweightClientData = ["/workload", "/time", "/vault"].includes(pathname);
  const app = appForPath(pathname);
  const isOps = OPS_PATHS.includes(pathname);
  const ownsFrame = pathname === "/";
  const head = PAGE_HEADS[pathname];
  const firstName = (userName || userEmail).split(/[\s@]/)[0];
  const session = useMemo(
    () => ({ role, realRole, allowedModules, userName, userEmail }),
    [role, realRole, allowedModules, userName, userEmail],
  );

  const pageHead = head ? (
    <div className="phead">
      <div><h2>{head[0]}</h2><p className="psub">{head[1]}</p></div>
      {YEAR_PATHS.includes(pathname) && <div className="pacts"><YearSelect /></div>}
    </div>
  ) : null;

  const offshoreDoor = role === "offshore" ? (
    <div className="po-note amber">
      <span className="ni"><Icon name="lock" style={{ display: "inline-grid", width: 15, height: 15 }} /></span>
      <div><b>Secure web door — offshore view.</b> Limited to the accounts you&apos;re assigned: no fees, no vault, no bank access. Do not share credentials.</div>
    </div>
  ) : null;

  let page: React.ReactNode = null;
  if (ownsFrame) {
    page = children;
  } else if (isOps) {
    page = (
      <div className="appframe">
        <OpsRail items={railItems} pathname={pathname} footer={userName || userEmail} />
        <main className="work">
          {offshoreDoor}
          {pageHead}
          {children}
        </main>
      </div>
    );
  } else {
    const supportTabs = pathname.startsWith("/support")
      ? SUPPORT_TABS.filter(tab => tab.role === "all" || role === "owner" || role === "admin")
      : [];
    page = (
      <main className="work narrow">
        {pageHead}
        {supportTabs.length > 1 && (
          <div className="subnav">
            {supportTabs.map(tab => (
              <button key={tab.href} className={`snb${pathname === tab.href ? " on" : ""}`} onClick={() => router.push(tab.href)}>{tab.label}</button>
            ))}
          </div>
        )}
        {children}
      </main>
    );
  }

  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Public+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
      </head>
      <body>
        <ServiceWorkerRegistration />
        {isAuthPage ? children : (
          <>
            <header className="topbar">
              <button className="tb-mark" onClick={() => router.push("/")} title="Back to the launch pad">
                <span className="tb-glyph"><Icon name="compass" style={{ display: "grid" }} /></span>
                <span className="tb-name">Practice<em>Ops</em></span>
              </button>
              {(app || pathname === "/settings") && (
                <>
                  <span className="tb-sep" />
                  <button className="tb-back" onClick={() => router.push("/")}><Icon name="back" style={{ display: "grid" }} /> Launch pad</button>
                  <span className="tb-crumb"><b>{app ? app.name : "Settings"}</b></span>
                </>
              )}
              <div className="tb-right">
                <div className="tb-firm"><b>{FIRM.name}</b>{FIRM.city}</div>
                {(realRole === "admin" || realRole === "owner") ? (
                  <div className="rolewrap">
                    <label htmlFor="rolesel">Viewing as</label>
                    <select
                      id="rolesel"
                      value={role}
                      onChange={(e) => {
                        setRole(e.target.value);
                        document.cookie = `tap_demo_role=${e.target.value}; path=/; max-age=86400; SameSite=Lax`;
                      }}
                    >
                      {VIEW_AS_OPTIONS.map(([value, label]) => (
                        <option key={value} value={value}>{label}{firstName ? ` — ${firstName}` : ""}</option>
                      ))}
                    </select>
                  </div>
                ) : (userName || userEmail) ? (
                  <div className="tb-firm" aria-label="Signed-in user"><b>{userName || userEmail}</b>{userName ? userEmail : ""}</div>
                ) : null}
                {allowedModules.includes("Support") && (
                  <a className="tb-site" href="/support" onClick={(e) => { e.preventDefault(); router.push("/support"); }}>
                    <span className="tbl">Help</span>
                  </a>
                )}
                <a className="tb-site" href="/settings" onClick={(e) => { e.preventDefault(); router.push("/settings"); }}>
                  <span className="tbl">Settings</span>
                </a>
                <button className="tb-back" onClick={() => { void logoutAndRedirect(); }}>Log out</button>
              </div>
            </header>
            {accessLoading ? (
              <div className="work narrow" aria-label="Loading page access">
                <div className="h-8 w-52 rounded-lg bg-[var(--line)] animate-pulse" />
                <div className="mt-4 h-40 rounded-xl bg-[var(--card)] border border-[var(--line)] animate-pulse" />
              </div>
            ) : canAccessPathname(role, userModules, pathname) ? (
              <SessionContext.Provider value={session}>
                <ClientsProvider enabled={needsClientData} lite={canUseLightweightClientData}>
                  {page}
                </ClientsProvider>
              </SessionContext.Provider>
            ) : null}
          </>
        )}
      </body>
    </html>
  );
}
