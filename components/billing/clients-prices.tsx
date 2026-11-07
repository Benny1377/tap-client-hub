"use client";

import { useEffect, useMemo, useState } from "react";
import type { ApiResult, BillingApi } from "@/lib/billing-ui/api";
import type { BillingBundle, BillingCandidate, ClientBillingSummary, ClientOption, Invoice, Receivable } from "@/lib/billing-ui/types";
import { formatMoney } from "@/lib/billing-ui/view-model";
import { clientRows, firmToday, monthlyNote, nextRunDates, pricedHow, required, runRows, shortDate, type PriceOverride, type ProjectedItem } from "@/lib/billing-ui/workbench";
import { ReasonAction } from "./candidate-panels";
import { ErrorBanner, LedgerForm, StatusBadge, type FormValues } from "./ui";
import { BillingChain, PricedChip } from "./what-next";

type Service = { id: string; active: boolean; frequency: string | null; serviceCode: string | null; serviceName: string | null };
type Failure = { kind: "unauthorized" | "forbidden" | "not_found" | "conflict" | "invalid" | "server" | "network"; message: string; code?: string };

const asFailure = (result: ApiResult<unknown>): Failure | null => (result.ok === false ? result : null);
export function ClientsPrices({ api, active, clients, receivables, canView, version, onOpen, onGo }: {
  api: BillingApi;
  active: boolean;
  clients: ClientOption[];
  receivables: Receivable[];
  canView: boolean;
  version: number;
  onOpen: (id: string) => void;
  onGo: (tab: string) => void;
}) {
  const [open, setOpen] = useState<BillingCandidate[]>([]);
  const [unpriced, setUnpriced] = useState<BillingCandidate[]>([]);
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!canView || !active) return;
    let current = true;
    Promise.all([api.candidates({ state: "open", limit: 100 }), api.candidates({ state: "unpriced", limit: 100 })]).then(([a, b]) => {
      if (!current) return;
      if (a.ok) setOpen(a.data.items);
      if (b.ok) setUnpriced(b.data.items);
    });
    return () => { current = false; };
  }, [active, api, canView, version]);

  const rows = useMemo(() => clientRows(clients, receivables, open, unpriced), [clients, receivables, open, unpriced]);
  const needle = query.trim().toLowerCase();
  const visible = needle ? rows.filter((row) => row.name.toLowerCase().includes(needle)) : rows;
  const owing = rows.filter((row) => row.openInvoices > 0).length;
  const pastDue = rows.filter((row) => row.daysPastDue > 0).length;

  if (!canView) return <div><BillingChain now="pricing" onGo={onGo} /><div className="card"><h3>Clients &amp; prices</h3><p style={{ fontSize: 13, color: "var(--muted)" }}>Price details are restricted to Owner/Admin and authorized Billing users.</p></div></div>;
  return (
    <div data-clients-prices>
      <BillingChain now="pricing" onGo={onGo} />
      <div className="note brand"><span className="ni">→</span><div><b>One client list, and the price sits on it.</b> Names and services come from <b>Operations</b>. What is Billing&apos;s own is the <b>price</b>: the rate card is a starting point, a client can have their own price, and a package is one fee for several services.</div></div>
      <div className="g4" style={{ marginBottom: 14 }}>
        <div className="stat"><div className="k">Clients</div><div className="v num">{rows.length}</div><div className="d">from Operations</div></div>
        <div className="stat"><div className="k">Ready to bill</div><div className="v num" style={{ color: open.length ? "var(--amber)" : undefined }}>{open.length}</div><div className="d">candidates, not invoiced</div></div>
        <div className="stat"><div className="k">No price</div><div className="v num" style={{ color: unpriced.length ? "var(--red)" : "var(--green)" }}>{unpriced.length}</div><div className="d">{unpriced.length ? "can't be drafted until priced" : "every candidate has a price"}</div></div>
        <div className="stat"><div className="k">Owing · past due</div><div className="v num">{owing} · {pastDue}</div><div className="d">clients with open invoices</div></div>
      </div>
      <div className="controls"><input className="inp" style={{ maxWidth: 320 }} placeholder="Search clients" aria-label="Search clients" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
      <div className="panel scroll">
        <table data-client-table>
          <thead><tr><th>Client</th><th className="r">Ready to bill</th><th className="r">No price</th><th className="r">Open invoices</th><th className="r">Past due</th></tr></thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.id} data-client-row={row.id} style={{ cursor: "pointer" }} onClick={() => onOpen(row.id)}>
                <td><button type="button" className="rowname" style={{ background: "none", border: 0, padding: 0, font: "inherit", color: "inherit", textAlign: "left" }} onClick={(event) => { event.stopPropagation(); onOpen(row.id); }}>{row.name}</button></td>
                <td className="r num" style={{ color: row.ready ? "var(--amber)" : "var(--faint)" }}>{row.ready || "—"}</td>
                <td className="r num" style={{ color: row.noPrice ? "var(--red)" : "var(--faint)" }}>{row.noPrice || "—"}</td>
                <td className="r num">{row.openInvoices || "—"}</td>
                <td className="r num">{row.daysPastDue ? `${row.daysPastDue}d` : "—"}</td>
              </tr>
            ))}
            {visible.length === 0 ? <tr><td colSpan={5} style={{ color: "var(--muted)" }}>No clients match.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <p className="fine">Open a client to see their services, prices and packages. Ready and No price count the first 100 candidates of each.</p>
    </div>
  );
}

