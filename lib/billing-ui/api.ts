// Browser client for the Billing and Collections routes (Phase 1 ledger and the
// Phase 2 worklist and preview). Every read and write goes through the server
// routes, which own authorization and invariants; this module never talks to
// Supabase directly.
import type { CollectionsAutomationPreviewResponse, CollectionsReceivablesResponse } from "@/lib/collections-api";
import type {
  ClientOption,
  CollectionEvent,
  CollectionHold,
  Invoice,
  InvoiceLine,
  Payment,
  PaymentAllocation,
  ReceivablesResponse,
  Viewer,
} from "./types";

export type ApiErrorKind = "unauthorized" | "forbidden" | "not_found" | "conflict" | "invalid" | "server" | "network";

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; kind: ApiErrorKind; message: string; code?: string };

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function kindForStatus(status: number): ApiErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 400 || status === 422) return "invalid";
  return "server";
}

async function request<T>(fetchImpl: FetchLike, url: string, init?: RequestInit): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      ...init,
      cache: "no-store",
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    });
  } catch {
    return { ok: false, status: 0, kind: "network", message: "Could not reach TAP Hub. Check your connection and try again." };
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const payload = body && typeof body === "object" ? (body as { error?: unknown; code?: unknown }) : {};
    const failure: ApiResult<T> = {
      ok: false,
      status: response.status,
      kind: kindForStatus(response.status),
      message: payload.error ? String(payload.error) : `Request failed (${response.status})`,
    };
    // Stable machine-readable code from the server, when it sends one.
    if (typeof payload.code === "string") failure.code = payload.code;
    return failure;
  }
  return { ok: true, status: response.status, data: body as T };
}

function post<T>(fetchImpl: FetchLike, url: string, body: unknown) {
  return request<T>(fetchImpl, url, { method: "POST", body: JSON.stringify(body) });
}

function patch<T>(fetchImpl: FetchLike, url: string, body: unknown) {
  return request<T>(fetchImpl, url, { method: "PATCH", body: JSON.stringify(body) });
}

function withClient(path: string, clientId?: string | null) {
  return clientId ? `${path}?client_id=${encodeURIComponent(clientId)}` : path;
}

