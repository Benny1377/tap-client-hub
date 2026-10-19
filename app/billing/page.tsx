"use client";

import { useMemo, useState, type ReactNode } from "react";
import { readyData } from "@/lib/billing-ui/ledger";
import { receivableFor } from "@/lib/billing-ui/view-model";
import { useLedger } from "@/components/billing/use-ledger";
import { ClientPicker, headingStyle, hintStyle, panelStyle, SectionView } from "@/components/billing/ui";
import { InvoiceDetail, InvoiceList, NewInvoiceForm } from "@/components/billing/invoice-panels";
import { ClientAgingSummary, PaymentsPanel, ReceivablesTable } from "@/components/billing/payment-panels";

// The design splits Billing into tabs; these are the ones with a live backend.
const TABS = [
  { id: "invoices", label: "Invoices" },
  { id: "payments", label: "Payments" },
  { id: "receivables", label: "Receivables" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function TabPanel({ id, active, children }: { id: TabId; active: TabId; children: ReactNode }) {
  return <div role="tabpanel" id={`billing-${id}`} aria-labelledby={`billing-tab-${id}`} hidden={id !== active}>{children}</div>;
}

export default function BillingPage() {
  const [tab, setTab] = useState<TabId>("invoices");
  const [clientId, setClientId] = useState<string | null>(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const { api, viewer, clients, state, mutate } = useLedger(clientId, ["invoices", "receivables", "payments"]);
  const clientNames = useMemo(() => Object.fromEntries(clients.map((client) => [client.id, client.name])), [clients]);
  const invoices = readyData(state.invoices, []);
  const receivables = readyData(state.receivables, { receivables: [] }).receivables;
  const selectedInvoice = invoices.find((invoice) => invoice.id === selectedInvoiceId) || null;
  const drafts = invoices.filter((invoice) => invoice.status === "draft").length;

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
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
        <section style={{ ...panelStyle, flex: "1 1 360px" }} aria-label="Invoices">
          <h2 style={headingStyle}>Invoices</h2>
          <SectionView state={state.invoices} label="invoices">
            {(rows) => <InvoiceList invoices={rows} receivables={receivables} clientNames={clientNames} selectedId={selectedInvoiceId} onSelect={setSelectedInvoiceId} />}
          </SectionView>
          {state.invoices.status === "ready" ? (
            clientId ? (
              <details style={{ marginTop: 12 }}>
                <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 13.5 }}>New draft invoice</summary>
                <NewInvoiceForm
                  clientId={clientId}
                  onCreate={async (values) => {
                    const result = await mutate(() => api.createInvoice({ client_id: clientId, invoice_number: values.invoice_number.trim(), issue_date: values.issue_date, due_date: values.due_date, memo: values.memo.trim() || null }));
                    if (result.ok) setSelectedInvoiceId(result.data.invoice.id);
                    return result;
                  }}
                />
              </details>
            ) : <p style={hintStyle}>Choose a client to create an invoice.</p>
          ) : null}
        </section>

        <section style={{ ...panelStyle, flex: "2 1 480px" }} aria-label="Invoice detail">
          <h2 style={headingStyle}>Invoice detail</h2>
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
      </div>
      </TabPanel>

      <TabPanel id="payments" active={tab}>
      <section style={panelStyle} aria-label="Payments">
        <h2 style={headingStyle}>Payments and allocations</h2>
        <SectionView state={state.payments} label="payments">
          {(payments) => (
            <PaymentsPanel
              payments={payments}
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
      <section style={panelStyle} aria-label="Receivables">
        <h2 style={headingStyle}>Receivables</h2>
        <SectionView state={state.receivables} label="receivables">
          {(data) => (
            <>
              {data.as_of_date ? <p style={hintStyle}>As of {data.as_of_date} (firm date).</p> : null}
              {clientId ? <ClientAgingSummary aging={(data.client_aging || []).find((row) => row.client_id === clientId) || null} /> : null}
              <ReceivablesTable receivables={data.receivables} clientNames={clientNames} />
            </>
          )}
        </SectionView>
      </section>
      </TabPanel>
    </div>
  );
}
