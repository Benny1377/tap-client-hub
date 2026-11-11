"use client";

import { Fragment, useEffect, useState } from "react";
import type { BillingApi } from "@/lib/billing-ui/api";
import type { CollectionRule } from "@/lib/billing-ui/types";
import type { CollectionsReceivablesResponse } from "@/lib/collections-api";
import { andList, arStats, asOfDate, biggerPicture, dayMonth, dollars, hasBillingInvoices, hasLateCounts, isPaidInvoice, lateTone, mergePages, n, net, nextTouch, noteCountOf, pct, reminderDays, rungChip, sharedContact, sortAccounts, tier, type Account, type SortKey } from "@/lib/billing-ui/ar-insights";
import { CallNotes } from "./call-notes";

const PAGE = 200;

/** Reads every page of the call list, because the insights and "Who's where" cover the whole book. */
export function useWholeBook(api: BillingApi, clientId: string | null, version: number) {
  const [book, setBook] = useState<CollectionsReceivablesResponse | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    (async () => {
      const pages: CollectionsReceivablesResponse[] = [];
      for (let offset = 0; offset < 10000; offset += PAGE) {
        const result = await api.worklist({ clientId, limit: PAGE, offset });
        if (!current) return;
        if (result.ok === false) { setFailed(result.message); return; }
        pages.push(result.data);
        if (offset + PAGE >= result.data.pagination.total_accounts) break;
      }
      if (current) { setBook(mergePages(pages)); setFailed(null); }
    })();
    return () => { current = false; };
  }, [api, clientId, version]);
  return { book, failed };
}

function Phone({ phone }: { phone: string | null }) {
  return phone
    ? <a className="lnk" style={{ whiteSpace: "nowrap", textDecoration: "underline" }} href={`tel:${phone.replace(/[^0-9+]/g, "")}`} onClick={(event) => event.stopPropagation()}>{phone}</a>
    : <span style={{ color: "var(--red)", fontSize: 11.5, fontWeight: 600 }}>&#9888; no phone</span>;
}

function ContactLine({ account }: { account: Account }) {
  if (!account.contact_name) return <span style={{ color: "var(--red)", fontWeight: 600 }}>&#9888; no contact on file</span>;
  return <>{account.contact_name}{account.contact_email ? ` · ${account.contact_email}` : <> · <span style={{ color: "var(--red)" }}>no email</span></>}</>;
}

function Fact({ value, text }: { value: string | number; text: string }) {
  return (
    <div className="legrow" style={{ justifyContent: "flex-start", gap: 14 }}>
      <b className="num" style={{ fontFamily: "var(--f-disp)", fontSize: 18, minWidth: 90, textAlign: "right", color: "var(--brand)" }}>{value}</b>
      <span style={{ color: "var(--muted)" }}>{text}</span>
    </div>
  );
}

export type CallNotesProps = { api: BillingApi; counts: Map<string, number>; firmTimezone: string; onAdded: () => void };

