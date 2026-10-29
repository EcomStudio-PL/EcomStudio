#!/usr/bin/env bash
#
# GROVBASE SHOT V2 (0162), PROVEN AGAINST A REAL POSTGRES.
#
# 0161 and 0162 are loaded VERBATIM (0162 twice: it must re-run cleanly) on
# the shape of the tables they touch; the helpers come from the migrations
# that ship them (is_admin / is_workspace_member from 0002, server_call_ok
# from 0077). What has to hold:
#   · an order is created only with the server token AND the member's own
#     session; an admin test only by an admin; a double click is one order;
#   · the open-run, hourly and "analysed but never charged" caps refuse
#     before anything exists; the balance must cover this order on top of
#     what the member's other open orders may still charge;
#   · the plan's parallel-generation guard counts an order as ONE operation
#     (an admin test is not a customer generation);
#   · the customer's view is a closed vocabulary: per shot delivered /
#     not_delivered (+ reason, refunded) / working / queued, notes as codes,
#     never input, progress, a prompt, a verdict text, a model or a cost;
#   · analysis reuse returns only finished runs of the same workspace and the
#     same photo bytes (and description, for the card), server only;
#   · 👍/👎 on a shot pins the run only from a SUCCEEDED ledger event;
#   · the flag is seeded OFF for admins, and a re-run never overwrites it.
#
# Local harness only, its own database, removed on exit (KEEP_DB=1 keeps it).
#
#   bash scripts/pg-harness-up.sh && npm run test:grovshot2:sql
set -euo pipefail

PGSOCK="${PGSOCK:-/tmp/pgtest}"
PGPORT="${PGPORT:-5433}"
DB="${GROVSHOT2_DB:-grovshot2_sqltest}"
PSQL0=(psql -h "$PGSOCK" -p "$PGPORT" -U postgres -v ON_ERROR_STOP=1 -X -q -t -A)
PSQL=("${PSQL0[@]}" -d "$DB")

if ! "${PSQL0[@]}" -d postgres -c 'select 1' >/dev/null 2>&1; then
  echo "grovshot2-sql: no harness on $PGSOCK:$PGPORT — run: bash scripts/pg-harness-up.sh" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
M="$ROOT/supabase/migrations"
for f in 0161_generations_inflight_v2.sql 0162_grovshot_engine_v2.sql; do
  [ -f "$M/$f" ] || { echo "grovshot2-sql: $M/$f not found" >&2; exit 2; }
done
extract() { # file, function name, end marker regex
  awk -v start="^create (or replace )?function public[.]$2[(]" -v stop="$3" \
    '$0 ~ start {on=1} on {print} on && $0 ~ stop {exit}' "$1"
}
IS_ADMIN=$(extract "$M/0002_functions_and_triggers.sql" is_admin '^[$][$];')
IS_MEMBER=$(extract "$M/0002_functions_and_triggers.sql" is_workspace_member '^[$][$];')
SERVER_CALL_OK=$(extract "$M/0077_server_only_rpcs.sql" server_call_ok '^end [$][$];')
for v in IS_ADMIN IS_MEMBER SERVER_CALL_OK; do
  [ -n "${!v}" ] || { echo "grovshot2-sql: could not extract $v" >&2; exit 2; }
done

cleanup() { [ "${KEEP_DB:-0}" = "1" ] || "${PSQL0[@]}" -d postgres -c "drop database if exists $DB with (force)" >/dev/null 2>&1 || true; }
trap cleanup EXIT
PGOPTIONS="-c client_min_messages=warning" "${PSQL0[@]}" -d postgres -c "drop database if exists $DB with (force)" >/dev/null
"${PSQL0[@]}" -d postgres -c "create database $DB" >/dev/null

fails=0
check() { if [ "$2" = "$3" ]; then echo "  ✓ $1"; else echo "  ✗ $1 — got [$2], expected [$3]"; fails=$((fails+1)); fi; }
q() { "${PSQL[@]}" -c "$1"; }
# As a signed-in member (the role PostgREST uses), the error text or the value.
as_user() { "${PSQL[@]}" -c "set role authenticated; set request.jwt.claim.sub = '$1'; $2" 2>&1 | sed -n 's/^.*ERROR:  //p;/ERROR/!p' | head -1; }
TOKEN='the-right-dispatch-token'

