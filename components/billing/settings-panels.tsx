"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { ApiResult, BillingApi } from "@/lib/billing-ui/api";
import type { ClientOption } from "@/lib/billing-ui/types";
import { formatMoney } from "@/lib/billing-ui/view-model";
import { firmToday, required } from "@/lib/billing-ui/workbench";
import { ReasonAction } from "./candidate-panels";
import { ErrorBanner, LedgerForm, type FormValues } from "./ui";

type Row = Record<string, unknown>;
type Service = { id: string; active: boolean; frequency: string | null; serviceCode: string | null; serviceName: string | null };
type Policy = { actionKey: string; allowedRoles: string[]; enabled: boolean };
type Failure = { kind: "unauthorized" | "forbidden" | "not_found" | "conflict" | "invalid" | "server" | "network"; message: string; code?: string };
const asFailure = (result: ApiResult<unknown>): Failure | null => (result.ok === false ? result : null);
const text = (row: Row, key: string, fallback = "") => (row[key] == null ? fallback : String(row[key]));
const Muted = ({ children }: { children: ReactNode }) => <p style={{ fontSize: 13, color: "var(--muted)" }}>{children}</p>;

const SUB_TABS = [
  { id: "firm", label: "Firm & invoices" },
  { id: "pay", label: "Getting paid" },
  { id: "rates", label: "Rate card" },
  { id: "rules", label: "Completion rules" },
  { id: "access", label: "Permissions" },
] as const;
type SubTab = (typeof SUB_TABS)[number]["id"];

export function BillingSettings({ api, clientId, clients, actions }: { api: BillingApi; clientId: string | null; clients: ClientOption[]; actions: string[] }) {
  const [tab, setTab] = useState<SubTab>("firm");
  const tabs = SUB_TABS.filter((item) => item.id !== "access" || actions.includes("policy.manage"));
  return (
    <div data-billing-settings>
      <div className="subnav" style={{ borderBottom: "none", marginBottom: 12 }}>
        <div className="seg bseg" role="group" aria-label="Settings sections">
          {tabs.map((item) => <button key={item.id} type="button" className={tab === item.id ? "on" : undefined} aria-pressed={tab === item.id} onClick={() => setTab(item.id)}>{item.label}</button>)}
        </div>
      </div>
      {tab === "firm" ? <FirmTerms api={api} clientId={clientId} clients={clients} actions={actions} /> : null}
      {tab === "pay" ? <GettingPaid api={api} actions={actions} /> : null}
      {tab === "rates" ? <RateCards api={api} actions={actions} /> : null}
      {tab === "rules" ? <CompletionRules api={api} clientId={clientId} actions={actions} /> : null}
      {tab === "access" ? <PermissionPolicy api={api} /> : null}
      {!actions.includes("policy.manage") ? <p className="fine">Policy editing is restricted to Owner/Admin.</p> : null}
    </div>
  );
}

