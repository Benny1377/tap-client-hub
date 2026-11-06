import { NextResponse } from "next/server";
import { isPowerUser } from "@/lib/access-policy";
import { resolveAccessIdentity } from "@/lib/access-server";
import { createAdminClient } from "@/lib/supabase/admin";

const NO_STORE = { "Cache-Control": "no-store" };

export const BILLING_ACTIONS = [
  "billing.view", "pricing.view", "pricing.manage", "candidates.view", "candidates.manage",
  "invoices.draft.manage", "invoices.issue", "invoices.void", "payments.record", "payments.allocate",
  "payments.reverse", "settings.terms.manage", "settings.remittance.manage", "policy.manage",
] as const;
export type BillingAction = typeof BILLING_ACTIONS[number];
const OWNER_ONLY = new Set<BillingAction>(["policy.manage", "invoices.void", "payments.reverse"]);
const STAFF_DEFAULTS: BillingAction[] = ["billing.view", "pricing.view", "candidates.view", "candidates.manage", "invoices.draft.manage", "invoices.issue", "payments.record", "payments.allocate"];
export const DELEGABLE_BILLING_ROLES: readonly string[] = ["manager", "staff", "offshore"];
const DEFAULT_DELEGABLE_ROLES = [...DELEGABLE_BILLING_ROLES];
export const DELEGABLE_BILLING_ACTIONS = BILLING_ACTIONS.filter((action) => !OWNER_ONLY.has(action));
export type BillingPolicyRow = { action_key: BillingAction; allowed_roles: string[]; enabled: boolean };

export function effectiveBillingPolicy(policyRows: BillingPolicyRow[]) {
  const stored = new Map(policyRows.map((row) => [row.action_key, row]));
  return DELEGABLE_BILLING_ACTIONS.map((actionKey) => {
    const row = stored.get(actionKey);
    const defaultEnabled = STAFF_DEFAULTS.includes(actionKey);
    return {
      actionKey,
      // Owner/Admin privileges are inherent and not delegated through policy rows.
      // Keep the GET snapshot valid as-is for PATCH.
      allowedRoles: row
        ? row.allowed_roles.filter((role) => DELEGABLE_BILLING_ROLES.includes(role))
        : defaultEnabled ? [...DEFAULT_DELEGABLE_ROLES] : [],
      enabled: row ? row.enabled : defaultEnabled,
    };
  });
}

export function billingActionsForIdentity(identity: { role: string; modules: string[] }, policyRows: BillingPolicyRow[]) {
  if (isPowerUser(identity.role)) return [...BILLING_ACTIONS];
  if (!identity.modules.includes("Billing")) return [];
  const policy = new Map(policyRows.map((row) => [row.action_key, row]));
  const role = identity.role.toLowerCase();
  const actions = new Set<BillingAction>(STAFF_DEFAULTS.filter((action) => !OWNER_ONLY.has(action) &&
    (policy.has(action) ? policy.get(action)?.enabled && policy.get(action)?.allowed_roles.includes(role) : true)));
  for (const [key, row] of policy) {
    if (BILLING_ACTIONS.includes(key) && !OWNER_ONLY.has(key) && row.enabled && row.allowed_roles.includes(role)) actions.add(key);
  }
  return BILLING_ACTIONS.filter((action) => actions.has(action));
}

export async function resolveBillingActions(identity: NonNullable<Awaited<ReturnType<typeof resolveAccessIdentity>>>) {
  if (isPowerUser(identity.role)) return [...BILLING_ACTIONS];
  if (!identity.modules.includes("Billing")) return [];
  const db = createAdminClient();
  // Read disabled rows too: a disabled policy must be able to revoke a default
  // staff action rather than falling through to STAFF_DEFAULTS.
  const { data, error } = await db.from("billing_action_policy").select("action_key,allowed_roles,enabled");
  if (error) return [];
  return billingActionsForIdentity(identity, (data || []) as BillingPolicyRow[]);
}

export async function requireBillingAction(action: BillingAction) {
  const access = await requireBillingAccess();
  if (access.response || !access.identity) return access;
  if (isPowerUser(access.identity.role)) return access;
  if (OWNER_ONLY.has(action) || !access.identity.modules.includes("Billing")) {
    return { ...access, response: NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403, headers: NO_STORE }) };
  }
  const actions = await resolveBillingActions(access.identity);
  if (!actions.includes(action)) return { ...access, response: NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403, headers: NO_STORE }) };
  return access;
}

export async function requireBillingAccess() {
  const identity = await resolveAccessIdentity();
  if (!identity) return { identity: null, response: NextResponse.json({ error: "Unauthorized", code: "UNAUTHENTICATED" }, { status: 401, headers: NO_STORE }) };
  const allowed = isPowerUser(identity.role) || identity.modules.includes("Billing");
  if (!allowed) return { identity, response: NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403, headers: NO_STORE }) };
  return { identity, response: null };
}

export async function requireBillingPowerUser() {
  const identity = await resolveAccessIdentity();
  if (!identity) return { identity: null, response: NextResponse.json({ error: "Unauthorized", code: "UNAUTHENTICATED" }, { status: 401, headers: NO_STORE }) };
  if (!isPowerUser(identity.role)) return { identity, response: NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403, headers: NO_STORE }) };
  return { identity, response: null };
}

export async function requireCollectionsAccess() {
  const identity = await resolveAccessIdentity();
  if (!identity) return { identity: null, response: NextResponse.json({ error: "Unauthorized", code: "UNAUTHENTICATED" }, { status: 401, headers: NO_STORE }) };
  if (!(isPowerUser(identity.role) || identity.modules.includes("Collections"))) {
    return { identity, response: NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403, headers: NO_STORE }) };
  }
  return { identity, response: null };
}

export async function requireLedgerReadAccess() {
  const identity = await resolveAccessIdentity();
  if (!identity) return { identity: null, response: NextResponse.json({ error: "Unauthorized", code: "UNAUTHENTICATED" }, { status: 401, headers: NO_STORE }) };
  if (!(isPowerUser(identity.role) || identity.modules.includes("Billing") || identity.modules.includes("Collections"))) {
    return { identity, response: NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403, headers: NO_STORE }) };
  }
  return { identity, response: null };
}
