"use client";

import type { ApiResult } from "@/lib/billing-ui/api";
import type { Invoice, Payment, Receivable, Viewer } from "@/lib/billing-ui/types";
import { PAYMENT_METHODS, validateAllocation, validatePayment, validateReason } from "@/lib/billing-ui/validation";
import { AGING_LABELS, formatMoney, receivableFor, viewerIsPowerUser } from "@/lib/billing-ui/view-model";
import { ActionButton, cellStyle, hintStyle, LedgerForm, OwnerAdminOnly, StatusBadge, tableStyle, type FormValues } from "./ui";

type Mutation = Promise<ApiResult<unknown>>;

export interface PaymentHandlers {
  onRecord: (values: FormValues) => Mutation;
  onAllocate: (values: FormValues) => Mutation;
  onReversePayment: (paymentId: string, reason: string) => Mutation;
  onReverseAllocation: (allocationId: string) => Mutation;
}

export function PaymentsPanel({ payments, invoices, receivables, clientId, clientNames, viewer, handlers }: {
  payments: Payment[];
  invoices: Invoice[];
  receivables: Receivable[];
  clientId: string | null;
  clientNames: Record<string, string>;
  viewer: Viewer | null;
  handlers: PaymentHandlers;
}) {
  const power = viewerIsPowerUser(viewer);
  const invoiceNumber = (id: string) => invoices.find((invoice) => invoice.id === id)?.invoice_number || id;
  const recordedForClient = payments.filter((payment) => payment.status === "recorded" && payment.client_id === clientId);
  const issuedForClient = invoices.filter((invoice) => invoice.status === "issued" && invoice.client_id === clientId);

  return (
    <div>
      {payments.length === 0 ? <p style={hintStyle}>No payments recorded.</p> : (
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={cellStyle}>Received</th>
                <th style={cellStyle}>Client</th>
                <th style={cellStyle}>Amount</th>
                <th style={cellStyle}>Method</th>
                <th style={cellStyle}>Status</th>
                <th style={cellStyle}>Allocations</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id} data-payment-row={payment.id}>
                  <td style={cellStyle}>{payment.received_on}</td>
                  <td style={cellStyle}>{clientNames[payment.client_id] || payment.client_id}</td>
                  <td style={cellStyle}>{formatMoney(payment.amount)}</td>
                  <td style={cellStyle}>{payment.method}{payment.reference ? ` · ${payment.reference}` : ""}</td>
                  <td style={cellStyle}>
                    <StatusBadge status={payment.status} />
                    {payment.status === "recorded" && power ? (
                        <details data-reverse-payment>
                          <summary style={{ cursor: "pointer", fontSize: 12.5, color: "var(--red)" }}>Reverse</summary>
                          <LedgerForm
                            fields={[{ name: "reason", label: "Reason", type: "textarea" }]}
                            initialValues={{ reason: "" }}
                            validate={(values) => validateReason(values.reason)}
                            onSubmit={(values) => handlers.onReversePayment(payment.id, values.reason)}
                            submitLabel="Reverse payment"
                          />
                        </details>
                    ) : null}
                  </td>
                  <td style={cellStyle}>
                    {(payment.payment_allocations || []).length === 0 ? "—" : (
                      <ul style={{ margin: 0, paddingLeft: 16 }}>
                        {payment.payment_allocations.map((allocation) => (
                          <li key={allocation.id} data-allocation={allocation.id} data-allocation-state={allocation.reversed_at ? "reversed" : "active"}>
                            {invoiceNumber(allocation.invoice_id)}: {formatMoney(allocation.amount)}
                            {allocation.reversed_at ? " (reversed)" : power
                              ? <> <ActionButton quiet label="Reverse" onAction={() => handlers.onReverseAllocation(allocation.id)} /></>
                              : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!power ? <p style={hintStyle}><OwnerAdminOnly action="Reversing a payment or an allocation" /></p> : null}

      {clientId ? (
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginTop: 12 }}>
          <section style={{ flex: "1 1 240px" }} aria-label="Record payment">
            <h3 style={{ fontSize: 14, margin: "6px 0" }}>Record payment</h3>
            <LedgerForm
              key={`pay-${clientId}`}
              fields={[
                { name: "received_on", label: "Received on", type: "date" },
                { name: "amount", label: "Amount (USD)", placeholder: "0.00" },
                { name: "method", label: "Method", type: "select", options: PAYMENT_METHODS.map((method) => ({ value: method, label: method.toUpperCase() })) },
                { name: "reference", label: "Reference", optional: true, placeholder: "Check number or transfer ID" },
              ]}
              initialValues={{ client_id: clientId, received_on: "", amount: "", method: "", reference: "" }}
              validate={validatePayment}
              onSubmit={handlers.onRecord}
              submitLabel="Record payment"
            />
          </section>
          <section style={{ flex: "1 1 240px" }} aria-label="Allocate payment">
            <h3 style={{ fontSize: 14, margin: "6px 0" }}>Allocate payment</h3>
            {recordedForClient.length === 0 || issuedForClient.length === 0 ? (
              <p style={hintStyle}>Allocation needs a recorded payment and an issued invoice for this client.</p>
            ) : (
              <LedgerForm
                key={`alloc-${clientId}`}
                fields={[
                  { name: "payment_id", label: "Payment", type: "select", options: recordedForClient.map((payment) => ({ value: payment.id, label: `${payment.received_on} · ${formatMoney(payment.amount)}` })) },
                  { name: "invoice_id", label: "Invoice", type: "select", options: issuedForClient.map((invoice) => {
                    const receivable = receivableFor(invoice.id, receivables);
                    return { value: invoice.id, label: `${invoice.invoice_number}${receivable ? ` · balance ${formatMoney(receivable.balance)}` : ""}` };
                  }) },
                  { name: "amount", label: "Amount (USD)", placeholder: "0.00" },
                ]}
                initialValues={{ payment_id: "", invoice_id: "", amount: "" }}
                validate={validateAllocation}
                onSubmit={handlers.onAllocate}
                submitLabel="Allocate"
              />
            )}
          </section>
        </div>
      ) : <p style={hintStyle}>Choose a client to record or allocate payments.</p>}
    </div>
  );
}

export function ReceivablesTable({ receivables, clientNames }: { receivables: Receivable[]; clientNames: Record<string, string> }) {
  if (receivables.length === 0) return <p style={hintStyle}>No open receivables.</p>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={cellStyle}>Invoice</th>
            <th style={cellStyle}>Client</th>
            <th style={cellStyle}>Status</th>
            <th style={cellStyle}>Due</th>
            <th style={cellStyle}>Total</th>
            <th style={cellStyle}>Paid</th>
            <th style={cellStyle}>Balance</th>
            <th style={cellStyle}>Days past due</th>
            <th style={cellStyle}>Aging</th>
          </tr>
        </thead>
        <tbody>
          {receivables.map((row) => (
            <tr key={row.id} data-receivable-row={row.id}>
              <td style={cellStyle}>{row.invoice_number}</td>
              <td style={cellStyle}>{clientNames[row.client_id] || row.client_id}</td>
              <td style={cellStyle}><StatusBadge status={row.status} /></td>
              <td style={cellStyle}>{row.due_date}</td>
              <td style={cellStyle}>{formatMoney(row.total)}</td>
              <td style={cellStyle}>{formatMoney(row.allocated)}</td>
              <td style={cellStyle}><strong>{formatMoney(row.balance)}</strong></td>
              <td style={{ ...cellStyle, color: row.days_past_due > 0 ? "var(--red)" : undefined }}>{row.days_past_due}</td>
              <td style={cellStyle} data-aging={row.aging_bucket || ""}>{row.aging_bucket ? AGING_LABELS[row.aging_bucket] || row.aging_bucket : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