function FirmTerms({ api, clientId, clients, actions }: { api: BillingApi; clientId: string | null; clients: ClientOption[]; actions: string[] }) {
  const [terms, setTerms] = useState<Row | null>(null);
  const [overrides, setOverrides] = useState<Row[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [saved, setSaved] = useState(false);
  const mayEdit = actions.includes("settings.terms.manage");
  useEffect(() => {
    let current = true;
    api.terms().then((result) => { if (!current) return; if (result.ok) { setTerms(result.data); setOverrides(result.data.overrides || []); } else setFailure(asFailure(result)); });
    if (clientId) api.clientServices(clientId).then((result) => { if (current && result.ok) setServices(result.data.items); });
    return () => { current = false; };
  }, [api, clientId, refresh]);
  const done = async <T,>(work: () => Promise<ApiResult<T>>) => { const result = await work(); if (result.ok) { setSaved(true); setRefresh((value) => value + 1); } return result; };
  const nameOf = (item: Row) => `${clients.find((client) => client.id === text(item, "clientId"))?.name || "Client"}${text(item, "clientServiceId") ? ` · ${services.find((service) => service.id === text(item, "clientServiceId"))?.serviceName || "one service"}` : ""}`;
  return (
    <>
      {failure ? <ErrorBanner kind={failure.kind} message={failure.message} code={failure.code} /> : null}
      <div className="card" style={{ marginBottom: 14 }} data-form="terms">
        <h3>Invoice defaults<span>apply to future invoices</span></h3>
        {terms ? (
          <>
            <div className="fld"><label>Billing day</label><input value="Last day of the service period" disabled readOnly /><div className="sub">Issued invoices keep their saved terms; a later change only affects new invoices.</div></div>
            {mayEdit ? (
              <LedgerForm
                key={text(terms, "defaultNetDays")}
                resetOnSuccess={false}
                fields={[{ name: "defaultNetDays", label: "Default terms, net days" }, { name: "reason", label: "Reason", type: "textarea" }]}
                initialValues={{ defaultNetDays: text(terms, "defaultNetDays", "15"), reason: "" }}
                validate={required("defaultNetDays", "reason")}
                onSubmit={(values: FormValues) => done(() => api.updateTerms({ defaultNetDays: Number(values.defaultNetDays), billingDay: "service_period_end", reason: values.reason.trim() }))}
                submitLabel="Save firm terms"
              />
            ) : <div className="fld"><label>Default terms</label><input value={`Net ${text(terms, "defaultNetDays", "15")}`} disabled readOnly /></div>}
            {saved ? <p role="status" className="sub">Saved.</p> : null}
          </>
        ) : <Muted>Loading terms…</Muted>}
      </div>
      <div className="card" data-terms-overrides>
        <h3>Terms overrides<span>service, then client, then firm default</span></h3>
        {overrides.length ? (
          <div className="scroll"><table>
            <thead><tr><th>Client</th><th className="r">Net days</th><th>From</th><th>To</th>{mayEdit ? <th /> : null}</tr></thead>
            <tbody>{overrides.map((item) => (
              <tr key={text(item, "id")}><td><b>{nameOf(item)}</b></td><td className="r num">{text(item, "netDays")}</td><td>{text(item, "effectiveFrom")}</td><td>{text(item, "effectiveTo", "Open")}</td>
                {mayEdit ? <td><ReasonAction label="End today" submitLabel="End this override" onSubmit={(reason) => done(() => api.updateTermsOverride(text(item, "id"), { effectiveTo: firmToday(), reason }))} /></td> : null}</tr>
            ))}</tbody>
          </table></div>
        ) : <Muted>Every client is on the firm default.</Muted>}
        {mayEdit && clientId ? (
          <details style={{ marginTop: 12 }} data-form="terms-override"><summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Add an override for {clients.find((client) => client.id === clientId)?.name}</summary>
            <LedgerForm
              fields={[{ name: "netDays", label: "Net days" }, { name: "clientServiceId", label: "Service", type: "select", optional: true, options: services.map((service) => ({ value: service.id, label: service.serviceName || "Service" })) }, { name: "effectiveFrom", label: "Effective from", type: "date" }, { name: "reason", label: "Reason", type: "textarea" }]}
              initialValues={{ netDays: "", clientServiceId: "", effectiveFrom: "", reason: "" }}
              validate={required("netDays", "effectiveFrom", "reason")}
              onSubmit={(values: FormValues) => done(() => api.createTermsOverride({ clientId, clientServiceId: values.clientServiceId || null, netDays: Number(values.netDays), effectiveFrom: values.effectiveFrom, reason: values.reason.trim() }))}
              submitLabel="Add override"
            />
          </details>
        ) : mayEdit ? <p className="fine" style={{ border: "none", paddingTop: 0 }}>Choose a client above to add an override.</p> : null}
      </div>
    </>
  );
}

function GettingPaid({ api, actions }: { api: BillingApi; actions: string[] }) {
  const [values, setValues] = useState<{ payeeName: string; address: string; instructions: string } | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [saved, setSaved] = useState(false);
  const mayEdit = actions.includes("settings.remittance.manage");
  useEffect(() => {
    let current = true;
    api.remittance().then((result) => { if (!current) return; if (result.ok) setValues({ payeeName: result.data.remittance.payeeName || "", address: result.data.remittance.address || "", instructions: result.data.remittance.instructions || "" }); else setFailure(asFailure(result)); });
    return () => { current = false; };
  }, [api]);
  return (
    <div className="card" data-form="remittance">
      <h3>How a client pays you<span>printed on future invoices</span></h3>
      {failure ? <ErrorBanner kind={failure.kind} message={failure.message} code={failure.code} /> : null}
      {values ? (mayEdit ? (
        <>
          <LedgerForm
            key={`${values.payeeName}|${values.address}|${values.instructions}`}
            resetOnSuccess={false}
            fields={[{ name: "payeeName", label: "Payee" }, { name: "address", label: "Mailing address", type: "textarea" }, { name: "instructions", label: "Payment instructions", type: "textarea" }, { name: "reason", label: "Reason", type: "textarea" }]}
            initialValues={{ ...values, reason: "" }}
            validate={required("payeeName", "address", "instructions", "reason")}
            onSubmit={async (form: FormValues) => {
              // The server replaces all three fields, so all three always go.
              const result = await api.updateRemittance({ payeeName: form.payeeName.trim(), address: form.address.trim(), instructions: form.instructions.trim(), reason: form.reason.trim() });
              if (result.ok) { setSaved(true); setValues({ payeeName: form.payeeName.trim(), address: form.address.trim(), instructions: form.instructions.trim() }); }
              return result;
            }}
            submitLabel="Save remittance"
          />
          {saved ? <p role="status" className="sub">Saved.</p> : null}
        </>
      ) : (
        <>
          <div className="fld"><label>Payee</label><input value={values.payeeName} disabled readOnly /></div>
          <div className="fld"><label>Mailing address</label><textarea value={values.address} disabled readOnly rows={2} /></div>
          <div className="fld"><label>Payment instructions</label><textarea value={values.instructions} disabled readOnly rows={3} /></div>
        </>
      )) : <Muted>Loading…</Muted>}
      <p className="fine" style={{ border: "none", marginTop: 0, paddingTop: 0 }}>Nothing here is a credential: these are the details a client needs to send you money, not a login. An issued invoice keeps the instructions it was issued with.</p>
    </div>
  );
}

function RateCards({ api, actions }: { api: BillingApi; actions: string[] }) {
  const canView = actions.includes("pricing.view");
  const canManage = actions.includes("pricing.manage");
  const [cards, setCards] = useState<Row[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cardId, setCardId] = useState("");
  const [entries, setEntries] = useState<Row[]>([]);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!canView) return;
    let current = true;
    api.rateCards(cursor).then((result) => { if (!current) return; if (result.ok) { setCards((list) => (cursor ? [...list, ...result.data.items] : result.data.items)); setNextCursor(result.data.nextCursor); } else setFailure(asFailure(result)); });
    return () => { current = false; };
  }, [api, canView, cursor, refresh]);
  useEffect(() => {
    if (!cardId) return;
    let current = true;
    api.rateCard(cardId).then((result) => { if (!current) return; if (result.ok) setEntries(result.data.entries); else setFailure(asFailure(result)); });
    return () => { current = false; };
  }, [api, cardId, refresh]);
  const done = async <T,>(work: () => Promise<ApiResult<T>>) => { const result = await work(); if (result.ok) { setCursor(null); setRefresh((value) => value + 1); } return result; };
  if (!canView) return <div className="card"><h3>Rate card</h3><Muted>Price details are restricted to Owner/Admin and authorized Billing users.</Muted></div>;
  return (
    <>
      <div className="card" style={{ marginBottom: 14 }} data-rate-cards>
        <h3>What you charge<span>price only</span></h3>
        {failure ? <ErrorBanner kind={failure.kind} message={failure.message} code={failure.code} /> : null}
        <div className="scroll"><table>
          <thead><tr><th>Rate card</th><th>Effective</th><th>Status</th>{canManage ? <th /> : null}</tr></thead>
          <tbody>
            {cards.map((card) => (
              <tr key={text(card, "id")} className={cardId === text(card, "id") ? "on" : undefined}>
                <td><button type="button" className="lnk" onClick={() => setCardId(text(card, "id"))}>{text(card, "name")}</button></td>
                <td>{text(card, "effectiveFrom")} to {text(card, "effectiveTo", "open")}</td>
                <td>{text(card, "active") === "true" ? "Active" : "Inactive"}</td>
                {canManage ? <td><ReasonAction label={text(card, "active") === "true" ? "Deactivate" : "Activate"} submitLabel="Confirm" onSubmit={(reason) => done(() => api.updateRateCard(text(card, "id"), { active: text(card, "active") !== "true", reason }))} /></td> : null}
              </tr>
            ))}
            {cards.length === 0 ? <tr><td colSpan={4} style={{ color: "var(--muted)" }}>No rate cards yet.</td></tr> : null}
          </tbody>
        </table></div>
        {nextCursor ? <button type="button" className="btn alt" style={{ marginTop: 10 }} onClick={() => setCursor(nextCursor)}>Load more</button> : null}
        <p className="fine" style={{ border: "none", marginTop: 10, paddingTop: 0 }}>The card is a starting point: clients on their own price or a package are not touched when it changes, and changing it never rewrites existing candidates or invoices.</p>
      </div>
      {cardId ? (
        <div className="card" style={{ marginBottom: 14 }} data-rate-entries>
          <h3>Rate entries<span>{entries.length}</span></h3>
          {entries.length ? (
            <div className="scroll"><table>
              <thead><tr><th>Service code</th><th>Unit</th><th className="r">Price</th><th>From</th><th>To</th>{canManage ? <th /> : null}</tr></thead>
              <tbody>{entries.map((entry) => (
                <tr key={text(entry, "id")}><td className="mono">{text(entry, "serviceCode")}</td><td>{text(entry, "unit")}</td><td className="r num">{formatMoney(text(entry, "unitAmount"))}</td><td>{text(entry, "effectiveFrom")}</td><td>{text(entry, "effectiveTo", "Open")}</td>
                  {canManage ? <td><ReasonAction label="End today" submitLabel="End this rate" onSubmit={(reason) => done(() => api.updateRateEntry(cardId, text(entry, "id"), { effectiveTo: firmToday(), reason }))} /></td> : null}</tr>
              ))}</tbody>
            </table></div>
          ) : <Muted>No entries on this card yet.</Muted>}
          {canManage ? (
            <details style={{ marginTop: 12 }} open data-form="rate-entry"><summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Add a rate entry</summary>
              <LedgerForm
                fields={[{ name: "serviceCode", label: "Service code" }, { name: "unit", label: "Unit", placeholder: "service" }, { name: "unitAmount", label: "Unit amount (USD)", placeholder: "0.00" }, { name: "effectiveFrom", label: "Effective from", type: "date" }, { name: "reason", label: "Reason", type: "textarea" }]}
                initialValues={{ serviceCode: "", unit: "", unitAmount: "", effectiveFrom: "", reason: "" }}
                validate={required("serviceCode", "unit", "unitAmount", "effectiveFrom", "reason")}
                onSubmit={(values: FormValues) => done(() => api.createRateEntry(cardId, { serviceCode: values.serviceCode.trim(), unit: values.unit.trim(), unitAmount: values.unitAmount.trim(), effectiveFrom: values.effectiveFrom, reason: values.reason.trim() }))}
                submitLabel="Add rate entry"
              />
            </details>
          ) : null}
        </div>
      ) : null}
      {canManage ? (
        <div className="card" data-form="rate-card">
          <h3>New rate card</h3>
          <LedgerForm
            fields={[{ name: "name", label: "Name" }, { name: "effectiveFrom", label: "Effective from", type: "date" }, { name: "reason", label: "Reason", type: "textarea" }]}
            initialValues={{ name: "", effectiveFrom: "", reason: "" }}
            validate={required("name", "effectiveFrom", "reason")}
            onSubmit={(values: FormValues) => done(() => api.createRateCard({ name: values.name.trim(), effectiveFrom: values.effectiveFrom, reason: values.reason.trim() }))}
            submitLabel="Create rate card"
          />
        </div>
      ) : null}
    </>
  );
}

