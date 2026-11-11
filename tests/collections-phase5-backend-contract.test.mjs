import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Phase 5 contract pins the approved ladder, clear, history and visibility decisions", () => {
  const contract = source("docs/contracts/collections-phase-5-client-feedback.md");
  assert.match(contract, /Owner approved.*first touch is Friendly/i);
  assert.match(contract, /min_days_since_previous/);
  assert.match(contract, /complete_report_confirmed/);
  assert.match(contract, /12-month/);
  assert.match(contract, /Owner\/Admin and staff assigned the Collections module/);
});

test("rules API reads and audits bounded inter-stage gap values", () => {
  const route = source("app/api/collections/rules/route.ts");
  assert.match(route, /min_days_since_previous/);
  assert.match(route, /update_collections_configuration_phase5/);
  assert.match(route, /3650/);
});

test("first touch stays Friendly and preview does not bypass the ladder", () => {
  const preview = source("app/api/collections/automation/preview/route.ts");
  const runner = source("lib/collections-test-run.ts");
  const worklist = source("lib/collections-import-worklist.ts");
  assert.match(preview, /invoice\.next_stage/);
  assert.doesNotMatch(preview, /directOwnerEscalation|direct_escalation_threshold/);
  assert.match(runner, /invoice\.next_stage/);
  assert.match(worklist, /next_stage_eligible_on/);
  assert.match(worklist, /completed_stage/);
});

test("event history is optionally client-filtered, paged across clients, and Collections-gated", () => {
  const route = source("app/api/collections/events/route.ts");
  for (const code of ["INVALID_CLIENT_ID", "INVALID_EVENT_TYPE", "INVALID_LIMIT", "INVALID_OFFSET"]) {
    assert.ok(route.includes(code), `missing ${code}`);
  }
  assert.match(route, /occurred_at.*DESC|ascending:\s*false/);
  assert.match(route, /requireCollectionsAccess/);
  assert.match(route, /if \(clientId\) query = query\.eq\("client_id", clientId\)/);
  assert.match(route, /pagination:\s*\{\s*limit,\s*offset,\s*total/);
  // The page reads events across clients for the approval queue (no client required); the Activity log was removed from the UI.
  assert.match(source("lib/billing-ui/ledger.ts"), /api\.events\(clientId, \{ limit: 200, offset: options\.eventsOffset \|\| 0 \}\)/);
});

test("new PDF reports carry invoice identity only on an exact unambiguous client/invoice/date match", () => {
  const migration = source("supabase/migrations/20261111095644_collections_phase5_identity_cross_client_delivery_fixes.sql");
  assert.match(migration, /prior\.invoice_number=v_fields->>'invoice_number'/);
  assert.match(migration, /prior\.transaction_date=\(v_fields->>'transaction_date'\)::date/);
  assert.match(migration, /s\.client_id=v_client_id/);
  assert.match(migration, /v_exact_count>1/);
  assert.match(migration, /v_partial_count>0/);
  assert.match(migration, /identity_reused/);
});

test("PDF test delivery is source-aware and synthetic-only; accepted dates drive gaps", () => {
  const migration = source("supabase/migrations/20261111095644_collections_phase5_identity_cross_client_delivery_fixes.sql");
  const runner = source("lib/collections-test-run.ts");
  const readModel = source("lib/collections-import-worklist.ts");
  assert.match(migration, /v_attempt\.source_invoice_id is null/);
  assert.match(migration, /not v_client\.is_synthetic/);
  assert.match(migration, /v_identity\.linked_invoice_id is distinct from v_attempt\.invoice_id/);
  assert.match(migration, /v_attempt\.stage<=3/);
  assert.match(migration, /get_collection_test_message_context/);
  assert.match(runner, /mergeApprovedPdfReceivables/);
  assert.match(runner, /canonical_collection_identity/);
  assert.match(runner, /source_invoice_id: source === "pdf_import" \? invoice\.source_invoice_id : null/);
  assert.match(readModel, /accepted_at/);
  assert.match(readModel, /attempt\.accepted_at\)/);
});

