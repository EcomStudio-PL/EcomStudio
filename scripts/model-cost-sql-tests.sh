#!/usr/bin/env bash
#
# MODEL COST — migration 0133 proven on a real Postgres: the surcharge zeroed
# and pinned to 0, Nano Banana Pro's customer price (7/7/12) and Google's
# official per-image price (1K/2K $0.134, 4K $0.24) + the token row, and the
# recorder keeping thinking tokens, the base cost and the size of every call.
#
# 0127 and 0133 are loaded VERBATIM; from 0129 only what 0133 builds on (the
# unit price table and the cached-token column). Local harness only:
#
#   bash scripts/pg-harness-up.sh && npm run test:modelcost:sql
set -euo pipefail

PGSOCK="${PGSOCK:-/tmp/pgtest}"
PGPORT="${PGPORT:-5433}"
DB=modelcost
PSQL0=(psql -h "$PGSOCK" -p "$PGPORT" -U postgres -v ON_ERROR_STOP=1 -X -q -t -A)
PSQL=("${PSQL0[@]}" -d "$DB")

if ! "${PSQL0[@]}" -d postgres -c 'select 1' >/dev/null 2>&1; then
  echo "model-cost-sql: no harness on $PGSOCK:$PGPORT — run: bash scripts/pg-harness-up.sh" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
M=$ROOT/supabase/migrations
extract() { # file, function name, end marker regex
  awk -v start="^create (or replace )?function public[.]$2[(]" -v stop="$3" \
    '$0 ~ start {on=1} on {print} on && $0 ~ stop {exit}' "$1"
}
IS_ADMIN=$(extract "$M/0002_functions_and_triggers.sql" is_admin '^[$][$];')
SERVER_CALL_OK=$(extract "$M/0077_server_only_rpcs.sql" server_call_ok '^end [$][$];')
CMS_RESERVED=$(extract "$M/0125_grovnews_sources_daily.sql" cms_slug_is_reserved '^[$][$];')
UNIT_TABLE=$(awk '/^create table if not exists public.ai_unit_prices \(/{on=1} on {print} on && /^\);/{exit}' "$M/0129_workflow_engine_v2.sql")
for v in IS_ADMIN SERVER_CALL_OK CMS_RESERVED UNIT_TABLE; do
  [ -n "${!v}" ] || { echo "model-cost-sql: could not extract $v" >&2; exit 2; }
done

"${PSQL0[@]}" -d postgres -c "drop database if exists $DB" >/dev/null
"${PSQL0[@]}" -d postgres -c "create database $DB" >/dev/null

fails=0
check() { if [ "$2" = "$3" ]; then echo "  ✓ $1"; else echo "  ✗ $1 — got [$2], expected [$3]"; fails=$((fails+1)); fi; }
q() { "${PSQL[@]}" -c "$1"; }
err() {
  local out
  if out=$("${PSQL[@]}" -c "$1" 2>&1); then echo ok
  else echo "$out" | sed -n 's/^.*ERROR:  //p' | head -1; fi
}
TOKEN='the-right-dispatch-token'

"${PSQL[@]}" >/dev/null <<SQL
set check_function_bodies = off;
create schema auth;
create extension if not exists pgcrypto with schema public;
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end \$\$;
grant usage on schema public, auth to anon, authenticated;
create function auth.uid() returns uuid language sql stable as
  \$f\$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid \$f\$;
create table public.app_settings (key text primary key, value jsonb not null default '{}'::jsonb);
insert into public.app_settings values
  ('notifications', jsonb_build_object('dispatch_hash', encode(digest('$TOKEN', 'sha256'), 'hex'))),
  ('billing', '{"usd_to_pln":4,"buffer_percent":12,"credit_currency":"PLN","ecom_target_pln":10,"min_margin_percent":50,"price_per_100_credits":19}');
