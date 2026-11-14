#!/usr/bin/env bash
#
# PLANY V3 — THE PLAN CARDS' FEATURE LINES (0179), PROVEN AGAINST A REAL POSTGRES.
#
# 0179 is loaded VERBATIM (twice: it must re-run cleanly) on the shape of the
# tables it touches (is_admin from 0002; content_versions as 0170 left it;
# subscription_plans with PROD's four paid rows and the free one). What has to
# hold:
#   · only an admin writes, and only through pricing_cards_write — a customer
#     (signed in) and a visitor (anon) are refused, directly and through it;
#   · anyone — a visitor too — reads the PUBLISHED document and nothing else
#     (not the table, not who changed it);
#   · compare-and-set: a stale or missing base is refused and writes nothing;
#   · every write leaves ONE history row (target pricing) with before/after,
#     so a change — a deletion included — can be restored after a refresh;
#   · a write that changes nothing is refused (noop), a malformed document too;
#   · the earlier history targets still insert; nothing in subscription_plans
#     (prices, credits, capabilities) changes, whatever is written.
#
#   bash scripts/pg-harness-up.sh && npm run test:pricingcards:sql
set -euo pipefail

PGSOCK="${PGSOCK:-/tmp/pgtest}"
PGPORT="${PGPORT:-5433}"
DB="${PRICINGCARDS_DB:-pricing_cards_sqltest}"
PSQL0=(psql -h "$PGSOCK" -p "$PGPORT" -U postgres -v ON_ERROR_STOP=1 -X -q -t -A)
PSQL=("${PSQL0[@]}" -d "$DB")

if ! "${PSQL0[@]}" -d postgres -c 'select 1' >/dev/null 2>&1; then
  echo "pricingcards-sql: no harness on $PGSOCK:$PGPORT — run: bash scripts/pg-harness-up.sh" >&2
  exit 2
fi
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
M="$ROOT/supabase/migrations"
MIG="$M/0179_pricing_cards.sql"
extract() { awk -v start="^create (or replace )?function public[.]$2[(]" -v stop="$3" '$0 ~ start {on=1} on {print} on && $0 ~ stop {exit}' "$1"; }
IS_ADMIN=$(extract "$M/0002_functions_and_triggers.sql" is_admin '^[$][$];')
[ -n "$IS_ADMIN" ] || { echo "pricingcards-sql: could not extract is_admin" >&2; exit 2; }

cleanup() { [ "${KEEP_DB:-0}" = "1" ] || "${PSQL0[@]}" -d postgres -c "drop database if exists $DB with (force)" >/dev/null 2>&1 || true; }
trap cleanup EXIT
PGOPTIONS="-c client_min_messages=warning" "${PSQL0[@]}" -d postgres -c "drop database if exists $DB with (force)" >/dev/null
"${PSQL0[@]}" -d postgres -c "create database $DB" >/dev/null

fails=0
check() { if [ "$2" = "$3" ]; then echo "  ✓ $1"; else echo "  ✗ $1 — got [$2], expected [$3]"; fails=$((fails+1)); fi; }
q() { "${PSQL[@]}" -c "$1"; }
as_user() { "${PSQL[@]}" -c "set role authenticated; set request.jwt.claim.sub = '$1'; $2" 2>&1 | sed -n 's/^.*ERROR:  //p;/ERROR/!p' | head -1; }
as_anon() { "${PSQL[@]}" -c "set role anon; $1" 2>&1 | sed -n 's/^.*ERROR:  //p;/ERROR/!p' | head -1; }

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
alter table public.content_versions add constraint content_versions_target_check check (target in ('text', 'slot', 'cms', 'faq', 'layout'));
insert into public.content_versions (target, key, action) values ('layout', 'home', 'save');
-- PROD's catalogue (13.11.2026), to prove the document never reaches it.
create table public.subscription_plans (slug text primary key, price_cents int, annual_price_cents int, monthly_credits int, features jsonb);
insert into public.subscription_plans values
  ('free', 0, 0, 25, '{"products":5,"workspace_members":1}'),
  ('mini', 990, 9900, 20, '{"products":20,"workspace_members":1}'),
  ('starter', 2490, 24900, 55, '{"products":50,"workspace_members":2}'),
  ('pro', 4990, 49900, 125, '{"products":500,"priority_queue":true,"workspace_members":5}'),
  ('agency', 10990, 109900, 290, '{"products":-1,"operator_mode":true,"priority_queue":true,"workspace_members":-1}');
