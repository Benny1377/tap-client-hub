#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
local_root="$project_root/tools/collections-local"
db_url="postgresql://postgres:postgres@127.0.0.1:55322/postgres"

if [[ "${1:-}" != "--local" ]]; then
  echo "Refusing to reset without --local. This script targets only port 55322."
  exit 2
fi

supabase start --workdir "$local_root" >/dev/null
supabase db reset --local --no-seed --workdir "$local_root" >/dev/null

for migration in \
  20261009120000_create_billing_ledger.sql \
  20261009130000_add_billing_audit_rpc.sql \
  20261010100000_add_billing_reversal_rpcs.sql \
  20261010110000_billing_audit_and_receivables.sql \
  20261010120000_collections_automation_foundation.sql \
  20261010130000_collections_shared_date_and_stage_model.sql \
  20261010140000_collections_stage_and_api_corrections.sql \
  20261011100000_collections_catch_up_policy.sql \
  20261011110000_collections_stage_context_and_timezone.sql \
  20261011120000_collections_dynamic_rules.sql \
  20261017120000_collections_test_delivery.sql \
  20261018110000_collections_delivery_reason_codes.sql \
  20261019100000_collections_pdf_intake.sql \
  20261019110000_collections_event_rules_for_source.sql \
  20261019120000_collections_reblock_multi_invoice_payments.sql \
  20261019130000_collections_import_batch_metadata_correction.sql \
  20261019140000_collections_test_delivery_source_discrepancy.sql \
  20261104160000_collections_guard_auto_match_review_state.sql \
  20261107120000_collections_reconcile_noninvoice_pdf_rows.sql \
  20261107130000_audit_client_creation.sql \
  20261107132830_collections_require_review_before_cross_check.sql \
  20261109134439_operations_client_data_import.sql \
  20261110131721_collections_atomic_summary_detail_approval.sql \
  20261110131729_operations_import_source_client_preflight.sql \
  20261110135841_collections_audited_client_relink.sql \
  20261020100000_billing_ledger_database_invariants.sql \
  20261105100000_billing_phase2_core.sql \
  20261105110000_billing_manual_confirmation_guard.sql \
  20261106100000_billing_rpc_auth_and_candidate_audit_id.sql \
  20261106110000_billing_presentation_settings.sql \
  20261107140000_billing_firm_schedule_paging.sql \
  20261107150120_billing_issue_presentation_snapshot.sql \
  20261110220908_collections_delivery_history_schema.sql \
  20261110142736_collections_phase5_client_feedback.sql \
  20261111095644_collections_phase5_identity_cross_client_delivery_fixes.sql \
  20261111115029_collections_phase5_delivery_and_relink_safety.sql \
  20261111125830_collections_test_delivery_billing_claim_dispatch.sql; do
  psql "$db_url" -X -v ON_ERROR_STOP=1 -f "$project_root/supabase/migrations/$migration" >/dev/null
done
psql "$db_url" -X -v ON_ERROR_STOP=1 -f "$local_root/seed.sql" >/dev/null
echo "Local Collections database reset with synthetic fixtures."
