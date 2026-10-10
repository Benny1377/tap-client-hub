"use client";

import { useState, type CSSProperties } from "react";
import type { ApiResult } from "@/lib/billing-ui/api";
import type { CollectionsAccount, CollectionsAutomationPreviewResponse, CollectionsReceivablesResponse } from "@/lib/collections-api";
import type { Viewer } from "@/lib/billing-ui/types";
import { DISPOSITION_LABELS, formatMoney, PREVIEW_REASON_LABELS, stageLabel, viewerIsPowerUser } from "@/lib/billing-ui/view-model";
import { buttonStyle, cellStyle, ErrorBanner, hintStyle, OwnerAdminOnly, quietButtonStyle, tableStyle } from "./ui";

const cardStyle: CSSProperties = { border: "1px solid var(--line)", borderRadius: 12, padding: "10px 12px", minWidth: 0 };
const cardGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: 10 };
const flagStyle: CSSProperties = { display: "inline-block", borderRadius: 999, padding: "1px 8px", fontSize: 11.5, fontWeight: 600, marginRight: 4, marginTop: 2 };

function Card({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div style={cardStyle} data-summary={testId}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)" }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2, overflowWrap: "anywhere" }}>{value}</div>
    </div>
  );
}

/** AR insights from the server's Collections read model. Nothing here is computed in the browser. */
export function WorklistSummary({ worklist }: { worklist: CollectionsReceivablesResponse }) {
  const { summary } = worklist;
  return (
    <div>
      <p style={hintStyle}>As of {worklist.as_of_date} (firm date). Amounts come from Billing.</p>
      <div style={cardGridStyle}>
        <Card testId="gross" label="Open balance" value={formatMoney(summary.gross_open_balance)} />
        <Card testId="credit" label="Unallocated credit" value={formatMoney(summary.unallocated_credit)} />
        <Card testId="net" label="Net AR estimate" value={formatMoney(summary.net_ar_estimate)} />
        <Card testId="accounts" label="Accounts owing" value={String(summary.owing_accounts)} />
        <Card testId="invoices" label="Open invoices" value={String(summary.open_invoice_count)} />
        <Card testId="oldest" label="Oldest days past due" value={String(summary.oldest_days_past_due)} />
      </div>
      <div style={{ ...cardGridStyle, marginTop: 10 }}>
        <Card testId="aging-current" label="Current" value={formatMoney(summary.aging.current)} />
        <Card testId="aging-1-30" label="1–30 days" value={formatMoney(summary.aging.days_1_30)} />
        <Card testId="aging-31-60" label="31–60 days" value={formatMoney(summary.aging.days_31_60)} />
        <Card testId="aging-61-90" label="61–90 days" value={formatMoney(summary.aging.days_61_90)} />
        <Card testId="aging-90" label="90+ days" value={formatMoney(summary.aging.days_over_90)} />
      </div>
      {summary.credit_review_accounts > 0 ? (
        <p data-credit-review-count style={{ ...hintStyle, color: "#7a5210" }}>
          {summary.credit_review_accounts} account{summary.credit_review_accounts === 1 ? " has" : "s have"} unallocated payments to reconcile in Billing. Collections never allocates them.
        </p>
      ) : null}
    </div>
  );
}

const BANDS: Array<[keyof CollectionsAccount["priority_score_components"], string]> = [
  ["21_30", "21–30 days"],
  ["31_60", "31–60 days"],
  ["61_90", "61–90 days"],
  ["91_180", "91–180 days"],
  ["over_180", "Over 180 days"],
];

