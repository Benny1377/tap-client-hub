"use client";

import { useMemo, useState } from "react";
import { readyData } from "@/lib/billing-ui/ledger";
import { todayIso } from "@/lib/billing-ui/view-model";
import { useLedger } from "@/components/billing/use-ledger";
import { ClientPicker, headingStyle, hintStyle, panelStyle, SectionView } from "@/components/billing/ui";
import { ActiveHoldBanner, EventsPanel, HoldsPanel, type InvoiceOption } from "@/components/billing/collections-panels";
import { AutomationPreviewPanel, WorklistSummary, WorklistTable } from "@/components/billing/worklist-panels";

const WORKLIST_PAGE = 50;

export default function CollectionsPage() {
  const [clientId, setClientId] = useState<string | null>(null);
  const [worklistOffset, setWorklistOffset] = useState(0);
  const { api, viewer, clients, state, mutate } = useLedger(clientId, ["worklist", "holds", "events"], { worklistLimit: WORKLIST_PAGE, worklistOffset });
  const clientNames = useMemo(() => Object.fromEntries(clients.map((client) => [client.id, client.name])), [clients]);
  const worklist = readyData(state.worklist, null);
  const holds = readyData(state.holds, []);
  // The server's firm date drives hold and ladder rules; fall back to the browser
  // date only while the worklist is unavailable.
  const today = worklist?.as_of_date || todayIso();
  const invoiceOptions = useMemo<InvoiceOption[]>(
    () => (worklist?.accounts || []).flatMap((account) => account.invoices.map((invoice) => ({ id: invoice.invoice_id, invoice_number: invoice.invoice_number, client_id: account.client_id }))),
    [worklist],
  );
  const invoiceNumbers = useMemo(() => Object.fromEntries(invoiceOptions.map((option) => [option.id, option.invoice_number])), [invoiceOptions]);
  const selectClient = (id: string | null) => { setClientId(id); setWorklistOffset(0); };

  return (
    <div style={{ padding: "20px 16px", maxWidth: 1280, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ ...headingStyle, fontSize: 26, margin: 0 }}>Collections</h1>
          <p style={hintStyle}>Follow up on balances owed. Amounts come from Billing; Collections never changes them. Nothing here sends anything to a client.</p>
        </div>
        <ClientPicker clients={clients} value={clientId} onChange={selectClient} />
      </div>

      <ActiveHoldBanner holds={holds} clientId={clientId} clientNames={clientNames} invoiceNumbers={invoiceNumbers} today={today} />

      <section style={{ ...panelStyle, marginTop: 12 }} aria-label="AR insights">
        <h2 style={headingStyle}>AR insights</h2>
        <SectionView state={state.worklist} label="AR insights">
          {(data) => <WorklistSummary worklist={data} />}
        </SectionView>
      </section>

      <section style={{ ...panelStyle, marginTop: 16 }} aria-label="Call list">
        <h2 style={headingStyle}>Call list</h2>
        <p style={hintStyle}>Accounts ranked by the server&rsquo;s priority score. Open a score to see how it was built.</p>
        <SectionView state={state.worklist} label="call list">
          {(data) => <WorklistTable worklist={data} onSelectClient={selectClient} onPage={setWorklistOffset} />}
        </SectionView>
      </section>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start", marginTop: 16 }}>
        <section style={{ ...panelStyle, flex: "2 1 480px" }} aria-label="Collections activity">
          <h2 style={headingStyle}>Activity and approvals</h2>
          <SectionView state={state.events} label="Collections activity">
            {(events) => (
              <EventsPanel
                events={events}
                holds={holds}
                invoiceOptions={invoiceOptions}
                clientId={clientId}
                clientNames={clientNames}
                viewer={viewer}
                today={today}
                onLog={(values) => mutate(() => api.logEvent({ client_id: values.client_id, event_type: values.event_type, invoice_id: values.invoice_id || null, detail: values.note.trim() ? { note: values.note.trim() } : {} }))}
                onApprove={(eventId, approvalType) => mutate(() => api.approveEvent(eventId, approvalType))}
                onRecordNoticeSent={(approval, note) => mutate(() => api.logEvent({
                  client_id: approval.client_id,
                  invoice_id: approval.invoice_id,
                  event_type: "formal_notice_sent",
                  approval_event_id: approval.id,
                  detail: { note: note.trim() },
                }))}
              />
            )}
          </SectionView>
        </section>

        <section style={{ ...panelStyle, flex: "1 1 340px" }} aria-label="Holds">
          <h2 style={headingStyle}>Holds</h2>
          <SectionView state={state.holds} label="holds">
            {(rows) => (
              <HoldsPanel
                holds={rows}
                clientId={clientId}
                clientNames={clientNames}
                invoiceOptions={invoiceOptions}
                viewer={viewer}
                today={today}
                onPlace={(values) => mutate(() => api.placeHold({ client_id: values.client_id, reason: values.reason.trim(), invoice_id: values.invoice_id || null, expires_on: values.expires_on || null }))}
                onRelease={(holdId) => mutate(() => api.releaseHold(holdId))}
              />
            )}
          </SectionView>
        </section>
      </div>

      <section style={{ ...panelStyle, marginTop: 16 }} aria-label="Automation preview">
        <h2 style={headingStyle}>Automation preview</h2>
        <AutomationPreviewPanel viewer={viewer} runPreview={(params) => api.preview(params)} />
      </section>
    </div>
  );
}
