"use client";

import { Fragment, useEffect, useState } from "react";
import type { BillingApi } from "@/lib/billing-ui/api";
import type { CollectionsDeliveryAttemptSummary, CollectionsDeliverySummaryResponse } from "@/lib/collections-api";
import { DELIVERY_REASON_LABELS, DELIVERY_STATUS_LABELS } from "@/lib/billing-ui/delivery";
import { firmDate, groupEmailLog } from "@/lib/billing-ui/email-log";

const PAGE = 200;
const MAX_PAGES = 50;
const FOOTNOTE = "Counts and dates only; the emails themselves aren't stored. \"Sent\" means the email provider accepted it, not that it reached an inbox. Each invoice gets each reminder at most once. Touch 4 is an internal hand-off, so it never appears here. Dates are in the firm's time zone.";

const reasonText = (code: string | null) => (code && code in DELIVERY_REASON_LABELS ? DELIVERY_REASON_LABELS[code as keyof typeof DELIVERY_REASON_LABELS] : code || undefined);

/**
 * Email log (Phase 5, item 5): which reminders went out, per client and invoice, and when. Counts and dates only.
 * With a client picked it reads that client's summary (Owner/Admin and Collections staff). With none picked,
 * Owners and Admins get every client from delivery history; staff are asked to pick a client.
 */
