"use client";

import { useState, type ReactNode } from "react";
import type { ApiResult } from "@/lib/billing-ui/api";
import type { CollectionsAccount, CollectionsAutomationPreviewResponse, CollectionsReceivablesResponse } from "@/lib/collections-api";
import type { CollectionRule, Viewer } from "@/lib/billing-ui/types";
import { DISPOSITION_LABELS, formatMoney, nextStepText, PREVIEW_REASON_LABELS, stageLabel, STAGE_LABELS, viewerIsPowerUser, type StageLabels } from "@/lib/billing-ui/view-model";
import { ErrorBanner, OwnerAdminOnly } from "./ui";
import { LastTouch, PreviewAttemptNote } from "./delivery-panels";
import type { LastDelivery, PreviewDeliveryAttempt } from "@/lib/billing-ui/delivery";

const amount = (value: string | number | null | undefined) => Number(value || 0);
const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

function Tile({ testId, label, value, unit, detail, tone }: { testId?: string; label: string; value: string; unit?: string; detail?: string; tone?: "red" | "amber" | "green" }) {
  return (
    <div className="bc-tile" data-summary={testId}>
      <div className="k">{label}</div>
      <div className={`v${tone ? ` bc-${tone}` : ""}`}>{value}{unit ? <small> {unit}</small> : null}</div>
      {detail ? <div className="d">{detail}</div> : null}
    </div>
  );
}

const AGING_BANDS = [
  { key: "current", testId: "aging-current", label: "Current", color: "var(--green)" },
  { key: "days_1_30", testId: "aging-1-30", label: "1–30 days", color: "var(--blue)" },
  { key: "days_31_60", testId: "aging-31-60", label: "31–60 days", color: "var(--amber)" },
  { key: "days_61_90", testId: "aging-61-90", label: "61–90 days", color: "var(--red)" },
  { key: "days_over_90", testId: "aging-90", label: "90+ days", color: "var(--red)" },
] as const;

/** "Not obvious from the report" card, as in the demo. */
function InsightCard({ head, children, action, testId }: { head: string; children: ReactNode; action: string; testId: string }) {
  return (
    <div className="bc-inscard" data-insight={testId}>
      <div className="bc-eyebrow">Not obvious from the report</div>
      <div className="ins-h">{head}</div>
      <div className="ins-b">{children}</div>
      <div className="ins-a"><span>&rarr;</span> {action}</div>
    </div>
  );
}

