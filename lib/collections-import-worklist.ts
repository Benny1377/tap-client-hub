import type { createAdminClient } from "@/lib/supabase/admin";
import type { CollectionsAccount, CollectionsInvoice, CollectionsReceivablesResponse } from "@/lib/collections-api";

type QueryClient = ReturnType<typeof createAdminClient>;
type ImportedRow = {
  id: string; batch_id: string; source_invoice_id: string; invoice_number: string | null; open_balance: string;
  transaction_date: string | null; due_date: string | null; source_as_of: string; reported_aging: number | null;
  review_status: string; discrepancy_status: "none" | "blocked" | "resolved"; source_row_key: string;
};
type ImportIdentity = { source_invoice_id: string; client_id: string | null; linked_invoice_id: string | null; canonical_collection_identity: string | null; selected_source: "billing" | "pdf_import" };

const zeroAging = () => ({ current: "0.00", days_1_30: "0.00", days_31_60: "0.00", days_61_90: "0.00", days_over_90: "0.00" });
const zeroAccount = (clientId: string, name: string): CollectionsAccount => ({
  client_id: clientId, client_name: name, contact_name: null, contact_email: null, contact_phone: null,
  primary_contact_count: 0, gross_open_balance: "0.00", unallocated_credit: "0.00", net_ar_estimate: "0.00",
  open_invoice_count: 0, oldest_days_past_due: 0, aging: zeroAging(), call_priority_score: "0.00",
  priority_score_components: {
    "21_30": { balance: "0.00", weight: "1.0", weighted_amount: "0.00" },
    "31_60": { balance: "0.00", weight: "1.3", weighted_amount: "0.00" },
    "61_90": { balance: "0.00", weight: "1.6", weighted_amount: "0.00" },
    "91_180": { balance: "0.00", weight: "2.0", weighted_amount: "0.00" },
    over_180: { balance: "0.00", weight: "2.4", weighted_amount: "0.00" }, score_zero_before_days_past_due: 21,
  },
  on_hold: false, credit_review_required: false, contact_review_required: false, largest_high_balance_invoice: "0.00", invoices: [],
});

