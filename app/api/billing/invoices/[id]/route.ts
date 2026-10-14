import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireBillingAccess, requireBillingPowerUser } from "@/lib/billing-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireBillingAccess();
  if (access.response) return access.response;
  const { id } = await params;
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body", code: "INVALID_JSON" }, { status: 400 }); }
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
  const access = await requireBillingAccess();
  if (access.response) return access.response;
  const { id } = await params;
  const db = createAdminClient();
  const { error } = await db.rpc("delete_draft_invoice", { p_invoice_id: id, p_actor: access.identity!.id });
  if (error?.code === "23503") return NextResponse.json({ error: "Invoice is referenced by Collections history and cannot be deleted", code: "INVOICE_REFERENCED" }, { status: 409 });
  if (error) {
    const missing = /not_found/i.test(error.message);
    const conflict = /conflict/i.test(error.message);
    return NextResponse.json({ error: error.message, code: missing ? "NOT_FOUND" : conflict ? "INVOICE_NOT_DRAFT" : "DELETE_FAILED" }, { status: missing ? 404 : conflict ? 409 : 500 });
  }
  return NextResponse.json({ deleted: true });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body", code: "INVALID_JSON" }, { status: 400 }); }
  if (body?.action === "void") {
    const access = await requireBillingPowerUser();
    if (access.response) return access.response;
    const db = createAdminClient();
    const { data, error } = await db.from("invoices").update({ status: "void", voided_by: access.identity!.id, updated_by: access.identity!.id, voided_at: new Date().toISOString(), void_reason: body.reason || null }).eq("id", id).eq("status", "issued").select("*, invoice_lines(*)").single();
    if (error) return NextResponse.json({ error: error.code === "PGRST116" ? "Only issued invoices can be voided" : error.message, code: error.code === "PGRST116" ? "INVOICE_NOT_ISSUED" : "INVOICE_VOID_FAILED" }, { status: error.code === "PGRST116" ? 409 : 500 });
    return NextResponse.json({ invoice: data });
  }
  if (body?.action !== "issue") return NextResponse.json({ error: "action must be issue or void", code: "INVALID_ACTION" }, { status: 422 });
  const access = await requireBillingAccess();
  if (access.response) return access.response;
  const db = createAdminClient();
  const { data: lines, error: lineError } = await db.from("invoice_lines").select("id").eq("invoice_id", id);
  if (lineError) return NextResponse.json({ error: lineError.message, code: "INVOICE_LINES_READ_FAILED" }, { status: 500 });
  if (!lines?.length) return NextResponse.json({ error: "An invoice must have at least one line before issue", code: "INVOICE_HAS_NO_LINES" }, { status: 409 });
  const { data, error } = await db.from("invoices").update({ status: "issued", updated_by: access.identity?.id || null }).eq("id", id).eq("status", "draft").select("*, invoice_lines(*)").single();
  if (error) return NextResponse.json({ error: error.code === "PGRST116" ? "Only draft invoices can be issued" : error.message, code: error.code === "PGRST116" ? "INVOICE_NOT_DRAFT" : "INVOICE_ISSUE_FAILED" }, { status: error.code === "PGRST116" ? 409 : 500 });
  return NextResponse.json({ invoice: data });
}
