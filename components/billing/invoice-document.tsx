"use client";

import type { BillingPresentation, Invoice, Receivable } from "@/lib/billing-ui/types";
import { formatMoney } from "@/lib/billing-ui/view-model";

export type Remittance = { payeeName: string | null; address: string | null; instructions: string | null };

/** The invoice as the client reads it. Every amount shown is the server's; a draft's total stays blank until it has a server figure. */
export function InvoiceDocument({ invoice, clientName, receivable, remittance, presentation }: { invoice: Invoice; clientName: string; receivable: Receivable | null; remittance: Remittance | null; presentation: BillingPresentation | null }) {
  const lines = [...(invoice.invoice_lines || [])].sort((a, b) => a.sort_order - b.sort_order);
  const snapshot = (invoice as Invoice & { remittance_snapshot?: Partial<Remittance> & { payee_name?: string | null } | null }).remittance_snapshot;
  const pay = snapshot ? { payeeName: snapshot.payeeName ?? snapshot.payee_name ?? null, address: snapshot.address ?? null, instructions: snapshot.instructions ?? null } : remittance;
  // A draft follows the current firm details. Issuing saves them on the invoice, so an issued invoice never changes afterwards;
  // invoices issued before that have no saved copy and show only their saved payee.
  const firm = invoice.status === "draft" ? presentation : invoice.presentation_snapshot ?? null;
  return (
    <div className="doc" data-invoice-document>
      <div className="doc-top">
        <div><div className="doc-brand">{firm?.firmName || pay?.payeeName || "Your firm"}</div>{firm?.tagline ? <div className="doc-tag">{firm.tagline}</div> : null}</div>
        <div>
          <div className="doc-title">INVOICE</div>
          <div className="doc-no">{invoice.invoice_number ? `#${invoice.invoice_number}` : "Draft"}</div>
          <div className="doc-dates">
            <div><span>Issued</span><b>{invoice.issue_date ?? "On issue"}</b></div>
            <div><span>Due</span><b>{invoice.due_date ?? "On issue"}</b></div>
          </div>
        </div>
      </div>
      <div className="doc-parties">
        <div><div className="doc-lbl">Bill to</div><div className="doc-party"><b>{clientName}</b></div></div>
      </div>
      <div className="scroll">
        <table className="doc-t">
          <thead><tr><th>Description</th><th className="r">Qty</th><th className="r">Rate</th><th className="r">Amount</th></tr></thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id}>
                <td><div className="doc-desc">{line.description}</div>{line.period ? <div className="doc-sub">{line.period}</div> : null}</td>
                <td className="r num">{String(line.quantity)}</td>
                <td className="r num">{formatMoney(line.unit_amount)}</td>
                <td className="r num"><b>{formatMoney(line.amount)}</b></td>
              </tr>
            ))}
            {lines.length === 0 ? <tr><td colSpan={4} style={{ color: "var(--muted)" }}>No lines yet.</td></tr> : null}
          </tbody>
        </table>
      </div>
      {receivable ? (
        <div className="doc-tot">
          <div><span>Total</span><b className="num">{formatMoney(receivable.total)}</b></div>
          {Number(receivable.allocated) > 0 ? <div><span>Paid</span><b className="num" style={{ color: "var(--green)" }}>− {formatMoney(receivable.allocated)}</b></div> : null}
          <div className="gr"><span>Balance due</span><span className="num">{formatMoney(receivable.balance)}</span></div>
        </div>
      ) : null}
      {pay && (pay.instructions || pay.address) ? (
        <div className="doc-box">
          <div className="doc-lbl">How to pay</div>
          {pay.instructions ? <div>{pay.instructions}</div> : null}
          {pay.address ? <div className="sub" style={{ marginTop: 4 }}>{pay.address}</div> : null}
        </div>
      ) : null}
      {invoice.memo ? <div className="doc-foot">{invoice.memo}</div> : null}
      {firm?.invoiceFooter ? <div className="doc-foot" data-invoice-footer>{firm.invoiceFooter}</div> : null}
    </div>
  );
}
