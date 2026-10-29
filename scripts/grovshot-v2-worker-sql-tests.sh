#!/usr/bin/env bash
#
# GROVBASE SHOT V2 — THE SERVER WORKER (0163), PROVEN AGAINST A REAL POSTGRES.
#
# 0163 is loaded VERBATIM (twice: it must re-run cleanly) on the shape of the
# tables it touches; the helpers come from the migrations that ship them
# (is_workspace_member 0002, server_call_ok 0077, the 0129 lease claim,
# server_request_ok 0157); the ledger's own functions are recorded stubs (the
# ledger is proven in test:ledger:sql). What has to hold:
#   · the server acts for an order ONLY with the token, an OPEN V2 order and
#     the caller's own LIVE lease — and then as that order's owner;
#   · each function is tied to THAT order: its jobs, its idempotency prefix,
#     its quoted unit; an admin TEST order never charges or writes customer rows;
#   · storage: only the order's own photos (read) and its own job folders are
#     armed, for minutes, and an anonymous storage request passes RLS only for
#     an armed object of an order whose lease is live;
#   · the worker's queue lists only orders nobody drives; the door functions are
#     the anonymous role's, the scope is nobody's.
#
# Local harness only, its own database, removed on exit (KEEP_DB=1 keeps it).
#
#   bash scripts/pg-harness-up.sh && npm run test:grovshot2:worker:sql
set -euo pipefail

PGSOCK="${PGSOCK:-/tmp/pgtest}"
PGPORT="${PGPORT:-5433}"
DB="${GROVSHOT2W_DB:-grovshot2w_sqltest}"
PSQL0=(psql -h "$PGSOCK" -p "$PGPORT" -U postgres -v ON_ERROR_STOP=1 -X -q -t -A)
PSQL=("${PSQL0[@]}" -d "$DB")

if ! "${PSQL0[@]}" -d postgres -c 'select 1' >/dev/null 2>&1; then
  echo "grovshot2-worker-sql: no harness on $PGSOCK:$PGPORT — run: bash scripts/pg-harness-up.sh" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
M="$ROOT/supabase/migrations"
F="$M/0163_grovshot_v2_worker.sql"
[ -f "$F" ] || { echo "grovshot2-worker-sql: $F not found" >&2; exit 2; }
extract() { # file, function name, end marker regex
  awk -v start="^create (or replace )?function public[.]$2[(]" -v stop="$3" \
    '$0 ~ start {on=1} on {print} on && $0 ~ stop {exit}' "$1"
}
IS_MEMBER=$(extract "$M/0002_functions_and_triggers.sql" is_workspace_member '^[$][$];')
SERVER_CALL_OK=$(extract "$M/0077_server_only_rpcs.sql" server_call_ok '^end [$][$];')
SERVER_REQUEST_OK=$(extract "$M/0157_public_tool_reads.sql" server_request_ok '^end [$][$];')
RUN_CLAIM=$(extract "$M/0129_workflow_engine_v2.sql" ai_engine_run_claim '^end [$][$];')
for v in IS_MEMBER SERVER_CALL_OK SERVER_REQUEST_OK RUN_CLAIM; do
  [ -n "${!v}" ] || { echo "grovshot2-worker-sql: could not extract $v" >&2; exit 2; }
done

cleanup() { [ "${KEEP_DB:-0}" = "1" ] || "${PSQL0[@]}" -d postgres -c "drop database if exists $DB with (force)" >/dev/null 2>&1 || true; }
trap cleanup EXIT
PGOPTIONS="-c client_min_messages=warning" "${PSQL0[@]}" -d postgres -c "drop database if exists $DB with (force)" >/dev/null
"${PSQL0[@]}" -d postgres -c "create database $DB" >/dev/null

