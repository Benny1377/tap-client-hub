"use client";

import type { ApiResult } from "@/lib/billing-ui/api";
import type { CollectionEvent, CollectionHold, Viewer } from "@/lib/billing-ui/types";
import { LOGGABLE_EVENT_TYPES, validateEvent, validateHold, validateReason } from "@/lib/billing-ui/validation";
import {
  activeHolds,
  approvalRequests,
  EVENT_LABELS,
  holdBlocks,
  holdExpiryPassed,
  holdInForce,
  noticesAwaitingSend,
  stageLabel,
  viewerIsPowerUser,
} from "@/lib/billing-ui/view-model";
import { ActionButton, cellStyle, hintStyle, LedgerForm, OwnerAdminOnly, tableStyle, type FormValues } from "./ui";

type Mutation = Promise<ApiResult<unknown>>;

/** An open invoice the user can attach a hold or Collections activity to. */
export interface InvoiceOption {
  id: string;
  invoice_number: string;
  client_id: string;
}

export function ActiveHoldBanner({ holds, clientId, clientNames, invoiceNumbers, today }: {
  holds: CollectionHold[];
  clientId: string | null;
  clientNames: Record<string, string>;
  invoiceNumbers: Record<string, string>;
  today: string;
}) {
  const active = activeHolds(holds, today, clientId);
  if (active.length === 0) return null;
  const byClient = new Map<string, Set<string>>();
  for (const hold of active) {
    const scopes = byClient.get(hold.client_id) || new Set<string>();
    scopes.add(hold.invoice_id ? `invoice ${invoiceNumbers[hold.invoice_id] || hold.invoice_id}` : "whole client");
    byClient.set(hold.client_id, scopes);
  }
  const scopes = [...byClient.entries()].map(([id, parts]) => {
    const list = [...parts].sort((a, b) => (a === "whole client" ? -1 : b === "whole client" ? 1 : a.localeCompare(b)));
    return `${clientNames[id] || id} (${list.join(", ")})`;
  });
  return (
    <div role="status" data-active-hold-banner style={{ background: "var(--amber-soft)", border: "1px solid #e8d3a6", color: "#7a5210", borderRadius: 12, padding: "10px 14px", fontSize: 13.5, margin: "12px 0" }}>
      <strong>Collections hold in force</strong> for {scopes.join(", ")}. Escalation and formal-notice requests and approvals are blocked for that scope until the hold is released or its review date passes.
    </div>
  );
}

