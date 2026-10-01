#!/usr/bin/env bash
# Run the creative-lab SQL contract tests on a THROWAWAY local Postgres:
#   harness (Supabase/foundation stand-ins) → annotated reference schema → tests.
# --applied replays the seven recorded migration files instead, proving the
# applied SQL and the reference stay equivalent.
# Never point this at the Supabase project: it creates and drops a database.
#   PGHOST=/tmp PGPORT=54329 PGUSER=postgres scripts/creative/test-sql.sh
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
db="creative_lab_test_$$"
createdb "$db"
trap 'dropdb --if-exists "$db"' EXIT
psql -v ON_ERROR_STOP=1 -q -d "$db" -f "$root/supabase/tests/creative_lab_harness.sql"
if [ "${1:-}" = "--applied" ]; then
  for f in "$root"/supabase/migrations/*_creative_lab_v1_*.sql; do
    psql -v ON_ERROR_STOP=1 -q -d "$db" -f "$f"
  done
else
  psql -v ON_ERROR_STOP=1 -q -d "$db" -f "$root/supabase/reference/creative_lab_v1.sql"
fi
psql -v ON_ERROR_STOP=1 -q -d "$db" -f "$root/supabase/tests/creative_lab.sql"
