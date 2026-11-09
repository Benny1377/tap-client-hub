"use client";

import { useState } from "react";
import type { CollectionRule } from "@/lib/billing-ui/types";
import type { CollectionsReceivablesResponse } from "@/lib/collections-api";
import { arStats, biggerPicture, dayMonth, dollars, isGateStage, ladderOf, n, pct } from "@/lib/billing-ui/ar-insights";

const whenLabel = (days: number) => (days < 0 ? `${Math.abs(days)} days before due` : days === 0 ? "on the due date" : days === 1 ? "1 day past due" : `${days} days past due`);

/** The top of the Pipeline tab from the PracticeOps design: the problem today, six figures, and where the money sits. */
export function PipelineOverview({ book, rules }: { book: CollectionsReceivablesResponse; rules: CollectionRule[] }) {
  const stats = arStats(book, rules);
  const picture = biggerPicture(stats);
  const oldest = book.summary.oldest_days_past_due;
  const ladder = ladderOf(rules);
  const invoices = book.accounts.flatMap((account) => account.invoices);
  const stages = ladder.map((rule, index) => {
    const low = rule.days_past_due, high = ladder[index + 1] ? ladder[index + 1].days_past_due - 1 : Infinity;
    const inBand = invoices.filter((invoice) => invoice.days_past_due >= low && invoice.days_past_due <= high);
    return { rule, band: Number.isFinite(high) ? `Day ${low}–${high}` : `Day ${low}+`, auto: !isGateStage(rule.stage), count: inBand.length, amount: inBand.reduce((sum, invoice) => sum + n(invoice.balance), 0) };
  });
  const pAuto = stages.filter((stage) => stage.auto).reduce((sum, stage) => sum + stage.amount, 0);
  const pYou = stages.filter((stage) => !stage.auto).reduce((sum, stage) => sum + stage.amount, 0);
  const notDue = stats.tot - pAuto - pYou;
  const max = Math.max(1, ...stages.map((stage) => stage.amount));
  return (
    <div data-pipeline-overview>
      <div className="hero warn" style={{ marginBottom: 18 }} data-pipeline-banner>
        <div><div className="hn num">{dollars(stats.net)}</div><div className="hs">outstanding · some {oldest} days old</div></div>
        <div className="ht">This is the problem today: roughly <b>{dollars(stats.net)}</b> sitting uncollected, the oldest {oldest} days old — because a working practice can&apos;t keep up with the constant, consistent follow-up it takes to collect. The engine below does that relentless part automatically.</div>
      </div>
      <div className="g3" style={{ marginBottom: 18 }} data-pipeline-tiles>
        <div className="stat"><div className="k">Outstanding today</div><div className="v num" style={{ color: "var(--red)" }}>{dollars(stats.net)}</div><div className="d">{stats.owe.length} accounts owe the firm</div></div>
        <div className="stat"><div className="k">Over 90 days</div><div className="v num" style={{ color: "var(--amber)" }}>{dollars(stats.d90)}</div><div className="d">{pct(stats.d90, stats.tot)}% of AR · the danger zone</div></div>
        <div className="stat"><div className="k">Chronic accounts</div><div className="v num">{picture.chronic}</div><div className="d">3+ unpaid invoices · {dollars(picture.chronicTotal)}</div></div>
        <div className="stat"><div className="k">Staff time to run it</div><div className="v num">$0<span style={{ fontSize: 14, color: "var(--muted)" }}> / mo</span></div><div className="d">every reminder sent in the firm&apos;s name</div></div>
        <div className="stat"><div className="k">Stops the moment they pay</div><div className="v num">Yes</div><div className="d">a payment placed in Billing takes them off the ladder</div></div>
        <div className="stat"><div className="k">Oldest invoice</div><div className="v num">{oldest}<span style={{ fontSize: 14, color: "var(--muted)" }}> days</span></div><div className="d">no follow-up behind it until now</div></div>
      </div>
      {stages.length ? (
        <div className="card cx-pipe" data-money-by-stage>
          <h3>Where the money sits in the ladder<span><span className="chip c-brand">Automated handles {dollars(pAuto)}</span> <span className="chip c-amber">Your attention: {dollars(pYou)} · {pct(pYou, pAuto + pYou)}%</span></span></h3>
          {stages.map((stage) => (
            <div key={stage.rule.stage} className="cx-stage" data-stage-band={stage.rule.stage}>
              <div><b>{stage.band}</b><div className="sub">{stage.rule.label}</div></div>
              <div className="cx-bar"><i className={stage.auto ? "" : "you"} style={{ width: `${stage.amount ? Math.max(1.5, (stage.amount / max) * 100) : 0}%` }} /></div>
              <span className={`chip ${stage.auto ? "c-brand" : "c-amber"}`}>{stage.auto ? "Automated" : "Needs you"}</span>
              <b className="num" style={{ textAlign: "right" }}>{stage.amount ? dollars(stage.amount) : "—"}</b>
              <span className="sub" style={{ textAlign: "right" }}>{stage.count} inv</span>
            </div>
          ))}
          <p className="fine" style={{ border: "none", marginTop: 10, paddingTop: 0 }}>{dollars(stats.tot)} across {invoices.length} open invoices{notDue > 0.5 ? ` (${dollars(notDue)} not yet due)` : ""}, less {dollars(-stats.credits)} in credits = <b>{dollars(stats.net)} net AR</b>. The ladder clears everything under {stats.cut} days on its own; the agent hands you only the {stats.cut}+ accounts — ranked for you in <b>AR Insights</b>.</p>
        </div>
      ) : null}
    </div>
  );
}