export function createBillingApi(fetchImpl: FetchLike) {
  return {
    async viewer(): Promise<ApiResult<Viewer>> {
      const result = await request<{ role?: string; modules?: string[] }>(fetchImpl, "/api/me");
      if (result.ok === false) return result;
      return { ok: true, status: result.status, data: { role: result.data.role || "staff", modules: result.data.modules || [] } };
    },
    async clients(): Promise<ApiResult<ClientOption[]>> {
      const result = await request<{ clients?: Array<{ id?: unknown; name?: unknown }> }>(fetchImpl, "/api/clients?fields=lite");
      if (result.ok === false) return result;
      const options = (result.data.clients || [])
        .filter((client) => client.id)
        .map((client) => ({ id: String(client.id), name: String(client.name || client.id) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return { ok: true, status: result.status, data: options };
    },

    invoices: (clientId?: string | null) => request<{ invoices: Invoice[] }>(fetchImpl, withClient("/api/billing/invoices", clientId)),
    receivables: (clientId?: string | null) => request<ReceivablesResponse>(fetchImpl, withClient("/api/billing/receivables", clientId)),
    payments: (clientId?: string | null) => request<{ payments: Payment[] }>(fetchImpl, withClient("/api/billing/payments", clientId)),
    holds: (clientId?: string | null) => request<{ holds: CollectionHold[] }>(fetchImpl, withClient("/api/collections/holds", clientId)),
    events: (clientId?: string | null) => request<{ events: CollectionEvent[] }>(fetchImpl, withClient("/api/collections/events", clientId)),

    /** Phase 2 worklist: AR summary, priority call list, and invoice stages from the shared Billing read model. */
    worklist: (params: { clientId?: string | null; limit?: number; offset?: number } = {}) => {
      const query = new URLSearchParams();
      if (params.clientId) query.set("client_id", params.clientId);
      if (params.limit !== undefined) query.set("limit", String(params.limit));
      if (params.offset !== undefined) query.set("offset", String(params.offset));
      const suffix = query.toString();
      return request<CollectionsReceivablesResponse>(fetchImpl, `/api/collections/receivables${suffix ? `?${suffix}` : ""}`);
    },
    /** Owner/Admin automation preview. Side-effect free: the server performs no delivery. */
    preview: (params: { asOfDate?: string | null; limit?: number; offset?: number } = {}) =>
      post<CollectionsAutomationPreviewResponse>(fetchImpl, "/api/collections/automation/preview", {
        ...(params.asOfDate ? { as_of_date: params.asOfDate } : {}),
        ...(params.limit !== undefined ? { limit: params.limit } : {}),
        ...(params.offset !== undefined ? { offset: params.offset } : {}),
      }),

    createInvoice: (input: { client_id: string; invoice_number: string; issue_date: string; due_date: string; memo?: string | null }) =>
      post<{ invoice: Invoice }>(fetchImpl, "/api/billing/invoices", input),
    updateInvoice: (id: string, input: Partial<Pick<Invoice, "invoice_number" | "issue_date" | "due_date" | "memo">>) =>
      patch<{ invoice: Invoice }>(fetchImpl, `/api/billing/invoices/${encodeURIComponent(id)}`, input),
    deleteDraftInvoice: (id: string) =>
      request<{ deleted: boolean }>(fetchImpl, `/api/billing/invoices/${encodeURIComponent(id)}`, { method: "DELETE" }),
    issueInvoice: (id: string) => post<{ invoice: Invoice }>(fetchImpl, `/api/billing/invoices/${encodeURIComponent(id)}`, { action: "issue" }),
    voidInvoice: (id: string, reason: string) =>
      post<{ invoice: Invoice }>(fetchImpl, `/api/billing/invoices/${encodeURIComponent(id)}`, { action: "void", reason }),

    addLine: (input: { invoice_id: string; description: string; quantity: string; unit_amount: string; period?: string | null }) =>
      post<{ line: InvoiceLine }>(fetchImpl, "/api/billing/invoice-lines", input),
    updateLine: (id: string, input: Partial<{ description: string; quantity: string; unit_amount: string; period: string | null }>) =>
      patch<{ line: InvoiceLine }>(fetchImpl, "/api/billing/invoice-lines", { id, ...input }),
    deleteLine: (id: string) =>
      request<{ deleted: boolean }>(fetchImpl, `/api/billing/invoice-lines?id=${encodeURIComponent(id)}`, { method: "DELETE" }),

    recordPayment: (input: { client_id: string; received_on: string; amount: string; method: string; reference?: string | null }) =>
      post<{ payment: Payment }>(fetchImpl, "/api/billing/payments", input),
    reversePayment: (id: string, reason: string) =>
      post<{ payment: Payment }>(fetchImpl, `/api/billing/payments/${encodeURIComponent(id)}`, { reason }),
    allocate: (input: { payment_id: string; invoice_id: string; amount: string }) =>
      post<{ allocation_id: string }>(fetchImpl, "/api/billing/allocations", input),
    reverseAllocation: (id: string) =>
      post<{ allocation: PaymentAllocation }>(fetchImpl, `/api/billing/allocations/${encodeURIComponent(id)}`, {}),

    logEvent: (input: { client_id: string; event_type: string; invoice_id?: string | null; stage?: number | null; detail?: Record<string, unknown>; approval_event_id?: string | null }) =>
      post<{ event: CollectionEvent }>(fetchImpl, "/api/collections/events", input),
    approveEvent: (eventId: string, eventType: "escalated" | "formal_notice_approved", detail?: Record<string, unknown>) =>
      post<{ event: CollectionEvent }>(fetchImpl, "/api/collections/events/approve", { event_id: eventId, event_type: eventType, detail }),
    placeHold: (input: { client_id: string; reason: string; invoice_id?: string | null; expires_on?: string | null }) =>
      post<{ hold: CollectionHold }>(fetchImpl, "/api/collections/holds", input),
    releaseHold: (id: string) => patch<{ hold: CollectionHold }>(fetchImpl, "/api/collections/holds", { id }),
  };
}

export type BillingApi = ReturnType<typeof createBillingApi>;

/**
 * Run a mutation, then reload from the API so balances and lifecycle state are
 * always the server's. A 409 also reloads, because it usually means the record
 * changed underneath the user. Failures that did not change anything do not.
 */
export async function mutateThenRefresh<T>(mutation: () => Promise<ApiResult<T>>, refresh: () => Promise<unknown>): Promise<ApiResult<T>> {
  const result = await mutation();
  if (result.ok === true || (result.ok === false && result.kind === "conflict")) await refresh();
  return result;
}
