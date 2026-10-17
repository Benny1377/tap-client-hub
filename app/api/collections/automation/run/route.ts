import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runCollectionsTestDelivery } from "@/lib/collections-test-run";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

function validMachineToken(request: NextRequest) {
  const expected = process.env.COLLECTIONS_WORKER_TOKEN;
  const actual = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || !actual) return false;
  const a = Buffer.from(actual); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  if (!validMachineToken(request)) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHENTICATED" }, { status: 401, headers: NO_STORE });
  let body: unknown = {};
  const raw = await request.text();
  if (raw.trim()) {
    try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid JSON body", code: "INVALID_JSON" }, { status: 400, headers: NO_STORE }); }
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => key !== "limit")) {
    return NextResponse.json({ error: "Only an optional limit is accepted", code: "INVALID_INPUT" }, { status: 422, headers: NO_STORE });
  }
  const limit = (body as { limit?: unknown }).limit ?? 50;
  if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 200) {
    return NextResponse.json({ error: "limit must be an integer from 1 to 200", code: "INVALID_LIMIT" }, { status: 422, headers: NO_STORE });
  }
  const serviceActor = process.env.COLLECTIONS_SYSTEM_ACTOR_ID || "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(serviceActor)) {
    return NextResponse.json({ error: "Worker service identity is not configured", code: "WORKER_IDENTITY_MISSING" }, { status: 409, headers: NO_STORE });
  }
  const db = createAdminClient();
  const { data: profile } = await db.from("profiles").select("id").eq("id", serviceActor).maybeSingle();
  if (!profile) return NextResponse.json({ error: "Worker service identity is not registered", code: "WORKER_IDENTITY_INVALID" }, { status: 409, headers: NO_STORE });
  const result = await runCollectionsTestDelivery(serviceActor, Number(limit));
  if (!result) return NextResponse.json({ error: "Test delivery is not ready", code: "DELIVERY_NOT_READY" }, { status: 409, headers: NO_STORE });
  return NextResponse.json(result, { headers: NO_STORE });
}