create table public.profiles (id uuid primary key, role text not null default 'user');
create table public.workspaces (id uuid primary key default gen_random_uuid());
create table public.usage_events (id uuid primary key default gen_random_uuid());
create table public.generation_jobs (id uuid primary key default gen_random_uuid());
create table public.ai_providers (id uuid primary key default gen_random_uuid(), slug text unique, active boolean default true);
create table public.ai_provider_credentials (
  id uuid primary key default gen_random_uuid(), provider_id uuid unique references public.ai_providers(id),
  last_tested_at timestamptz, last_test_status text);
-- ai_models as PROD holds it for this migration (the columns it touches).
create table public.ai_models (
  id uuid primary key default gen_random_uuid(), provider_id uuid references public.ai_providers(id),
  name text not null, display_name text, model_identifier text not null, type text not null default 'image',
  credit_cost integer not null default 1, pricing jsonb, internal_cost_usd_micros bigint not null default 0,
  ecom_surcharge_credits integer not null default 0);
$IS_ADMIN
$SERVER_CALL_OK
$CMS_RESERVED
SQL
"${PSQL[@]}" -f "$M/0127_ai_provider_calls.sql" >/dev/null
# What 0133 builds on from 0129.
"${PSQL[@]}" >/dev/null <<SQL
$UNIT_TABLE
alter table public.ai_provider_calls add column if not exists cached_input_tokens bigint;
alter table public.ai_token_prices add column if not exists cached_input_usd_micros_per_mtok bigint;
SQL

# PROD's rows before 0133 (read-only snapshot of 2026-09-29).
q "insert into public.ai_providers (slug) values ('google'), ('openai');
   insert into public.ai_provider_credentials (provider_id) select id from public.ai_providers;
   insert into public.ai_models (provider_id, name, display_name, model_identifier, credit_cost, pricing, internal_cost_usd_micros, ecom_surcharge_credits)
   select p.id, v.name, v.dn, v.mi, v.cc, v.pr::jsonb, v.ic, v.sur from (values
     ('google','Nano Banana Pro','Nano Banana Pro','gemini-3-pro-image',7,'{\"1K\":7,\"2K\":7,\"4K\":12}',39000,46),
     ('google','Nano Banana 2','Nano Banana 2','gemini-3.1-flash-image',4,'{\"1K\":4,\"2K\":5,\"4K\":8}',39000,49),
     ('openai','GPT Image 2','GPT Image 2','gpt-image-2',4,'{\"1K\":4,\"2K\":6}',40000,49),
     ('google','Some Legacy Row','Legacy','gemini-3-pro-image',3,'{\"1K\":3}',1,0)
   ) v(slug,name,dn,mi,cc,pr,ic,sur) join public.ai_providers p on p.slug = v.slug;" >/dev/null

"${PSQL[@]}" -f "$M/0133_model_cost_official_prices.sql" >/dev/null

echo "0133 — the GrovBase surcharge is gone"
check "every model's surcharge is 0" "$(q "select count(*) from public.ai_models where ecom_surcharge_credits <> 0")" "0"
check "the DB refuses to set it again" \
  "$(err "update public.ai_models set ecom_surcharge_credits = 46 where name = 'Nano Banana Pro'")" \
  'new row for relation "ai_models" violates check constraint "ai_models_no_engine_surcharge"'
check "the 10 zł target is removed from billing, everything else kept" \
  "$(q "select (not (value ? 'ecom_target_pln'))::text||':'||(value->>'usd_to_pln')||':'||(value->>'price_per_100_credits') from public.app_settings where key='billing'")" "true:4:19"

echo "0133 — Nano Banana Pro: customer price and Google's official price"
check "customer price 1K 7 · 2K 7 · 4K 12" "$(q "select pricing->>'1K'||'/'||(pricing->>'2K')||'/'||(pricing->>'4K')||' cc='||credit_cost from public.ai_models where name='Nano Banana Pro'")" "7/7/12 cc=7"
check "flat per-image cost is the 1K/2K official price, not \$0.039" "$(q "select internal_cost_usd_micros from public.ai_models where name='Nano Banana Pro'")" "134000"
check "a row that merely shares the id (not Nano Banana Pro) is left alone" "$(q "select credit_cost||':'||internal_cost_usd_micros from public.ai_models where name='Some Legacy Row'")" "3:1"
check "other models keep their prices (only the surcharge changed)" "$(q "select credit_cost||':'||internal_cost_usd_micros from public.ai_models where name='Nano Banana 2'")" "4:39000"
check "official per-image prices 1K/2K/4K" \
  "$(q "select string_agg(resolution||'='||usd_micros_per_unit, ' ' order by resolution) from public.ai_unit_prices where provider_slug='google' and model='gemini-3-pro-image' and unit_kind='image' and quality='*'")" \
  "1K=134000 2K=134000 4K=240000"
