#!/usr/bin/env bash
#
# GEMINI MODEL IDS — migration 0131 proven on a real Postgres.
#
# 0131 is loaded VERBATIM on a model catalogue shaped like production's
# (ai_providers, ai_models with the unique (provider_id, model_identifier)
# index, tool assignments referencing model ROWS, app_settings.generation).
#
# Proves: "Nano Banana Pro" moves from the preview to gemini-3-pro-image and
# "Nano Banana 2" to gemini-3.1-flash-image IN PLACE (same row ids, so tool
# assignments, prices and job history stay attached; no row added, none
# removed); the priority list follows the rows in order; applying twice
# changes nothing; a database without Google, or already on the GA ids, or
# seeded differently, is left alone without a unique-index error.
#
#   bash scripts/pg-harness-up.sh && npm run test:geminiids:sql
set -euo pipefail

PGSOCK="${PGSOCK:-/tmp/pgtest}"
PGPORT="${PGPORT:-5433}"
DB=geminiids
PSQL0=(psql -h "$PGSOCK" -p "$PGPORT" -U postgres -v ON_ERROR_STOP=1 -X -q -t -A)
PSQL=("${PSQL0[@]}" -d "$DB")

if ! "${PSQL0[@]}" -d postgres -c 'select 1' >/dev/null 2>&1; then
  echo "geminiids-sql: no harness on $PGSOCK:$PGPORT — run: bash scripts/pg-harness-up.sh" >&2
  exit 2
fi
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATION="$ROOT/supabase/migrations/0131_gemini_stable_model_ids.sql"

fails=0
check() { if [ "$2" = "$3" ]; then echo "  ✓ $1"; else echo "  ✗ $1 — got [$2], expected [$3]"; fails=$((fails+1)); fi; }
q() { "${PSQL[@]}" -c "$1"; }

schema() {
  "${PSQL0[@]}" -d postgres -c "drop database if exists $DB" >/dev/null
  "${PSQL0[@]}" -d postgres -c "create database $DB" >/dev/null
  "${PSQL[@]}" >/dev/null <<'SQL'
create table public.ai_providers (id uuid primary key, slug text unique not null);
create table public.ai_models (
  id uuid primary key, provider_id uuid not null references public.ai_providers(id),
  model_identifier text not null, name text, display_name text, pricing jsonb, credit_cost int,
  unique (provider_id, model_identifier)
);
create table public.ai_tool_models (tool_key text, role text, model_id uuid references public.ai_models(id));
create table public.app_settings (key text primary key, value jsonb not null);
SQL
}
seed_prod() {
  "${PSQL[@]}" >/dev/null <<'SQL'
insert into public.ai_providers values
  ('21bf97a3-e745-4dfa-bb48-9d2298c9f66e', 'google'), ('00000000-0000-0000-0000-00000000000a', 'openai');
insert into public.ai_models values
  ('70fe4bee-f2d1-491e-9161-6e0c8f2166c2', '21bf97a3-e745-4dfa-bb48-9d2298c9f66e', 'gemini-3-pro-image-preview', 'Nano Banana Pro', 'Nano Banana Pro', '{"1K":7,"2K":7,"4K":12}', 7),
  ('61314bc2-3e10-4d65-8988-936e799f4449', '21bf97a3-e745-4dfa-bb48-9d2298c9f66e', 'gemini-3-pro-image', 'Nano Banana 2', 'Nano Banana 2', '{"1K":4,"2K":5,"4K":8}', 4),
  ('64917127-0000-0000-0000-000000000000', '21bf97a3-e745-4dfa-bb48-9d2298c9f66e', 'gemini-2.5-flash-image', 'Nano Banana', 'Nano Banana', '{"1K":2}', 2),
  ('cdcf4ac8-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000a', 'gpt-image-2', 'GPT Image 2', 'GPT Image 2', '{}', 5);
insert into public.ai_tool_models values
  ('retouch', 'primary', '70fe4bee-f2d1-491e-9161-6e0c8f2166c2'),
  ('prompts', 'primary', 'cdcf4ac8-0000-0000-0000-000000000000'),
  ('prompts', 'fallback', '70fe4bee-f2d1-491e-9161-6e0c8f2166c2');
insert into public.app_settings values ('generation',
  '{"default_format":"1:1","provider_priority":["openai:gpt-image-2","google:gemini-3-pro-image-preview","google:gemini-3-pro-image"],"planner_provider":"openai"}');
SQL
}
apply() { "${PSQL[@]}" -f "$MIGRATION" >/dev/null; }

