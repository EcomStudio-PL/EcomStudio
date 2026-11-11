#!/usr/bin/env bash
#
# ENGINE PROMPT PRIVACY (0171), PROVEN AGAINST A REAL POSTGRES.
#
# 0171 is loaded VERBATIM (twice: it must re-run cleanly) on the policies the
# three tables carried before it (as read from production), with the real
# is_workspace_member / is_admin / server_call_ok / server_request_ok bodies.
# What has to hold:
#   · a member's BROWSER (publishable key + session, no server token) reads,
#     writes and updates none of generation_jobs, generated_prompts and
#     prompt_sessions — not even their own workspace's rows;
#   · the APPLICATION (the same member's session + the server token in
#     x-grovbase-server) reads and writes them exactly as before — and only
#     its own workspace's rows;
#   · a wrong or missing token is a browser; an admin still reads directly;
#   · definer functions (favourites, notes, the engine's RPCs) are unaffected.
#
#   bash scripts/pg-harness-up.sh && npm run test:promptprivacy:sql
set -euo pipefail

PGSOCK="${PGSOCK:-/tmp/pgtest}"
PGPORT="${PGPORT:-5433}"
DB="${PROMPTPRIVACY_DB:-prompt_privacy_sqltest}"
PSQL0=(psql -h "$PGSOCK" -p "$PGPORT" -U postgres -v ON_ERROR_STOP=1 -X -q -t -A)
PSQL=("${PSQL0[@]}" -d "$DB")

if ! "${PSQL0[@]}" -d postgres -c 'select 1' >/dev/null 2>&1; then
  echo "promptprivacy-sql: no harness on $PGSOCK:$PGPORT — run: bash scripts/pg-harness-up.sh" >&2
  exit 2
fi
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
M="$ROOT/supabase/migrations"
MIG="$M/0171_engine_prompt_privacy.sql"
extract() { awk -v start="^create (or replace )?function public[.]$2[(]" -v stop="$3" '$0 ~ start {on=1} on {print} on && $0 ~ stop {exit}' "$1"; }
IS_ADMIN=$(extract "$M/0002_functions_and_triggers.sql" is_admin '^[$][$];')
IS_MEMBER=$(extract "$M/0002_functions_and_triggers.sql" is_workspace_member '^[$][$];')
CALL_OK=$(extract "$M/0077_server_only_rpcs.sql" server_call_ok '^end [$][$];')
REQ_OK=$(extract "$M/0157_public_tool_reads.sql" server_request_ok '^end [$][$];')
for f in IS_ADMIN IS_MEMBER CALL_OK REQ_OK; do [ -n "${!f}" ] || { echo "promptprivacy-sql: could not extract $f" >&2; exit 2; }; done

cleanup() { [ "${KEEP_DB:-0}" = "1" ] || "${PSQL0[@]}" -d postgres -c "drop database if exists $DB with (force)" >/dev/null 2>&1 || true; }
trap cleanup EXIT
PGOPTIONS="-c client_min_messages=warning" "${PSQL0[@]}" -d postgres -c "drop database if exists $DB with (force)" >/dev/null
"${PSQL0[@]}" -d postgres -c "create database $DB" >/dev/null

fails=0
check() { if [ "$2" = "$3" ]; then echo "  ✓ $1"; else echo "  ✗ $1 — got [$2], expected [$3]"; fails=$((fails+1)); fi; }
q() { "${PSQL[@]}" -c "$1"; }
TOKEN="server-token-for-tests"
# A member's request: their session (sub), and — for the application — the server's header.
as_user() { "${PSQL[@]}" -c "set role authenticated; set request.jwt.claim.sub = '$1'; set request.headers = '$2'; $3" 2>&1 | sed -n 's/^.*ERROR:  //p;/ERROR/!p' | head -1; }
BROWSER='{}'
SERVER="{\"x-grovbase-server\":\"$TOKEN\"}"
FORGED='{"x-grovbase-server":"guess"}'

