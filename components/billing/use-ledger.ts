"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createBillingApi, mutateThenRefresh, type ApiResult } from "@/lib/billing-ui/api";
import { loadLedger, loadingLedger, type LedgerSection, type LedgerState } from "@/lib/billing-ui/ledger";
import type { ClientOption, Viewer } from "@/lib/billing-ui/types";

export function useLedger(clientId: string | null, sections: LedgerSection[]) {
  const api = useMemo(() => createBillingApi((input, init) => fetch(input, init)), []);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const sectionKey = sections.join(",");
  const key = `${clientId ?? ""}|${sectionKey}`;
  // Data is tagged with the client/sections it was loaded for, so switching
  // clients shows "loading" instead of the previous client's ledger.
  const [loaded, setLoaded] = useState<{ key: string; ledger: LedgerState } | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    let cancelled = false;
    api.viewer().then((result) => { if (!cancelled && result.ok === true) setViewer(result.data); });
    api.clients().then((result) => { if (!cancelled && result.ok === true) setClients(result.data); });
    return () => { cancelled = true; };
  }, [api]);

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    const ledger = await loadLedger(api, clientId, sectionKey.split(",") as LedgerSection[]);
    // Ignore responses for a client the user has already switched away from.
    if (id === requestId.current) setLoaded({ key, ledger });
  }, [api, clientId, sectionKey, key]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const mutate = useCallback(<T,>(mutation: () => Promise<ApiResult<T>>) => mutateThenRefresh(mutation, refresh), [refresh]);
  const state = loaded && loaded.key === key ? loaded.ledger : loadingLedger();

  return { api, viewer, clients, state, refresh, mutate };
}