U1=00000000-0000-0000-0000-000000000001   # member of W1 (free plan, 100 credits)
U2=00000000-0000-0000-0000-000000000002   # member of W2 (pro plan, 30 credits)
U3=00000000-0000-0000-0000-000000000003   # a stranger to both
UA=00000000-0000-0000-0000-00000000000a   # admin, member of W2
W1=20000000-0000-0000-0000-000000000001
W2=20000000-0000-0000-0000-000000000002
W3=20000000-0000-0000-0000-000000000003

"${PSQL[@]}" >/dev/null <<SQL
set client_min_messages = warning;
create schema auth; create schema extensions;
create extension if not exists pgcrypto with schema public;
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end \$\$;
grant usage on schema public, auth, extensions to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
create function auth.uid() returns uuid language sql stable as
  \$f\$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid \$f\$;

create table public.app_settings (key text primary key, value jsonb not null default '{}'::jsonb);
insert into public.app_settings values
  ('notifications', jsonb_build_object('dispatch_hash', encode(digest('$TOKEN', 'sha256'), 'hex')));
create table public.profiles (id uuid primary key, role text not null default 'user');
create table public.workspaces (id uuid primary key);
create table public.workspace_members (workspace_id uuid not null, user_id uuid not null, role text not null default 'owner');
$IS_ADMIN
$IS_MEMBER
$SERVER_CALL_OK

create table public.subscription_plans (
  id uuid primary key default gen_random_uuid(), slug text unique, name text, limits jsonb default '{}'::jsonb);
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, plan_id uuid references public.subscription_plans(id),
  status text not null, created_at timestamptz not null default now());
create table public.ai_models (id uuid primary key default gen_random_uuid(), model_identifier text);
create table public.generation_jobs (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, user_id uuid, model_id uuid, provider_slug text,
  status text not null default 'queued', quantity integer default 1, settings jsonb default '{}'::jsonb,
  started_at timestamptz, completed_at timestamptz, created_at timestamptz not null default now());
create table public.credit_wallets (id uuid primary key default gen_random_uuid(), workspace_id uuid, balance integer);
create table public.tool_guides (tool_key text primary key, content jsonb);

-- ai_engine_runs as 0126 + 0129 + 0139 leave it (the columns 0161/0162 use).
create table public.ai_engine_runs (
  id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
  tool_key text not null, workspace_id uuid, user_id uuid, job_id uuid,
  mode text not null check (mode in ('off', 'grovbase', 'user', 'hybrid', 'workflow')),
  status text not null check (status in ('queued', 'running', 'ok', 'partial', 'failed', 'blocked')),
  error text check (error is null or char_length(error) <= 80),
  engine_version text, prompt_version integer, workflow_version integer, model_label text,
  credits integer, api_cost_usd_micros bigint, duration_ms integer,
  run_kind text not null default 'trace', idempotency_key text,
  input jsonb not null default '{}'::jsonb, outputs jsonb not null default '[]'::jsonb, progress jsonb not null default '{}'::jsonb,
  expected_outputs integer, locked_until timestamptz, lease_owner text,
  invocations integer not null default 0, cost_unknown integer not null default 0,
  updated_at timestamptz not null default now(), finished_at timestamptz);
alter table public.ai_engine_runs add constraint ai_engine_runs_v2_check check (
  run_kind in ('trace', 'workflow', 'workflow_test', 'thumbnail')
  and (idempotency_key is null or char_length(idempotency_key) between 8 and 200)
  and jsonb_typeof(input) = 'object' and jsonb_typeof(outputs) = 'array' and jsonb_typeof(progress) = 'object'
  and (expected_outputs is null or expected_outputs between 1 and 50)
  and (lease_owner is null or char_length(lease_owner) <= 80)
  and invocations >= 0 and cost_unknown >= 0
  and (api_cost_usd_micros is null or api_cost_usd_micros >= 0));