fails=0
check() { if [ "$2" = "$3" ]; then echo "  ✓ $1"; else echo "  ✗ $1 — got [$2], expected [$3]"; fails=$((fails+1)); fi; }
q() { "${PSQL[@]}" -c "$1"; }
# As the anonymous role PostgREST uses for the server's own client (no JWT),
# with the server header when given: the error text or the value.
as_anon() {
  local out
  out=$("${PSQL[@]}" -c "set role anon; select set_config('request.headers', '${2:-{\}}', false); $1" 2>&1 || true)
  if echo "$out" | grep -q 'ERROR:'; then echo "$out" | sed -n 's/^.*ERROR:  //p' | head -1
  else echo "$out" | grep -v '^$' | tail -1; fi
}
TOKEN='the-right-dispatch-token'

U1=00000000-0000-0000-0000-000000000001   # owner of the customer order (W1)
U2=00000000-0000-0000-0000-000000000002   # someone else (W2)
UA=00000000-0000-0000-0000-00000000000a   # admin with a test order (W2)
W1=20000000-0000-0000-0000-000000000001
W2=20000000-0000-0000-0000-000000000002
R1=30000000-0000-0000-0000-000000000001   # customer order, W1, open
R2=30000000-0000-0000-0000-000000000002   # admin test order, W2, open
R3=30000000-0000-0000-0000-000000000003   # customer order of U2, W2, open
R4=30000000-0000-0000-0000-000000000004   # finished order
J2=40000000-0000-0000-0000-000000000002   # a job of R3

"${PSQL[@]}" >/dev/null <<SQL
set client_min_messages = warning;
create schema auth; create schema extensions; create schema storage; create schema vault;
create extension if not exists pgcrypto with schema public;
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end \$\$;
grant usage on schema public, auth, extensions, storage to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
create function auth.uid() returns uuid language sql stable as
  \$f\$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid \$f\$;

create table public.app_settings (key text primary key, value jsonb not null default '{}'::jsonb);
insert into public.app_settings values
  ('notifications', jsonb_build_object('dispatch_hash', encode(digest('$TOKEN', 'sha256'), 'hex')));
create table public.profiles (id uuid primary key, role text not null default 'user', blocked boolean, blocked_until timestamptz, blocked_reason text);
create table public.workspace_members (workspace_id uuid not null, user_id uuid not null, role text not null default 'owner');
$IS_MEMBER
$SERVER_CALL_OK
$SERVER_REQUEST_OK

create type public.job_status as enum ('queued', 'processing', 'completed', 'failed', 'cancelled');
create type public.quality_status as enum ('pending', 'passed', 'warning', 'failed');
create table public.credit_wallets (id uuid primary key default gen_random_uuid(), workspace_id uuid, balance integer);
create table public.ai_engine_runs (
  id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
  tool_key text not null default 'prompts', workspace_id uuid, user_id uuid, job_id uuid, usage_event_id uuid,
  status text not null, error text, run_kind text not null, input jsonb not null default '{}'::jsonb,
  outputs jsonb not null default '[]'::jsonb, progress jsonb not null default '{}'::jsonb,
  locked_until timestamptz, lease_owner text, invocations integer not null default 0,
  updated_at timestamptz not null default now(), finished_at timestamptz);
create table public.generation_jobs (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, user_id uuid, model_id uuid, provider_slug text,
  prompt_text text, aspect_ratio text, quantity integer, resolution text, prompt_id uuid, prompt_session_id uuid,
  prompt_origin text, status public.job_status not null default 'queued', started_at timestamptz, completed_at timestamptz,
  reference_image_ids uuid[], settings jsonb default '{}'::jsonb, credits_charged integer, error_message text,
  error_class text, latency_ms integer, created_at timestamptz not null default now());
create table public.generations (id uuid primary key default gen_random_uuid(), job_id uuid, workspace_id uuid,
  quality_status public.quality_status, product_match_score numeric, created_at timestamptz not null default now());
create table public.generation_assets (id uuid primary key default gen_random_uuid(), generation_id uuid, asset_type text,
  storage_path text, width integer, height integer, metadata jsonb);
