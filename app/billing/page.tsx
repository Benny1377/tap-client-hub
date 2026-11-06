"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { readyData } from "@/lib/billing-ui/ledger";
import type { ApiResult } from "@/lib/billing-ui/api";
import type { CandidateState, Invoice, Payment, Receivable } from "@/lib/billing-ui/types";
import { receivableFor } from "@/lib/billing-ui/view-model";
import { useCandidates } from "@/components/billing/use-candidates";
import { useLedger } from "@/components/billing/use-ledger";
import { ClientPicker, hintStyle, SectionView, SegFilter, StatCard, StatRow } from "@/components/billing/ui";
import { CandidateFilter, CandidateList } from "@/components/billing/candidate-panels";
import { InvoiceDetail, InvoiceList, NewInvoiceForm } from "@/components/billing/invoice-panels";
import { ClientPage, ClientsPrices } from "@/components/billing/clients-prices";
import { InvoiceDocument, type Remittance } from "@/components/billing/invoice-document";
import { BillingSettings } from "@/components/billing/settings-panels";
import { BillingChain, WhatBillsNext } from "@/components/billing/what-next";
import { ClientAgingSummary, PaymentsPanel, ReceivablesTable } from "@/components/billing/payment-panels";

// The design splits Billing into tabs; these are the ones with a live backend.
const TABS = [
  { id: "what-next", label: "What bills next" },
  { id: "pricing", label: "Clients & prices" },
  { id: "invoices", label: "Invoices" },
  { id: "payments", label: "Payments" },
  { id: "receivables", label: "Receivables" },
  { id: "settings", label: "Settings" },
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
  const [tab, setTab] = useState<TabId>("what-next");
  const [openClientId, setOpenClientId] = useState<string | null>(null);
  const [remittance, setRemittance] = useState<Remittance | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [filter, setFilter] = useState<InvoiceFilter>("all");
  const [candidateFilter, setCandidateFilter] = useState<CandidateState>("open");
  const [candidateVersion, setCandidateVersion] = useState(0);
  // Empty until the server answers, so no control shows ahead of the real permissions.
  const [granted, setGranted] = useState<string[]>([]);
  const { api, viewer, clients, state, mutate: mutateLedger, refresh } = useLedger(clientId, ["invoices", "receivables", "payments"]);
  useEffect(() => {
    let current = true;
    // A 403 here means this user has no Billing actions; it is not an error to show.
    api.permissions().then((result) => { if (current && result.ok) setGranted(result.data.actions || []); });
    return () => { current = false; };
  }, [api]);
  useEffect(() => {
    let current = true;
    api.remittance().then((result) => { if (current && result.ok) setRemittance(result.data.remittance); });
    return () => { current = false; };
  }, [api]);
  const canViewCandidates = granted.includes("candidates.view");
  const canManageCandidates = granted.includes("candidates.manage");
  const canManageDrafts = granted.includes("invoices.draft.manage");
  const candidates = useCandidates(api, clientId, candidateFilter, canViewCandidates, candidateVersion);
  // Any change can move candidates between states, so they are refetched rather than updated here.
  const mutate = useCallback(async <T,>(mutation: () => Promise<ApiResult<T>>) => {
    const result = await mutateLedger(mutation);
    if (result.ok === true || result.kind === "conflict") setCandidateVersion((version) => version + 1);
    return result;
  }, [mutateLedger]);
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
  const go = (next: string) => { setOpenClientId(null); setSelectedInvoiceId(null); setTab(next as TabId); };
  const openClient = (id: string) => { setClientId(id); setSelectedInvoiceId(null); setOpenClientId(id); setTab("pricing"); };
  const openInvoice = (id: string) => { setSelectedInvoiceId(id); setTab("invoices"); };
  const draftFrom = async (candidateIds: string[]) => {
    const result = await mutate(() => api.createInvoiceFromCandidates({ candidateIds }));
    if (result.ok) { setFilter("all"); openInvoice(result.data.invoice.id); }
    return result;
  };
  const shownClient = clients.find((client) => client.id === openClientId) || null;

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
              onClick={() => go(item.id)}
            >
              {item.label}
              {item.id === "invoices" && drafts > 0 ? <span className="bc-count" aria-label={`${drafts} drafts`}>{drafts}</span> : null}
            </button>
          ))}
        </div>
        <ClientPicker clients={clients} value={clientId} onChange={(id) => { setClientId(id); setSelectedInvoiceId(null); setOpenClientId(null); }} />
      </div>

      <TabPanel id="invoices" active={tab}>
        {selectedInvoice ? (
          <section aria-label="Invoice detail">
            <button type="button" className="bk" onClick={() => setSelectedInvoiceId(null)}>← back</button>
            <div className="phead" style={{ marginBottom: 10 }}>
              <div>
                <h2 style={{ fontSize: 24 }}>{selectedInvoice.invoice_number ? `Invoice ${selectedInvoice.invoice_number}` : "Draft invoice"}</h2>
                <p className="psub"><button type="button" className="lnk" style={{ fontSize: 13.5 }} onClick={() => openClient(selectedInvoice.client_id)}>{clientNames[selectedInvoice.client_id] || "Client"}</button></p>
              </div>
            </div>
            <div className="g2" style={{ alignItems: "start" }}>
              <div className="card">
            <InvoiceDetail
              key={selectedInvoice.id}
              invoice={selectedInvoice}
              receivable={receivableFor(selectedInvoice.id, receivables)}
              viewer={viewer}
              permissions={granted}
              handlers={{
                onUpdate: (values) => mutate(() => api.updateInvoice(selectedInvoice.id, { memo: values.memo.trim() || null })),
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
              </div>
              <InvoiceDocument invoice={selectedInvoice} clientName={clientNames[selectedInvoice.client_id] || "Client"} receivable={receivableFor(selectedInvoice.id, receivables)} remittance={remittance} />
            </div>
          </section>
        ) : (
          <>
            <BillingChain now="invoices" onGo={go} />
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
          {state.invoices.status === "ready" && canManageDrafts ? (
            clientId ? (
              <details className="card" style={{ marginTop: 16 }}>
                <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 13.5 }}>New draft invoice</summary>
                <NewInvoiceForm
                  clientId={clientId}
                  onCreate={async (values) => {
                    const result = await mutate(() => api.createInvoice({ clientId, ...(values.memo.trim() ? { memo: values.memo.trim() } : {}) }));
                    if (result.ok) { setFilter("all"); setSelectedInvoiceId(result.data.invoice.id); }
                    return result;
                  }}
                />
              </details>
            ) : <p style={hintStyle}>Choose a client to create an invoice.</p>
          ) : null}
        </section>

        {canViewCandidates ? (
          <section className="card" style={{ marginTop: 16 }} aria-label="Billable candidates" data-candidates-panel>
            <h3>Billable candidates<span>from services and completed work</span></h3>
            {clientId ? (
              <>
                <div className="controls"><CandidateFilter value={candidateFilter} onChange={setCandidateFilter} /></div>
                <SectionView state={candidates.section} label="candidates">
                  {(page) => (
                    <CandidateList
                      key={`${clientId}-${candidateFilter}`}
                      items={page.items}
                      bundles={page.bundles}
                      filter={candidateFilter}
                      canManage={canManageCandidates}
                      canDraft={canManageDrafts}
                      hasMore={Boolean(page.nextCursor)}
                      loadingMore={candidates.loadingMore}
                      onMore={() => { void candidates.loadMore(); }}
                      handlers={{
                        onDismiss: (id, reason) => mutate(() => api.dismissCandidate(id, reason)),
                        onReopen: (id, reason) => mutate(() => api.reopenCandidate(id, reason)),
                        onReprice: (id, reason) => mutate(() => api.repriceCandidate(id, reason)),
                        onDraft: async (candidateIds, memo) => {
                          const result = await mutate(() => api.createInvoiceFromCandidates({ candidateIds, ...(memo ? { memo } : {}) }));
                          if (result.ok) { setFilter("all"); setSelectedInvoiceId(result.data.invoice.id); }
                          return result;
                        },
                      }}
                    />
                  )}
                </SectionView>
              </>
            ) : <p style={hintStyle}>Choose a client to see what can be billed.</p>}
          </section>
        ) : null}

          </>
        )}
      </TabPanel>

      <TabPanel id="payments" active={tab}>
        <BillingChain now="payments" onGo={go} />
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

      <TabPanel id="what-next" active={tab}>
        <WhatBillsNext
          api={api}
          active={tab === "what-next"}
          clientId={clientId}
          clients={clients}
          canGenerate={canManageCandidates}
          canDraft={canManageDrafts}
          version={candidateVersion}
          draftCount={drafts}
          onGenerated={() => { setCandidateVersion((version) => version + 1); void refresh(); }}
          onDraft={draftFrom}
          onReviewDrafts={() => { setFilter("draft"); go("invoices"); }}
          onOpenClient={openClient}
          onGo={go}
        />
      </TabPanel>

      <TabPanel id="pricing" active={tab}>
        {shownClient ? (
          <ClientPage
            key={shownClient.id}
            api={api}
            client={shownClient}
            invoices={invoices}
            receivables={receivables}
            canManage={granted.includes("pricing.manage")}
            onBack={() => setOpenClientId(null)}
            onOpenInvoice={openInvoice}
            onChanged={() => setCandidateVersion((version) => version + 1)}
          />
        ) : (
          <ClientsPrices api={api} active={tab === "pricing"} clients={clients} receivables={receivables} canView={granted.includes("pricing.view")} version={candidateVersion} onOpen={openClient} onGo={go} />
        )}
      </TabPanel>

      <TabPanel id="settings" active={tab}>
        <BillingSettings api={api} clientId={clientId} clients={clients} actions={granted} />
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
