"use client";

import type { ApiResult } from "@/lib/billing-ui/api";
import type { Invoice, Receivable, Viewer } from "@/lib/billing-ui/types";
import { validateInvoiceDraft, validateLine, validateReason } from "@/lib/billing-ui/validation";
import { formatMoney, invoiceActions, receivableFor } from "@/lib/billing-ui/view-model";
import { ActionButton, cellStyle, hintStyle, LedgerForm, OwnerAdminOnly, StatusBadge, tableStyle, type FormValues } from "./ui";

type Mutation = Promise<ApiResult<unknown>>;

export function InvoiceList({ invoices, receivables, clientNames, selectedId, onSelect }: {
  invoices: Invoice[];
  receivables: Receivable[];
  clientNames: Record<string, string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (invoices.length === 0) return <p style={hintStyle}>No invoices yet.</p>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={cellStyle}>Invoice</th>
            <th style={cellStyle}>Client</th>
            <th style={cellStyle}>Status</th>
            <th style={cellStyle}>Due</th>
            <th style={cellStyle}>Balance</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((invoice) => {
            const receivable = receivableFor(invoice.id, receivables);
            return (
              <tr key={invoice.id} data-invoice-row={invoice.id} style={invoice.id === selectedId ? { background: "var(--teal-soft)" } : undefined}>
                <td style={cellStyle}>
                  <button type="button" onClick={() => onSelect(invoice.id)} style={{ background: "none", border: 0, padding: 0, color: "var(--teal)", fontWeight: 600, cursor: "pointer" }}>
                    {invoice.invoice_number}
                  </button>
                </td>
                <td style={cellStyle}>{clientNames[invoice.client_id] || invoice.client_id}</td>
                <td style={cellStyle}><StatusBadge status={invoice.status} /></td>
                <td style={cellStyle}>{invoice.due_date}</td>
                <td style={cellStyle}>{receivable ? formatMoney(receivable.balance) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function NewInvoiceForm({ clientId, onCreate }: { clientId: string; onCreate: (values: FormValues) => Mutation }) {
  return (
    <LedgerForm
      key={clientId}
      fields={[
        { name: "invoice_number", label: "Invoice number", placeholder: "e.g. TAP-2026-0142" },
        { name: "issue_date", label: "Issue date", type: "date" },
        { name: "due_date", label: "Due date", type: "date" },
        { name: "memo", label: "Memo", type: "textarea", optional: true },
      ]}
      initialValues={{ client_id: clientId, invoice_number: "", issue_date: "", due_date: "", memo: "" }}
      validate={validateInvoiceDraft}
      onSubmit={onCreate}
      submitLabel="Create draft invoice"
    />
  );
}

export interface InvoiceDetailHandlers {
  onUpdate: (values: FormValues) => Mutation;
  onAddLine: (values: FormValues) => Mutation;
  onUpdateLine: (lineId: string, values: FormValues) => Mutation;
  onDeleteLine: (lineId: string) => Mutation;
  onIssue: () => Mutation;
  onVoid: (reason: string) => Mutation;
}

export function InvoiceDetail({ invoice, receivable, viewer, handlers }: {
  invoice: Invoice;
  receivable: Receivable | null;
  viewer: Viewer | null;
  handlers: InvoiceDetailHandlers;
}) {
  const actions = invoiceActions(invoice, viewer);
  const lines = [...(invoice.invoice_lines || [])].sort((a, b) => a.sort_order - b.sort_order);
  return (
    <div data-invoice-detail={invoice.id} data-lifecycle={invoice.status}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <strong style={{ fontSize: 16 }}>{invoice.invoice_number}</strong>
        <StatusBadge status={invoice.status} />
      </div>
      <p style={hintStyle}>
        Issued {invoice.issue_date} · Due {invoice.due_date}
        {receivable ? <> · Total {formatMoney(receivable.total)} · Paid {formatMoney(receivable.allocated)} · Balance <strong>{formatMoney(receivable.balance)}</strong>{receivable.days_past_due > 0 ? ` · ${receivable.days_past_due} days past due` : ""}</> : null}
      </p>
      {invoice.memo ? <p style={hintStyle}>{invoice.memo}</p> : null}
      {invoice.status === "issued" ? <p style={hintStyle}>Issued invoices are locked. To correct one, void it and issue a new invoice.</p> : null}
      {invoice.status === "void" ? <p style={hintStyle}>Voided {invoice.voided_at?.slice(0, 10)}{invoice.void_reason ? `: ${invoice.void_reason}` : ""}. Void invoices take no payments.</p> : null}

      <div style={{ overflowX: "auto" }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={cellStyle}>Description</th>
              <th style={cellStyle}>Period</th>
              <th style={cellStyle}>Qty</th>
              <th style={cellStyle}>Unit</th>
              <th style={cellStyle}>Amount</th>
              {actions.editable ? <th style={cellStyle} /> : null}
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr><td style={cellStyle} colSpan={actions.editable ? 6 : 5}>No lines yet.</td></tr>
            ) : lines.map((line) => (
              <tr key={line.id} data-line-row={line.id}>
                <td style={cellStyle}>{line.description}</td>
                <td style={cellStyle}>{line.period || "—"}</td>
                <td style={cellStyle}>{String(line.quantity)}</td>
                <td style={cellStyle}>{formatMoney(line.unit_amount)}</td>
                <td style={cellStyle}>{formatMoney(line.amount)}</td>
                {actions.editable ? (
                  <td style={cellStyle}>
                    <details>
                      <summary style={{ cursor: "pointer", fontSize: 12.5 }}>Edit</summary>
                      <LedgerForm
                        fields={lineFields}
                        initialValues={{ description: line.description, period: line.period || "", quantity: String(line.quantity), unit_amount: String(line.unit_amount) }}
                        validate={validateLine}
                        onSubmit={(values) => handlers.onUpdateLine(line.id, values)}
                        submitLabel="Save line"
                      />
                    </details>
                    <ActionButton quiet label="Remove" onAction={() => handlers.onDeleteLine(line.id)} />
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {actions.editable ? (
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginTop: 12 }}>
          <section style={{ flex: "1 1 240px" }} aria-label="Add line">
            <h3 style={{ fontSize: 14, margin: "6px 0" }}>Add line</h3>
            <LedgerForm
              key={`${invoice.id}-${lines.length}`}
              fields={lineFields}
              initialValues={{ invoice_id: invoice.id, description: "", period: "", quantity: "1", unit_amount: "" }}
              validate={validateLine}
              onSubmit={handlers.onAddLine}
              submitLabel="Add line"
            />
          </section>
          <section style={{ flex: "1 1 240px" }} aria-label="Edit draft">
            <h3 style={{ fontSize: 14, margin: "6px 0" }}>Edit draft</h3>
            <LedgerForm
              key={`${invoice.id}-header`}
              fields={[
                { name: "invoice_number", label: "Invoice number" },
                { name: "issue_date", label: "Issue date", type: "date" },
                { name: "due_date", label: "Due date", type: "date" },
                { name: "memo", label: "Memo", type: "textarea", optional: true },
              ]}
              initialValues={{ client_id: invoice.client_id, invoice_number: invoice.invoice_number, issue_date: invoice.issue_date, due_date: invoice.due_date, memo: invoice.memo || "" }}
              validate={validateInvoiceDraft}
              onSubmit={handlers.onUpdate}
              submitLabel="Save draft"
            />
          </section>
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap", marginTop: 14 }}>
        {invoice.status === "draft" ? (
          actions.canIssue
            ? <ActionButton label="Issue invoice" onAction={handlers.onIssue} />
            : <span data-issue-blocked style={{ fontSize: 12.5, color: "var(--muted)" }}>{actions.issueBlockedReason}</span>
        ) : null}
        {actions.canVoid ? (
          <details data-void-control>
            <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--red)", fontWeight: 600 }}>Void invoice</summary>
            <LedgerForm
              fields={[{ name: "reason", label: "Reason for voiding", type: "textarea" }]}
              initialValues={{ reason: "" }}
              validate={(values) => validateReason(values.reason)}
              onSubmit={(values) => handlers.onVoid(values.reason)}
              submitLabel="Void invoice"
            />
          </details>
        ) : null}
        {actions.voidRequiresOwnerAdmin ? <OwnerAdminOnly action="Voiding an invoice" /> : null}
      </div>
    </div>
  );
}

const lineFields = [
  { name: "description", label: "Description" },
  { name: "period", label: "Service period", type: "month" as const, optional: true },
  { name: "quantity", label: "Quantity" },
  { name: "unit_amount", label: "Unit amount (USD)", placeholder: "0.00" },
];
