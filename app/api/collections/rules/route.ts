import { NextResponse } from "next/server";
import { requireLedgerReadAccess } from "@/lib/billing-access";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const access = await requireLedgerReadAccess();
  if (access.response) return access.response;

  const { data, error } = await createAdminClient()
    .from("collection_ladder_rules")
    .select("stage, label, days_past_due, automatic, enabled")
    .order("stage", { ascending: true });
  if (error) {
    return NextResponse.json(
      { error: "Unable to load Collections rules", code: "RULES_READ_FAILED" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json({ rules: data || [] }, { headers: { "Cache-Control": "no-store" } });
}
