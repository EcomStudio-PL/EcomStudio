#!/usr/bin/env bash
#
# PUBLIC TOOLS V1 (0157), PROVEN AGAINST A REAL POSTGRES.
#
# What has to hold:
#   · a visitor's role reads ai_models / ai_providers and gets NO ROWS and NO
#     ERROR (before 0157 the admin write policy made every anonymous read fail
#     with "permission denied for function is_admin");
#   · the same role WITH the server token in `x-grovbase-server` reads them —
#     a wrong, empty, oversized or malformed header reads nothing;
#   · a signed-in customer reads them exactly as before, and still cannot
#     write them; an admin still can;
#   · providers_with_credentials(): nothing for a visitor, the keyed
#     providers for the server and for a signed-in customer;
#   · the four token-gated readers are callable by a visitor and still refuse
#     without the token;
#   · a second run changes nothing.
#
# The rehearsal schema is the part of PROD this file touches, with the bodies
# of is_admin (0002) and server_call_ok (0077) EXTRACTED from their
# migrations, and the policies, grants and functions as PROD holds them today
# (read from PROD's catalog when this was written).
#
# Local harness only, its own database (pt_sqltest), removed on exit
# (KEEP_DB=1 keeps it).
#
#   bash scripts/pg-harness-up.sh && npm run test:publictools:sql
set -euo pipefail

PGSOCK="${PGSOCK:-/tmp/pgtest}"
PGPORT="${PGPORT:-5433}"
PGCONN=(-h "$PGSOCK" -p "$PGPORT" -U postgres)

if ! psql "${PGCONN[@]}" -d postgres -X -q -t -A -c 'select 1' >/dev/null 2>&1; then
  echo "public-tools-sql: no harness on $PGSOCK:$PGPORT — run: bash scripts/pg-harness-up.sh" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
M="$ROOT/supabase/migrations"
FILE="$M/0157_public_tool_reads.sql"
[ -f "$FILE" ] || { echo "public-tools-sql: $FILE not found" >&2; exit 2; }

extract() { # file, function name, end marker regex
  awk -v start="^create (or replace )?function public[.]$2[(]" -v stop="$3" \
    '$0 ~ start {on=1} on {print} on && $0 ~ stop {exit}' "$1"
}
IS_ADMIN=$(extract "$M/0002_functions_and_triggers.sql" is_admin '^[$][$];')
SERVER_CALL_OK=$(extract "$M/0077_server_only_rpcs.sql" server_call_ok '^end [$][$];')
for v in IS_ADMIN SERVER_CALL_OK; do
  [ -n "${!v}" ] || { echo "public-tools-sql: could not extract $v" >&2; exit 2; }
done

