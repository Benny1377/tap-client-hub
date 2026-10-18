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
  assert.match(parse, /review_disposition: "duplicate"/);
  assert.match(review, /CLIENT_LINK_REQUIRED|Select an existing TAP Hub client first/);
  assert.match(migration, /review_disposition text not null default 'unreviewed'/);
  assert.match(migration, /every extracted line must be classified before approval/);
  assert.match(migration, /uploader cannot approve/);
  assert.match(migration, /corrector cannot approve/);
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
  const review = source("app/api/collections/imports/[id]/route.ts");
  const migration = source("supabase/migrations/20261019100000_collections_pdf_intake.sql");
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
});