export function HoldsPanel({ holds, clientId, clientNames, invoiceOptions, viewer, today, onPlace, onRelease }: {
  holds: CollectionHold[];
  clientId: string | null;
  clientNames: Record<string, string>;
  invoiceOptions: InvoiceOption[];
  viewer: Viewer | null;
  today: string;
  onPlace: (values: FormValues) => Mutation;
  onRelease: (holdId: string) => Mutation;
}) {
  const power = viewerIsPowerUser(viewer);
  const invoiceNumbers = Object.fromEntries(invoiceOptions.map((option) => [option.id, option.invoice_number]));
  const clientInvoices = invoiceOptions.filter((option) => option.client_id === clientId);
  return (
    <div>
      {holds.length === 0 ? <p style={hintStyle}>No holds.</p> : (
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={cellStyle}>Client</th>
                <th style={cellStyle}>Reason</th>
                <th style={cellStyle}>Placed</th>
                <th style={cellStyle}>Review by</th>
                <th style={cellStyle}>State</th>
              </tr>
            </thead>
            <tbody>
              {holds.map((hold) => {
                const released = Boolean(hold.released_at);
                const inForce = holdInForce(hold, today);
                const holdState = released ? "released" : inForce ? "active" : "expired";
                return (
                  <tr key={hold.id} data-hold-row={hold.id} data-hold-state={holdState}>
                    <td style={cellStyle}>{clientNames[hold.client_id] || hold.client_id}</td>
                    <td style={cellStyle}>{hold.reason}</td>
                    <td style={cellStyle}>{hold.placed_at.slice(0, 10)}</td>
                    <td style={cellStyle}>
                      {hold.expires_on || "—"}
                      {!released && holdExpiryPassed(hold, today) ? <div style={{ fontSize: 12, color: "var(--muted)" }}>Review date passed; no longer blocks. Release it to close it out.</div> : null}
                    </td>
                    <td style={cellStyle}>
                      {released ? `Released ${hold.released_at?.slice(0, 10)}` : inForce ? <strong>Active</strong> : "Expired, not released"}
                      <div data-hold-scope style={{ fontSize: 12, color: "var(--muted)" }}>
                        {hold.invoice_id ? `Invoice ${invoiceNumbers[hold.invoice_id] || hold.invoice_id} only` : "Whole client"}
                      </div>
                      {!released && power ? <div><ActionButton quiet label="Release hold" onAction={() => onRelease(hold.id)} /></div> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {power ? (
        clientId ? (
          <section aria-label="Place hold" style={{ maxWidth: 420 }}>
            <h3 style={{ fontSize: 14, margin: "10px 0 6px" }}>Place hold</h3>
            <LedgerForm
              key={`hold-${clientId}-${today}`}
              fields={[
                { name: "reason", label: "Reason", type: "textarea" },
                { name: "invoice_id", label: "Applies to", type: "select", optional: true, options: clientInvoices.map((option) => ({ value: option.id, label: `Invoice ${option.invoice_number} only` })) },
                { name: "expires_on", label: "Review by", type: "date", optional: true },
              ]}
              initialValues={{ client_id: clientId, reason: "", invoice_id: "", expires_on: "" }}
              validate={(values) => validateHold(values, today)}
              onSubmit={onPlace}
              submitLabel="Place hold"
            />
            <p style={hintStyle}>Leave &ldquo;Applies to&rdquo; empty to hold the whole client.</p>
          </section>
        ) : <p style={hintStyle}>Choose a client to place a hold.</p>
      ) : <p style={hintStyle}><OwnerAdminOnly action="Placing or releasing a hold" /></p>}
    </div>
  );
}

const APPROVAL_LABELS: Record<string, string> = { escalated: "Approve escalation", formal_notice_approved: "Approve formal notice" };

export function EventsPanel({ events, holds, invoiceOptions, clientId, clientNames, viewer, today, onLog, onApprove, onRecordNoticeSent }: {
  events: CollectionEvent[];
  holds: CollectionHold[];
  invoiceOptions: InvoiceOption[];
  clientId: string | null;
  clientNames: Record<string, string>;
  viewer: Viewer | null;
  today: string;
  onLog: (values: FormValues) => Mutation;
  onApprove: (eventId: string, approvalType: "escalated" | "formal_notice_approved") => Mutation;
  onRecordNoticeSent: (approval: CollectionEvent, note: string) => Mutation;
}) {
  const requests = approvalRequests(events, holds, viewer, today).filter((item) => item.state !== "approved");
  const notices = noticesAwaitingSend(events, holds, viewer, today);
  const clientWideHold = clientId ? holdBlocks(holds, today, clientId, null) : false;
  const clientInvoices = invoiceOptions.filter((option) => option.client_id === clientId);
  const invoiceNumbers = Object.fromEntries(invoiceOptions.map((option) => [option.id, option.invoice_number]));
  const heldInvoices = clientWideHold ? [] : [...new Set(
    activeHolds(holds, today, clientId).filter((hold) => hold.invoice_id).map((hold) => invoiceNumbers[hold.invoice_id as string] || (hold.invoice_id as string)),
  )];
  const describe = (event: CollectionEvent) =>
    `${clientNames[event.client_id] || event.client_id}${event.invoice_id ? ` · invoice ${invoiceNumbers[event.invoice_id] || event.invoice_id}` : ""} · ${event.occurred_at.slice(0, 10)}`;

  return (
    <div>
      <h3 style={{ fontSize: 14, margin: "4px 0 6px" }}>Requests awaiting approval</h3>
      {requests.length === 0 ? <p style={hintStyle}>Nothing awaiting approval.</p> : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {requests.map(({ request, approvalType, state }) => (
            <li key={request.id} data-approval-request={request.id} data-approval-state={state} style={{ borderBottom: "1px solid var(--line)", padding: "8px 0", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <span>{EVENT_LABELS[request.event_type]} · {describe(request)}</span>
              {state === "can_approve" ? <ActionButton label={APPROVAL_LABELS[approvalType]} onAction={() => onApprove(request.id, approvalType)} /> : null}
              {state === "requires_owner_admin" ? <OwnerAdminOnly action={APPROVAL_LABELS[approvalType]} /> : null}
              {state === "blocked_by_hold" ? <span data-blocked-by-hold style={{ fontSize: 12.5, color: "#7a5210" }}>Blocked by an active hold.</span> : null}
            </li>
          ))}
        </ul>
      )}

      <h3 style={{ fontSize: 14, margin: "14px 0 6px" }}>Approved notices not yet recorded as sent</h3>
      <p style={hintStyle}>TAP Hub does not send notices. After the approved notice goes out by your usual process, an Owner or Admin records it here.</p>
      {notices.length === 0 ? <p style={hintStyle}>No approved notices waiting.</p> : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {notices.map(({ approval, state }) => (
            <li key={approval.id} data-notice-approval={approval.id} data-notice-state={state} style={{ borderBottom: "1px solid var(--line)", padding: "8px 0" }}>
              <div>Formal notice approved · {describe(approval)}</div>
              {state === "can_record" ? (
                <details>
                  <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--teal)" }}>Record notice sent</summary>
                  <LedgerForm
                    fields={[{ name: "note", label: "How and when it was sent", type: "textarea" }]}
                    initialValues={{ note: "" }}
                    validate={(values) => (validateReason(values.note).reason ? { note: "Say how and when the notice was sent." } : {})}
                    onSubmit={(values) => onRecordNoticeSent(approval, values.note)}
                    submitLabel="Record notice sent"
                  />
                </details>
              ) : null}
              {state === "requires_owner_admin" ? <OwnerAdminOnly action="Recording a notice as sent" /> : null}
              {state === "blocked_by_hold" ? <span data-blocked-by-hold style={{ fontSize: 12.5, color: "#7a5210" }}>Blocked by an active hold.</span> : null}
            </li>
          ))}
        </ul>
      )}

      {clientId ? (
        <section aria-label="Log activity" style={{ maxWidth: 420 }}>
          <h3 style={{ fontSize: 14, margin: "14px 0 6px" }}>Log activity</h3>
          {clientWideHold ? <p data-requests-blocked style={hintStyle}>A client-wide hold is in force, so escalation and formal-notice requests will be refused. Notes, reminders, calls, and promises to pay can still be logged.</p> : null}
          {heldInvoices.length ? (
            <p data-invoice-holds style={hintStyle}>
              {heldInvoices.length === 1 ? "Invoice" : "Invoices"} {heldInvoices.join(", ")} {heldInvoices.length === 1 ? "has" : "have"} a hold, so escalation and formal-notice requests for {heldInvoices.length === 1 ? "it" : "them"} will be refused.
            </p>
          ) : null}
          <LedgerForm
            key={`event-${clientId}`}
            fields={[
              { name: "event_type", label: "Activity", type: "select", options: LOGGABLE_EVENT_TYPES.map((type) => ({ value: type, label: EVENT_LABELS[type] })) },
              { name: "invoice_id", label: "Invoice", type: "select", optional: true, options: clientInvoices.map((option) => ({ value: option.id, label: option.invoice_number })) },
              { name: "note", label: "Details", type: "textarea", optional: true },
            ]}
            initialValues={{ client_id: clientId, event_type: "", invoice_id: "", note: "" }}
            validate={validateEvent}
            onSubmit={onLog}
            submitLabel="Log activity"
          />
          <p style={hintStyle}>Escalation and formal-notice requests must name the invoice.</p>
        </section>
      ) : <p style={hintStyle}>Choose a client to log Collections activity.</p>}

      <h3 style={{ fontSize: 14, margin: "16px 0 6px" }}>History</h3>
      {events.length === 0 ? <p style={hintStyle}>No Collections activity yet.</p> : (
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={cellStyle}>When</th>
                <th style={cellStyle}>Client</th>
                <th style={cellStyle}>Invoice</th>
                <th style={cellStyle}>Activity</th>
                <th style={cellStyle}>Details</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} data-event-row={event.id}>
                  <td style={cellStyle}>{event.occurred_at.slice(0, 16).replace("T", " ")}</td>
                  <td style={cellStyle}>{clientNames[event.client_id] || event.client_id}</td>
                  <td style={cellStyle}>{event.invoice_id ? invoiceNumbers[event.invoice_id] || "—" : "All"}</td>
                  <td style={cellStyle}>
                    {EVENT_LABELS[event.event_type] || event.event_type}
                    {event.event_type === "reminder_logged" && event.stage ? <div style={{ fontSize: 12, color: "var(--muted)" }}>Ladder {stageLabel(event.stage)}</div> : null}
                  </td>
                  <td style={cellStyle}>{typeof event.detail?.note === "string" ? event.detail.note : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