DB="${PT_DB:-pt_sqltest}"
WORK=$(mktemp -d)
cleanup() {
  [ "${KEEP_DB:-0}" = "1" ] || dropdb "${PGCONN[@]}" --if-exists --force "$DB" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
ERR="$WORK/err"
q() { psql "${PGCONN[@]}" -d "$DB" -v ON_ERROR_STOP=1 -X -q -t -A "$@"; }
apply() { PGOPTIONS='-c client_min_messages=warning' psql "${PGCONN[@]}" -d "$DB" -v ON_ERROR_STOP=1 -X -q -t -A -1 -f "$1" >/dev/null 2>"$ERR"; }
record() {
  q -v name="$1" -v ok="$2" -v detail="$3" >/dev/null <<'SQL'
insert into public.test_results (name, ok, detail) values (:'name', :'ok'::boolean, :'detail');
SQL
}

dropdb "${PGCONN[@]}" --if-exists --force "$DB" >/dev/null 2>&1 || true
createdb "${PGCONN[@]}" "$DB"

# ── The rehearsal ───────────────────────────────────────────────────────────
q >/dev/null <<'SQL'
set client_min_messages = warning;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema auth; create schema extensions;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema public, auth, extensions to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;

create function auth.uid() returns uuid language sql stable as $f$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$f$;
create table public.profiles (id uuid primary key, role text not null default 'user');
create table public.app_settings (key text primary key, value jsonb not null default '{}'::jsonb);
insert into public.app_settings (key, value) values
  ('notifications', jsonb_build_object('dispatch_hash', encode(extensions.digest('pt-test-token', 'sha256'), 'hex')));

create table public.ai_providers (id uuid primary key default gen_random_uuid(), slug text unique not null, active boolean not null default true);
create table public.ai_models (id uuid primary key default gen_random_uuid(), provider_id uuid references public.ai_providers(id),
  model_key text not null, active boolean not null default true, pricing jsonb not null default '{}'::jsonb);
create table public.ai_provider_credentials (id uuid primary key default gen_random_uuid(),
  provider_id uuid references public.ai_providers(id), active boolean not null default true, secret text);
alter table public.ai_providers enable row level security;
alter table public.ai_models enable row level security;
alter table public.ai_provider_credentials enable row level security;
revoke all on public.ai_provider_credentials from anon, authenticated;
SQL
{
  echo "set client_min_messages = warning;"
  printf '%s\n' "$IS_ADMIN" "$SERVER_CALL_OK"
} > "$WORK/bodies.sql"
q -f "$WORK/bodies.sql" >/dev/null 2>"$ERR" || { cat "$ERR" >&2; exit 2; }

q >/dev/null <<'SQL'
set client_min_messages = warning;
-- Grants and policies as PROD holds them before 0157.
revoke execute on function public.is_admin(uuid) from public, anon;
grant execute on function public.is_admin(uuid) to authenticated;
revoke all on function public.server_call_ok(text) from public, anon, authenticated;

create policy aimodel_admin_write on public.ai_models for all using (public.is_admin()) with check (public.is_admin());
create policy aimodel_select on public.ai_models for select using (auth.uid() is not null);
create policy aiprov_admin_write on public.ai_providers for all using (public.is_admin()) with check (public.is_admin());
create policy aiprov_select on public.ai_providers for select using (auth.uid() is not null);

create function public.providers_with_credentials() returns setof uuid language sql security definer set search_path = public as $f$
  select distinct c.provider_id from public.ai_provider_credentials c join public.ai_providers p on p.id = c.provider_id
   where c.active and p.active and auth.uid() is not null;
$f$;
revoke execute on function public.providers_with_credentials() from public, anon;
grant execute on function public.providers_with_credentials() to authenticated;

-- The four token-gated readers: same signatures and gates as PROD; the bodies
-- return a marker instead of prompts.
create function public.ai_tool_runtime(p_tool_key text, p_token text) returns table (tool_key text) language plpgsql stable security definer set search_path = public as $f$
begin if not public.server_call_ok(p_token) then return; end if; return query select p_tool_key; end $f$;
create function public.ai_tool_workflow_read(p_token text, p_tool_key text, p_workflow_id uuid default null) returns table (tool_key text) language plpgsql stable security definer set search_path = public as $f$
begin if not public.server_call_ok(p_token) then return; end if; return query select p_tool_key; end $f$;
create function public.thumbnail_config_read(p_token text) returns jsonb language plpgsql stable security definer set search_path = public as $f$
begin if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if; return '{"ok":true}'::jsonb; end $f$;
create function public.ai_background_presets_read(p_token text) returns jsonb language plpgsql stable security definer set search_path = public as $f$
begin if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if; return '{"ok":true}'::jsonb; end $f$;
revoke all on function public.ai_tool_runtime(text, text) from public, anon;
revoke all on function public.ai_tool_workflow_read(text, text, uuid) from public, anon;
revoke all on function public.thumbnail_config_read(text) from public, anon;
revoke all on function public.ai_background_presets_read(text) from public, anon;
grant execute on function public.ai_tool_runtime(text, text) to authenticated;
grant execute on function public.ai_tool_workflow_read(text, text, uuid) to authenticated;
grant execute on function public.thumbnail_config_read(text) to authenticated;
grant execute on function public.ai_background_presets_read(text) to authenticated;

insert into public.ai_providers (id, slug, active) values
  ('00000000-0000-0000-0000-0000000000a1', 'google', true),
  ('00000000-0000-0000-0000-0000000000a2', 'openai', true),
  ('00000000-0000-0000-0000-0000000000a3', 'retired', false);
insert into public.ai_models (provider_id, model_key, pricing) values
  ('00000000-0000-0000-0000-0000000000a1', 'gemini-3-pro-image', '{"2K":7,"4K":12}'),
  ('00000000-0000-0000-0000-0000000000a2', 'gpt-image-1', '{"1K":5}');
insert into public.ai_provider_credentials (provider_id, active, secret) values
  ('00000000-0000-0000-0000-0000000000a1', true, 'k1'),
  ('00000000-0000-0000-0000-0000000000a3', true, 'k3');
insert into public.profiles (id, role) values
  ('00000000-0000-0000-0000-00000000c001', 'user'),
  ('00000000-0000-0000-0000-00000000ad01', 'admin');

create table public.test_results (name text, ok boolean, detail text, seq serial);

-- Run `p_sql` as `p_role`, optionally as a signed-in user and with request
-- headers, and report whether it returned true / raised what was expected.
create function public.t_as(p_role text, p_uid text, p_headers text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid, ''), true);
  perform set_config('request.headers', coalesce(p_headers, ''), true);
  execute format('set local role %I', p_role);
