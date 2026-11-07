"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiResult, BillingApi } from "@/lib/billing-ui/api";
import { candidateUnits } from "@/lib/billing-ui/candidates";
import type { BillingBundle, BillingCandidate, ClientOption, FirmSchedule } from "@/lib/billing-ui/types";
import { formatMoney } from "@/lib/billing-ui/view-model";
import { firmToday, isPackageRow, nextRunDates, pricedHow, runItems, runRows, shortDate, whyItMoves, type PriceOverride, type ProjectedItem } from "@/lib/billing-ui/workbench";
import { ActionButton, ErrorBanner } from "./ui";

type Failure = { kind: "unauthorized" | "forbidden" | "not_found" | "conflict" | "invalid" | "server" | "network"; message: string; code?: string };
const asFailure = (result: ApiResult<unknown>): Failure | null => (result.ok === false ? result : null);
type Generated = { created: number; existing: number; unpriced: number; skipped: number; skippedByReason: Record<string, number> };

export function PricedChip({ how }: { how: string }) {
  const tone = how === "Package" ? "c-violet" : how === "Own price" ? "c-brand" : "c-blue";
  return <span className={`chip ${tone}`}>{how}</span>;
}

/** The chain from the design: where Billing sits between Operations and Collections. */
export function BillingChain({ now, onGo }: { now: string; onGo?: (tab: string) => void }) {
  const steps = [
    { id: "", name: "Operations", detail: "Owns the client, the services and when work is done", external: true },
    { id: "pricing", name: "Price", detail: "Each client's priced lines live here" },
    { id: "invoices", name: "Invoice", detail: "Assembled from the prices, never typed" },
    { id: "payments", name: "Payment", detail: "A payment closes the invoice" },
    { id: "", name: "Collections", detail: "Chases whatever is still open", external: true },
  ];
  return (
    <div className="chain" data-billing-chain>
      {steps.map((step) => {
        const here = Boolean(now) && step.id === now;
        return (
          <div key={step.name} className={`ch${here ? " now" : ""}${step.external ? " ext" : ""}`} style={step.id && onGo ? { cursor: "pointer" } : undefined} onClick={step.id && onGo ? () => onGo(step.id) : undefined}>
            <div className="cht">{here ? "You are here" : step.external ? "Another module" : "Billing"}</div>
            <div className="chn">{step.name}</div>
            <div className="chd">{step.detail}</div>
          </div>
        );
      })}
    </div>
  );
}

