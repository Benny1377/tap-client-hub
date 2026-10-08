import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireBillingAccess } from "@/lib/billing-access";

export const runtime = "nodejs";

function money(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return null;
  const cents = Math.round(Number(raw) * 100);
  return Number.isSafeInteger(cents) ? { cents, value: (cents / 100).toFixed(2) } : null;
}

export async function POST(request: NextRequest) {
  const access = await requireBillingAccess(true);
  if (access.response) return access.response;
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  if (!body?.invoice_id || !body?.description) return NextResponse.json({ error: "invoice_id and description are required" }, { status: 422 });
  const quantity = money(body.quantity ?? "1");
  const unit = money(body.unit_amount);
  if (!quantity || quantity.cents <= 0 || !unit) return NextResponse.json({ error: "quantity and unit_amount must be positive monetary values" }, { status: 422 });
  const amount = (quantity.cents * unit.cents) / 10000;
  if (!Number.isSafeInteger(Math.round(amount * 100))) return NextResponse.json({ error: "line amount is out of range" }, { status: 422 });
  const db = createAdminClient();
  const { data: invoice } = await db.from("invoices").select("status").eq("id", body.invoice_id).maybeSingle();
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  if (invoice.status !== "draft") return NextResponse.json({ error: "Invoice lines can only be changed while the invoice is draft" }, { status: 409 });
  const { data, error } = await db.from("invoice_lines").insert({
    invoice_id: body.invoice_id, client_service_id: body.client_service_id ?? null,
    period: body.period ?? null, description: String(body.description).trim(), quantity: (quantity.cents / 100).toFixed(4),
    unit_amount: unit.value, amount: (Math.round(amount * 100) / 100).toFixed(2), sort_order: Number.isInteger(body.sort_order) ? body.sort_order : 0,
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "23514" ? 422 : 500 });
  return NextResponse.json({ line: data }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const access = await requireBillingAccess(true);
  if (access.response) return access.response;
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 422 });
  const db = createAdminClient();
  const { data: line } = await db.from("invoice_lines").select("invoice_id").eq("id", id).maybeSingle();
  if (!line) return NextResponse.json({ error: "Invoice line not found" }, { status: 404 });
  const { data: invoice } = await db.from("invoices").select("status").eq("id", line.invoice_id).maybeSingle();
  if (!invoice || invoice.status !== "draft") return NextResponse.json({ error: "Invoice lines can only be changed while the invoice is draft" }, { status: 409 });
  const { error } = await db.from("invoice_lines").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: true });
}
