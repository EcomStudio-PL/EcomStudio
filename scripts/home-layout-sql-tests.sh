#!/usr/bin/env bash
#
# /HOME LAYOUT (0170), PROVEN AGAINST A REAL POSTGRES.
#
# 0170 is loaded VERBATIM (twice: it must re-run cleanly) on the shape of the
# tables it touches (is_admin from 0002; content_versions as 0155 left it).
# What has to hold:
#   · only an admin writes, and only through home_layout_write (no direct
#     insert/update for a member, no read of the table for a member);
#   · a signed-in member reads the published document (and nothing else);
#   · compare-and-set: a stale or missing base is refused, nothing written;
#   · every write leaves ONE history row (target layout) with before/after —
#     so "Cofnij" can restore the exact earlier document;
#   · a write that changes nothing is refused (noop), a bad document too;
#   · the earlier history targets (text, slot, cms, faq) are still accepted.
#
#   bash scripts/pg-harness-up.sh && npm run test:homelayout:sql
set -euo pipefail

PGSOCK="${PGSOCK:-/tmp/pgtest}"
PGPORT="${PGPORT:-5433}"
DB="${HOMELAYOUT_DB:-home_layout_sqltest}"
PSQL0=(psql -h "$PGSOCK" -p "$PGPORT" -U postgres -v ON_ERROR_STOP=1 -X -q -t -A)
PSQL=("${PSQL0[@]}" -d "$DB")

if ! "${PSQL0[@]}" -d postgres -c 'select 1' >/dev/null 2>&1; then
  echo "homelayout-sql: no harness on $PGSOCK:$PGPORT — run: bash scripts/pg-harness-up.sh" >&2
  exit 2
fi
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
M="$ROOT/supabase/migrations"
MIG="$M/0170_home_layout.sql"
extract() { awk -v start="^create (or replace )?function public[.]$2[(]" -v stop="$3" '$0 ~ start {on=1} on {print} on && $0 ~ stop {exit}' "$1"; }
IS_ADMIN=$(extract "$M/0002_functions_and_triggers.sql" is_admin '^[$][$];')
[ -n "$IS_ADMIN" ] || { echo "homelayout-sql: could not extract is_admin" >&2; exit 2; }

cleanup() { [ "${KEEP_DB:-0}" = "1" ] || "${PSQL0[@]}" -d postgres -c "drop database if exists $DB with (force)" >/dev/null 2>&1 || true; }
trap cleanup EXIT
PGOPTIONS="-c client_min_messages=warning" "${PSQL0[@]}" -d postgres -c "drop database if exists $DB with (force)" >/dev/null
"${PSQL0[@]}" -d postgres -c "create database $DB" >/dev/null

fails=0
check() { if [ "$2" = "$3" ]; then echo "  ✓ $1"; else echo "  ✗ $1 — got [$2], expected [$3]"; fails=$((fails+1)); fi; }
q() { "${PSQL[@]}" -c "$1"; }
as_user() { "${PSQL[@]}" -c "set role authenticated; set request.jwt.claim.sub = '$1'; $2" 2>&1 | sed -n 's/^.*ERROR:  //p;/ERROR/!p' | head -1; }

UA=00000000-0000-0000-0000-00000000000a
U1=00000000-0000-0000-0000-000000000001

"${PSQL[@]}" >/dev/null <<SQL
set client_min_messages = warning;
create schema auth;
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end \$\$;
grant usage on schema public, auth to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
create function auth.uid() returns uuid language sql stable as
  \$f\$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid \$f\$;
create table public.profiles (id uuid primary key, role text not null default 'user');
insert into public.profiles values ('$UA', 'admin'), ('$U1', 'user');
$IS_ADMIN
create table public.content_versions (
  id uuid primary key default gen_random_uuid(),
  target text not null, key text not null, locale text, action text not null,
  before jsonb, after jsonb, created_at timestamptz not null default now(), created_by uuid);
alter table public.content_versions add constraint content_versions_target_check check (target in ('text', 'slot', 'cms', 'faq'));
insert into public.content_versions (target, key, action) values ('faq', 'faq:item:x', 'save');
SQL