UA=00000000-0000-0000-0000-00000000000a
U1=00000000-0000-0000-0000-000000000001
U2=00000000-0000-0000-0000-000000000002
W1=10000000-0000-0000-0000-000000000001
W2=10000000-0000-0000-0000-000000000002

"${PSQL[@]}" >/dev/null <<SQL
set client_min_messages = warning;
create schema auth;
create schema extensions;
create extension if not exists pgcrypto schema extensions;
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end \$\$;
grant usage on schema public, auth, extensions to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
create function auth.uid() returns uuid language sql stable as
  \$f\$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid \$f\$;
create table public.profiles (id uuid primary key, role text not null default 'user');
insert into public.profiles values ('$UA', 'admin'), ('$U1', 'user'), ('$U2', 'user');
create table public.workspace_members (workspace_id uuid, user_id uuid, role text default 'owner');
insert into public.workspace_members values ('$W1', '$U1', 'owner'), ('$W2', '$U2', 'owner');
create table public.app_settings (key text primary key, value jsonb);
insert into public.app_settings values ('notifications', jsonb_build_object('dispatch_hash', encode(extensions.digest('$TOKEN', 'sha256'), 'hex')));
$IS_ADMIN
$IS_MEMBER
$CALL_OK
$REQ_OK
grant execute on function public.server_request_ok() to anon, authenticated;

create table public.generation_jobs (id uuid primary key default gen_random_uuid(), workspace_id uuid, user_id uuid,
  prompt_text text, prompt_origin text, settings jsonb default '{}', status text default 'completed');
create table public.generated_prompts (id uuid primary key default gen_random_uuid(), workspace_id uuid,
  prompt_text text, customer_description text, priority int default 1);
create table public.prompt_sessions (id uuid primary key default gen_random_uuid(), workspace_id uuid, user_id uuid,
  product_lock jsonb, knowledge_used jsonb);
alter table public.generation_jobs enable row level security;
alter table public.generated_prompts enable row level security;
alter table public.prompt_sessions enable row level security;
-- The policies production carried before 0171.
create policy gj_select on public.generation_jobs for select using (is_workspace_member(workspace_id) or (select is_admin()));
create policy gj_insert on public.generation_jobs for insert with check (is_workspace_member(workspace_id) and user_id = (select auth.uid()));
create policy gj_update on public.generation_jobs for update using (is_workspace_member(workspace_id) or (select is_admin()));
create policy gp_select on public.generated_prompts for select using (is_workspace_member(workspace_id) or is_admin());
create policy gp_insert on public.generated_prompts for insert with check (is_workspace_member(workspace_id));
create policy gp_update on public.generated_prompts for update using (is_workspace_member(workspace_id));
create policy gp_delete on public.generated_prompts for delete using (is_workspace_member(workspace_id));
create policy ps_select on public.prompt_sessions for select using (is_workspace_member(workspace_id) or is_admin());
create policy ps_insert on public.prompt_sessions for insert with check (is_workspace_member(workspace_id) and user_id = auth.uid());
create policy ps_update on public.prompt_sessions for update using (is_workspace_member(workspace_id));
create policy ps_delete on public.prompt_sessions for delete using (is_workspace_member(workspace_id));

insert into public.generation_jobs (workspace_id, user_id, prompt_text, prompt_origin) values
  ('$W1', '$U1', 'Professional studio packshot of … (an old engine prompt)', null),
  ('$W1', '$U1', 'mój własny prompt', 'custom'),
  ('$W2', '$U2', 'someone else''s prompt', 'custom');
insert into public.generated_prompts (workspace_id, prompt_text, customer_description) values ('$W1', 'ENGINE TEMPLATE …', 'scene description');
insert into public.prompt_sessions (workspace_id, user_id, product_lock) values ('$W1', '$U1', '{"lock":"rules"}');
-- A definer function the browser may call (like set_generation_favorite).
create function public.my_job_count() returns int language sql stable security definer set search_path = public as
  \$f\$ select count(*)::int from public.generation_jobs where workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()) \$f\$;