echo "A. production-shaped catalogue"
schema; seed_prod
BEFORE=$(q "select count(*) from public.ai_models")
apply
check "Nano Banana Pro row (same id) now calls gemini-3-pro-image" \
  "$(q "select model_identifier from public.ai_models where id='70fe4bee-f2d1-491e-9161-6e0c8f2166c2'")" "gemini-3-pro-image"
check "Nano Banana 2 row (same id) now calls gemini-3.1-flash-image" \
  "$(q "select model_identifier from public.ai_models where id='61314bc2-3e10-4d65-8988-936e799f4449'")" "gemini-3.1-flash-image"
check "2.5 Flash Image untouched" "$(q "select model_identifier from public.ai_models where id='64917127-0000-0000-0000-000000000000'")" "gemini-2.5-flash-image"
check "no row added or removed" "$(q "select count(*) from public.ai_models")" "$BEFORE"
check "no duplicate identifiers" "$(q "select count(*) from (select provider_id, model_identifier from public.ai_models group by 1,2 having count(*)>1) d")" "0"
check "prices stay with their rows" "$(q "select pricing->>'2K' from public.ai_models where id='70fe4bee-f2d1-491e-9161-6e0c8f2166c2'")" "7"
check "Retusz still assigned to the same row — now the GA id" \
  "$(q "select m.model_identifier from public.ai_tool_models t join public.ai_models m on m.id=t.model_id where t.tool_key='retouch'")" "gemini-3-pro-image"
check "priority list follows the rows, in order" \
  "$(q "select value->'provider_priority' from public.app_settings where key='generation'")" \
  '["openai:gpt-image-2", "google:gemini-3-pro-image", "google:gemini-3.1-flash-image"]'
check "other generation settings kept" "$(q "select value->>'planner_provider' from public.app_settings where key='generation'")" "openai"
SNAP=$(q "select string_agg(id||'='||model_identifier, ',' order by id) from public.ai_models")
PRIO=$(q "select value->'provider_priority' from public.app_settings where key='generation'")
apply
check "applying twice changes nothing (models)" "$(q "select string_agg(id||'='||model_identifier, ',' order by id) from public.ai_models")" "$SNAP"
check "applying twice changes nothing (priority)" "$(q "select value->'provider_priority' from public.app_settings where key='generation'")" "$PRIO"

echo "B. no Google provider"
schema
apply
check "applies cleanly on an empty catalogue" "$(q "select count(*) from public.ai_models")" "0"

echo "C. already on the GA id (fresh project seeded with the right ids)"
schema
"${PSQL[@]}" >/dev/null <<'SQL'
insert into public.ai_providers values ('21bf97a3-e745-4dfa-bb48-9d2298c9f66e', 'google');
insert into public.ai_models values
  ('11111111-0000-0000-0000-000000000000', '21bf97a3-e745-4dfa-bb48-9d2298c9f66e', 'gemini-3-pro-image', 'Nano Banana Pro', 'Nano Banana Pro', '{}', 7),
  ('22222222-0000-0000-0000-000000000000', '21bf97a3-e745-4dfa-bb48-9d2298c9f66e', 'gemini-3-pro-image-preview', 'Nano Banana Pro (preview)', 'Nano Banana Pro (preview)', '{}', 7);
insert into public.app_settings values ('generation', '{"provider_priority":["google:gemini-3-pro-image"]}');
SQL
apply
check "the GA row is not renamed (its name is not Nano Banana 2)" \
  "$(q "select model_identifier from public.ai_models where id='11111111-0000-0000-0000-000000000000'")" "gemini-3-pro-image"
check "the preview row is left alone rather than colliding with the GA id" \
  "$(q "select model_identifier from public.ai_models where id='22222222-0000-0000-0000-000000000000'")" "gemini-3-pro-image-preview"
check "priority list untouched when nothing moved" "$(q "select value->'provider_priority' from public.app_settings where key='generation'")" '["google:gemini-3-pro-image"]'

echo "D. no priority list stored"
schema; seed_prod
q "delete from public.app_settings" >/dev/null
apply
check "the rows still move" "$(q "select model_identifier from public.ai_models where id='70fe4bee-f2d1-491e-9161-6e0c8f2166c2'")" "gemini-3-pro-image"

"${PSQL0[@]}" -d postgres -c "drop database if exists $DB" >/dev/null
if [ "$fails" -gt 0 ]; then echo "$fails FAILED"; exit 1; fi
echo "All Gemini model-id migration tests passed."