create unique index ai_engine_runs_idem_uq on public.ai_engine_runs (idempotency_key) where idempotency_key is not null;
create table public.ai_engine_step_runs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_engine_runs(id) on delete cascade,
  "position" smallint not null check ("position" between 1 and 50),
  item_index smallint not null default -1 check (item_index between -1 and 49),
  operation text not null default 'tool',
  status text not null default 'pending' check (status in ('pending', 'running', 'succeeded', 'failed', 'skipped')),
  attempts smallint not null default 0,
  cost_usd_micros bigint, cost_basis text not null default 'unknown',
  error_code text check (error_code is null or error_code ~ '^[a-z0-9_:.\-]{1,80}$'),
  output jsonb, created_at timestamptz not null default now(),
  unique (run_id, "position", item_index));

create table public.ai_tools (tool_key text primary key, service_slug text, engine_mode text, notes text);
create table public.feature_flags (
  id uuid primary key default gen_random_uuid(), flag text not null unique, enabled boolean not null default false,
  plans text[], roles text[], rollout_percent int, description text, created_at timestamptz not null default now());
create table public.usage_events (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, generation_job_id uuid,
  status text not null, credits_charged integer not null default 0, metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now());
create table public.generation_feedback (
  id uuid primary key default gen_random_uuid(), generation_job_id uuid not null, workspace_id uuid not null,
  user_id uuid, verdict text not null,
  engine_run_id uuid, tool_key text, workflow_version integer, prompt_version integer, model_label text, provider_slug text);

insert into public.profiles (id, role) values ('$U1', 'user'), ('$U2', 'user'), ('$U3', 'user'), ('$UA', 'admin');
insert into public.workspaces values ('$W1'), ('$W2'), ('$W3');
insert into public.workspace_members (workspace_id, user_id) values ('$W1', '$U1'), ('$W2', '$U2'), ('$W2', '$UA'), ('$W3', '$U3');
insert into public.subscription_plans (id, slug, name) values
  ('10000000-0000-0000-0000-000000000000', 'free', 'Free'),
  ('10000000-0000-0000-0000-000000000002', 'pro', 'Pro');
insert into public.subscriptions (workspace_id, plan_id, status) values ('$W2', '10000000-0000-0000-0000-000000000002', 'active');
insert into public.credit_wallets (workspace_id, balance) values ('$W1', 100), ('$W2', 30), ('$W3', 100);
SQL

PGOPTIONS="-c client_min_messages=warning" "${PSQL[@]}" -f "$M/0161_generations_inflight_v2.sql" >/dev/null
PGOPTIONS="-c client_min_messages=warning" "${PSQL[@]}" -f "$M/0162_grovshot_engine_v2.sql" >/dev/null
q "update public.feature_flags set enabled = true where flag = 'grovshot_engine_v2'" >/dev/null
PGOPTIONS="-c client_min_messages=warning" "${PSQL[@]}" -f "$M/0162_grovshot_engine_v2.sql" >/dev/null && echo "  ✓ 0162 applies and re-runs cleanly"
"${PSQL[@]}" >/dev/null <<'SQL'
create trigger generation_feedback_pin before insert or update of verdict on public.generation_feedback
  for each row execute function public.generation_feedback_pin();
SQL

# create(user, workspace, key, shots, total[, kind]) → the RPC's answer or the error text
create() {
  as_user "$1" "select public.grovshot_run_create('${7:-$TOKEN}', jsonb_build_object(
    'workspace_id', '$2', 'idempotency_key', '$3', 'shots', $4, 'run_kind', '${6:-grovshot}',
    'engine_version', 'grovshot-v2.1', 'prompt_version', 3, 'runs_per_hour', ${8:-20}, 'uncharged_per_day', ${9:-30},
    'input', jsonb_build_object('engine', 'grovshot_v2', 'aspect_ratio', '4:5', 'photo_key', 'pk-$3-0123456789',
      'quote', jsonb_build_object('unit', 7, 'total', $5))))::text"
}
field() { echo "$1" | sed -n "s/.*\"$2\": *\"\{0,1\}\([^,\"}]*\).*/\1/p"; }

echo "A. CREATING AN ORDER"
check "the constraint knows the two new kinds" \
  "$(q "select pg_get_constraintdef(oid) ~ 'grovshot_test' from pg_constraint where conname = 'ai_engine_runs_v2_check'")" "t"
