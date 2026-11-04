#!/usr/bin/env bash
# Static gate for the generated sandbox baseline. It never connects to Supabase.
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
baseline="$repo_root/tools/sandbox/supabase/migrations/20261030000000_hardened_tab_hub_baseline.sql"

if [[ ! -s "$baseline" ]]; then
  echo "Baseline is missing. Run tools/sandbox/build-hardened-baseline.sh first." >&2
  exit 1
fi

if rg -n -i '^(insert into|copy )' "$baseline"; then
  echo "Baseline must not contain data statements." >&2
  exit 1
fi

if rg -n '^GRANT .* TO (anon|authenticated);' "$baseline"; then
  echo "Baseline must not grant browser roles." >&2
  exit 1
fi

rg -q '^CREATE SCHEMA IF NOT EXISTS "tap_hub_project";' "$baseline"
rg -q '^REVOKE ALL ON SCHEMA tap_hub_project FROM PUBLIC, anon, authenticated;' "$baseline"
rg -q '^GRANT USAGE ON SCHEMA tap_hub_project TO service_role;' "$baseline"

echo "PASS: schema-only baseline has deny-by-default browser access."