end $f$;
create function public.t_true(p_name text, p_role text, p_uid text, p_headers text, p_sql text)
returns void language plpgsql as $f$
declare v_ok boolean := null; v_err text := null;
begin
  begin
    perform public.t_as(p_role, p_uid, p_headers);
    execute p_sql into v_ok;
  exception when others then v_err := sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.headers', '', true);
  insert into public.test_results(name, ok, detail) values (p_name, coalesce(v_ok, false), coalesce(v_err, 'got ' || coalesce(v_ok::text, 'null')));
end $f$;
create function public.t_raises(p_name text, p_role text, p_uid text, p_headers text, p_sql text, p_needle text)
returns void language plpgsql as $f$
declare v_err text := null;
begin
  begin
    perform public.t_as(p_role, p_uid, p_headers);
    execute p_sql;
  exception when others then v_err := sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.headers', '', true);
  insert into public.test_results(name, ok, detail) values (p_name, v_err is not null and v_err like '%' || p_needle || '%', coalesce(v_err, '(no error raised)'));
end $f$;
SQL

# ── BEFORE 0157: the defect this file fixes ─────────────────────────────────
q >/dev/null <<'SQL'
select public.t_raises('B0  before 0157 a visitor''s read of ai_models FAILS (is_admin)', 'anon', null, null,
  'select count(*) from public.ai_models', 'permission denied for function is_admin');
SQL

if apply "$FILE"; then record 'A0  0157 applies in one transaction' true ''
else record 'A0  0157 applies in one transaction' false "$(tr '\n' ' ' < "$ERR")"; fi

GOOD='{"x-grovbase-server":"pt-test-token","accept":"application/json"}'
q -v good="$GOOD" >/dev/null <<'SQL'
-- Visitor, no header: nothing, and no error.
select public.t_true('R1  visitor without the header: ai_models → 0 rows, no error', 'anon', null, null,
  'select count(*) = 0 from public.ai_models');
select public.t_true('R2  visitor without the header: ai_providers → 0 rows, no error', 'anon', null, null,
  'select count(*) = 0 from public.ai_providers');
-- The server (anon key + the token header).
select public.t_true('R3  the server (token header): every model and provider', 'anon', null, :'good',
  'select (select count(*) = 2 from public.ai_models) and (select count(*) = 3 from public.ai_providers)');
select public.t_true('R4  a wrong token reads nothing', 'anon', null, '{"x-grovbase-server":"guess"}',
  'select count(*) = 0 from public.ai_models');
select public.t_true('R5  an empty token reads nothing', 'anon', null, '{"x-grovbase-server":""}',
  'select count(*) = 0 from public.ai_models');
select public.t_true('R6  a malformed header set reads nothing and raises nothing', 'anon', null, 'not json',
  'select count(*) = 0 from public.ai_models');
select public.t_true('R7  an oversized token reads nothing', 'anon', null, json_build_object('x-grovbase-server', repeat('x', 600))::text,
  'select count(*) = 0 from public.ai_models');
select public.t_true('R8  the token in another header reads nothing', 'anon', null, '{"authorization":"pt-test-token"}',
  'select count(*) = 0 from public.ai_providers');
-- Signed in: unchanged.
select public.t_true('R9  a signed-in customer reads them as before', 'authenticated', '00000000-0000-0000-0000-00000000c001', null,
  'select (select count(*) = 2 from public.ai_models) and (select count(*) = 3 from public.ai_providers)');
-- Writes: nobody but an admin, header or not.
select public.t_raises('W1  a customer cannot write ai_models', 'authenticated', '00000000-0000-0000-0000-00000000c001', null,
  $q$insert into public.ai_models (provider_id, model_key) values ('00000000-0000-0000-0000-0000000000a1', 'x')$q$, 'row-level security');