SQL
PLANS_BEFORE=$(q "select md5(string_agg(slug || price_cents || annual_price_cents || monthly_credits || features::text, ',' order by slug)) from public.subscription_plans")

echo "0179 — loaded verbatim, twice"
"${PSQL[@]}" -c "set client_min_messages = warning;" -f "$MIG" >/dev/null
"${PSQL[@]}" -c "set client_min_messages = warning;" -f "$MIG" >/dev/null
check "re-runs cleanly: one table, both functions, the earlier history kept" \
  "$(q "select count(*) from pg_tables where tablename='pricing_cards'")/$(q "select count(*) from pg_proc where proname in ('pricing_cards_write','pricing_cards_published')")/$(q "select count(*) from content_versions where target='layout'")" "1/2/1"
check "no row after the migration: the cards render the code default" "$(q "select count(*) from public.pricing_cards")" "0"

# PRO: the 'Priorytet' highlight renamed; Starter: the custom-less tools group hidden.
DOC1='{"v":1,"plans":{"pro":{"groups":[{"id":"highlights","items":[{"id":"f:noExpiry","feature":"noExpiry","status":"auto"}]},{"id":"tools","items":[]},{"id":"output","items":[]},{"id":"team","items":[]},{"id":"support","items":[]}]}}}'
DOC2='{"v":1,"plans":{"pro":{"groups":[{"id":"highlights","items":[{"id":"f:noExpiry","feature":"noExpiry","status":"auto","label":{"pl":"Kredyty bez daty ważności"}}]},{"id":"tools","items":[]},{"id":"output","items":[]},{"id":"team","items":[]},{"id":"support","items":[]}]}}}'

echo "who may write and read"
check "a customer cannot write through the function" "$(as_user $U1 "select public.pricing_cards_write('$DOC1'::jsonb, null, 'save')")" "not_admin"
check "a visitor cannot call the writer at all" "$(as_anon "select public.pricing_cards_write('$DOC1'::jsonb, null, 'save')" | grep -c 'permission denied')" "1"
check "a customer cannot insert into the table directly" "$(as_user $U1 "insert into public.pricing_cards (doc) values ('$DOC1'::jsonb)" | grep -c 'permission denied\|row-level security')" "1"
check "a visitor cannot insert into the table directly" "$(as_anon "insert into public.pricing_cards (doc) values ('$DOC1'::jsonb)" | grep -c 'permission denied\|row-level security')" "1"
check "a visitor reads nothing while no document exists (default cards)" "$(as_anon "select coalesce(public.pricing_cards_published()::text, 'null')")" "null"

echo "writes, compare-and-set, history"
r1=$(as_user $UA "select public.pricing_cards_write('$DOC1'::jsonb, null, 'save')->>'updated_at'")
check "the admin's first write (base null) is accepted" "$([ -n "$r1" ] && echo ok)" "ok"
check "a visitor reads the published document" "$(as_anon "select jsonb_array_length(public.pricing_cards_published()->'doc'->'plans'->'pro'->'groups')")" "5"
check "…and only the document (no author, no time)" "$(as_anon "select string_agg(k, ',') from jsonb_object_keys(public.pricing_cards_published()) k")" "doc"
check "a customer cannot read the table itself" "$(as_user $U1 "select count(*) from public.pricing_cards")" "0"
check "a visitor cannot read the table itself" "$(as_anon "select count(*) from public.pricing_cards" | grep -c 'permission denied\|^0$')" "1"
check "a stale base (null) is a conflict and writes nothing" "$(as_user $UA "select public.pricing_cards_write('$DOC2'::jsonb, null, 'save')")" "conflict"
check "…a wrong base too" "$(as_user $UA "select public.pricing_cards_write('$DOC2'::jsonb, '2000-01-01'::timestamptz, 'save')")" "conflict"
check "the same document again is a noop" "$(as_user $UA "select public.pricing_cards_write('$DOC1'::jsonb, '$r1'::timestamptz, 'save')")" "noop"
r2=$(as_user $UA "select public.pricing_cards_write('$DOC2'::jsonb, '$r1'::timestamptz, 'save')->>'updated_at'")
check "with the current base the next change is accepted" "$([ -n "$r2" ] && echo ok)" "ok"
check "two writes = two history rows (target pricing, key cards, who)" \
  "$(q "select count(*) from content_versions where target='pricing' and key='cards' and created_by='$UA'")" "2"
