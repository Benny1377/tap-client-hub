#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
db_url="postgresql://postgres:postgres@127.0.0.1:55322/postgres"

if [[ "${1:-}" != "--local" ]]; then
  echo "Refusing to run without --local. This script targets only port 55322."
  exit 2
fi

for test_file in \
  collections_phase1_security_and_audit.sql \
  collections_phase1_audit_actor.sql \
  collections_phase2_stage_regressions.sql; do
  echo "Running $test_file"
  psql "$db_url" -X -v ON_ERROR_STOP=1 -f "$project_root/supabase/tests/$test_file" >/dev/null
done
echo "Local Billing and Collections SQL checks passed."
