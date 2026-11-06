"use client";

import { useEffect, useMemo, useState } from "react";
import type { ApiResult, BillingApi } from "@/lib/billing-ui/api";
import { candidateOptions } from "@/lib/billing-ui/candidate-options";
import type { BillingBundle, BillingCandidate } from "@/lib/billing-ui/types";
import { formatMoney } from "@/lib/billing-ui/view-model";
import { ActionButton, hintStyle } from "./ui";

export function CandidateWorkbench({ clientId, api, refreshToken, onCreated }: {
  clientId: string;
  api: BillingApi;
  refreshToken: number;
  onCreated: (invoiceId: string) => Promise<void>;
}) {
  const [candidates, setCandidates] = useState<BillingCandidate[]>([]);
  const [bundles, setBundles] = useState<BillingBundle[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [memo, setMemo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadedRequestKey, setLoadedRequestKey] = useState("");
  const [busy, setBusy] = useState(false);
  const requestKey = `${clientId}:${refreshToken}`;
  const loading = loadedRequestKey !== requestKey;
  const options = useMemo(() => candidateOptions(candidates, bundles), [candidates, bundles]);
  const visibleOptions = loading ? [] : options;

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.candidates({ clientId, state: "open", limit: 50 }), api.bundles(clientId)])
      .then(async ([candidateResult, firstBundlePage]) => {
        if (cancelled) return;
        setError(null); setSelected([]); setCursor(null);
        if (candidateResult.ok === false) setError(candidateResult.message);
        else { setCandidates(candidateResult.data.items); setCursor(candidateResult.data.nextCursor); }
        if (firstBundlePage.ok === false) {
          // Non-bundle candidates remain safe to use. Bundle candidates are not guessed below.
          setBundles(null);
        } else {
          let bundleItems = [...firstBundlePage.data.items];
          let bundleCursor = firstBundlePage.data.nextCursor;
          while (bundleCursor && !cancelled) {
            const nextPage = await api.bundles(clientId, bundleCursor);
            if (nextPage.ok === false) { setBundles(null); return; }
            bundleItems = [...bundleItems, ...nextPage.data.items];
            bundleCursor = nextPage.data.nextCursor;
          }
          if (!cancelled) setBundles(bundleItems);
        }
      })
      .catch(() => { if (!cancelled) setError("Could not load billable candidates."); })
      .finally(() => { if (!cancelled) setLoadedRequestKey(requestKey); });
    return () => { cancelled = true; };
  }, [api, clientId, refreshToken, requestKey]);

  const toggle = (option: (typeof options)[number]) => {
    if (!option.selectable || !option.candidateIds.length) return;
    setSelected((current) => current.includes(option.key)
      ? current.filter((key) => key !== option.key)
      : [...current, option.key]);
  };

  async function loadMore() {
    if (!cursor) return;
    setBusy(true); setError(null);
    const result = await api.candidates({ clientId, state: "open", limit: 50, cursor });
    if (result.ok === false) setError(result.message);
    else { setCandidates((current) => [...current, ...result.data.items]); setCursor(result.data.nextCursor); }
    setBusy(false);
  }

  async function createDraft() {
    const candidateIds = visibleOptions.filter((option) => selected.includes(option.key)).flatMap((option) => option.candidateIds);
    if (!candidateIds.length) return { ok: false as const, status: 422, kind: "invalid" as const, message: "Select at least one billable candidate." };
    setBusy(true); setError(null);
    const result: ApiResult<{ invoice: { id: string } }> = await api.createInvoiceFromCandidates({ candidateIds, ...(memo.trim() ? { memo: memo.trim() } : {}) });
    if (result.ok === false) {
      setError(result.message);
      if (result.kind === "conflict") {
        const latest = await api.candidates({ clientId, state: "open", limit: 50 });
        if (latest.ok) { setCandidates(latest.data.items); setCursor(latest.data.nextCursor); setSelected([]); }
      }
    } else { setSelected([]); setMemo(""); await onCreated(result.data.invoice.id); }
    setBusy(false);
    return result;
  }

  const selectedCount = visibleOptions.filter((option) => selected.includes(option.key)).length;
  return (
    <section className="card" aria-label="Billable candidates" data-candidate-workbench>
      <h3>Billable candidates <span>{loading ? "…" : candidates.length}</span></h3>
      <p style={hintStyle}>Only open, priced work is selectable. The server copies its saved price into a draft; this screen does not calculate invoice amounts.</p>
      {loading ? <p style={hintStyle}>Loading candidates…</p> : null}
      {error ? <p role="alert" style={{ color: "var(--red)" }}>{error}</p> : null}
      {!loading && !error && visibleOptions.length === 0 ? <p style={hintStyle}>No open, priced candidates for this client.</p> : null}
      {visibleOptions.length > 0 ? (
        <div className="panel scroll">
          <table>
            <thead><tr><th>Select</th><th>Candidate / package</th><th>Date</th><th>Source / components</th><th className="r">Saved price</th></tr></thead>
            <tbody>{visibleOptions.map((option) => (
              <tr key={option.key} data-candidate-option={option.key}>
                <td><input type="checkbox" aria-label={`Select ${option.label}`} disabled={!option.selectable || busy} checked={selected.includes(option.key)} onChange={() => toggle(option)} /></td>
                <td>{option.label}{option.note ? <div style={hintStyle}>{option.note}</div> : null}</td>
                <td>{option.date}</td>
                <td>{option.description}</td>
                <td className="r num">{formatMoney(option.amount)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : null}
      {cursor ? <button type="button" className="bc-btn" disabled={busy} onClick={() => void loadMore()}>{busy ? "Loading…" : "Load more candidates"}</button> : null}
      {selectedCount > 0 ? (
        <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap", marginTop: 14 }}>
          <label style={{ display: "grid", gap: 5, minWidth: 240, flex: "1 1 240px" }}>Draft memo
            <input value={memo} onChange={(event) => setMemo(event.target.value)} maxLength={2000} />
          </label>
          <ActionButton label={busy ? "Creating…" : `Create draft from ${selectedCount} selection${selectedCount === 1 ? "" : "s"}`} disabled={busy} onAction={createDraft} />
        </div>
      ) : null}
      {bundles === null ? <p style={hintStyle}>Bundle details could not be loaded. Bundle-priced candidates remain unavailable until package membership can be verified.</p> : null}
    </section>
  );
}