export function ClientPage({ api, client, invoices, receivables, canManage, onBack, onOpenInvoice, onChanged }: {
  api: BillingApi;
  client: ClientOption;
  invoices: Invoice[];
  receivables: Receivable[];
  canManage: boolean;
  onBack: () => void;
  onOpenInvoice: (id: string) => void;
  onChanged: () => void;
}) {
  const [services, setServices] = useState<Service[]>([]);
  const [overrides, setOverrides] = useState<PriceOverride[]>([]);
  const [bundles, setBundles] = useState<BillingBundle[]>([]);
  const [projected, setProjected] = useState<ProjectedItem[]>([]);
  const [summary, setSummary] = useState<ClientBillingSummary | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [refresh, setRefresh] = useState(0);
  const today = firmToday();
  const runs = useMemo(() => nextRunDates(today), [today]);

  useEffect(() => {
    let current = true;
    Promise.all([api.clientServices(client.id), api.clientPricing(client.id), api.schedule({ from: `${today.slice(0, 7)}-01`, to: runs[runs.length - 1], clientId: client.id }), api.clientSummary(client.id)]).then(([s, p, sched, sum]) => {
      if (!current) return;
      if (s.ok) setServices(s.data.items); else setFailure(asFailure(s));
      if (p.ok) { setOverrides(p.data.overrides as unknown as PriceOverride[]); setBundles(p.data.bundles || []); } else setFailure(asFailure(p));
      if (sched.ok) setProjected(sched.data.items as unknown as ProjectedItem[]);
      // The summary also needs candidates.view. Without it the rest of the page still works, so a 403 hides the row.
      if (sum.ok) setSummary(sum.data); else if (sum.ok === false && sum.kind !== "forbidden") setFailure(asFailure(sum));
    });
    return () => { current = false; };
  }, [api, client.id, refresh, runs, today]);

  const done = async <T,>(work: () => Promise<ApiResult<T>>) => {
    const result = await work();
    if (result.ok) { setRefresh((value) => value + 1); onChanged(); }
    return result;
  };
  const active = services.filter((service) => service.active);
  const serviceName = (id: string) => services.find((service) => service.id === id)?.serviceName || "Service";
  const options = active.map((service) => ({ value: service.id, label: `${service.serviceName} · ${service.serviceCode}` }));
  const owed = receivables.filter((row) => row.client_id === client.id && Number(row.balance) > 0);
  const daysPast = owed.reduce((most, row) => Math.max(most, row.days_past_due), 0);
  const theirInvoices = invoices.filter((invoice) => invoice.client_id === client.id);
  const nextRows = runRows(projected, runs, bundles);

  return (
    <div data-client-page={client.id}>
      <button type="button" className="bk" onClick={onBack}>← back</button>
      <div className="phead" style={{ marginBottom: 12 }}><div><h2 style={{ fontSize: 24 }}>{client.name}</h2><p className="psub">Services come from Operations. Prices live here.</p></div></div>
      {failure ? <ErrorBanner kind={failure.kind} message={failure.message} code={failure.code} /> : null}
      <div className="g4" style={{ marginBottom: 16 }}>
        <div className="stat"><div className="k">Services</div><div className="v num">{active.length}</div><div className="d">active in Operations</div></div>
        <div className="stat"><div className="k">Own prices</div><div className="v num">{overrides.length}</div><div className="d">off the rate card</div></div>
        <div className="stat"><div className="k">Packages</div><div className="v num">{bundles.length}</div><div className="d">one fee for several services</div></div>
        <div className="stat"><div className="k">Open invoices</div><div className="v num" style={{ color: owed.length ? "var(--red)" : undefined }}>{owed.length}</div><div className="d">{daysPast ? `${daysPast} days past due` : "nothing past due"}</div></div>
      </div>

      {summary ? (
        <div className="g4" style={{ marginBottom: 16 }} data-client-summary>
          <div className="stat"><div className="k">Per month</div><div className="v num">{formatMoney(summary.monthlyAmount)}</div><div className="d" data-monthly-note style={summary.monthlyAmountComplete ? undefined : { color: "var(--amber)" }}>{monthlyNote(summary.monthlyAmountComplete, summary.unpricedServiceCount)}</div></div>
          <div className="stat"><div className="k">Next invoice</div><div className="v num">{summary.nextInvoiceDate ? shortDate(summary.nextInvoiceDate) : "—"}</div><div className="d">{summary.nextInvoiceDate ? summary.nextInvoiceDate.slice(0, 4) : "nothing scheduled"}</div></div>
          <div className="stat"><div className="k">Open balance</div><div className="v num">{formatMoney(summary.openBalance)}</div><div className="d">issued, still owed</div></div>
          <div className="stat"><div className="k">Past due</div><div className="v num" style={{ color: Number(summary.pastDueAmount) > 0 ? "var(--red)" : undefined }}>{formatMoney(summary.pastDueAmount)}</div><div className="d">{daysPast ? `oldest ${daysPast} days` : "nothing past due"}</div></div>
        </div>
      ) : null}

      <div className="card" style={{ marginBottom: 16 }} data-client-services>
        <h3>Services from Operations<span>what they buy</span></h3>
        <div className="svcpick">
          {services.map((service) => {
            const priced = summary?.services.find((item) => item.clientServiceId === service.id);
            return (
            <div key={service.id} data-service-row={service.id} style={service.active ? undefined : { opacity: 0.5 }}>
              <span>{service.serviceName || "Service"}</span>
              {service.frequency ? <span className="sub">{service.frequency}</span> : null}
              {/* Each of a package's services carries the whole package price, so the package is named instead. */}
              {priced && service.active ? <span className="sub num" data-service-price>{priced.bundleName ? priced.bundleName : priced.unitAmount === null ? "No price" : formatMoney(priced.unitAmount)}</span> : null}
              {service.active ? <PricedChip how={pricedHow(service.id, today, overrides, bundles)} /> : <span className="sub">off</span>}
            </div>
            );
          })}
          {services.length === 0 ? <p style={{ fontSize: 13, color: "var(--muted)" }}>No services on this client.</p> : null}
        </div>
        <p className="fine" style={{ border: "none", marginTop: 10, paddingTop: 0 }}>A package comes first, then the client&apos;s own price, then the rate card. Changing a price never rewrites existing candidates, drafts or invoices.</p>
      </div>

      <div className="card" style={{ marginBottom: 16 }} data-client-overrides>
        <h3>Their own prices<span>{overrides.length}</span></h3>
        {overrides.length ? (
          <div className="scroll"><table>
            <thead><tr><th>Service</th><th className="r">Price</th><th>From</th><th>To</th>{canManage ? <th /> : null}</tr></thead>
            <tbody>{overrides.map((item) => (
              <tr key={item.id}><td><b>{serviceName(item.clientServiceId)}</b></td><td className="r num">{formatMoney(item.unitAmount)}</td><td>{item.effectiveFrom}</td><td>{item.effectiveTo || "Open"}</td>
                {canManage ? <td><ReasonAction label="End today" submitLabel="End this price" onSubmit={(reason) => done(() => api.updatePriceOverride(item.id, { effectiveTo: today, reason }))} /></td> : null}</tr>
            ))}</tbody>
          </table></div>
        ) : <p style={{ fontSize: 13, color: "var(--muted)" }}>This client follows the rate card.</p>}
        {canManage ? (
          <details style={{ marginTop: 12 }} data-form="override"><summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Set their own price</summary>
            <LedgerForm
              fields={[{ name: "clientServiceId", label: "Service", type: "select", options }, { name: "unitAmount", label: "Unit amount (USD)", placeholder: "0.00" }, { name: "effectiveFrom", label: "Effective from", type: "date" }, { name: "reason", label: "Reason", type: "textarea" }]}
              initialValues={{ clientServiceId: "", unitAmount: "", effectiveFrom: "", reason: "" }}
              validate={required("clientServiceId", "unitAmount", "effectiveFrom", "reason")}
              onSubmit={(values: FormValues) => done(() => api.createPriceOverride({ clientServiceId: values.clientServiceId, unitAmount: values.unitAmount.trim(), effectiveFrom: values.effectiveFrom, reason: values.reason.trim() }))}
              submitLabel="Save price"
            />
          </details>
        ) : null}
      </div>

      <div className="card" style={{ marginBottom: 16 }} data-client-bundles>
        <h3>Packages<span>one fee, several services</span></h3>
        {bundles.map((bundle) => (
          <div key={bundle.id} data-bundle-row={bundle.id} style={{ padding: "11px 0", borderTop: "1px solid var(--line2)" }}>
            <div style={{ display: "flex", gap: 12, justifyContent: "space-between", flexWrap: "wrap" }}>
              <span><b>{bundle.name}</b><div className="sub">{bundle.components.map((item) => serviceName(item.clientServiceId)).join(" · ") || "No services yet"}</div><div className="sub">{bundle.effectiveFrom} to {bundle.effectiveTo || "open"}{bundle.active === false ? " · inactive" : ""}</div></span>
              <b className="num">{formatMoney(bundle.unitAmount)}</b>
            </div>
            {canManage ? (
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 8 }}>
                <details data-form={`bundle-terms-${bundle.id}`}><summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>Edit package</summary>
                  <LedgerForm
                    key={`${bundle.name}-${bundle.unitAmount}-${bundle.effectiveTo ?? ""}`}
                    resetOnSuccess={false}
                    fields={[{ name: "name", label: "Name" }, { name: "unitAmount", label: "Package price (USD)" }, { name: "effectiveTo", label: "Ends", type: "date", optional: true }, { name: "reason", label: "Reason", type: "textarea" }]}
                    initialValues={{ name: bundle.name, unitAmount: String(bundle.unitAmount ?? ""), effectiveTo: bundle.effectiveTo || "", reason: "" }}
                    validate={required("name", "unitAmount", "reason")}
                    onSubmit={(values: FormValues) => done(() => api.updateBundle(bundle.id, { name: values.name.trim(), unitAmount: values.unitAmount.trim(), ...(values.effectiveTo ? { effectiveTo: values.effectiveTo } : {}), reason: values.reason.trim() }))}
                    submitLabel="Save package"
                  />
                </details>
                <BundleComponents bundle={bundle} services={active} onSave={(ids, reason) => done(() => api.setBundleComponents(bundle.id, ids.map((clientServiceId) => ({ clientServiceId })), reason))} />
              </div>
            ) : null}
          </div>
        ))}
        {bundles.length === 0 ? <p style={{ fontSize: 13, color: "var(--muted)" }}>No packages on this client.</p> : null}
        {canManage ? (
          <details style={{ marginTop: 12 }} data-form="bundle"><summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Create a package</summary>
            <LedgerForm
              fields={[{ name: "name", label: "Name" }, { name: "unitAmount", label: "Package price (USD)", placeholder: "0.00" }, { name: "effectiveFrom", label: "Effective from", type: "date" }, { name: "reason", label: "Reason", type: "textarea" }]}
              initialValues={{ name: "", unitAmount: "", effectiveFrom: "", reason: "" }}
              validate={required("name", "unitAmount", "effectiveFrom", "reason")}
              onSubmit={(values: FormValues) => done(() => api.createBundle({ name: values.name.trim(), clientId: client.id, unitAmount: values.unitAmount.trim(), effectiveFrom: values.effectiveFrom, reason: values.reason.trim() }))}
              submitLabel="Create package"
            />
          </details>
        ) : null}
      </div>

      <div className="g2">
        <div className="card" data-client-next>
          <h3>Next invoices<span>projected</span></h3>
          {nextRows.length ? runs.map((date) => {
            const lines = nextRows.filter((row) => row.cells[date]);
            return lines.length ? <div key={date} className="legrow"><span>{shortDate(date)}</span><b className="num">{lines.length} {lines.length === 1 ? "service" : "services"}</b></div> : null;
          }) : <p style={{ fontSize: 13, color: "var(--muted)" }}>Nothing on the calendar that isn&apos;t already a candidate.</p>}
        </div>
        <div className="card" data-client-invoices>
          <h3>Their invoices<span>{theirInvoices.length}</span></h3>
          <div className="scroll" style={{ maxHeight: 280, overflowY: "auto" }}>
            <table><tbody>
              {theirInvoices.map((invoice) => (
                <tr key={invoice.id} style={{ cursor: "pointer" }} onClick={() => onOpenInvoice(invoice.id)}>
                  <td className="mono"><button type="button" className="lnk" onClick={(event) => { event.stopPropagation(); onOpenInvoice(invoice.id); }}>{invoice.invoice_number ?? "Draft"}</button></td><td>{invoice.issue_date ?? "—"}</td><td><StatusBadge status={invoice.status} /></td>
                </tr>
              ))}
              {theirInvoices.length === 0 ? <tr><td className="sub">Nothing billed yet.</td></tr> : null}
            </tbody></table>
          </div>
        </div>
      </div>
    </div>
  );
}

function BundleComponents({ bundle, services, onSave }: { bundle: BillingBundle; services: Service[]; onSave: (ids: string[], reason: string) => Promise<ApiResult<unknown>> }) {
  const [selected, setSelected] = useState<string[]>(bundle.components.map((item) => item.clientServiceId));
  return (
    <details data-form={`bundle-components-${bundle.id}`}><summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>Choose services</summary>
      {services.map((service) => (
        <label key={service.id} className="check" style={{ display: "block", margin: "7px 0", fontSize: 13 }}>
          <input type="checkbox" checked={selected.includes(service.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, service.id] : current.filter((id) => id !== service.id))} /> {service.serviceName}
        </label>
      ))}
      <LedgerForm
        fields={[{ name: "reason", label: "Reason", type: "textarea" }]}
        initialValues={{ reason: "" }}
        validate={required("reason")}
        onSubmit={(values: FormValues) => onSave(selected, values.reason.trim())}
        submitLabel="Save services"
      />
    </details>
  );
}
