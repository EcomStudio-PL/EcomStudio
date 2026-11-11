#!/usr/bin/env bash
#
# PREMIERA VISIBILITY (0172), PROVEN AGAINST A REAL POSTGRES.
#
# The table is created by 0060 itself; production's rows and /tools layout
# flags (as read before the launch) are seeded; 0172 is loaded VERBATIM, twice.
# What has to hold:
#   · every tool outside the launch four is DISABLED; the launch rows and every
#     other untouched row keep exactly what they had (messages, windows, flags);
#   · image_ecommerce only loses its menu entry (hidden_from_menu), stays open;
#   · „Stwórz zdjęcie” (custom) gets its menu switch, no other layout key moves;
#   · the backup is the table as it was, taken ONCE (a re-run never replaces it);
#   · the restore quoted in the migration's header brings back the exact
#     previous table and flag.
#
#   bash scripts/pg-harness-up.sh && npm run test:launch:sql
set -euo pipefail

PGSOCK="${PGSOCK:-/tmp/pgtest}"
PGPORT="${PGPORT:-5433}"
DB="${LAUNCH_DB:-launch_visibility_sqltest}"
PSQL0=(psql -h "$PGSOCK" -p "$PGPORT" -U postgres -v ON_ERROR_STOP=1 -X -q -t -A)
PSQL=("${PSQL0[@]}" -d "$DB")

if ! "${PSQL0[@]}" -d postgres -c 'select 1' >/dev/null 2>&1; then
  echo "launch-sql: no harness on $PGSOCK:$PGPORT — run: bash scripts/pg-harness-up.sh" >&2
  exit 2
fi
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
M="$ROOT/supabase/migrations"
MIG="$M/0172_launch_tool_visibility.sql"
TABLE=$(awk '/^create table if not exists public.feature_availability/{on=1} on{print} on && /^\);/{exit}' "$M/0060_feature_availability.sql")
[ -n "$TABLE" ] || { echo "launch-sql: could not extract the 0060 table" >&2; exit 2; }
# The restore block, exactly as the migration's header documents it.
RESTORE=$(awk '/^--   delete from public.feature_availability;/{on=1} on && /^--$/{exit} on{sub(/^--   ?/, ""); print}' "$MIG")
[ -n "$RESTORE" ] || { echo "launch-sql: could not extract the restore block" >&2; exit 2; }

cleanup() { [ "${KEEP_DB:-0}" = "1" ] || "${PSQL0[@]}" -d postgres -c "drop database if exists $DB with (force)" >/dev/null 2>&1 || true; }
trap cleanup EXIT
PGOPTIONS="-c client_min_messages=warning" "${PSQL0[@]}" -d postgres -c "drop database if exists $DB with (force)" >/dev/null
"${PSQL0[@]}" -d postgres -c "create database $DB" >/dev/null

fails=0
check() { if [ "$2" = "$3" ]; then echo "  ✓ $1"; else echo "  ✗ $1 — got [$2], expected [$3]"; fails=$((fails+1)); fi; }
q() { "${PSQL[@]}" -c "$1"; }

"${PSQL[@]}" >/dev/null <<SQL
set client_min_messages = warning;
create schema auth;
create table auth.users (id uuid primary key);
$TABLE
create table public.app_settings (key text primary key, value jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now());
-- Production before the launch (read 2026-11-11), one row with a message to prove it survives.
insert into public.feature_availability (feature_key, status, hidden_from_menu, custom_message, updated_at) values
  ('compress','ACTIVE',false,null,'2026-09-06'), ('editor','ACTIVE',false,null,'2026-09-06'), ('generator','ACTIVE',false,null,'2026-09-06'),
  ('image_inne','COMING_SOON',false,null,'2026-09-06'), ('image_mailing','COMING_SOON',false,null,'2026-09-06'),
  ('image_social','COMING_SOON',false,null,'2026-09-06'), ('inspirations','ACTIVE',false,null,'2026-09-06'),
  ('library','ACTIVE',false,null,'2026-09-06'), ('products','DISABLED',false,null,'2026-09-10'), ('prompts','ACTIVE',false,null,'2026-09-06'),
  ('resize','ACTIVE',false,null,'2026-09-06'), ('retouch','ACTIVE',false,'kept message','2026-09-06'),
  ('tool_ai_background','ACTIVE',false,null,'2026-10-10'), ('tool_ai_shadow','ACTIVE',false,null,'2026-10-10'),
  ('tool_remove_bg','ACTIVE',false,null,'2026-10-10'), ('tool_white_bg','ACTIVE',false,null,'2026-10-10'),
  ('tools','ACTIVE',false,null,'2026-09-06'), ('video','COMING_SOON',false,null,'2026-09-06');