select public.t_raises('W2  the server header grants no write either', 'anon', null, :'good',
  $q$insert into public.ai_models (provider_id, model_key) values ('00000000-0000-0000-0000-0000000000a1', 'x')$q$, 'row-level security');
select public.t_true('W3  … and an update by the server touches nothing', 'anon', null, :'good',
  $q$with u as (update public.ai_models set active = false returning 1) select count(*) = 0 from u$q$);
select public.t_true('W4  an admin still updates ai_models', 'authenticated', '00000000-0000-0000-0000-00000000ad01', null,
  $q$with u as (update public.ai_models set pricing = pricing returning 1) select count(*) = 2 from u$q$);
-- providers_with_credentials()
select public.t_true('P1  visitor: providers_with_credentials() → nothing', 'anon', null, null,
  'select count(*) = 0 from public.providers_with_credentials()');
select public.t_true('P2  the server: the active keyed provider only', 'anon', null, :'good',
  $q$select array_agg(x)::text = '{00000000-0000-0000-0000-0000000000a1}' from public.providers_with_credentials() x$q$);
select public.t_true('P3  a signed-in customer: the same as before', 'authenticated', '00000000-0000-0000-0000-00000000c001', null,
  'select count(*) = 1 from public.providers_with_credentials()');
-- The token-gated readers.
select public.t_true('G1  visitor may call ai_tool_runtime — and gets nothing without the token', 'anon', null, null,
  $q$select count(*) = 0 from public.ai_tool_runtime('retouch', 'guess')$q$);
select public.t_true('G2  … the server gets its row', 'anon', null, null,
  $q$select count(*) = 1 from public.ai_tool_runtime('retouch', 'pt-test-token')$q$);
select public.t_true('G3  ai_tool_workflow_read: nothing without the token', 'anon', null, null,
  $q$select count(*) = 0 from public.ai_tool_workflow_read('guess', 'retouch', null)$q$);
select public.t_raises('G4  thumbnail_config_read still refuses without the token', 'anon', null, null,
  $q$select public.thumbnail_config_read('guess')$q$, 'forbidden');
select public.t_raises('G5  ai_background_presets_read still refuses without the token', 'anon', null, null,
  $q$select public.ai_background_presets_read('guess')$q$, 'forbidden');
select public.t_true('G6  … and answers the server', 'anon', null, null,
  $q$select (public.ai_background_presets_read('pt-test-token') ->> 'ok')::boolean and (public.thumbnail_config_read('pt-test-token') ->> 'ok')::boolean$q$);
select public.t_true('G7  server_request_ok() is false outside a request', 'anon', null, null,
  'select not public.server_request_ok()');
select public.t_raises('G8  server_call_ok itself stays closed to a visitor', 'anon', null, null,
  $q$select public.server_call_ok('pt-test-token')$q$, 'permission denied');
SQL

POL=$(q -c "select md5(string_agg(policyname || roles::text || coalesce(qual, '') || coalesce(with_check, ''), '|' order by policyname)) from pg_policies where tablename in ('ai_models', 'ai_providers')")
if apply "$FILE"; then record 'A1  0157 again (re-runnable)' true ''
else record 'A1  0157 again (re-runnable)' false "$(tr '\n' ' ' < "$ERR")"; fi
POL2=$(q -c "select md5(string_agg(policyname || roles::text || coalesce(qual, '') || coalesce(with_check, ''), '|' order by policyname)) from pg_policies where tablename in ('ai_models', 'ai_providers')")
if [ "$POL" = "$POL2" ]; then record 'A1b … and leaves the same policies' true ''
else record 'A1b … and leaves the same policies' false "$POL vs $POL2"; fi
NPOL=$(q -c "select count(*) from pg_policies where tablename in ('ai_models', 'ai_providers')")
if [ "$NPOL" = "4" ]; then record 'A2  four policies, none duplicated' true ''
else record 'A2  four policies, none duplicated' false "$NPOL"; fi

q -c "select case when ok then '  ✓ ' else '  ✗ ' end || name || case when ok then '' else '  — ' || detail end
      from public.test_results order by seq"
FAILED=$(q -c "select count(*) from public.test_results where not ok")
TOTAL=$(q -c "select count(*) from public.test_results")
if [ "$FAILED" = "0" ]; then
  echo; echo "All $TOTAL Public Tools (0157) SQL tests passed."
else
  echo; echo "$FAILED of $TOTAL FAILED" >&2; exit 1
fi