const ADAPTERS = [
  { value: "schedule", label: "On a schedule" },
  { value: "work_period_done", label: "When a work period is done" },
  { value: "period_count_threshold", label: "When a count reaches a threshold" },
  { value: "manual_confirmation", label: "When someone confirms it" },
];
const DATE_RULES = [
  { value: "period_end", label: "Period end" },
  { value: "completion_date", label: "Completion date" },
  { value: "confirmed_date", label: "Confirmed date" },
];

function CompletionRules({ api, clientId, actions }: { api: BillingApi; clientId: string | null; actions: string[] }) {
  const [services, setServices] = useState<Service[]>([]);
  const [maps, setMaps] = useState<Row[]>([]);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [confirmationKey, setConfirmationKey] = useState("");
  const [saved, setSaved] = useState("");
  const canManage = actions.includes("candidates.manage");
  useEffect(() => {
    if (!clientId) return;
    let current = true;
    Promise.all([api.clientServices(clientId), api.completionMaps()]).then(([s, m]) => { if (!current) return; if (s.ok) setServices(s.data.items); else setFailure(asFailure(s)); if (m.ok) setMaps(m.data.items); else setFailure(asFailure(m)); });
    return () => { current = false; };
  }, [api, clientId, refresh]);
  const done = async <T,>(work: () => Promise<ApiResult<T>>, message = "Saved.") => { const result = await work(); if (result.ok) { setSaved(message); setRefresh((value) => value + 1); } return result; };
  if (!clientId) return <div className="card"><h3>Completion rules</h3><Muted>Choose a client above to configure when their work becomes billable.</Muted></div>;
  const ids = new Set(services.map((service) => service.id));
  const theirMaps = maps.filter((map) => ids.has(text(map, "clientServiceId")));
  const serviceOptions = services.filter((service) => service.active).map((service) => ({ value: service.id, label: `${service.serviceName} · ${service.serviceCode}` }));
  return (
    <>
      <div className="card" style={{ marginBottom: 14 }} data-completion-maps>
        <h3>When work becomes billable<span>future occurrences only</span></h3>
        {failure ? <ErrorBanner kind={failure.kind} message={failure.message} code={failure.code} /> : null}
        {saved ? <p role="status" className="sub">{saved}</p> : null}
        {theirMaps.length ? (
          <div className="scroll"><table>
            <thead><tr><th>Service</th><th>Rule</th><th>From</th><th>To</th><th>State</th>{canManage ? <th /> : null}</tr></thead>
            <tbody>{theirMaps.map((map) => (
              <tr key={text(map, "id")}><td><b>{services.find((service) => service.id === text(map, "clientServiceId"))?.serviceName}</b></td><td>{ADAPTERS.find((item) => item.value === text(map, "adapter"))?.label || text(map, "adapter")}</td><td>{text(map, "effectiveFrom")}</td><td>{text(map, "effectiveTo", "Open")}</td><td>{text(map, "enabled") === "true" ? "On" : "Off"}</td>
                {canManage ? <td><ReasonAction label={text(map, "enabled") === "true" ? "Turn off" : "Turn on"} submitLabel="Confirm" onSubmit={(reason) => done(() => api.updateCompletionMap(text(map, "id"), { enabled: text(map, "enabled") !== "true", reason }))} /></td> : null}</tr>
            ))}</tbody>
          </table></div>
        ) : <Muted>No rules for this client&apos;s services yet. A service with no rule is skipped.</Muted>}
        <p className="fine" style={{ border: "none", marginTop: 10, paddingTop: 0 }}>A change applies to occurrences not yet generated. Existing candidates and invoices are never rewritten.</p>
      </div>
      {canManage ? (
        <div className="g2">
          <div className="card" data-form="map">
            <h3>Add a rule</h3>
            <LedgerForm
              fields={[{ name: "clientServiceId", label: "Service", type: "select", options: serviceOptions }, { name: "adapter", label: "Bills", type: "select", options: ADAPTERS }, { name: "candidateDateRule", label: "Dated on", type: "select", options: DATE_RULES }, { name: "threshold", label: "Threshold", optional: true, placeholder: "Only for a count rule" }, { name: "effectiveFrom", label: "Effective from", type: "date" }, { name: "reason", label: "Reason", type: "textarea" }]}
              initialValues={{ clientServiceId: "", adapter: "", candidateDateRule: "", threshold: "", effectiveFrom: "", reason: "" }}
              validate={required("clientServiceId", "adapter", "candidateDateRule", "effectiveFrom", "reason")}
              onSubmit={(values: FormValues) => done(() => api.createCompletionMap({
                clientServiceId: values.clientServiceId,
                adapter: values.adapter,
                predicate: values.adapter === "work_period_done" ? { stage: "done" } : values.adapter === "period_count_threshold" ? { threshold: Number(values.threshold) } : {},
                identityFields: values.adapter === "manual_confirmation" ? ["confirmation_id"] : ["client_service_id", "period"],
                candidateDateRule: values.candidateDateRule,
                effectiveFrom: values.effectiveFrom,
                reason: values.reason.trim(),
              }))}
              submitLabel="Create rule"
            />
          </div>
          <div className="card" data-form="confirm">
            <h3>Confirm finished work<span>audited</span></h3>
            <LedgerForm
              fields={[{ name: "clientServiceId", label: "Service", type: "select", options: serviceOptions }, { name: "confirmedDate", label: "Confirmed date", type: "date" }, { name: "sourceNote", label: "How you know", type: "textarea" }, { name: "reason", label: "Reason", type: "textarea" }]}
              initialValues={{ clientServiceId: "", confirmedDate: "", sourceNote: "", reason: "" }}
              validate={required("clientServiceId", "confirmedDate", "sourceNote", "reason")}
              onSubmit={async (values: FormValues) => {
                // Reused on a retry after a timeout, so the same confirmation cannot be made twice.
                const idempotencyKey = confirmationKey || crypto.randomUUID();
                setConfirmationKey(idempotencyKey);
                const result = await done(() => api.manualConfirmation({ idempotencyKey, clientServiceId: values.clientServiceId, confirmedDate: values.confirmedDate, sourceNote: values.sourceNote.trim(), reason: values.reason.trim() }), "Confirmed.");
                if (result.ok) setConfirmationKey("");
                return result;
              }}
              submitLabel="Confirm completion"
            />
          </div>
        </div>
      ) : null}
    </>
  );
}

