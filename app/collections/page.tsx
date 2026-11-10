"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { invoiceTargetFields, mutateThenRefresh, type ApiResult } from "@/lib/billing-ui/api";
import { readyData } from "@/lib/billing-ui/ledger";
import { approvalRequests, noticesAwaitingSend, stageLabelsFrom, todayIso, viewerIsPowerUser } from "@/lib/billing-ui/view-model";
import { useLedger } from "@/components/billing/use-ledger";
import { ClientPicker, ErrorBanner, OwnerAdminOnly, SectionView } from "@/components/billing/ui";
import { ActiveHoldBanner, ActivityPanel, DecisionsPanel, HoldsPanel, PDF_OPTION_PREFIX, type InvoiceOption } from "@/components/billing/collections-panels";
import { AutomationPreviewPanel, LadderSummary } from "@/components/billing/worklist-panels";
import { FiveTouchLadder, PipelineOverview } from "@/components/billing/pipeline-design";
import { AccountsWhoIsWhere, ArInsights, useWholeBook } from "@/components/billing/ar-insights";
import { CollectionsRulesEditor } from "@/components/billing/collections-rules-editor";
import { DeliveryHistoryPanel, DeliverySetupPanel } from "@/components/billing/delivery-panels";
import { ImportPermissionsPanel, ImportsPanel } from "@/components/billing/import-panels";
import { EmailLogPanel } from "@/components/billing/email-log-panel";
import { noteCounts } from "@/lib/billing-ui/ar-insights";

const WORKLIST_PAGE = 50;
const TABS = [
  { id: "insights", label: "AR Insights" },
  { id: "pipeline", label: "Pipeline" },
  { id: "emails", label: "Email log" },
  { id: "imports", label: "A/R reports" },
  { id: "setup", label: "Setup and rules" },
] as const;
type TabId = (typeof TABS)[number]["id"];

/** Every tab stays mounted (only hidden), so drafts and preview results survive switching tabs. */
function TabPanel({ id, active, children }: { id: TabId; active: TabId; children: ReactNode }) {
  return <div role="tabpanel" id={`collections-${id}`} aria-labelledby={`collections-tab-${id}`} hidden={id !== active}>{children}</div>;
}