check "an unknown kind is still refused" \
  "$(q "do \$\$ begin insert into public.ai_engine_runs (tool_key, mode, status, run_kind) values ('x', 'grovbase', 'queued', 'bogus'); exception when check_violation then raise notice 'refused'; end \$\$;" 2>&1 | grep -c refused)" "1"
check "without the server token: refused (raises)" "$(create $U1 $W1 order-key-001 3 21 grovshot wrong-token)" "forbidden"
check "anonymous: unauthenticated" \
  "$(as_user '' "select public.grovshot_run_create('$TOKEN', jsonb_build_object('workspace_id', '$W1'))->>'error'")" "unauthenticated"
check "a stranger's workspace: forbidden" "$(field "$(create $U3 $W1 order-key-002 3 21)" error)" "forbidden"
check "an admin test by a customer: forbidden" "$(field "$(create $U1 $W1 order-key-003 3 0 grovshot_test)" error)" "forbidden"
check "shots outside 1–10: invalid_input" "$(field "$(create $U1 $W1 order-key-004 11 77)" error)" "invalid_input"
check "a short key: invalid_input" "$(field "$(create $U1 $W1 short 3 21)" error)" "invalid_input"
check "more than the balance (100): insufficient_credits" "$(field "$(create $U1 $W1 order-key-005 10 120)" error)" "insufficient_credits"
check "…with what is missing" "$(field "$(create $U1 $W1 order-key-005 10 120)" missing)" "20"
R1=$(create $U1 $W1 order-key-006 3 21)
ID1=$(field "$R1" id)
check "created: queued, as prompts / grovbase, nothing charged" \
  "$(q "select status || '/' || tool_key || '/' || mode || '/' || run_kind || '/' || credits || '/' || expected_outputs || '/' || (progress->>'stage') from public.ai_engine_runs where id = '$ID1'")" \
  "queued/prompts/grovbase/grovshot/0/3/analyze"
check "the run belongs to the session's user, never to an id the body names" \
  "$(q "select user_id = '$U1' and workspace_id = '$W1' from public.ai_engine_runs where id = '$ID1'")" "t"
check "a double click: the same order" "$(field "$(create $U1 $W1 order-key-006 3 21)" id)" "$ID1"
check "…not a new one" "$(field "$(create $U1 $W1 order-key-006 3 21)" created)" "false"
check "free plan, one order open: the plan's limit refuses the second order (one operation)" \
  "$(create $U1 $W1 order-key-007 3 21)" "generation_limit_reached:1"
check "…and nothing was written" "$(q "select count(*) from public.ai_engine_runs where workspace_id = '$W1'")" "1"
q "update public.ai_engine_runs set status = 'ok', credits = 21, finished_at = now() where id = '$ID1'" >/dev/null
R1b=$(create $U1 $W1 order-key-006 3 21)
check "the same content again after it finished: a NEW order (asked for on purpose)" \
  "$( [ "$(field "$R1b" id)" != "$ID1" ] && [ "$(field "$R1b" created)" = "true" ] && echo new)" "new"
q "update public.ai_engine_runs set status = 'ok', finished_at = now() where workspace_id = '$W1' and status = 'queued'" >/dev/null

echo "B. THE CAPS AND THE BALANCE"
# W2: pro plan (3 parallel), 30 credits.
A=$(field "$(create $U2 $W2 order-key-101 2 14)" id)
check "pro: a first order with 14 of 30 credits" "$( [ -n "$A" ] && echo ok)" "ok"
check "a second whose total exceeds 30 − 14 still owed: insufficient_credits (16 left, 21 asked)" \
  "$(field "$(create $U2 $W2 order-key-102 3 21)" error)" "insufficient_credits"
check "…missing 5" "$(field "$(create $U2 $W2 order-key-102 3 21)" missing)" "5"
q "update public.ai_engine_runs set credits = 7 where id = '$A'" >/dev/null
check "what an open order already charged no longer counts as owed (30 − 7 owed = 23 ≥ 21)" \
  "$( [ -n "$(field "$(create $U2 $W2 order-key-102 3 21)" id)" ] && echo ok)" "ok"
