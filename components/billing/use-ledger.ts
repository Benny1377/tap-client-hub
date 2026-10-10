"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createBillingApi, mutateThenRefresh, type ApiResult } from "@/lib/billing-ui/api";
import { loadLedger, loadingLedger, type LedgerOptions, type LedgerSection, type LedgerState } from "@/lib/billing-ui/ledger";
import type { ClientOption, Viewer } from "@/lib/billing-ui/types";

/**
 * Loads ledger sections for a client. Pass includeMeta: false for a second loader
 * on the same page, so the viewer and client list are fetched only once.
 */
export function useLedger(clientId: string | null, sections: LedgerSection[], options: LedgerOptions & { includeMeta?: boolean } = {}) {
  const api = useMemo(() => createBillingApi((input, init) => fetch(input, init)), []);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const sectionKey = sections.join(",");
  const { worklistLimit, worklistOffset, includeMeta = true } = options;
  const key = `${clientId ?? ""}|${sectionKey}|${worklistLimit ?? ""}|${worklistOffset ?? ""}`;
  // Data is tagged with the client/sections/page it was loaded for, so switching
  // shows "loading" instead of the previous selection's data.
  const [loaded, setLoaded] = useState<{ key: string; ledger: LedgerState } | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    if (!includeMeta) return;
    let cancelled = false;
    api.viewer().then((result) => { if (!cancelled && result.ok === true) setViewer(result.data); });
    api.clients().then((result) => { if (!cancelled && result.ok === true) setClients(result.data); });
    return () => { cancelled = true; };
  }, [api, includeMeta]);

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    const ledger = await loadLedger(api, clientId, sectionKey.split(",") as LedgerSection[], { worklistLimit, worklistOffset });
    // Ignore responses for a selection the user has already moved away from.
    if (id === requestId.current) setLoaded({ key, ledger });
  }, [api, clientId, sectionKey, worklistLimit, worklistOffset, key]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const mutate = useCallback(<T,>(mutation: () => Promise<ApiResult<T>>) => mutateThenRefresh(mutation, refresh), [refresh]);
  const state = loaded && loaded.key === key ? loaded.ledger : loadingLedger();

  return { api, viewer, clients, state, refresh, mutate };
}
