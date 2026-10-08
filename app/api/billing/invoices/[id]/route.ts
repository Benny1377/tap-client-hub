import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireBillingAccess, requireBillingPowerUser } from "@/lib/billing-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireBillingAccess(true);
  if (access.response) return access.response;
  const { id } = await params;
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const db = createAdminClient();
  const { data: current, error: loadError } = await db.from("invoices").select("status").eq("id", id).maybeSingle();
  if (loadError) return NextResponse.json({ error: loadError.message }, { status: 500 });
  if (!current) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  if (current.status !== "draft") return NextResponse.json({ error: "Only draft invoices can be edited" }, { status: 409 });
  const allowed: Record<string, unknown> = {};
  for (const key of ["issue_date", "due_date", "memo", "invoice_number"]) if (body[key] !== undefined) allowed[key] = body[key];
  if (body.due_date && body.issue_date && body.due_date < body.issue_date) return NextResponse.json({ error: "due_date must be on or after issue_date" }, { status: 422 });
  const { data, error } = await db.from("invoices").update(allowed).eq("id", id).eq("status", "draft").select("*, invoice_lines(*)").single();
  if (error) return NextResponse.json({ error: error.code === "23505" ? "Invoice number already exists" : error.message }, { status: error.code === "23505" ? 409 : 500 });
  return NextResponse.json({ invoice: data });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  if (body?.action === "void") {
    const access = await requireBillingPowerUser();
    if (access.response) return access.response;
    const db = createAdminClient();
    const { data, error } = await db.from("invoices").update({ status: "void", voided_by: access.identity!.id, voided_at: new Date().toISOString(), void_reason: body.reason || null }).eq("id", id).eq("status", "issued").select("*, invoice_lines(*)").single();
    if (error) return NextResponse.json({ error: error.code === "PGRST116" ? "Only issued invoices can be voided" : error.message }, { status: error.code === "PGRST116" ? 409 : 500 });
    return NextResponse.json({ invoice: data });
  }
  if (body?.action !== "issue") return NextResponse.json({ error: "action must be issue or void" }, { status: 422 });
  const access = await requireBillingAccess(true);
  if (access.response) return access.response;
  const db = createAdminClient();
  const { data: lines, error: lineError } = await db.from("invoice_lines").select("id").eq("invoice_id", id);
  if (lineError) return NextResponse.json({ error: lineError.message }, { status: 500 });
  if (!lines?.length) return NextResponse.json({ error: "An invoice must have at least one line before issue" }, { status: 409 });
  const { data, error } = await db.from("invoices").update({ status: "issued" }).eq("id", id).eq("status", "draft").select("*, invoice_lines(*)").single();
  if (error) return NextResponse.json({ error: error.code === "PGRST116" ? "Only draft invoices can be issued" : error.message }, { status: error.code === "PGRST116" ? 409 : 500 });
  return NextResponse.json({ invoice: data });
}