function cents(value: number) { return (Number.isFinite(value) ? value : 0).toFixed(2); }
/** Add the latest approved PDF snapshots, replacing linked Billing rows rather than duplicating them. */
export async function mergeApprovedPdfReceivables(db: QueryClient, result: CollectionsReceivablesResponse) {
  const [{ data: batches }, { data: rules }, { data: settings }] = await Promise.all([
    db.from("collection_import_batches").select("id,source_as_of,created_at").eq("status", "approved").order("created_at", { ascending: false }).limit(500),
    db.from("collection_ladder_rules").select("stage,days_past_due,enabled").eq("enabled", true).order("stage"),
    db.from("collection_settings").select("timezone,minimum_balance,direct_escalation_threshold").eq("id", "default").maybeSingle(),
  ]);
  if (!batches || !rules || !settings) throw new Error("COLLECTIONS_IMPORT_READ_MODEL_FAILED");
  if (!batches?.length) return result;
  const batchMap = new Map(batches.map((batch) => [batch.id, batch]));
  const { data: imported } = await db.from("collection_import_invoices")
    .select("id,batch_id,source_invoice_id,invoice_number,open_balance,transaction_date,due_date,source_as_of,reported_aging,review_status,discrepancy_status,source_row_key")
    .in("batch_id", batches.map((batch) => batch.id)).in("review_status", ["approved", "blocked"])
    .order("updated_at", { ascending: false });
  if (!imported) throw new Error("COLLECTIONS_IMPORT_READ_MODEL_FAILED");
  if (!imported.length) return result;
  const latest = new Map<string, ImportedRow>();
  for (const row of imported as ImportedRow[]) if (!latest.has(row.source_invoice_id)) latest.set(row.source_invoice_id, row);
  const { data: identities } = await db.from("collection_source_invoice_identities")
    .select("source_invoice_id,client_id,linked_invoice_id,canonical_collection_identity,selected_source")
    .in("source_invoice_id", Array.from(latest.keys()));
  const identityById = new Map(((identities || []) as ImportIdentity[]).map((item) => [item.source_invoice_id, item]));
  const usable = Array.from(latest.values()).flatMap((row) => {
    const identity = identityById.get(row.source_invoice_id);
    const batch = batchMap.get(row.batch_id);
    return identity?.client_id && identity.canonical_collection_identity && batch ? [{ row, identity, batch }] : [];
  });
  if (!usable.length) return result;

  const clientIds = Array.from(new Set(usable.map(({ identity }) => identity.client_id!)));
  const { data: clients } = await db.from("clients").select("id,name,status").in("id", clientIds);
  const missingAccountClients = clientIds.filter((id) => !(result.accounts || []).some((account) => account.client_id === id));
  const { data: contacts } = missingAccountClients.length
    ? await db.from("contacts").select("client_id,name,email,phone,is_primary,category").in("client_id", missingAccountClients).eq("category", "client")
    : { data: [] as Array<{ client_id: string; name: string; email: string | null; phone: string | null; is_primary: boolean }> };
  const clientById = new Map((clients || []).map((client) => [client.id, client]));
  const accounts = (result.accounts || []) as CollectionsAccount[];
  for (const clientId of missingAccountClients) {
    const client = clientById.get(clientId);
    if (!client || client.status !== "active") continue;
    const account = zeroAccount(client.id, client.name);
    const primary = (contacts || []).filter((contact) => contact.client_id === clientId && contact.is_primary);
    account.primary_contact_count = primary.length;
    account.contact_name = primary.length === 1 ? primary[0].name : null;
    account.contact_email = primary.length === 1 ? primary[0].email : null;
    account.contact_phone = primary.length === 1 ? primary[0].phone : null;
    account.contact_review_required = primary.length !== 1 || !account.contact_email;
    accounts.push(account);
  }

  const targetIdentities = usable.map(({ identity }) => identity.canonical_collection_identity!);
  const [{ data: events }, { data: attempts }, { data: holds }] = await Promise.all([
    db.from("collection_events").select("id,canonical_collection_identity,event_type,stage,occurred_at,detail,approves_event_id").in("canonical_collection_identity", targetIdentities).order("occurred_at", { ascending: false }),
    db.from("collection_delivery_attempts").select("canonical_collection_identity,stage,status,updated_at,created_at").in("canonical_collection_identity", targetIdentities).order("updated_at", { ascending: false }),
    db.from("collection_holds").select("client_id,canonical_collection_identity,released_at,expires_on").in("client_id", clientIds).is("released_at", null),
  ]);
  if (!events || !attempts || !holds) throw new Error("COLLECTIONS_IMPORT_READ_MODEL_FAILED");
  const completedByIdentity = new Map<string, number>();
  for (const event of events || []) {
    if (event.stage && ["reminder_logged", "escalation_requested", "escalated", "formal_notice_requested", "formal_notice_approved", "formal_notice_sent"].includes(event.event_type)) {
      completedByIdentity.set(event.canonical_collection_identity, Math.max(completedByIdentity.get(event.canonical_collection_identity) || 0, event.stage));
    }
  }
  const lastByIdentity = new Map<string, NonNullable<CollectionsInvoice["last_delivery"]>>();
  for (const attempt of attempts || []) {
    if (!lastByIdentity.has(attempt.canonical_collection_identity)) {
      lastByIdentity.set(attempt.canonical_collection_identity, { stage: attempt.stage, status: attempt.status, occurred_at: attempt.updated_at || attempt.created_at });
    }
    if (attempt.status === "accepted") completedByIdentity.set(attempt.canonical_collection_identity, Math.max(completedByIdentity.get(attempt.canonical_collection_identity) || 0, attempt.stage));
  }
  const awaitingByIdentity = new Map<string, NonNullable<CollectionsInvoice["awaiting_approval"]>>();
  const approvedRequestIds = new Set((events || []).filter((event) => event.approves_event_id).map((event) => event.approves_event_id));
  for (const event of events || []) {
    if ((event.event_type === "escalation_requested" || event.event_type === "formal_notice_requested") && !approvedRequestIds.has(event.id)) {
      const stage = event.event_type === "escalation_requested" ? 4 : 5;
      if (!awaitingByIdentity.has(event.canonical_collection_identity)) awaitingByIdentity.set(event.canonical_collection_identity, {
        event_id: event.id, event_type: event.event_type, stage, requested_at: event.occurred_at,
      });
    }
  }
  const activeHolds = (holds || []).filter((hold) => !hold.expires_on || hold.expires_on >= result.as_of_date);
  const held = new Set(activeHolds.flatMap((hold) => hold.canonical_collection_identity ? [hold.canonical_collection_identity] : []));
  const heldClients = new Set(activeHolds.filter((hold) => !hold.canonical_collection_identity).map((hold) => hold.client_id));
  const thresholds = (rules || []) as Array<{ stage: number; days_past_due: number; enabled: boolean }>;
  const minBalance = Number(settings.minimum_balance ?? 50);
  const directThreshold = Number(settings.direct_escalation_threshold ?? 5000);
  const pdfLinkedIds = new Set(usable.flatMap(({ identity }) => identity.selected_source === "pdf_import" && identity.linked_invoice_id ? [identity.linked_invoice_id] : []));
  for (const account of accounts) account.invoices = account.invoices.filter((invoice) => !(invoice.invoice_id && pdfLinkedIds.has(invoice.invoice_id)));

  for (const { row, identity } of usable) {
    const account = accounts.find((item) => item.client_id === identity.client_id);
    if (!account || identity.selected_source !== "pdf_import") {
      if (account && identity.selected_source === "billing" && identity.linked_invoice_id) {
        const linked = account.invoices.find((invoice) => invoice.invoice_id === identity.linked_invoice_id);
        if (linked) {
          linked.source_invoice_id = row.source_invoice_id;
          linked.source = "billing";
          linked.row_key = `collection:${identity.canonical_collection_identity}`;
          linked.canonical_collection_identity = identity.canonical_collection_identity!;
          linked.source_batch_id = row.batch_id;
          linked.source_as_of = row.source_as_of;
          linked.discrepancy_status = row.discrepancy_status;
          linked.last_delivery = lastByIdentity.get(identity.canonical_collection_identity!) || linked.last_delivery || null;
        }
      }
      continue;
    }
    const daysPastDue = row.due_date ? Math.max(0, Math.floor((Date.parse(`${result.as_of_date}T00:00:00Z`) - Date.parse(`${row.due_date}T00:00:00Z`)) / 86400000)) : Number(row.reported_aging || 0);
    const balance = Number(row.open_balance);
    const completed = completedByIdentity.get(identity.canonical_collection_identity!) || 0;
    const next = thresholds.find((rule) => rule.stage > completed && rule.days_past_due <= daysPastDue)?.stage ?? null;
    const invoice: CollectionsInvoice = {
      invoice_id: identity.linked_invoice_id, source_invoice_id: row.source_invoice_id, source: "pdf_import",
      row_key: `collection:${identity.canonical_collection_identity}`, canonical_collection_identity: identity.canonical_collection_identity!,
      source_batch_id: row.batch_id, source_as_of: row.source_as_of, discrepancy_status: row.discrepancy_status,
      invoice_number: row.invoice_number || row.source_row_key, issue_date: row.transaction_date || row.source_as_of,
      due_date: row.due_date || row.source_as_of, invoice_total: cents(balance), allocated: "0.00", balance: cents(balance),
      days_past_due: daysPastDue, current_stage: thresholds.filter((rule) => rule.days_past_due <= daysPastDue).at(-1)?.stage || 0,
      completed_stage: completed, upcoming_stage: next, next_stage: next, awaiting_approval: awaitingByIdentity.get(identity.canonical_collection_identity!) || null,
      on_hold: held.has(identity.canonical_collection_identity!) || heldClients.has(identity.client_id!), credit_review_required: false,
      contact_review_required: account.contact_review_required, below_minimum: balance < minBalance,
      last_delivery: lastByIdentity.get(identity.canonical_collection_identity!) || null,
    };
    account.invoices.push(invoice);
  }

  const asNum = (value: string | number | null | undefined) => Number(value || 0);
  for (const account of accounts) {
    account.invoices.sort((a, b) => a.due_date.localeCompare(b.due_date) || a.invoice_number.localeCompare(b.invoice_number));
    let current = 0, one30 = 0, thirty60 = 0, sixty90 = 0, over90 = 0, gross = 0, oldest = 0, score = 0, largest = 0;
    for (const invoice of account.invoices) {
      const amount = asNum(invoice.balance); gross += amount; oldest = Math.max(oldest, invoice.days_past_due);
      if (invoice.days_past_due === 0) current += amount;
      else if (invoice.days_past_due <= 30) one30 += amount;
      else if (invoice.days_past_due <= 60) thirty60 += amount;
      else if (invoice.days_past_due <= 90) sixty90 += amount;
      else over90 += amount;
      const weight = invoice.days_past_due > 180 ? 2.4 : invoice.days_past_due > 90 ? 2 : invoice.days_past_due > 60 ? 1.6 : invoice.days_past_due > 30 ? 1.3 : invoice.days_past_due > 20 ? 1 : 0;
      score += amount * weight;
      if (amount >= directThreshold) largest = Math.max(largest, amount);
      account.on_hold ||= invoice.on_hold;
      account.credit_review_required ||= invoice.credit_review_required;
      account.contact_review_required ||= invoice.contact_review_required;
    }
    account.gross_open_balance = cents(gross); account.net_ar_estimate = cents(gross - Number(account.unallocated_credit || 0));
    account.open_invoice_count = account.invoices.length; account.oldest_days_past_due = oldest;
    account.aging = { current: cents(current), days_1_30: cents(one30), days_31_60: cents(thirty60), days_61_90: cents(sixty90), days_over_90: cents(over90) };
    account.call_priority_score = cents(score); account.largest_high_balance_invoice = cents(largest);
  }
  result.accounts = accounts.filter((account) => account.invoices.length > 0 || Number(account.unallocated_credit) > 0);
  result.summary.gross_open_balance = cents(accounts.reduce((sum, account) => sum + Number(account.gross_open_balance), 0));
  result.summary.net_ar_estimate = cents(Number(result.summary.gross_open_balance) - Number(result.summary.unallocated_credit));
  result.summary.aging = {
    current: cents(accounts.reduce((sum, account) => sum + Number(account.aging.current), 0)),
    days_1_30: cents(accounts.reduce((sum, account) => sum + Number(account.aging.days_1_30), 0)),
    days_31_60: cents(accounts.reduce((sum, account) => sum + Number(account.aging.days_31_60), 0)),
    days_61_90: cents(accounts.reduce((sum, account) => sum + Number(account.aging.days_61_90), 0)),
    days_over_90: cents(accounts.reduce((sum, account) => sum + Number(account.aging.days_over_90), 0)),
  };
  result.summary.open_invoice_count = accounts.reduce((sum, account) => sum + account.invoices.length, 0);
  result.summary.owing_accounts = accounts.filter((account) => account.open_invoice_count > 0).length;
  result.summary.credit_review_accounts = accounts.filter((account) => Number(account.unallocated_credit) > 0).length;
  result.summary.chronic_accounts = accounts.filter((account) => account.open_invoice_count >= 3).length;
  result.summary.oldest_days_past_due = Math.max(0, ...accounts.map((account) => account.oldest_days_past_due));
  result.pagination.total_accounts = result.accounts.length;
  return result;
}
