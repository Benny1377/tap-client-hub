"use client";

import { useMemo, useState } from "react";
import { readyData } from "@/lib/billing-ui/ledger";
import { todayIso } from "@/lib/billing-ui/view-model";
import { useLedger } from "@/components/billing/use-ledger";
import { ClientPicker, headingStyle, hintStyle, panelStyle, SectionView } from "@/components/billing/ui";
import { ReceivablesTable } from "@/components/billing/payment-panels";
import { ActiveHoldBanner, EventsPanel, HoldsPanel } from "@/components/billing/collections-panels";

export default function CollectionsPage() {
  const [clientId, setClientId] = useState<string | null>(null);
  const { api, viewer, clients, state, mutate } = useLedger(clientId, ["receivables", "holds", "events"]);
  const clientNames = useMemo(() => Object.fromEntries(clients.map((client) => [client.id, client.name])), [clients]);
  const holds = readyData(state.holds, []);
  const receivables = readyData(state.receivables, []);

  return (
    <div style={{ padding: "20px 16px", maxWidth: 1280, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ ...headingStyle, fontSize: 26, margin: 0 }}>Collections</h1>
          <p style={hintStyle}>Follow up on balances owed. Amounts come from Billing; Collections never changes them. Nothing here sends anything to a client.</p>
        </div>
        <ClientPicker clients={clients} value={clientId} onChange={setClientId} />
      </div>

      <ActiveHoldBanner holds={holds} clientId={clientId} clientNames={clientNames} />

      <section style={{ ...panelStyle, marginTop: 12 }} aria-label="Receivables">
        <h2 style={headingStyle}>Receivables</h2>
        <SectionView state={state.receivables} label="receivables">
          {(rows) => <ReceivablesTable receivables={rows.filter((row) => row.status === "issued")} clientNames={clientNames} />}
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
                receivables={receivables}
                clientId={clientId}
                clientNames={clientNames}
                viewer={viewer}
                onLog={(values) => mutate(() => api.logEvent({ client_id: values.client_id, event_type: values.event_type, invoice_id: values.invoice_id || null, detail: values.note.trim() ? { note: values.note.trim() } : {} }))}
                onApprove={(eventId, approvalType) => mutate(() => api.approveEvent(eventId, approvalType))}
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
                viewer={viewer}
                today={todayIso()}
                onPlace={(values) => mutate(() => api.placeHold({ client_id: values.client_id, reason: values.reason.trim(), expires_on: values.expires_on || null }))}
                onRelease={(holdId) => mutate(() => api.releaseHold(holdId))}
              />
            )}
          </SectionView>
        </section>
      </div>
    </div>
  );
}