echo "0170 — loaded verbatim, twice"
"${PSQL[@]}" -c "set client_min_messages = warning;" -f "$MIG" >/dev/null
"${PSQL[@]}" -c "set client_min_messages = warning;" -f "$MIG" >/dev/null
check "re-runs cleanly: one table, both functions, the earlier history kept" \
  "$(q "select count(*) from pg_tables where tablename='home_layout'")/$(q "select count(*) from pg_proc where proname in ('home_layout_write','home_layout_published')")/$(q "select count(*) from content_versions where target='faq'")" "1/2/1"

DOC1='{"v":1,"sections":[{"id":"carousel","hidden":true}]}'
DOC2='{"v":1,"sections":[{"id":"carousel"}]}'

echo "who may write"
check "a member cannot write through the function" "$(as_user $U1 "select public.home_layout_write('$DOC1'::jsonb, null, 'save')")" "not_admin"
check "a member cannot insert into the table directly" "$(as_user $U1 "insert into public.home_layout (doc) values ('$DOC1'::jsonb)" | grep -c 'permission denied\|row-level security')" "1"
check "a member reads nothing while no layout exists (default page)" "$(as_user $U1 "select coalesce(public.home_layout_published()::text, 'null')")" "null"

echo "writes, compare-and-set, history"
r1=$(as_user $UA "select public.home_layout_write('$DOC1'::jsonb, null, 'save')->>'updated_at'")
check "the admin's first write (base null) is accepted" "$([ -n "$r1" ] && echo ok)" "ok"
check "a member reads the published document" "$(as_user $U1 "select public.home_layout_published()->'doc'->'sections'->0->>'hidden'")" "true"
check "a member cannot read the table itself (only the document, through the function)" "$(as_user $U1 "select count(*) from public.home_layout")" "0"
check "a stale base (null) is a conflict and writes nothing" "$(as_user $UA "select public.home_layout_write('$DOC2'::jsonb, null, 'save')")" "conflict"
check "…a wrong base too" "$(as_user $UA "select public.home_layout_write('$DOC2'::jsonb, '2000-01-01'::timestamptz, 'save')")" "conflict"
check "the same document again is a noop" "$(as_user $UA "select public.home_layout_write('$DOC1'::jsonb, '$r1'::timestamptz, 'save')")" "noop"
r2=$(as_user $UA "select public.home_layout_write('$DOC2'::jsonb, '$r1'::timestamptz, 'save')->>'updated_at'")
check "with the current base the next change is accepted" "$([ -n "$r2" ] && echo ok)" "ok"
check "two writes = two history rows (target layout, who, before/after)" \
  "$(q "select count(*) from content_versions where target='layout' and key='home' and created_by='$UA'")" "2"
check "the second row's BEFORE is exactly the first document (what Cofnij restores)" \
  "$(q "select (before->'doc') = '$DOC1'::jsonb from content_versions where target='layout' order by created_at desc limit 1")" "t"
check "restoring it is a 'restore' write with its own history row" \
  "$(as_user $UA "select (public.home_layout_write('$DOC1'::jsonb, '$r2'::timestamptz, 'restore') ? 'updated_at')::text")/$(q "select action from content_versions where target='layout' order by created_at desc limit 1")" "true/restore"
check "a bad document is refused" "$(as_user $UA "select public.home_layout_write('[1]'::jsonb, null, 'save')")" "bad_input"
check "an unknown action is refused" "$(as_user $UA "select public.home_layout_write('$DOC1'::jsonb, null, 'drop')")" "bad_action"
check "the earlier history targets still insert (text, slot, cms, faq)" \
  "$(q "insert into content_versions (target, key, action) values ('text','a.b','save'),('slot','s','save'),('cms','c','save'),('faq','f','save') returning 1" | wc -l | tr -d ' ')" "4"

echo
if [ "$fails" -eq 0 ]; then echo "All home layout SQL tests passed."; else echo "$fails FAILED"; exit 1; fi