create table public.prompt_sessions (id uuid primary key default gen_random_uuid(), workspace_id uuid, user_id uuid, product_id uuid,
  product_name text, description text, extra_info text, aspect_ratio text, style text, resolution text, reference_paths text[],
  status text, mode text, session_type text);
create table public.generated_prompts (id uuid primary key default gen_random_uuid(), product_id uuid, workspace_id uuid, session_id uuid,
  concept_name text, shot_type text, scene_type text, customer_title text, customer_description text, prompt_text text,
  negative_prompt text, prompt_encrypted text, prompt_iv text, prompt_tag text, primary_reference text, supporting_references jsonb,
  reference_indices integer[], reference_image_ids uuid[], reference_rationale text, format text, style text, priority integer,
  status text, lock_strength text, model_id uuid, last_job_id uuid, generation_count integer);
create table public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid, type text, title text, body text,
  href text, meta jsonb, dedupe_key text unique);
create table public.usage_events (id uuid primary key default gen_random_uuid(), workspace_id uuid, generation_job_id uuid,
  status text, credits_charged integer, idempotency_key text, metadata jsonb, created_at timestamptz not null default now());
create table public.activity (workspace_id uuid, action text, actor uuid, metadata jsonb);
create table public.provider_health (provider_slug text primary key, state text);
alter table public.provider_health enable row level security;
create table public.ai_token_prices (provider_slug text, model text, input_usd_micros_per_mtok bigint, output_usd_micros_per_mtok bigint,
  cached_input_usd_micros_per_mtok bigint, unique (provider_slug, model));
insert into public.ai_token_prices values ('anthropic', 'claude-opus-5-5', 1, 1, null);  -- an admin's own edit
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to anon, authenticated;
create view vault.decrypted_secrets as select null::text as name, null::text as decrypted_secret where false;

-- The 0129 lease claim, verbatim; the other run-store doors as signatures.
$RUN_CLAIM
create function public.ai_engine_run_read(p_token text, p_run_id uuid) returns setof public.ai_engine_runs language sql as \$f\$ select * from public.ai_engine_runs where false \$f\$;
create function public.ai_engine_step_runs_read(p_token text, p_run_id uuid) returns setof jsonb language sql as \$f\$ select null::jsonb where false \$f\$;
create function public.ai_engine_run_patch(p_token text, p_run_id uuid, p_owner text, p_patch jsonb) returns boolean language sql as \$f\$ select false \$f\$;
create function public.ai_engine_step_begin(p_token text, p_run_id uuid, p_owner text, p_position integer, p_item integer, p_name text, p_operation text, p_lease_seconds integer) returns jsonb language sql as \$f\$ select null::jsonb \$f\$;
create function public.ai_engine_step_finish(p_token text, p_run_id uuid, p_owner text, p_position integer, p_item integer, p_result jsonb) returns boolean language sql as \$f\$ select false \$f\$;
create function public.provider_health_set(p_token text, p_slug text, p_state text, p_secs integer, p_code text) returns void language sql as \$f\$ select \$f\$;
revoke all on function public.ai_engine_run_claim(text, uuid, text, integer) from public, anon;
revoke all on function public.ai_engine_run_read(text, uuid) from public, anon;

-- The ledger's doors, recorded (their own rules are test:ledger:sql's).
create function public.usage_event_start(p_token text, p_user_id uuid, p_workspace_id uuid, p_wallet_id uuid, p_service_slug text,
  p_credits integer default null, p_provider_slug text default null, p_model_slug text default null, p_generation_job_id uuid default null,
  p_idempotency_key text default null, p_metadata jsonb default '{}'::jsonb) returns table (event_id uuid, status text)
language plpgsql security definer set search_path = public as \$f\$
declare v_id uuid;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if auth.uid() is distinct from p_user_id or not public.is_workspace_member(p_workspace_id) then return query select null::uuid, 'forbidden'::text; return; end if;
  insert into public.usage_events (workspace_id, generation_job_id, status, credits_charged, idempotency_key, metadata)
  values (p_workspace_id, p_generation_job_id, 'pending', p_credits, p_idempotency_key, p_metadata) returning id into v_id;
  return query select v_id, 'ok'::text;
