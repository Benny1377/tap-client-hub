import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireLedgerReadAccess } from "@/lib/billing-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await requireLedgerReadAccess();
  if (access.response) return access.response;
  const db = createAdminClient();
  const clientId = request.nextUrl.searchParams.get("client_id");
  let query = db.from("invoices").select("id, client_id, invoice_number, status, issue_date, due_date, invoice_lines(amount), payment_allocations(amount, reversed_at)").eq("status", "issued");
  if (clientId) query = query.eq("client_id", clientId);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Unable to load receivables" }, { status: 500 });
  const clientIds = [...new Set((data || []).map((row: any) => row.client_id))];
  let paymentQuery = db.from("payments").select("client_id, amount, payment_allocations(amount, reversed_at)").eq("status", "recorded");
  if (clientId) paymentQuery = paymentQuery.eq("client_id", clientId);
  const { data: payments } = await paymentQuery;
  const unallocatedByClient = new Map<string, number>();
  for (const payment of payments || []) {
    const allocated = (payment.payment_allocations || []).filter((a: any) => !a.reversed_at).reduce((sum: number, a: any) => sum + Number(a.amount || 0), 0);
    unallocatedByClient.set(payment.client_id, (unallocatedByClient.get(payment.client_id) || 0) + Math.max(0, Number(payment.amount || 0) - allocated));
  }
  const today = new Date();
  const rows = (data || []).map((invoice: any) => {
    const total = (invoice.invoice_lines || []).reduce((sum: number, line: any) => sum + Number(line.amount || 0), 0);
    const allocated = (invoice.payment_allocations || []).filter((a: any) => !a.reversed_at).reduce((sum: number, a: any) => sum + Number(a.amount || 0), 0);
    const balance = Math.max(0, Math.round((total - allocated) * 100) / 100);
    const daysPastDue = balance > 0 ? Math.max(0, Math.floor((today.getTime() - new Date(`${invoice.due_date}T00:00:00Z`).getTime()) / 86400000)) : 0;
    const bucket = daysPastDue === 0 ? "current" : daysPastDue <= 30 ? "1_30" : daysPastDue <= 60 ? "31_60" : daysPastDue <= 90 ? "61_90" : "90_plus";
    return { id: invoice.id, client_id: invoice.client_id, invoice_number: invoice.invoice_number, status: invoice.status, issue_date: invoice.issue_date, due_date: invoice.due_date, total: total.toFixed(2), allocated: allocated.toFixed(2), balance: balance.toFixed(2), days_past_due: daysPastDue, aging_bucket: bucket };
  });
  return NextResponse.json({ receivables: rows, unallocated_payments: clientIds.map((id) => ({ client_id: id, amount: (unallocatedByClient.get(id) || 0).toFixed(2) })) }, { headers: { "Cache-Control": "no-store" } });
}