insert into public.app_settings (key, value, updated_at) values ('tools_layout', jsonb_build_object('v', 1, 'sections', '[]'::jsonb, 'flags', jsonb_build_object(
  'generator', '{"menu":true,"start":true,"tools":true}'::jsonb, 'custom', '{"menu":false,"start":true,"tools":true}'::jsonb,
  'retouch', '{"menu":true,"start":true,"tools":true}'::jsonb, 'editor', '{"menu":true,"start":false,"tools":true}'::jsonb)), '2026-10-15');
create table snapshot as select * from public.feature_availability;
create table layout_before as select value from public.app_settings where key = 'tools_layout';
SQL

echo "0172 — loaded verbatim, twice"
"${PSQL[@]}" -1 -c "set client_min_messages = warning;" -f "$MIG" >/dev/null
FIRST_BACKUP=$(q "select md5(value::text) from public.app_settings where key = 'launch_visibility_backup_0172'")
"${PSQL[@]}" -1 -c "set client_min_messages = warning;" -f "$MIG" >/dev/null
check "re-runs cleanly and keeps the FIRST backup" "$(q "select md5(value::text) from public.app_settings where key = 'launch_visibility_backup_0172'")" "$FIRST_BACKUP"

echo "the switchboard after 0172"
check "30 tools are DISABLED" "$(q "select count(*) from public.feature_availability where status = 'DISABLED' and feature_key <> 'products'")" "30"
check "the launch four keep ACTIVE (and the retouch message)" "$(q "select string_agg(feature_key || ':' || status, ',' order by feature_key) from public.feature_availability where feature_key in ('prompts','generator','retouch')") $(q "select custom_message from public.feature_availability where feature_key = 'retouch'")" "generator:ACTIVE,prompts:ACTIVE,retouch:ACTIVE kept message"
check "Miniaturka has no row (default ACTIVE) and its category stays open, only off the menus" "$(q "select count(*) from public.feature_availability where feature_key = 'ecommerce_thumbnail'")/$(q "select status || ':' || hidden_from_menu from public.feature_availability where feature_key = 'image_ecommerce'")" "0/ACTIVE:true"
check "the old e-commerce packshot is DISABLED, its row separate from retouch" "$(q "select status from public.feature_availability where feature_key = 'ecommerce_packshot'")" "DISABLED"
check "video is DISABLED (the menu disappears for customers)" "$(q "select status from public.feature_availability where feature_key = 'video'")" "DISABLED"
check "rows not on the list are untouched (inspirations, library, tools, products)" "$(q "select count(*) from public.feature_availability f join snapshot s using (feature_key) where f.feature_key in ('inspirations','library','tools','products') and (f.status, f.hidden_from_menu, f.updated_at) = (s.status, s.hidden_from_menu, s.updated_at)")" "4"
check "„Stwórz zdjęcie” is in the menu" "$(q "select value->'flags'->'custom'->>'menu' from public.app_settings where key = 'tools_layout'")" "true"
check "…and nothing else in the layout moved" "$(q "select (select value from public.app_settings where key = 'tools_layout') #- '{flags,custom,menu}' = (select value from layout_before) #- '{flags,custom,menu}'")" "t"

echo "the backup and the restore"
check "the backup holds the table as it was (18 rows)" "$(q "select jsonb_array_length(value->'feature_availability') from public.app_settings where key = 'launch_visibility_backup_0172'")" "18"
check "…and the custom flags as they were" "$(q "select value->'tools_layout_custom'->>'menu' from public.app_settings where key = 'launch_visibility_backup_0172'")" "false"
"${PSQL[@]}" -c "set client_min_messages = warning; $RESTORE" >/dev/null
check "the documented restore brings back the exact previous table" "$(q "select count(*) from (select * from public.feature_availability except select * from snapshot) d")/$(q "select count(*) from (select * from snapshot except select * from public.feature_availability) d")/$(q "select count(*) from public.feature_availability")" "0/0/18"
check "…and the custom flag" "$(q "select value->'flags'->'custom'->>'menu' from public.app_settings where key = 'tools_layout'")" "false"

if [ "$fails" -gt 0 ]; then echo "$fails LAUNCH SQL TEST(S) FAILED"; exit 1; fi
echo "All launch visibility SQL tests passed."
