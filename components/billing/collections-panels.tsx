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
  invoiceScope,
  noticesAwaitingSend,
  formatFirmDate,
  formatFirmDateTime,
  stageLabel,
  STAGE_LABELS,
  viewerIsPowerUser,
  type StageLabels,
} from "@/lib/billing-ui/view-model";
import { ActionButton, LedgerForm, OwnerAdminOnly, type FormValues } from "./ui";

type Mutation = Promise<ApiResult<unknown>>;

/**
 * An open invoice the user can attach a hold or Collections activity to. A Billing
 * invoice's id is its invoice id; a report-only invoice (Phase 4) uses
 * `pdf_import:<source_invoice_id>` and carries its source fields.
 */
export interface InvoiceOption {
  id: string;
  invoice_number: string;
  client_id: string;
  source?: "billing" | "pdf_import";
  source_invoice_id?: string | null;
  source_as_of?: string | null;
}

export const PDF_OPTION_PREFIX = "pdf_import:";

/** How a hold or event names its invoice; null when it covers the whole client. */
function targetLabel(item: Pick<CollectionHold, "invoice_id" | "invoice_number" | "source_invoice_id" | "canonical_collection_identity" | "source">, invoiceNumbers: Record<string, string>) {
  if (!invoiceScope(item)) return null;
  const number = item.invoice_number || (item.invoice_id ? invoiceNumbers[item.invoice_id] || item.invoice_id : item.source_invoice_id ? invoiceNumbers[`${PDF_OPTION_PREFIX}${item.source_invoice_id}`] : null) || "imported invoice";
  return !item.invoice_id && item.source_invoice_id ? `${number} (A/R report)` : number;
}

function optionLabel(option: InvoiceOption) {
  return option.source === "pdf_import" ? `${option.invoice_number} (A/R report${option.source_as_of ? ` as of ${option.source_as_of}` : ""})` : option.invoice_number;
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
    const label = targetLabel(hold, invoiceNumbers);
    scopes.add(label ? `invoice ${label}` : "whole client");
    byClient.set(hold.client_id, scopes);
  }
  const scopes = [...byClient.entries()].map(([id, parts]) => {
    const list = [...parts].sort((a, b) => (a === "whole client" ? -1 : b === "whole client" ? 1 : a.localeCompare(b)));
    return `${clientNames[id] || id} (${list.join(", ")})`;
  });
  return (
    <div role="status" data-active-hold-banner className="bc-strip">
      <b>Collections hold in force</b> for {scopes.join(", ")}. Escalation and formal-notice requests and approvals are blocked for that scope until the hold is released or its review date passes.
    </div>
  );
}

/** Holds as the demo's "On hold — never chased" list, with release and place-hold for Owner/Admin. */
export function HoldsPanel({ holds, clientId, clientNames, invoiceOptions, viewer, today, firmTimezone = "America/Chicago", onPlace, onRelease }: {
  holds: CollectionHold[];
  clientId: string | null;
  clientNames: Record<string, string>;
  invoiceOptions: InvoiceOption[];
  viewer: Viewer | null;
  today: string;
  firmTimezone?: string;
  onPlace: (values: FormValues) => Mutation;
  onRelease: (holdId: string) => Mutation;
}) {
  const power = viewerIsPowerUser(viewer);
  const invoiceNumbers = Object.fromEntries(invoiceOptions.map((option) => [option.id, option.invoice_number]));
  const clientInvoices = invoiceOptions.filter((option) => option.client_id === clientId);
  return (
    <div className="bc-exlist">
      {holds.length === 0 ? <div className="bc-exrow"><span className="why">No holds.</span></div> : holds.map((hold) => {
        const released = Boolean(hold.released_at);
        const inForce = holdInForce(hold, today);
        const holdState = released ? "released" : inForce ? "active" : "expired";
        return (
          <div key={hold.id} className="bc-exrow" data-hold-row={hold.id} data-hold-state={holdState}>
            <div>
              <div className="n">{clientNames[hold.client_id] || hold.client_id}</div>
              <div data-hold-scope className="bc-small">
                {targetLabel(hold, invoiceNumbers) ? `Invoice ${targetLabel(hold, invoiceNumbers)} only` : "Whole client"}
              </div>
            </div>
            <div>
              <div className="why">{hold.reason}</div>
              <div className="bc-small">
                Placed {formatFirmDate(hold.placed_at, firmTimezone)}{hold.expires_on ? ` · review by ${hold.expires_on}` : ""}
              </div>
              {!released && holdExpiryPassed(hold, today) ? <div className="bc-small">Review date passed; no longer blocks. Release it to close it out.</div> : null}
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
              <span className={`bc-pill ${released ? "grey" : inForce ? "amber" : "red"}`}>
                {released ? `Released ${formatFirmDate(hold.released_at || "", firmTimezone)}` : inForce ? "On hold" : "Expired, not released"}
              </span>
              {!released && power ? <ActionButton quiet label="Release hold" onAction={() => onRelease(hold.id)} /> : null}
            </div>
          </div>
        );
      })}
      {power ? (
        clientId ? (
          <details className="bc-exadd">
            <summary>+ Place a hold for {clientNames[clientId] || "this client"}</summary>
            <section aria-label="Place hold" style={{ maxWidth: 440 }}>
              <LedgerForm
                key={`hold-${clientId}-${today}`}
                fields={[
                  { name: "reason", label: "Reason", type: "textarea" },
                  { name: "invoice_id", label: "Applies to", type: "select", optional: true, options: clientInvoices.map((option) => ({ value: option.id, label: `Invoice ${optionLabel(option)} only` })) },
                  { name: "expires_on", label: "Review by", type: "date", optional: true },
                ]}
                initialValues={{ client_id: clientId, reason: "", invoice_id: "", expires_on: "" }}
                validate={(values) => validateHold(values, today)}
                onSubmit={onPlace}
                submitLabel="Place hold"
              />
              <p className="bc-note">Leave &ldquo;Applies to&rdquo; empty to hold the whole client.</p>
            </section>
          </details>
        ) : <div className="bc-exadd bc-small">Choose a client to place a hold.</div>
      ) : <div className="bc-exadd bc-small"><OwnerAdminOnly action="Placing or releasing a hold" /></div>}
    </div>
  );
}

