import { NextRequest, NextResponse } from "next/server";
import { requireBillingAction } from "@/lib/billing-access";
import { apiError, REFRESH_LEDGER, toPhase2Invoice } from "@/lib/billing-phase2";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  const access = await requireBillingAction("invoices.draft.manage");
  if (access.response || !access.identity) return access.response;
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid JSON body");
    body = parsed as Record<string, unknown>;
  } catch { return apiError("Invalid JSON body", "INVALID_JSON", 400); }
  if (!Array.isArray(body.candidateIds) || body.candidateIds.length < 1 || body.candidateIds.length > 500 || body.candidateIds.some((id: unknown) => typeof id !== "string")) return apiError("candidateIds must contain 1 to 500 identifiers", "INVALID_INPUT", 422);
  const db = createAdminClient();
  const { data: id, error } = await db.rpc("create_draft_from_candidates", { p_candidate_ids: body.candidateIds, p_memo: typeof body.memo === "string" ? body.memo.trim() || null : null, p_actor: access.identity.id });
  if (error) {
    const message = error.message || "Unable to create draft";
    const unpriced = /candidate_unpriced/i.test(message);
    const status = /not_found/i.test(message) ? 404 : /candidate_(not_open|unpriced)/i.test(message) ? 409 : 500;
    return apiError(message.replace(/^[a-z_]+: /i, ""), unpriced ? "CANDIDATE_UNPRICED" : status === 409 ? "CANDIDATE_NOT_OPEN" : status === 404 ? "NOT_FOUND" : "DRAFT_CREATE_FAILED", status);
  }
  const { data, error: readError } = await db.from("invoices").select("*,invoice_lines(*,billing_candidate_line_links(candidate_id,active))").eq("id", id).single();
  if (readError) return apiError("Draft was created but could not be loaded", "INVOICE_READ_FAILED", 500);
  return NextResponse.json({ invoice: toPhase2Invoice(data), refresh: REFRESH_LEDGER }, { status: 201 });
}
