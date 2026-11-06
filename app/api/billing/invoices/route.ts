import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireBillingAction, requireLedgerReadAccess } from "@/lib/billing-access";
import { apiError, toPhase2Invoice } from "@/lib/billing-phase2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const access = await requireLedgerReadAccess();
  if (access.response) return access.response;
  const clientId = request.nextUrl.searchParams.get("client_id");
  const db = createAdminClient();
  let query = db.from("invoices").select("*, invoice_lines(*, billing_candidate_line_links(candidate_id,active))").order("issue_date", { ascending: false });
  if (clientId) query = query.eq("client_id", clientId);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Unable to load invoices", code: "INVOICE_READ_FAILED" }, { status: 500 });
  const invoices = (data || []).map((invoice: Record<string, unknown>) => {
    const { invoice_lines: lines, ...fields } = invoice;
    return {
      ...fields,
      invoice_lines: Array.isArray(lines) ? lines.map((line: Record<string, unknown>) => {
        const { billing_candidate_line_links: links, ...lineFields } = line;
        const candidateIds = Array.isArray(links)
          ? links.filter((link: Record<string, unknown>) => link.active !== false).map((link: Record<string, unknown>) => link.candidate_id)
          : [];
        return { ...lineFields, candidateIds };
      }) : [],
    };
  });
  return NextResponse.json({ invoices }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const access = await requireBillingAction("invoices.draft.manage");
  if (access.response || !access.identity) return access.response;
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid JSON body");
    body = parsed as Record<string, unknown>;
  } catch { return apiError("Invalid JSON body", "INVALID_JSON", 400); }
  if (typeof body?.clientId !== "string" || !UUID.test(body.clientId) || Object.keys(body).some((key) => !["clientId", "memo"].includes(key))) return apiError("A valid clientId UUID and optional memo are required; number, dates and totals are server-assigned", "INVALID_INPUT", 422);
  if (body.memo !== undefined && typeof body.memo !== "string") return apiError("memo must be text", "INVALID_INPUT", 422);
  const db = createAdminClient();
  const { data, error } = await db.from("invoices").insert({
    client_id: body.clientId,
    invoice_number: null,
    status: "draft",
    issue_date: null,
    due_date: null,
    memo: body.memo ?? null,
    created_by: access.identity?.id || null,
  }).select("*, invoice_lines(*, billing_candidate_line_links(candidate_id,active))").single();
  if (error) return apiError(error.code === "23503" ? "Client not found" : "Unable to create draft invoice", error.code === "23503" ? "NOT_FOUND" : "INVOICE_CREATE_FAILED", error.code === "23503" ? 404 : 500);
  return NextResponse.json({ invoice: toPhase2Invoice(data), refresh: ["invoice", "receivables"] }, { status: 201 });
}
