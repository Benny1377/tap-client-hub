import { NextResponse } from "next/server";
import { requireBillingAccess, resolveBillingActions } from "@/lib/billing-access";

export const dynamic = "force-dynamic";
export async function GET() {
  const access = await requireBillingAccess();
  if (access.response || !access.identity) return access.response;
  const actions = await resolveBillingActions(access.identity);
  return NextResponse.json({ role: access.identity.role, modules: access.identity.modules, actions }, { headers: { "Cache-Control": "no-store" } });
}
