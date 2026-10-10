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
  20261011100000_collections_catch_up_policy.sql; do
  psql "$db_url" -X -v ON_ERROR_STOP=1 -f "$project_root/supabase/migrations/$migration" >/dev/null
done
psql "$db_url" -X -v ON_ERROR_STOP=1 -f "$local_root/seed.sql" >/dev/null
echo "Local Collections database reset with synthetic fixtures."
