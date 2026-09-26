#!/usr/bin/env bash
#
# API / PROVIDER COSTS — migration 0127 proven on a real Postgres: the provider
# call trace (ai_provider_calls) and its token-gated recorder, the admin-only
# token price list, the live last-success / last-error columns, and 'profile'
# in the reserved CMS slugs.
#
# 0127 is loaded VERBATIM next to the helpers it depends on (is_admin from
# 0002, server_call_ok from 0077, cms_slug_is_reserved as 0125 ships it) and
# the smallest tables it references. Local harness only:
#
#   bash scripts/pg-harness-up.sh && npm run test:apiecon:sql
set -euo pipefail

PGSOCK="${PGSOCK:-/tmp/pgtest}"
PGPORT="${PGPORT:-5433}"
DB=apiusage
PSQL0=(psql -h "$PGSOCK" -p "$PGPORT" -U postgres -v ON_ERROR_STOP=1 -X -q -t -A)
PSQL=("${PSQL0[@]}" -d "$DB")

if ! "${PSQL0[@]}" -d postgres -c 'select 1' >/dev/null 2>&1; then
  echo "api-usage-sql: no harness on $PGSOCK:$PGPORT — run: bash scripts/pg-harness-up.sh" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
M=$ROOT/supabase/migrations
MIGRATION="${MIGRATION:-$M/0127_ai_provider_calls.sql}"
extract() { # file, function name, end marker regex
  awk -v start="^create (or replace )?function public[.]$2[(]" -v stop="$3" \
    '$0 ~ start {on=1} on {print} on && $0 ~ stop {exit}' "$1"
}
IS_ADMIN=$(extract "$M/0002_functions_and_triggers.sql" is_admin '^[$][$];')
SERVER_CALL_OK=$(extract "$M/0077_server_only_rpcs.sql" server_call_ok '^end [$][$];')
CMS_RESERVED=$(extract "$M/0125_grovnews_sources_daily.sql" cms_slug_is_reserved '^[$][$];')
for v in IS_ADMIN SERVER_CALL_OK CMS_RESERVED; do
  [ -n "${!v}" ] || { echo "api-usage-sql: could not extract $v" >&2; exit 2; }
done

"${PSQL0[@]}" -d postgres -c "drop database if exists $DB" >/dev/null
"${PSQL0[@]}" -d postgres -c "create database $DB" >/dev/null

fails=0
check() { if [ "$2" = "$3" ]; then echo "  ✓ $1"; else echo "  ✗ $1 — got [$2], expected [$3]"; fails=$((fails+1)); fi; }
q() { "${PSQL[@]}" -c "$1"; }
err() { # sql, [role], [sub]
  local out
  if out=$("${PSQL[@]}" -c "set role ${2:-postgres}; set request.jwt.claim.sub = '${3:-}'; $1" 2>&1); then echo ok
  else echo "$out" | sed -n 's/^.*ERROR:  //p' | head -1; fi
}
as_user() { "${PSQL[@]}" -c "set role authenticated; set request.jwt.claim.sub = '$1'; $2"; }
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
alter default privileges in schema public grant all on tables to anon, authenticated;
create function auth.uid() returns uuid language sql stable as
  \$f\$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid \$f\$;
create table public.app_settings (key text primary key, value jsonb not null default '{}'::jsonb);
insert into public.app_settings values
  ('notifications', jsonb_build_object('dispatch_hash', encode(digest('$TOKEN', 'sha256'), 'hex')));
create table public.profiles (id uuid primary key, role text not null default 'user');
create table public.workspaces (id uuid primary key default gen_random_uuid());
create table public.usage_events (id uuid primary key default gen_random_uuid());
create table public.generation_jobs (id uuid primary key default gen_random_uuid());
create table public.ai_providers (id uuid primary key default gen_random_uuid(), slug text unique, active boolean default true);
create table public.ai_provider_credentials (
  id uuid primary key default gen_random_uuid(), provider_id uuid unique references public.ai_providers(id),
  last_tested_at timestamptz, last_test_status text);
$IS_ADMIN
$SERVER_CALL_OK
$CMS_RESERVED
SQL
"${PSQL[@]}" -f "$MIGRATION" >/dev/null

