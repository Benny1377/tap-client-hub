import { NextRequest, NextResponse } from "next/server";
import { requireLedgerReadAccess } from "@/lib/billing-access";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value: string) {
  if (!DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function badRequest(message: string, code: string) {
  return NextResponse.json({ error: message, code }, { status: 422, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest) {
  const access = await requireLedgerReadAccess();
  if (access.response) return access.response;

  const params = request.nextUrl.searchParams;
  const clientId = params.get("client_id");
  const asOfDate = params.get("as_of_date");
  const rawLimit = params.get("limit");
  const rawOffset = params.get("offset");
  const limit = rawLimit === null ? 100 : Number(rawLimit);
  const offset = rawOffset === null ? 0 : Number(rawOffset);

  if (clientId && !UUID.test(clientId)) return badRequest("client_id must be a UUID", "INVALID_CLIENT_ID");
  if (asOfDate && !isValidDate(asOfDate)) {
    return badRequest("as_of_date must use YYYY-MM-DD", "INVALID_AS_OF_DATE");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) return badRequest("limit must be an integer from 1 to 200", "INVALID_LIMIT");
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000) return badRequest("offset must be a non-negative integer", "INVALID_OFFSET");

  const db = createAdminClient();
  const { data, error } = await db.rpc("get_collections_worklist", {
    p_client_id: clientId || null,
    p_as_of_date: asOfDate || null,
    p_limit: limit,
    p_offset: offset,
  });
  if (error || !data) {
    return NextResponse.json(
      { error: "Unable to load Collections receivables", code: "COLLECTIONS_READ_MODEL_FAILED" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