end \$f\$;
create function public.usage_event_complete(p_token text, p_event_id uuid, p_result_count integer, p_api_cost_usd_micros bigint,
  p_request_id text, p_provider_slug text, p_model_slug text) returns void language sql security definer set search_path = public as
  \$f\$ update public.usage_events set status = 'succeeded' where id = p_event_id and status = 'pending' \$f\$;
create function public.usage_event_fail(p_token text, p_event_id uuid, p_error text, p_api_cost_usd_micros bigint default 0) returns uuid
  language sql security definer set search_path = public as
  \$f\$ update public.usage_events set status = 'refunded' where id = p_event_id and status = 'pending' returning id \$f\$;
create function public.set_asset_derivatives(asset_id uuid, thumb_path text, preview_path text default null) returns text language sql as \$f\$ select 'ok' \$f\$;
create function public.log_activity(p_workspace_id uuid, p_action text, p_entity_type text default null, p_entity_id uuid default null,
  p_metadata jsonb default '{}'::jsonb, p_on_behalf_of uuid default null) returns void language sql security definer set search_path = public as
  \$f\$ insert into public.activity values (p_workspace_id, p_action, auth.uid(), p_metadata) \$f\$;
create function public.grovshot_analysis_lookup(p_token text, p_workspace_id uuid, p_photo_key text, p_card_key text) returns jsonb
  language sql as \$f\$ select jsonb_build_object('validate', null, 'card', null, 'ws', p_workspace_id) \$f\$;

insert into public.profiles (id, role) values ('$U1', 'user'), ('$U2', 'user'), ('$UA', 'admin');
insert into public.workspace_members (workspace_id, user_id) values ('$W1', '$U1'), ('$W2', '$U2'), ('$W2', '$UA');
insert into public.credit_wallets (workspace_id, balance) values ('$W1', 100), ('$W2', 30);
insert into public.ai_engine_runs (id, workspace_id, user_id, status, run_kind, input) values
  ('$R1', '$W1', '$U1', 'queued', 'grovshot', jsonb_build_object('photos', jsonb_build_array('$W1/p/1.png', '$W1/p/2.png'), 'quote', jsonb_build_object('unit', 7), 'aspect_ratio', '4:5')),
  ('$R2', '$W2', '$UA', 'queued', 'grovshot_test', jsonb_build_object('photos', jsonb_build_array('$W2/t/1.png'), 'quote', jsonb_build_object('unit', 7))),
  ('$R3', '$W2', '$U2', 'queued', 'grovshot', jsonb_build_object('photos', jsonb_build_array('$W2/p/9.png'), 'quote', jsonb_build_object('unit', 12))),
  ('$R4', '$W1', '$U1', 'ok', 'grovshot', '{}'::jsonb);
insert into public.generation_jobs (id, workspace_id, user_id, settings) values ('$J2', '$W2', '$U2', jsonb_build_object('run_id', '$R3'));
insert into storage.objects (bucket_id, name) values ('product-images', '$W1/p/1.png'), ('product-images', '$W1/p/3.png'), ('product-images', '$W2/p/9.png');
SQL

PGOPTIONS="-c client_min_messages=warning" "${PSQL[@]}" -f "$F" >/dev/null
q "update public.ai_token_prices set input_usd_micros_per_mtok = 1 where model = 'claude-opus-5-5'" >/dev/null
OUT=$(PGOPTIONS="-c client_min_messages=notice" "${PSQL[@]}" -f "$F" 2>&1 >/dev/null || echo FAILED)
check "0163 applies and re-runs cleanly (without pg_cron it says so and schedules nothing)" \
  "$(echo "$OUT" | grep -c 'FAILED')/$(echo "$OUT" | grep -c 'pg_cron is not installed')" "0/1"

# claim(run, owner) as the server (the anonymous client + the token): the 0129 lease
claim() { as_anon "select public.ai_engine_run_claim('$TOKEN', '$1', '$2', 120)->>'claimed'"; }
OWN1='gsv2:owner-of-r1'
OWN2='gsv2:owner-of-r2'
OWN3='gsv2:owner-of-r3'

