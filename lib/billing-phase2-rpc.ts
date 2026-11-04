import { createAdminClient } from "@/lib/supabase/admin";
import { apiError, toPhase2Invoice } from "@/lib/billing-phase2";

export async function phase2InvoiceRpc(kind: "issue" | "void", id: string, actor: string, reason?: string) {
  const db = createAdminClient();
  const { error } = kind === "issue"
    ? await db.rpc("issue_billing_invoice", { p_invoice_id: id, p_actor: actor })
    : await db.rpc("void_billing_invoice", { p_invoice_id: id, p_reason: reason, p_actor: actor });
  if (error) {
    const message = error.message || "Billing operation failed";
    const notFound = /not_found/i.test(message);
    const status = notFound ? 404 : error.code === "22023" ? 422 : /active_payment_allocation/i.test(message) ? 409 : 409;
    const code = notFound ? "NOT_FOUND" : /active_payment_allocation/i.test(message) ? "ACTIVE_PAYMENT_ALLOCATION" : /issue_precondition_failed/i.test(message) ? "ISSUE_PRECONDITION_FAILED" : kind === "issue" ? "INVOICE_NOT_DRAFT" : "INVOICE_NOT_ISSUED";
    return { response: apiError(message.replace(/^[a-z_]+: /i, ""), code, status), invoice: null };
  }
  const { data, error: readError } = await db.from("invoices").select("*, invoice_lines(*, billing_candidate_line_links(candidate_id,active))").eq("id", id).single();
  if (readError) return { response: apiError("Unable to load updated invoice", "INVOICE_READ_FAILED", 500), invoice: null };
  return { response: null, invoice: toPhase2Invoice(data) };
}
