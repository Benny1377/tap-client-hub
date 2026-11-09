import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("PDF intake stores only private, hash-deduplicated PDF uploads with audited access", () => {
  const upload = source("app/api/collections/imports/route.ts");
  const migration = source("supabase/migrations/20261019100000_collections_pdf_intake.sql");
  assert.match(upload, /requireCollectionsAccess/);
  assert.match(upload, /canUseCollectionsImport\(access\.identity!, "upload"\)/);
  assert.match(upload, /MAX_BYTES = 25 \* 1024 \* 1024/);
  assert.match(upload, /application\/pdf/);
  assert.match(upload, /%PDF-/);
  assert.match(upload, /sha256Hex/);
  assert.match(upload, /duplicate_upload_detected/);
  assert.match(migration, /uq_collection_import_file_sha256/);
  assert.match(migration, /values \('collections-ar-pdfs', 'collections-ar-pdfs', false/);
  assert.match(migration, /collections_ar_pdf_service_only/);
  assert.doesNotMatch(migration, /delete after|expiration_days|auto_delete/i);
});

test("parse results remain staging data until every source line and invoice is reviewed", () => {
  const parse = source("app/api/collections/imports/[id]/parse/route.ts");
  const review = source("app/api/collections/imports/[id]/route.ts");
  const migration = source("supabase/migrations/20261019100000_collections_pdf_intake.sql");
  assert.match(parse, /parseCollectionsPdf/);
  assert.match(parse, /raw_text: line\.text/);
  assert.match(parse, /review_disposition: autoClassified \? suggestion\.disposition : "unreviewed"/);
  assert.doesNotMatch(parse, /review_disposition: "duplicate"/);
  assert.match(parse, /update\.duplicate_of = null/);
  assert.match(parse, /confidence: "low"/);
  assert.match(parse, /Repeated source text was previously marked as a duplicate/);
  assert.match(parse, /update\.review_disposition = "unreviewed"/);
  assert.match(review, /CLIENT_LINK_REQUIRED|Select an existing TAP Hub client first/);
  assert.match(migration, /review_disposition text not null default 'unreviewed'/);
  assert.match(migration, /every extracted line must be classified before approval/);
  assert.match(migration, /uploader cannot approve/);
  assert.match(migration, /corrector cannot approve/);
});

test("new client records carry a creator and generate a PII-minimized audit row", () => {
  const clientsRoute = source("app/api/clients/route.ts");
  const auditMigration = source("supabase/migrations/20261107130000_audit_client_creation.sql");
  assert.match(clientsRoute, /created_by: access\.identity!\.id/);
  assert.match(auditMigration, /after insert on tap_hub_project\.clients/);
  assert.match(auditMigration, /new\.created_by/);
  assert.match(auditMigration, /jsonb_build_object\('name', new\.name, 'type', new\.type, 'status', new\.status\)/);
  assert.doesNotMatch(auditMigration, /new\.(?:emails|phones|ein|address)/);
});

test("automatic A/R mapping is conservative, permission-checked, auditable, and still gated by a separate approval", () => {
  const parse = source("app/api/collections/imports/[id]/parse/route.ts");
  const autoMatch = source("app/api/collections/imports/[id]/auto-match/route.ts");
  const suggestions = source("lib/collections-pdf-suggestions.ts");
  const ui = source("components/billing/import-panels.tsx");
  const lockMigration = source("supabase/migrations/20261104160000_collections_guard_auto_match_review_state.sql");
  assert.match(parse, /suggestCollectionsPdfRows/);
  assert.match(parse, /requires_human_confirmation: true/);
  assert.match(autoMatch, /canUseCollectionsImport\(access\.identity!, "review"\)/);
  assert.match(autoMatch, /auto_match_collection_import_rows/);
  assert.match(lockMigration, /v_client_count <> 1/);
  assert.match(lockMigration, /review_unreviewed_collection_import_invoice/);
  assert.match(lockMigration, /p_linked_invoice_id/);
  assert.match(autoMatch, /requires_separate_owner_approval: true/);
  assert.match(suggestions, /confidence: "high"/);
  assert.match(suggestions, /No safe row classification/);
  assert.match(lockMigration, /v_disposition <> 'unreviewed'/);
  assert.match(lockMigration, /cardinality\(p_source_row_ids\).*500/);
  assert.match(lockMigration, /for update/);
  assert.match(ui, /Apply exact client matches in one step/);
  assert.match(ui, /A separate Owner\/Admin still has to approve/);
});

test("customer group headings may contain digits without treating transaction IDs as customers", () => {
  const suggestions = source("lib/collections-pdf-suggestions.ts");
  assert.match(suggestions, /QuickBooks customer headings can contain digits/);
  assert.match(suggestions, /transaction IDs out/);
});

test("parser behavior changes use a new version so existing batches can refresh", () => {
  const suggestions = source("lib/collections-pdf-suggestions.ts");
  assert.match(suggestions, /COLLECTIONS_PDF_SUGGESTION_PARSER_VERSION = "quickbooks-aging-summary-match-v7"/);
});

test("paired A/R approval requires a same-date summary and commits both batches together", () => {
  const approve = source("app/api/collections/imports/[id]/approve/route.ts");
  const summaryCorrection = source("app/api/collections/imports/[id]/summary-row/route.ts");
  const migration = source("supabase/migrations/20261109121124_collections_atomic_summary_detail_approval.sql");
  const parse = source("app/api/collections/imports/[id]/parse/route.ts");
  assert.match(approve, /summary_batch_id/);
  assert.match(approve, /approve_collection_import_pair/);
  assert.match(approve, /IMPORT_RECONCILIATION_MISMATCH/);
  assert.match(approve, /IMPORT_SEPARATION_OF_DUTIES/);
  assert.match(approve, /conflict \? 409/);
  assert.match(summaryCorrection, /canUseCollectionsImport\(access\.identity!, "review"\)/);
  assert.match(summaryCorrection, /review_collection_import_summary_row/);
  assert.doesNotMatch(summaryCorrection, /\bBigInt\b|\d+n\b/);
  assert.match(migration, /pdf_summary_row_corrected/);
  assert.match(parse, /suggestCollectionsSummaryRows/);
  assert.match(migration, /status = 'approved',approved_by = p_actor/);
  assert.match(migration, /summary and detail reports do not match|status','mismatch/);
  assert.match(migration, /non-admin uploader cannot approve/);
  assert.match(migration, /batch corrector cannot approve/);
});

test("approved import source identities carry across actions and block stale or conflicting balances", () => {
  const migration = source("supabase/migrations/20261019100000_collections_pdf_intake.sql");
  const events = source("app/api/collections/events/route.ts");
  const holds = source("app/api/collections/holds/route.ts");
  const worklist = source("lib/collections-import-worklist.ts");
  assert.match(migration, /canonical_collection_identity/);
  assert.match(migration, /collection_delivery_attempts_source_invoice_fk/);
  assert.match(migration, /billing_snapshot_stale/);
  assert.match(migration, /billing_discrepancy_detected/);
  assert.match(migration, /separate histories; manual reconciliation required/);
  assert.match(migration, /canonical collection identity is immutable/);
  assert.match(events, /record_collection_event_for_source/);
  assert.match(holds, /place_collection_hold_for_source/);
  assert.match(worklist, /source_invoice_id/);
  assert.match(worklist, /discrepancy_status/);
  assert.match(worklist, /selected_source !== "pdf_import"/);
});

test("review APIs and UI-facing rows use stable source identity and explicitly show discrepancy blocks", () => {
  const types = source("lib/collections-api.ts");
  const preview = source("app/api/collections/automation/preview/route.ts");
  const deliveries = source("app/api/collections/deliveries/route.ts");
  const resolver = source("app/api/collections/imports/invoices/[sourceInvoiceId]/resolve/route.ts");
  assert.match(types, /source_invoice_id: string \| null/);
  assert.match(types, /canonical_collection_identity: string/);
  assert.match(types, /SOURCE_DISCREPANCY_BLOCKED/);
  assert.match(preview, /source_discrepancy_blocked/);
  assert.match(preview, /canonical_collection_identity/);
  assert.match(deliveries, /source_invoice_id/);
  assert.match(resolver, /resolution_note/);
  assert.match(resolver, /resolve_collection_import_discrepancy/);
});

test("raw imported report contents require review permission and balance selection requires approval permission", () => {
  const list = source("app/api/collections/imports/route.ts");
  const detail = source("app/api/collections/imports/[id]/route.ts");
  const resolve = source("app/api/collections/imports/invoices/[sourceInvoiceId]/resolve/route.ts");
  assert.match(list, /export async function GET\(\)[\s\S]*canUseCollectionsImport\(access\.identity!, "review"\)/);
  assert.match(detail, /export async function GET[\s\S]*canUseCollectionsImport\(access\.identity!, "review"\)/);
  assert.match(resolve, /canUseCollectionsImport\(access\.identity!, "approve"\)/);
  assert.match(resolve, /IMPORT_APPROVE_FORBIDDEN/);
});

test("same-date summary reports require a reviewer-confirmed, auditable detail-total match", () => {
  const crossCheck = source("app/api/collections/imports/[id]/cross-check/route.ts");
  const parse = source("app/api/collections/imports/[id]/parse/route.ts");
  const review = source("app/api/collections/imports/[id]/route.ts");
  const migration = source("supabase/migrations/20261019100000_collections_pdf_intake.sql");
  const guardMigration = source("supabase/migrations/20261107132830_collections_require_review_before_cross_check.sql");
  const sqlTest = source("supabase/tests/collections_phase4_intake_schema.sql");
  assert.match(crossCheck, /cross_check_collection_import_reports/);
  assert.match(migration, /summary_reported_total/);
  assert.match(migration, /detail_invoice_total/);
  assert.match(migration, /difference/);
  assert.match(migration, /summary_detail_cross_checked/);
  assert.match(migration, /same-date summary report has not been cross-checked successfully/);
  assert.match(migration, /summary reports are cross-check evidence, not invoice-level import data/);
  assert.match(review, /review_collection_import_invoice/);
  assert.match(review, /classify_collection_import_row/);
  assert.match(migration, /collection_import_invoice_revisions/);
  assert.match(sqlTest, /Late link changed canonical identity or failed to share aliases/);
  assert.match(sqlTest, /post-report Billing change did not re-block/);
  assert.match(guardMigration, /review_disposition='unreviewed'/);
  assert.match(guardMigration, /r\.source_invoice_id is null/);
  assert.match(parse, /This invoice text appears more than once in the report/);
  assert.match(parse, /confirmedSameText/);
  assert.match(sqlTest, /Cross-check did not refuse while a source invoice row was unreviewed/);
  assert.match(sqlTest, /Cross-check did not refuse an invoice row without a staged identity/);
});

test("detail reconciliation includes recognized non-invoice evidence and fails closed on missing amounts", () => {
  const migration = source("supabase/migrations/20261107120000_collections_reconcile_noninvoice_pdf_rows.sql");
  const reset = source("tools/collections-local/reset.sh");
  const parser = source("lib/collections-pdf-suggestions.ts");
  assert.match(migration, /v_invoice_total \+ v_non_invoice_total/);
  assert.match(migration, /v_expected_non_invoice_count <> v_evidence_count/);
  assert.match(migration, /detail_invoice_subtotal/);
  assert.match(migration, /detail_non_invoice_adjustments/);
  assert.match(migration, /detail_net_total/);
  assert.match(reset, /20261107120000_collections_reconcile_noninvoice_pdf_rows\.sql/);
  assert.match(reset, /20261104160000_collections_guard_auto_match_review_state\.sql/);
  assert.match(parser, /transaction retained as report evidence/);
  assert.match(parser, /transaction_type: type,[\s\S]*open_balance: amount/);
});

test("detail parsing uses only one same-date summary as name evidence and audits that read", () => {
  const route = source("app/api/collections/imports/[id]/parse/route.ts");
  const parser = source("lib/collections-pdf-suggestions.ts");
  assert.match(route, /eq\("report_type", "aging_summary"\)\.eq\("source_as_of", parsed\.source_as_of\)/);
  assert.match(route, /summaryBatches\?\.length === 1/);
  assert.match(route, /pdf_summary_matching_context_read/);
  assert.match(route, /suggestCollectionsPdfRows\(parsed\.lines, summaryLines\)/);
  assert.match(parser, /nameCandidates\.length !== 1/);
  assert.match(parser, /total\.balance === nameCandidates\[0\]\.balance/);
});