q "update public.credit_wallets set balance = 500 where workspace_id = '$W2'" >/dev/null
check "two open orders: too_many_runs (before the plan's 3)" "$(field "$(create $U2 $W2 order-key-103 1 7)" error)" "too_many_runs"
q "update public.ai_engine_runs set status = 'ok', finished_at = now() where workspace_id = '$W2'" >/dev/null
check "an hour's cap (published config: 2/h, 2 created this hour): rate_limited" \
  "$(field "$(create $U2 $W2 order-key-104 1 7 grovshot "$TOKEN" 2)" error)" "rate_limited"
q "update public.ai_engine_runs set created_at = now() - interval '3 hours' where workspace_id = '$W2'" >/dev/null
q "insert into public.ai_engine_runs (tool_key, workspace_id, user_id, mode, status, run_kind, credits, created_at)
   select 'prompts', '$W2', '$U2', 'grovbase', s, 'grovshot', 0, now() - interval '2 hours'
     from unnest(array['blocked', 'failed']) s" >/dev/null
check "analysed but never charged today (2, cap 2): analysis_limit" \
  "$(field "$(create $U2 $W2 order-key-105 1 7 grovshot "$TOKEN" 20 2)" error)" "analysis_limit"
check "…a failed order that charged something is not counted" \
  "$(q "update public.ai_engine_runs set credits = 7 where workspace_id = '$W2' and status = 'failed'" >/dev/null; [ -n "$(field "$(create $U2 $W2 order-key-105 1 7 grovshot "$TOKEN" 20 2)" id)" ] && echo ok)" "ok"
T=$(field "$(create $UA $W2 test-key-0001 2 0 grovshot_test)" id)
check "an admin test: created, never counted as a customer generation" \
  "$( [ -n "$T" ] && q "select count(*) from public.generation_active_operations('$W2') where op_key = '$T'")" "0"
check "the order counts as ONE operation in the plan's guard" \
  "$(q "select count(*) from public.generation_active_operations('$W2') where kind = 'grovshot'")" "1"

echo "C. THE CUSTOMER'S VIEW"
O=$(field "$(create $U3 $W3 order-key-201 3 21)" id)
q "update public.ai_engine_runs set status = 'running', progress = jsonb_build_object('stage', 'images', 'planned', 3,
     'notes', jsonb_build_array(jsonb_build_object('code', 'photo_blurry', 'photo', 2), jsonb_build_object('code', 'Evil <b>', 'photo', 1),
       jsonb_build_object('code', 'dimensions_estimated', 'photo', 11, 'ask', true)), 'card', 'SECRET CARD', 'prompt', 'SECRET PROMPT'),
     input = input || '{\"prompt\":\"SECRET INPUT\"}'::jsonb where id = '$O'" >/dev/null
J=30000000-0000-0000-0000-000000000001
q "insert into public.ai_engine_step_runs (run_id, \"position\", item_index, status, output, error_code) values
   ('$O', 9, 0, 'succeeded', '{\"job_id\":\"$J\",\"verdict\":\"warning\"}', null),
   ('$O', 5, 5, 'succeeded', '{\"decision\":\"rejected\"}', null),
   ('$O', 6, 6, 'succeeded', '{\"job_id\":\"x\"}', null),
   ('$O', 7, 6, 'failed', null, 'storage_failed'),
   ('$O', 9, 1, 'failed', null, 'qc_rejected'),
   ('$O', 5, 10, 'running', null, null)" >/dev/null
S=$(as_user $U3 "select public.grovshot_run_status('$O')::text")
check "shot 1: delivered, with its job" "$(as_user $U3 "select (public.grovshot_run_status('$O')->'shots'->0->>'state') || '/' || (public.grovshot_run_status('$O')->'shots'->0->>'job_id')")" "delivered/$J"
check "shot 2: not delivered, quality_failed, its released charge refunded (charge slot 1 of the shot)" \
  "$(as_user $U3 "select (s->>'state') || '/' || (s->>'reason') || '/' || (s->>'refunded') from (select public.grovshot_run_status('$O')->'shots'->1 s) x")" "not_delivered/quality_failed/true"
check "shot 3: a round in flight → working" "$(as_user $U3 "select public.grovshot_run_status('$O')->'shots'->2->>'state'")" "working"
check "notes: codes and photo numbers only (a bad code and photo 11 dropped)" \
  "$(as_user $U3 "select public.grovshot_run_status('$O')->'notes'")" '[{"code": "photo_blurry", "photo": 2}, {"ask": true, "code": "dimensions_estimated"}]'
