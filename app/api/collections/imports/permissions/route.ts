import { NextRequest, NextResponse } from "next/server";
import { requireBillingPowerUser } from "@/lib/billing-access";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
const ACTIONS = ["upload", "review", "approve"] as const;
const ROLES = new Set(["owner", "admin", "collections", "billing"]);

export async function GET() {
  const access = await requireBillingPowerUser();
  if (access.response) return access.response;
  const db = createAdminClient();
  const { data, error } = await db.from("collection_import_permissions").select("policy,updated_by,updated_at").eq("id", "default").single();
  if (error) return NextResponse.json({ error: "Unable to load import permissions", code: "IMPORT_PERMISSION_READ_FAILED" }, { status: 500, headers: NO_STORE });
  return NextResponse.json(data, { headers: NO_STORE });
}

export async function PATCH(request: NextRequest) {
  const access = await requireBillingPowerUser();
  if (access.response) return access.response;
  let body: { policy?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body", code: "INVALID_JSON" }, { status: 400, headers: NO_STORE }); }
  const policy = body?.policy;
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) return NextResponse.json({ error: "policy must be an object", code: "INVALID_POLICY" }, { status: 422, headers: NO_STORE });
  const normalized: Record<string, string[]> = {};
  for (const action of ACTIONS) {
    const values = (policy as Record<string, unknown>)[action];
    if (!Array.isArray(values) || values.length > ROLES.size || values.some((role) => typeof role !== "string" || !ROLES.has(role))) {
      return NextResponse.json({ error: `policy.${action} must contain supported roles`, code: "INVALID_POLICY" }, { status: 422, headers: NO_STORE });
    }
    normalized[action] = Array.from(new Set(values as string[]));
  }
  // Owner/Admin remain the policy administrators; configured roles may be
  // delegated approval, but the database enforces uploader/corrector exclusion.
  normalized.approve = Array.from(new Set(["owner", "admin", ...normalized.approve]));
  const db = createAdminClient();
  const { data, error } = await db.from("collection_import_permissions").update({ policy: normalized, updated_by: access.identity!.id, updated_at: new Date().toISOString() }).eq("id", "default").select("policy,updated_by,updated_at").single();
  if (error) return NextResponse.json({ error: "Unable to save import permissions", code: "IMPORT_PERMISSION_WRITE_FAILED" }, { status: 500, headers: NO_STORE });
  return NextResponse.json(data, { headers: NO_STORE });
}
