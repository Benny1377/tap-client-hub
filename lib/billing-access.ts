import { NextResponse } from "next/server";
import { isPowerUser } from "@/lib/access-policy";
import { resolveAccessIdentity } from "@/lib/access-server";

export async function requireBillingAccess() {
  const identity = await resolveAccessIdentity();
  if (!identity) return { identity: null, response: NextResponse.json({ error: "Unauthorized", code: "UNAUTHENTICATED" }, { status: 401 }) };
  const allowed = isPowerUser(identity.role) || identity.modules.includes("Billing");
  if (!allowed) return { identity, response: NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 }) };
  return { identity, response: null };
}

export async function requireBillingPowerUser() {
  const identity = await resolveAccessIdentity();
  if (!identity) return { identity: null, response: NextResponse.json({ error: "Unauthorized", code: "UNAUTHENTICATED" }, { status: 401 }) };
  if (!isPowerUser(identity.role)) return { identity, response: NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 }) };
  return { identity, response: null };
}

export async function requireCollectionsAccess() {
  const identity = await resolveAccessIdentity();
  if (!identity) return { identity: null, response: NextResponse.json({ error: "Unauthorized", code: "UNAUTHENTICATED" }, { status: 401 }) };
  if (!(isPowerUser(identity.role) || identity.modules.includes("Collections"))) {
    return { identity, response: NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 }) };
  }
  return { identity, response: null };
}

export async function requireLedgerReadAccess() {
  const identity = await resolveAccessIdentity();
  if (!identity) return { identity: null, response: NextResponse.json({ error: "Unauthorized", code: "UNAUTHENTICATED" }, { status: 401 }) };
  if (!(isPowerUser(identity.role) || identity.modules.includes("Billing") || identity.modules.includes("Collections"))) {
    return { identity, response: NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 }) };
  }
  return { identity, response: null };
}
