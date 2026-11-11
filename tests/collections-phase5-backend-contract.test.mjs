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

test("event history is filtered and paginated with stable validation codes", () => {
  const route = source("app/api/collections/events/route.ts");
  for (const code of ["INVALID_CLIENT_ID", "INVALID_EVENT_TYPE", "INVALID_LIMIT", "INVALID_OFFSET"]) {
    assert.ok(route.includes(code), `missing ${code}`);
  }
  assert.match(route, /occurred_at.*DESC|ascending:\s*false/);
  assert.match(route, /pagination:\s*\{\s*limit,\s*offset,\s*total/);
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
});

test("delivery history schema repair adds accepted timestamp and reason without replacing claim guards", () => {
  const migration = source("supabase/migrations/20261110220908_collections_delivery_history_schema.sql");
  assert.match(migration, /add column if not exists reason_code text/i);
  assert.match(migration, /add column if not exists accepted_at timestamptz/i);
  assert.match(migration, /set status = 'accepted'[\s\S]*where status = 'sent'/i);
  assert.doesNotMatch(migration, /create or replace function[\s\S]*claim_collection_test_delivery/i);
});
