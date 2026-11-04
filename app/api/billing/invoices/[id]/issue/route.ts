import { NextResponse } from "next/server";
import { requireBillingAction } from "@/lib/billing-access";
import { REFRESH_LEDGER } from "@/lib/billing-phase2";
import { phase2InvoiceRpc } from "@/lib/billing-phase2-rpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireBillingAction("invoices.issue");
  if (access.response || !access.identity) return access.response;
  const { id } = await params;
  const result = await phase2InvoiceRpc("issue", id, access.identity.id);
  if (result.response) return result.response;
  return NextResponse.json({ invoice: result.invoice, refresh: REFRESH_LEDGER });
}
