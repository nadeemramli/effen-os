# Proposed migrations (not applied)

Files here are reviewed SQL that has **not** run against the Supabase project.
They live outside `migrations/` on purpose. Per `migrations/README.md`, a
migration file is committed under the version it was recorded with when it ran.

To release one, an owner with project authorisation does the following:

1. Applies it through the Supabase MCP `apply_migration` tool, ideally on a
   branch database first.
2. Runs its contract tests against that database.
3. Moves the file to `migrations/<recorded_version>_<name>.sql` and deletes it
   from this folder.

| File | ADR | Local verification |
|---|---|---|
| `creative_lab_v1.sql` | [ADR-0010](../../docs/decisions/0010-creative-learning-poster-production.md) | `PGHOST=… scripts/creative/test-sql.sh` runs the harness, then this migration, then `supabase/tests/creative_lab.sql` on a throwaway local Postgres 16 |
