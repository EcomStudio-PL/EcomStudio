#!/usr/bin/env bash
#
# GALLERY PER TOOL (0169), PROVEN AGAINST A REAL POSTGRES.
#
# 0169 is loaded VERBATIM (twice: it must re-run cleanly) on the shape of the
# columns it reads. What has to hold:
#   · every kind of job the app writes gets the mode of the tool that made it
#     (Retusz, Miniaturka, GrovBase Shot 1.0 / V2 / concepts, Stwórz zdjęcie,
#     Moda, Workflow ON runs) — from server-written fields only;
#   · an admin's workflow test and a job nothing identifies get NO mode (they
#     stay in the library, in no tool's gallery);
#   · the column follows a later settings update, and nobody can write it;
#   · adding it changes no other column of any row.
#
# Local harness only, its own database, removed on exit (KEEP_DB=1 keeps it).
#
#   bash scripts/pg-harness-up.sh && npm run test:gallerytools:sql
set -euo pipefail

PGSOCK="${PGSOCK:-/tmp/pgtest}"
PGPORT="${PGPORT:-5433}"
DB="${GALLERY_DB:-gallery_tool_mode_sqltest}"
PSQL0=(psql -h "$PGSOCK" -p "$PGPORT" -U postgres -v ON_ERROR_STOP=1 -X -q -t -A)
PSQL=("${PSQL0[@]}" -d "$DB")

if ! "${PSQL0[@]}" -d postgres -c 'select 1' >/dev/null 2>&1; then
  echo "gallerytools-sql: no harness on $PGSOCK:$PGPORT — run: bash scripts/pg-harness-up.sh" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIG="$ROOT/supabase/migrations/0169_generation_tool_mode.sql"
[ -f "$MIG" ] || { echo "gallerytools-sql: $MIG not found" >&2; exit 2; }

cleanup() { [ "${KEEP_DB:-0}" = "1" ] || "${PSQL0[@]}" -d postgres -c "drop database if exists $DB with (force)" >/dev/null 2>&1 || true; }
trap cleanup EXIT
PGOPTIONS="-c client_min_messages=warning" "${PSQL0[@]}" -d postgres -c "drop database if exists $DB with (force)" >/dev/null
"${PSQL0[@]}" -d postgres -c "create database $DB" >/dev/null

fails=0
check() { if [ "$2" = "$3" ]; then echo "  ✓ $1"; else echo "  ✗ $1 — got [$2], expected [$3]"; fails=$((fails+1)); fi; }
q() { "${PSQL[@]}" -c "$1"; }

"${PSQL[@]}" >/dev/null <<'SQL'
set client_min_messages = warning;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
create table public.generation_jobs (
  id integer primary key, workspace_id uuid, credits_charged integer default 7,
  settings jsonb, prompt_origin text, prompt_session_id uuid, prompt_id uuid
);
insert into public.generation_jobs (id, settings, prompt_origin, prompt_session_id, prompt_id) values
 (1,  '{"operation":"image_retouch"}', 'ecomstudio', null, null),
 (2,  '{"operation":"image_retouch","slot":{"tool":"retouch"}}', 'ecomstudio', null, null),
 (3,  '{"operation":"ecommerce_thumbnail","run_id":"r"}', 'ecomstudio', null, null),
 (4,  '{"engine":"grovshot_v2","run_id":"r"}', 'ecomstudio', '00000000-0000-0000-0000-000000000001', null),
 (5,  '{"slot":{"tool":"prompts"}}', 'ecomstudio', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002'),
 (6,  '{"slot":{"tool":"generator"}}', 'custom', null, null),
 (7,  '{}', 'custom', null, null),
 (8,  '{"resolution":"1K"}', null, '00000000-0000-0000-0000-000000000001', null),
 (9,  '{"resolution":"1K","negative":"x"}', null, null, null),
 (10, '{"operation":"fashion_iron","slot":{"tool":"fashion_iron"}}', 'ecomstudio', null, null),
 (11, '{"operation":"prompts","workflow":true}', 'ecomstudio', null, null),
 (12, '{"operation":"generator_test","workflow":true}', 'ecomstudio', null, null),
 (13, '{"slot":{"tool":"Bad Tool!"}}', 'custom', null, null),
 (14, '{}', 'ecomstudio', null, '00000000-0000-0000-0000-000000000002'),
 (15, '{"operation":"image_retouch","slot":{"tool":"generator"}}', 'custom', null, null);
create table snapshot as select id, credits_charged, settings, prompt_origin from public.generation_jobs;
SQL

echo "0169 — loaded verbatim, twice"
"${PSQL[@]}" -c "set client_min_messages = warning;" -f "$MIG" >/dev/null
"${PSQL[@]}" -c "set client_min_messages = warning;" -f "$MIG" >/dev/null
check "the migration re-runs cleanly (one column, one index)" \
  "$(q "select count(*) from information_schema.columns where table_name='generation_jobs' and column_name='tool_mode'")/$(q "select count(*) from pg_indexes where indexname='generation_jobs_ws_tool_mode_idx'")" "1/1"

echo "the mode of every kind of job"
m() { q "select coalesce(tool_mode,'∅') from public.generation_jobs where id = $1"; }
check "Retusz (operation)" "$(m 1)" "retouch"
check "Retusz (operation + slot)" "$(m 2)" "retouch"
check "Miniaturka" "$(m 3)" "ecommerce_thumbnail"
check "GrovBase Shot V2 order" "$(m 4)" "prompts"
check "GrovBase Shot 1.0 concept (slot prompts)" "$(m 5)" "prompts"
check "Stwórz zdjęcie (slot generator)" "$(m 6)" "generator"
check "Stwórz zdjęcie before slots (custom origin)" "$(m 7)" "generator"
check "GrovBase Shot 1.0 before slots (prompt session)" "$(m 8)" "prompts"
check "nothing identifies it → no mode (library only)" "$(m 9)" "∅"
check "a Moda tool" "$(m 10)" "fashion_iron"
check "Workflow ON run (operation = tool key)" "$(m 11)" "prompts"
check "an admin's workflow test → no mode" "$(m 12)" "∅"
check "a malformed slot is ignored, the next rule decides" "$(m 13)" "generator"
check "an engine concept without a session" "$(m 14)" "prompts"
check "a tool's own operation outranks a slot" "$(m 15)" "retouch"

echo "derived, never written"
q "update public.generation_jobs set settings = '{\"slot\":{\"tool\":\"generator\"},\"attempts\":2}' where id = 9" >/dev/null
check "a later settings update re-derives the mode" "$(m 9)" "generator"
err=$("${PSQL[@]}" -c "update public.generation_jobs set tool_mode = 'retouch' where id = 6" 2>&1 || true)
check "nobody can write the column" "$(echo "$err" | grep -c 'generated')" "1"
check "no other column of any row changed (credits, settings, origin)" \
  "$(q "select count(*) from public.generation_jobs j join snapshot s using (id) where j.id <> 9 and (j.credits_charged, j.settings, j.prompt_origin) is distinct from (s.credits_charged, s.settings, s.prompt_origin)")" "0"

echo
if [ "$fails" -eq 0 ]; then echo "All gallery tool-mode SQL tests passed."; else echo "$fails FAILED"; exit 1; fi