/** AR insights from the server's Collections read model. Totals are the server's; only shares are derived here. */
export function WorklistSummary({ worklist, minimumBalance = null }: { worklist: CollectionsReceivablesResponse; minimumBalance?: string | null }) {
  const { summary, accounts, pagination } = worklist;
  const gross = amount(summary.gross_open_balance);
  const recent = amount(summary.aging.current) + amount(summary.aging.days_1_30);
  const over30 = amount(summary.aging.days_31_60) + amount(summary.aging.days_61_90) + amount(summary.aging.days_over_90);
  const over90 = amount(summary.aging.days_over_90);
  const pastDue = gross - amount(summary.aging.current);
  const partial = pagination.total_accounts > accounts.length;
  // Concentration: the fewest accounts (largest first) that hold half the open balance.
  const byBalance = [...accounts].sort((a, b) => amount(b.gross_open_balance) - amount(a.gross_open_balance));
  let running = 0;
  let top = 0;
  for (const account of byBalance) {
    if (running >= gross / 2) break;
    running += amount(account.gross_open_balance);
    top += 1;
  }
  const smallInvoices = accounts.flatMap((account) => account.invoices).filter((invoice) => invoice.below_minimum);
  const smallTotal = smallInvoices.reduce((sum, invoice) => sum + amount(invoice.balance), 0);
  const money = (value: number) => formatMoney(value.toFixed(2));
  return (
    <div>
      <div className="bc-source">
        Reading every issued invoice in <b>TAP Hub Billing</b>, less the payments allocated to it, plus invoices from approved{" "}
        <b>A/R reports</b>. An A/R report is a dated snapshot: if it disagrees with Billing, that invoice waits for review. Ages count
        from each due date. <b>As of {worklist.as_of_date} (firm date).</b>
      </div>
      <div className="bc-tiles">
        <Tile testId="net" label="Net AR outstanding" value={formatMoney(summary.net_ar_estimate)} tone="red" detail={`${summary.owing_accounts} account${summary.owing_accounts === 1 ? "" : "s"} still owe`} />
        <Tile testId="past-due" label="Past due" value={`${percent(pastDue, gross)}%`} tone="red" detail={`${money(pastDue)} of ${formatMoney(summary.gross_open_balance)} is past its due date`} />
        <Tile testId="over-30" label="Over 30 days" value={`${percent(over30, gross)}%`} tone="amber" detail={`${money(over30)} aged past a month`} />
        <Tile testId="over-90" label="Over 90 days" value={formatMoney(summary.aging.days_over_90)} tone="amber" detail={`${percent(over90, gross)}% of AR · danger zone`} />
      </div>
      <div className="bc-insgrid">
        <InsightCard
          testId="concentration"
          head={top > 0 && top < summary.owing_accounts ? `Your ${summary.owing_accounts} accounts are really ${top}.` : "The balance is spread across every account."}
          action={top > 0 ? `Work ${top === 1 ? "this account" : `these ${top}`} first. Half the AR moves before you touch the long tail.` : "Nothing is owed right now."}
        >
          {top > 0 ? <>Just <b>{top} {top === 1 ? "client holds" : "clients hold"} {percent(running, gross)}%</b> of the money ({money(running)}). The call list below is ranked so they come first.</> : <>No open balance.</>}
          {partial ? ` Based on the ${accounts.length} accounts on this page.` : ""}
        </InsightCard>
        <InsightCard
          testId="chronic"
          head={summary.chronic_accounts > 0 ? "Some of it is chronic, not forgetful." : "No chronic accounts yet."}
          action={summary.chronic_accounts > 0 ? "These need a terms or pricing talk, not another reminder." : "Keep the ladder running so it stays that way."}
        >
          <b>{summary.chronic_accounts} account{summary.chronic_accounts === 1 ? " carries" : "s carry"} 3+ unpaid invoices.</b> Repeat balances scatter across an alphabetical list, so the pattern is easy to miss.
        </InsightCard>
        <InsightCard
          testId="backlog"
          head={over30 > recent ? "The problem is the backlog, not new billing." : "Most of it is recent."}
          action={over30 > recent ? "Work the 31+ backlog first; the ladder keeps new invoices from piling up." : "The ladder catches these early, before they age."}
        >
          <span data-summary="gross">Of {formatMoney(summary.gross_open_balance)} open,</span> <b>{money(recent)} ({percent(recent, gross)}%)</b> is within 30 days and <b>{money(over30)} ({percent(over30, gross)}%)</b> is 31+ days.
          <div className="bc-legend" style={{ marginTop: 10 }}>
            {AGING_BANDS.map((band) => (
              <span key={band.key} data-summary={band.testId}><i style={{ background: band.color }} />{band.label} <b style={{ color: "var(--ink)" }}>{formatMoney(summary.aging[band.key])}</b></span>
            ))}
          </div>
        </InsightCard>
        <InsightCard
          testId="oldest"
          head={over90 > 0 ? "The oldest money needs a person." : "Nothing is over 90 days."}
          action={over90 > 0 ? "Escalation calls target the oldest, largest balances first." : "The oldest invoice is still inside the ladder."}
        >
          <b>{formatMoney(summary.aging.days_over_90)} is over 90 days</b> ({percent(over90, gross)}% of AR), and the oldest invoice is <b>{summary.oldest_days_past_due} days</b> past due.
        </InsightCard>
        <InsightCard
          testId="credits"
          head={amount(summary.unallocated_credit) > 0 ? "Part of it is already settled." : "No payments waiting to be applied."}
          action={amount(summary.unallocated_credit) > 0 ? "Apply these in Billing first, so no one who paid gets chased." : "Payments are fully applied in Billing."}
        >
          <b>{formatMoney(summary.unallocated_credit)} in unallocated payments</b> is netted into the total above.
          {summary.credit_review_accounts > 0 ? (
            <div data-credit-review-count style={{ marginTop: 6, color: "var(--gate-ink)" }}>{summary.credit_review_accounts} account{summary.credit_review_accounts === 1 ? " has" : "s have"} unallocated payments to reconcile in Billing. Collections never allocates them.</div>
          ) : null}
        </InsightCard>
        <InsightCard
          testId="small"
          head={smallInvoices.length > 0 ? `${smallInvoices.length} small balance${smallInvoices.length === 1 ? "" : "s"} cost more than they return.` : "No balances under the minimum."}
          action={smallInvoices.length > 0 ? "Batch them into one statement or write them off. Don't spend a call on them." : "Every open invoice is worth a follow-up."}
        >
          <b>{smallInvoices.length} invoice{smallInvoices.length === 1 ? " is" : "s are"} under the {minimumBalance ? formatMoney(minimumBalance) : "minimum"} minimum</b> ({money(smallTotal)} in all). The ladder skips them.
          {partial ? ` Based on the ${accounts.length} accounts on this page.` : ""}
        </InsightCard>
      </div>
    </div>
  );
}

