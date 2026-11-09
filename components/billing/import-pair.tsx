"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { ApiResult, BillingApi } from "@/lib/billing-ui/api";
import { pairApprovalChecklist, reconciliationOf, SUMMARY_BUCKETS, summaryRowView, type ImportBatch, type ImportBatchDetail, type ImportRow, type PairReconciliation, type SummaryBucket } from "@/lib/billing-ui/imports";
import type { Viewer } from "@/lib/billing-ui/types";
import { formatMoney } from "@/lib/billing-ui/view-model";

type Failure = { kind: string; message: string; code?: string };
const STATUS_PILL: Record<string, { label: string; tone: string }> = {
  pending: { label: "Pending", tone: "amber" },
  matched: { label: "Matched", tone: "green" },
  conflict: { label: "Conflict", tone: "red" },
  review: { label: "Needs review", tone: "amber" },
};
const money = (value: string | null | undefined) => (value === null || value === undefined || value === "" ? "—" : formatMoney(value));

/** A summary report's customer aging rows, as balance evidence: pending, matched or in conflict, never "ignored". */
export function SummaryRows({ rows, editable, onCorrect }: { rows: ImportRow[]; editable: boolean; onCorrect: (input: { row_id: string; customer_name: string; balances: Record<SummaryBucket, string> }) => Promise<ApiResult<unknown>> }) {
  const [editing, setEditing] = useState<string | null>(null);
  const evidence = rows.map((row) => ({ row, view: summaryRowView(row) })).filter(({ view }) => view.kind !== "other");
  const counts = { pending: 0, matched: 0, conflict: 0 } as Record<string, number>;
  for (const { view } of evidence) if (view.kind === "customer" && view.status in counts) counts[view.status] += 1;
  if (!evidence.length) return null;
  return (
    <section aria-label="Summary customer balances" data-summary-rows style={{ marginTop: 14 }}>
      <h4 className="bc-sect">Customer balances from the summary</h4>
      <p className="bc-hint">Each row is evidence for the paired approval, not an invoice. Rows stay <b>pending</b> until Approve on the detail report compares them with that report&rsquo;s customer subtotals. Correcting a row means you can&rsquo;t approve this pair.</p>
      <div className="bc-strip" style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12.5, margin: "6px 0 10px" }} data-summary-counts>
        <span><b>{counts.pending}</b> pending</span><span style={{ color: "var(--green)" }}><b>{counts.matched}</b> matched</span><span style={{ color: counts.conflict ? "var(--red)" : undefined }}><b>{counts.conflict}</b> in conflict</span>
      </div>
      <div className="bc-scroll">
        <table className="bc-table sm">
          <thead><tr><th>Customer</th>{SUMMARY_BUCKETS.map((bucket) => <th key={bucket.key} className="r">{bucket.label}</th>)}<th>Status</th></tr></thead>
          <tbody>
            {evidence.map(({ row, view }) => {
              const pill = STATUS_PILL[view.status];
              const total = view.kind === "grand_total";
              return (
                <tr key={row.id} data-summary-row={row.id} data-summary-status={total ? "total" : view.status}>
                  <td>
                    {total ? <b>Printed report total</b> : <b>{view.fields.customer_name || "—"}</b>}
                    {view.reconciliation && view.status === "conflict" ? (
                      <div className="bc-small" style={{ color: "var(--red)" }} data-summary-conflict>
                        Detail {money(view.reconciliation.detail_balance ?? null)} · difference {money(view.reconciliation.difference ?? null)}{view.reconciliation.buckets_consistent === false ? " · aging buckets don't add up to the total" : ""}
                      </div>
                    ) : null}
                  </td>
                  {SUMMARY_BUCKETS.map((bucket) => <td key={bucket.key} className="r">{total && bucket.key !== "total_open_balance" ? "" : money(view.fields[bucket.key])}</td>)}
                  <td>
                    {total ? <span className="bc-pill grey">Report total</span> : <span className={`bc-pill ${pill.tone}`}>{pill.label}</span>}
                    {editable && view.kind === "customer" ? (
                      <div style={{ marginTop: 6 }}><button type="button" className="bc-btn quiet" style={{ padding: "4px 9px", fontSize: 12 }} aria-expanded={editing === row.id} onClick={() => setEditing(editing === row.id ? null : row.id)}>{editing === row.id ? "Cancel" : "Correct"}</button></div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {editing ? (() => {
        const row = rows.find((item) => item.id === editing);
        return row ? <SummaryRowForm key={row.id} row={row} onCancel={() => setEditing(null)} onSubmit={async (input) => { const result = await onCorrect(input); if (result.ok) setEditing(null); return result; }} /> : null;
      })() : null}
    </section>
  );
}

function SummaryRowForm({ row, onCancel, onSubmit }: { row: ImportRow; onCancel: () => void; onSubmit: (input: { row_id: string; customer_name: string; balances: Record<SummaryBucket, string> }) => Promise<ApiResult<unknown>> }) {
  const { fields } = summaryRowView(row);
  const [name, setName] = useState(String(fields.customer_name || ""));
  const [values, setValues] = useState<Record<SummaryBucket, string>>(() => Object.fromEntries(SUMMARY_BUCKETS.map((bucket) => [bucket.key, String(fields[bucket.key] ?? "")])) as Record<SummaryBucket, string>);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<Failure | null>(null);
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const bad = SUMMARY_BUCKETS.filter((bucket) => !/^-?\d{1,10}(\.\d{1,2})?$/.test(values[bucket.key].replace(/[$,\s]/g, "")));
    if (!name.trim() || bad.length || !confirmed) {
      setError({ kind: "invalid", message: !name.trim() ? "Enter the customer name as printed." : bad.length ? `Enter a valid amount for ${bad.map((bucket) => bucket.label).join(", ")}.` : "Confirm you checked this row against the PDF." });
      return;
    }
    setPending(true);
    const balances = Object.fromEntries(SUMMARY_BUCKETS.map((bucket) => [bucket.key, values[bucket.key].replace(/[$,\s]/g, "")])) as Record<SummaryBucket, string>;
    const result = await onSubmit({ row_id: row.id, customer_name: name.trim(), balances });
    setPending(false);
    if (result.ok === false) setError({ kind: result.kind, message: result.message, code: result.code });
  }
  return (
    <form onSubmit={submit} noValidate className="bc-gatebox" style={{ marginTop: 10 }} data-summary-correction={row.id}>
      <h4 className="bc-sect">Correct this summary row</h4>
      <p className="bc-hint">Enter the customer and every aging amount exactly as printed. Correcting a row is recorded, and means you can&rsquo;t approve this pair, even as an Admin.</p>
      <label className="bc-field"><span>Customer</span><input className="bc-in" data-field="customer_name" value={name} onChange={(event) => setName(event.target.value)} /></label>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))", gap: 8 }}>
        {SUMMARY_BUCKETS.map((bucket) => (
          <label key={bucket.key} className="bc-field"><span>{bucket.label}</span><input className="bc-in" inputMode="decimal" data-field={bucket.key} value={values[bucket.key]} onChange={(event) => setValues((current) => ({ ...current, [bucket.key]: event.target.value }))} /></label>
        ))}
      </div>
      <label className="bc-inline" style={{ fontSize: 13, margin: "6px 0" }}><input type="checkbox" data-field="confirmed" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> I checked this row against the PDF</label>
      {error ? <p role="alert" className="bc-small" style={{ color: "var(--red)" }}>{error.message}</p> : null}
      <div className="bc-inline"><button type="submit" className="bc-btn" disabled={pending}>{pending ? "Saving…" : "Save correction"}</button><button type="button" className="bc-btn quiet" onClick={onCancel}>Cancel</button></div>
    </form>
  );
}

/** The math behind a paired reconciliation: per customer, aging buckets, and the printed total. */
export function ReconciliationView({ result }: { result: PairReconciliation }) {
  const conflicts = result.customers.filter((customer) => customer.status === "conflict");
  const ordered = [...conflicts, ...result.customers.filter((customer) => customer.status !== "conflict")];
  const ok = result.status === "matched";
  return (
    <div className="bc-source" data-reconciliation={result.status} style={{ marginTop: 12 }}>
      <p style={{ margin: "0 0 6px" }}>
        <span className={`bc-pill ${ok ? "green" : "red"}`}>{ok ? "Reports match" : "Reports don't match"}</span>{" "}
        Summary {money(result.summary_total)} − detail {money(result.detail_total)} (invoices {money(result.detail_invoice_total)} + payments/adjustments {money(result.detail_non_invoice_adjustments)}) = <b data-reconciliation-difference>{money(result.difference)}</b>
      </p>
      <p style={{ margin: "0 0 6px" }} data-printed-total={result.printed_summary_total_matches ? "matches" : "differs"}>
        Printed summary total: {result.printed_summary_total === null ? "not found on the report" : money(result.printed_summary_total)}{" "}
        <span className={`bc-pill ${result.printed_summary_total_matches ? "green" : "red"}`}>{result.printed_summary_total_matches ? "agrees with the customer rows" : "doesn't agree with the customer rows"}</span>
      </p>
      <p className="bc-small" style={{ margin: "0 0 8px" }}>{result.customers.length - conflicts.length} customer{result.customers.length - conflicts.length === 1 ? "" : "s"} matched · <b style={{ color: conflicts.length ? "var(--red)" : undefined }}>{conflicts.length} in conflict</b>. Names must match exactly; nothing is matched by similarity.</p>
      {ordered.length ? (
        <div className="bc-scroll" style={{ maxHeight: 360, overflowY: "auto" }}>
          <table className="bc-table sm" data-reconciliation-customers>
            <thead><tr><th>Summary customer</th><th>Detail customer</th><th className="r">Summary</th><th className="r">Detail</th><th className="r">Difference</th><th>Aging buckets</th><th>Status</th></tr></thead>
            <tbody>
              {ordered.map((customer, index) => (
                <tr key={`${customer.customer_key || customer.summary_customer || customer.detail_customer}-${index}`} data-customer-status={customer.status}>
                  <td>{customer.summary_customer || <span className="bc-small">not on the summary</span>}</td>
                  <td>{customer.detail_customer || <span className="bc-small">not in the detail report</span>}</td>
                  <td className="r">{money(customer.summary_balance)}</td>
                  <td className="r">{money(customer.detail_balance)}</td>
                  <td className="r">{money(customer.difference)}</td>
                  <td>{customer.buckets_consistent ? "Add up" : <span style={{ color: "var(--red)" }}>Don&rsquo;t add up</span>}</td>
                  <td><span className={`bc-pill ${customer.status === "matched" ? "green" : "red"}`}>{customer.status === "matched" ? "Matched" : "Conflict"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

/** Approve on the detail report: approves the detail and its same-date summary together, or neither. */
export function PairApprovalBox({ api, detail, viewer, summaries, onApproved }: {
  api: BillingApi;
  detail: ImportBatchDetail;
  viewer: Viewer | null;
  /** Same-date summary reports still in review. */
  summaries: ImportBatch[];
  onApproved: () => Promise<void>;
}) {
  const [summaryId, setSummaryId] = useState<string>(summaries.length === 1 ? summaries[0].id : "");
  const [loaded, setLoaded] = useState<{ id: string; data: ImportBatchDetail } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Failure | null>(null);
  const [mismatch, setMismatch] = useState<PairReconciliation | null>(null);
  const chosen = summaryId || (summaries.length === 1 ? summaries[0].id : "");
  useEffect(() => {
    let current = true;
    if (chosen) api.importBatch(chosen).then((result) => { if (current && result.ok) setLoaded({ id: chosen, data: result.data }); });
    return () => { current = false; };
  }, [api, chosen]);
  // Only the summary that is chosen now counts; a report loaded for an earlier choice is ignored.
  const summary = loaded && loaded.id === chosen ? loaded.data : null;
  const stored = reconciliationOf(summary?.batch.metadata?.detail_cross_check);
  const shown = mismatch || (stored && stored.detail_batch_id === detail.batch.id ? stored : null);
  const checks = pairApprovalChecklist(detail, summary, viewer);
  const ready = checks.every((check) => check.ok);
  async function approve() {
    if (!chosen) return;
    setPending(true); setError(null); setMismatch(null);
    const result = await api.approveImport(detail.batch.id, chosen);
    setPending(false);
    if (result.ok === true) { await onApproved(); return; }
    if (result.code === "IMPORT_RECONCILIATION_MISMATCH") {
      setMismatch(reconciliationOf(result.details));
      const fresh = await api.importBatch(chosen);
      if (fresh.ok) setLoaded({ id: chosen, data: fresh.data });
    }
    setError({ kind: result.kind, message: result.message, code: result.code });
  }
  return (
    <section className="bc-gatebox" aria-label="Approve this report pair" data-approval-box={ready ? "ready" : "blocked"} style={{ marginTop: 18 }}>
      <h4 className="bc-sect">Approve the detail and summary together</h4>
      <p className="bc-hint">Nothing reaches Collections until both same-date reports are uploaded and reviewed. Approve compares every summary customer with this report&rsquo;s customer subtotals, then the totals. If everything matches, both reports are approved in one step; if anything doesn&rsquo;t, neither is, and both stay in review.</p>
      {summaries.length > 1 ? (
        <label className="bc-field"><span>Summary report for {detail.batch.source_as_of}</span>
          <select className="bc-in" data-field="summary_batch_id" value={summaryId} onChange={(event) => setSummaryId(event.target.value)}>
            <option value="">Select…</option>
            {summaries.map((item) => <option key={item.id} value={item.id}>{item.original_filename}</option>)}
          </select>
        </label>
      ) : summaries.length === 1 ? <p className="bc-small" data-paired-summary={summaries[0].id}>Paired with <b>{summaries[0].original_filename}</b>.</p> : null}
      <ul style={{ listStyle: "none", padding: 0, margin: "0 0 10px", fontSize: 13 }}>
        {checks.map((check) => (
          <li key={check.id} data-approval-check={check.id} data-ok={check.ok} style={{ color: check.ok ? "var(--green)" : "var(--gate-ink)", padding: "2px 0" }}>{check.ok ? "✓" : "•"} {check.label}</li>
        ))}
      </ul>
      <p className="bc-small" style={{ margin: "0 0 10px" }}>An Admin may approve a pair they uploaded; an Owner or anyone else who uploaded a report may not. Anyone who corrected either report can&rsquo;t approve the pair, including an Admin.</p>
      {error && error.code !== "IMPORT_RECONCILIATION_MISMATCH" ? <p role="alert" className="bc-small" style={{ color: "var(--red)" }} data-approval-error={error.code || error.kind}>{error.message}</p> : null}
      {shown && shown.status === "mismatch" ? <p role="alert" className="bc-small" style={{ color: "var(--red)", margin: "0 0 6px" }} data-approval-error="IMPORT_RECONCILIATION_MISMATCH">The reports don&rsquo;t match, so neither was approved. Both stay in review.</p> : null}
      <button type="button" className="bc-btn" disabled={!ready || pending || !chosen} onClick={approve}>{pending ? "Reconciling…" : "Approve both reports"}</button>
      {shown ? <ReconciliationView result={shown} /> : null}
    </section>
  );
}
