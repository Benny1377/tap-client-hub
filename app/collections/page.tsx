"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { mutateThenRefresh, type ApiResult } from "@/lib/billing-ui/api";
import { readyData } from "@/lib/billing-ui/ledger";
import { approvalRequests, noticesAwaitingSend, stageLabelsFrom, todayIso, viewerIsPowerUser } from "@/lib/billing-ui/view-model";
import { useLedger } from "@/components/billing/use-ledger";
import { ClientPicker, OwnerAdminOnly, SectionView } from "@/components/billing/ui";
import { ActiveHoldBanner, ActivityPanel, DecisionsPanel, HoldsPanel, type InvoiceOption } from "@/components/billing/collections-panels";
import { AutomationPreviewPanel, LadderRungs, LadderSummary, MoneyByStage, PipelineBanner, PipelineTiles, WhoIsWhere, WorklistSummary, WorklistTable } from "@/components/billing/worklist-panels";
import { CollectionsRulesEditor } from "@/components/billing/collections-rules-editor";
import { DeliveryHistoryPanel, DeliverySetupPanel } from "@/components/billing/delivery-panels";
import { ImportsPanel } from "@/components/billing/import-panels";

const WORKLIST_PAGE = 50;
const TABS = [
  { id: "insights", label: "AR Insights" },
  { id: "pipeline", label: "Pipeline" },
  { id: "imports", label: "A/R reports" },
  { id: "setup", label: "Setup & rules" },
] as const;
type TabId = (typeof TABS)[number]["id"];

/** Every tab stays mounted (only hidden), so drafts and preview results survive switching tabs. */
function TabPanel({ id, active, children }: { id: TabId; active: TabId; children: ReactNode }) {
  return <div role="tabpanel" id={`collections-${id}`} aria-labelledby={`collections-tab-${id}`} hidden={id !== active}>{children}</div>;
}

