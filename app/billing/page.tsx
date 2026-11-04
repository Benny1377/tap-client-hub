"use client";

import { useMemo, useState, type ReactNode } from "react";
import { readyData } from "@/lib/billing-ui/ledger";
import type { Invoice, Payment, Receivable } from "@/lib/billing-ui/types";
import { receivableFor } from "@/lib/billing-ui/view-model";
import { useLedger } from "@/components/billing/use-ledger";
import { ClientPicker, hintStyle, SectionView, SegFilter, StatCard, StatRow } from "@/components/billing/ui";
import { InvoiceDetail, InvoiceList, NewInvoiceForm } from "@/components/billing/invoice-panels";
import { ClientAgingSummary, PaymentsPanel, ReceivablesTable } from "@/components/billing/payment-panels";

// The design splits Billing into tabs; these are the ones with a live backend.
const TABS = [
  { id: "invoices", label: "Invoices" },
  { id: "payments", label: "Payments" },
  { id: "receivables", label: "Receivables" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const INVOICE_FILTERS = [
  { id: "all", label: "All" },
  { id: "draft", label: "Drafts" },
  { id: "open", label: "Open" },
  { id: "paid", label: "Paid" },
  { id: "void", label: "Void" },
] as const;
type InvoiceFilter = (typeof INVOICE_FILTERS)[number]["id"];

// Paid and open are read off the server's balance for the invoice; nothing here adds or subtracts money.
function matchesFilter(invoice: Invoice, filter: InvoiceFilter, receivables: Receivable[]) {
  if (filter === "all") return true;
  if (filter === "draft" || filter === "void") return invoice.status === filter;
  if (invoice.status !== "issued") return false;
  const receivable = receivableFor(invoice.id, receivables);
  if (!receivable) return false;
  const stillOwed = Number(receivable.balance) > 0;
  return filter === "open" ? stillOwed : !stillOwed;
}

function TabPanel({ id, active, children }: { id: TabId; active: TabId; children: ReactNode }) {
  return <div role="tabpanel" id={`billing-${id}`} aria-labelledby={`billing-tab-${id}`} hidden={id !== active}>{children}</div>;
}

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

export default function BillingPage() {
  const [tab, setTab] = useState<TabId>("invoices");
  const [clientId, setClientId] = useState<string | null>(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [filter, setFilter] = useState<InvoiceFilter>("all");
  const { api, viewer, clients, state, mutate } = useLedger(clientId, ["invoices", "receivables", "payments"]);
  const clientNames = useMemo(() => Object.fromEntries(clients.map((client) => [client.id, client.name])), [clients]);
  const invoices = readyData(state.invoices, []);
  const payments: Payment[] = readyData(state.payments, []);
  const receivables = readyData(state.receivables, { receivables: [] }).receivables;
  const selectedInvoice = invoices.find((invoice) => invoice.id === selectedInvoiceId) || null;
  const drafts = invoices.filter((invoice) => invoice.status === "draft").length;
  const issued = invoices.filter((invoice) => invoice.status === "issued").length;
  const openCount = receivables.filter((row) => Number(row.balance) > 0).length;
  const pastDueCount = receivables.filter((row) => row.days_past_due > 0).length;
  const withMoneyLeft = payments.filter((payment) => payment.status === "recorded" && Number(payment.unallocated_amount ?? 0) > 0).length;
  const reversedPayments = payments.filter((payment) => payment.status === "reversed").length;
  const visibleInvoices = invoices.filter((invoice) => matchesFilter(invoice, filter, receivables));

  return (
    <div className="bc-page">
      <div className="bc-tabrow">
        <div className="bc-subnav" role="tablist" aria-label="Billing views">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`billing-tab-${item.id}`}
              aria-controls={`billing-${item.id}`}
              aria-selected={tab === item.id}
              className="bc-snb"
              onClick={() => setTab(item.id)}
            >
              {item.label}
              {item.id === "invoices" && drafts > 0 ? <span className="bc-count" aria-label={`${drafts} drafts`}>{drafts}</span> : null}
            </button>
          ))}
        </div>
        <ClientPicker clients={clients} value={clientId} onChange={(id) => { setClientId(id); setSelectedInvoiceId(null); }} />
      </div>

      <TabPanel id="invoices" active={tab}>
        <StatRow label="Invoice summary">
          <StatCard testId="drafts" label="Drafts" value={drafts} note={drafts ? "waiting to be issued" : "nothing waiting"} />
          <StatCard testId="issued" label="Issued" value={issued} note="locked; correct by voiding" />
          <StatCard testId="open" label="Open" value={openCount} note="issued, still owed" />
          <StatCard testId="past-due" label="Past due" value={pastDueCount} tone={pastDueCount ? "red" : undefined} note={pastDueCount ? "Collections is on these" : "none past due"} />
        </StatRow>

        <div className="controls">
          <SegFilter label="Filter invoices" options={[...INVOICE_FILTERS]} value={filter} onChange={(next) => { setFilter(next); setSelectedInvoiceId(null); }} />
        </div>

        <section aria-label="Invoices">
          <SectionView state={state.invoices} label="invoices">
            {() => <InvoiceList invoices={visibleInvoices} receivables={receivables} clientNames={clientNames} selectedId={selectedInvoiceId} onSelect={setSelectedInvoiceId} />}
          </SectionView>
          {state.invoices.status === "ready" ? (
            clientId ? (
              <details className="card" style={{ marginTop: 16 }}>
                <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 13.5 }}>New draft invoice</summary>
                <NewInvoiceForm
                  clientId={clientId}
                  onCreate={async (values) => {
                    const result = await mutate(() => api.createInvoice({ client_id: clientId, invoice_number: values.invoice_number.trim(), issue_date: values.issue_date, due_date: values.due_date, memo: values.memo.trim() || null }));
                    if (result.ok) { setFilter("all"); setSelectedInvoiceId(result.data.invoice.id); }
                    return result;
                  }}
                />
              </details>
            ) : <p style={hintStyle}>Choose a client to create an invoice.</p>
          ) : null}
        </section>

        <section className="card" style={{ marginTop: 16 }} aria-label="Invoice detail">
          <h3>Invoice detail<span>{selectedInvoice ? selectedInvoice.invoice_number : "select an invoice"}</span></h3>
          {selectedInvoice ? (
            <InvoiceDetail
              key={selectedInvoice.id}
              invoice={selectedInvoice}
              receivable={receivableFor(selectedInvoice.id, receivables)}
              viewer={viewer}
              handlers={{
                onUpdate: (values) => mutate(() => api.updateInvoice(selectedInvoice.id, { invoice_number: values.invoice_number.trim(), issue_date: values.issue_date, due_date: values.due_date, memo: values.memo.trim() || null })),
                onAddLine: (values) => mutate(() => api.addLine({ invoice_id: selectedInvoice.id, description: values.description.trim(), quantity: values.quantity.trim() || "1", unit_amount: values.unit_amount.trim(), period: values.period || null })),
                onUpdateLine: (lineId, values) => mutate(() => api.updateLine(lineId, { description: values.description.trim(), quantity: values.quantity.trim(), unit_amount: values.unit_amount.trim(), period: values.period || null })),
                onDeleteLine: (lineId) => mutate(() => api.deleteLine(lineId)),
                onIssue: () => mutate(() => api.issueInvoice(selectedInvoice.id)),
                onDeleteDraft: async () => {
                  const result = await mutate(() => api.deleteDraftInvoice(selectedInvoice.id));
                  if (result.ok) setSelectedInvoiceId(null);
                  return result;
                },
                onVoid: (reason) => mutate(() => api.voidInvoice(selectedInvoice.id, reason.trim())),
              }}
            />
          ) : <p style={hintStyle}>Select an invoice to see its lines and actions.</p>}
        </section>
      </TabPanel>

      <TabPanel id="payments" active={tab}>
        <StatRow label="Payment summary">
          <StatCard testId="payments-total" label="Payments" value={payments.length} note={plural(payments.filter((payment) => payment.status === "recorded").length, "recorded payment")} />
          <StatCard testId="payments-left" label="Money left to apply" value={withMoneyLeft} tone={withMoneyLeft ? "amber" : undefined} note={withMoneyLeft ? `${plural(withMoneyLeft, "payment")} not fully allocated` : "everything is allocated"} />
          <StatCard testId="payments-reversed" label="Reversed" value={reversedPayments} note="kept for the audit trail" />
        </StatRow>
        <section aria-label="Payments">
          <SectionView state={state.payments} label="payments">
            {(rows) => (
              <PaymentsPanel
                payments={rows}
                invoices={invoices}
                receivables={receivables}
                clientId={clientId}
                clientNames={clientNames}
                viewer={viewer}
                handlers={{
                  onRecord: (values) => mutate(() => api.recordPayment({ client_id: values.client_id, received_on: values.received_on, amount: values.amount.trim(), method: values.method, reference: values.reference.trim() || null })),
                  onAllocate: (values) => mutate(() => api.allocate({ payment_id: values.payment_id, invoice_id: values.invoice_id, amount: values.amount.trim() })),
                  onReversePayment: (paymentId, reason) => mutate(() => api.reversePayment(paymentId, reason.trim())),
                  onReverseAllocation: (allocationId) => mutate(() => api.reverseAllocation(allocationId)),
                }}
              />
            )}
          </SectionView>
        </section>
      </TabPanel>

      <TabPanel id="receivables" active={tab}>
        <section aria-label="Receivables">
          <SectionView state={state.receivables} label="receivables">
            {(data) => (
              <>
                {clientId ? (
                  <ClientAgingSummary aging={(data.client_aging || []).find((row) => row.client_id === clientId) || null} />
                ) : (
                  <StatRow label="Receivables summary">
                    <StatCard testId="receivables-open" label="Open invoices" value={openCount} note="issued, still owed" />
                    <StatCard testId="receivables-past-due" label="Past due" value={pastDueCount} tone={pastDueCount ? "red" : undefined} note={pastDueCount ? "see the days past due below" : "none past due"} />
                    <StatCard testId="receivables-as-of" label="As of" value={data.as_of_date || "—"} note="the firm date" />
                  </StatRow>
                )}
                {clientId && data.as_of_date ? <p style={hintStyle}>As of {data.as_of_date} (firm date).</p> : null}
                <ReceivablesTable receivables={data.receivables} clientNames={clientNames} />
              </>
            )}
          </SectionView>
        </section>
      </TabPanel>
    </div>
  );
}