check "nothing of input / progress / card / prompt / verdict reaches the customer" \
  "$(echo "$S" | grep -c -E 'SECRET|verdict|warning|photo_key|quote')" "0"
check "the keys are exactly the closed set" \
  "$(as_user $U3 "select string_agg(k, ',' order by k) from jsonb_object_keys(public.grovshot_run_status('$O')) k")" \
  "created_at,credits,driving,error,finished_at,id,kind,notes,ordered,shots,stage,status"
check "another member's order: nothing" "$(as_user $U1 "select coalesce(public.grovshot_run_status('$O')::text, 'null')")" "null"
q "update public.ai_engine_runs set status = 'failed', error = 'provider said: secret quota' where id = '$O'" >/dev/null
check "an error outside the vocabulary: common_error" "$(as_user $U3 "select public.grovshot_run_status('$O')->>'error'")" "common_error"
q "update public.ai_engine_runs set status = 'blocked', error = 'needs_dimensions', progress = '{\"stage\":\"attention\"}' where id = '$O'" >/dev/null
check "a stop for the customer's input: its code, and no shots (no plan existed)" \
  "$(as_user $U3 "select (public.grovshot_run_status('$O')->>'error') || '/' || jsonb_array_length(public.grovshot_run_status('$O')->'shots')")" "needs_dimensions/0"
check "an unknown stage is not echoed" \
  "$(q "update public.ai_engine_runs set progress = '{\"stage\":\"<script>\"}' where id = '$O'" >/dev/null; as_user $U3 "select coalesce(public.grovshot_run_status('$O')->>'stage', 'null')")" "null"
check "an admin test's delivered shot carries no job id (nothing in the library)" \
  "$(q "insert into public.ai_engine_step_runs (run_id, \"position\", item_index, status, output) values ('$T', 9, 0, 'succeeded', '{\"job_id\":\"$J\"}')" >/dev/null; as_user $UA "select coalesce(public.grovshot_run_status('$T')->'shots'->0->>'job_id', 'null')")" "null"
check "a member cannot call the internal shot reader" \
  "$(as_user $U3 "select public.grovshot_shot_states(r) from public.ai_engine_runs r limit 1" | grep -c 'permission denied')" "1"
check "…nor the plan's operation counter" \
  "$(as_user $U3 "select count(*) from public.generation_active_operations('$W3')" | grep -c 'permission denied')" "1"

echo "D. THE TILES"
O2=$(field "$(create $U1 $W1 order-key-301 2 14)" id)
q "update public.ai_engine_runs set status = 'running', progress = '{\"stage\":\"qc\",\"planned\":2}', input = input || '{\"aspect_ratio\":\"4:5; drop\"}'::jsonb where id = '$O2'" >/dev/null
q "insert into public.ai_engine_step_runs (run_id, \"position\", item_index, status, output) values ('$O2', 9, 0, 'succeeded', '{}'), ('$O2', 9, 1, 'failed', null)" >/dev/null
check "own open orders: stage, planned, delivered / settled, a forged ratio dropped" \
  "$(as_user $U1 "select (x->>'stage') || '/' || (x->>'planned') || '/' || (x->>'delivered') || '/' || (x->>'settled') || '/' || coalesce(x->>'ratio', 'null') from jsonb_array_elements(public.grovshot_runs_active('$W1')) x")" "qc/2/1/2/null"
check "another member's workspace: nothing" "$(as_user $U3 "select jsonb_array_length(public.grovshot_runs_active('$W1'))")" "0"
check "an admin test is never a customer tile" "$(as_user $UA "select jsonb_array_length(public.grovshot_runs_active('$W2'))")" "0"

echo "E. ANALYSIS REUSE (server only)"
q "update public.ai_engine_runs set status = 'ok', input = input || '{\"photo_key\":\"photo-key-aaaaaaaaaa\",\"card_key\":\"card-key-bbbbbbbbbbbb\"}'::jsonb where id = '$O2'" >/dev/null
q "insert into public.ai_engine_step_runs (run_id, \"position\", item_index, status, output) values
   ('$O2', 1, -1, 'succeeded', '{\"v\":\"validated\"}'), ('$O2', 2, -1, 'succeeded', '{\"c\":\"card\"}')" >/dev/null