const APPROVAL_LABELS: Record<string, string> = { escalated: "Approve escalation", formal_notice_approved: "Approve formal notice" };

interface EventsProps {
  events: CollectionEvent[];
  holds: CollectionHold[];
  invoiceOptions: InvoiceOption[];
  clientId: string | null;
  clientNames: Record<string, string>;
  viewer: Viewer | null;
  today: string;
  firmTimezone?: string;
  onLog: (values: FormValues) => Mutation;
  onApprove: (eventId: string, approvalType: "escalated" | "formal_notice_approved") => Mutation;
  onRecordNoticeSent: (approval: CollectionEvent, note: string) => Mutation;
  stageLabels?: StageLabels;
}

function eventLabels({ invoiceOptions, clientNames, firmTimezone = "America/Chicago" }: Pick<EventsProps, "invoiceOptions" | "clientNames" | "firmTimezone">) {
  const invoiceNumbers = Object.fromEntries(invoiceOptions.map((option) => [option.id, option.invoice_number]));
  const invoiceLabel = (event: CollectionEvent) => targetLabel(event, invoiceNumbers);
  const describe = (event: CollectionEvent) =>
    `${clientNames[event.client_id] || event.client_id}${invoiceLabel(event) ? ` · invoice ${invoiceLabel(event)}` : ""} · ${formatFirmDate(event.occurred_at, firmTimezone)}`;
  return { invoiceNumbers, invoiceLabel, describe };
}