/** The five-touch ladder from the design. Opening a touch shows its stored wording, filled in for the top account. */
export function FiveTouchLadder({ book, rules }: { book: CollectionsReceivablesResponse; rules: CollectionRule[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const ladder = ladderOf(rules);
  if (!ladder.length) return null;
  const stats = arStats(book, rules);
  const top = stats.calls[0] || stats.owe[0] || null;
  const invoice = top?.invoices[0] || null;
  const fill = (text: string) => {
    if (!top) return text;
    const values: Record<string, string> = {
      contact: (top.contact_name || "there").split(" ")[0], contact_name: top.contact_name || "there", amount: dollars(n(top.net_ar_estimate)), balance: invoice ? dollars(n(invoice.balance)) : dollars(n(top.net_ar_estimate)),
      client: top.client_name, client_name: top.client_name, invoice: invoice?.invoice_number || "", invoice_number: invoice?.invoice_number || "",
      due: invoice ? dayMonth(invoice.due_date, true) : "", due_date: invoice ? dayMonth(invoice.due_date, true) : "", days: String(top.oldest_days_past_due), days_past_due: String(invoice?.days_past_due ?? top.oldest_days_past_due),
    };
    return text.replace(/\{\{?\s*([a-z_]+)\s*\}?\}/g, (whole, key: string) => values[key] ?? whole);
  };
  const selected = ladder.find((rule) => rule.stage === open) || null;
  return (
    <div data-ladder-rungs>
      <h3 style={{ fontFamily: "var(--f-disp)", fontSize: 17, margin: "20px 0 4px" }}>The five-touch ladder</h3>
      <p style={{ fontSize: 12.5, color: "var(--muted)" }}>Click any touch to read the exact wording that goes out{top ? <> — shown here for {top.client_name}</> : null}.</p>
      <div className="ladder">
        {ladder.map((rule) => {
          const gate = isGateStage(rule.stage);
          return (
            <button key={rule.stage} type="button" className={`rung${gate ? " gate" : ""}`} data-rung={rule.stage} aria-expanded={open === rule.stage} onClick={() => setOpen(open === rule.stage ? null : rule.stage)}>
              <span className="rn">Touch {rule.stage} · {whenLabel(rule.days_past_due)}</span>
              <span className="rt">{rule.label}</span>
              <span className="rw">{gate ? "Human decision point" : "Sent automatically"}</span>
              {gate ? <span className="chip c-amber" style={{ marginTop: 9 }}>&#9873; Needs the owner</span> : null}
              <span className="ro2">{open === rule.stage ? "▾ hide the wording" : "▸ read the email"}</span>
            </button>
          );
        })}
      </div>
      {selected ? (
        <div className="email" data-rung-template={selected.stage}>
          <div className="es">Touch {selected.stage} · {selected.label} — sent over the firm&apos;s name to <b>{top?.client_name || "the client"}</b></div>
          {isGateStage(selected.stage) ? <div className="po-note amber" style={{ display: "inline-flex", margin: "6px 0 12px" }}><span className="ni">&#9873;</span><div>This step is a human gate. The agent stops here and hands the account to an Owner or Admin.</div></div> : null}
          <div className="esub">{fill(selected.subject_template || "No subject set")}</div>
          <pre>{fill(selected.body_template || "No message set.")}</pre>
        </div>
      ) : null}
    </div>
  );
}
