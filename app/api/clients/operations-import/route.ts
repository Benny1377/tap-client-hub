import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAccessIdentity } from "@/lib/access-server";
import type { OperationsImportPayload } from "@/lib/operations-client-import";

export const dynamic = "force-dynamic";

function sandboxOnly() {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!value) return false;
  try {
    const { hostname, port } = new URL(value);
    return hostname === "vuqgxotdccxivjmavsoj.supabase.co"
      || ((hostname === "127.0.0.1" || hostname === "localhost") && port === "55321");
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!sandboxOnly()) return NextResponse.json({ error: "Operations import is disabled outside the Collections sandbox." }, { status: 404 });
  const identity = await resolveAccessIdentity();
  if (!identity) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (identity.role !== "owner" && identity.role !== "admin") return NextResponse.json({ error: "Owner or Admin access required." }, { status: 403 });

  let body: { mode?: unknown; payload?: OperationsImportPayload };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON import payload." }, { status: 400 });
  }
  const mode = body.mode;
  const payload = body.payload;
  if ((mode !== "preview" && mode !== "apply") || !payload || !Array.isArray(payload.clients) || !Array.isArray(payload.contacts)) {
    return NextResponse.json({ error: "Invalid import request." }, { status: 400 });
  }
  if (payload.clients.length < 1 || payload.clients.length > 2000 || payload.contacts.length > 5000) {
    return NextResponse.json({ error: "Import exceeds supported row limits." }, { status: 413 });
  }

  try {
    const { data, error } = await createAdminClient().rpc("import_operations_client_data", {
      p_actor: identity.id,
      p_clients: payload.clients,
      p_contacts: payload.contacts,
      p_apply: mode === "apply",
    });
    if (error) throw error;
    const result = Array.isArray(data) ? data[0] : data;
    if (!result?.ok) return NextResponse.json(result, { status: 409 });
    return NextResponse.json(result, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to import Operations client data." }, { status: 500 });
  }
}