/** Escalation and formal-notice decisions, and approved notices still to record as sent. */
export function DecisionsPanel(props: EventsProps) {
  const { events, holds, viewer, today, onApprove, onRecordNoticeSent } = props;
  const { describe } = eventLabels(props);
  const requests = approvalRequests(events, holds, viewer, today).filter((item) => item.state !== "approved");
  const notices = noticesAwaitingSend(events, holds, viewer, today);
  return (
    <div className="bc-grid2">
      <section className="bc-cfgcard" aria-label="Requests awaiting approval">
        <h3 className="bc-h">Requests awaiting approval <small>touches 4 and 5</small></h3>
        {requests.length === 0 ? <p className="bc-hint">Nothing awaiting approval.</p> : (
          <ul className="bc-list">
            {requests.map(({ request, approvalType, state }) => (
              <li key={request.id} className="bc-item" data-approval-request={request.id} data-approval-state={state}>
                <span className={`dot${state === "blocked_by_hold" ? " red" : ""}`} />
                <div className="grow">
                  <div className="ct">{EVENT_LABELS[request.event_type]}</div>
                  <div className="cd">{describe(request)}</div>
                </div>
                {state === "can_approve" ? <ActionButton label={APPROVAL_LABELS[approvalType]} onAction={() => onApprove(request.id, approvalType)} /> : null}
                {state === "requires_owner_admin" ? <OwnerAdminOnly action={APPROVAL_LABELS[approvalType]} /> : null}
                {state === "blocked_by_hold" ? <span data-blocked-by-hold className="bc-pill amber">Blocked by an active hold.</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="bc-cfgcard" aria-label="Approved notices">
        <h3 className="bc-h">Approved notices not yet recorded as sent</h3>
        <p className="bc-hint">TAP Hub does not send notices. After the approved notice goes out by your usual process, an Owner or Admin records it here. A hold placed after the notice went out does not stop you recording it.</p>
        {notices.length === 0 ? <p className="bc-hint">No approved notices waiting.</p> : (
          <ul className="bc-list">
            {notices.map(({ approval, state }) => (
              <li key={approval.id} className="bc-item" data-notice-approval={approval.id} data-notice-state={state}>
                <span className="dot green" />
                <div className="grow">
                  <div className="ct">Formal notice approved</div>
                  <div className="cd">{describe(approval)}</div>
                  {state === "can_record" ? (
                    <details className="bc-details" style={{ marginTop: 8 }}>
                      <summary>Record notice sent</summary>
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
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** The log-activity form and the Collections history. */
export function ActivityPanel(props: EventsProps) {
  const { events, holds, invoiceOptions, clientId, clientNames, today, firmTimezone = "America/Chicago", onLog, stageLabels = STAGE_LABELS } = props;
  const { invoiceNumbers, invoiceLabel } = eventLabels(props);
  const clientWideHold = clientId ? holdBlocks(holds, today, clientId, null) : false;
  const clientInvoices = invoiceOptions.filter((option) => option.client_id === clientId);
  const heldInvoices = clientWideHold ? [] : [...new Set(
    activeHolds(holds, today, clientId).flatMap((hold) => { const label = targetLabel(hold, invoiceNumbers); return label ? [label] : []; }),
  )];

  return (
    <div className="bc-cols wide">
      <section className="bc-card" aria-label="History">
        <h3 className="bc-h">History <small>newest first · firm time</small></h3>
        {events.length === 0 ? <p className="bc-hint">No Collections activity yet.</p> : (
          <div className="bc-scroll">
            <table className="bc-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Client</th>
                  <th>Invoice</th>
                  <th>Activity</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id} data-event-row={event.id}>
                    <td className="bc-small" style={{ whiteSpace: "nowrap" }}>{formatFirmDateTime(event.occurred_at, firmTimezone)}</td>
                    <td>{clientNames[event.client_id] || event.client_id}</td>
                    <td className="bc-nowrap">{invoiceLabel(event) || "All"}</td>
                    <td>
                      {EVENT_LABELS[event.event_type] || event.event_type}
                      {event.event_type === "reminder_logged" && event.stage ? <div className="bc-small">Ladder {stageLabel(event.stage, stageLabels)}</div> : null}
                    </td>
                    <td className="bc-muted">{typeof event.detail?.note === "string" ? event.detail.note : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="bc-card" aria-label="Log activity">
        <h3 className="bc-h">Log activity {clientId ? <small>{clientNames[clientId] || ""}</small> : null}</h3>
        {clientId ? (
          <>
            {clientWideHold ? <p data-requests-blocked className="bc-hint">A client-wide hold is in force, so escalation and formal-notice requests will be refused. Notes, reminders, calls, and promises to pay can still be logged.</p> : null}
            {heldInvoices.length ? (
              <p data-invoice-holds className="bc-hint">
                {heldInvoices.length === 1 ? "Invoice" : "Invoices"} {heldInvoices.join(", ")} {heldInvoices.length === 1 ? "has" : "have"} a hold, so escalation and formal-notice requests for {heldInvoices.length === 1 ? "it" : "them"} will be refused.
              </p>
            ) : null}
            <LedgerForm
              key={`event-${clientId}`}
              fields={[
                { name: "event_type", label: "Activity", type: "select", options: LOGGABLE_EVENT_TYPES.map((type) => ({ value: type, label: EVENT_LABELS[type] })) },
                { name: "invoice_id", label: "Invoice", type: "select", optional: true, options: clientInvoices.map((option) => ({ value: option.id, label: optionLabel(option) })) },
                { name: "note", label: "Details", type: "textarea", optional: true },
              ]}
              initialValues={{ client_id: clientId, event_type: "", invoice_id: "", note: "" }}
              validate={validateEvent}
              onSubmit={onLog}
              submitLabel="Log activity"
            />
            <p className="bc-note">Escalation and formal-notice requests must name the invoice.</p>
          </>
        ) : <p className="bc-hint">Choose a client to log Collections activity.</p>}
      </section>
    </div>
  );
}

/** Decisions, activity, and history together (the Collections page shows them on separate tabs). */
export function EventsPanel(props: EventsProps) {
  return (
    <div className="bc-stack">
      <DecisionsPanel {...props} />
      <ActivityPanel {...props} />
    </div>
  );
}
