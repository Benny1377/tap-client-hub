"use client";

import { useCallback, useEffect, useState } from "react";
import type { ApiResult, BillingApi } from "@/lib/billing-ui/api";
import type { Viewer } from "@/lib/billing-ui/types";
import {
  DELIVERY_STATUSES,
  DELIVERY_STATUS_TONES,
  deliveryReasonLabel,
  deliveryStatusLabel,
  endpointMissing,
  missingSettingLabel,
  type DeliveriesResponse,
  type DeliverySetup,
  type DeliveryStatus,
  type LastDelivery,
  type PreviewDeliveryAttempt,
} from "@/lib/billing-ui/delivery";
import { formatFirmDate, formatFirmDateTime, stageLabel, STAGE_LABELS, viewerIsPowerUser, type StageLabels } from "@/lib/billing-ui/view-model";
import { ActionButton, ConfirmAction, ErrorBanner, OwnerAdminOnly } from "./ui";

/** Status pill using the contract's wording. */
export function DeliveryStatusPill({ status }: { status: string }) {
  const tone = DELIVERY_STATUS_TONES[status as DeliveryStatus] || "grey";
  return <span className={`bc-pill ${tone}`} data-delivery-status={status}>{deliveryStatusLabel(status)}</span>;
}

/** Sanitized "last touch" for a worklist invoice (visible to every Collections reader). */
export function LastTouch({ delivery, stageLabels = STAGE_LABELS, firmTimezone = "America/Chicago" }: {
  delivery: LastDelivery | null | undefined;
  stageLabels?: StageLabels;
  firmTimezone?: string;
}) {
  if (!delivery) return null;
  return (
    <div className="bc-small" data-last-delivery={delivery.status}>
      Last email: {deliveryStatusLabel(delivery.status)} · {stageLabel(delivery.stage, stageLabels)} · {formatFirmDate(delivery.occurred_at, firmTimezone)}
    </div>
  );
}

/** A preview action's existing attempt, so it never looks like a second send. */
export function PreviewAttemptNote({ attempt }: { attempt: PreviewDeliveryAttempt | null | undefined }) {
  if (!attempt) return null;
  return (
    <div className="bc-small" data-preview-attempt={attempt.status}>
      Already attempted: {deliveryStatusLabel(attempt.status)}
      {attempt.reason_code ? ` — ${deliveryReasonLabel(attempt.reason_code)}` : ""}
      {attempt.status === "failed" ? (attempt.retryable ? " Retry it from Delivery history." : " Not retryable.") : ""}
    </div>
  );
}

const NOT_INSTALLED = "Email delivery is not available on this server yet. Once the Phase 3 backend is installed, this shows whether test mode is ready.";

/** Pure view of GET /api/collections/delivery-status, plus the off-only pause. */
export function DeliverySetupView({ result, onPause, onTestRun }: {
  result: ApiResult<DeliverySetup> | null;
  onPause: () => Promise<ApiResult<unknown>>;
  onTestRun: () => Promise<ApiResult<unknown>>;
}) {
  if (!result) return <p role="status" className="bc-hint">Loading email delivery status…</p>;
  if (endpointMissing(result)) return <p className="bc-hint" data-delivery-unavailable>{NOT_INSTALLED}</p>;
  if (result.ok === false) return <ErrorBanner kind={result.kind} message={result.message} code={result.code} />;
  const setup = result.data;
  const modeLabel = setup.mode === "test" ? "Test mode" : "Off";
  return (
    <div className="bc-grid2" data-delivery-setup data-delivery-mode={setup.mode}>
      <div className="bc-cfgcard">
        <span className="bc-label">Email delivery</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span className={`bc-pill ${setup.mode === "test" ? "blue" : "grey"}`}>{modeLabel}</span>
          <span className={`bc-pill ${setup.test_ready ? "green" : "amber"}`} data-test-ready={setup.test_ready}>{setup.test_ready ? "Ready for test sends" : "Not ready"}</span>
        </div>
        <p className="bc-note">
          Test mode sends only synthetic content, and only to the approved test mailbox
          {setup.test_recipient_masked ? <> (<b data-test-recipient>{setup.test_recipient_masked}</b>)</> : ""}. Clients never receive email from this phase.
        </p>
        {setup.missing.length ? (
          <ul className="bc-list" style={{ marginTop: 10 }} data-delivery-missing>
            {setup.missing.map((code) => (
              <li key={code} className="bc-item" data-missing={code}>
                <span className="dot" />
                <div className="grow"><div className="ct" style={{ fontSize: 13 }}>{missingSettingLabel(code)}</div></div>
              </li>
            ))}
          </ul>
        ) : <p className="bc-note">Nothing is missing.</p>}
      </div>
      <div className="bc-cfgcard">
        <span className="bc-label">Automation</span>
        {setup.automation_enabled ? (
          <>
            <p className="bc-hint" style={{ margin: "0 0 10px" }}>Automation is <b>on</b> for test mode. Pausing stops new work at once.</p>
            {setup.test_ready ? (
              <ConfirmAction
                testId="run-test-now"
                label="Run test now"
                description="This uses the current server-side preview and synthetic fixture data only. The server rewrites the recipient to the configured test mailbox; no client email is sent."
                confirmLabel="Start test run"
                onConfirm={onTestRun}
              />
            ) : <p className="bc-hint" data-test-run-blocked>Run test now is unavailable until all test-mode safety checks are ready.</p>}
            <ConfirmAction
              testId="pause-automation"
              label="Pause automation"
              description="Pausing stops all scheduled and test runs. Turning automation back on is a server configuration change, not a button here."
              confirmLabel="Pause now"
              onConfirm={onPause}
            />
          </>
        ) : (
          <p className="bc-hint" style={{ margin: 0 }} data-automation-off>
            Automation is <b>off</b>. Turning it on is a server configuration change; it cannot be switched on from here.
          </p>
        )}
      </div>
    </div>
  );
}