export default function CollectionsPage() {
  const [tab, setTab] = useState<TabId>("insights");
  const [importsOpened, setImportsOpened] = useState(false);
  const [clientId, setClientId] = useState<string | null>(null);
  const [worklistOffset, setWorklistOffset] = useState(0);
  const [deliveryRefreshKey, setDeliveryRefreshKey] = useState(0);
  // Two loaders: paging the call list reloads only the worklist, not holds and activity.
  const ledger = useLedger(clientId, ["holds", "events", "receivables", "rules"]);
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
  const events = readyData(state.events, []);
  const receivables = readyData(state.receivables, { receivables: [] });
  const ruleSettings = readyData(state.rules, {
    rules: [], firm_timezone: "America/Chicago",
    settings: { minimum_balance: "50", direct_escalation_threshold: "5000", send_start: "09:00", send_end: "17:00", weekdays_only: true },
  });
  const { rules, firm_timezone: firmTimezone } = ruleSettings;
  const stageLabels = stageLabelsFrom(rules);
  const power = viewerIsPowerUser(viewer);
  // The server's firm date drives hold and ladder rules; fall back to the browser
  // date only while neither read model has loaded.
  const today = worklist?.as_of_date || receivables.as_of_date || todayIso();
  // Every issued invoice (all clients, all pages), so names resolve regardless of the call-list page.
  const invoiceOptions: InvoiceOption[] = receivables.receivables.map((row) => ({ id: row.id, invoice_number: row.invoice_number, client_id: row.client_id }));
  const invoiceNumbers = Object.fromEntries(invoiceOptions.map((option) => [option.id, option.invoice_number]));
  const selectClient = (id: string | null) => { setClientId(id); setWorklistOffset(0); };
  const decisions = approvalRequests(events, holds, viewer, today).filter((item) => item.state !== "approved").length
    + noticesAwaitingSend(events, holds, viewer, today).length;

  const eventProps = {
    holds,
    invoiceOptions,
    clientId,
    clientNames,
    viewer,
    today,
    firmTimezone,
    stageLabels,
    onLog: (values: Record<string, string>) => mutate(() => api.logEvent({ client_id: values.client_id, event_type: values.event_type, invoice_id: values.invoice_id || null, detail: values.note.trim() ? { note: values.note.trim() } : {} })),
    onApprove: (eventId: string, approvalType: "escalated" | "formal_notice_approved") => mutate(() => api.approveEvent(eventId, approvalType)),
    onRecordNoticeSent: (approval: { id: string; client_id: string; invoice_id: string | null }, note: string) => mutate(() => api.logEvent({
      client_id: approval.client_id,
      invoice_id: approval.invoice_id,
      event_type: "formal_notice_sent",
      approval_event_id: approval.id,
      detail: { note: note.trim() },
    })),
  };

  return (
    <div className="bc-page">
      <div className="bc-tabrow">
        <div className="bc-subnav" role="tablist" aria-label="Collections views">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`collections-tab-${item.id}`}
              aria-controls={`collections-${item.id}`}
              aria-selected={tab === item.id}
              className="bc-snb"
              onClick={() => { setTab(item.id); if (item.id === "imports") setImportsOpened(true); }}
            >
              {item.label}
              {item.id === "pipeline" && decisions > 0 ? <span className="bc-count" aria-label={`${decisions} waiting`}>{decisions}</span> : null}
            </button>
          ))}
        </div>
        <ClientPicker clients={clients} value={clientId} onChange={selectClient} />
      </div>

      <ActiveHoldBanner holds={holds} clientId={clientId} clientNames={clientNames} invoiceNumbers={invoiceNumbers} today={today} />

      <TabPanel id="insights" active={tab}>
        <section aria-label="AR insights">
          <SectionView state={worklistState} label="AR insights">
            {(data) => <WorklistSummary worklist={data} minimumBalance={state.rules.status === "ready" ? ruleSettings.settings.minimum_balance : null} />}
          </SectionView>
        </section>
        <section className="bc-inscard" aria-label="Call list" style={{ marginTop: 16 }}>
          <div className="bc-eyebrow">Where to focus first · ranked by priority</div>
          <div className="ins-h" style={{ marginBottom: 4 }}>The accounts that need you now</div>
          <div className="ins-b" style={{ marginBottom: 14 }}>Ranked by dollars, <b>weighted up the older they get</b>, so the most expensive and most overdue rise first. Start at the top. Open a score to see how it was built; pick a client to filter the page.</div>
          <SectionView state={worklistState} label="call list">
            {(data) => <WorklistTable worklist={data} onSelectClient={selectClient} onPage={setWorklistOffset} stageLabels={stageLabels} rules={rules} firmTimezone={firmTimezone} selectedClientId={clientId} />}
          </SectionView>
        </section>
        <p className="bc-foot" style={{ marginTop: 18 }}><b>No guessed recovery rate.</b> Every figure here comes straight from Billing; nothing is estimated.</p>
      </TabPanel>

      <TabPanel id="pipeline" active={tab}>
        <SectionView state={worklistState} label="pipeline">
          {(data) => (
            <>
              <PipelineBanner worklist={data} />
              <PipelineTiles worklist={data} decisions={decisions} />
              <MoneyByStage worklist={data} rules={rules} />
            </>
          )}
        </SectionView>
        <h3 className="bc-sect" style={{ marginTop: 26 }}>The five-touch ladder <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 11.5, fontFamily: "inherit" }}>— click any touch to read its wording</span></h3>
        <LadderRungs rules={rules} />
        <SectionView state={worklistState} label="invoice positions">
          {(data) => <WhoIsWhere worklist={data} rules={rules} stageLabels={stageLabels} firmTimezone={firmTimezone} onSelectClient={selectClient} />}
        </SectionView>
        <section className="bc-cfgsec" aria-label="Needs your decision" style={{ marginTop: 26 }}>
          <h3 className="bc-sect">Needs your decision</h3>
          <p className="bc-hint">Touches 4 and 5 hand off to an Owner or Admin. Escalations and formal notices wait here.</p>
          <SectionView state={state.events} label="approvals">
            {(rows) => <DecisionsPanel events={rows} {...eventProps} />}
          </SectionView>
        </section>
        <section className="bc-cfgsec" aria-label="Activity">
          <h3 className="bc-sect">Activity</h3>
          <p className="bc-hint">Every call, reminder, promise to pay, and decision, newest first.</p>
          <SectionView state={state.events} label="Collections activity">
            {(rows) => <ActivityPanel events={rows} {...eventProps} />}
          </SectionView>
        </section>
        {power ? (
          <section className="bc-card" aria-label="Delivery history" style={{ marginBottom: 20 }}>
            <h3 className="bc-sect">Delivery history</h3>
            <p className="bc-hint">Every test email attempt, newest first. Owner/Admin only; staff see each invoice&rsquo;s last email on the call list.</p>
            <DeliveryHistoryPanel api={api} viewer={viewer} invoiceOptions={invoiceOptions} stageLabels={stageLabels} firmTimezone={firmTimezone} refreshKey={deliveryRefreshKey} />
          </section>
        ) : null}
        <section className="bc-card" aria-label="Automation preview">
          <h3 className="bc-sect">Automation preview</h3>
          <AutomationPreviewPanel viewer={viewer} runPreview={(params) => api.preview(params)} stageLabels={stageLabels} />
        </section>
      </TabPanel>

      <TabPanel id="imports" active={tab}>
        {/* Mounted on first visit only: opening the report list is an audited read. */}
        {importsOpened ? (
          <ImportsPanel
            api={api}
            viewer={viewer}
            clients={clients}
            billingInvoices={receivables.receivables}
            onCollectionsChanged={() => { void refreshLedger(); void refreshCalls(); }}
          />
        ) : null}
      </TabPanel>

      <TabPanel id="setup" active={tab}>
        {power ? (
          state.rules.status === "ready" ? (
            <CollectionsRulesEditor value={ruleSettings} canEdit onSave={(input) => mutate(() => api.updateRules(input))} />
          ) : <SectionView state={state.rules} label="rules">{() => null}</SectionView>
        ) : (
          <section className="bc-cfgsec" aria-label="The follow-up ladder">
            <h3 className="bc-sect">The follow-up ladder</h3>
            <LadderSummary rules={rules} />
            <p className="bc-hint"><OwnerAdminOnly action="Changing the ladder, wording, or guardrails" /></p>
          </section>
        )}
        {power ? (
          <section className="bc-cfgsec" aria-label="Email delivery">
            <h3 className="bc-sect">Email delivery (test mode)</h3>
            <p className="bc-hint">Whether test sends are ready, and what is still missing. Sending to clients is not part of this phase.</p>
            <DeliverySetupPanel api={api} viewer={viewer} onTestRunComplete={() => setDeliveryRefreshKey((current) => current + 1)} />
          </section>
        ) : null}
        <section className="bc-cfgsec" aria-label="Holds">
          <h3 className="bc-sect">On hold — never chased</h3>
          <p className="bc-hint">Disputes, payment plans, and anyone a person should handle. A hold blocks escalation and formal-notice steps for its client or invoice.</p>
          <SectionView state={state.holds} label="holds">
            {(rows) => (
              <HoldsPanel
                holds={rows}
                clientId={clientId}
                clientNames={clientNames}
                invoiceOptions={invoiceOptions}
                viewer={viewer}
                today={today}
                firmTimezone={firmTimezone}
                onPlace={(values) => mutate(() => api.placeHold({ client_id: values.client_id, reason: values.reason.trim(), invoice_id: values.invoice_id || null, expires_on: values.expires_on || null }))}
                onRelease={(holdId) => mutate(() => api.releaseHold(holdId))}
              />
            )}
          </SectionView>
        </section>
      </TabPanel>
    </div>
  );
}
