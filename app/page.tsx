"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/practiceops/icons";
import { APPS, FIRM, OPS_NAV, ROLE_LABELS, canOpenApp, type AppDef, type AppId, type RailItem } from "@/components/practiceops/apps";
import { useSession } from "@/components/practiceops/session";
import { createBillingApi } from "@/lib/billing-ui/api";
import { formatMoney } from "@/lib/billing-ui/view-model";

interface ClientStats { total: number; business: number; personal: number }
interface ArStats { open: number; overdue: number; outstanding: number; oldestDays: number }

type Stat = [value: string, label: string];

function greeting(now: Date) {
  const hour = now.getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

/** The launch pad: the first page after sign-in, with one tile per app. */
export default function LaunchPad() {
  const router = useRouter();
  const { role, allowedModules, userName, userEmail } = useSession();
  const [clients, setClients] = useState<ClientStats | null>(null);
  const [ar, setAr] = useState<ArStats | null>(null);
  const [now] = useState(() => new Date());
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const seesClients = allowedModules.includes("Clients");
  const seesBilling = allowedModules.includes("Billing");

  useEffect(() => {
    if (!seesClients) return;
    let cancelled = false;
    // limit=1: the route returns firm-wide counts in `stats` before paging, so this stays cheap.
    fetch("/api/clients?fields=lite&limit=1", { cache: "no-store" })
      .then(response => response.ok ? response.json() : null)
      .then(data => { if (!cancelled && data?.stats) setClients(data.stats); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [seesClients]);

  useEffect(() => {
    if (!seesBilling) return;
    let cancelled = false;
    createBillingApi((input, init) => fetch(input, init)).receivables().then(result => {
      if (cancelled || !result.ok) return;
      const open = result.data.receivables.filter(item => Number(item.balance) > 0);
      setAr({
        open: open.length,
        overdue: open.filter(item => item.days_past_due > 0).length,
        outstanding: open.reduce((sum, item) => sum + Number(item.balance), 0),
        oldestDays: open.reduce((max, item) => Math.max(max, item.days_past_due), 0),
      });
    });
    return () => { cancelled = true; };
  }, [seesBilling]);

  const [roleLabel, roleBlurb] = ROLE_LABELS[role] || ROLE_LABELS.staff;
  const first = (userName || userEmail).split(/[\s@]/)[0];
  const dateLine = now.toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  const tileStats = useMemo<Record<AppId, Stat[]>>(() => ({
    ops: clients ? [[clients.total.toLocaleString(), "Clients"], [clients.business.toLocaleString(), "Business"], [clients.personal.toLocaleString(), "Personal"]] : [],
    bill: ar ? [[formatMoney(ar.outstanding), "Outstanding"], [String(ar.open), "Open invoices"]] : [],
    coll: ar ? [[String(ar.overdue), "Overdue"], [`${ar.oldestDays}d`, "Oldest"]] : [],
    c360: [], desk: [], onb: [], docs: [], train: [], help: [],
  }), [clients, ar]);

  const pulse: Array<[string, string, string, React.CSSProperties?]> = [];
  if (clients) pulse.push(["Clients", clients.total.toLocaleString(), `${clients.business} business · ${clients.personal} personal`]);
  if (ar) {
    pulse.push(["Open invoices", String(ar.open), "with a balance still due"]);
    pulse.push(["Outstanding AR", formatMoney(ar.outstanding), `oldest ${ar.oldestDays} days`, { color: "var(--red)" }]);
    pulse.push(["Overdue", String(ar.overdue), "invoices past their due date", { color: "var(--amber)" }]);
  }
  const openable = APPS.filter(app => app.built && canOpenApp(app, allowedModules));
  if (!ar) pulse.push(["Your apps", String(openable.length), "open to you from this launch pad"]);

  const hidden = APPS.filter(app => app.built && !canOpenApp(app, allowedModules));

  function open(app: AppDef) {
    if (app.built && !canOpenApp(app, allowedModules)) {
      setNotice(`${app.name} isn't part of your access. Ask an owner or admin if you need it.`);
      return;
    }
    if (app.id === "ops") {
      const first = OPS_NAV.find((item): item is RailItem => item !== "sep" && allowedModules.includes(item.module));
      if (first) router.push(first.href);
      return;
    }
    router.push(app.href);
  }

  return (
    <div className="pad">
      <div className="pad-head">
        <div>
          <h1 className="pad-greet">{greeting(now)}{first ? `, ${first}` : ""}</h1>
          <p className="pad-sub">{dateLine} · here&apos;s where {FIRM.name} stands.</p>
        </div>
        <div className="pad-role">
          <div className="pk">Signed in as</div>
          <div className="pv">{roleLabel}</div>
          <div className="pd">{roleBlurb}</div>
        </div>
      </div>

      {pulse.length > 0 && (
        <div className="pulse">
          {pulse.map(([label, value, detail, style]) => (
            <div key={label} className="pz">
              <div className="k">{label}</div>
              <div className="v num" style={style}>{value}</div>
              <div className="d">{detail}</div>
            </div>
          ))}
        </div>
      )}

      <div className="tiles">
        {APPS.map(app => {
          const allowed = canOpenApp(app, allowedModules);
          if (app.built && !allowed) {
            return (
              <button key={app.id} className="tile locked" onClick={() => open(app)}>
                <span className="t-flag lock"><Icon name="lock" style={{ display: "grid", width: 11, height: 11 }} /> Not in this role</span>
                <span className="t-ico"><Icon name={app.icon} style={{ display: "grid" }} /></span>
                <span className="t-name">{app.name}</span>
                <span className="t-desc">{app.desc}</span>
                <span className="t-unlock">Ask an owner or admin for access →</span>
              </button>
            );
          }
          if (!app.built) {
            return (
              <button key={app.id} className="tile locked" onClick={() => open(app)}>
                <span className="t-flag core">Coming soon</span>
                <span className="t-ico"><Icon name={app.icon} style={{ display: "grid" }} /></span>
                <span className="t-name">{app.name}</span>
                <span className="t-desc">{app.desc}</span>
                <span className="t-unlock" style={{ color: "var(--muted)" }}>Not set up for {FIRM.name} yet</span>
              </button>
            );
          }
          const stats = tileStats[app.id];
          return (
            <button key={app.id} className="tile" onClick={() => open(app)}>
              {app.core && <span className="t-flag core">Core</span>}
              <span className="t-ico"><Icon name={app.icon} style={{ display: "grid" }} /></span>
              <span className="t-name">{app.name}</span>
              <span className="t-desc">{app.desc}</span>
              {stats.length > 0 && (
                <span className="t-stats">
                  {stats.map(([value, label]) => (
                    <span key={label} className="t-stat"><span className="sv num">{value}</span><span className="sk">{label}</span></span>
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {hidden.length > 0 && (
        <div className="hidden-note">
          <b>{hidden.length} app{hidden.length > 1 ? "s" : ""} outside your access</b> — {hidden.map(app => app.name).join(", ")}.
          {" "}Access is set per person by an owner or admin in Users &amp; Access.
        </div>
      )}

      <div className="padfoot">
        <span>PracticeOps · {FIRM.name} · {FIRM.city}</span>
        <span>Tiles marked “Coming soon” are planned apps that are not set up yet.</span>
      </div>

      <div className={`toast${notice ? " show" : ""}`} role="status">{notice}</div>
    </div>
  );
}
