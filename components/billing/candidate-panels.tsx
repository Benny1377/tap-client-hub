"use client";

import { useState } from "react";
import type { ApiResult } from "@/lib/billing-ui/api";
import { CANDIDATE_FILTERS, CANDIDATE_STATE_LABELS, candidateTypeLabel, candidateUnits, selectedCandidateIds, type CandidateUnit } from "@/lib/billing-ui/candidates";
import type { BillingBundle, Candidate, CandidateState } from "@/lib/billing-ui/types";
import { validateReason } from "@/lib/billing-ui/validation";
import { formatMoney } from "@/lib/billing-ui/view-model";
import { hintStyle, LedgerForm, SegFilter, type FormValues } from "./ui";

type Mutation = Promise<ApiResult<unknown>>;

export interface CandidateHandlers {
  onDismiss: (id: string, reason: string) => Mutation;
  onReopen: (id: string, reason: string) => Mutation;
  onReprice: (id: string, reason: string) => Mutation;
  onDraft: (candidateIds: string[], memo: string) => Mutation;
}

function ReasonAction({ label, description, submitLabel, onSubmit }: { label: string; description?: string; submitLabel: string; onSubmit: (reason: string) => Mutation }) {
  return (
    <details data-candidate-action={label}>
      <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>{label}</summary>
      {description ? <p style={hintStyle}>{description}</p> : null}
      <LedgerForm
        fields={[{ name: "reason", label: "Reason", type: "textarea" }]}
        initialValues={{ reason: "" }}
        validate={(values: FormValues) => validateReason(values.reason)}
        onSubmit={(values: FormValues) => onSubmit(values.reason.trim())}
        submitLabel={submitLabel}
      />
    </details>
  );
}

function CandidateActions({ candidate, handlers }: { candidate: Candidate; handlers: CandidateHandlers }) {
  const active = candidate.state === "open" || candidate.state === "unpriced";
  if (!active && candidate.state !== "dismissed") return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {active ? <ReasonAction label="Reprice" description="Looks up the current price on the server. Existing drafts and invoices are not changed." submitLabel="Reprice" onSubmit={(reason) => handlers.onReprice(candidate.id, reason)} /> : null}
      {active ? <ReasonAction label="Dismiss" submitLabel="Dismiss" onSubmit={(reason) => handlers.onDismiss(candidate.id, reason)} /> : null}
      {candidate.state === "dismissed" ? <ReasonAction label="Reopen" submitLabel="Reopen" onSubmit={(reason) => handlers.onReopen(candidate.id, reason)} /> : null}
    </div>
  );
}

function UnitRow({ unit, selected, canSelect, canManage, onToggle, handlers }: {
  unit: CandidateUnit;
  selected: boolean;
  canSelect: boolean;
  canManage: boolean;
  onToggle: () => void;
  handlers: CandidateHandlers;
}) {
  const single = unit.candidates[0];
  return (
    <tr data-candidate-row={unit.key} data-candidate-state={unit.state}>
      {canSelect ? (
        <td>
          <input type="checkbox" checked={selected} disabled={!unit.selectable} onChange={onToggle} aria-label={`Select ${unit.description}, ${unit.candidateDate}`} />
        </td>
      ) : null}
      <td className="bc-nowrap">{unit.candidateDate}</td>
      <td>
        {unit.description}
        {unit.bundle ? <div className="bc-small" data-candidate-components>{unit.candidates.map((candidate) => candidate.description).join(" · ")}</div> : null}
        {unit.blockedReason ? <div className="bc-small" data-candidate-blocked>{unit.blockedReason}</div> : null}
      </td>
      <td>{unit.bundle ? "Package" : candidateTypeLabel(single.candidateType)}</td>
      <td className="bc-nowrap">{single.period || "—"}</td>
      <td className="r num">{unit.unitAmount === null ? <span className="sub">No price</span> : formatMoney(unit.unitAmount)}</td>
      <td>{CANDIDATE_STATE_LABELS[unit.state]}</td>
      {canManage ? (
        <td>
          {unit.bundle ? (
            <details data-candidate-services>
              <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>{unit.candidates.length} {unit.candidates.length === 1 ? "service" : "services"}</summary>
              {unit.candidates.map((candidate) => (
                <div key={candidate.id} style={{ marginTop: 6 }}>
                  <div className="bc-small">{candidate.description}</div>
                  <CandidateActions candidate={candidate} handlers={handlers} />
                </div>
              ))}
            </details>
          ) : <CandidateActions candidate={single} handlers={handlers} />}
        </td>
      ) : null}
    </tr>
  );
}