echo "A. THE DOOR: TOKEN + OPEN ORDER + LIVE LEASE"
check "the run-store claim is the anonymous role's now (token-gated as before)" "$(claim $R1 $OWN1)" "true"
claim $R2 $OWN2 >/dev/null; claim $R3 $OWN3 >/dev/null
check "a wrong token: forbidden" "$(as_anon "select public.grovshot_srv_context('nope', '$R1', '$OWN1')")" "forbidden"
check "not the lease holder: not_owner" "$(as_anon "select public.grovshot_srv_context('$TOKEN', '$R1', 'gsv2:somebody-else')")" "not_owner"
check "a finished order: not_owner (the server may act only while it is open)" "$(as_anon "select public.grovshot_srv_context('$TOKEN', '$R4', '$OWN1')")" "not_owner"
check "an unknown order: not_found" "$(as_anon "select public.grovshot_srv_context('$TOKEN', gen_random_uuid(), '$OWN1')")" "not_found"
check "the lease holder: the owner's account and THIS workspace's wallet, as the owner (membership true)" \
  "$(as_anon "select (x->>'member') || ':' || (x->>'balance') from (select public.grovshot_srv_context('$TOKEN', '$R1', '$OWN1') x) s")" "true:100"
q "update public.ai_engine_runs set locked_until = now() - interval '1 second' where id = '$R1'" >/dev/null
check "an expired lease: not_owner (a dead invocation's owner cannot act)" "$(as_anon "select public.grovshot_srv_context('$TOKEN', '$R1', '$OWN1')")" "not_owner"
claim $R1 $OWN1 >/dev/null
check "the scope itself is nobody's to call" "$(as_anon "select public.grovshot_srv_scope('$TOKEN', '$R1', '$OWN1')")" "permission denied for function grovshot_srv_scope"
check "the door functions are the anonymous role's" \
  "$(q "select has_function_privilege('anon', 'public.grovshot_srv_usage_start(text, uuid, text, uuid, uuid, text, text, text, jsonb)', 'execute')")" "t"

echo "B. EVERYTHING IS THAT ORDER'S"
JOB=$(as_anon "select public.grovshot_srv_job_create('$TOKEN', '$R1', '$OWN1', jsonb_build_object('settings', jsonb_build_object('shot_item', 0, 'run_id', 'forged'), 'workspace_id', '$W2', 'user_id', '$U2'))")
check "a job is stamped with THIS order, its workspace and owner (a forged run_id / workspace / user is ignored)" \
  "$(q "select workspace_id || ':' || user_id || ':' || (settings->>'run_id') || ':' || status from public.generation_jobs where id = '$JOB'")" "$W1:$U1:$R1:processing"
check "an admin TEST order cannot create a customer job" "$(as_anon "select public.grovshot_srv_job_create('$TOKEN', '$R2', '$OWN2', '{}'::jsonb)")" "not_found"
check "another order's job cannot be closed from this one" "$(as_anon "select public.grovshot_srv_job_update('$TOKEN', '$R1', '$OWN1', '$J2', 'completed', null, 10, null)")" "f"
check "its own job closes at the order's quoted unit" \
  "$(as_anon "select public.grovshot_srv_job_update('$TOKEN', '$R1', '$OWN1', '$JOB', 'completed', null, 10, null)")/$(q "select credits_charged from public.generation_jobs where id = '$JOB'")" "t/7"
check "a charge needs this order's idempotency prefix" \
  "$(as_anon "select * from public.grovshot_srv_usage_start('$TOKEN', '$R1', '$OWN1', gen_random_uuid(), '$JOB', 'gsv2:$R3:s0:d0', 'google', 'm', '{}'::jsonb)")" "invalid_key"
