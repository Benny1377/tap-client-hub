"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ApiResult, BillingApi } from "@/lib/billing-ui/api";
import type { ClientOption } from "@/lib/billing-ui/types";
import { ActionButton, hintStyle } from "./ui";

type Row = Record<string, unknown>;
type Service = { id: string; active: boolean; frequency: string | null; serviceCode: string | null; serviceName: string | null };
const inputStyle = { padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8, background: "var(--paper)", color: "var(--ink)", font: "inherit", minWidth: 0 } as const;
const buttonStyle = { padding: "8px 12px", border: "1px solid var(--brand-line)", borderRadius: 8, background: "var(--card)", color: "var(--navy)", font: "inherit", fontWeight: 600, cursor: "pointer" } as const;
const value = (row: Row, key: string, fallback = "") => row[key] == null ? fallback : String(row[key]);
const failureMessage = <T,>(result: ApiResult<T>) => result.ok === false ? `${result.message}${result.code ? ` (${result.code})` : ""}` : "";
function firmToday() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}-${parts.find((part) => part.type === "day")?.value}`;
}
function Reason({ value: reason, onChange }: { value: string; onChange: (v: string) => void }) {
  return <label style={{ display: "grid", gap: 4, minWidth: 180 }}>Reason <input style={inputStyle} value={reason} maxLength={1000} onChange={(e) => onChange(e.target.value)} required /></label>;
}
function Message({ children }: { children: ReactNode }) { return <p style={hintStyle}>{children}</p>; }

export function BillingProjectionWorkbench({ api, clientId, clients, canGenerate, onGenerated }: { api: BillingApi; clientId: string | null; clients: ClientOption[]; canGenerate: boolean; onGenerated: () => void }) {
  const [from, setFrom] = useState(`${firmToday().slice(0, 7)}-01`);
  const [to, setTo] = useState(firmToday());
  const [items, setItems] = useState<Row[]>([]);
  const [projectionRan, setProjectionRan] = useState(false);
  const [generated, setGenerated] = useState<Row | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const selectedClient = clientId || "";
  async function project() {
    if (!selectedClient) { setMessage("Choose a client before projecting."); return; }
    setBusy(true); setMessage(""); setGenerated(null); setProjectionRan(false);
    const result = await api.schedule({ from, to, clientId: selectedClient });
    if (result.ok === true) { setItems(result.data.items); setProjectionRan(true); } else setMessage(failureMessage(result));
    setBusy(false);
  }
  async function generate() {
    if (!selectedClient) return;
    setBusy(true); setMessage("");
    const result = await api.generateCandidates({ from, to, clientId: selectedClient });
    if (result.ok) { setGenerated(result.data as unknown as Row); setMessage("Generation finished. Existing candidates were not duplicated."); onGenerated(); }
    else setMessage(failureMessage(result));
    setBusy(false);
  }
  return <section className="bc-stack" aria-label="What bills next">
    <div className="bc-card">
      <h2 className="bc-sect">What bills next</h2>
      <p className="bc-hint">Projected recurring and configured completion work for one client. Viewing or refreshing this projection never creates candidates or invoices.</p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
        <span style={{ display: "grid", gap: 4 }}>Client <strong>{clients.find((client) => client.id === selectedClient)?.name || "Choose a client above"}</strong></span>
        <label style={{ display: "grid", gap: 4 }}>From (Houston date)<input type="date" style={inputStyle} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label style={{ display: "grid", gap: 4 }}>To (Houston date)<input type="date" style={inputStyle} value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <button type="button" disabled={busy || !selectedClient} style={buttonStyle} onClick={() => void project()}>{busy ? "Loading…" : "Preview projection"}</button>
        {canGenerate ? <button type="button" disabled={busy || !selectedClient} style={{ ...buttonStyle, opacity: busy || !selectedClient ? 0.55 : 1 }} onClick={() => void generate()}>Generate candidates</button> : <span style={hintStyle}>Your access does not include generating candidates.</span>}
      </div>
      {message ? <p role="status" style={hintStyle}>{message}</p> : null}
      {generated ? <div role="status" className="bc-source"><b>Created {value(generated, "created", "0")}</b> · Existing {value(generated, "existing", "0")} · Unpriced {value(generated, "unpriced", "0")} · Skipped {value(generated, "skipped", "0")}<br />Skip reasons: {Object.entries((generated.skippedByReason as Row) || {}).map(([key, count]) => `${key.replaceAll("_", " ")}: ${String(count)}`).join(" · ") || "none"}</div> : null}
    </div>
    <div className="bc-card">
      <h3 className="bc-h">Projected items <small>{items.length} shown</small></h3>
      {!items.length ? <Message>{projectionRan ? "No projected work matches this client and date window." : "Run Preview projection to see expected work."} An unpriced item is captured in the projection but cannot be drafted until a price is configured.</Message> : <div className="panel scroll"><table><thead><tr><th>Date</th><th>Service</th><th>Description</th><th>Period</th><th>Price</th><th>State</th></tr></thead><tbody>{items.map((item, index) => <tr key={`${value(item, "clientServiceId")}-${value(item, "candidateDate")}-${index}`}><td>{value(item, "candidateDate")}</td><td>{value(item, "serviceCode", "—")}</td><td>{value(item, "description", "—")}</td><td>{value(item, "period", "—")}</td><td>{value(item, "unitAmount", "Unpriced")}</td><td>{value(item, "state", "projected")}</td></tr>)}</tbody></table></div>}
    </div>
  </section>;
}

export function BillingPricingWorkbench({ api, clientId, clients, canView, canManage }: { api: BillingApi; clientId: string | null; clients: ClientOption[]; canView: boolean; canManage: boolean }) {
  const [services, setServices] = useState<Service[]>([]);
  const [cards, setCards] = useState<Row[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [pricing, setPricing] = useState<{ overrides: Row[]; bundles: Row[] }>({ overrides: [], bundles: [] });
  const [bundleCursor, setBundleCursor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [rateCardId, setRateCardId] = useState("");
  const [entries, setEntries] = useState<Row[]>([]);
  const [bundleComponents, setBundleComponents] = useState<Record<string, string[]>>({});
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!canView || !clientId) return;
    let cancelled = false;
    Promise.all([api.clientServices(clientId), api.clientPricing(clientId), api.bundleCatalog(clientId)]).then(([serviceResult, pricingResult, bundleResult]) => {
      if (cancelled) return;
      if (serviceResult.ok === true) setServices(serviceResult.data.items); else setError(failureMessage(serviceResult));
      if (pricingResult.ok === true) setPricing({ overrides: pricingResult.data.overrides, bundles: [] }); else setError(failureMessage(pricingResult));
      if (bundleResult.ok === true) { setPricing((current) => ({ ...current, bundles: bundleResult.data.items as unknown as Row[] })); setBundleCursor(bundleResult.data.nextCursor); }
      else setError(failureMessage(bundleResult));
      if (serviceResult.ok === true && pricingResult.ok === true && bundleResult.ok === true) setLoadedFor(clientId);
    });
    return () => { cancelled = true; };
  }, [api, clientId, canView, refresh]);
  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    api.rateCards(cursor).then((result) => { if (cancelled) return; if (result.ok === true) { setCards((current) => cursor ? [...current, ...result.data.items] : result.data.items); setNextCursor(result.data.nextCursor); } else setError(failureMessage(result)); });
    return () => { cancelled = true; };
  }, [api, canView, cursor, refresh]);
  useEffect(() => {
    if (!rateCardId) return;
    let cancelled = false;
    api.rateCard(rateCardId).then((result) => { if (cancelled) return; if (result.ok === true) setEntries(result.data.entries); else setError(failureMessage(result)); });
    return () => { cancelled = true; };
  }, [api, rateCardId, refresh]);
  const serviceOptions = useMemo(() => services.filter((service) => service.active), [services]);
  async function run(action: () => Promise<ApiResult<unknown>>) {
    if (!reason.trim()) return { ok: false as const, status: 422, kind: "invalid" as const, message: "Enter an audit reason first." };
    const result = await action();
    if (result.ok === false) setError(failureMessage(result)); else { setError(""); setReason(""); setCards([]); setCursor(null); setRefresh((n) => n + 1); }
    return result;
  }
  if (!canView) return <div className="bc-card"><h2 className="bc-sect">Clients &amp; prices</h2><Message>Price details are restricted to Owner/Admin and authorized Billing users.</Message></div>;
  const visibleServices = loadedFor === clientId ? serviceOptions : [];
  const visibleOverrides = loadedFor === clientId ? pricing.overrides : [];
  const visibleBundles = loadedFor === clientId ? pricing.bundles : [];
  return <section className="bc-stack" aria-label="Clients and prices">
    <div className="bc-card"><h2 className="bc-sect">Clients &amp; prices <small>{clients.find((client) => client.id === clientId)?.name || ""}</small></h2><p className="bc-hint">Client-specific overrides take precedence over rate-card prices. Prices are server-resolved; changing a price does not rewrite existing candidates or invoices.</p>
      {!clientId ? <Message>Choose a client to view its service assignments, overrides, and bundles.</Message> : <>
        <h3 className="bc-h">Client services <small>{serviceOptions.length} active</small></h3>
        <div className="panel scroll"><table><thead><tr><th>Service</th><th>Code</th><th>Frequency</th><th>Client service ID</th></tr></thead><tbody>{visibleServices.map((service) => <tr key={service.id}><td>{service.serviceName || "—"}</td><td>{service.serviceCode || "—"}</td><td>{service.frequency || "—"}</td><td><code>{service.id}</code></td></tr>)}</tbody></table></div>
        <h3 className="bc-h" style={{ marginTop: 18 }}>Client price overrides <small>{visibleOverrides.length}</small></h3>
        <div className="panel scroll"><table><thead><tr><th>Service</th><th>Unit price</th><th>Effective</th><th>End</th><th>Update</th></tr></thead><tbody>{visibleOverrides.map((item) => <tr key={value(item, "id")}><td>{visibleServices.find((service) => service.id === value(item, "clientServiceId"))?.serviceName || value(item, "clientServiceId")}</td><td>{value(item, "unitAmount")}</td><td>{value(item, "effectiveFrom")}</td><td>{value(item, "effectiveTo", "Open")}</td><td>{canManage ? <ActionButton label="End today" quiet onAction={() => run(() => api.updatePriceOverride(value(item, "id"), { effectiveTo: firmToday(), reason }))} /> : "View only"}</td></tr>)}</tbody></table></div>
        {canManage ? <div className="bc-card" style={{ marginTop: 14 }}><h3 className="bc-h">Add client-service price override</h3><div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
          <label style={{ display: "grid", gap: 4 }}>Service<select style={inputStyle} id="billing-price-service"><option value="">Select service</option>{serviceOptions.map((service) => <option key={service.id} value={service.id}>{service.serviceName} · {service.serviceCode}</option>)}</select></label>
          <label style={{ display: "grid", gap: 4 }}>Unit amount<input style={inputStyle} id="billing-price-amount" inputMode="decimal" placeholder="0.00" /></label>
          <label style={{ display: "grid", gap: 4 }}>Effective from<input style={inputStyle} id="billing-price-from" type="date" /></label>
          <Reason value={reason} onChange={setReason} />
          <ActionButton label="Save override" disabled={!reason.trim()} onAction={() => {
            const element = (id: string) => document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
            return run(() => api.createPriceOverride({ clientServiceId: element("billing-price-service")?.value, unitAmount: element("billing-price-amount")?.value, effectiveFrom: element("billing-price-from")?.value, reason }));
          }} />
        </div></div> : null}
        <h3 className="bc-h" style={{ marginTop: 18 }}>Bundles <small>{visibleBundles.length} loaded</small></h3>
        <div className="panel scroll"><table><thead><tr><th>Package</th><th>Package price</th><th>Effective</th><th>Components</th><th>Update</th></tr></thead><tbody>{visibleBundles.map((bundle) => <tr key={value(bundle, "id")}><td>{value(bundle, "name")}</td><td>{value(bundle, "unitAmount")}</td><td>{value(bundle, "effectiveFrom")} – {value(bundle, "effectiveTo", "open")}</td><td>{bundleComponents[value(bundle, "id")]?.length ?? (Array.isArray(bundle.components) ? bundle.components.length : 0)}</td><td>{canManage ? <button type="button" style={buttonStyle} onClick={() => setBundleComponents((current) => ({ ...current, [value(bundle, "id")]: visibleServices.map((service) => service.id).filter((id) => (bundle.components as Array<{ clientServiceId: string }> || []).some((component) => component.clientServiceId === id)) }))}>Edit components</button> : "View only"}</td></tr>)}</tbody></table></div>
        {loadedFor === clientId && bundleCursor ? <button type="button" style={buttonStyle} onClick={async () => { if (!clientId || !bundleCursor) return; const result = await api.bundleCatalog(clientId, bundleCursor); if (result.ok === true) { setPricing((current) => ({ ...current, bundles: [...current.bundles, ...(result.data.items as unknown as Row[])] })); setBundleCursor(result.data.nextCursor); } else setError(failureMessage(result)); }}>Load next bundle page</button> : null}
        {canManage ? visibleBundles.map((bundle) => <details className="bc-card" key={`bundle-edit-${value(bundle, "id")}`} style={{ marginTop: 10 }}><summary style={{ cursor: "pointer" }}>Edit {value(bundle, "name")} package terms</summary><div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}><input id={`bundle-name-${value(bundle, "id")}`} style={inputStyle} aria-label="Bundle name" defaultValue={value(bundle, "name")} /><input id={`bundle-amount-${value(bundle, "id")}`} style={inputStyle} aria-label="Bundle amount" inputMode="decimal" defaultValue={value(bundle, "unitAmount")} /><input id={`bundle-end-${value(bundle, "id")}`} style={inputStyle} aria-label="Bundle effective end" type="date" defaultValue={value(bundle, "effectiveTo")} /><Reason value={reason} onChange={setReason} /><ActionButton label="Save bundle terms" disabled={!reason.trim()} onAction={() => { const end = (document.getElementById(`bundle-end-${value(bundle, "id")}`) as HTMLInputElement).value; return run(() => api.updateBundle(value(bundle, "id"), { name: (document.getElementById(`bundle-name-${value(bundle, "id")}`) as HTMLInputElement).value, unitAmount: (document.getElementById(`bundle-amount-${value(bundle, "id")}`) as HTMLInputElement).value, ...(end ? { effectiveTo: end } : {}), reason })); }} /></div></details>) : null}
        {Object.entries(bundleComponents).map(([id, selected]) => <div className="bc-card" key={id}><h4>Bundle components</h4>{serviceOptions.map((service) => <label key={service.id} style={{ display: "block", margin: "7px 0" }}><input type="checkbox" checked={selected.includes(service.id)} onChange={(event) => setBundleComponents((current) => ({ ...current, [id]: event.target.checked ? [...(current[id] || []), service.id] : (current[id] || []).filter((value) => value !== service.id) }))} /> {service.serviceName} ({service.serviceCode})</label>)}<Reason value={reason} onChange={setReason} /><ActionButton label="Save components" disabled={!reason.trim()} onAction={() => run(() => api.setBundleComponents(id, (bundleComponents[id] || []).map((clientServiceId) => ({ clientServiceId })), reason))} /></div>)}
      </>}
      <h3 className="bc-h" style={{ marginTop: 20 }}>Rate cards <small>{cards.length} loaded</small></h3>
      <div className="panel scroll"><table><thead><tr><th>Name</th><th>Effective</th><th>Status</th><th>Entries</th><th>Manage</th></tr></thead><tbody>{cards.map((card) => <tr key={value(card, "id")}><td><button type="button" style={{ ...buttonStyle, border: 0, padding: 0 }} onClick={() => setRateCardId(value(card, "id"))}>{value(card, "name")}</button></td><td>{value(card, "effectiveFrom")} – {value(card, "effectiveTo", "open")}</td><td>{value(card, "active") === "true" ? "Active" : "Inactive"}</td><td>{rateCardId === value(card, "id") ? entries.length : "Open card"}</td><td>{canManage ? <ActionButton label={value(card, "active") === "true" ? "Deactivate" : "Activate"} quiet onAction={() => run(() => api.updateRateCard(value(card, "id"), { active: value(card, "active") !== "true", reason }))} /> : "View only"}</td></tr>)}</tbody></table></div>
      {nextCursor ? <button type="button" style={buttonStyle} onClick={() => setCursor(nextCursor)}>Load next rate-card page</button> : null}
      {rateCardId ? <div className="bc-card" style={{ marginTop: 12 }}><h3 className="bc-h">Rate entries</h3>{entries.map((entry) => <div key={value(entry, "id")} style={{ display: "flex", gap: 12, flexWrap: "wrap", padding: 8, borderBottom: "1px solid var(--line)" }}><span>{value(entry, "serviceCode")} / {value(entry, "unit")}: {value(entry, "unitAmount")} · {value(entry, "effectiveFrom")} – {value(entry, "effectiveTo", "open")}</span>{canManage ? <ActionButton label="End today" quiet onAction={() => run(() => api.updateRateEntry(rateCardId, value(entry, "id"), { effectiveTo: firmToday(), reason }))} /> : null}</div>)}{canManage ? <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}><input id="billing-entry-code" style={inputStyle} placeholder="Service code" /><input id="billing-entry-unit" style={inputStyle} placeholder="Unit" /><input id="billing-entry-amount" style={inputStyle} placeholder="Unit amount" /><input id="billing-entry-from" style={inputStyle} type="date" /><Reason value={reason} onChange={setReason} /><ActionButton label="Add rate entry" disabled={!reason.trim()} onAction={() => { const el = (id: string) => document.getElementById(id) as HTMLInputElement; return run(() => api.createRateEntry(rateCardId, { serviceCode: el("billing-entry-code").value, unit: el("billing-entry-unit").value, unitAmount: el("billing-entry-amount").value, effectiveFrom: el("billing-entry-from").value, reason })); }} /></div> : null}</div> : null}
      {canManage ? <div className="bc-card" style={{ marginTop: 12 }}><h3 className="bc-h">Create rate card</h3><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><input id="billing-rate-card-name" style={inputStyle} placeholder="Rate-card name" /><input id="billing-rate-card-from" style={inputStyle} type="date" /><Reason value={reason} onChange={setReason} /><ActionButton label="Create rate card" disabled={!reason.trim()} onAction={() => { const name = (document.getElementById("billing-rate-card-name") as HTMLInputElement).value; const effectiveFrom = (document.getElementById("billing-rate-card-from") as HTMLInputElement).value; return run(() => api.createRateCard({ name, effectiveFrom, reason })); }} /></div></div> : null}
      {canManage && clientId ? <div className="bc-card" style={{ marginTop: 12 }}><h3 className="bc-h">Create client bundle</h3><p style={hintStyle}>A bundle is billed as one package amount; its components are provenance, not separate charges.</p><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><input id="billing-bundle-name" style={inputStyle} placeholder="Bundle name" /><input id="billing-bundle-amount" style={inputStyle} inputMode="decimal" placeholder="Package amount" /><input id="billing-bundle-from" style={inputStyle} type="date" /><Reason value={reason} onChange={setReason} /><ActionButton label="Create bundle" disabled={!reason.trim()} onAction={() => { const el = (id: string) => document.getElementById(id) as HTMLInputElement; return run(() => api.createBundle({ name: el("billing-bundle-name").value, clientId, unitAmount: el("billing-bundle-amount").value, effectiveFrom: el("billing-bundle-from").value, reason })); }} /></div></div> : null}
      {error ? <p role="alert" style={{ color: "var(--red)" }}>{error}</p> : null}
    </div>
  </section>;
}

export function BillingSettingsWorkbench({ api, clientId, clients, actions, viewerRole }: { api: BillingApi; clientId: string | null; clients: ClientOption[]; actions: string[]; viewerRole: string }) {
  const [terms, setTerms] = useState<Row | null>(null);
  const [remittance, setRemittance] = useState({ payeeName: "", address: "", instructions: "" });
  const [policy, setPolicy] = useState<Array<{ actionKey: string; allowedRoles: string[]; enabled: boolean }>>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [maps, setMaps] = useState<Row[]>([]);
  const [overrides, setOverrides] = useState<Row[]>([]);
  const [status, setStatus] = useState("");
  const [reason, setReason] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [manualConfirmationKey, setManualConfirmationKey] = useState("");
  const mayViewSettings = actions.includes("billing.view");
  const mayEditTerms = actions.includes("settings.terms.manage");
  const mayEditRemittance = actions.includes("settings.remittance.manage");
  const mayManageCandidates = actions.includes("candidates.manage");
  const ownerAdmin = ["owner", "admin", "owner/admin"].includes(viewerRole.toLowerCase());
  useEffect(() => {
    let cancelled = false;
    const jobs: Array<Promise<unknown>> = [];
    if (mayViewSettings) jobs.push(api.terms().then((r) => { if (cancelled) return; if (r.ok === true) { setTerms(r.data as unknown as Row); setOverrides(r.data.overrides || []); } else setStatus(failureMessage(r)); }));
    if (mayViewSettings) jobs.push(api.remittance().then((r) => { if (cancelled) return; if (r.ok === true) setRemittance({ payeeName: r.data.remittance.payeeName || "", address: r.data.remittance.address || "", instructions: r.data.remittance.instructions || "" }); else setStatus(failureMessage(r)); }));
    if (ownerAdmin) jobs.push(api.permissionsPolicy().then((r) => { if (cancelled) return; if (r.ok === true) setPolicy(r.data.policies); else setStatus(failureMessage(r)); }));
    if (clientId && (actions.includes("candidates.view") || actions.includes("pricing.view"))) jobs.push(Promise.all([api.clientServices(clientId), api.completionMaps()]).then(([s, m]) => { if (cancelled) return; if (s.ok === true) setServices(s.data.items); else setStatus(failureMessage(s)); if (m.ok === true) setMaps(m.data.items.filter((map) => s.ok === true && s.data.items.some((service) => service.id === value(map, "clientServiceId")))); else setStatus(failureMessage(m)); }));
    return () => { cancelled = true; };
  }, [api, clientId, actions, mayViewSettings, mayEditTerms, mayEditRemittance, mayManageCandidates, ownerAdmin, refresh]);
  async function run(action: () => Promise<ApiResult<unknown>>) {
    if (!reason.trim()) return { ok: false as const, status: 422, kind: "invalid" as const, message: "Enter an audit reason first." };
    const result = await action();
    setStatus(result.ok === true ? "Saved." : failureMessage(result));
    if (result.ok === true) { setReason(""); setRefresh((n) => n + 1); }
    return result;
  }
  return <section className="bc-stack" aria-label="Billing settings and completion rules">
    <div className="bc-card"><h2 className="bc-sect">Settings</h2><p className="bc-hint">Changes are audited. Issued invoices keep their saved terms and remittance snapshot; later settings changes only affect future invoices.</p>{status ? <p role="status" style={hintStyle}>{status}</p> : null}
      {terms && mayViewSettings ? <div className="bc-card"><h3 className="bc-h">Firm payment terms</h3><p style={hintStyle}>Service-level override → client override → firm default. Due dates are calculated by the server when an invoice is issued.</p><div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}><label style={{ display: "grid", gap: 4 }}>Default net days<input id="billing-net-days" type="number" min="0" max="365" style={inputStyle} defaultValue={value(terms, "defaultNetDays", "15")} readOnly={!mayEditTerms} /></label><label style={{ display: "grid", gap: 4 }}>Billing day<input style={inputStyle} value="Service period end" readOnly /></label>{mayEditTerms ? <><Reason value={reason} onChange={setReason} /><ActionButton label="Save firm terms" disabled={!reason.trim()} onAction={() => run(() => api.updateTerms({ defaultNetDays: Number((document.getElementById("billing-net-days") as HTMLInputElement).value), billingDay: "service_period_end", reason }))} /></> : <Message>Read only. Editing requires settings.terms.manage.</Message>}</div>
        <h4>Terms overrides</h4><div className="panel scroll"><table><thead><tr><th>Client / service</th><th>Net days</th><th>Effective from</th><th>Effective to</th><th>Update</th></tr></thead><tbody>{overrides.map((item) => <tr key={value(item, "id")}><td>{clients.find((client) => client.id === value(item, "clientId"))?.name || value(item, "clientId")}{value(item, "clientServiceId") ? ` / ${services.find((service) => service.id === value(item, "clientServiceId"))?.serviceName || value(item, "clientServiceId")}` : ""}</td><td>{value(item, "netDays")}</td><td>{value(item, "effectiveFrom")}</td><td>{value(item, "effectiveTo", "Open")}</td><td>{mayEditTerms ? <details><summary style={{ cursor: "pointer" }}>Edit</summary><div style={{ display: "grid", gap: 6, minWidth: 180 }}><input id={`term-days-${value(item, "id")}`} type="number" min="0" max="365" style={inputStyle} defaultValue={value(item, "netDays")} aria-label="Override net days" /><input id={`term-end-${value(item, "id")}`} type="date" style={inputStyle} defaultValue={value(item, "effectiveTo")} aria-label="Override end date" /><Reason value={reason} onChange={setReason} /><ActionButton label="Save override" disabled={!reason.trim()} onAction={() => { const end = (document.getElementById(`term-end-${value(item, "id")}`) as HTMLInputElement).value; return run(() => api.updateTermsOverride(value(item, "id"), { netDays: Number((document.getElementById(`term-days-${value(item, "id")}`) as HTMLInputElement).value), ...(end ? { effectiveTo: end } : {}), reason })); }} /></div></details> : "Read only"}</td></tr>)}</tbody></table></div>
        {clientId && mayEditTerms ? <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}><label style={{ display: "grid", gap: 4 }}>Net days<input id="billing-override-days" type="number" min="0" max="365" style={inputStyle} /></label><label style={{ display: "grid", gap: 4 }}>Optional service<select id="billing-override-service" style={inputStyle}><option value="">Client-wide</option>{services.map((service) => <option key={service.id} value={service.id}>{service.serviceName}</option>)}</select></label><label style={{ display: "grid", gap: 4 }}>Effective from<input id="billing-override-from" type="date" style={inputStyle} /></label><Reason value={reason} onChange={setReason} /><ActionButton label="Add terms override" disabled={!reason.trim()} onAction={() => run(() => api.createTermsOverride({ clientId, clientServiceId: (document.getElementById("billing-override-service") as HTMLSelectElement).value || null, netDays: Number((document.getElementById("billing-override-days") as HTMLInputElement).value), effectiveFrom: (document.getElementById("billing-override-from") as HTMLInputElement).value, reason }))} /></div> : clientId ? <Message>Adding terms overrides requires settings.terms.manage.</Message> : <Message>Choose a client to add a client-specific or service-specific terms override.</Message>}
      </div> : <Message>Firm terms are available to Billing users with billing.view.</Message>}
      {mayViewSettings ? <div className="bc-card" style={{ marginTop: 14 }}><h3 className="bc-h">Invoice remittance instructions</h3><p style={hintStyle}>These are printed on future invoices. Do not enter bank login credentials or payment-processing secrets.</p><div style={{ display: "grid", gap: 8 }}><label>Payee<input style={inputStyle} value={remittance.payeeName} readOnly={!mayEditRemittance} onChange={(e) => setRemittance((v) => ({ ...v, payeeName: e.target.value }))} /></label><label>Mailing address<textarea style={inputStyle} value={remittance.address} readOnly={!mayEditRemittance} onChange={(e) => setRemittance((v) => ({ ...v, address: e.target.value }))} /></label><label>Payment instructions<textarea style={inputStyle} value={remittance.instructions} readOnly={!mayEditRemittance} onChange={(e) => setRemittance((v) => ({ ...v, instructions: e.target.value }))} /></label>{mayEditRemittance ? <><Reason value={reason} onChange={setReason} /><ActionButton label="Save remittance" disabled={!reason.trim()} onAction={() => run(() => api.updateRemittance({ ...remittance, reason }))} /></> : <Message>Read only. Editing requires settings.remittance.manage.</Message>}</div></div> : <Message>Settings are available to Billing users with billing.view.</Message>}
      {ownerAdmin ? <div className="bc-card" style={{ marginTop: 14 }}><h3 className="bc-h">Delegated Billing permissions</h3><p style={hintStyle}>Owner/Admin-only policy management, invoice voiding, and payment reversals are fixed and cannot be delegated.</p>{policy.map((item, index) => <div key={item.actionKey} style={{ display: "grid", gridTemplateColumns: "minmax(180px,1fr) auto minmax(260px,2fr)", gap: 10, alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--line)" }}><code>{item.actionKey}</code><label><input type="checkbox" checked={item.enabled} onChange={(e) => setPolicy((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, enabled: e.target.checked } : row))} /> Enabled</label><div>{["manager", "staff", "offshore"].map((role) => <label key={role} style={{ marginRight: 12 }}><input type="checkbox" checked={item.allowedRoles.includes(role)} disabled={!item.enabled} onChange={(e) => setPolicy((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, allowedRoles: e.target.checked ? [...row.allowedRoles, role] : row.allowedRoles.filter((value) => value !== role) } : row))} /> {role}</label>)}</div></div>)}<Reason value={reason} onChange={setReason} /><ActionButton label="Save permission policy" disabled={!reason.trim() || !policy.length} onAction={() => run(() => api.updatePermissionsPolicy(policy, reason))} /></div> : <Message>Policy editing is restricted to Owner/Admin.</Message>}
    </div>
    <div className="bc-card"><h3 className="bc-h">Completion-source maps</h3><p style={hintStyle}>Maps apply only to future, not-yet-generated occurrences. Existing candidates and invoices are unchanged.</p>{!clientId ? <Message>Choose a client to configure completion rules.</Message> : <>
      <label style={{ display: "grid", gap: 4, maxWidth: 440 }}>Client service<select id="billing-map-service" style={inputStyle}><option value="">Select service</option>{services.map((service) => <option key={service.id} value={service.id}>{service.serviceName} · {service.serviceCode}</option>)}</select></label>
      <div className="panel scroll"><table><thead><tr><th>Service</th><th>Adapter</th><th>Effective from</th><th>Through</th><th>State</th><th>Action</th></tr></thead><tbody>{maps.map((map) => <tr key={value(map, "id")}><td>{services.find((service) => service.id === value(map, "clientServiceId"))?.serviceName || value(map, "clientServiceId")}</td><td>{value(map, "adapter")}</td><td>{value(map, "effectiveFrom")}</td><td>{value(map, "effectiveTo", "Open")}</td><td>{value(map, "enabled") === "true" ? "Enabled" : "Disabled"}</td><td>{mayManageCandidates ? <ActionButton label={value(map, "enabled") === "true" ? "Disable" : "Enable"} quiet onAction={() => run(() => api.updateCompletionMap(value(map, "id"), { enabled: value(map, "enabled") !== "true", reason }))} /> : "View only"}</td></tr>)}</tbody></table></div>
      {mayManageCandidates ? <div className="bc-card" style={{ marginTop: 12 }}><h4>Create completion-source map</h4><p style={hintStyle}>Supported combinations are intentionally bounded: schedule uses period_end; work_period_done uses stage=done with period_end or completion_date; period_count_threshold uses a positive threshold with period_end; manual_confirmation uses confirmed_date.</p><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><select id="billing-map-adapter" style={inputStyle}><option value="schedule">schedule</option><option value="work_period_done">work_period_done</option><option value="period_count_threshold">period_count_threshold</option><option value="manual_confirmation">manual_confirmation</option></select><select id="billing-map-date-rule" style={inputStyle}><option value="period_end">period_end</option><option value="completion_date">completion_date</option><option value="confirmed_date">confirmed_date</option></select><input id="billing-map-threshold" type="number" min="1" style={inputStyle} placeholder="Threshold (if needed)" /><input id="billing-map-from" type="date" style={inputStyle} /><Reason value={reason} onChange={setReason} /><ActionButton label="Create map" disabled={!reason.trim()} onAction={() => { const adapter = (document.getElementById("billing-map-adapter") as HTMLSelectElement).value; const rule = (document.getElementById("billing-map-date-rule") as HTMLSelectElement).value; const threshold = Number((document.getElementById("billing-map-threshold") as HTMLInputElement).value); const identityFields = adapter === "manual_confirmation" ? ["confirmation_id"] : ["client_service_id", "period"]; const predicate = adapter === "work_period_done" ? { stage: "done" } : adapter === "period_count_threshold" ? { threshold } : {}; return run(() => api.createCompletionMap({ clientServiceId: (document.getElementById("billing-map-service") as HTMLSelectElement).value, adapter, candidateDateRule: rule, identityFields, predicate, effectiveFrom: (document.getElementById("billing-map-from") as HTMLInputElement).value, reason })); }} /></div></div> : <Message>Completion map changes require candidates.manage.</Message>}
      {mayManageCandidates ? <div className="bc-card" style={{ marginTop: 12 }}><h4>Manual completion confirmation</h4><p style={hintStyle}>Creates an audited candidate for a confirmed service date. A retry after a timeout reuses the same idempotency key.</p><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><input id="billing-confirm-date" type="date" style={inputStyle} /><input id="billing-confirm-note" style={inputStyle} placeholder="Source note" /><Reason value={reason} onChange={setReason} /><ActionButton label="Confirm completion" disabled={!reason.trim()} onAction={async () => { const idempotencyKey = manualConfirmationKey || crypto.randomUUID(); setManualConfirmationKey(idempotencyKey); const result = await run(() => api.manualConfirmation({ idempotencyKey, clientServiceId: (document.getElementById("billing-map-service") as HTMLSelectElement).value, confirmedDate: (document.getElementById("billing-confirm-date") as HTMLInputElement).value, sourceNote: (document.getElementById("billing-confirm-note") as HTMLInputElement).value, reason })); if (result.ok === true) setManualConfirmationKey(""); return result; }} /></div></div> : null}
    </>}</div>
  </section>;
}
