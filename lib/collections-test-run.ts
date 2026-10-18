import { createAdminClient } from "@/lib/supabase/admin";
import { getDeliveryStatus, isSyntheticOnlyEnabled, isWithinSendWindow } from "@/lib/collections-delivery";
import { resendPayloadFingerprint, sendResendEmail } from "@/lib/collections-provider";
import { renderCollectionsTemplate } from "@/lib/collections-template";

type RunCounts = { run_id: string; claimed: number; accepted: number; suppressed: number; needs_review: number; failed: number; remaining: number };
type WorklistInvoice = {
  invoice_id: string; invoice_number: string; balance: string; days_past_due: number; due_date: string;
  next_stage: number | null; completed_stage?: number; awaiting_approval?: unknown; on_hold: boolean;
  credit_review_required: boolean; contact_review_required: boolean; below_minimum: boolean;
};
type WorklistAccount = { client_id: string; invoices: WorklistInvoice[] };
type Candidate = { account: WorklistAccount; invoice: WorklistInvoice; stage: number };
type WorklistPage = { accounts?: WorklistAccount[]; pagination?: { total_accounts?: number } };

function stripTags(value: string) { return value.replace(/<[^>]*>/g, ""); }

/**
 * Whether an approved A/R report linked to this Billing invoice disagrees with Billing
 * and is still unresolved (Phase 4). The Billing-only worklist this runner reads does not
 * carry that state, so it is checked here; the preview reports the same case as
 * source_discrepancy_blocked. Uses the latest approved or blocked snapshot per identity,
 * like the worklist merge. Fails closed: a read error counts as blocked.
 */
async function sourceDiscrepancyBlocked(db: ReturnType<typeof createAdminClient>, invoiceId: string) {
  const { data: identities, error: identityError } = await db.from("collection_source_invoice_identities")
    .select("source_invoice_id").eq("linked_invoice_id", invoiceId);
  if (identityError) return true;
  const sourceIds = (identities || []).map((identity) => identity.source_invoice_id);
  if (!sourceIds.length) return false;
  const { data: snapshots, error: snapshotError } = await db.from("collection_import_invoices")
    .select("source_invoice_id,discrepancy_status,updated_at").in("source_invoice_id", sourceIds)
    .in("review_status", ["approved", "blocked"]).order("updated_at", { ascending: false });
  if (snapshotError) return true;
  const latest = new Map<string, string>();
  for (const snapshot of snapshots || []) if (!latest.has(snapshot.source_invoice_id)) latest.set(snapshot.source_invoice_id, snapshot.discrepancy_status);
  return [...latest.values()].some((status) => status === "blocked");
}

function providerRequest(input: { subject: string; body: string; to: string; idempotencyKey: string }) {
  const key = process.env.COLLECTIONS_RESEND_API_KEY!;
  const from = `${process.env.COLLECTIONS_SENDER_NAME || "TAP Collections Test"} <${process.env.COLLECTIONS_SENDER_EMAIL}>`;
  return {
    apiKey: key,
    from,
    to: input.to,
    replyTo: process.env.COLLECTIONS_REPLY_TO,
    subject: input.subject,
    html: input.body,
    text: stripTags(input.body),
    idempotencyKey: input.idempotencyKey,
  };
}

export const OUTSIDE_SEND_WINDOW = "OUTSIDE_SEND_WINDOW" as const;