function PermissionPolicy({ api }: { api: BillingApi }) {
  const [policy, setPolicy] = useState<Policy[]>([]);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let current = true;
    api.permissionsPolicy().then((result) => { if (!current) return; if (result.ok) setPolicy(result.data.policies); else setFailure(asFailure(result)); });
    return () => { current = false; };
  }, [api]);
  const change = (index: number, patch: Partial<Policy>) => setPolicy((rows) => rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  return (
    <div className="card" data-form="policy">
      <h3>Delegated Billing permissions<span>Owner/Admin only</span></h3>
      {failure ? <ErrorBanner kind={failure.kind} message={failure.message} code={failure.code} /> : null}
      <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "-4px 0 12px", lineHeight: 1.6 }}>Owner and Admin always have every action. Policy management, voiding an invoice and reversing a payment are fixed to Owner/Admin and can&apos;t be delegated.</p>
      <div className="scroll"><table data-policy-table>
        <thead><tr><th>Action</th><th>On</th><th>Manager</th><th>Staff</th><th>Offshore</th></tr></thead>
        <tbody>{policy.map((item, index) => (
          <tr key={item.actionKey}>
            <td><code>{item.actionKey}</code></td>
            <td><input type="checkbox" aria-label={`${item.actionKey} on`} checked={item.enabled} onChange={(event) => change(index, { enabled: event.target.checked })} /></td>
            {["manager", "staff", "offshore"].map((role) => (
              <td key={role}><input type="checkbox" aria-label={`${item.actionKey} ${role}`} disabled={!item.enabled} checked={item.allowedRoles.includes(role)} onChange={(event) => change(index, { allowedRoles: event.target.checked ? [...item.allowedRoles, role] : item.allowedRoles.filter((value) => value !== role) })} /></td>
            ))}
          </tr>
        ))}</tbody>
      </table></div>
      <div style={{ marginTop: 12 }}>
        <LedgerForm
          fields={[{ name: "reason", label: "Reason", type: "textarea" }]}
          initialValues={{ reason: "" }}
          validate={required("reason")}
          onSubmit={async (values: FormValues) => { const result = await api.updatePermissionsPolicy(policy, values.reason.trim()); if (result.ok) setSaved(true); return result; }}
          submitLabel="Save permission policy"
        />
        {saved ? <p role="status" className="sub">Saved.</p> : null}
      </div>
    </div>
  );
}
