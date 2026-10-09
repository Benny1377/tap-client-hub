"use client";

import type { ApiResult } from "@/lib/billing-ui/api";
import type { CollectionEvent, CollectionHold, Receivable, Viewer } from "@/lib/billing-ui/types";
import { LOGGABLE_EVENT_TYPES, validateEvent, validateHold } from "@/lib/billing-ui/validation";
import { activeHolds, approvalRequests, EVENT_LABELS, holdExpiryPassed, viewerIsPowerUser } from "@/lib/billing-ui/view-model";
import { ActionButton, cellStyle, hintStyle, LedgerForm, OwnerAdminOnly, tableStyle, type FormValues } from "./ui";

type Mutation = Promise<ApiResult<unknown>>;

export function ActiveHoldBanner({ holds, clientId, clientNames }: { holds: CollectionHold[]; clientId: string | null; clientNames: Record<string, string> }) {
  const active = activeHolds(holds, clientId);
  if (active.length === 0) return null;
  const clients = [...new Set(active.map((hold) => clientNames[hold.client_id] || hold.client_id))];
  return (
    <div role="status" data-active-hold-banner style={{ background: "var(--amber-soft)", border: "1px solid #e8d3a6", color: "#7a5210", borderRadius: 12, padding: "10px 14px", fontSize: 13.5, margin: "12px 0" }}>
      <strong>Collections hold active</strong> for {clients.join(", ")}. Escalation and formal-notice approvals are blocked until the hold is released.
    </div>
  );
}

export function HoldsPanel({ holds, clientId, clientNames, viewer, today, onPlace, onRelease }: {
  holds: CollectionHold[];
  clientId: string | null;
  clientNames: Record<string, string>;
  viewer: Viewer | null;
  today: string;
  onPlace: (values: FormValues) => Mutation;
  onRelease: (holdId: string) => Mutation;
}) {
  const power = viewerIsPowerUser(viewer);
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
                <th style={cellStyle}>Expires</th>
                <th style={cellStyle}>State</th>
              </tr>
            </thead>
            <tbody>
              {holds.map((hold) => {
                const active = !hold.released_at;
                return (
                  <tr key={hold.id} data-hold-row={hold.id} data-hold-state={active ? "active" : "released"}>
                    <td style={cellStyle}>{clientNames[hold.client_id] || hold.client_id}</td>
                    <td style={cellStyle}>{hold.reason}</td>
                    <td style={cellStyle}>{hold.placed_at.slice(0, 10)}</td>
                    <td style={cellStyle}>
                      {hold.expires_on || "—"}
                      {active && holdExpiryPassed(hold, today) ? <div style={{ fontSize: 12, color: "var(--muted)" }}>Date passed; still blocks until released.</div> : null}
                    </td>
                    <td style={cellStyle}>
                      {active ? <strong>Active</strong> : `Released ${hold.released_at?.slice(0, 10)}`}
                      {active && power ? <div><ActionButton quiet label="Release hold" onAction={() => onRelease(hold.id)} /></div> : null}
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
              key={`hold-${clientId}`}
              fields={[
                { name: "reason", label: "Reason", type: "textarea" },
                { name: "expires_on", label: "Review by", type: "date", optional: true },
              ]}
              initialValues={{ client_id: clientId, reason: "", expires_on: "" }}
              validate={validateHold}
              onSubmit={onPlace}
              submitLabel="Place hold"
            />
          </section>
        ) : <p style={hintStyle}>Choose a client to place a hold.</p>
      ) : <p style={hintStyle}><OwnerAdminOnly action="Placing or releasing a hold" /></p>}
    </div>
  );
}

const APPROVAL_LABELS: Record<string, string> = { escalated: "Approve escalation", formal_notice_approved: "Approve formal notice" };

export function EventsPanel({ events, holds, receivables, clientId, clientNames, viewer, onLog, onApprove }: {
  events: CollectionEvent[];
  holds: CollectionHold[];
  receivables: Receivable[];
  clientId: string | null;
  clientNames: Record<string, string>;
  viewer: Viewer | null;
  onLog: (values: FormValues) => Mutation;
  onApprove: (eventId: string, approvalType: "escalated" | "formal_notice_approved") => Mutation;
}) {
  const requests = approvalRequests(events, holds, viewer);
  const clientInvoices = receivables.filter((row) => row.client_id === clientId);

  return (
    <div>
      <h3 style={{ fontSize: 14, margin: "4px 0 6px" }}>Requests awaiting approval</h3>
      {requests.filter((item) => item.state !== "approved").length === 0 ? <p style={hintStyle}>Nothing awaiting approval.</p> : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {requests.filter((item) => item.state !== "approved").map(({ request, approvalType, state }) => (
            <li key={request.id} data-approval-request={request.id} data-approval-state={state} style={{ borderBottom: "1px solid var(--line)", padding: "8px 0", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <span>{EVENT_LABELS[request.event_type]} · {clientNames[request.client_id] || request.client_id} · {request.occurred_at.slice(0, 10)}</span>
              {state === "can_approve" ? <ActionButton label={APPROVAL_LABELS[approvalType]} onAction={() => onApprove(request.id, approvalType)} /> : null}
              {state === "requires_owner_admin" ? <OwnerAdminOnly action={APPROVAL_LABELS[approvalType]} /> : null}
              {state === "blocked_by_hold" ? <span data-blocked-by-hold style={{ fontSize: 12.5, color: "#7a5210" }}>Blocked by an active hold.</span> : null}
            </li>
          ))}
        </ul>
      )}

      {clientId ? (
        <section aria-label="Log activity" style={{ maxWidth: 420 }}>
          <h3 style={{ fontSize: 14, margin: "14px 0 6px" }}>Log activity</h3>
          <LedgerForm
            key={`event-${clientId}`}
            fields={[
              { name: "event_type", label: "Activity", type: "select", options: LOGGABLE_EVENT_TYPES.map((type) => ({ value: type, label: EVENT_LABELS[type] })) },
              { name: "invoice_id", label: "Invoice", type: "select", optional: true, options: clientInvoices.map((row) => ({ value: row.id, label: row.invoice_number })) },
              { name: "note", label: "Details", type: "textarea", optional: true },
            ]}
            initialValues={{ client_id: clientId, event_type: "", invoice_id: "", note: "" }}
            validate={validateEvent}
            onSubmit={onLog}
            submitLabel="Log activity"
          />
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
                <th style={cellStyle}>Activity</th>
                <th style={cellStyle}>Details</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} data-event-row={event.id}>
                  <td style={cellStyle}>{event.occurred_at.slice(0, 16).replace("T", " ")}</td>
                  <td style={cellStyle}>{clientNames[event.client_id] || event.client_id}</td>
                  <td style={cellStyle}>{EVENT_LABELS[event.event_type] || event.event_type}</td>
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