/** AR Insights, as in the PracticeOps design. */
export function ArInsights({ book, rules, notes }: { book: CollectionsReceivablesResponse; rules: CollectionRule[]; notes?: CallNotesProps }) {
  const [notesOpen, setNotesOpen] = useState<string | null>(null);
  const stats = arStats(book, rules);
  const { cut, owe } = stats;
  const recs = stats.calls.slice(0, 15);
  const pair = sharedContact(owe);
  const picture = biggerPicture(stats);
  const reminders = reminderDays(rules).join(" / ");
  const gaps = recs.filter((account) => !account.contact_phone);
  const asOf = dayMonth(asOfDate(book), true);
  return (
    <div data-ar-insights>
      <div className="po-note brand"><span className="ni">&#8635;</span><div><b>Reading two places, never both for the same account.</b> Clients billed in PracticeOps come straight from Billing&apos;s ledger, live. The rest of the book comes from the <b>aging report</b> imported from the accounting system each week, so the agent always works the freshest balance. As of <b>{asOf}</b>.</div></div>

      <div className="card" style={{ marginBottom: 16, background: "linear-gradient(180deg,var(--brand-soft),var(--card) 60%)" }} data-next-two-hours>
        <h3 style={{ fontFamily: "var(--f-disp)", fontSize: 19, fontWeight: 600, color: "var(--brand-ink)" }}>Where your next two hours pay off</h3>
        <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "-6px 0 14px", lineHeight: 1.55 }}>Under {cut} days the reminders handle it. These accounts are worth a call — ranked by dollars, weighted for age. Here&apos;s what clearing them does to your {dollars(stats.net)}:</p>
        <div className="g2" style={{ marginBottom: 14 }}>
          <div className="po-note brand" style={{ margin: 0, display: "block" }} data-ladder-handles>
            <b>&#10003; The ladder handles it — don&apos;t worry</b>
            <div style={{ fontFamily: "var(--f-disp)", fontSize: 22, fontWeight: 600, color: "var(--ink)", margin: "4px 0" }}>{dollars(stats.auto)} <span style={{ fontSize: 13, color: "var(--muted)" }}>· {pct(stats.auto, stats.tot)}%</span></div>
            under {cut} days — the automated reminders clear these on their own
          </div>
          <div className="po-note amber" style={{ margin: 0, display: "block" }} data-team-calls>
            <b>&#9742; Your team calls — or an AI agent</b>
            <div style={{ fontFamily: "var(--f-disp)", fontSize: 22, fontWeight: 600, color: "var(--ink)", margin: "4px 0" }}>{dollars(stats.you)} <span style={{ fontSize: 13, color: "var(--muted)" }}>· {pct(stats.you, stats.tot)}%</span></div>
            {cut}+ days, already past the reminders — needs a person
          </div>
        </div>
        <div className="g3">
          {[10, 20, 30].map((count) => {
            const t = tier(stats, count);
            return (
              <div key={count} className="stat" data-tier={count}>
                <div className="k">Call the top {count}</div>
                <div className="v num" style={{ color: "var(--green)" }}>+{dollars(t.got)}</div>
                <div className="d">{t.share}% of AR · drops it to {dollars(t.after)}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }} data-call-list>
        <h3>Your call list — work it top down<span>contact, phone and email from the client list</span></h3>
        {pair ? (
          <div className="po-note amber" data-one-call><span className="ni">&#9742;</span><div><b>One call covers {pair.length}:</b> {pair[0].contact_name} is the contact for {andList(pair.map((account) => `${account.client_name} (${dollars(net(account))})`))} — {dollars(pair.reduce((sum, account) => sum + net(account), 0))} in a single conversation.</div></div>
        ) : null}
        <div className="scroll">
          <table>
            <thead><tr><th /><th>Client &amp; contact</th><th>Phone</th><th className="r">Outstanding</th><th className="r">Past due</th><th className="r">Open</th><th className="r">Annual value</th>{notes ? <th>Notes</th> : null}</tr></thead>
            <tbody>
              {recs.map((account, index) => {
                const count = notes ? noteCountOf(account, notes.counts) : 0;
                const opened = notesOpen === account.client_id;
                return (
                <Fragment key={account.client_id}>
                <tr data-call-row={account.client_id}>
                  <td style={{ color: "var(--faint)", fontWeight: 700 }}>{index + 1}</td>
                  <td><b>{account.client_name}</b><div className="sub"><ContactLine account={account} /></div></td>
                  <td><Phone phone={account.contact_phone} /></td>
                  <td className="r num">{dollars(net(account))}</td>
                  <td className="r num" style={account.oldest_days_past_due >= 90 ? { color: "var(--amber)", fontWeight: 600 } : undefined}>{account.oldest_days_past_due}d</td>
                  <td className="r num">{account.open_invoice_count}</td>
                  <td className="r num" style={{ color: "var(--faint)" }}>—</td>
                  {notes ? (
                    <td>
                      <button type="button" className="lnk" data-notes-toggle={account.client_id} aria-expanded={opened} aria-label={`${count ? `${count} note${count === 1 ? "" : "s"}` : "No notes"} for ${account.client_name}. ${opened ? "Hide" : "Show"} notes`} onClick={() => setNotesOpen(opened ? null : account.client_id)} style={{ whiteSpace: "nowrap", font: "inherit", fontSize: 12.5 }}>
                        {count ? <span className="chip c-brand" data-note-indicator>&#9998; {count}</span> : <span style={{ color: "var(--muted)" }}>+ Note</span>}
                      </button>
                    </td>
                  ) : null}
                </tr>
                {notes && opened ? (
                  <tr data-call-notes-row={account.client_id}>
                    <td />
                    <td colSpan={7} style={{ background: "var(--card2)" }}>
                      <CallNotes api={notes.api} clientId={account.client_id} clientName={account.client_name} firmTimezone={notes.firmTimezone} onAdded={notes.onAdded} />
                    </td>
                  </tr>
                ) : null}
                </Fragment>
                );
              })}
              {recs.length === 0 ? <tr><td colSpan={notes ? 8 : 7} className="sub">Nothing is {cut}+ days past due. The reminders have it.</td></tr> : null}
            </tbody>
          </table>
        </div>
        <p className="fine" style={{ border: "none", marginTop: 10, paddingTop: 0 }}>Annual value reads from Billing for clients billed in PracticeOps; for the rest it fills in once their fees are set up.{gaps.length ? <> <b>Gaps found:</b> {andList(gaps.map((account) => `${account.client_name} has no phone`))} — worth filling before you dial.</> : null}</p>
        <div className="po-note brand" style={{ margin: "10px 0 0" }}><span className="ni">&#8595;</span><div><b>Keep it down going forward:</b> a quick call at day {cut} plus the reminders at day {reminders} keep this list a fraction of the size next quarter — recovery becomes routine, not a fire drill.</div></div>
      </div>

      <h3 style={{ fontFamily: "var(--f-disp)", fontSize: 17, margin: "20px 0 10px" }}>The bigger picture</h3>
      <div className="g4" style={{ marginBottom: 14 }} data-bigger-picture>
        <div className="stat"><div className="k">Net AR outstanding</div><div className="v num" style={{ color: "var(--red)" }}>{dollars(stats.net)}</div><div className="d">{owe.length} accounts still owe</div></div>
        <div className="stat"><div className="k">Past due</div><div className="v num" style={{ color: "var(--red)" }}>{pct(stats.pd, stats.tot)}%</div><div className="d">of open invoices are past their due date</div></div>
        <div className="stat"><div className="k">Over 30 days</div><div className="v num" style={{ color: "var(--amber)" }}>{pct(stats.d30, stats.tot)}%</div><div className="d">{dollars(stats.d30)} aged past the ladder</div></div>
        <div className="stat"><div className="k">Over 90 days</div><div className="v num" style={{ color: "var(--amber)" }}>{dollars(stats.d90)}</div><div className="d">{pct(stats.d90, stats.tot)}% of AR · danger zone</div></div>
      </div>
      <div className="card" data-facts>
        <div className="g2" style={{ gap: "0 24px" }}>
          <Fact value={`${picture.top20Share}%`} text="of your AR is just 20 clients — start there" />
          <Fact value={picture.chronic} text={`chronic accounts (3+ unpaid) = ${dollars(picture.chronicTotal)}`} />
          <Fact value={dollars(-stats.credits)} text="in credits and unapplied payments — some may already be paid" />
          <Fact value={dollars(stats.d90)} text="is 90+ days — the danger zone" />
          <Fact value={picture.stubs} text="tiny stubs (under $150, 120+ days) — write off, don't chase" />
          {/* Report rows only reach Collections once they are linked to a client, so every account here is in the client list. */}
          <Fact value={0} text="accounts on the aging report aren't in the client list" />
        </div>
      </div>
      <p className="fine"><b>No guessed recovery rate.</b> The exposure above is exact, added up from the ledger and the aging report. What comes back depends on the assumption you set — even recovering a third of the {dollars(stats.d90)} over 90 days is about {dollars(stats.d90 / 3)} you weren&apos;t going to see.</p>
    </div>
  );
}

/** "Who's where" from the design: one row per account; a click opens its invoices. */
export function AccountsWhoIsWhere({ book, rules }: { book: CollectionsReceivablesResponse; rules: CollectionRule[] }) {
  const [sort, setSort] = useState<{ key: SortKey; ascending: boolean }>({ key: "score", ascending: false });
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const accounts = sortAccounts(book.accounts, sort.key, sort.ascending);
  // The late-payment column appears once the backend returns the count (Phase 5 contract, item 4).
  const showLate = hasLateCounts(book.accounts);
  const finalRule = book.accounts.find((account) => (account as Account).late_beyond_final)?.late_beyond_final;
  const owe = book.accounts.filter((account) => net(account) > 0);
  const inCredit = book.accounts.filter((account) => net(account) < 0);
  const credits = n(book.summary.unallocated_credit);
  const by = (key: SortKey) => setSort((current) => (current.key === key ? { key, ascending: !current.ascending } : { key, ascending: key === "name" }));
  const toggle = (id: string) => setOpen((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const header = (key: SortKey, label: string, right = false) => (
    <th className={right ? "r" : undefined} aria-sort={sort.key === key ? (sort.ascending ? "ascending" : "descending") : undefined}>
      <button type="button" className="lnk" style={{ color: "inherit", font: "inherit", textTransform: "inherit", letterSpacing: "inherit" }} onClick={() => by(key)}>{label}</button>
    </th>
  );
  return (
    <div className="card" data-who-is-where>
      <h3>Who&apos;s where<span>all {book.accounts.length} accounts on the books · click a row for its invoices</span></h3>
      <div className="scroll" style={{ maxHeight: 520, overflow: "auto" }}>
        <table>
          <thead><tr><th aria-label="Open" />{header("name", "Client & contact")}<th>Phone</th>{header("net", "Outstanding", true)}{header("oldest", "Past due", true)}{header("open", "Open", true)}{showLate ? <th className="r">Times late</th> : null}<th>Status</th></tr></thead>
          <tbody>
            {accounts.map((account) => {
              const expanded = open.has(account.client_id);
              const chip = rungChip(account, rules);
              const fromBilling = hasBillingInvoices(account);
              return (
                <Fragment key={account.client_id}>
                  <tr style={{ cursor: "pointer" }} onClick={() => toggle(account.client_id)} data-account-row={account.client_id}>
                    <td style={{ width: 16 }}>
                      <button type="button" aria-expanded={expanded} aria-label={`${expanded ? "Hide" : "Show"} invoices for ${account.client_name}`} onClick={(event) => { event.stopPropagation(); toggle(account.client_id); }} style={{ background: "none", border: 0, padding: 0, color: "var(--amber)", fontWeight: 700, cursor: "pointer" }}>{expanded ? "▾" : "▸"}</button>
                    </td>
                    <td><b>{account.client_name}</b>{fromBilling ? <> <span className="chip c-brand">billed in PracticeOps</span></> : null}<div className="sub"><ContactLine account={account} /></div></td>
                    <td><Phone phone={account.contact_phone} /></td>
                    <td className="r num" style={{ color: net(account) > 0 ? "var(--red)" : "var(--green)" }}>{dollars(net(account))}</td>
                    <td className="r num" style={account.oldest_days_past_due >= 90 ? { color: "var(--amber)", fontWeight: 600 } : undefined}>{account.oldest_days_past_due > 0 ? `${account.oldest_days_past_due}d` : "—"}</td>
                    <td className="r num">{account.open_invoice_count}</td>
                    {showLate ? (() => {
                      const late = account.late_beyond_final_count ?? 0;
                      const rule = account.late_beyond_final;
                      const why = rule ? `past ${rule.label} (${rule.days_past_due} days)${rule.window_months ? `, last ${rule.window_months} months` : ", all time"}` : "past the final escalation deadline";
                      return <td className="r num" data-late-count={late} title={`${late} invoice${late === 1 ? "" : "s"} ${why}`} style={{ color: lateTone(late), fontWeight: late >= 3 ? 600 : undefined }}>{late}&times;</td>;
                    })() : null}
                    <td><span className={`chip ${chip.tone}`}>{chip.label}{chip.gate ? " ⚑" : ""}</span></td>
                  </tr>
                  {expanded ? (
                    <tr data-account-invoices={account.client_id}>
                      <td />
                      <td colSpan={showLate ? 7 : 6} style={{ background: "var(--card2)" }}>
                        {account.invoices.length ? (
                          <table>
                            <thead><tr><th>Invoice</th><th>Status</th><th>Issued</th><th className="r">Past due</th><th>Next touch</th><th className="r">Amount</th></tr></thead>
                            <tbody>
                              {account.invoices.map((invoice) => (
                                <tr key={invoice.row_key || invoice.invoice_id || invoice.source_invoice_id}>
                                  <td className="mono">{invoice.invoice_number}</td>
                                  <td>{isPaidInvoice(invoice) ? <span className="chip c-green" title={invoice.paid_as_of ? `Zero balance in approved A/R report as of ${invoice.paid_as_of}` : "Zero balance in Billing"}>Paid</span> : <span className="chip c-blue">Open</span>}</td>
                                  <td>{dayMonth(invoice.issue_date, true)}</td>
                                  <td className="r num">{invoice.days_past_due > 0 ? `${invoice.days_past_due}d` : "not yet due"}</td>
                                  <td data-next-touch>{nextTouch(invoice, rules)}</td>
                                  <td className="r num">${n(invoice.balance).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : <div className="sub" style={{ padding: "6px 0" }}>No open invoices — an unapplied credit sits on this account.</div>}
                        <div className="sub">{fromBilling ? "Read live from Billing." : "From the imported aging report."}</div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="fine" style={{ border: "none", marginTop: 10, paddingTop: 0 }}>
        {owe.length} accounts owe the firm, {dollars(n(book.summary.gross_open_balance))} in all; {inCredit.length} sit in credit (−{dollars(credits)}), netting to <b>{dollars(n(book.summary.net_ar_estimate))}</b>. Default sort is priority (dollars × age) — click a column to re-sort.{" "}
        {showLate && finalRule ? <>Times late counts invoices that went past <b>{finalRule.label}</b> ({finalRule.days_past_due} days) in the last {finalRule.window_months || 12} months, recomputed under the current rules. </> : null}
        <b>Gaps found:</b> {owe.filter((account) => !account.contact_phone).length} accounts have no phone, {owe.filter((account) => !account.contact_email).length} no email, 0 aren&apos;t in the client list.
      </p>
    </div>
  );
}