check "…and a job of this order" \
  "$(as_anon "select * from public.grovshot_srv_usage_start('$TOKEN', '$R1', '$OWN1', gen_random_uuid(), '$J2', 'gsv2:$R1:s0:d0', 'google', 'm', '{}'::jsonb)")" "not_found"
WALLET=$(q "select id from public.credit_wallets where workspace_id = '$W1'")
EV=$(as_anon "select event_id from public.grovshot_srv_usage_start('$TOKEN', '$R1', '$OWN1', '$WALLET', '$JOB', 'gsv2:$R1:s0:d0', 'google', 'm', '{\"credits\": 999}'::jsonb)")
check "the charge is the ledger's own start, AS the owner, at the order's quoted unit (never a caller's amount), tagged with the order" \
  "$(q "select credits_charged || ':' || (metadata->>'run_id') || ':' || status from public.usage_events where id = '$EV'")" "7:$R1:pending"
check "an admin TEST order can never charge" \
  "$(as_anon "select * from public.grovshot_srv_usage_start('$TOKEN', '$R2', '$OWN2', '$WALLET', '$JOB', 'gsv2:$R2:s0:d0', 'google', 'm', '{}'::jsonb)")" "not_found"
check "another order's event cannot be refunded from this one" \
  "$(as_anon "select public.grovshot_srv_usage_fail('$TOKEN', '$R3', '$OWN3', '$EV', 'x', 0)")" "not_found"
check "its own event closes" "$(as_anon "select public.grovshot_srv_usage_complete('$TOKEN', '$R1', '$OWN1', '$EV', 100, 'google', 'm')")/$(q "select status from public.usage_events where id = '$EV'")" "t/succeeded"
check "the library row lives only under the order's own job folder" \
  "$(as_anon "select public.grovshot_srv_library_add('$TOKEN', '$R1', '$OWN1', '$JOB', '$W2/$JOB/x.png', 1, 1, 'passed', 99, 1)")" "invalid_path"
as_anon "select public.grovshot_srv_library_add('$TOKEN', '$R1', '$OWN1', '$JOB', '$W1/$JOB/x.png', 1, 1, 'passed', 99, 1)" >/dev/null
check "…and is removed (rows first) to 0 left" "$(as_anon "select public.grovshot_srv_library_remove('$TOKEN', '$R1', '$OWN1', '$JOB')")/$(q "select count(*) from public.generation_assets")" "0/0"
check "a notification only to /library, only for a customer order" \
  "$(as_anon "select public.grovshot_srv_notify('$TOKEN', '$R1', '$OWN1', 'https://evil.example', '{}'::jsonb, 'k1')")" "invalid_href"
as_anon "select public.grovshot_srv_notify('$TOKEN', '$R2', '$OWN2', '/library', '{}'::jsonb, 'k2')" >/dev/null
check "…an admin test sends none" "$(q "select count(*) from public.notifications")" "0"
check "the activity log takes the two V2 actions only, as the owner" \
  "$(as_anon "select public.grovshot_srv_log('$TOKEN', '$R1', '$OWN1', 'admin.anything', 'x', null, '{}'::jsonb)")/$(as_anon "select public.grovshot_srv_log('$TOKEN', '$R1', '$OWN1', 'grovshot_v2.completed', 'x', null, '{}'::jsonb)" >/dev/null; q "select actor from public.activity")" "invalid_action/$U1"

echo "C. STORAGE: ARMED OBJECTS ONLY, WHILE THE LEASE LIVES"
grant() { as_anon "select public.grovshot_srv_storage_grant('$TOKEN', '$1', '$2', '$3', array[$4], ${5:-false}, array[$6])"; }
check "a photo that is not the order's: refused" "$(grant $R1 $OWN1 product-images "'$W1/p/3.png'" false "'read'")" "invalid_path"
check "photos are read-only and exact (no folder, no write)" \
  "$(grant $R1 $OWN1 product-images "'$W1/p/1.png'" false "'read','write'")|$(grant $R1 $OWN1 product-images "'$W1/p/'" true "'read'")" "invalid_path|invalid_path"