grant execute on function public.my_job_count() to authenticated;
SQL

echo "before 0171 (what production allowed)"
check "a member's browser could read the engine text of an old job" "$(as_user $U1 "$BROWSER" "select count(*) from public.generation_jobs where prompt_origin is null")" "1"

echo "0171 — loaded verbatim, twice"
"${PSQL[@]}" -c "set client_min_messages = warning;" -f "$MIG" >/dev/null
"${PSQL[@]}" -c "set client_min_messages = warning;" -f "$MIG" >/dev/null
check "re-runs cleanly: the same eleven policies" "$(q "select count(*) from pg_policies where tablename in ('generation_jobs','generated_prompts','prompt_sessions')")" "11"
check "every member policy now asks for the server" "$(q "select count(*) from pg_policies where tablename in ('generation_jobs','generated_prompts','prompt_sessions') and coalesce(qual,'') || coalesce(with_check,'') like '%server_request_ok%'")" "11"
check "no row was touched" "$(q "select (select count(*) from generation_jobs) || '/' || (select count(*) from generated_prompts) || '/' || (select count(*) from prompt_sessions)")" "3/1/1"

echo "a member's browser (no server token)"
check "reads no job, not even its own" "$(as_user $U1 "$BROWSER" "select count(*) from public.generation_jobs")" "0"
check "reads no concept (engine text, descriptions)" "$(as_user $U1 "$BROWSER" "select count(*) from public.generated_prompts")" "0"
check "reads no session (analysis, product lock)" "$(as_user $U1 "$BROWSER" "select count(*) from public.prompt_sessions")" "0"
check "cannot update a job (origin, settings, status)" "$(as_user $U1 "$BROWSER" "with u as (update public.generation_jobs set prompt_origin = 'custom' returning 1) select count(*) from u")" "0"
check "cannot insert a job" "$(as_user $U1 "$BROWSER" "insert into public.generation_jobs (workspace_id, user_id) values ('$W1', '$U1')" | grep -c 'row-level security')" "1"
check "cannot rewrite a concept" "$(as_user $U1 "$BROWSER" "with u as (update public.generated_prompts set prompt_text = 'x' returning 1) select count(*) from u")" "0"
check "a forged token is a browser" "$(as_user $U1 "$FORGED" "select count(*) from public.generation_jobs")" "0"

echo "the application (same member, server token)"
check "reads its own workspace's jobs" "$(as_user $U1 "$SERVER" "select count(*) from public.generation_jobs")" "2"
check "…never another workspace's" "$(as_user $U1 "$SERVER" "select count(*) from public.generation_jobs where workspace_id = '$W2'")" "0"
check "reads its concepts and sessions (the engine works)" "$(as_user $U1 "$SERVER" "select (select count(*) from public.generated_prompts) + (select count(*) from public.prompt_sessions)")" "2"
check "inserts a job for its own workspace" "$(as_user $U1 "$SERVER" "with i as (insert into public.generation_jobs (workspace_id, user_id) values ('$W1', '$U1') returning 1) select count(*) from i")" "1"
check "…not for another workspace" "$(as_user $U1 "$SERVER" "insert into public.generation_jobs (workspace_id, user_id) values ('$W2', '$U1')" | grep -c 'row-level security')" "1"
check "updates its own job" "$(as_user $U1 "$SERVER" "with u as (update public.generation_jobs set status = 'completed' where workspace_id = '$W1' returning 1) select count(*) from u")" "3"

echo "admins and definer functions"
check "an admin still reads directly (diagnostics)" "$(as_user $UA "$BROWSER" "select count(*) from public.generation_jobs")" "4"
check "a definer function the browser calls is unaffected" "$(as_user $U1 "$BROWSER" "select public.my_job_count()")" "3"

if [ "$fails" -gt 0 ]; then echo "$fails PROMPT-PRIVACY SQL TEST(S) FAILED"; exit 1; fi
echo "All prompt privacy SQL tests passed."