look() { as_user "$1" "select public.grovshot_analysis_lookup('${5:-$TOKEN}', '$2', '$3', $4)::text"; }
check "without the token: refused" "$(look $U1 $W1 photo-key-aaaaaaaaaa null wrong)" "forbidden"
check "the same photo bytes: the photo check comes back" "$(look $U1 $W1 photo-key-aaaaaaaaaa null)" '{"card": null, "validate": {"v": "validated"}}'
check "the same description too: the card as well" "$(look $U1 $W1 photo-key-aaaaaaaaaa "'card-key-bbbbbbbbbbbb'")" '{"card": {"c": "card"}, "validate": {"v": "validated"}}'
check "another workspace never sees it" "$(look $U3 $W1 photo-key-aaaaaaaaaa null)" '{"error": "forbidden"}'
check "a different photo: nothing" "$(look $U1 $W1 photo-key-zzzzzzzzzz null)" '{"card": null, "validate": null}'
q "update public.ai_engine_runs set status = 'running' where id = '$O2'" >/dev/null
check "an order still open is not reused" "$(look $U1 $W1 photo-key-aaaaaaaaaa null)" '{"card": null, "validate": null}'
q "update public.ai_engine_runs set status = 'ok' where id = '$O2'" >/dev/null

echo "F. 👍/👎 PINNED FROM THE LEDGER"
JOB=$(q "insert into public.generation_jobs (workspace_id, user_id, status, settings) values ('$W1', '$U1', 'completed', '{\"run_id\":\"$O\"}') returning id")
q "insert into public.usage_events (workspace_id, generation_job_id, status, credits_charged, metadata)
   values ('$W1', '$JOB', 'refunded', 7, jsonb_build_object('operation', 'grovshot_v2', 'run_id', '$O2'))" >/dev/null
check "a refunded charge pins nothing (and the member-writable job row never does)" \
  "$(q "insert into public.generation_feedback (generation_job_id, workspace_id, verdict) values ('$JOB', '$W1', 'like') returning coalesce(engine_run_id::text, 'null')")" "null"
q "update public.usage_events set status = 'succeeded' where generation_job_id = '$JOB'" >/dev/null
check "a succeeded charge pins its order" \
  "$(q "update public.generation_feedback set verdict = 'dislike' where generation_job_id = '$JOB' returning engine_run_id::text || '/' || tool_key || '/' || prompt_version")" "$O2/prompts/3"
JOB2=$(q "insert into public.generation_jobs (workspace_id, status) values ('$W3', 'completed') returning id")
q "insert into public.usage_events (workspace_id, generation_job_id, status, metadata)
   values ('$W3', '$JOB2', 'succeeded', jsonb_build_object('operation', 'grovshot_v2', 'run_id', '$O2'))" >/dev/null
check "an event naming another workspace's order pins nothing" \
  "$(q "insert into public.generation_feedback (generation_job_id, workspace_id, verdict) values ('$JOB2', '$W3', 'like') returning coalesce(engine_run_id::text, 'null')")" "null"

echo "G. SEEDS"
check "six stage keys, no prompt published by the migration" \
  "$(q "select count(*) from public.ai_tools where tool_key like 'grovshot_v2_%' and engine_mode = 'grovbase'")" "6"
check "the flag: admins only, and a re-run kept the admin's switch" \
  "$(q "select enabled || '/' || array_to_string(roles, ',') from public.feature_flags where flag = 'grovshot_engine_v2'")" "true/admin"
check "the customer RPCs are not callable anonymously" \
  "$(q "select has_function_privilege('anon', 'public.grovshot_run_status(uuid)', 'execute') or has_function_privilege('anon', 'public.grovshot_run_create(text, jsonb)', 'execute') or has_function_privilege('anon', 'public.grovshot_analysis_lookup(text, uuid, text, text)', 'execute')")" "f"

echo
if [ "$fails" -gt 0 ]; then echo "$fails GROVSHOT V2 SQL TEST(S) FAILED"; exit 1; fi
echo "All GrovShot V2 SQL tests passed."