check "token price: input \$2/1M, thinking \$12/1M" \
  "$(q "select input_usd_micros_per_mtok||'/'||output_usd_micros_per_mtok from public.ai_token_prices where provider_slug='google' and model='gemini-3-pro-image'")" "2000000/12000000"

echo "0133 — the recorder keeps the breakdown"
UE=$(q "insert into public.usage_events default values returning id")
N=$(q "select public.ai_provider_call_record('$TOKEN', '[
  {\"actor_kind\":\"customer\",\"consumer\":\"generation\",\"tool_key\":\"retouch\",\"usage_event_id\":\"$UE\",\"provider_slug\":\"google\",\"model\":\"gemini-3-pro-image\",\"status\":\"succeeded\",\"units\":1,\"unit_kind\":\"image\",\"resolution\":\"1K\",\"input_tokens\":700,\"output_tokens\":1330,\"thought_tokens\":210,\"cost_basis\":\"estimated\",\"cost_usd_micros\":137920,\"base_cost_usd_micros\":134000,\"duration_ms\":8000},
  {\"actor_kind\":\"customer\",\"consumer\":\"generation\",\"provider_slug\":\"google\",\"model\":\"gemini-3-pro-image\",\"status\":\"succeeded\",\"units\":1,\"unit_kind\":\"image\",\"resolution\":\"4K; drop table x\",\"thought_tokens\":-5,\"cost_basis\":\"estimated\",\"cost_usd_micros\":240000,\"base_cost_usd_micros\":-1},
  {\"actor_kind\":\"customer\",\"consumer\":\"generation\",\"provider_slug\":\"google\",\"model\":\"gemini-3-pro-image\",\"status\":\"succeeded\",\"units\":1,\"unit_kind\":\"image\",\"cost_basis\":\"estimated\",\"cost_usd_micros\":134000}
]'::jsonb)")
check "all three rows kept" "$N" "3"
check "total, base, thinking and size stored apart" \
  "$(q "select cost_usd_micros||'/'||base_cost_usd_micros||'/'||thought_tokens||'/'||resolution from public.ai_provider_calls where tool_key='retouch'")" "137920/134000/210/1K"
check "a malformed size is dropped (NULL), negatives clamp to 0 — the row survives" \
  "$(q "select coalesce(resolution,'null')||'/'||base_cost_usd_micros||'/'||thought_tokens from public.ai_provider_calls where cost_usd_micros=240000")" "null/0/0"
check "a call recorded the old way (no breakdown) still lands, with NULLs" \
  "$(q "select coalesce(base_cost_usd_micros::text,'null')||'/'||coalesce(thought_tokens::text,'null') from public.ai_provider_calls where cost_usd_micros=134000")" "null/null"
check "the recorder still needs the server token" "$("${PSQL[@]}" -c "select public.ai_provider_call_record('wrong', '[]'::jsonb)" 2>&1 | sed -n 's/^.*ERROR:  //p' | head -1)" "forbidden"

PGOPTIONS='--client-min-messages=warning' "${PSQL[@]}" -f "$M/0133_model_cost_official_prices.sql" >/dev/null
check "migration is re-runnable (idempotent): still 3 price rows, 1 token row" \
  "$(q "select (select count(*) from public.ai_unit_prices)||'/'||(select count(*) from public.ai_token_prices where model='gemini-3-pro-image')")" "3/1"

echo
if [ "$fails" -eq 0 ]; then echo "model-cost-sql: all checks passed"; else echo "model-cost-sql: $fails failed"; fi
exit "$fails"