/** Loads delivery status for Owner/Admin; other roles never call the route. */
export function DeliverySetupPanel({ api, viewer, onTestRunComplete }: { api: BillingApi; viewer: Viewer | null; onTestRunComplete: () => void }) {
  const power = viewerIsPowerUser(viewer);
  const [result, setResult] = useState<ApiResult<DeliverySetup> | null>(null);
  const [testRunFinished, setTestRunFinished] = useState(false);
  const load = useCallback(() => api.deliveryStatus().then(setResult), [api]);
  useEffect(() => { if (power) void load(); }, [power, load]);
  if (!power) return <p className="bc-hint"><OwnerAdminOnly action="Email delivery settings" /></p>;
  return (
    <>
      <DeliverySetupView
        result={result}
        onTestRun={async () => {
          setTestRunFinished(false);
          const run = await api.testRun();
          if (endpointMissing(run)) return { ok: false, status: 404, kind: "not_found", message: "Test runs are not available on this server yet." };
          if (run.ok === true) {
            setTestRunFinished(true);
            await load();
            onTestRunComplete();
          }
          return run;
        }}
        onPause={async () => {
          const paused = await api.pauseAutomation();
          if (endpointMissing(paused)) return { ok: false, status: 404, kind: "not_found", message: "Pausing is not available on this server yet." };
          if (paused.ok === true) await load();
          return paused;
        }}
      />
      {testRunFinished ? <p role="status" className="bc-hint" data-test-run-complete>Test run finished. Delivery history is refreshing; check each attempt&rsquo;s status below.</p> : null}
    </>
  );
}

const HISTORY_PAGE = 50;

