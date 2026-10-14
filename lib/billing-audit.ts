import { createAdminClient } from "@/lib/supabase/admin";

/** Best-effort audit writer for the hosted audit_log shape. */
export async function writeBillingAudit(input: { actor: string; action: string; entity: string; entityId?: string | null; detail?: Record<string, unknown> }) {
  const db = createAdminClient();
  const { error } = await db.from("audit_log").insert({ actor: input.actor, action: input.action, entity: input.entity, entity_id: input.entityId ?? null, detail: input.detail ?? {} });
  if (error) console.error("Billing audit write failed", { action: input.action, entity: input.entity, error: error.message });
}