check "the second row's BEFORE is exactly the first document (what a restore brings back)" \
  "$(q "select (before->'doc') = '$DOC1'::jsonb from content_versions where target='pricing' order by created_at desc limit 1")" "t"
check "the published document survives a new session (a refresh)" \
  "$(as_anon "select public.pricing_cards_published()->'doc'->'plans'->'pro'->'groups'->0->'items'->0->'label'->>'pl'")" "Kredyty bez daty ważności"
r3=$(as_user $UA "select public.pricing_cards_write('$DOC1'::jsonb, '$r2'::timestamptz, 'restore')->>'updated_at'")
check "restoring the earlier state is a 'restore' write with its own history row" \
  "$([ -n "$r3" ] && echo ok)/$(q "select action from content_versions where target='pricing' order by created_at desc limit 1")" "ok/restore"
check "…and the page reads the restored words again" \
  "$(as_anon "select coalesce(public.pricing_cards_published()->'doc'->'plans'->'pro'->'groups'->0->'items'->0->'label'->>'pl', 'default')")" "default"
check "back to the code default: an empty document is a valid write" \
  "$(as_user $UA "select (public.pricing_cards_write('{\"v\":1,\"plans\":{}}'::jsonb, '$r3'::timestamptz, 'restore') ? 'updated_at')::text")" "true"

echo "refusals"
check "a document that is not v1 is refused" "$(as_user $UA "select public.pricing_cards_write('{\"v\":2,\"plans\":{}}'::jsonb, null, 'save')")" "bad_input"
check "plans that are not an object are refused" "$(as_user $UA "select public.pricing_cards_write('{\"v\":1,\"plans\":[]}'::jsonb, null, 'save')")" "bad_input"
check "an array is refused" "$(as_user $UA "select public.pricing_cards_write('[1]'::jsonb, null, 'save')")" "bad_input"
check "a document over the size cap is refused" \
  "$(as_user $UA "select public.pricing_cards_write(jsonb_build_object('v', 1, 'plans', jsonb_build_object('pro', repeat('x', 70000))), null, 'save')")" "bad_input"
check "an unknown action is refused" "$(as_user $UA "select public.pricing_cards_write('$DOC1'::jsonb, null, 'drop')")" "bad_action"

echo "nothing else moves"
check "the earlier history targets still insert (text, slot, cms, faq, layout)" \
  "$(q "insert into content_versions (target, key, action) values ('text','a.b','save'),('slot','s','save'),('cms','c','save'),('faq','f','save'),('layout','home','save') returning 1" | wc -l | tr -d ' ')" "5"
check "an unknown history target is still refused" "$(q "insert into content_versions (target, key, action) values ('plans','x','save')" 2>&1 | grep -c 'content_versions_target_check')" "1"
check "subscription_plans (prices, credits, capabilities) unchanged by every write" \
  "$(q "select md5(string_agg(slug || price_cents || annual_price_cents || monthly_credits || features::text, ',' order by slug)) from public.subscription_plans")" "$PLANS_BEFORE"

echo
if [ "$fails" -eq 0 ]; then echo "All pricing cards SQL tests passed."; else echo "$fails FAILED"; exit 1; fi