/** Pure view of GET /api/collections/deliveries with filters, paging, and retry. */
export function DeliveryHistoryView({ result, status, invoiceId, invoiceOptions, stageLabels = STAGE_LABELS, firmTimezone = "America/Chicago", onFilter, onPage, onRetry }: {
  result: ApiResult<DeliveriesResponse> | null;
  status: DeliveryStatus | "";
  invoiceId: string;
  invoiceOptions: Array<{ id: string; invoice_number: string }>;
  stageLabels?: StageLabels;
  firmTimezone?: string;
  onFilter: (filters: { status: DeliveryStatus | ""; invoiceId: string }) => void;
  onPage: (offset: number) => void;
  onRetry: (attemptId: string) => Promise<ApiResult<unknown>>;
}) {
  if (result && endpointMissing(result)) return <p className="bc-hint" data-delivery-unavailable>Delivery history is not available on this server yet. Attempts will appear here once the Phase 3 backend is installed.</p>;
  return (
    <div data-delivery-history>
      <div className="bc-inline" style={{ marginBottom: 12 }}>
        <label className="bc-field" style={{ margin: 0, minWidth: 180 }}>
          <span>Status</span>
          <select className="bc-in" value={status} onChange={(event) => onFilter({ status: event.target.value as DeliveryStatus | "", invoiceId })}>
            <option value="">All statuses</option>
            {DELIVERY_STATUSES.map((value) => <option key={value} value={value}>{deliveryStatusLabel(value)}</option>)}
          </select>
        </label>
        <label className="bc-field" style={{ margin: 0, minWidth: 180 }}>
          <span>Invoice</span>
          <select className="bc-in" value={invoiceId} onChange={(event) => onFilter({ status, invoiceId: event.target.value })}>
            <option value="">All invoices</option>
            {invoiceOptions.map((option) => <option key={option.id} value={option.id}>{option.invoice_number}</option>)}
          </select>
        </label>
      </div>
      {!result ? <p role="status" className="bc-hint">Loading delivery history…</p>
        : result.ok === false ? <ErrorBanner kind={result.kind} message={result.message} code={result.code} />
        : result.data.items.length === 0 ? <p className="bc-hint">No delivery attempts{status || invoiceId ? " match these filters" : " yet"}.</p>
        : (
          <>
            <div className="bc-scroll">
              <table className="bc-table">
                <thead>
                  <tr><th>When</th><th>Invoice</th><th>Step</th><th>Status</th><th>Reason</th><th className="r">Tries</th><th /></tr>
                </thead>
                <tbody>
                  {result.data.items.map((item) => (
                    <tr key={item.attempt_id} data-delivery-attempt={item.attempt_id} data-retryable={item.retryable}>
                      <td className="bc-small bc-nowrap">{formatFirmDateTime(item.created_at, firmTimezone)}</td>
                      <td className="bc-nowrap">{item.invoice_number}</td>
                      <td>{stageLabel(item.stage, stageLabels)}</td>
                      <td>
                        <DeliveryStatusPill status={item.status} />
                        {item.accepted_at ? <div className="bc-small">{formatFirmDateTime(item.accepted_at, firmTimezone)}</div> : null}
                      </td>
                      <td className="bc-muted">{deliveryReasonLabel(item.reason_code, item.reason_text) || "—"}{item.next_attempt_at ? <div className="bc-small">Next try {formatFirmDateTime(item.next_attempt_at, firmTimezone)}</div> : null}</td>
                      <td className="r">{item.attempt_count}</td>
                      <td>{item.status === "failed" && item.retryable ? <ActionButton quiet label="Retry" onAction={() => onRetry(item.attempt_id)} /> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="bc-pager">
              <span>Showing {result.data.pagination.offset + 1}–{result.data.pagination.offset + result.data.items.length} of {result.data.pagination.total}</span>
              <button type="button" className="bc-btn quiet" disabled={result.data.pagination.offset === 0} onClick={() => onPage(Math.max(0, result.data.pagination.offset - result.data.pagination.limit))}>Previous</button>
              <button type="button" className="bc-btn quiet" disabled={result.data.pagination.offset + result.data.items.length >= result.data.pagination.total} onClick={() => onPage(result.data.pagination.offset + result.data.pagination.limit)}>Next</button>
            </div>
          </>
        )}
      <p className="bc-foot">&ldquo;Accepted by email provider&rdquo; means the provider took the request; it does not prove the email was delivered or read. Only known temporary failures can be retried.</p>
    </div>
  );
}

/** Loads delivery history for Owner/Admin; other roles never call the route. */
export function DeliveryHistoryPanel({ api, viewer, invoiceOptions, stageLabels, firmTimezone, refreshKey = 0 }: {
  api: BillingApi;
  viewer: Viewer | null;
  invoiceOptions: Array<{ id: string; invoice_number: string }>;
  stageLabels?: StageLabels;
  firmTimezone?: string;
  refreshKey?: number;
}) {
  const power = viewerIsPowerUser(viewer);
  const [filters, setFilters] = useState<{ status: DeliveryStatus | ""; invoiceId: string; offset: number }>({ status: "", invoiceId: "", offset: 0 });
  const [result, setResult] = useState<ApiResult<DeliveriesResponse> | null>(null);
  const load = useCallback(
    () => api.deliveries({ status: filters.status || null, invoiceId: filters.invoiceId || null, limit: HISTORY_PAGE, offset: filters.offset }).then(setResult),
    [api, filters],
  );
  useEffect(() => { if (power) void load(); }, [power, load, refreshKey]);
  if (!power) return <p className="bc-hint"><OwnerAdminOnly action="Delivery history" /></p>;
  return (
    <DeliveryHistoryView
      result={result}
      status={filters.status}
      invoiceId={filters.invoiceId}
      invoiceOptions={invoiceOptions}
      stageLabels={stageLabels}
      firmTimezone={firmTimezone}
      onFilter={(next) => setFilters({ ...next, offset: 0 })}
      onPage={(offset) => setFilters((current) => ({ ...current, offset }))}
      onRetry={async (attemptId) => {
        const retried = await api.retryDelivery(attemptId);
        if (retried.ok === true || retried.kind === "conflict") await load();
        return retried;
      }}
    />
  );
}
