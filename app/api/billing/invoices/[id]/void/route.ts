import { NextRequest, NextResponse } from "next/server";
import { requireBillingAction } from "@/lib/billing-access";
import { apiError, REFRESH_LEDGER } from "@/lib/billing-phase2";
import { phase2InvoiceRpc } from "@/lib/billing-phase2-rpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireBillingAction("invoices.void");
  if (access.response || !access.identity) return access.response;
  const { id } = await params;
  let body: unknown;
  try { body = await request.json(); } catch { return apiError("Invalid JSON body", "INVALID_JSON", 400); }
  const payload = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
  if (!reason) return apiError("A non-empty void reason is required", "VOID_REASON_REQUIRED", 422);
  const result = await phase2InvoiceRpc("void", id, access.identity.id, reason);
  if (result.response) return result.response;
  const db = (await import("@/lib/supabase/admin")).createAdminClient();
  const { data } = await db.from("billing_candidate_line_links").select("candidate_id,invoice_lines!inner(invoice_id)").eq("invoice_lines.invoice_id", id);
  return NextResponse.json({ invoice: result.invoice, returnedCandidateIds: (data || []).map((row) => row.candidate_id), refresh: REFRESH_LEDGER });
}
