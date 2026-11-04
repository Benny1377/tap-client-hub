import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireBillingAction, requireBillingPowerUser } from "@/lib/billing-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireBillingAction("invoices.draft.manage");
  if (access.response) return access.response;
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid JSON body");
    body = parsed as Record<string, unknown>;
  } catch { return NextResponse.json({ error: "Invalid JSON body", code: "INVALID_JSON" }, { status: 400 }); }
  const db = createAdminClient();
  const { data: current, error: loadError } = await db.from("invoices").select("status").eq("id", id).maybeSingle();
  if (loadError) return NextResponse.json({ error: loadError.message, code: "INVOICE_READ_FAILED" }, { status: 500 });
  if (!current) return NextResponse.json({ error: "Invoice not found", code: "NOT_FOUND" }, { status: 404 });
  if (current.status !== "draft") return NextResponse.json({ error: "Only draft invoices can be edited", code: "INVOICE_NOT_DRAFT" }, { status: 409 });
  const allowed: Record<string, unknown> = {};
  for (const key of ["issue_date", "due_date", "memo", "invoice_number"]) if (body[key] !== undefined) allowed[key] = body[key];
  if (body.due_date && body.issue_date && body.due_date < body.issue_date) return NextResponse.json({ error: "due_date must be on or after issue_date", code: "INVALID_DATE_RANGE" }, { status: 422 });
  allowed.updated_by = access.identity?.id || null;
  const { data, error } = await db.from("invoices").update(allowed).eq("id", id).eq("status", "draft").select("*, invoice_lines(*)").single();
  if (error) return NextResponse.json({ error: error.code === "23505" ? "Invoice number already exists" : error.message, code: error.code === "23505" ? "INVOICE_NUMBER_EXISTS" : "INVOICE_UPDATE_FAILED" }, { status: error.code === "23505" ? 409 : 500 });
  return NextResponse.json({ invoice: data });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireBillingAction("invoices.draft.manage");
  if (access.response) return access.response;
  const { id } = await params;
  const db = createAdminClient();
  const { data: linked } = await db.from("billing_candidate_line_links").select("candidate_id,invoice_lines!inner(invoice_id)").eq("invoice_lines.invoice_id", id);
  const { error } = await db.rpc("delete_draft_invoice", { p_invoice_id: id, p_actor: access.identity!.id });
  if (error?.code === "23503") return NextResponse.json({ error: "Invoice is referenced by Collections history and cannot be deleted", code: "INVOICE_REFERENCED" }, { status: 409 });
  if (error) {
    const missing = /not_found/i.test(error.message);
    const conflict = /conflict/i.test(error.message);
    return NextResponse.json({ error: error.message, code: missing ? "NOT_FOUND" : conflict ? "INVOICE_NOT_DRAFT" : "DELETE_FAILED" }, { status: missing ? 404 : conflict ? 409 : 500 });
  }
  return NextResponse.json({ deleted: true, returnedCandidateIds: (linked || []).map((row) => row.candidate_id), refresh: ["candidates", "receivables"] });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid JSON body");
    body = parsed as Record<string, unknown>;
  } catch { return NextResponse.json({ error: "Invalid JSON body", code: "INVALID_JSON" }, { status: 400 }); }
  if (body?.action === "void") {
    const access = await requireBillingPowerUser();
    if (access.response) return access.response;
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!reason) return NextResponse.json({ error: "A non-empty void reason is required", code: "VOID_REASON_REQUIRED" }, { status: 422 });
    const { phase2InvoiceRpc } = await import("@/lib/billing-phase2-rpc");
    const result = await phase2InvoiceRpc("void", id, access.identity!.id, reason);
    if (result.response) return result.response;
    const db = createAdminClient();
    const { data: legacy } = await db.from("invoices").select("*, invoice_lines(*)").eq("id", id).single();
    return NextResponse.json({ invoice: legacy });
  }
  if (body?.action !== "issue") return NextResponse.json({ error: "action must be issue or void", code: "INVALID_ACTION" }, { status: 422 });
  const access = await requireBillingAction("invoices.issue");
  if (access.response) return access.response;
  const db = createAdminClient();
  const { phase2InvoiceRpc } = await import("@/lib/billing-phase2-rpc");
  const result = await phase2InvoiceRpc("issue", id, access.identity!.id);
  if (result.response) return result.response;
  const { data: legacy } = await db.from("invoices").select("*, invoice_lines(*)").eq("id", id).single();
  return NextResponse.json({ invoice: legacy });
}
