"use client";

import { Fragment, useEffect, useState } from "react";
import type { BillingApi } from "@/lib/billing-ui/api";
import type { CollectionsDeliveryAttemptSummary } from "@/lib/collections-api";
import { DELIVERY_STATUS_LABELS } from "@/lib/billing-ui/delivery";
import { firmDate, groupEmailLog } from "@/lib/billing-ui/email-log";

const PAGE = 200;
const MAX_PAGES = 50;

/**
 * Email log (Phase 5, item 5): per client and invoice, which reminders went out and when. Counts and dates only.
 * Reads delivery history page by page until the backend's per-client summary endpoint exists.
 */
export function EmailLogPanel({ api, clientId, clientNames, stageLabels, firmTimezone, refreshKey = 0 }: {
  api: BillingApi; clientId: string | null; clientNames: Record<string, string>; stageLabels: Record<number, string>; firmTimezone: string; refreshKey?: number;
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

  if (failed) return <p className="sub" role="alert" style={{ color: "var(--red)" }}>Couldn&apos;t load the email log: {failed}</p>;
  if (!items) return <p className="sub" role="status">Loading the email log…</p>;

  const clients = groupEmailLog(items.filter((item) => !clientId || item.client_id === clientId), stageLabels, clientNames);
  const toggle = (id: string) => setOpen((currentOpen) => { const next = new Set(currentOpen); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const stages = [1, 2, 3, 5].map((stage) => ({ stage, label: stageLabels[stage] || `Touch ${stage}` }));

  return (
    <div className="card" data-email-log>
      <h3>Email log<span>how many reminders of each kind went out, and when · click a client for its invoices</span></h3>
      {clients.length === 0 ? (
        <div className="po-note brand" data-email-log-empty><span className="ni">&#9993;</span><div><b>No reminders have gone out{clientId ? " to this client" : ""} yet.</b> Email delivery is still in test mode. Once reminders are sent, each one is counted here by type and date. The emails themselves aren&apos;t stored.</div></div>
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
      <p className="fine" style={{ border: "none", marginTop: 10, paddingTop: 0 }}>Only emails the provider accepted count as sent. Each invoice gets each reminder at most once. Touch 4 is an internal hand-off, so it never appears here. Dates are in the firm&apos;s time zone.</p>
    </div>
  );
}