/** Every client's projected work in one bounded list. The server orders it and supplies the totals; nothing is added up here. */
function FirmScheduleTable({ data, loading, loadingMore, onMore, onOpenClient }: { data: FirmSchedule | null; loading: boolean; loadingMore: boolean; onMore: () => void; onOpenClient: (id: string) => void }) {
  if (!data) return <p style={{ fontSize: 13, color: "var(--muted)" }} role="status">{loading ? "Loading the schedule…" : "The schedule isn't available right now."}</p>;
  if (data.items.length === 0) return <p style={{ fontSize: 13, color: "var(--muted)" }} data-firm-empty>Nothing projected in these dates that isn&apos;t already a candidate.</p>;
  return (
    <div data-firm-schedule>
      <div className="scroll">
        <table>
          <thead><tr><th>Date</th><th>Client</th><th>Service</th><th className="r">Price</th></tr></thead>
          <tbody>
            {data.items.map((item) => (
              <tr key={`${item.clientServiceId}|${item.sourceIdentity}`} data-firm-row>
                <td className="mono" style={{ whiteSpace: "nowrap" }}>{shortDate(item.candidateDate)}</td>
                <td><button type="button" className="lnk" style={{ textAlign: "left" }} onClick={() => onOpenClient(item.clientId)}>{item.clientName}</button></td>
                <td>{item.description}{isPackageRow(item.sourceIdentity) ? <> <PricedChip how="Package" /></> : null}</td>
                <td className="r num">{item.unitAmount === null ? <span className="sub">No price</span> : formatMoney(item.unitAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="sub" style={{ marginTop: 8 }} data-firm-shown>Showing {data.items.length} of {data.summary.candidateCount}</p>
      {data.nextCursor ? <button type="button" className="bc-btn quiet" style={{ marginTop: 8 }} disabled={loadingMore} onClick={onMore}>{loadingMore ? "Loading…" : "Load more"}</button> : null}
    </div>
  );
}

export function WhatBillsNext({ api, active, clientId, clients, canGenerate, canViewFirm, canDraft, version, draftCount, onGenerated, onDraft, onReviewDrafts, onOpenClient, onGo }: {
  api: BillingApi;
  /** True while this tab is showing. Rules and prices change elsewhere, so it reloads on each visit. */
  active: boolean;
  clientId: string | null;
  clients: ClientOption[];
  canGenerate: boolean;
  /** The all-clients schedule needs both candidates.view and pricing.view. */
  canViewFirm: boolean;
  canDraft: boolean;
  version: number;
  draftCount: number;
  onGenerated: () => void;
  onDraft: (candidateIds: string[]) => Promise<ApiResult<unknown>>;
  onReviewDrafts: () => void;
  onOpenClient: (id: string) => void;
  onGo: (tab: string) => void;
}) {
  const today = firmToday();
  const runs = useMemo(() => nextRunDates(today), [today]);
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(runs[runs.length - 1]);
  const [items, setItems] = useState<ProjectedItem[]>([]);
  const [open, setOpen] = useState<BillingCandidate[]>([]);
  const [unpriced, setUnpriced] = useState<BillingCandidate[]>([]);
  const [bundles, setBundles] = useState<BillingBundle[]>([]);
  const [overrides, setOverrides] = useState<PriceOverride[]>([]);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState<Generated | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [firm, setFirm] = useState<FirmSchedule | null>(null);
  const [firmMore, setFirmMore] = useState(false);
  // A page that lands after the dates changed belongs to the old list.
  const firmWindow = useRef("");

  const load = useCallback(async () => {
    setLoading(true); setFailure(null);
    const showFirm = !clientId && canViewFirm;
    const dates = `${from}|${to}`;
    firmWindow.current = showFirm ? dates : "";
    const [openResult, unpricedResult, pricing, schedule, firmResult] = await Promise.all([
      api.candidates({ clientId, state: "open", limit: 100 }),
      api.candidates({ clientId, state: "unpriced", limit: 100 }),
      clientId ? api.clientPricing(clientId) : Promise.resolve(null),
      clientId ? api.schedule({ from, to, clientId }) : Promise.resolve(null),
      showFirm ? api.firmSchedule({ from, to, limit: 50 }) : Promise.resolve(null),
    ]);
    if (openResult.ok) setOpen(openResult.data.items); else setFailure(asFailure(openResult));
    if (unpricedResult.ok) setUnpriced(unpricedResult.data.items);
    setBundles(pricing && pricing.ok ? pricing.data.bundles || [] : []);
    setOverrides(pricing && pricing.ok ? pricing.data.overrides as unknown as PriceOverride[] : []);
    if (schedule) { if (schedule.ok) setItems(schedule.data.items as unknown as ProjectedItem[]); else setFailure(asFailure(schedule)); } else setItems([]);
    if (firmResult && firmWindow.current === dates) { if (firmResult.ok) setFirm(firmResult.data); else { setFirm(null); setFailure(asFailure(firmResult)); } } else if (!showFirm) setFirm(null);
    setLoadedFor(clientId);
    setLoading(false);
  }, [api, canViewFirm, clientId, from, to]);

  const loadMoreFirm = async () => {
    if (!firm?.nextCursor) return;
    const dates = firmWindow.current;
    setFirmMore(true);
    const result = await api.firmSchedule({ from, to, limit: 50, cursor: firm.nextCursor });
    setFirmMore(false);
    if (firmWindow.current !== dates) return;
    if (result.ok) setFirm({ ...result.data, items: [...firm.items, ...result.data.items] }); else setFailure(asFailure(result));
  };

  // Reading the projection never creates anything; only the Generate button below writes.
  useEffect(() => { if (active) void load(); }, [active, load, refresh, version]);

  const generate = async (): Promise<ApiResult<unknown>> => {
    if (!clientId) return { ok: false, status: 422, kind: "invalid", message: "Choose a client first." };
    const result = await api.generateCandidates({ from, to, clientId });
    if (result.ok) { setGenerated(result.data); setRefresh((value) => value + 1); onGenerated(); }
    return result;
  };

  const client = clients.find((item) => item.id === clientId);
  const fresh = loadedFor === clientId;
  const unpricedCount = unpriced.length;
  const rows = fresh ? runRows(runItems(items, [...open, ...unpriced].filter((row) => row.candidateType === "recurring")), runs, bundles) : [];
  const nextRun = runs[0];
  const inNextRun = rows.filter((row) => row.cells[nextRun]).length;
  const oneOff = fresh ? open.filter((row) => row.candidateType === "completion") : [];
  const units = candidateUnits(oneOff, bundles);

  return (
    <div data-what-next>
      <BillingChain now="" onGo={onGo} />
      <div className="hero" style={{ marginBottom: 16 }}>
        <div>
          <div className="hn num" data-next-run-count>{clientId ? inNextRun : open.length}</div>
          <div className="hs">{clientId ? `${shortDate(nextRun)} run · services` : "ready to bill · all clients"}</div>
        </div>
        <div className="ht">
          <b>The next run goes out on {shortDate(nextRun)}, the last day of the month.</b> Every amount below comes from the server: a quarterly fee shows up only in its quarter. Viewing this page creates nothing, and <b>nothing is sent until you approve it</b>.
        </div>
      </div>
      <div className="g4" style={{ marginBottom: 16 }}>
        {clientId || !firm ? (
          <div className="stat"><div className="k">Recurring · {shortDate(nextRun)}</div><div className="v num">{clientId ? inNextRun : "—"}</div><div className="d">{clientId ? "services on the calendar" : "choose a client to project"}</div></div>
        ) : (
          <div className="stat" data-firm-summary><div className="k">Projected · all clients</div><div className="v num">{formatMoney(firm.summary.projectedAmount)}</div><div className="d">{firm.summary.candidateCount} items{firm.summary.unpricedCount ? `, ${firm.summary.unpricedCount} with no price` : ""}</div></div>
        )}
        <div className="stat"><div className="k">Ready to bill</div><div className="v num" style={{ color: open.length ? "var(--amber)" : undefined }}>{open.length}</div><div className="d">candidates, not invoiced</div></div>
        <div className="stat"><div className="k">No price</div><div className="v num" style={{ color: unpricedCount ? "var(--red)" : undefined }}>{unpricedCount}</div><div className="d">captured, can&apos;t be drafted yet</div></div>
        <div className="stat"><div className="k">Drafts</div><div className="v num">{draftCount}</div><div className="d">waiting for you</div></div>
      </div>
      {failure ? <ErrorBanner kind={failure.kind} message={failure.message} code={failure.code} /> : null}

      <div className="card" style={{ marginBottom: 16 }} data-next-runs>
        <h3>{clientId ? "The next three runs" : "Coming up, all clients"}<span>projected · billed on the calendar</span></h3>
        {!clientId ? (
          canViewFirm ? <FirmScheduleTable data={firm} loading={loading} loadingMore={firmMore} onMore={() => { void loadMoreFirm(); }} onOpenClient={onOpenClient} /> : <p style={{ fontSize: 13, color: "var(--muted)" }}>Choose a client above to see their next runs.</p>
        ) : rows.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--muted)" }} role="status">{loading ? "Loading the projection…" : `Nothing projected for ${client?.name || "this client"} in these runs.`}</p>
        ) : (
          <div className="scroll">
            <table className="sched">
              <thead><tr><th>Service</th><th>Priced</th>{runs.map((date) => <th key={date} className="r">{shortDate(date)}</th>)}<th>Why it moves</th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} data-run-row={row.key}>
                    <td><b>{row.description}</b>{row.serviceCode ? <div className="sub mono">{row.serviceCode}</div> : null}</td>
                    <td><PricedChip how={row.packaged ? "Package" : pricedHow(row.key, nextRun, overrides, bundles)} /></td>
                    {runs.map((date) => {
                      const cell = row.cells[date];
                      return <td key={date} className="mo">{!cell ? "—" : cell.amount === null ? <span className="sub">No price</span> : formatMoney(cell.amount)}</td>;
                    })}
                    <td style={{ fontSize: 12, color: "var(--muted)", minWidth: 200 }}>{whyItMoves(row, runs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="fine" style={{ border: "none", marginTop: 10, paddingTop: 0 }}>Each package shows once, at its package price. Change a price or a frequency in Operations and work not yet generated moves with it.{clientId ? "" : " This list leaves out work that is already a candidate; that is counted under Ready to bill."}</p>
      </div>

      <div className="card" style={{ marginBottom: 16 }} data-one-off>
        <h3>One-off work<span>billed when Operations marks it done</span></h3>
        {clientId ? units.map((unit) => (
          <div key={unit.key} style={{ display: "flex", gap: 12, alignItems: "center", padding: "11px 0", borderTop: "1px solid var(--line2)", flexWrap: "wrap" }}>
            <span className="chip c-amber">Ready to bill</span>
            <span style={{ flex: 1, minWidth: 220 }}><b>{unit.description}</b><div className="sub">{unit.candidateDate}{unit.blockedReason ? ` · ${unit.blockedReason}` : ""}</div></span>
            <b className="num">{unit.unitAmount === null ? "No price" : formatMoney(unit.unitAmount)}</b>
            {canDraft && unit.selectable ? <ActionButton label="Create the invoice" onAction={() => onDraft(unit.candidates.map((candidate) => candidate.id))} /> : null}
          </div>
        )) : open.filter((row) => row.candidateType === "completion").slice(0, 8).map((row) => (
          <div key={row.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "11px 0", borderTop: "1px solid var(--line2)", flexWrap: "wrap" }}>
            <span className="chip c-amber">Ready to bill</span>
            <span style={{ flex: 1, minWidth: 220 }}><button type="button" className="lnk" onClick={() => onOpenClient(row.clientId)}>{clients.find((item) => item.id === row.clientId)?.name || "Open client"}</button><div className="sub">{row.description} · {row.candidateDate}</div></span>
            <b className="num">{row.unitAmount === null ? "No price" : formatMoney(row.unitAmount)}</b>
          </div>
        ))}
        {(clientId ? units.length : oneOff.length + open.filter((row) => row.candidateType === "completion").length) === 0 ? <p style={{ fontSize: 13, color: "var(--muted)" }}>Nothing finished and unbilled right now.</p> : null}
        <p className="fine" style={{ border: "none", marginTop: 6, paddingTop: 0 }}>Recurring work bills on a date. One-off work bills on an event: the return filed, the work marked done, or a manual confirmation.</p>
      </div>

      <div className="card" data-generate>
        <h3>Candidates for these runs<span>generated, never sent automatically</span></h3>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="fld" style={{ margin: 0 }}><label htmlFor="bills-from">From (Houston date)</label><input id="bills-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></div>
          <div className="fld" style={{ margin: 0 }}><label htmlFor="bills-to">To (Houston date)</label><input id="bills-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></div>
          {canGenerate
            ? (clientId ? <ActionButton label="Generate candidates" onAction={generate} /> : <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Choose a client to generate candidates.</span>)
            : <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Your access does not include generating candidates.</span>}
          <button type="button" className="btn alt" onClick={onReviewDrafts}>Review drafts</button>
        </div>
        {generated ? (
          <p role="status" data-generate-result style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 12 }}>
            <b>Created {generated.created}</b> · Existing {generated.existing} · Unpriced {generated.unpriced} · Skipped {generated.skipped}
            {generated.skipped ? <> · Skip reasons: {Object.entries(generated.skippedByReason || {}).filter(([, count]) => count).map(([key, count]) => `${key.replaceAll("_", " ")}: ${count}`).join(" · ")}</> : null}
          </p>
        ) : null}
        <p className="fine" style={{ border: "none", marginTop: 10, paddingTop: 0 }}>Generating again is safe: it never duplicates a candidate. An unpriced candidate is captured but can&apos;t go on a draft until it has a price.</p>
      </div>
    </div>
  );
}
