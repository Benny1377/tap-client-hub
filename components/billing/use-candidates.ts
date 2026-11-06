"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BillingApi } from "@/lib/billing-ui/api";
import type { BillingBundle, Candidate, CandidateState } from "@/lib/billing-ui/types";
import type { SectionState } from "@/lib/billing-ui/view-model";

export interface CandidatePage {
  items: Candidate[];
  nextCursor: string | null;
  /** Null when packages could not be read, so they cannot be grouped safely. */
  bundles: BillingBundle[] | null;
}

/** Loads one client's candidates for a state, with that client's packages. `version` forces a refetch after a change. */
export function useCandidates(api: BillingApi, clientId: string | null, state: CandidateState, enabled: boolean, version: number) {
  const [section, setSection] = useState<SectionState<CandidatePage>>({ status: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    if (!enabled || !clientId) return;
    const id = ++requestId.current;
    let current = true;
    Promise.all([api.candidates({ clientId, state }), api.clientPricing(clientId)]).then(([list, pricing]) => {
      if (!current || id !== requestId.current) return;
      if (list.ok === false) { setSection({ status: "error", kind: list.kind, message: list.message, code: list.code }); return; }
      setSection({ status: "ready", data: { items: list.data.items || [], nextCursor: list.data.nextCursor ?? null, bundles: pricing.ok ? pricing.data.bundles || [] : null } });
    });
    return () => { current = false; };
  }, [api, clientId, state, enabled, version]);

  const loadMore = useCallback(async () => {
    if (section.status !== "ready" || !section.data.nextCursor || !clientId) return;
    const id = requestId.current;
    setLoadingMore(true);
    const next = await api.candidates({ clientId, state, cursor: section.data.nextCursor });
    setLoadingMore(false);
    if (id !== requestId.current) return;
    if (next.ok === false) { setSection({ status: "error", kind: next.kind, message: next.message, code: next.code }); return; }
    setSection({ status: "ready", data: { ...section.data, items: [...section.data.items, ...(next.data.items || [])], nextCursor: next.data.nextCursor ?? null } });
  }, [api, clientId, section, state]);

  return { section, loadMore, loadingMore };
}