/** Pipeline headline tiles, as in the demo, from the server summary. */
export function PipelineTiles({ worklist, decisions }: { worklist: CollectionsReceivablesResponse; decisions: number }) {
  const { summary } = worklist;
  const gross = amount(summary.gross_open_balance);
  const over90 = amount(summary.aging.days_over_90);
  const pastDue = gross - amount(summary.aging.current);
  return (
    <div className="bc-tiles" data-pipeline-tiles>
      <Tile label="Outstanding today" value={formatMoney(summary.net_ar_estimate)} tone="red" detail={`${summary.owing_accounts} accounts · ${percent(pastDue, gross)}% already past due`} />
      <Tile label="Over 90 days" value={formatMoney(summary.aging.days_over_90)} tone="amber" detail={`${percent(over90, gross)}% of AR · the danger zone`} />
      <Tile label="Chronic accounts" value={String(summary.chronic_accounts)} detail="3+ unpaid invoices each" />
      <Tile label="Waiting on Owner/Admin" value={String(decisions)} tone={decisions > 0 ? "amber" : undefined} detail="escalations and notices to decide" />
      <Tile label="Stops the moment they pay" value="Yes" detail="a paid invoice leaves the ladder at once" />
      <Tile label="Oldest invoice" value={`${summary.oldest_days_past_due}`} unit="days" detail={summary.oldest_days_past_due >= 90 ? "well past the ladder — needs a person" : "still inside the ladder"} />
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
    <details data-score-breakdown={account.client_id} className="bc-details">
      <summary><span className={`bc-pill ${amount(account.call_priority_score) > 0 ? "amber" : "grey"}`}>{formatMoney(account.call_priority_score).replace("$", "")}</span></summary>
      <table className="bc-table sm" style={{ marginTop: 6 }}>
        <tbody>
          {BANDS.map(([key, label]) => {
            const part = components[key];
            if (typeof part !== "object") return null;
            return (
              <tr key={key} data-score-band={key}>
                <td>{label}</td>
                <td className="r">{formatMoney(part.balance)}</td>
                <td className="r">× {part.weight}</td>
                <td className="r">= {formatMoney(part.weighted_amount).replace("$", "")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="bc-small">Balances under {components.score_zero_before_days_past_due} days past due add nothing to the score.</div>
    </details>
  );
}

function Flags({ account }: { account: CollectionsAccount }) {
  if (!account.on_hold && !account.credit_review_required && !account.contact_review_required) return null;
  return (
    <div style={{ marginTop: 4 }}>
      {account.on_hold ? <span data-flag="hold" className="bc-pill amber">Hold</span> : null}
      {account.credit_review_required ? <span data-flag="credit" className="bc-pill blue">Credit to reconcile</span> : null}
      {account.contact_review_required ? <span data-flag="contact" className="bc-pill red">Contact needs review</span> : null}
    </div>
  );
}

/** The configured ladder from GET /api/collections/rules, as one line. */
export function LadderSummary({ rules }: { rules: CollectionRule[] }) {
  if (rules.length === 0) return null;
  return (
    <p data-ladder className="bc-hint">
      Ladder:{" "}
      {rules.map((rule, index) => (
        <span key={rule.stage} data-ladder-stage={rule.stage} style={rule.enabled ? undefined : { textDecoration: "line-through" }}>
          {index > 0 ? " · " : ""}{rule.stage} {rule.label} ({rule.days_past_due}+ days{rule.automatic ? "" : ", Owner/Admin"}{rule.enabled ? "" : ", off"})
        </span>
      ))}
    </p>
  );
}

const isGate = (stage: number) => stage >= 4;

/** The five touches as cards; opening one shows the template wording stored for it. */
export function LadderRungs({ rules }: { rules: CollectionRule[] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (rules.length === 0) return null;
  const selected = rules.find((rule) => rule.stage === open) || null;
  return (
    <div data-ladder-rungs>
      <div className="bc-ladder">
        {rules.map((rule) => (
          <button
            key={rule.stage}
            type="button"
            data-rung={rule.stage}
            aria-expanded={open === rule.stage}
            className={`bc-rung${isGate(rule.stage) ? " gate" : ""}${rule.enabled ? "" : " off"}`}
            onClick={() => setOpen(open === rule.stage ? null : rule.stage)}
          >
            <div className="ln">Touch {rule.stage} · day {rule.days_past_due}{rule.enabled ? "" : " · off"}</div>
            <div className="lt">{rule.label}</div>
            <div className="lw">{isGate(rule.stage) ? "Owner/Admin decision" : rule.automatic ? "Reminder · automatic when enabled" : "Reminder · held for approval"}</div>
            {isGate(rule.stage) ? <span className="bc-gatetag">⚑ Needs Owner/Admin</span> : null}
            <div className="open">{open === rule.stage ? "▾ hide wording" : "▸ read the wording"}</div>
          </button>
        ))}
      </div>
      {selected ? (
        <div className="bc-email" data-rung-template={selected.stage}>
          <div className="es">Touch {selected.stage} · {selected.label} — template as configured in Setup &amp; rules</div>
          {isGate(selected.stage) ? <div className="bc-gatebox">⚑ A person decides this step: it waits for Owner/Admin approval.</div> : null}
          <div className="esub">{selected.subject_template || "No subject set"}</div>
          <pre>{selected.body_template || "No message set."}</pre>
        </div>
      ) : null}
    </div>
  );
}

/** Progression fields come from the server's Collections worklist contract. */
// Phase 3 adds a sanitized `last_delivery` per invoice; absent until the backend ships it.
type WorklistInvoice = CollectionsAccount["invoices"][number] & { last_delivery?: LastDelivery | null };

/** Where an invoice's balance comes from, and whether a source difference is blocking it (Phase 4). */
export function SourceNote({ invoice }: { invoice: Pick<WorklistInvoice, "source" | "source_as_of" | "discrepancy_status"> }) {
  if (invoice.source !== "pdf_import" && invoice.discrepancy_status !== "blocked") return null;
  return (
    <div data-invoice-source={invoice.source} data-discrepancy={invoice.discrepancy_status}>
      {invoice.source === "pdf_import" ? <span className="bc-pill blue">From A/R report{invoice.source_as_of ? ` · as of ${invoice.source_as_of}` : ""}</span> : null}
      {invoice.discrepancy_status === "blocked" ? <span className="bc-pill red">Balances differ: review in A/R reports</span> : null}
    </div>
  );
}

function Pager({ first, last, total, onPrevious, onNext, previousDisabled, nextDisabled, testId }: {
  first: number; last: number; total: number; onPrevious: () => void; onNext: () => void; previousDisabled: boolean; nextDisabled: boolean; testId?: string;
}) {
  return (
    <div className="bc-pager">
      <span data-worklist-range={testId ? "" : undefined}>Showing {first}–{last} of {total}</span>
      <button type="button" className="bc-btn quiet" disabled={previousDisabled} onClick={onPrevious}>Previous</button>
      <button type="button" className="bc-btn quiet" disabled={nextDisabled} onClick={onNext}>Next</button>
    </div>
  );
}

/** The call list, in the demo's "where to focus first" table: accounts ranked by the server's priority score. */
export function WorklistTable({ worklist, onSelectClient, onPage, stageLabels = STAGE_LABELS, rules = [], firmTimezone = "America/Chicago", selectedClientId = null }: {
  worklist: CollectionsReceivablesResponse;
  onSelectClient: (clientId: string) => void;
  onPage: (offset: number) => void;
  stageLabels?: StageLabels;
  rules?: CollectionRule[];
  firmTimezone?: string;
  selectedClientId?: string | null;
}) {
  const { accounts, pagination } = worklist;
  if (accounts.length === 0) return <p className="bc-hint">No accounts owe money or have credit to review.</p>;
  const first = pagination.offset + 1;
  const last = pagination.offset + accounts.length;
  return (
    <div>
      <div className="bc-scroll">
        <table className="bc-table">
          <thead>
            <tr>
              <th>Client</th>
              <th className="r">Balance</th>
              <th className="r">Oldest</th>
              <th className="r">Open</th>
              <th className="r">Priority</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => (
              <tr key={account.client_id} data-worklist-account={account.client_id} className={selectedClientId === account.client_id ? "on" : undefined}>
                <td>
                  <button type="button" className="bc-name" onClick={() => onSelectClient(account.client_id)}>{account.client_name}</button>
                  <div className="bc-small">
                    {account.contact_name || "No primary contact"}
                    {account.contact_phone ? ` · ${account.contact_phone}` : ""}
                    {account.contact_email ? ` · ${account.contact_email}` : ""}
                  </div>
                  {amount(account.unallocated_credit) > 0 ? <div className="bc-small">{formatMoney(account.unallocated_credit)} unallocated credit</div> : null}
                  <Flags account={account} />
                </td>
                <td className="r bc-red">{formatMoney(account.gross_open_balance)}</td>
                <td className={`r${account.oldest_days_past_due >= 90 ? " old" : account.oldest_days_past_due > 0 ? " late" : ""}`}>{account.oldest_days_past_due}d</td>
                <td className="r">
                  <details className="bc-details">
                    <summary>{account.open_invoice_count} open</summary>
                    <table className="bc-table sm" style={{ marginTop: 6, textAlign: "left" }}>
                      <thead>
                        <tr>
                          <th>Invoice</th>
                          <th>Due</th>
                          <th className="r">Balance</th>
                          <th className="r">Days</th>
                          <th>Next step</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(account.invoices as WorklistInvoice[]).map((invoice) => (
                          <tr key={invoice.row_key || invoice.invoice_id} data-worklist-invoice={invoice.invoice_id ?? invoice.source_invoice_id ?? undefined} data-row-key={invoice.row_key} data-next-stage={invoice.next_stage ?? ""} data-awaiting={invoice.awaiting_approval ? invoice.awaiting_approval.stage : undefined}>
                            <td className="bc-nowrap">{invoice.invoice_number}<SourceNote invoice={invoice} /></td>
                            <td className="bc-nowrap">{invoice.due_date}</td>
                            <td className="r">{formatMoney(invoice.balance)}</td>
                            <td className="r">{invoice.days_past_due}</td>
                            <td>
                              <span style={invoice.awaiting_approval ? { color: "var(--gate-ink)" } : undefined}>{nextStepText(invoice, rules, stageLabels, firmTimezone)}</span>
                              {invoice.on_hold ? <div style={{ color: "var(--gate-ink)" }}>On hold</div> : null}
                              {invoice.below_minimum ? <div className="bc-muted">Below minimum</div> : null}
                              <LastTouch delivery={invoice.last_delivery} stageLabels={stageLabels} firmTimezone={firmTimezone} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                </td>
                <td className="r"><ScoreBreakdown account={account} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager
        testId="worklist"
        first={first}
        last={last}
        total={pagination.total_accounts}
        previousDisabled={pagination.offset === 0}
        nextDisabled={last >= pagination.total_accounts}
        onPrevious={() => onPage(Math.max(0, pagination.offset - pagination.limit))}
        onNext={() => onPage(pagination.offset + pagination.limit)}
      />
    </div>
  );
}

/** Pipeline banner: the outstanding total and what the ladder does about it. */
export function PipelineBanner({ worklist }: { worklist: CollectionsReceivablesResponse }) {
  const { summary } = worklist;
  return (
    <div className="bc-banner" data-pipeline-banner>
      <div className="big">{formatMoney(summary.net_ar_estimate)}<small>net AR outstanding · oldest invoice {summary.oldest_days_past_due} days past due</small></div>
      <div className="msg">
        Every overdue invoice is placed on the follow-up ladder below by its age. <b>Automation and email delivery are off</b>:
        each touch is logged by a person, and touches 4 and 5 always wait for <b>Owner/Admin approval</b>.
      </div>
    </div>
  );
}

/** Groups this page's overdue invoices by the ladder touch their age has reached. */
export function MoneyByStage({ worklist, rules }: { worklist: CollectionsReceivablesResponse; rules: CollectionRule[] }) {
  const ladder = rules.filter((rule) => rule.enabled).sort((a, b) => a.days_past_due - b.days_past_due || a.stage - b.stage);
  if (ladder.length === 0) return null;
  const bands = ladder.map((rule, index) => ({ rule, until: ladder[index + 1]?.days_past_due ?? null, total: 0, count: 0 }));
  for (const invoice of worklist.accounts.flatMap((account) => account.invoices)) {
    if (invoice.days_past_due <= 0) continue;
    const band = [...bands].reverse().find((candidate) => candidate.rule.days_past_due <= invoice.days_past_due);
    if (!band) continue;
    band.total += amount(invoice.balance);
    band.count += 1;
  }
  const max = Math.max(...bands.map((band) => band.total), 0);
  const reminders = bands.filter((band) => !isGate(band.rule.stage)).reduce((sum, band) => sum + band.total, 0);
  const decisions = bands.filter((band) => isGate(band.rule.stage)).reduce((sum, band) => sum + band.total, 0);
  const partial = worklist.pagination.total_accounts > worklist.accounts.length;
  return (
    <section className="bc-card" aria-label="Where the money sits" data-money-by-stage>
      <div className="bc-head" style={{ marginBottom: 14 }}>
        <h3 className="bc-sect">Where the money sits in the ladder</h3>
        <div>
          <span className="bc-pill navy">Reminders {formatMoney(reminders.toFixed(2))}</span>
          <span className="bc-pill amber">Owner/Admin decisions {formatMoney(decisions.toFixed(2))} · {percent(decisions, reminders + decisions)}%</span>
        </div>
      </div>
      {bands.map((band) => (
        <div key={band.rule.stage} data-stage-band={band.rule.stage} style={{ display: "grid", gridTemplateColumns: "minmax(110px,132px) 1fr auto minmax(70px,96px) 44px", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--line2)" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 12.5 }}>Day {band.rule.days_past_due}{band.until ? `–${band.until - 1}` : "+"}</div>
            <div style={{ fontSize: 10.5, color: "var(--muted)" }}>{band.rule.label}</div>
          </div>
          <div style={{ background: "var(--line2)", borderRadius: 6, height: 12, overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: 6, width: `${max ? Math.max(band.total ? 1.5 : 0, (band.total / max) * 100) : 0}%`, background: isGate(band.rule.stage) ? "var(--amber)" : "var(--navy)" }} />
          </div>
          <span className={`bc-pill ${isGate(band.rule.stage) ? "amber" : "navy"}`}>{isGate(band.rule.stage) ? "Needs you" : "Reminder"}</span>
          <div className="r" style={{ textAlign: "right", fontWeight: 700, fontSize: 13 }}>{band.total ? formatMoney(band.total.toFixed(2)) : "—"}</div>
          <div style={{ textAlign: "right", fontSize: 11, color: "var(--faint)" }}>{band.count} inv</div>
        </div>
      ))}
      <p className="bc-foot">
        Each overdue invoice sits at the last touch its age has reached. Touches 4 and 5 always come to an Owner or Admin.
        {partial ? ` Covers the ${worklist.accounts.length} accounts on this page of the call list.` : ""}
      </p>
    </section>
  );
}

/** "Who's where": every open invoice on this page and the step it is at today. */
export function WhoIsWhere({ worklist, rules = [], stageLabels = STAGE_LABELS, firmTimezone = "America/Chicago", onSelectClient }: {
  worklist: CollectionsReceivablesResponse;
  rules?: CollectionRule[];
  stageLabels?: StageLabels;
  firmTimezone?: string;
  onSelectClient: (clientId: string) => void;
}) {
  const rows = worklist.accounts
    .flatMap((account) => (account.invoices as WorklistInvoice[]).map((invoice) => ({ account, invoice })))
    .filter(({ invoice }) => invoice.days_past_due > 0)
    .sort((a, b) => amount(b.invoice.balance) - amount(a.invoice.balance));
  return (
    <section className="bc-card" aria-label="Who's where" data-who-is-where>
      <h3 className="bc-h">Who&rsquo;s where <small>overdue invoices on this page, by balance</small></h3>
      {rows.length === 0 ? <p className="bc-hint">No overdue invoices.</p> : (
        <div className="bc-scroll">
          <table className="bc-table">
            <thead><tr><th>Client</th><th>Invoice</th><th className="r">Outstanding</th><th className="r">Past due</th><th>Step today</th><th className="r">Who acts</th></tr></thead>
            <tbody>
              {rows.map(({ account, invoice }) => {
                const gate = Boolean(invoice.awaiting_approval) || (invoice.next_stage ?? 0) >= 4;
                return (
                  <tr key={invoice.row_key || invoice.invoice_id} data-who-row={invoice.invoice_id ?? invoice.source_invoice_id ?? undefined} data-row-key={invoice.row_key}>
                    <td><button type="button" className="bc-name" onClick={() => onSelectClient(account.client_id)}>{account.client_name}</button></td>
                    <td>{invoice.invoice_number}<SourceNote invoice={invoice} /></td>
                    <td className="r bc-red">{formatMoney(invoice.balance)}</td>
                    <td className={`r${invoice.days_past_due >= 90 ? " old" : ""}`}>{invoice.days_past_due}d</td>
                    <td>{nextStepText(invoice, rules, stageLabels, firmTimezone)}{invoice.on_hold ? <span className="bc-pill amber" style={{ marginLeft: 6 }}>Hold</span> : null}<LastTouch delivery={invoice.last_delivery} stageLabels={stageLabels} firmTimezone={firmTimezone} /></td>
                    <td className="r"><span className={`bc-pill ${gate ? "amber" : "navy"}`}>{gate ? "Owner/Admin" : "Staff"}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const PREVIEW_PAGE = 50;

export function PreviewResults({ preview, onPage, stageLabels = STAGE_LABELS }: { preview: CollectionsAutomationPreviewResponse; onPage: (offset: number) => void; stageLabels?: StageLabels }) {
  const { actions, pagination } = preview;
  return (
    <div>
      <div data-preview-safety role="note" className="bc-source" style={{ margin: "12px 0" }}>
        Preview only, as of {preview.as_of_date}. Automation is {preview.automation_enabled ? "on" : "off"} and delivery is {preview.delivery_mode}. Nothing was sent.
      </div>
      {actions.length === 0 ? <p className="bc-hint">No actions are due.</p> : (
        <div className="bc-scroll">
          <table className="bc-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Invoice</th>
                <th className="r">Balance</th>
                <th className="r">Days</th>
                <th>Step</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {actions.map((action) => (
                <tr key={`${action.row_key || action.invoice_id}-${action.stage}`} data-preview-action={action.invoice_id ?? action.source_invoice_id ?? undefined} data-row-key={action.row_key} data-disposition={action.disposition}>
                  <td>
                    {action.client_name}
                    {action.contact_phone ? <div className="bc-small">{action.contact_phone}</div> : null}
                  </td>
                  <td>{action.invoice_number}<SourceNote invoice={action} /></td>
                  <td className="r">{formatMoney(action.balance)}</td>
                  <td className="r">{action.days_past_due}</td>
                  <td>{stageLabel(action.stage, stageLabels)}</td>
                  <td>
                    <span className={`bc-pill ${action.disposition === "suppressed" ? "grey" : action.disposition === "approval_required" ? "amber" : "navy"}`}>{DISPOSITION_LABELS[action.disposition] || action.disposition}</span>
                    {action.suppression_reasons.map((reason) => <div key={reason} data-suppression={reason} className="bc-small">{PREVIEW_REASON_LABELS[reason] || reason}</div>)}
                    {action.review_warnings.map((warning) => <div key={warning} data-warning={warning} className="bc-small">Note: {PREVIEW_REASON_LABELS[warning] || warning}</div>)}
                    <PreviewAttemptNote attempt={(action as { delivery_attempt?: PreviewDeliveryAttempt | null }).delivery_attempt} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="bc-pager">
        <span>{pagination.total_actions} action{pagination.total_actions === 1 ? "" : "s"} in total</span>
        <button type="button" className="bc-btn quiet" disabled={pagination.offset === 0} onClick={() => onPage(Math.max(0, pagination.offset - pagination.limit))}>Previous</button>
        <button type="button" className="bc-btn quiet" disabled={!pagination.has_more} onClick={() => onPage(pagination.offset + pagination.limit)}>Next</button>
      </div>
    </div>
  );
}

/**
 * Owner/Admin automation preview. Other roles see the boundary and never call
 * the endpoint; the server still enforces it if they do.
 */
export function AutomationPreviewPanel({ viewer, runPreview, stageLabels = STAGE_LABELS }: {
  viewer: Viewer | null;
  stageLabels?: StageLabels;
  runPreview: (params: { asOfDate: string | null; offset: number; limit: number }) => Promise<ApiResult<CollectionsAutomationPreviewResponse>>;
}) {
  const [asOfDate, setAsOfDate] = useState("");
  const [result, setResult] = useState<ApiResult<CollectionsAutomationPreviewResponse> | null>(null);
  const [pending, setPending] = useState(false);

  if (!viewerIsPowerUser(viewer)) return <p className="bc-hint"><OwnerAdminOnly action="The automation preview" /></p>;

  async function run(offset: number) {
    setPending(true);
    setResult(await runPreview({ asOfDate: asOfDate || null, offset, limit: PREVIEW_PAGE }));
    setPending(false);
  }

  return (
    <div>
      <p className="bc-hint">See which reminders and reviews the ladder would propose on any date. This never sends anything; delivery is disabled.</p>
      <div className="bc-inline" style={{ alignItems: "flex-end" }}>
        <label className="bc-field" style={{ margin: 0 }}>
          <span>As of (optional)</span>
          <input type="date" className="bc-in" value={asOfDate} onChange={(event) => setAsOfDate(event.target.value)} />
        </label>
        <button type="button" className="bc-btn" disabled={pending} onClick={() => run(0)}>
          {pending ? "Building preview…" : "Run preview"}
        </button>
      </div>
      {result && result.ok === false ? <ErrorBanner kind={result.kind} message={result.message} code={result.code} /> : null}
      {result && result.ok === true ? <PreviewResults preview={result.data} onPage={(offset) => run(offset)} stageLabels={stageLabels} /> : null}
    </div>
  );
}
