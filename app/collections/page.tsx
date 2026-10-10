"use client";

import { useCallback, useMemo, useState } from "react";
import { mutateThenRefresh, type ApiResult } from "@/lib/billing-ui/api";
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
  // Two loaders: paging the call list reloads only the worklist, not holds and activity.
  const ledger = useLedger(clientId, ["holds", "events", "receivables"]);
  const calls = useLedger(clientId, ["worklist"], { worklistLimit: WORKLIST_PAGE, worklistOffset, includeMeta: false });
  const { api, viewer, clients, state } = ledger;
  const refreshLedger = ledger.refresh;
  const refreshCalls = calls.refresh;
  const mutate = useCallback(<T,>(mutation: () => Promise<ApiResult<T>>) =>
    mutateThenRefresh(mutation, () => Promise.all([refreshLedger(), refreshCalls()])), [refreshLedger, refreshCalls]);
  const clientNames = useMemo(() => Object.fromEntries(clients.map((client) => [client.id, client.name])), [clients]);
  const worklistState = calls.state.worklist;
  const worklist = readyData(worklistState, null);
  const holds = readyData(state.holds, []);
  const receivables = readyData(state.receivables, { receivables: [] });
  // The server's firm date drives hold and ladder rules; fall back to the browser
  // date only while neither read model has loaded.
  const today = worklist?.as_of_date || receivables.as_of_date || todayIso();
  // Every issued invoice (all clients, all pages), so names resolve regardless of the call-list page.
  const invoiceOptions = useMemo<InvoiceOption[]>(
    () => receivables.receivables.map((row) => ({ id: row.id, invoice_number: row.invoice_number, client_id: row.client_id })),
    [receivables],
  );
  const invoiceNumbers = useMemo(() => Object.fromEntries(invoiceOptions.map((option) => [option.id, option.invoice_number])), [invoiceOptions]);
  const selectClient = (id: string | null) => { setClientId(id); setWorklistOffset(0); };

  return (
    <div style={{ padding: "20px 16px", maxWidth: 1280, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <ClientPicker clients={clients} value={clientId} onChange={selectClient} />
      </div>

      <ActiveHoldBanner holds={holds} clientId={clientId} clientNames={clientNames} invoiceNumbers={invoiceNumbers} today={today} />

      <section style={{ ...panelStyle, marginTop: 12 }} aria-label="AR insights">
        <h2 style={headingStyle}>AR insights</h2>
        <SectionView state={worklistState} label="AR insights">
          {(data) => <WorklistSummary worklist={data} />}
        </SectionView>
      </section>

      <section style={{ ...panelStyle, marginTop: 16 }} aria-label="Call list">
        <h2 style={headingStyle}>Call list</h2>
        <p style={hintStyle}>Accounts ranked by the server&rsquo;s priority score. Open a score to see how it was built.</p>
        <SectionView state={worklistState} label="call list">
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