export default function CollectionsPage() {
  const [tab, setTab] = useState<TabId>("insights");
  const [importsOpened, setImportsOpened] = useState(false);
  const [importPermissionsOpened, setImportPermissionsOpened] = useState(false);
  const [clientId, setClientId] = useState<string | null>(null);
  const [worklistOffset, setWorklistOffset] = useState(0);
  const [deliveryRefreshKey, setDeliveryRefreshKey] = useState(0);
  // Two loaders: paging the call list reloads only the worklist, not holds and activity.
  const ledger = useLedger(clientId, ["holds", "events", "receivables", "rules"]);
  const calls = useLedger(clientId, ["worklist"], { worklistLimit: WORKLIST_PAGE, worklistOffset, includeMeta: false });
  const { api, viewer, clients, state } = ledger;
  const refreshLedger = ledger.refresh;
  const refreshCalls = calls.refresh;
  // The insights and "Who's where" read every page of the book, so they reload after any change too.
  const [bookVersion, setBookVersion] = useState(0);
  const { book, failed: bookFailed } = useWholeBook(api, clientId, bookVersion);
  const mutate = useCallback(<T,>(mutation: () => Promise<ApiResult<T>>) =>
    mutateThenRefresh(mutation, () => { setBookVersion((version) => version + 1); return Promise.all([refreshLedger(), refreshCalls()]); }), [refreshLedger, refreshCalls]);
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
  const billingOptions: InvoiceOption[] = receivables.receivables.map((row) => ({ id: row.id, invoice_number: row.invoice_number, client_id: row.client_id, source: "billing" }));
  // Report-only invoices (Phase 4) of the accounts on the loaded call-list page. Forms that
  // use them need a selected client, and then that client's whole account is loaded.
  const reportOnlyOptions: InvoiceOption[] = (worklist?.accounts || []).flatMap((account) => account.invoices
    .filter((invoice) => invoice.source === "pdf_import" && !invoice.invoice_id && invoice.source_invoice_id)
    .map((invoice) => ({ id: `${PDF_OPTION_PREFIX}${invoice.source_invoice_id}`, invoice_number: invoice.invoice_number, client_id: account.client_id, source: "pdf_import" as const, source_invoice_id: invoice.source_invoice_id, source_as_of: invoice.source_as_of })));
  const invoiceOptions: InvoiceOption[] = [...billingOptions, ...reportOnlyOptions];
  const invoiceNumbers = Object.fromEntries(invoiceOptions.map((option) => [option.id, option.invoice_number]));
  const selectClient = (id: string | null) => { setClientId(id); setWorklistOffset(0); };
  const notesByClient = useMemo(() => noteCounts(events), [events]);
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
    onLog: (values: Record<string, string>) => mutate(() => api.logEvent({ client_id: values.client_id, event_type: values.event_type, ...invoiceTargetFields(values.invoice_id), detail: values.note.trim() ? { note: values.note.trim() } : {} })),
    onApprove: (eventId: string, approvalType: "escalated" | "formal_notice_approved") => mutate(() => api.approveEvent(eventId, approvalType)),
    onRecordNoticeSent: (approval: { id: string; client_id: string; invoice_id: string | null; source_invoice_id?: string | null }, note: string) => mutate(() => api.logEvent({
      client_id: approval.client_id,
      // The notice record must name the same invoice identity as its approval.
      ...(!approval.invoice_id && approval.source_invoice_id
        ? { target: { source: "pdf_import" as const, source_invoice_id: approval.source_invoice_id } }
        : { invoice_id: approval.invoice_id }),
      event_type: "formal_notice_sent",
      approval_event_id: approval.id,
      detail: { note: note.trim() },
    })),
  };

  return (
    <div className="bc-page">
      <div className="bc-tabrow">
        <div className="bc-subnav" role="tablist" aria-label="Collections views">
          {/* Delivery history is Owner/Admin only, so the email log tab is too. */}
          {TABS.filter((item) => item.id !== "emails" || power).map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`collections-tab-${item.id}`}
              aria-controls={`collections-${item.id}`}
              aria-selected={tab === item.id}
              className="bc-snb"
              onClick={() => { setTab(item.id); if (item.id === "imports") setImportsOpened(true); if (item.id === "setup") setImportPermissionsOpened(true); }}
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
          {book ? <ArInsights book={book} rules={rules} notes={{ api, counts: notesByClient, firmTimezone, onAdded: () => { void refreshLedger(); } }} /> : bookFailed ? <ErrorBanner kind="server" message={bookFailed} /> : <p className="sub" role="status">Loading AR insights…</p>}
        </section>
      </TabPanel>

      <TabPanel id="pipeline" active={tab}>
        <SectionView state={worklistState} label="pipeline">
          {(data) => (
            <>
              <PipelineOverview book={book || data} rules={rules} />
              <FiveTouchLadder book={book || data} rules={rules} />
            </>
          )}
        </SectionView>
        {book ? <AccountsWhoIsWhere book={book} rules={rules} /> : <p className="sub" role="status">{bookFailed || "Loading every account…"}</p>}
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

      <TabPanel id="emails" active={tab}>
        {power ? <EmailLogPanel api={api} clientId={clientId} clientNames={clientNames} stageLabels={stageLabels} firmTimezone={firmTimezone} refreshKey={deliveryRefreshKey} /> : null}
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
        {power ? (
          <section className="bc-cfgsec" aria-label="A/R report permissions">
            <h3 className="bc-sect">A/R report permissions</h3>
            <p className="bc-hint">Who besides Owners and Admins may upload, review, and approve QuickBooks A/R reports.</p>
            {importPermissionsOpened ? <ImportPermissionsPanel api={api} /> : null}
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
                onPlace={(values) => mutate(() => api.placeHold({ client_id: values.client_id, reason: values.reason.trim(), ...invoiceTargetFields(values.invoice_id), expires_on: values.expires_on || null }))}
                onRelease={(holdId) => mutate(() => api.releaseHold(holdId))}
              />
            )}
          </SectionView>
        </section>
      </TabPanel>
    </div>
  );
}
