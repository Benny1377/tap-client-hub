import { NextResponse } from "next/server";
import { isPowerUser } from "@/lib/access-policy";
import { requireCollectionsAccess } from "@/lib/billing-access";
import { createAdminClient } from "@/lib/supabase/admin";

const NO_STORE = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Re-associate approved A/R client accounts with Operations clients. */
export async function POST(request: Request) {
  const access = await requireCollectionsAccess();
  if (access.response) return access.response;
  if (!access.identity) {
    return NextResponse.json({ error: "Unauthorized", code: "UNAUTHENTICATED" }, { status: 401, headers: NO_STORE });
  }
  if (!isPowerUser(access.identity.role)) {
    return NextResponse.json({ error: "Only Owner/Admin can relink approved A/R client accounts", code: "IMPORT_CLIENT_RELINK_FORBIDDEN" }, { status: 403, headers: NO_STORE });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON body", code: "INVALID_JSON" }, { status: 400, headers: NO_STORE });
  }
  const links = (body as { links?: unknown } | null)?.links;
  if (!Array.isArray(links) || links.length < 1 || links.length > 100 || links.some((item) => {
    if (!item || typeof item !== "object") return true;
    const value = item as Record<string, unknown>;
    return typeof value.source_client_id !== "string" || !UUID.test(value.source_client_id)
      || typeof value.target_client_id !== "string" || !UUID.test(value.target_client_id)
      || typeof value.note !== "string" || value.note.trim().length < 8 || value.note.trim().length > 500;
  })) {
    return NextResponse.json({ error: "Provide 1-100 valid source/target client links with an audit reason", code: "INVALID_CLIENT_RELINKS" }, { status: 400, headers: NO_STORE });
  }

  const db = createAdminClient();
  const { data, error } = await db.rpc("relink_collections_client_accounts", {
    p_links: links,
    p_actor: access.identity.id,
  });
  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "22023" ? 400 : error.code === "P0002" ? 404 : error.code === "P0001" ? 409 : 500;
    const code = status === 403 ? "IMPORT_CLIENT_RELINK_FORBIDDEN"
      : status === 400 ? "INVALID_CLIENT_RELINKS"
      : status === 404 ? "IMPORT_CLIENT_NOT_FOUND"
      : status === 409 ? "IMPORT_CLIENT_RELINK_CONFLICT"
      : "IMPORT_CLIENT_RELINK_FAILED";
    const message = status === 403 ? "Only an active Owner or Admin may relink client accounts."
      : status === 400 ? "The client relink request is invalid."
      : status === 404 ? "The source or target client was not found."
      : status === 409 ? "The client relink conflicts with the current account data or state."
      : "Unable to relink Collections client accounts.";
    return NextResponse.json({ error: message, code }, { status, headers: NO_STORE });
  }
  return NextResponse.json(data, { status: 200, headers: NO_STORE });
}