check "a path with .. is refused" "$(grant $R1 $OWN1 generation-assets "'$W1/../x'" false "'read'")" "invalid_path"
check "another order's job folder: refused" "$(grant $R1 $OWN1 generation-assets "'$W2/$J2/a.png'" false "'write'")" "invalid_path"
check "a customer order cannot arm a test folder" "$(grant $R1 $OWN1 generation-assets "'$W1/gsv2-test/$R1/a.png'" false "'write'")" "invalid_path"
check "the order's own photo: armed" "$(grant $R1 $OWN1 product-images "'$W1/p/1.png'" false "'read'")" "1"
check "an anonymous storage read sees ONLY the armed photo (RLS)" \
  "$(as_anon "select string_agg(name, ',' order by name) from storage.objects")" "$W1/p/1.png"
JOBF=$(as_anon "select public.grovshot_srv_job_create('$TOKEN', '$R1', '$OWN1', jsonb_build_object('settings', jsonb_build_object('shot_item', 5)))")
check "its own job folder: armed as a prefix; a write into it passes, a write elsewhere does not" \
  "$(grant $R1 $OWN1 generation-assets "'$W1/$JOBF/'" true "'write','read'")|$(as_anon "insert into storage.objects (bucket_id, name) values ('generation-assets', '$W1/$JOBF/out.png') returning 'ok'")|$(as_anon "insert into storage.objects (bucket_id, name) values ('generation-assets', '$W1/other/out.png') returning 'ok'")" \
  "1|ok|new row violates row-level security policy for table \"objects\""
q "update public.ai_engine_runs set locked_until = now() - interval '1 second' where id = '$R1'" >/dev/null
check "once the lease is gone, the armed objects are closed again" "$(as_anon "select count(*) from storage.objects where bucket_id = 'product-images'")" "0"
claim $R1 $OWN1 >/dev/null

echo "D. THE WORKER'S QUEUE"
check "without the token: forbidden" "$(as_anon "select count(*) from public.grovshot_srv_due('nope', 5)")" "forbidden"
q "update public.ai_engine_runs set locked_until = null where id = '$R3'" >/dev/null
check "only open orders nobody drives (R1 and R2 hold a lease, R4 is finished)" \
  "$(as_anon "select string_agg(id::text, ',') from public.grovshot_srv_due('$TOKEN', 5)")" "$R3"
q "update public.ai_engine_runs set created_at = now() - interval '25 hours' where id = '$R3'" >/dev/null
check "an order older than a day is not driven again" "$(as_anon "select count(*) from public.grovshot_srv_due('$TOKEN', 5)")" "0"
check "the tick does nothing while no order waits" "$(q "select public.grovshot_worker_tick()")" "idle"
q "update public.ai_engine_runs set created_at = now() where id = '$R3'" >/dev/null
check "…and, with an order waiting, says when it has no origin or token to call" "$(q "select public.grovshot_worker_tick()")" "not_configured"
check "the tick is no one's to call through the API" "$(q "select has_function_privilege('anon', 'public.grovshot_worker_tick()', 'execute') or has_function_privilege('authenticated', 'public.grovshot_worker_tick()', 'execute')")" "f"

echo "E. PRICES AND THE IMAGE ROUTER"
check "the Claude list prices are seeded, an admin's own edit is left alone" \
  "$(q "select count(*) from public.ai_token_prices where provider_slug = 'anthropic'")/$(q "select input_usd_micros_per_mtok from public.ai_token_prices where model = 'claude-opus-5-5'")" "4/1"
q "insert into public.provider_health values ('google', 'ok')" >/dev/null
check "provider cooldowns: readable by the server's own request only" \
  "$(as_anon "select count(*) from public.provider_health")/$(as_anon "select count(*) from public.provider_health" "{\"x-grovbase-server\": \"$TOKEN\"}")" "0/1"

echo
if [ "$fails" -gt 0 ]; then echo "grovshot2-worker-sql: $fails failed"; exit 1; fi
echo "grovshot2-worker-sql: all passed"