test("complete-report approval previews and confirms PDF-only clear impact", () => {
  const approve = source("app/api/collections/imports/[id]/approve/route.ts");
  const preview = source("app/api/collections/imports/[id]/clear-preview/route.ts");
  const migration = source("supabase/migrations/20261110142736_collections_phase5_client_feedback.sql");
  assert.match(approve, /complete_report_confirmed/);
  assert.match(approve, /approve_collection_import_pair/);
  assert.match(preview, /preview_collection_import_clear/);
  assert.match(migration, /clear_confirmation_required/);
  assert.match(migration, /SOURCE_CLEARED/);
  assert.match(migration, /s\.selected_source='pdf_import' and s\.linked_invoice_id is null/);
  assert.match(migration, /in.flight|sending/);
});

test("receivables exposes note and late-history summaries from the read model", () => {
  const readModel = source("lib/collections-import-worklist.ts");
  const migration = source("supabase/migrations/20261110142736_collections_phase5_client_feedback.sql");
  assert.match(readModel, /note_count/);
  assert.match(readModel, /last_note_at/);
  assert.match(readModel, /late_beyond_final_count/);
  assert.match(readModel, /get_collections_late_history/);
  assert.match(migration, /get_collections_note_summaries/);
  assert.match(migration, /get_collections_late_history/);
});

test("approved PDF zero balances are represented as paid without entering Billing", () => {
  const readModel = source("lib/collections-import-worklist.ts");
  const type = source("lib/collections-api.ts");
  const route = source("app/api/collections/receivables/route.ts");
  assert.match(readModel, /reportInvoicePaymentStatus/);
  assert.match(readModel, /collection_status: paid \? "paid" as const : "open" as const/);
  assert.match(readModel, /paid_as_of: paid \? asOf : null/);
  assert.match(readModel, /upcoming_stage: isPaid \? null/);
  assert.match(readModel, /next_stage: isPaid \? null/);
  assert.match(readModel, /if \(amount <= 0 \|\| invoice\.collection_status === "paid"\) continue/);
  assert.match(type, /collection_status: "open" \| "paid"/);
  assert.match(route, /invoice\.paid_as_of = null/);
});

test("client delivery summary is paginated and excludes content, stage 4, and forbidden roles", () => {
  const route = source("app/api/collections/deliveries/summary/route.ts");
  assert.match(route, /requireCollectionsAccess/);
  assert.match(route, /client_id/);
  assert.match(route, /stage.*\[1, 2, 3\]/);
  assert.match(route, /formal_notice_sent/);
  assert.match(route, /event\.canonical_collection_identity \|\| \(event\.invoice_id \? `billing:/);
  assert.match(route, /pagination/);
  assert.doesNotMatch(route, /html_body|text_body|recipient_email|provider_message_id/);
  assert.match(source("app/api/collections/deliveries/route.ts"), /client_id/);
});

test("Phase 5 migration is included in reset and SQL suite runners", () => {
  const migration = "20261110142736_collections_phase5_client_feedback.sql";
  assert.ok(source("tools/collections-local/reset.sh").includes(migration));
  assert.ok(source("tools/collections-local/test.sh").includes("collections_phase5_client_feedback.sql"));
  assert.ok(source("supabase/tests/collections_phase5_client_feedback.sql").includes("rollback;"));
  assert.ok(source("tools/collections-local/reset.sh").includes("20261111095644_collections_phase5_identity_cross_client_delivery_fixes.sql"));
  assert.ok(source("tools/collections-local/test.sh").includes("collections_phase5_identity_delivery_followups.sql"));
  assert.ok(source("supabase/tests/collections_phase5_identity_delivery_followups.sql").includes("rollback;"));
});

test("delivery history schema repair adds accepted timestamp and reason without replacing claim guards", () => {
  const migration = source("supabase/migrations/20261110220908_collections_delivery_history_schema.sql");
  assert.match(migration, /add column if not exists reason_code text/i);
  assert.match(migration, /add column if not exists accepted_at timestamptz/i);
  assert.match(migration, /set status = 'accepted'[\s\S]*where status = 'sent'/i);
  assert.doesNotMatch(migration, /create or replace function[\s\S]*claim_collection_test_delivery/i);
});