/** The loaded list for one client. Selection resets when the client or filter changes, because the parent keys this by both. */
export function CandidateList({ items, bundles, filter, canManage, canDraft, hasMore, loadingMore, onMore, handlers }: {
  items: Candidate[];
  bundles: BillingBundle[] | null;
  filter: CandidateState;
  canManage: boolean;
  canDraft: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onMore: () => void;
  handlers: CandidateHandlers;
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const units = candidateUnits(items, bundles || []);
  const ids = selectedCandidateIds(units, selected);
  const chosen = units.filter((unit) => unit.selectable && selected.has(unit.key)).length;
  // Without the packages, a component would look like an ordinary line, so drafting waits until they load.
  const canSelect = canDraft && filter === "open" && bundles !== null;
  const toggle = (key: string) => setSelected((previous) => {
    const next = new Set(previous);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  if (units.length === 0) return <p style={hintStyle} data-candidates-empty>No {CANDIDATE_FILTERS.find((item) => item.id === filter)?.label.toLowerCase()} candidates for this client.</p>;
  return (
    <>
      {bundles === null ? <p style={hintStyle} data-candidates-no-packages>Package pricing could not be loaded, so candidates cannot go on a draft right now.</p> : null}
      {filter === "unpriced" ? <p style={hintStyle}>These were captured but have no price. Add a price under Clients and prices, then reprice them to make them ready.</p> : null}
      <div className="panel scroll">
        <table data-candidate-table>
          <thead>
            <tr>
              {canSelect ? <th aria-label="Select" /> : null}
              <th>Date</th>
              <th>Service</th>
              <th>Type</th>
              <th>Period</th>
              <th className="r">Price</th>
              <th>Status</th>
              {canManage ? <th aria-label="Actions" /> : null}
            </tr>
          </thead>
          <tbody>
            {units.map((unit) => (
              <UnitRow key={unit.key} unit={unit} selected={selected.has(unit.key)} canSelect={canSelect} canManage={canManage} onToggle={() => toggle(unit.key)} handlers={handlers} />
            ))}
          </tbody>
        </table>
      </div>
      {hasMore ? <button type="button" className="bc-btn quiet" style={{ marginTop: 10 }} disabled={loadingMore} onClick={onMore}>{loadingMore ? "Loading…" : "Load more"}</button> : null}
      {canSelect && chosen > 0 ? (
        <section style={{ marginTop: 14 }} aria-label="Create draft from candidates" data-candidate-draft>
          <h3 style={{ fontSize: 14, margin: "6px 0" }}>Create draft from {chosen} selected {chosen === 1 ? "item" : "items"}</h3>
          <p style={hintStyle}>The server sets the amounts. Number and dates are assigned when the invoice is issued.</p>
          <LedgerForm
            fields={[{ name: "memo", label: "Memo", type: "textarea", optional: true }]}
            initialValues={{ memo: "" }}
            validate={() => ({})}
            onSubmit={async (values: FormValues) => {
              const result = await handlers.onDraft(ids, values.memo.trim());
              if (result.ok) setSelected(new Set());
              return result;
            }}
            submitLabel="Create draft"
          />
        </section>
      ) : null}
    </>
  );
}

export function CandidateFilter({ value, onChange }: { value: CandidateState; onChange: (next: CandidateState) => void }) {
  // Five labels are wider than a phone, so the filter scrolls inside its own row.
  return <div style={{ maxWidth: "100%", overflowX: "auto" }}><SegFilter label="Filter candidates" options={CANDIDATE_FILTERS} value={value} onChange={onChange} /></div>;
}