export async function runCollectionsTestDelivery(actor: string | null, limit = 50): Promise<RunCounts | typeof OUTSIDE_SEND_WINDOW | null> {
  const readiness = await getDeliveryStatus();
  if (!readiness?.test_ready || !isSyntheticOnlyEnabled()) return null;
  const db = createAdminClient();
  const [{ data: rules, error: rulesError }, { data: settings, error: settingsError }] = await Promise.all([
    db.from("collection_ladder_rules").select("stage,automatic,enabled,subject_template,body_template").order("stage"),
    db.from("collection_settings").select("minimum_balance,direct_escalation_threshold,timezone,send_start,send_end,weekdays_only").eq("id", "default").maybeSingle(),
  ]);
  if (rulesError || settingsError || !settings) return null;
  // Outside the firm's hours nothing is created; the next eligible run picks the work up.
  if (!isWithinSendWindow(settings)) return OUTSIDE_SEND_WINDOW;
  const ruleMap = new Map<number, { stage: number; automatic: boolean; enabled: boolean; subject_template: string; body_template: string }>(
    ((rules || []) as Array<{ stage: number; automatic: boolean; enabled: boolean; subject_template: string; body_template: string }>).map((rule) => [Number(rule.stage), rule]),
  );
  const worklist: WorklistAccount[] = [];
  for (let offset = 0; offset < 10000; offset += 200) {
    const { data, error } = await db.rpc("get_collections_worklist", { p_client_id: null, p_as_of_date: null, p_limit: 200, p_offset: offset, p_sort_order: "stable" });
    if (error || !data) return null;
    const page = data as WorklistPage;
    const rows = page.accounts || [];
    worklist.push(...rows);
    if (!rows.length || offset + rows.length >= Number(page.pagination?.total_accounts || 0)) break;
  }
  const invoiceRows = worklist.flatMap((account) => (account.invoices || []).map((invoice) => ({ account, invoice })));
  const allCandidates: Candidate[] = invoiceRows.map((row) => {
    const directEscalation = Number(row.invoice.balance) >= Number(settings.direct_escalation_threshold)
      && Number(row.invoice.completed_stage || 0) < 4 && !row.invoice.awaiting_approval;
    return { ...row, stage: directEscalation ? 4 : Number(row.invoice.next_stage || 0) };
  })
    .filter(({ invoice, stage }) => stage >= 1 && stage <= 4 && !invoice.on_hold
      && (stage >= 4 || (!invoice.credit_review_required && !invoice.contact_review_required && !invoice.below_minimum))
      && Number(invoice.balance) >= Number(settings.minimum_balance))
    .filter(({ stage }) => {
      const rule = ruleMap.get(stage);
      return Boolean(rule?.enabled && (stage <= 3 ? rule.automatic : !rule.automatic));
    });
  const stageFiveRule = ruleMap.get(5);
  if (stageFiveRule?.enabled && !stageFiveRule.automatic) {
    const { data: approvals } = await db.from("collection_events").select("invoice_id")
      .eq("event_type", "formal_notice_approved").not("invoice_id", "is", null).limit(500);
    const seen = new Set<string>();
    for (const approval of approvals || []) {
      if (!approval.invoice_id || seen.has(approval.invoice_id)) continue;
      seen.add(approval.invoice_id);
      const row = invoiceRows.find(({ invoice }) => invoice.invoice_id === approval.invoice_id);
      if (row && !row.invoice.on_hold && Number(row.invoice.balance) > 0) {
        allCandidates.push({ ...row, stage: 5 });
      }
    }
  }
  const candidates = allCandidates.slice(0, limit);

  const counts: RunCounts = { run_id: crypto.randomUUID(), claimed: 0, accepted: 0, suppressed: 0, needs_review: 0, failed: 0, remaining: 0 };
  for (const { account, invoice, stage } of candidates) {
    const rule = ruleMap.get(stage)!;
    const [{ data: client }, { data: sourceInvoice }, { data: existing }, { data: contactRows }] = await Promise.all([
      db.from("clients").select("id,is_synthetic").eq("id", account.client_id).maybeSingle(),
      db.from("invoices").select("id,is_synthetic").eq("id", invoice.invoice_id).maybeSingle(),
      db.from("collection_delivery_attempts").select("id,status,attempt_count,reason_code,last_error_code").eq("canonical_collection_identity", `billing:${invoice.invoice_id}`).eq("stage", stage).maybeSingle(),
      db.from("contacts").select("id,name,email,is_primary,category").eq("client_id", account.client_id).eq("category", "client").eq("is_primary", true),
    ]);
    // Attempts already handled (accepted, sending, needs review, failed) are not
    // part of this run: no new send and no count.
    if (existing && existing.status !== "suppressed" && existing.status !== "queued") continue;
    // Pre-checks run before any reopen so a skipped attempt is never left queued.
    const contacts = contactRows || [];
    const preReason = !client?.is_synthetic || !sourceInvoice?.is_synthetic ? "SYNTHETIC_DATA_REQUIRED"
      : await sourceDiscrepancyBlocked(db, invoice.invoice_id) ? "SOURCE_DISCREPANCY_BLOCKED"
      : stage <= 3 && contacts.length !== 1 ? "CONTACT_REVIEW_REQUIRED"
      : stage <= 3 && !contacts[0].email ? "EMAIL_CONTACT_MISSING"
      : null;
    if (preReason) {
      if (existing && ["queued", "suppressed"].includes(existing.status)) {
        const { error: suppressError } = await db.from("collection_delivery_attempts")
          .update({ status: "suppressed", reason_code: preReason, updated_at: new Date().toISOString() })
          .eq("id", existing.id).in("status", ["queued", "suppressed"]);
        if (suppressError) return null;
      }
      counts.suppressed++; continue;
    }
    let attemptId: string | null = null;
    if (existing) {
      if (existing.status === "suppressed") {
        const { data: reopened } = await db.from("collection_delivery_attempts").update({ status: "queued", reason_code: null, last_error_code: null, updated_at: new Date().toISOString() })
          .eq("id", existing.id).eq("status", "suppressed").select("id").maybeSingle();
        if (!reopened) continue; // Another run changed it first.
        attemptId = reopened.id;
      } else attemptId = existing.id;
    }
    const idem = `collections:billing:${invoice.invoice_id}:stage:${stage}`;
    if (!attemptId) {
      const { data: attempt, error: insertError } = await db.from("collection_delivery_attempts").insert({
        client_id: account.client_id, invoice_id: invoice.invoice_id, source: "billing", source_invoice_id: null,
        canonical_collection_identity: `billing:${invoice.invoice_id}`, stage, status: "queued", idempotency_key: idem,
        reason_code: null, actor,
      }).select("id").maybeSingle();
      if (insertError || !attempt) { counts.suppressed++; continue; }
      attemptId = attempt.id;
    }
    const { data: claimReason, error: claimError } = await db.rpc("claim_collection_test_delivery", { p_attempt_id: attemptId, p_actor: actor });
    if (claimError || claimReason) {
      const status = claimError ? "needs_review" : "suppressed";
      await db.from("collection_delivery_attempts").update({ status, reason_code: claimError ? null : String(claimReason), updated_at: new Date().toISOString() }).eq("id", attemptId);
      counts[status]++; continue;
    }
    counts.claimed++;
    const { data: messageContext, error: contextError } = await db.rpc("get_collection_test_message_context", { p_attempt_id: attemptId });
    const context = messageContext as { eligible?: boolean; reason_code?: string; invoice_number?: string; balance?: string; due_date?: string; days_past_due?: number } | null;
    if (contextError || !context?.eligible) {
      const status = contextError ? "needs_review" : "suppressed";
      await db.from("collection_delivery_attempts").update({ status, reason_code: contextError ? null : context?.reason_code || "DELIVERY_DISABLED", updated_at: new Date().toISOString() }).eq("id", attemptId);
      counts[status]++; continue;
    }
    const values = {
      contact_name: "Collections test contact",
      invoice_number: context.invoice_number!, balance: `$${Number(context.balance).toFixed(2)}`,
      due_date: context.due_date!, days_past_due: String(context.days_past_due!),
    };
    let subject: string;
    let body: string;
    try {
      subject = (stage === 4 ? "Internal Owner-escalation notice — TEST" : renderCollectionsTemplate(String(rule.subject_template), values))
        .replace(/[\r\n\x00-\x1f]/g, " ").slice(0, 180);
      const renderedText = renderCollectionsTemplate(String(rule.body_template), values, true).replace(/\n/g, "<br>");
      const stageHeader = stage === 4 ? "<strong>Internal Owner-escalation notice — TEST</strong><br>" : "";
      body = `<div>${stageHeader}<strong>TEST ONLY — synthetic data</strong><br>${renderedText}</div>`;
    } catch {
      await db.from("collection_delivery_attempts").update({ status: "suppressed", reason_code: "RULE_DISABLED", updated_at: new Date().toISOString() }).eq("id", attemptId);
      counts.suppressed++; continue;
    }
    const request = providerRequest({ subject, body, to: process.env.COLLECTIONS_TEST_RECIPIENT!, idempotencyKey: idem });
    const fingerprint = resendPayloadFingerprint(request);
    const { data: fingerprintRecorded, error: fingerprintError } = await db.rpc("record_collection_test_payload_fingerprint", {
      p_attempt_id: attemptId, p_fingerprint: fingerprint, p_actor: actor,
    });
    if (fingerprintError || fingerprintRecorded !== true) {
      await db.from("collection_delivery_attempts").update({ status: "needs_review", reason_code: "PROVIDER_PAYLOAD_CHANGED", updated_at: new Date().toISOString() }).eq("id", attemptId);
      counts.needs_review++;
      continue;
    }
    const delivery = await sendResendEmail(request);
    if (delivery.status === "accepted") {
      const { error } = await db.rpc("accept_collection_delivery", { p_attempt_id: attemptId, p_provider_message_id: delivery.messageId, p_actor: actor });
      if (error) {
        await db.from("collection_delivery_attempts").update({ status: "needs_review", reason_code: "PROVIDER_OUTCOME_UNKNOWN", updated_at: new Date().toISOString() }).eq("id", attemptId);
        counts.needs_review++;
      } else counts.accepted++;
    } else {
      await db.from("collection_delivery_attempts").update({ status: delivery.status, reason_code: delivery.reason, last_error_code: delivery.reason, updated_at: new Date().toISOString() }).eq("id", attemptId);
      counts[delivery.status]++;
    }
  }
  counts.remaining = Math.max(0, allCandidates.length - candidates.length);
  return counts;
}