export function EmailLogPanel({ api, clientNames, stageLabels, firmTimezone, canSeeAll, refreshKey = 0 }: {
  api: BillingApi; clientNames: Record<string, string>; stageLabels: Record<number, string>;
  firmTimezone: string; canSeeAll: boolean; refreshKey?: number;
}) {
  const [clientId, setClientId] = useState("");
  const choices = Object.entries(clientNames).sort((a, b) => a[1].localeCompare(b[1]));
  const picker = (
    <label className="bc-field" style={{ maxWidth: 360, marginBottom: 12 }}><span>Client</span>
      <select className="bc-in" data-email-log-client-select value={clientId} onChange={(event) => setClientId(event.target.value)}>
        <option value="">{canSeeAll ? "All clients" : "Choose a client…"}</option>
        {choices.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select>
    </label>
  );
  return (
    <div data-email-log-tab>
      {picker}
      {clientId ? <ClientEmailLog key={`${clientId}:${refreshKey}`} api={api} clientId={clientId} clientName={clientNames[clientId] || "This client"} firmTimezone={firmTimezone} />
        : canSeeAll ? <AllClientsEmailLog api={api} clientNames={clientNames} stageLabels={stageLabels} firmTimezone={firmTimezone} refreshKey={refreshKey} />
        : (
          <div className="card" data-email-log>
            <h3>Email log<span>pick a client to see their reminders</span></h3>
            <div className="po-note brand" data-email-log-pick><span className="ni">&#9993;</span><div>Choose a client above to see which reminders went out to them, per invoice, and when.</div></div>
          </div>
        )}
    </div>
  );
}

function ModeNote({ mode }: { mode: "disabled" | "test" }) {
  return mode === "test"
    ? <div className="po-note amber" data-email-log-mode="test"><span className="ni">&#9888;</span><div><b>Test mode.</b> Reminders marked sent went to the test mailbox, not to the client.</div></div>
    : <div className="po-note brand" data-email-log-mode="disabled"><span className="ni">&#9993;</span><div><b>Email delivery is off.</b> Nothing has been sent to clients from TAP Hub yet.</div></div>;
}

/** One client, from GET /api/collections/deliveries/summary. */
function ClientEmailLog({ api, clientId, clientName, firmTimezone }: { api: BillingApi; clientId: string; clientName: string; firmTimezone: string }) {
  const [data, setData] = useState<CollectionsDeliverySummaryResponse | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    api.deliverySummary(clientId).then((result) => {
      if (!current) return;
      if (result.ok === false) setFailed(result.message); else setData(result.data);
    });
    return () => { current = false; };
  }, [api, clientId]);
  if (failed) return <p className="sub" role="alert" style={{ color: "var(--red)" }} data-email-log-error>Couldn&apos;t load the email log: {failed}</p>;
  if (!data) return <p className="sub" role="status">Loading the email log…</p>;
  const sentTotal = data.stages.reduce((sum, stage) => sum + stage.accepted_count, 0);
  const notices = data.invoices.reduce((sum, invoice) => sum + invoice.formal_notice.recorded_count, 0);
  return (
    <div className="card" data-email-log data-email-log-client-view={clientId}>
      <h3>Email log · {clientName}<span>reminders sent per invoice, and when</span></h3>
      <ModeNote mode={data.delivery_mode} />
      <div className="g4" style={{ margin: "12px 0" }} data-email-log-stages>
        {data.stages.map((stage) => (
          <div key={stage.stage} className="stat" data-stage-count={stage.stage}>
            <div className="k">{stage.label}</div>
            <div className="v num">{stage.accepted_count}&times;</div>
            <div className="d">{stage.last_accepted_at ? `last ${firmDate(stage.last_accepted_at, firmTimezone)}` : "none sent"}</div>
          </div>
        ))}
        <div className="stat" data-stage-count="5"><div className="k">Formal notice</div><div className="v num">{notices}&times;</div><div className="d">recorded by an Owner or Admin</div></div>
      </div>
      {data.invoices.length === 0 ? (
        <p className="sub" data-email-log-empty>No reminders have been attempted for {clientName} yet.</p>
      ) : (
        <div className="scroll">
          <table>
            <thead><tr><th>Invoice</th><th>Sent</th><th>Not sent</th><th>Formal notice</th></tr></thead>
            <tbody>
              {data.invoices.map((invoice) => (
                <tr key={invoice.row_key} data-email-log-invoice>
                  <td className="mono">{invoice.invoice_number || "—"}</td>
                  <td>{invoice.accepted.length ? invoice.accepted.map((row) => <span key={row.stage} className="chip c-green" style={{ marginRight: 6 }}>{row.label} · {row.accepted_at ? firmDate(row.accepted_at, firmTimezone) : "date unknown"}{row.mode === "test" ? " · test" : ""}</span>) : <span className="sub">—</span>}</td>
                  <td>{invoice.not_accepted.length ? invoice.not_accepted.map((row) => <span key={row.stage} className="chip c-grey" style={{ marginRight: 6 }} title={reasonText(row.reason_code)}>Touch {row.stage} · {DELIVERY_STATUS_LABELS[row.status]}</span>) : <span className="sub">—</span>}</td>
                  <td>{invoice.formal_notice.recorded_count ? `${invoice.formal_notice.recorded_count}× · ${invoice.formal_notice.last_recorded_at ? firmDate(invoice.formal_notice.last_recorded_at, firmTimezone) : ""}` : <span className="sub">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.pagination.total_invoices > data.invoices.length ? <p className="sub">Showing {data.invoices.length} of {data.pagination.total_invoices} invoices.</p> : null}
        </div>
      )}
      <p className="fine" style={{ border: "none", marginTop: 10, paddingTop: 0 }}>{sentTotal} sent in all. {FOOTNOTE}</p>
    </div>
  );
}

/** Every client, from delivery history (Owner/Admin only). */
function AllClientsEmailLog({ api, clientNames, stageLabels, firmTimezone, refreshKey }: {
  api: BillingApi; clientNames: Record<string, string>; stageLabels: Record<number, string>; firmTimezone: string; refreshKey: number;
}) {
  const [items, setItems] = useState<CollectionsDeliveryAttemptSummary[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let current = true;
    (async () => {
      const all: CollectionsDeliveryAttemptSummary[] = [];
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const result = await api.deliveries({ limit: PAGE, offset: page * PAGE });
        if (!current) return;
        if (result.ok === false) { setFailed(result.message); return; }
        all.push(...result.data.items);
        if ((page + 1) * PAGE >= result.data.pagination.total) break;
      }
      if (current) { setItems(all); setFailed(null); }
    })();
    return () => { current = false; };
  }, [api, refreshKey]);

  if (failed) return <p className="sub" role="alert" style={{ color: "var(--red)" }} data-email-log-error>Couldn&apos;t load the email log: {failed}</p>;
  if (!items) return <p className="sub" role="status">Loading the email log…</p>;

  const clients = groupEmailLog(items, stageLabels, clientNames);
  const toggle = (id: string) => setOpen((currentOpen) => { const next = new Set(currentOpen); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const stages = [1, 2, 3, 5].map((stage) => ({ stage, label: stageLabels[stage] || `Touch ${stage}` }));

  return (
    <div className="card" data-email-log>
      <h3>Email log<span>how many reminders of each kind went out, and when · click a client for its invoices</span></h3>
      {clients.length === 0 ? (
        <div className="po-note brand" data-email-log-empty><span className="ni">&#9993;</span><div><b>No reminders have gone out yet.</b> Email delivery is still off or in test mode. Once reminders are sent, each one is counted here by type and date.</div></div>
      ) : (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th aria-label="Open" /><th>Client</th>
                {stages.map((stage) => <th key={stage.stage} className="r">{stage.label}</th>)}
                <th className="r">Total sent</th><th>Last sent</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((client) => {
                const expanded = open.has(client.client_id);
                return (
                  <Fragment key={client.client_id}>
                    <tr data-email-log-client={client.client_id} style={{ cursor: "pointer" }} onClick={() => toggle(client.client_id)}>
                      <td style={{ width: 16 }}>
                        <button type="button" aria-expanded={expanded} aria-label={`${expanded ? "Hide" : "Show"} invoices for ${client.client_name}`} onClick={(event) => { event.stopPropagation(); toggle(client.client_id); }} style={{ background: "none", border: 0, padding: 0, color: "var(--amber)", fontWeight: 700, cursor: "pointer" }}>{expanded ? "▾" : "▸"}</button>
                      </td>
                      <td><b>{client.client_name}</b></td>
                      {stages.map((stage) => {
                        const count = client.stages.find((row) => row.stage === stage.stage)?.sent_count || 0;
                        return <td key={stage.stage} className="r num" data-stage-count={stage.stage} style={count ? undefined : { color: "var(--faint)" }}>{count ? `${count}×` : "—"}</td>;
                      })}
                      <td className="r num"><b>{client.total_sent}</b></td>
                      <td>{client.last_sent_at ? firmDate(client.last_sent_at, firmTimezone) : <span className="sub">nothing sent</span>}</td>
                    </tr>
                    {expanded ? (
                      <tr data-email-log-invoices={client.client_id}>
                        <td />
                        <td colSpan={stages.length + 3} style={{ background: "var(--card2)" }}>
                          <table>
                            <thead><tr><th>Invoice</th><th>Sent</th><th>Not sent</th></tr></thead>
                            <tbody>
                              {client.invoices.map((invoice) => (
                                <tr key={invoice.row_key} data-email-log-invoice>
                                  <td className="mono">{invoice.invoice_number}</td>
                                  <td>{invoice.sent.length ? invoice.sent.map((sent) => <span key={sent.stage} className="chip c-green" style={{ marginRight: 6 }}>{sent.label} · {firmDate(sent.sent_at, firmTimezone)}</span>) : <span className="sub">—</span>}</td>
                                  <td>{invoice.not_sent.length ? invoice.not_sent.map((row) => <span key={row.stage} className="chip c-grey" style={{ marginRight: 6 }} title={row.reason_text || undefined}>{row.label} · {DELIVERY_STATUS_LABELS[row.status]}</span>) : <span className="sub">—</span>}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="fine" style={{ border: "none", marginTop: 10, paddingTop: 0 }}>{FOOTNOTE} Choose a client above for that client&apos;s formal notices too.</p>
    </div>
  );
}
