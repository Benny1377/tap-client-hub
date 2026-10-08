import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireBillingAccess } from "@/lib/billing-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await requireBillingAccess();
  if (access.response) return access.response;
  const clientId = request.nextUrl.searchParams.get("client_id");
  const db = createAdminClient();
  let query = db.from("invoices").select("*, invoice_lines(*)").order("issue_date", { ascending: false });
  if (clientId) query = query.eq("client_id", clientId);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Unable to load invoices" }, { status: 500 });
  return NextResponse.json({ invoices: data || [] }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const access = await requireBillingAccess();
  if (access.response) return access.response;
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  if (!body?.client_id || !body?.invoice_number || !body?.issue_date || !body?.due_date) {
    return NextResponse.json({ error: "client_id, invoice_number, issue_date, and due_date are required" }, { status: 422 });
  }
  if (body.status && body.status !== "draft") return NextResponse.json({ error: "New invoices must start as drafts" }, { status: 422 });
  const db = createAdminClient();
  const { data, error } = await db.from("invoices").insert({
    client_id: body.client_id,
    invoice_number: String(body.invoice_number).trim(),
    status: "draft",
    issue_date: body.issue_date,
    due_date: body.due_date,
    memo: body.memo ?? null,
    created_by: access.identity?.id || null,
  }).select("*, invoice_lines(*)").single();
  if (error) {
    const status = error.code === "23505" ? 409 : error.code === "23514" ? 422 : 500;
    return NextResponse.json({ error: status === 409 ? "Invoice number already exists" : error.message }, { status });
  }
  return NextResponse.json({ invoice: data }, { status: 201 });
}
