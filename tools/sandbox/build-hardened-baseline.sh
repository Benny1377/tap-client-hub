#!/usr/bin/env bash
# Builds the one-time TAB-HUB hosted-sandbox baseline from a schema-only export.
# The export remains ignored; the generated migration is deliberately ephemeral
# until a reviewer has approved its exact SQL.
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
source_file=${1:-"$repo_root/supabase/.temp/tap_hub_project_schema.sql"}
output_file="$repo_root/tools/sandbox/supabase/migrations/20261030000000_hardened_tab_hub_baseline.sql"
expected_sha256="c51426a55ce743a59dcbcb23dbc1eb78c9e772b9338d1b1425f87cfa22d16e72"

if [[ ! -s "$source_file" ]]; then
  echo "Schema-only source export is missing: $source_file" >&2
  exit 1
fi

actual_sha256=$(shasum -a 256 "$source_file" | awk '{print $1}')
if [[ "$actual_sha256" != "$expected_sha256" ]]; then
  echo "Refusing to build from an unreviewed schema export." >&2
  echo "Expected: $expected_sha256" >&2
  echo "Actual:   $actual_sha256" >&2
  exit 1
fi

if rg -n -i '^(insert into|copy )' "$source_file" >/dev/null; then
  echo "Refusing a non-schema-only export." >&2
  exit 1
fi

{
  cat <<'SQL'
-- TAB-HUB shared sandbox: reviewed schema-only bootstrap.
-- Generated from the owner-provided schema export after validation; do not edit
-- generated body manually. See tools/sandbox/README.md for the approval flow.
--
-- The source snapshot's GRANT statements are intentionally excluded. The
-- explicit, deny-by-default privilege block at the end is authoritative.

SQL
  awk '
    /^GRANT / { next }
    { print }
  ' "$source_file"
  cat <<'SQL'

-- Hosted sandbox security boundary. Browser roles receive no schema, table,
-- sequence, or function privilege until a reviewed feature migration grants it.
REVOKE ALL ON SCHEMA tap_hub_project FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA tap_hub_project FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA tap_hub_project FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA tap_hub_project FROM PUBLIC, anon, authenticated;

GRANT USAGE ON SCHEMA tap_hub_project TO service_role;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA tap_hub_project TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA tap_hub_project TO service_role;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA tap_hub_project TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA tap_hub_project
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA tap_hub_project
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA tap_hub_project
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
SQL
} > "$output_file"

echo "Built: $output_file"
echo "Run tools/sandbox/verify-hardened-baseline.sh before review or push."