ADMIN=11111111-1111-1111-1111-111111111111
USER1=22222222-2222-2222-2222-222222222222
q "insert into public.profiles values ('$ADMIN','admin'), ('$USER1','user');
   insert into public.ai_providers (slug) values ('google'), ('openai');
   insert into public.ai_provider_credentials (provider_id) select id from public.ai_providers;" >/dev/null
UE=$(q "insert into public.usage_events default values returning id")

echo "0127 — provider call trace"
check "recorder refuses without the server token" "$(err "select public.ai_provider_call_record('wrong', '[]'::jsonb)" anon)" "forbidden"
check "recorder refuses more than 50 rows" \
  "$(err "select public.ai_provider_call_record('$TOKEN', (select jsonb_agg('{}'::jsonb) from generate_series(1,51)))" anon)" "too_many_calls"
N=$(q "select public.ai_provider_call_record('$TOKEN', '[
  {\"actor_kind\":\"customer\",\"consumer\":\"generation\",\"tool_key\":\"retouch\",\"usage_event_id\":\"$UE\",\"provider_slug\":\"google\",\"model\":\"gemini-3-pro-image-preview\",\"status\":\"succeeded\",\"units\":1,\"unit_kind\":\"image\",\"cost_basis\":\"estimated\",\"cost_usd_micros\":39000,\"duration_ms\":8000},
  {\"actor_kind\":\"system\",\"consumer\":\"grovnews\",\"run_ref\":\"run-1\",\"provider_slug\":\"openai\",\"model\":\"gpt-4.1\",\"status\":\"failed\",\"error_code\":\"Analysis Rate Limited!\",\"input_tokens\":10,\"cost_basis\":\"unknown\",\"cost_usd_micros\":999},
  {\"actor_kind\":\"hacker\",\"consumer\":\"generation\",\"provider_slug\":\"google\",\"status\":\"succeeded\",\"cost_basis\":\"estimated\",\"cost_usd_micros\":1},
  {\"actor_kind\":\"system\",\"consumer\":\"grovnews\",\"provider_slug\":\"google\",\"status\":\"succeeded\",\"cost_basis\":\"estimated\",\"cost_usd_micros\":-5,\"usage_event_id\":\"not-a-uuid\"}
]'::jsonb)")
check "valid rows kept, malformed rows skipped (bad actor, bad uuid) without failing the batch" "$N" "2"
check "unknown cost is stored as NULL, never the number sent" "$(q "select coalesce(cost_usd_micros::text,'null') from public.ai_provider_calls where provider_slug='openai'")" "null"
check "error codes are sanitised to a code" "$(q "select error_code from public.ai_provider_calls where provider_slug='openai'")" "analysis_rate_limited_"
check "estimated cost kept with its basis" "$(q "select cost_basis||':'||cost_usd_micros from public.ai_provider_calls where tool_key='retouch'")" "estimated:39000"
check "a success updates the provider's last successful request" "$(q "select (c.last_success_at is not null)::text from public.ai_provider_credentials c join public.ai_providers p on p.id=c.provider_id where p.slug='google'")" "true"
check "an unrecognised failure code is recorded but does not mark the provider" \
  "$(q "select (c.last_error_at is null)::text from public.ai_provider_credentials c join public.ai_providers p on p.id=c.provider_id where p.slug='openai'")" "true"
q "select public.ai_provider_call_record('$TOKEN', '[{\"actor_kind\":\"customer\",\"consumer\":\"generation\",\"provider_slug\":\"google\",\"status\":\"failed\",\"error_code\":\"content_policy\",\"cost_basis\":\"unknown\"}]'::jsonb)" >/dev/null
check "a customer's refused prompt does NOT turn the provider red" \
  "$(q "select (c.last_error_at is null)::text from public.ai_provider_credentials c join public.ai_providers p on p.id=c.provider_id where p.slug='google'")" "true"
q "select public.ai_provider_call_record('$TOKEN', '[{\"actor_kind\":\"customer\",\"consumer\":\"generation\",\"provider_slug\":\"openai\",\"status\":\"failed\",\"error_code\":\"provider_auth_failed\",\"cost_basis\":\"unknown\"}]'::jsonb)" >/dev/null
check "a provider-side failure updates last error + code, not last success" \
  "$(q "select (c.last_error_at is not null)::text||':'||c.last_error_code||':'||(c.last_success_at is null)::text from public.ai_provider_credentials c join public.ai_providers p on p.id=c.provider_id where p.slug='openai'")" \
  "true:provider_auth_failed:true"
q "select public.ai_provider_call_record('$TOKEN', '[{\"actor_kind\":\"admin\",\"consumer\":\"provider_test\",\"provider_slug\":\"openai\",\"status\":\"succeeded\",\"cost_basis\":\"estimated\",\"cost_usd_micros\":0}]'::jsonb)" >/dev/null
check "an admin provider test does NOT count as production traffic" "$(q "select (c.last_success_at is null)::text from public.ai_provider_credentials c join public.ai_providers p on p.id=c.provider_id where p.slug='openai'")" "true"
check "the basis/cost pair is enforced by a constraint" \
  "$(err "insert into public.ai_provider_calls (actor_kind, consumer, provider_slug, status, cost_basis, cost_usd_micros) values ('system','grovnews','google','succeeded','unknown', 5)")" \
  'new row for relation "ai_provider_calls" violates check constraint "ai_provider_calls_cost_known"'
check "admin reads the trace" "$(as_user $ADMIN "select count(*) from public.ai_provider_calls")" "5"
check "a customer reads NOTHING of the trace (RLS)" "$(as_user $USER1 "select count(*) from public.ai_provider_calls")" "0"
check "a customer cannot insert directly" "$(err "insert into public.ai_provider_calls (actor_kind, consumer, provider_slug, status, cost_basis) values ('customer','generation','google','succeeded','unknown')" authenticated $USER1)" "permission denied for table ai_provider_calls"
check "anon cannot read the trace" "$(err "select count(*) from public.ai_provider_calls" anon)" "permission denied for table ai_provider_calls"
check "API10 SQL sum = sum of the raw known costs" "$(q "select sum(cost_usd_micros) from public.ai_provider_calls where cost_basis <> 'unknown'")" "39000"

echo "0127 — token prices (admin only)"
check "admin writes a price" "$(err "insert into public.ai_token_prices (provider_slug, model, input_usd_micros_per_mtok, output_usd_micros_per_mtok) values ('openai','gpt-4.1',2000000,8000000)" authenticated $ADMIN)" "ok"
check "a customer cannot read prices" "$(as_user $USER1 "select count(*) from public.ai_token_prices")" "0"
check "a customer cannot write prices" "$(err "insert into public.ai_token_prices (provider_slug, model, input_usd_micros_per_mtok, output_usd_micros_per_mtok) values ('openai','x',1,1)" authenticated $USER1)" 'new row violates row-level security policy for table "ai_token_prices"'
check "the recorder's price door needs the token" "$(err "select * from public.ai_token_prices_read('wrong')" anon)" "forbidden"
check "…and serves the list with it" "$(q "select count(*) from public.ai_token_prices_read('$TOKEN')")" "1"
check "negative / absurd prices refused" "$(err "insert into public.ai_token_prices (provider_slug, model, input_usd_micros_per_mtok, output_usd_micros_per_mtok) values ('openai','y',-1,1)")" 'new row for relation "ai_token_prices" violates check constraint "ai_token_prices_input_usd_micros_per_mtok_check"'

echo "0127 — /profile reserved"
check "'profile' is now a reserved CMS slug" "$(q "select public.cms_slug_is_reserved('profile')::text")" "true"
check "every slug reserved before stays reserved" "$(q "select (public.cms_slug_is_reserved('settings') and public.cms_slug_is_reserved('blog') and public.cms_slug_is_reserved('plan'))::text")" "true"
check "an ordinary slug is still free" "$(q "select public.cms_slug_is_reserved('o-nas')::text")" "false"
PGOPTIONS='--client-min-messages=warning' "${PSQL[@]}" -f "$MIGRATION" >/dev/null
check "migration is re-runnable (idempotent)" "$(q "select public.cms_slug_is_reserved('profile')::text")" "true"

echo
if [ "$fails" -eq 0 ]; then echo "api-usage-sql: all checks passed"; else echo "api-usage-sql: $fails failed"; fi
exit "$fails"
