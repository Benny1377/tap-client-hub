import { createHash } from "node:crypto";
import type { AccessIdentity } from "@/lib/access-server";
import { createAdminClient } from "@/lib/supabase/admin";

export type ImportAction = "upload" | "review" | "approve";
export async function canUseCollectionsImport(identity: AccessIdentity, action: ImportAction) {
  if (identity.role === "owner" || identity.role === "admin") return true;
  const db = createAdminClient();
  const { data, error } = await db.from("collection_import_permissions").select("policy").eq("id", "default").maybeSingle();
  if (error || !data?.policy || typeof data.policy !== "object") return false;
  const allowed = (data.policy as Record<string, unknown>)[action];
  // Import permissions can be granted to either module. A user assigned both
  // should retain the union of those grants, not have one module silently win.
  const policyRoles = [
    ...(identity.modules.includes("Collections") ? ["collections"] : []),
    ...(identity.modules.includes("Billing") ? ["billing"] : []),
  ];
  if (!policyRoles.length) policyRoles.push(identity.role);
  return Array.isArray(allowed) && policyRoles.some((role) => allowed.includes(role));
}

export async function recordImportAudit(input: {
  batchId?: string | null;
  sourceInvoiceId?: string | null;
  actor?: string | null;
  action: string;
  detail?: Record<string, unknown>;
}) {
  const db = createAdminClient();
  const { error } = await db.from("collection_import_audit").insert({
    batch_id: input.batchId || null,
    source_invoice_id: input.sourceInvoiceId || null,
    actor: input.actor || null,
    action: input.action,
    detail: input.detail || {},
  });
  if (error) throw new Error("IMPORT_AUDIT_WRITE_FAILED");
}

export async function loadImportInvoiceLabels(sourceInvoiceIds: string[]) {
  if (!sourceInvoiceIds.length) return new Map<string, { invoice_number: string; source_batch_id: string; source_as_of: string; discrepancy_status: string }>();
  const db = createAdminClient();
  const { data, error } = await db.from("collection_import_invoices")
    .select("source_invoice_id,batch_id,invoice_number,source_as_of,discrepancy_status")
    .in("source_invoice_id", Array.from(new Set(sourceInvoiceIds))).order("updated_at", { ascending: false });
  if (error) throw new Error("IMPORT_INVOICE_LABEL_READ_FAILED");
  const labels = new Map<string, { invoice_number: string; source_batch_id: string; source_as_of: string; discrepancy_status: string }>();
  for (const row of data || []) if (!labels.has(row.source_invoice_id)) labels.set(row.source_invoice_id, {
    invoice_number: row.invoice_number || "", source_batch_id: row.batch_id, source_as_of: row.source_as_of,
    discrepancy_status: row.discrepancy_status,
  });
  return labels;
}

export function isPdfFile(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

export async function sha256Hex(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