export function ScoreBreakdown({ account }: { account: CollectionsAccount }) {
  const components = account.priority_score_components;
  return (
    <details data-score-breakdown={account.client_id}>
      <summary style={{ cursor: "pointer" }}><strong>{formatMoney(account.call_priority_score).replace("$", "")}</strong></summary>
      <table style={{ ...tableStyle, fontSize: 12.5 }}>
        <tbody>
          {BANDS.map(([key, label]) => {
            const part = components[key];
            if (typeof part !== "object") return null;
            return (
              <tr key={key} data-score-band={key}>
                <td style={cellStyle}>{label}</td>
                <td style={cellStyle}>{formatMoney(part.balance)}</td>
                <td style={cellStyle}>× {part.weight}</td>
                <td style={cellStyle}>= {formatMoney(part.weighted_amount).replace("$", "")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>Balances under {components.score_zero_before_days_past_due} days past due add nothing to the score.</div>
    </details>
  );
}

function Flags({ account }: { account: CollectionsAccount }) {
  return (
    <div>
      {account.on_hold ? <span data-flag="hold" style={{ ...flagStyle, background: "var(--amber-soft)", color: "#7a5210" }}>Hold</span> : null}
      {account.credit_review_required ? <span data-flag="credit" style={{ ...flagStyle, background: "var(--blue-soft)", color: "var(--blue)" }}>Credit to reconcile</span> : null}
      {account.contact_review_required ? <span data-flag="contact" style={{ ...flagStyle, background: "var(--red-soft)", color: "var(--red)" }}>Contact needs review</span> : null}
    </div>
  );
}

export function WorklistTable({ worklist, onSelectClient, onPage }: {
  worklist: CollectionsReceivablesResponse;
  onSelectClient: (clientId: string) => void;
  onPage: (offset: number) => void;
}) {
  const { accounts, pagination } = worklist;
  if (accounts.length === 0) return <p style={hintStyle}>No accounts owe money or have credit to review.</p>;
  const first = pagination.offset + 1;
  const last = pagination.offset + accounts.length;
  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={cellStyle}>Client</th>
              <th style={cellStyle}>Contact</th>
              <th style={cellStyle}>Open</th>
              <th style={cellStyle}>Credit</th>
              <th style={cellStyle}>Oldest</th>
              <th style={cellStyle}>Priority</th>
              <th style={cellStyle}>Invoices</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => (
              <tr key={account.client_id} data-worklist-account={account.client_id}>
                <td style={cellStyle}>
                  <button type="button" onClick={() => onSelectClient(account.client_id)} style={{ background: "none", border: 0, padding: 0, color: "var(--teal)", fontWeight: 600, cursor: "pointer", textAlign: "left" }}>
                    {account.client_name}
                  </button>
                  <Flags account={account} />
                </td>
                <td style={cellStyle}>
                  {account.contact_name || "—"}
                  {account.contact_phone ? <div style={{ fontSize: 12.5 }}>{account.contact_phone}</div> : null}
                  {account.contact_email ? <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{account.contact_email}</div> : null}
                </td>
                <td style={cellStyle}>{formatMoney(account.gross_open_balance)}</td>
                <td style={cellStyle}>{formatMoney(account.unallocated_credit)}</td>
                <td style={{ ...cellStyle, color: account.oldest_days_past_due > 0 ? "var(--red)" : undefined }}>{account.oldest_days_past_due} days</td>
                <td style={cellStyle}><ScoreBreakdown account={account} /></td>
                <td style={cellStyle}>
                  <details>
                    <summary style={{ cursor: "pointer" }}>{account.open_invoice_count} open</summary>
                    <table style={{ ...tableStyle, fontSize: 12.5 }}>
                      <thead>
                        <tr>
                          <th style={cellStyle}>Invoice</th>
                          <th style={cellStyle}>Due</th>
                          <th style={cellStyle}>Balance</th>
                          <th style={cellStyle}>Days</th>
                          <th style={cellStyle}>Next step</th>
                        </tr>
                      </thead>
                      <tbody>
                        {account.invoices.map((invoice) => (
                          <tr key={invoice.invoice_id} data-worklist-invoice={invoice.invoice_id} data-next-stage={invoice.next_stage ?? ""}>
                            <td style={cellStyle}>{invoice.invoice_number}</td>
                            <td style={cellStyle}>{invoice.due_date}</td>
                            <td style={cellStyle}>{formatMoney(invoice.balance)}</td>
                            <td style={cellStyle}>{invoice.days_past_due}</td>
                            <td style={cellStyle}>
                              {invoice.next_stage ? stageLabel(invoice.next_stage) : invoice.days_past_due > 0 ? "Ladder complete — follow up manually" : "Not due yet"}
                              {invoice.on_hold ? <div style={{ color: "#7a5210" }}>On hold</div> : null}
                              {invoice.below_minimum ? <div style={{ color: "var(--muted)" }}>Below minimum</div> : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 10, fontSize: 13 }}>
        <span data-worklist-range>Showing {first}–{last} of {pagination.total_accounts}</span>
        <button type="button" style={quietButtonStyle} disabled={pagination.offset === 0} onClick={() => onPage(Math.max(0, pagination.offset - pagination.limit))}>Previous</button>
        <button type="button" style={quietButtonStyle} disabled={last >= pagination.total_accounts} onClick={() => onPage(pagination.offset + pagination.limit)}>Next</button>
      </div>
    </div>
  );
}

const PREVIEW_PAGE = 50;

export function PreviewResults({ preview, onPage }: { preview: CollectionsAutomationPreviewResponse; onPage: (offset: number) => void }) {
  const { actions, pagination } = preview;
  return (
    <div>
      <div data-preview-safety role="note" style={{ background: "var(--teal-soft)", borderRadius: 10, padding: "8px 12px", fontSize: 13, margin: "8px 0" }}>
        Preview only, as of {preview.as_of_date}. Automation is {preview.automation_enabled ? "on" : "off"} and delivery is {preview.delivery_mode}. Nothing was sent.
      </div>
      {actions.length === 0 ? <p style={hintStyle}>No actions are due.</p> : (
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={cellStyle}>Client</th>
                <th style={cellStyle}>Invoice</th>
                <th style={cellStyle}>Balance</th>
                <th style={cellStyle}>Days</th>
                <th style={cellStyle}>Step</th>
                <th style={cellStyle}>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {actions.map((action) => (
                <tr key={`${action.invoice_id}-${action.stage}`} data-preview-action={action.invoice_id} data-disposition={action.disposition}>
                  <td style={cellStyle}>
                    {action.client_name}
                    {action.contact_phone ? <div style={{ fontSize: 12.5 }}>{action.contact_phone}</div> : null}
                  </td>
                  <td style={cellStyle}>{action.invoice_number}</td>
                  <td style={cellStyle}>{formatMoney(action.balance)}</td>
                  <td style={cellStyle}>{action.days_past_due}</td>
                  <td style={cellStyle}>{stageLabel(action.stage)}</td>
                  <td style={cellStyle}>
                    <strong>{DISPOSITION_LABELS[action.disposition] || action.disposition}</strong>
                    {action.suppression_reasons.map((reason) => <div key={reason} data-suppression={reason} style={{ fontSize: 12 }}>{PREVIEW_REASON_LABELS[reason] || reason}</div>)}
                    {action.review_warnings.map((warning) => <div key={warning} data-warning={warning} style={{ fontSize: 12, color: "var(--muted)" }}>Note: {PREVIEW_REASON_LABELS[warning] || warning}</div>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 10, fontSize: 13 }}>
        <span>{pagination.total_actions} action{pagination.total_actions === 1 ? "" : "s"} in total</span>
        <button type="button" style={quietButtonStyle} disabled={pagination.offset === 0} onClick={() => onPage(Math.max(0, pagination.offset - pagination.limit))}>Previous</button>
        <button type="button" style={quietButtonStyle} disabled={!pagination.has_more} onClick={() => onPage(pagination.offset + pagination.limit)}>Next</button>
      </div>
    </div>
  );
}

/**
 * Owner/Admin automation preview. Other roles see the boundary and never call
 * the endpoint; the server still enforces it if they do.
 */
export function AutomationPreviewPanel({ viewer, runPreview }: {
  viewer: Viewer | null;
  runPreview: (params: { asOfDate: string | null; offset: number; limit: number }) => Promise<ApiResult<CollectionsAutomationPreviewResponse>>;
}) {
  const [asOfDate, setAsOfDate] = useState("");
  const [result, setResult] = useState<ApiResult<CollectionsAutomationPreviewResponse> | null>(null);
  const [pending, setPending] = useState(false);

  if (!viewerIsPowerUser(viewer)) return <p style={hintStyle}><OwnerAdminOnly action="The automation preview" /></p>;

  async function run(offset: number) {
    setPending(true);
    setResult(await runPreview({ asOfDate: asOfDate || null, offset, limit: PREVIEW_PAGE }));
    setPending(false);
  }

  return (
    <div>
      <p style={hintStyle}>See which reminders and reviews the ladder would propose. This never sends anything; delivery is disabled.</p>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label style={{ fontSize: 13 }}>
          <span style={{ display: "block", color: "var(--muted)", fontSize: 12 }}>As of (optional)</span>
          <input type="date" value={asOfDate} onChange={(event) => setAsOfDate(event.target.value)} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "6px 8px" }} />
        </label>
        <button type="button" style={{ ...buttonStyle, opacity: pending ? 0.6 : 1 }} disabled={pending} onClick={() => run(0)}>
          {pending ? "Building preview…" : "Run preview"}
        </button>
      </div>
      {result && result.ok === false ? <ErrorBanner kind={result.kind} message={result.message} code={result.code} /> : null}
      {result && result.ok === true ? <PreviewResults preview={result.data} onPage={(offset) => run(offset)} /> : null}
    </div>
  );
}
