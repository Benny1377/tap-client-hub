import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireBillingAccess } from "@/lib/billing-access";

export const runtime = "nodejs";

function decimal(value: unknown, scale: number) {
  const raw = String(value ?? "").trim();
  const match = new RegExp(`^(\\d+)(?:\\.(\\d{1,${scale}}))?$`).exec(raw);
  if (!match) return null;
  const whole = match[1].replace(/^0+(?=\d)/, "");
  const fractional = (match[2] ?? "").padEnd(scale, "0");
  const units = `${whole}${fractional}`.replace(/^0+(?=\d)/, "");
  return { units, value: `${whole}.${fractional}` };
}

function money(value: unknown) {
  const parsed = decimal(value, 2);
  if (!parsed) return null;
  return { cents: parsed.units, value: parsed.value };
}

function multiplyUnsigned(left: string, right: string) {
  const output = Array(left.length + right.length).fill(0);
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      const index = i + j + 1;
      const product = Number(left[i]) * Number(right[j]) + output[index];
      output[index] = product % 10;
      output[index - 1] += Math.floor(product / 10);
    }
  }
  for (let i = output.length - 1; i > 0; i -= 1) {
    output[i - 1] += Math.floor(output[i] / 10);
    output[i] %= 10;
  }
  return output.join("").replace(/^0+(?=\d)/, "");
}

function incrementUnsigned(value: string) {
  const digits = value.split("");
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    if (digits[index] !== "9") { digits[index] = String(Number(digits[index]) + 1); return digits.join(""); }
    digits[index] = "0";
  }
  return `1${digits.join("")}`;
}

function lineAmount(quantityUnits: string, unitCents: string) {
  const product = multiplyUnsigned(quantityUnits, unitCents).padStart(5, "0");
  const cents = product.slice(0, -4) || "0";
  const roundedCents = Number(product.slice(-4, -3)) >= 5 ? incrementUnsigned(cents) : cents;
  return { value: `${roundedCents.slice(0, -2) || "0"}.${roundedCents.slice(-2).padStart(2, "0")}` };
}

export async function POST(request: NextRequest) {
  const access = await requireBillingAccess();
  if (access.response) return access.response;
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid JSON body");
    body = parsed as Record<string, unknown>;
  } catch { return NextResponse.json({ error: "Invalid JSON body", code: "INVALID_JSON" }, { status: 400 }); }
  if (!body?.invoice_id || !body?.description) return NextResponse.json({ error: "invoice_id and description are required", code: "INVALID_INPUT" }, { status: 422 });
  const quantity = decimal(body.quantity ?? "1", 4);
  const unit = money(body.unit_amount);
  if (!quantity || quantity.units === "0" || !unit) return NextResponse.json({ error: "quantity and unit_amount must be positive monetary values", code: "INVALID_AMOUNT" }, { status: 422 });
  const amount = lineAmount(quantity.units, unit.cents);
  const db = createAdminClient();
  const { data: invoice } = await db.from("invoices").select("status").eq("id", body.invoice_id).maybeSingle();
  if (!invoice) return NextResponse.json({ error: "Invoice not found", code: "NOT_FOUND" }, { status: 404 });
  if (invoice.status !== "draft") return NextResponse.json({ error: "Invoice lines can only be changed while the invoice is draft", code: "INVOICE_NOT_DRAFT" }, { status: 409 });
  const { data, error } = await db.from("invoice_lines").insert({
    invoice_id: body.invoice_id, client_service_id: body.client_service_id ?? null,
    period: body.period ?? null, description: String(body.description).trim(), quantity: quantity.value,
    unit_amount: unit.value, amount: amount.value, sort_order: Number.isInteger(body.sort_order) ? body.sort_order : 0,
    created_by: access.identity?.id || null,
  }).select().single();
  if (error) {
    const invariant = error.code === "P0001";
    return NextResponse.json({ error: error.message, code: invariant ? "LINE_INVARIANT_VIOLATION" : error.code === "23514" ? "INVALID_LINE" : "LINE_CREATE_FAILED" }, { status: invariant ? 409 : error.code === "23514" ? 422 : 500 });
  }
  return NextResponse.json({ line: data }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const access = await requireBillingAccess();
  if (access.response) return access.response;
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required", code: "INVALID_INPUT" }, { status: 422 });
  const db = createAdminClient();
  const { error } = await db.rpc("delete_draft_invoice_line", { p_line_id: id, p_actor: access.identity!.id });
  if (error) {
    const missing = /not_found/i.test(error.message);
    const conflict = /conflict/i.test(error.message);
    return NextResponse.json({ error: error.message, code: missing ? "NOT_FOUND" : conflict ? "INVOICE_NOT_DRAFT" : "DELETE_FAILED" }, { status: missing ? 404 : conflict ? 409 : 500 });
  }
  return NextResponse.json({ deleted: true });
}

export async function PATCH(request: NextRequest) {
  const access = await requireBillingAccess();
  if (access.response) return access.response;
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid JSON body");
    body = parsed as Record<string, unknown>;
  } catch { return NextResponse.json({ error: "Invalid JSON body", code: "INVALID_JSON" }, { status: 400 }); }
  if (!body?.id) return NextResponse.json({ error: "id is required", code: "INVALID_INPUT" }, { status: 422 });
  const db = createAdminClient();
  const { data: line } = await db.from("invoice_lines").select("invoice_id").eq("id", body.id).maybeSingle();
  if (!line) return NextResponse.json({ error: "Invoice line not found", code: "NOT_FOUND" }, { status: 404 });
  const { data: invoice } = await db.from("invoices").select("status").eq("id", line.invoice_id).maybeSingle();
  if (!invoice || invoice.status !== "draft") return NextResponse.json({ error: "Invoice lines can only be changed while the invoice is draft", code: "INVOICE_NOT_DRAFT" }, { status: 409 });
  const updates: Record<string, unknown> = {};
  for (const key of ["description", "period", "client_service_id", "sort_order"]) if (body[key] !== undefined) updates[key] = body[key];
  if (body.quantity !== undefined || body.unit_amount !== undefined) {
    const { data: current } = await db.from("invoice_lines").select("quantity, unit_amount").eq("id", body.id).single();
    const quantity = decimal(body.quantity ?? current?.quantity, 4); const unit = money(body.unit_amount ?? current?.unit_amount);
    if (!quantity || !unit || quantity.units === "0") return NextResponse.json({ error: "Invalid quantity or unit_amount", code: "INVALID_AMOUNT" }, { status: 422 });
    const amount = lineAmount(quantity.units, unit.cents);
    updates.quantity = quantity.value; updates.unit_amount = unit.value; updates.amount = amount.value;
  }
  updates.updated_by = access.identity?.id || null;
  const { data, error } = await db.from("invoice_lines").update(updates).eq("id", body.id).select().single();
  if (error) return NextResponse.json({ error: error.message, code: error.code === "P0001" ? "LINE_INVARIANT_VIOLATION" : "LINE_UPDATE_FAILED" }, { status: error.code === "P0001" ? 409 : 500 });
  return NextResponse.json({ line: data });
}
