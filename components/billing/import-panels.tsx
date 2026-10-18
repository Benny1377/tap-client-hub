"use client";

import { useCallback, useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import type { ApiResult, BillingApi } from "@/lib/billing-ui/api";
import {
  approvalChecklist,
  BATCH_STATUS_LABELS,
  canCorrectMetadata,
  compareBalances,
  DELEGABLE_ROLES,
  DISPOSITION_LABELS,
  earlierBalance,
  IMPORT_ACTIONS,
  IMPORT_ERROR_HEADLINES,
  linkedBillingInvoiceId,
  metadataNeedsReview,
  parseAmount,
  priorImportsFrom,
  parseReportDate,
  REPORT_TYPE_LABELS,
  reviewProgress,
  rowCells,
  suggestPriorImport,
  togglePolicy,
  uploadProblem,
  type PriorImport,
  type ClassifyDisposition,
  type ImportBatch,
  type ImportBatchDetail,
  type ImportInvoice,
  type ImportPolicy,
  type ImportRow,
} from "@/lib/billing-ui/imports";
import type { ClientOption, Receivable, Viewer } from "@/lib/billing-ui/types";
import { formatMoney } from "@/lib/billing-ui/view-model";

type Failure = { kind: string; message: string; code?: string };
type Load<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error"; error: Failure };

function failureOf(result: ApiResult<unknown>): Failure | null {
  return result.ok === false ? { kind: result.kind, message: result.message, code: result.code } : null;
}

/** Import-specific wording first; otherwise the server's own message. */
function ImportError({ error }: { error: Failure }) {
  const headline = (error.code && IMPORT_ERROR_HEADLINES[error.code]) || error.message;
  const tone = error.kind === "forbidden" ? { background: "var(--amber-soft)", color: "var(--gate-ink)" } : { background: "var(--red-soft)", color: "var(--red)" };
  return <div role="alert" data-import-error={error.code || error.kind} style={{ ...tone, borderRadius: 10, padding: "10px 12px", fontSize: 13, margin: "8px 0" }}>{headline}</div>;
}

function statusTone(status: string) {
  if (status === "approved") return "green";
  if (status === "failed" || status === "rejected") return "red";
  if (status === "needs_review") return "amber";
  return "grey";
}

const dateLabel = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");

export interface ImportsPanelProps {
  api: BillingApi;
  viewer: Viewer | null;
  clients: ClientOption[];
  billingInvoices: Receivable[];
  /** Called after an approval or resolution changes what the call list shows. */
  onCollectionsChanged: () => void;
}

export function ImportsPanel({ api, viewer, clients, billingInvoices, onCollectionsChanged }: ImportsPanelProps) {
  const [batches, setBatches] = useState<Load<ImportBatch[]>>({ status: "loading" });
  const [selected, setSelected] = useState<string | null>(null);
  const [priorImports, setPriorImports] = useState<PriorImport[]>([]);

  // Earlier approved imports, so a repeat invoice in a newer report can keep its identity.
  const loadPriorImports = useCallback(async () => {
    const result = await api.worklist({ limit: 200 });
    if (result.ok) setPriorImports(priorImportsFrom(result.data));
  }, [api]);

  const loadBatches = useCallback(async () => {
    const result = await api.imports();
    setBatches(result.ok ? { status: "ready", data: result.data.batches } : { status: "error", error: failureOf(result)! });
  }, [api]);

  useEffect(() => {
    let current = true;
    api.imports().then((result) => {
      if (current) setBatches(result.ok ? { status: "ready", data: result.data.batches } : { status: "error", error: failureOf(result)! });
    });
    api.worklist({ limit: 200 }).then((result) => {
      if (current && result.ok) setPriorImports(priorImportsFrom(result.data));
    });
    return () => { current = false; };
  }, [api]);

  const list = batches.status === "ready" ? batches.data : [];
  return (
    <div className="bc-stack" data-imports-panel>
      <section className="bc-card" aria-label="Upload an A/R report">
        <h3 className="bc-sect">A/R reports from QuickBooks</h3>
        <p className="bc-hint">
          Upload an <b>A/R Aging detail</b> report (QuickZoom) to bring its invoices into Collections, or an <b>A/R Aging summary</b>{" "}to cross-check a detail report&rsquo;s total.
          Nothing reaches the call list until a reviewer confirms each invoice against the PDF and a different Owner/Admin approves the report.
        </p>
        <div className="bc-source" role="note">
          Reports are stored privately and every view or download is logged. Imported invoices never change Billing. Use synthetic test reports only in test environments.
        </div>
        <UploadForm api={api} onUploaded={async (id) => { await loadBatches(); setSelected(id); }} />
      </section>

      <section className="bc-card" aria-label="Uploaded reports">
        <h3 className="bc-h">Uploaded reports <small>newest first</small></h3>
        {batches.status === "loading" ? <p role="status" className="bc-hint">Loading reports…</p> : null}
        {batches.status === "error" ? <ImportError error={batches.error} /> : null}
        {batches.status === "ready" && list.length === 0 ? <p className="bc-hint">No reports uploaded yet.</p> : null}
        {list.length > 0 ? (
          <div className="bc-scroll">
            <table className="bc-table">
              <thead><tr><th>Report</th><th>Layout</th><th>As of</th><th>Status</th><th>Uploaded</th></tr></thead>
              <tbody>
                {list.map((batch) => (
                  <tr key={batch.id} data-import-batch={batch.id} className={selected === batch.id ? "on" : undefined}>
                    <td><button type="button" className="bc-name" onClick={() => setSelected(batch.id)}>{batch.original_filename}</button></td>
                    <td>{batch.report_type ? REPORT_TYPE_LABELS[batch.report_type] : "—"}</td>
                    <td className="bc-nowrap">{dateLabel(batch.source_as_of)}</td>
                    <td><span className={`bc-pill ${statusTone(batch.status)}`}>{BATCH_STATUS_LABELS[batch.status] || batch.status}</span></td>
                    <td className="bc-nowrap">{dateLabel(batch.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {selected ? (
        <BatchReview
          key={selected}
          api={api}
          batchId={selected}
          viewer={viewer}
          clients={clients}
          billingInvoices={billingInvoices}
          batches={list}
          priorImports={priorImports}
          onBatchChanged={loadBatches}
          onCollectionsChanged={() => { onCollectionsChanged(); void loadPriorImports(); }}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}

function UploadForm({ api, onUploaded }: { api: BillingApi; onUploaded: (batchId: string) => Promise<void> }) {
  const inputId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<"uploading" | "reading" | null>(null);
  const [error, setError] = useState<Failure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (!file) { setError({ kind: "invalid", message: "Choose a PDF report to upload.", code: "PDF_REQUIRED" }); return; }
    const problem = uploadProblem(file);
    if (problem) { setError({ kind: "invalid", message: problem }); return; }
    setBusy("uploading");
    const uploaded = await api.uploadImport(file);
    if (uploaded.ok === false) { setBusy(null); setError(failureOf(uploaded)); return; }
    const batchId = uploaded.data.batch.id;
    if (uploaded.data.duplicate) {
      setNotice("This exact file was uploaded before, so nothing new was stored. Opening the existing report.");
    } else {
      // Reading the text is not approval: it only lists the lines for review.
      setBusy("reading");
      const parsed = await api.parseImport(batchId);
      if (parsed.ok === false) setError(failureOf(parsed));
    }
    setBusy(null);
    setFile(null);
    await onUploaded(batchId);
  }

  return (
    <form onSubmit={submit} noValidate data-import-upload>
      <label className="bc-field" htmlFor={inputId}>
        <span>PDF report (up to 25 MB)</span>
      </label>
      <div className="bc-inline">
        <input id={inputId} key={file ? "chosen" : "empty"} type="file" accept="application/pdf,.pdf" onChange={(event) => setFile(event.target.files?.[0] || null)} style={{ fontSize: 13, maxWidth: "100%" }} />
        <button type="submit" className="bc-btn" disabled={busy !== null}>
          {busy === "uploading" ? "Uploading…" : busy === "reading" ? "Reading text…" : "Upload and read"}
        </button>
      </div>
      {notice ? <p role="status" className="bc-hint" style={{ marginTop: 8 }}>{notice}</p> : null}
      {error ? <ImportError error={error} /> : null}
    </form>
  );
}

interface BatchReviewProps {
  api: BillingApi;
  batchId: string;
  viewer: Viewer | null;
  clients: ClientOption[];
  billingInvoices: Receivable[];
  batches: ImportBatch[];
  priorImports: PriorImport[];
  onBatchChanged: () => Promise<void>;
  onCollectionsChanged: () => void;
  onClose: () => void;
}

function BatchReview({ api, batchId, viewer, clients, billingInvoices, batches, priorImports, onBatchChanged, onCollectionsChanged, onClose }: BatchReviewProps) {
  const [detail, setDetail] = useState<Load<ImportBatchDetail>>({ status: "loading" });
  const [mapping, setMapping] = useState<string | null>(null);
  const [actionError, setActionError] = useState<Failure | null>(null);

  const load = useCallback(async () => {
    const result = await api.importBatch(batchId);
    setDetail(result.ok ? { status: "ready", data: result.data } : { status: "error", error: failureOf(result)! });
  }, [api, batchId]);

  useEffect(() => {
    let current = true;
    api.importBatch(batchId).then((result) => {
      if (current) setDetail(result.ok ? { status: "ready", data: result.data } : { status: "error", error: failureOf(result)! });
    });
    return () => { current = false; };
  }, [api, batchId]);

  /** Run a write, then reload the report (and the list, whose status may change). */
  const act = useCallback(async (mutation: () => Promise<ApiResult<unknown>>, after?: () => void, inlineErrors = false) => {
    setActionError(null);
    const result = await mutation();
    // Forms show their own errors next to the fields; one-click actions report here.
    if (result.ok === false && !inlineErrors) setActionError(failureOf(result));
    if (result.ok === true || result.kind === "conflict") {
      await Promise.all([load(), onBatchChanged()]);
      if (result.ok) after?.();
    }
    return result;
  }, [load, onBatchChanged]);

  if (detail.status === "loading") return <section className="bc-card"><p role="status" className="bc-hint">Opening report…</p></section>;
  if (detail.status === "error") return <section className="bc-card"><ImportError error={detail.error} /></section>;
  const data = detail.data;
  const { batch, rows, invoices } = data;
  const editable = batch.status === "needs_review";
  const progress = reviewProgress(rows);
  const clientNames = Object.fromEntries(clients.map((client) => [client.id, client.name]));
  const billingById = new Map(billingInvoices.map((invoice) => [invoice.id, invoice]));
  const invoiceBySource = new Map(invoices.map((invoice) => [invoice.source_invoice_id, invoice]));
  // One report line per imported invoice: an identity already used in this report isn't offered again.
  const matchable = priorImports.filter((item) => !invoiceBySource.has(item.source_invoice_id));

  return (
    <section className="bc-card" aria-label={`Review ${batch.original_filename}`} data-import-review={batch.id} data-batch-status={batch.status}>
      <div className="bc-h" style={{ marginBottom: 6 }}>
        <span className="bc-sect" style={{ margin: 0 }}>{batch.original_filename}</span>
        <span className="bc-inline">
          <OpenOriginal api={api} batchId={batch.id} />
          <button type="button" className="bc-btn quiet" onClick={onClose}>Close</button>
        </span>
      </div>
      <p className="bc-hint" data-batch-summary>
        <span className={`bc-pill ${statusTone(batch.status)}`}>{BATCH_STATUS_LABELS[batch.status] || batch.status}</span>{" "}
        {batch.report_type ? REPORT_TYPE_LABELS[batch.report_type] : "Layout not read yet"} · as of <b>{dateLabel(batch.source_as_of)}</b>
        {batch.metadata?.page_count ? ` · ${batch.metadata.page_count} page${batch.metadata.page_count === 1 ? "" : "s"}` : ""}
      </p>

      {batch.status === "uploaded" || batch.status === "failed" ? (
        <div className="bc-gatebox" style={{ marginBottom: 12 }}>
          <p className="bc-hint" style={{ margin: "0 0 8px" }}>{batch.status === "failed" ? "The text in this PDF couldn't be read last time. You can try again; the stored file is unchanged." : "This report hasn't been read yet."}</p>
          <button type="button" className="bc-btn" onClick={() => act(() => api.parseImport(batch.id))}>Read the text</button>
        </div>
      ) : null}
      {batch.status === "needs_review" && metadataNeedsReview(batch) && !canCorrectMetadata(data) ? (
        <ImportError error={{ kind: "invalid", message: "This report's type or as-of date wasn't read, and invoices are already confirmed, so it can't be corrected here. Upload a fresh export of the report." }} />
      ) : null}
      {canCorrectMetadata(data) ? (
        <MetadataCorrection
          batch={batch}
          onCorrect={(input) => act(() => api.correctImportMetadata(batch.id, input), undefined, true)}
        />
      ) : null}
      {actionError ? <ImportError error={actionError} /> : null}

      {rows.length > 0 ? (
        <>
          <div className="bc-strip" data-review-progress style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12.5, margin: "6px 0 12px" }}>
            <span><b>{progress.total}</b> lines read</span>
            <span><b>{progress.invoices}</b> confirmed as invoices</span>
            <span><b>{progress.classified}</b> headings, totals or ignored</span>
            {progress.duplicates ? <span><b>{progress.duplicates}</b> repeated lines (counted once)</span> : null}
            <span style={{ color: progress.unreviewed ? "var(--gate-ink)" : "var(--green)" }}><b>{progress.unreviewed}</b> left to review</span>
          </div>
          <p className="bc-hint">
            Go line by line. Confirm each invoice line against the PDF and say which TAP Hub client it belongs to; mark every other line as a heading, a total, or ignored.
            Values are never filled in for you: click a cell to copy it into the field you&rsquo;re editing.
          </p>
          <div className="bc-scroll">
            <table className="bc-table sm" data-import-lines>
              <thead><tr><th>Line</th><th>Text read from the PDF</th><th>Review</th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <LineRow
                    key={row.id}
                    row={row}
                    invoice={row.source_invoice_id ? invoiceBySource.get(row.source_invoice_id) : undefined}
                    clientNames={clientNames}
                    editable={editable && Boolean(batch.source_as_of)}
                    mappingOpen={mapping === row.id}
                    onMap={() => setMapping(mapping === row.id ? null : row.id)}
                    onClassify={(disposition) => act(() => api.classifyImportRow(batch.id, row.id, disposition))}
                    mappingForm={mapping === row.id ? (
                      <InvoiceMappingForm
                        row={row}
                        existing={row.source_invoice_id ? invoiceBySource.get(row.source_invoice_id) : undefined}
                        clients={clients}
                        billingInvoices={billingInvoices}
                        priorImports={matchable}
                        onCancel={() => setMapping(null)}
                        onSubmit={(input) => act(() => api.reviewImportInvoice(batch.id, input), () => setMapping(null), true)}
                      />
                    ) : null}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {invoices.length > 0 ? (
        <ConfirmedInvoices invoices={invoices} revisions={data.revisions} clientNames={clientNames} billingById={billingById} />
      ) : null}

      {batch.report_type === "aging_summary" ? (
        <CrossCheckForm api={api} batch={batch} batches={batches} onDone={() => Promise.all([load(), onBatchChanged()]).then(() => undefined)} />
      ) : null}

      {batch.report_type === "aging_detail" && batch.status === "needs_review" ? (
        <ApprovalBox
          detail={data}
          viewer={viewer}
          pendingSummaries={batches.filter((item) => item.report_type === "aging_summary" && item.status === "needs_review" && item.source_as_of === batch.source_as_of)}
          onApprove={() => act(() => api.approveImport(batch.id), onCollectionsChanged)}
        />
      ) : null}
      {batch.status === "approved" ? (
        <div className="bc-source" role="note" data-batch-approved style={{ marginTop: 16 }}>
          <b>Approved {dateLabel(batch.approved_at)}.</b>{" "}Its invoices are on the call list under &ldquo;From A/R report&rdquo;. A later Billing payment or change to a linked invoice blocks it again until someone reviews the difference.
        </div>
      ) : null}

      {batch.status === "approved" && invoices.some((invoice) => invoice.discrepancy_status === "blocked") ? (
        <section aria-label="Balances to reconcile" style={{ marginTop: 18 }}>
          <h4 className="bc-sect">Balances to reconcile</h4>
          <p className="bc-hint">These invoices differ between the report and Billing, so no reminder or escalation can go out until someone with approve permission (Owner/Admin by default) picks the balance to use and says why.</p>
          {invoices.filter((invoice) => invoice.discrepancy_status === "blocked").map((invoice) => (
            <DiscrepancyResolver
              key={invoice.source_invoice_id}
              invoice={invoice}
              billing={billingById.get(linkedBillingInvoiceId(invoice) || "") || null}
              onResolve={(input) => act(() => api.resolveDiscrepancy(invoice.source_invoice_id, input), onCollectionsChanged, true)}
            />
          ))}
        </section>
      ) : null}
    </section>
  );
}

function OpenOriginal({ api, batchId }: { api: BillingApi; batchId: string }) {
  const [error, setError] = useState<Failure | null>(null);
  const [pending, setPending] = useState(false);
  const [blockedLink, setBlockedLink] = useState<string | null>(null);
  return (
    <span>
      <button
        type="button"
        className="bc-btn quiet"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          setBlockedLink(null);
          // Open the tab inside the click so pop-up blockers allow it, then point it at the signed link.
          const tab = window.open("", "_blank");
          const result = await api.importFileUrl(batchId);
          setPending(false);
          if (result.ok === false) { tab?.close(); setError(failureOf(result)); return; }
          if (tab) { tab.opener = null; tab.location.href = result.data.url; }
          else setBlockedLink(result.data.url);
        }}
      >
        {pending ? "Opening…" : "Open original PDF"}
      </button>
      {blockedLink ? (
        <a href={blockedLink} target="_blank" rel="noopener noreferrer" className="bc-small" data-pdf-link style={{ marginLeft: 8 }}>
          Pop-up blocked: open the PDF (link works for 60 seconds)
        </a>
      ) : null}
      {error ? <ImportError error={error} /> : null}
    </span>
  );
}

/**
 * Reviewer-confirmed report type and as-of date. Opens by itself when parsing
 * couldn't read them; otherwise it is a collapsed "wrong details?" option.
 */
export function MetadataCorrection({ batch, onCorrect }: {
  batch: Pick<ImportBatch, "report_type" | "source_as_of">;
  onCorrect: (input: { report_type: "aging_detail" | "aging_summary"; source_as_of: string }) => Promise<ApiResult<unknown>>;
}) {
  const needed = metadataNeedsReview(batch);
  const [reportType, setReportType] = useState(batch.report_type === "aging_detail" || batch.report_type === "aging_summary" ? batch.report_type : "");
  const [asOf, setAsOf] = useState(batch.source_as_of || "");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<Failure | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const date = parseReportDate(asOf);
    if (reportType !== "aging_detail" && reportType !== "aging_summary") { setError({ kind: "invalid", message: "Choose the report type printed on the PDF." }); return; }
    if (!date) { setError({ kind: "invalid", message: "Enter the as-of date printed on the PDF (YYYY-MM-DD or MM/DD/YYYY)." }); return; }
    if (!confirmed) { setError({ kind: "invalid", message: "Confirm you read both values from the PDF." }); return; }
    setPending(true);
    const result = await onCorrect({ report_type: reportType, source_as_of: date });
    setPending(false);
    setError(failureOf(result));
  }

  const form = (
    <form onSubmit={submit} noValidate data-metadata-form style={{ marginTop: 8 }}>
      <p className="bc-hint" style={{ margin: "0 0 8px" }}>
        Read these from the PDF header. The change is logged with the values that were read, and whoever corrects them can&rsquo;t approve this report.
        It&rsquo;s only possible before any invoice in the report is confirmed.
      </p>
      <div className="bc-inline" style={{ alignItems: "flex-end" }}>
        <label className="bc-field" style={{ margin: 0, minWidth: 200 }}>
          <span>Report type</span>
          <select className="bc-in" data-field="report_type" value={reportType} onChange={(event) => setReportType(event.target.value as typeof reportType)}>
            <option value="">Select…</option>
            <option value="aging_detail">{REPORT_TYPE_LABELS.aging_detail} (QuickZoom)</option>
            <option value="aging_summary">{REPORT_TYPE_LABELS.aging_summary}</option>
          </select>
        </label>
        <label className="bc-field" style={{ margin: 0, minWidth: 160 }}>
          <span>As of</span>
          <input className="bc-in" data-field="source_as_of" placeholder="YYYY-MM-DD" value={asOf} onChange={(event) => setAsOf(event.target.value)} />
        </label>
      </div>
      <label className="bc-inline" style={{ fontSize: 13, margin: "8px 0" }}>
        <input type="checkbox" data-field="metadata_confirmed" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
        I read the report type and date from the PDF.
      </label>
      {error ? <ImportError error={error} /> : null}
      <button type="submit" className="bc-btn" disabled={pending}>{pending ? "Saving…" : "Save report details"}</button>
    </form>
  );

  return needed ? (
    <section className="bc-gatebox" aria-label="Report details to confirm" data-metadata-correction="needed" style={{ marginBottom: 12 }}>
      <h4 className="bc-sect">Confirm the report details</h4>
      <p className="bc-hint" style={{ margin: 0 }}>
        {batch.report_type === "unknown" || !batch.report_type ? "The layout wasn't recognized" : "The as-of date wasn't read"}, so nothing in this report can be confirmed or approved until a reviewer enters it from the PDF.
        If it isn&rsquo;t a QuickBooks A/R Aging detail or summary report, don&rsquo;t correct it: upload the right export instead.
      </p>
      {form}
    </section>
  ) : (
    <details className="bc-details" data-metadata-correction="optional" style={{ marginBottom: 10 }}>
      <summary>Report type or date read wrong?</summary>
      {form}
    </details>
  );
}

const CLASSIFY_ACTIONS: Array<{ disposition: ClassifyDisposition; label: string }> = [
  { disposition: "header", label: "Heading" },
  { disposition: "summary", label: "Total" },
  { disposition: "ignored", label: "Ignore" },
];

export function LineRow({ row, invoice, clientNames, editable, mappingOpen, onMap, onClassify, mappingForm }: {
  row: ImportRow;
  invoice?: ImportInvoice;
  clientNames: Record<string, string>;
  editable: boolean;
  mappingOpen: boolean;
  onMap: () => void;
  onClassify: (disposition: ClassifyDisposition) => Promise<unknown>;
  mappingForm: ReactNode;
}) {
  const cells = rowCells(row);
  const canChange = editable && row.review_disposition !== "duplicate";
  return (
    <>
      <tr data-import-line={row.id} data-disposition={row.review_disposition}>
        <td className="bc-nowrap bc-small">p{row.page_number} · {row.row_number}</td>
        <td>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {cells.map((cell, index) => <span key={index} className="bc-chip" style={{ fontSize: 12 }}>{cell}</span>)}
          </div>
          {invoice ? (
            <div className="bc-small" style={{ marginTop: 4 }} data-line-invoice={invoice.source_invoice_id}>
              Invoice {invoice.invoice_number || "(no number)"} · {formatMoney(invoice.open_balance)}
              {invoice.identity?.client_id ? ` · ${clientNames[invoice.identity.client_id] || "TAP Hub client"}` : ""}
            </div>
          ) : null}
        </td>
        <td>
          <span className={`bc-pill ${row.review_disposition === "unreviewed" ? "amber" : row.review_disposition === "invoice" ? "green" : "grey"}`}>{DISPOSITION_LABELS[row.review_disposition]}</span>
          {canChange ? (
            <div className="bc-inline" style={{ marginTop: 6, gap: 4 }}>
              <button type="button" className="bc-btn" style={{ padding: "4px 9px", fontSize: 12 }} aria-expanded={mappingOpen} onClick={onMap}>
                {row.review_disposition === "invoice" ? "Correct invoice" : "Invoice…"}
              </button>
              {row.review_disposition !== "invoice" ? CLASSIFY_ACTIONS.filter((action) => action.disposition !== row.review_disposition).map((action) => (
                <button key={action.disposition} type="button" className="bc-btn quiet" style={{ padding: "4px 9px", fontSize: 12 }} onClick={() => onClassify(action.disposition)}>{action.label}</button>
              )) : null}
            </div>
          ) : null}
        </td>
      </tr>
      {mappingOpen ? <tr data-mapping-for={row.id}><td colSpan={3} style={{ background: "var(--paper)" }}>{mappingForm}</td></tr> : null}
    </>
  );
}

type MappingField = "customer_name" | "invoice_number" | "transaction_type" | "transaction_date" | "due_date" | "terms" | "po_number" | "reported_aging" | "open_balance";
const MAPPING_FIELDS: Array<{ name: MappingField; label: string; kind: "text" | "date" | "amount" | "days"; required?: boolean }> = [
  { name: "customer_name", label: "Customer (as on the report)", kind: "text", required: true },
  { name: "invoice_number", label: "Invoice number", kind: "text" },
  { name: "transaction_type", label: "Transaction type", kind: "text" },
  { name: "transaction_date", label: "Invoice date", kind: "date" },
  { name: "due_date", label: "Due date", kind: "date" },
  { name: "terms", label: "Terms", kind: "text" },
  { name: "po_number", label: "PO number", kind: "text" },
  { name: "reported_aging", label: "Aging (days)", kind: "days" },
  { name: "open_balance", label: "Open balance", kind: "amount", required: true },
];

/** Turns a clicked cell into the field's format; a cell that doesn't fit is copied as typed, for the reviewer to fix. */
function fromCell(kind: (typeof MAPPING_FIELDS)[number]["kind"], cell: string) {
  if (kind === "date") return parseReportDate(cell) || cell.trim();
  if (kind === "amount") { const amount = parseAmount(cell); return amount === null ? cell.trim() : amount.toFixed(2); }
  return cell.trim();
}

export function validateMapping(values: Record<string, string>) {
  const errors: Record<string, string> = {};
  if (!values.client_id) errors.client_id = "Pick the TAP Hub client this customer is.";
  if (!values.customer_name?.trim()) errors.customer_name = "Enter the customer name shown on the report.";
  if (parseAmount(values.open_balance || "") === null) errors.open_balance = "Enter the open balance, like 1250.00.";
  for (const name of ["transaction_date", "due_date"]) {
    if (values[name] && !parseReportDate(values[name])) errors[name] = "Use a real date (YYYY-MM-DD).";
  }
  if (values.reported_aging && !/^\d+$/.test(values.reported_aging)) errors.reported_aging = "Whole days only.";
  if (values.confirmed !== "yes") errors.confirmed = "Confirm you checked these values against the PDF.";
  return errors;
}

/** A correction starts from what the reviewer confirmed before (never from a guess); it must be re-confirmed. */
function confirmedValues(existing: ImportInvoice | undefined): Record<string, string> {
  if (!existing) return {};
  const text = (value: string | number | null | undefined) => (value === null || value === undefined ? "" : String(value));
  return {
    client_id: text(existing.identity?.client_id), customer_name: existing.customer_name, invoice_number: text(existing.invoice_number),
    transaction_type: text(existing.transaction_type), transaction_date: text(existing.transaction_date), due_date: text(existing.due_date),
    terms: text(existing.terms), po_number: text(existing.po_number), reported_aging: text(existing.reported_aging),
    open_balance: text(existing.open_balance), linked_invoice_id: text(linkedBillingInvoiceId(existing)),
  };
}

export function InvoiceMappingForm({ row, existing, clients, billingInvoices, priorImports = [], onSubmit, onCancel }: {
  row: ImportRow;
  /** The invoice this line was already confirmed as, when correcting it. */
  existing?: ImportInvoice;
  clients: ClientOption[];
  billingInvoices: Receivable[];
  /** Invoices from earlier approved reports this line could be a newer snapshot of. */
  priorImports?: PriorImport[];
  onSubmit: (input: Parameters<BillingApi["reviewImportInvoice"]>[1]) => Promise<ApiResult<unknown>>;
  onCancel: () => void;
}) {
  const formId = useId();
  const cells = rowCells(row);
  const [values, setValues] = useState<Record<string, string>>(() => confirmedValues(existing));
  const [mappedFrom, setMappedFrom] = useState<Record<string, number>>({});
  const [active, setActive] = useState<MappingField>("customer_name");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<Failure | null>(null);
  const set = (name: string, value: string) => setValues((current) => ({ ...current, [name]: value }));
  const clientInvoices = useMemo(() => billingInvoices.filter((invoice) => invoice.client_id === values.client_id), [billingInvoices, values.client_id]);
  const linked = clientInvoices.find((invoice) => invoice.id === values.linked_invoice_id) || null;
  const pdfBalance = parseAmount(values.open_balance || "");
  const comparison = linked && pdfBalance !== null ? compareBalances(pdfBalance, linked.balance) : null;
  // A line already confirmed keeps its identity; only a new line can be matched to an earlier report.
  const canMatchPrior = !row.source_invoice_id;
  const clientPriors = priorImports.filter((item) => item.client_id === values.client_id);
  const prior = clientPriors.find((item) => item.source_invoice_id === values.existing_source_invoice_id) || null;
  const suggestion = canMatchPrior && !prior ? suggestPriorImport(priorImports, values.client_id, values.invoice_number, values.linked_invoice_id) : null;
  const change = prior && pdfBalance !== null ? compareBalances(pdfBalance, prior.balance) : null;
  function choosePrior(sourceInvoiceId: string) {
    const chosen = priorImports.find((item) => item.source_invoice_id === sourceInvoiceId);
    setValues((current) => ({
      ...current, existing_source_invoice_id: sourceInvoiceId,
      // An imported invoice's Billing link can't be reassigned, so it carries over.
      ...(chosen?.invoice_id ? { linked_invoice_id: chosen.invoice_id } : {}),
    }));
  }

  function fillFromCell(index: number) {
    const field = MAPPING_FIELDS.find((item) => item.name === active)!;
    set(field.name, fromCell(field.kind, cells[index]));
    setMappedFrom((current) => ({ ...current, [field.name]: index }));
    const next = MAPPING_FIELDS.slice(MAPPING_FIELDS.indexOf(field) + 1).find((item) => !values[item.name]);
    if (next) setActive(next.name);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const nextErrors = validateMapping(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setSubmitting(true);
    setServerError(null);
    const text = (name: string) => values[name]?.trim() || null;
    const result = await onSubmit({
      source_row_id: row.id,
      client_id: values.client_id,
      customer_name: values.customer_name.trim(),
      invoice_number: text("invoice_number"),
      transaction_type: text("transaction_type"),
      transaction_date: values.transaction_date ? parseReportDate(values.transaction_date) : null,
      due_date: values.due_date ? parseReportDate(values.due_date) : null,
      terms: text("terms"),
      po_number: text("po_number"),
      reported_aging: values.reported_aging ? Number(values.reported_aging) : null,
      open_balance: parseAmount(values.open_balance)!,
      linked_invoice_id: values.linked_invoice_id || null,
      existing_source_invoice_id: canMatchPrior ? values.existing_source_invoice_id || null : null,
      confirmed: true,
      // Keep the extracted cells and which cell fed each field, for provenance.
      row_data: { cells, mapped_from: mappedFrom },
    });
    setSubmitting(false);
    setServerError(failureOf(result));
  }

  const fieldError = (name: string) => errors[name] ? <div id={`${formId}-${name}-error`} data-field-error={name} style={{ color: "var(--red)", fontSize: 12, marginTop: 3 }}>{errors[name]}</div> : null;
  return (
    <form onSubmit={submit} noValidate data-mapping-form={row.id} style={{ padding: "6px 2px" }}>
      <div className="bc-label">Cells read from this line — click one to fill <b style={{ color: "var(--navy)" }}>{MAPPING_FIELDS.find((item) => item.name === active)?.label}</b></div>
      <div className="bc-inline" style={{ gap: 6, marginBottom: 12 }}>
        {cells.map((cell, index) => (
          <button key={index} type="button" className="bc-btn quiet" data-cell={index} style={{ padding: "3px 9px", fontSize: 12, fontWeight: 500 }} onClick={() => fillFromCell(index)}>{cell}</button>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "4px 12px" }}>
        <label className="bc-field" style={{ gridColumn: "1 / -1" }}>
          <span>TAP Hub client</span>
          <select className="bc-in" data-field="client_id" value={values.client_id || ""} aria-invalid={errors.client_id ? true : undefined}
            onChange={(event) => { const clientId = event.target.value; setValues((current) => ({ ...current, client_id: clientId, linked_invoice_id: "", existing_source_invoice_id: "" })); }}>
            <option value="">Select the client…</option>
            {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
          </select>
          {fieldError("client_id")}
        </label>
        {MAPPING_FIELDS.map((field) => (
          <label key={field.name} className="bc-field">
            <span>{field.label}{field.required ? "" : " (optional)"}</span>
            <input
              className="bc-in"
              data-field={field.name}
              inputMode={field.kind === "amount" ? "decimal" : field.kind === "days" ? "numeric" : undefined}
              placeholder={field.kind === "date" ? "YYYY-MM-DD" : undefined}
              value={values[field.name] || ""}
              aria-invalid={errors[field.name] ? true : undefined}
              aria-describedby={errors[field.name] ? `${formId}-${field.name}-error` : undefined}
              onFocus={() => setActive(field.name)}
              onChange={(event) => { set(field.name, event.target.value); setMappedFrom((current) => { const next = { ...current }; delete next[field.name]; return next; }); }}
              style={active === field.name ? { borderColor: "var(--navy)" } : undefined}
            />
            {fieldError(field.name)}
          </label>
        ))}
        {canMatchPrior && clientPriors.length ? (
          <label className="bc-field" style={{ gridColumn: "1 / -1" }}>
            <span>Same invoice as an earlier report (optional)</span>
            <select className="bc-in" data-field="existing_source_invoice_id" value={values.existing_source_invoice_id || ""}
              onChange={(event) => (event.target.value ? choosePrior(event.target.value) : set("existing_source_invoice_id", ""))}>
              <option value="">New to Collections</option>
              {clientPriors.map((item) => (
                <option key={item.source_invoice_id} value={item.source_invoice_id}>
                  {item.invoice_number} · {formatMoney(item.balance)}{item.source_as_of ? ` · report as of ${item.source_as_of}` : ""}{item.invoice_id ? " · linked to Billing" : ""}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {suggestion ? (
          <div className="bc-gatebox" data-prior-suggestion={suggestion.source_invoice_id} style={{ gridColumn: "1 / -1", padding: "8px 12px", fontSize: 12.5 }}>
            This looks like <b>{suggestion.invoice_number}</b> from {suggestion.source_as_of ? `the report as of ${suggestion.source_as_of}` : "an earlier report"} ({formatMoney(suggestion.balance)}).
            {" "}If it&rsquo;s the same invoice, link them so its history, holds and reminders carry over instead of starting again.{" "}
            <button type="button" className="bc-btn quiet" style={{ padding: "3px 9px", fontSize: 12 }} onClick={() => choosePrior(suggestion.source_invoice_id)}>Same invoice</button>
          </div>
        ) : null}
        <label className="bc-field" style={{ gridColumn: "1 / -1" }}>
          <span>Same invoice in Billing (optional)</span>
          <select className="bc-in" data-field="linked_invoice_id" value={values.linked_invoice_id || ""} disabled={!values.client_id || Boolean(prior?.invoice_id)} onChange={(event) => set("linked_invoice_id", event.target.value)}>
            <option value="">{values.client_id ? (clientInvoices.length ? "Not in Billing" : "This client has no open Billing invoices") : "Pick the client first"}</option>
            {clientInvoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.invoice_number} · {formatMoney(invoice.balance)} open</option>)}
          </select>
        </label>
      </div>
      {prior?.invoice_id ? <p className="bc-small" data-prior-billing-link style={{ margin: "0 0 8px" }}>The earlier import is already linked to this Billing invoice, so the link carries over.</p> : null}
      {change ? (
        <div className="bc-source" data-prior-change={change.matches ? "same" : "changed"} style={{ margin: "4px 0 10px" }}>
          Earlier report{prior?.source_as_of ? ` (as of ${prior.source_as_of})` : ""} {formatMoney(change.billing.toFixed(2))} → this report {formatMoney(change.pdf.toFixed(2))}
          {change.matches ? ": unchanged." : <>: <b>{formatMoney(change.difference.toFixed(2))}</b>. The earlier value is kept in the history.</>}
        </div>
      ) : null}
      {comparison ? (
        <div className="bc-source" data-balance-math={comparison.matches ? "match" : "differs"} style={{ margin: "4px 0 10px" }}>
          Report {formatMoney(comparison.pdf.toFixed(2))} − Billing {formatMoney(comparison.billing.toFixed(2))} = <b>{formatMoney(comparison.difference.toFixed(2))}</b>.{" "}
          {comparison.matches ? "The balances agree." : "Because they differ, this invoice will be blocked after approval until someone with approve permission picks the balance to use."}
        </div>
      ) : null}
      <label className="bc-inline" style={{ fontSize: 13, margin: "6px 0" }}>
        <input type="checkbox" data-field="confirmed" checked={values.confirmed === "yes"} onChange={(event) => set("confirmed", event.target.checked ? "yes" : "")} />
        I checked these values against the PDF.
      </label>
      {fieldError("confirmed")}
      {serverError ? <ImportError error={serverError} /> : null}
      <div className="bc-inline" style={{ marginTop: 8 }}>
        <button type="submit" className="bc-btn" disabled={submitting}>{submitting ? "Saving…" : "Confirm invoice"}</button>
        <button type="button" className="bc-btn quiet" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export function ConfirmedInvoices({ invoices, revisions = [], clientNames, billingById }: { invoices: ImportInvoice[]; revisions?: ImportBatchDetail["revisions"]; clientNames: Record<string, string>; billingById: Map<string, Receivable> }) {
  return (
    <section aria-label="Confirmed invoices" style={{ marginTop: 18 }}>
      <h4 className="bc-h">Confirmed invoices <small>{invoices.length}</small></h4>
      <div className="bc-scroll">
        <table className="bc-table sm" data-import-invoices>
          <thead><tr><th>Invoice</th><th>Customer → client</th><th>Due</th><th className="r">Report balance</th><th>Billing</th><th>Status</th></tr></thead>
          <tbody>
            {invoices.map((invoice) => {
              const billingId = linkedBillingInvoiceId(invoice);
              const billing = billingId ? billingById.get(billingId) : undefined;
              const earlier = earlierBalance(invoice, revisions);
              const comparison = billing ? compareBalances(invoice.open_balance, billing.balance) : null;
              return (
                <tr key={invoice.source_invoice_id} data-import-invoice={invoice.source_invoice_id} data-discrepancy={invoice.discrepancy_status}>
                  <td className="bc-nowrap">{invoice.invoice_number || "(no number)"}</td>
                  <td>{invoice.customer_name}<div className="bc-small">{invoice.identity?.client_id ? `→ ${clientNames[invoice.identity.client_id] || "TAP Hub client"}` : "→ client saved with the review"}</div></td>
                  <td className="bc-nowrap">{invoice.due_date || "—"}</td>
                  <td className="r">
                    {formatMoney(invoice.open_balance)}
                    {earlier ? <div className="bc-small" data-earlier-balance={earlier.balance}>was {formatMoney(earlier.balance)}{earlier.source_as_of ? ` (as of ${earlier.source_as_of})` : ""}</div> : null}
                  </td>
                  <td>
                    {billing && comparison ? (
                      <span data-billing-math={comparison.matches ? "match" : "differs"}>
                        {billing.invoice_number} · {formatMoney(billing.balance)}
                        <div className="bc-small">{comparison.matches ? "Same balance" : `Differs by ${formatMoney(comparison.difference.toFixed(2))}`}</div>
                      </span>
                    ) : billingId ? <span className="bc-small">Linked Billing invoice (not open)</span> : <span className="bc-small">Report only</span>}
                  </td>
                  <td>
                    <span className={`bc-pill ${invoice.discrepancy_status === "blocked" ? "red" : invoice.review_status === "approved" ? "green" : invoice.review_status === "ready" ? "navy" : "amber"}`}>
                      {invoice.discrepancy_status === "blocked" ? "Blocked: balances differ" : invoice.discrepancy_status === "resolved" ? (invoice.identity?.selected_source === "billing" ? "Using Billing's balance" : invoice.identity?.selected_source === "pdf_import" ? "Using the report's balance" : "Balance chosen") : invoice.review_status === "ready" ? "Ready" : invoice.review_status === "approved" ? "Approved" : invoice.review_status.replace(/_/g, " ")}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function ApprovalBox({ detail, viewer, pendingSummaries = [], onApprove }: { detail: ImportBatchDetail; viewer: Viewer | null; pendingSummaries?: ImportBatch[]; onApprove: () => Promise<ApiResult<unknown>> }) {
  const checks = approvalChecklist(detail, viewer?.id || null);
  const ready = checks.every((check) => check.ok);
  const [pending, setPending] = useState(false);
  return (
    <section className="bc-gatebox" aria-label="Approve this report" data-approval-box={ready ? "ready" : "blocked"} style={{ marginTop: 18 }}>
      <h4 className="bc-sect">Approve for Collections</h4>
      <p className="bc-hint">Approval puts these invoices on the call list. It needs approve permission (Owner/Admin by default) and must be someone other than the uploader or anyone who reviewed lines in this report.</p>
      <ul style={{ listStyle: "none", padding: 0, margin: "0 0 10px", fontSize: 13 }}>
        {checks.map((check) => (
          <li key={check.id} data-approval-check={check.id} data-ok={check.ok} style={{ color: check.ok ? "var(--green)" : "var(--gate-ink)", padding: "2px 0" }}>
            {check.ok ? "✓" : "•"} {check.label}
          </li>
        ))}
      </ul>
      {pendingSummaries.length ? (
        <p className="bc-small" data-pending-summary style={{ margin: "0 0 6px", color: "var(--gate-ink)" }}>
          Summary report{pendingSummaries.length === 1 ? "" : "s"} for this date: {pendingSummaries.map((item) => item.original_filename).join(", ")}. Open it and compare totals; this report can be approved once they match.
        </p>
      ) : null}
      <p className="bc-small" style={{ margin: "0 0 10px" }}>If a summary report for the same date is uploaded, it must be cross-checked against this report first. Whoever corrected the report type or date can&rsquo;t approve it either.</p>
      <button type="button" className="bc-btn" disabled={!ready || pending} onClick={async () => { setPending(true); await onApprove(); setPending(false); }}>
        {pending ? "Approving…" : "Approve report"}
      </button>
    </section>
  );
}

export function CrossCheckForm({ api, batch, batches, onDone }: { api: BillingApi; batch: ImportBatch; batches: ImportBatch[]; onDone: () => Promise<void> }) {
  // The server compares against a detail report that is still in review: the cross-check
  // gates that report's approval, so an approved one can't be checked any more.
  const sameDate = batches.filter((item) => item.report_type === "aging_detail" && item.source_as_of === batch.source_as_of && item.id !== batch.id);
  const details = sameDate.filter((item) => item.status === "needs_review");
  const [detailId, setDetailId] = useState(batch.metadata?.detail_cross_check?.detail_batch_id || "");
  const [total, setTotal] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<Failure | null>(null);
  const [pending, setPending] = useState(false);
  const last = batch.metadata?.detail_cross_check;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const amount = parseAmount(total);
    if (!detailId || amount === null || note.trim().length < 8) {
      setError({ kind: "invalid", message: "Pick the detail report, enter the summary's total exactly as printed, and add a short note (8+ characters)." });
      return;
    }
    setPending(true);
    const result = await api.crossCheckImport(batch.id, { detail_batch_id: detailId, summary_total: amount, note: note.trim() });
    setPending(false);
    if (result.ok === false) { setError(failureOf(result)); return; }
    await onDone();
  }

  return (
    <section className="bc-gatebox" aria-label="Cross-check against a detail report" data-cross-check style={{ marginTop: 18 }}>
      <h4 className="bc-sect">Cross-check against the detail report</h4>
      <p className="bc-hint">A summary report doesn&rsquo;t add invoices. Type the total it prints and compare it with the confirmed invoices of the detail report for the same date ({dateLabel(batch.source_as_of)}).</p>
      {last?.status ? (
        <div className="bc-source" data-cross-check-result={last.status}>
          Last check: summary {formatMoney(last.summary_reported_total)} − detail {formatMoney(last.detail_invoice_total)} = <b>{formatMoney(last.difference)}</b>{" "}
          <span className={`bc-pill ${last.status === "matched" ? "green" : "red"}`}>{last.status === "matched" ? "Matches" : "Doesn't match"}</span>
        </div>
      ) : null}
      {details.length === 0 ? (
        <p className="bc-small" data-cross-check-empty>
          {sameDate.length
            ? "The detail report for this date is already approved, so there is nothing left to cross-check. Cross-check before approving the detail report next time."
            : "No detail report with this as-of date has been uploaded yet. Upload it, confirm its invoices, then compare totals here before approving it."}
        </p>
      ) : (
        <form onSubmit={submit} noValidate>
          <label className="bc-field"><span>Detail report</span>
            <select className="bc-in" value={detailId} onChange={(event) => setDetailId(event.target.value)}>
              <option value="">Select…</option>
              {details.map((item) => <option key={item.id} value={item.id}>{item.original_filename} ({BATCH_STATUS_LABELS[item.status] || item.status})</option>)}
            </select>
          </label>
          <label className="bc-field"><span>Total printed on the summary</span>
            <input className="bc-in" inputMode="decimal" value={total} onChange={(event) => setTotal(event.target.value)} />
          </label>
          <label className="bc-field"><span>Note</span>
            <input className="bc-in" value={note} placeholder="Where you read the total" onChange={(event) => setNote(event.target.value)} />
          </label>
          {error ? <ImportError error={error} /> : null}
          <button type="submit" className="bc-btn" disabled={pending}>{pending ? "Checking…" : "Compare totals"}</button>
        </form>
      )}
    </section>
  );
}

export function DiscrepancyResolver({ invoice, billing, onResolve }: {
  invoice: ImportInvoice;
  billing: Receivable | null;
  onResolve: (input: { selected_source: "billing" | "pdf_import"; resolution_note: string }) => Promise<ApiResult<unknown>>;
}) {
  const [source, setSource] = useState<"billing" | "pdf_import" | "">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<Failure | null>(null);
  const [pending, setPending] = useState(false);
  const comparison = billing ? compareBalances(invoice.open_balance, billing.balance) : null;
  const name = useId();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!source) { setError("Choose which balance to use."); return; }
    if (note.trim().length < 8) { setError("Explain the reconciliation in a sentence (8+ characters)."); return; }
    setError(null);
    setServerError(null);
    setPending(true);
    const result = await onResolve({ selected_source: source, resolution_note: note.trim() });
    setPending(false);
    setServerError(failureOf(result));
  }

  return (
    <form onSubmit={submit} noValidate className="bc-cfgcard" data-resolve={invoice.source_invoice_id} style={{ marginBottom: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Invoice {invoice.invoice_number || "(no number)"} · {invoice.customer_name}</div>
      {comparison ? (
        <div className="bc-source" data-balance-math="differs">
          Report (as of {invoice.source_as_of}) {formatMoney(comparison.pdf.toFixed(2))} − Billing today {formatMoney(comparison.billing.toFixed(2))} = <b>{formatMoney(comparison.difference.toFixed(2))}</b>
        </div>
      ) : <p className="bc-hint">The linked Billing invoice isn&rsquo;t open, so its balance isn&rsquo;t shown here. Check it in Billing before choosing.</p>}
      <div role="radiogroup" aria-label="Balance to use" style={{ display: "grid", gap: 4, margin: "6px 0 8px", fontSize: 13 }}>
        <label className="bc-inline"><input type="radio" name={name} checked={source === "billing"} onChange={() => setSource("billing")} /> Use Billing&rsquo;s balance{billing ? ` (${formatMoney(billing.balance)})` : ""}</label>
        <label className="bc-inline"><input type="radio" name={name} checked={source === "pdf_import"} onChange={() => setSource("pdf_import")} /> Use the report&rsquo;s balance ({formatMoney(invoice.open_balance)})</label>
      </div>
      <label className="bc-field"><span>Why</span>
        <input className="bc-in" value={note} placeholder="e.g. Payment of $25 posted after the report date" onChange={(event) => setNote(event.target.value)} />
      </label>
      {error ? <div role="alert" style={{ color: "var(--red)", fontSize: 12.5, marginBottom: 6 }}>{error}</div> : null}
      {serverError ? <ImportError error={serverError} /> : null}
      <button type="submit" className="bc-btn" disabled={pending}>{pending ? "Saving…" : "Use this balance"}</button>
    </form>
  );
}

/** Owner/Admin: which staff roles may upload, review and approve A/R reports. */
export function ImportPermissionsPanel({ api }: { api: BillingApi }) {
  const [state, setState] = useState<Load<ImportPolicy>>({ status: "loading" });
  const [draft, setDraft] = useState<ImportPolicy | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Failure | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let current = true;
    api.importPermissions().then((result) => {
      if (!current) return;
      if (result.ok) { setState({ status: "ready", data: result.data.policy }); setDraft(result.data.policy); }
      else setState({ status: "error", error: failureOf(result)! });
    });
    return () => { current = false; };
  }, [api]);

  if (state.status === "loading") return <p role="status" className="bc-hint">Loading report permissions…</p>;
  if (state.status === "error") return <ImportError error={state.error} />;
  const policy = draft || state.data;
  const changed = JSON.stringify(policy) !== JSON.stringify(state.data);

  return (
    <div data-import-permissions>
      <div className="bc-scroll">
        <table className="bc-table sm">
          <thead><tr><th>Action</th><th>Owner / Admin</th>{DELEGABLE_ROLES.map((item) => <th key={item.role}>{item.label}</th>)}</tr></thead>
          <tbody>
            {IMPORT_ACTIONS.map(({ action, label, hint }) => (
              <tr key={action} data-permission-action={action}>
                <td><b>{label}</b><div className="bc-small">{hint}</div></td>
                <td><input type="checkbox" checked disabled aria-label={`Owner and Admin: ${label} (always on)`} /></td>
                {DELEGABLE_ROLES.map(({ role, label: roleLabel }) => (
                  <td key={role}>
                    <input
                      type="checkbox"
                      data-permission={`${action}:${role}`}
                      aria-label={`${roleLabel}: ${label}`}
                      checked={(policy[action] || []).includes(role)}
                      onChange={(event) => { setSaved(false); setDraft(togglePolicy(policy, action, role, event.target.checked)); }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="bc-small" style={{ margin: "8px 0" }}>
        Whoever uploads a report, or reviews any of its lines, can never approve that same report, whatever this table says.
        A person with both Collections and Billing access follows the Collections staff column.
      </p>
      {error ? <ImportError error={error} /> : null}
      <div className="bc-inline">
        <button type="button" className="bc-btn" disabled={!changed || saving} onClick={async () => {
          setSaving(true);
          setError(null);
          const result = await api.updateImportPermissions(policy);
          setSaving(false);
          if (result.ok === false) { setError(failureOf(result)); return; }
          setState({ status: "ready", data: result.data.policy });
          setDraft(result.data.policy);
          setSaved(true);
        }}>{saving ? "Saving…" : "Save permissions"}</button>
        {changed ? <button type="button" className="bc-btn quiet" onClick={() => setDraft(state.data)}>Discard changes</button> : null}
        {saved && !changed ? <span role="status" className="bc-small">Saved.</span> : null}
      </div>
    </div>
  );
}
