#!/usr/bin/env bash
#
# WORKFLOW ENGINE v2 — migration 0129 proven on a real Postgres.
#
# 0126 and 0127 are loaded VERBATIM on top of the pre-0126 shape of the tables
# they touch (the same fixture ai-engine-sql-tests.sh uses), then 0129 —
# twice, because it must re-run cleanly. The helpers come from the migrations
# that ship them (is_admin / is_workspace_member from 0002, server_call_ok
# from 0077, the prompt functions from 0071, cms_slug_is_reserved from 0125).
# usage_events is built with its PRODUCTION columns and the 0101 ledger
# functions, so the immutability guard and the executor-aware completion are
# exercised against the real bodies.
#
# Test ids follow the brief: WF (workflow), plus L (ledger), P (pricing),
# F (feedback). Local harness only — PROD gets a rolled-back dry run.
#
#   bash scripts/pg-harness-up.sh && npm run test:workflow2:sql
set -euo pipefail

PGSOCK="${PGSOCK:-/tmp/pgtest}"
PGPORT="${PGPORT:-5433}"
DB=workflow2
PSQL0=(psql -h "$PGSOCK" -p "$PGPORT" -U postgres -v ON_ERROR_STOP=1 -X -q -t -A)
PSQL=("${PSQL0[@]}" -d "$DB")

if ! "${PSQL0[@]}" -d postgres -c 'select 1' >/dev/null 2>&1; then
  echo "workflow2-sql: no harness on $PGSOCK:$PGPORT — run: bash scripts/pg-harness-up.sh" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
M=$ROOT/supabase/migrations
extract() { # file, function name, end marker regex
  awk -v start="^create (or replace )?function public[.]$2[(]" -v stop="$3" \
    '$0 ~ start {on=1} on {print} on && $0 ~ stop {exit}' "$1"
}
IS_ADMIN=$(extract "$M/0002_functions_and_triggers.sql" is_admin '^[$][$];')
IS_MEMBER=$(extract "$M/0002_functions_and_triggers.sql" is_workspace_member '^[$][$];')
SERVER_CALL_OK=$(extract "$M/0077_server_only_rpcs.sql" server_call_ok '^end [$][$];')
SAVE_PROMPT=$(extract "$M/0071_ai_prompt_publishing.sql" ai_save_tool_prompt '^[$][$];')
PUBLISH_PROMPT=$(extract "$M/0071_ai_prompt_publishing.sql" ai_publish_tool_prompt '^[$][$];')
RESTORE_PROMPT=$(extract "$M/0071_ai_prompt_publishing.sql" ai_restore_tool_prompt '^[$][$];')
CMS_RESERVED=$(extract "$M/0125_grovnews_sources_daily.sql" cms_slug_is_reserved '^[$][$];')
COMPLETE_0101=$(extract "$M/0101_idempotency_key_is_released.sql" usage_event_complete '^end [$][$];')
FAIL_0101=$(extract "$M/0101_idempotency_key_is_released.sql" usage_event_fail '^end [$][$];')
FEEDBACK_0016=$(sed -n '/^create table if not exists public.generation_feedback/,/^create index if not exists idx_generation_feedback_job/p' "$M/0016_image_engine_v2.sql")
for v in IS_ADMIN IS_MEMBER SERVER_CALL_OK SAVE_PROMPT PUBLISH_PROMPT RESTORE_PROMPT CMS_RESERVED COMPLETE_0101 FAIL_0101 FEEDBACK_0016; do
  [ -n "${!v}" ] || { echo "workflow2-sql: could not extract $v" >&2; exit 2; }
done

"${PSQL0[@]}" -d postgres -c "drop database if exists $DB" >/dev/null
"${PSQL0[@]}" -d postgres -c "create database $DB" >/dev/null

fails=0
check() { if [ "$2" = "$3" ]; then echo "  ✓ $1"; else echo "  ✗ $1 — got [$2], expected [$3]"; fails=$((fails+1)); fi; }
q() { "${PSQL[@]}" -c "$1"; }
as_user() { "${PSQL[@]}" -c "set role authenticated; set request.jwt.claim.sub = '$1'; $2"; }
err() { # sql, [role], [sub] → first error text, or ok
  local out
  if out=$("${PSQL[@]}" -c "set role ${2:-postgres}; set request.jwt.claim.sub = '${3:-}'; $1" 2>&1); then echo ok
  else echo "$out" | sed -n 's/^.*ERROR:  //p' | head -1; fi
}
TOKEN='the-right-dispatch-token'

"${PSQL[@]}" >/dev/null <<SQL
set check_function_bodies = off;
create schema auth; create schema extensions; create schema t;
create extension if not exists pgcrypto with schema public;
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end \$\$;
grant usage on schema public, auth, extensions to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;

create domain extensions.vector as double precision[];
create function extensions.cos_dist(a double precision[], b double precision[]) returns double precision
  language sql immutable as \$f\$ select 0::double precision \$f\$;
create operator extensions.<=> (leftarg = double precision[], rightarg = double precision[], function = extensions.cos_dist);

create function auth.uid() returns uuid language sql stable as
  \$f\$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid \$f\$;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create table public.app_settings (key text primary key, value jsonb not null default '{}'::jsonb);
insert into public.app_settings values
  ('notifications', jsonb_build_object('dispatch_hash', encode(digest('$TOKEN', 'sha256'), 'hex')));
create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, role text not null default 'user');
create table public.workspaces (id uuid primary key default gen_random_uuid(), name text);
create table public.workspace_members (workspace_id uuid references public.workspaces(id), user_id uuid references public.profiles(id),
  role text not null default 'owner', primary key (workspace_id, user_id));

$IS_ADMIN
$IS_MEMBER
$SERVER_CALL_OK
$CMS_RESERVED

create table public.ai_providers (id uuid primary key default gen_random_uuid(), slug text unique, active boolean default true, name text);
create table public.ai_models (id uuid primary key default gen_random_uuid(), provider_id uuid references public.ai_providers(id),
  name text, model_identifier text);
create table public.ai_provider_credentials (
  id uuid primary key default gen_random_uuid(), provider_id uuid unique references public.ai_providers(id),
  last_tested_at timestamptz, last_test_status text);

create table public.ai_tools (
  tool_key text primary key, service_slug text,
  engine_mode text not null default 'off' check (engine_mode in ('off','grovbase','user','hybrid')),
  allow_model_choice boolean not null default false, fallback_enabled boolean not null default false,
  timeout_ms integer not null default 120000, max_attempts smallint not null default 1,
  notes text, updated_at timestamptz not null default now(), updated_by uuid);
create table public.ai_tool_models (tool_key text references public.ai_tools on delete cascade, model_id uuid references public.ai_models on delete cascade,
  role text not null, sort_order int not null default 0, primary key (tool_key, model_id));
create table public.ai_tool_prompts (
  id uuid primary key default gen_random_uuid(), tool_key text not null references public.ai_tools on delete cascade,
  version integer not null, status text not null default 'draft', body_encrypted text not null, body_iv text not null,
  body_tag text not null, summary text, reason text, source text not null default 'manual', created_by uuid,
  created_at timestamptz not null default now(), published_at timestamptz, unique (tool_key, version));
create unique index ai_tool_prompts_one_published on public.ai_tool_prompts (tool_key) where status = 'published';
$SAVE_PROMPT
$PUBLISH_PROMPT
$RESTORE_PROMPT
create table public.knowledge_sets (id uuid primary key default gen_random_uuid(), name text not null,
  product_category text, status text not null default 'uploaded');
create table public.knowledge_examples (
  id uuid primary key default gen_random_uuid(), set_id uuid not null references public.knowledge_sets on delete cascade,
  reference_path text, generated_path text, prompt_used text, result_rating int, tags text[] not null default '{}',
  enabled bool not null default true, embedding extensions.vector,
  hint_encrypted text, hint_iv text, hint_tag text, created_at timestamptz not null default now());
create table public.ai_tool_knowledge (tool_key text references public.ai_tools on delete cascade,
  set_id uuid references public.knowledge_sets on delete cascade, enabled boolean not null default true,
  created_at timestamptz not null default now(), primary key (tool_key, set_id));

create type public.job_status as enum ('queued','processing','completed','failed','cancelled');
create table public.prompt_sessions (id uuid primary key default gen_random_uuid(), workspace_id uuid, knowledge_used jsonb);
create table public.generation_jobs (id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id), user_id uuid not null references public.profiles(id),
  status public.job_status not null default 'completed', prompt_session_id uuid references public.prompt_sessions(id),
  provider_slug text, model_id uuid references public.ai_models(id));
create table public.generations (id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.generation_jobs(id) on delete cascade, workspace_id uuid not null);
$FEEDBACK_0016

-- usage_events with its PRODUCTION columns (information_schema on PROD).
create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  workspace_id uuid references public.workspaces(id) on delete set null,
  service_id uuid, service_slug text not null default 'image_generation',
  provider_slug text, model_slug text,
  credits_charged integer not null default 0,
  api_cost_usd_micros_snapshot bigint not null default 0,
  sale_value_cents_snapshot integer not null default 0,
  status text not null default 'pending',
  started_at timestamptz not null default now(), finished_at timestamptz, error text,
  result_count integer not null default 0,
  generation_job_id uuid references public.generation_jobs(id) on delete set null,
  credit_tx_id uuid, refund_tx_id uuid, idempotency_key text unique,
  metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
  actual_api_cost_usd_micros bigint not null default 0, provider_request_id text);
alter table public.usage_events enable row level security;
create policy usage_events_member_read on public.usage_events for select
  using (public.is_workspace_member(workspace_id) or (select public.is_admin()));
create policy usage_events_admin_update on public.usage_events for update using ((select public.is_admin()));
grant select, insert, update, delete, truncate on public.usage_events to anon, authenticated;
create table public.credit_wallets (id uuid primary key default gen_random_uuid(), workspace_id uuid unique, balance int not null default 0);
create function public.apply_credit_transaction(p_wallet uuid, p_amount int, p_type text, p_desc text, p_ref uuid,
  p_meta jsonb, p_actor uuid) returns uuid language sql as \$f\$ select gen_random_uuid() \$f\$;
$COMPLETE_0101
$FAIL_0101

insert into public.ai_tools (tool_key, engine_mode) values
  ('retouch', 'grovbase'), ('fashion_flat_lay', 'grovbase'), ('prompts', 'grovbase'), ('compress', 'off');

create function t.usr(p_email text, p_ws uuid) returns uuid language plpgsql as \$f\$
declare v uuid; begin
  insert into auth.users (email) values (p_email) returning id into v;
  insert into public.profiles (id) values (v);
  if p_ws is not null then insert into public.workspace_members values (p_ws, v); end if;
  return v; end \$f\$;
SQL

"${PSQL[@]}" -f "$M/0126_ai_engine_workflows.sql" >/dev/null
"${PSQL[@]}" -f "$M/0127_ai_provider_calls.sql" >/dev/null
# A tool that ran a legacy workflow before 0129 — carried over to the switch.
q "update public.ai_tools set engine_mode = 'workflow' where tool_key = 'fashion_flat_lay'" >/dev/null
"${PSQL[@]}" -f "$M/0129_workflow_engine_v2.sql" >/dev/null
"${PSQL[@]}" -f "$M/0129_workflow_engine_v2.sql" >/dev/null && echo "  ✓ 0129 re-runs cleanly"

WS=$(q "insert into public.workspaces (name) values ('A') returning id")
WS2=$(q "insert into public.workspaces (name) values ('B') returning id")
ADMIN=$(q "select t.usr('admin@x.pl', null)"); q "update public.profiles set role = 'admin' where id = '$ADMIN'" >/dev/null
U1=$(q "select t.usr('u1@x.pl', '$WS')")
U2=$(q "select t.usr('u2@x.pl', '$WS2')")
GOOGLE=$(q "insert into public.ai_providers (slug, name) values ('google', 'Google') returning id")
OPENAI=$(q "insert into public.ai_providers (slug, name) values ('openai', 'OpenAI') returning id")
MODEL=$(q "insert into public.ai_models (provider_id, name, model_identifier) values ('$GOOGLE', 'Nano Banana', 'gemini-img') returning id")

echo "Switch and runtime read"
check "the legacy 'workflow' mode became the switch (prompt mode falls back to grovbase)" \
  "$(q "select engine_mode || ':' || workflow_enabled from public.ai_tools where tool_key = 'fashion_flat_lay'")" "grovbase:true"
check "every other tool keeps its mode and has the switch OFF" \
  "$(q "select string_agg(tool_key || '=' || engine_mode || ':' || workflow_enabled, ',' order by tool_key) from public.ai_tools where tool_key <> 'fashion_flat_lay'")" \
  "compress=off:false,prompts=grovbase:false,retouch=grovbase:false"
check "the runtime read carries the switch (token only)" "$(q "select workflow_enabled from public.ai_tool_runtime('fashion_flat_lay', '$TOKEN')")" "t"
check "…and returns nothing without the token" "$(q "select count(*) from public.ai_tool_runtime('fashion_flat_lay', 'wrong')")" "0"

step() { # name, op, kind, out, extra-json
  echo "{\"name\":\"$1\",\"operation\":\"$2\",\"output_kind\":\"$3\",\"output_name\":\"$4\",\"enabled\":true,\"prompt_encrypted\":\"c-$1\",\"prompt_iv\":\"iv\",\"prompt_tag\":\"tag\"${5:+,$5}}"
}
save() { as_user "$ADMIN" "select public.ai_save_tool_workflow('retouch', '$1'::jsonb, 's', '$2', $3, ${5:-3})->>'${4:-ok}'"; }
S1=$(step retouch tool image clean_image '"tool_slug":"retouch","input_image":"customer"')
S2=$(step scenes ai_text list scene_prompts '"max_items":5,"input_image":"clean_image"')
S3=$(step shots image_generation image final '"for_each":"scene_prompts","item_name":"scene_prompt","max_items":5,"input_image":"clean_image","model_id":"'$MODEL'"')

echo "WF — definitions (the example flow: retouch → 5 scenes → 5 images)"
check "the three-step example saves as a draft" "$(save "[$S1,$S2,$S3]" 'first' false)" "true"
check "…declaring 5 final outputs (fan-out cap of the last step)" "$(q "select max_outputs from public.ai_tool_workflows where tool_key='retouch' order by version desc limit 1")" "5"
check "WF12 a draft is not what production reads" "$(q "select count(*) from public.ai_tool_workflow_read('$TOKEN', 'retouch', null)")" "0"
check "WF13 publishing makes it the production version" "$(save "[$S1,$S2,$S3]" 'go live' true version)" "2"
check "WF13 …read by the runtime, all v2 columns intact" \
  "$(q "select string_agg(position || ':' || operation || ':' || output_name || ':' || coalesce(for_each,'-') || ':' || coalesce(input_image,'-'), ' ' order by position) from public.ai_tool_workflow_read('$TOKEN', 'retouch', null)")" \
  "1:tool:clean_image:-:customer 2:ai_text:scene_prompts:-:clean_image 3:image_generation:final:scene_prompts:clean_image"
V2ID=$(q "select id from public.ai_tool_workflows where tool_key='retouch' and version=2")
check "a run can read the exact version it is pinned to" "$(q "select count(*) from public.ai_tool_workflow_read('$TOKEN', 'retouch', '$V2ID')")" "3"
LONG="[$S1,$S2,$(for i in $(seq 1 9); do printf '%s,' "$(step "t$i" ai_text text "txt$i")"; done)$S3]"
check "no 8-step ceiling: 12 valid steps save" "$(save "$LONG" 'many' false)" "true"
check "a forward reference is refused (no cycles, no recursion)" \
  "$(save "[$(step a ai_text text a '"input_image":"later"'),$(step later image_generation image later '"input_image":"customer"')]" 'x' false error)" "input_unknown"
check "FOR EACH over something that is not an earlier list is refused" \
  "$(save "[$S1,$(step g image_generation image g '"for_each":"clean_image","item_name":"x","max_items":3')]" 'x' false error)" "for_each_unknown"
check "duplicate output names are refused" "$(save "[$S1,$(step dup tool image clean_image '"tool_slug":"upscale","input_image":"clean_image"')]" 'x' false error)" "output_duplicate"
check "the result must be an image (last enabled step)" "$(save "[$S1,$S2]" 'x' false error)" "image_step_last"
check "a non-tool step with no instruction is refused" \
  "$(save "[{\"name\":\"n\",\"operation\":\"image_generation\",\"output_kind\":\"image\",\"output_name\":\"n\",\"enabled\":true,\"prompt_encrypted\":\"\",\"prompt_iv\":\"iv\",\"prompt_tag\":\"tag\",\"input_image\":\"customer\"}]" 'x' false error)" "empty_prompt"
check "a customer cannot save a workflow" "$(err "select public.ai_save_tool_workflow('retouch', '[]'::jsonb)" authenticated "$U1")" "not_authorized"
check "WF14 rollback copies an old version forward as a new published one" \
  "$(as_user "$ADMIN" "select public.ai_restore_tool_workflow('$V2ID', 'back')->>'from_version'")" "2"
check "WF14 …with every v2 column and the declared outputs" \
  "$(q "select w.max_outputs || ':' || count(s.*) || ':' || max(s.for_each) from public.ai_tool_workflows w join public.ai_tool_workflow_steps s on s.workflow_id = w.id where w.tool_key='retouch' and w.status='published' group by w.max_outputs")" \
  "5:3:scene_prompts"
check "exactly one published version at any time" "$(q "select count(*) from public.ai_tool_workflows where tool_key='retouch' and status='published'")" "1"

echo "WF — runs, leases and step idempotency"
mk() { q "select public.ai_engine_run_create('$TOKEN', jsonb_build_object('tool_key','retouch','workspace_id','$WS','user_id','$U1','idempotency_key','$1','workflow_id','$V2ID','workflow_version',2,'expected_outputs',5,'input',jsonb_build_object('paths',jsonb_build_array('$WS/a.png'))))->>'${2:-id}'"; }
RUN=$(mk "wf:$WS:retouch:v2:hash-1")
check "a double submit gets the SAME run back (idempotency key)" "$(mk "wf:$WS:retouch:v2:hash-1")" "$RUN"
check "…flagged as not newly created" "$(mk "wf:$WS:retouch:v2:hash-1" created)" "false"
check "creating a run needs the server token" "$(err "select public.ai_engine_run_create('wrong', '{}'::jsonb)" authenticated "$U1")" "forbidden"
check "a customer cannot insert a run directly" "$(err "insert into public.ai_engine_runs (tool_key, mode, status) values ('retouch','workflow','ok')" authenticated "$U1")" "permission denied for table ai_engine_runs"
claim() { q "select public.ai_engine_run_claim('$TOKEN', '$RUN', '$1', 60)->>'${2:-claimed}'"; }
check "WF17 the first invocation claims the run" "$(claim owner-aaaa-1111)" "true"
check "WF17 a second, concurrent invocation is refused (busy)" "$(claim owner-bbbb-2222 reason)" "busy"
check "WF17 the lease holder may renew" "$(claim owner-aaaa-1111)" "true"
begin_() { q "select public.ai_engine_step_begin('$TOKEN', '$RUN', '$1', $2, $3, 's', 'image_generation', 300)->>'state'"; }
finish() { q "select public.ai_engine_step_finish('$TOKEN', '$RUN', 'owner-aaaa-1111', $1, $2, '$3'::jsonb)"; }
check "a non-holder cannot begin a step" "$(begin_ owner-bbbb-2222 1 -1)" "not_owner"
check "step 1 begins" "$(begin_ owner-aaaa-1111 1 -1)" "run"
check "…and while it runs a second begin is refused (no double provider call)" "$(begin_ owner-aaaa-1111 1 -1)" "busy"
finish 1 -1 '{"status":"succeeded","provider_slug":"google","model":"gemini-img","units":1,"unit_kind":"image","cost_basis":"estimated","cost_usd_micros":15000,"output":{"image":"'$WS'/job/steps/1.png"},"attempts":2}' >/dev/null
check "WF6/WF7 a step that succeeded is never executed again — its output is reused" "$(begin_ owner-aaaa-1111 1 -1)" "done"
check "…retries are counted on the SAME row (one row per step, no duplicate)" "$(q "select count(*) || ':' || max(attempts) from public.ai_engine_step_runs where run_id='$RUN' and position=1")" "1:2"
check "a late duplicate finisher cannot overwrite a success" \
  "$(finish 1 -1 '{"status":"failed","error_code":"provider_timeout"}'); $(q "select status from public.ai_engine_step_runs where run_id='$RUN' and position=1")" "f; succeeded"
for i in 0 1 2 3 4; do begin_ owner-aaaa-1111 3 $i >/dev/null; done
check "WF8 a 5-item fan-out is exactly 5 child executions" "$(q "select count(*) from public.ai_engine_step_runs where run_id='$RUN' and position=3")" "5"
for i in 0 1 2 3; do finish 3 $i '{"status":"succeeded","provider_slug":"google","model":"gemini-img","units":1,"unit_kind":"image","cost_basis":"estimated","cost_usd_micros":36000}' >/dev/null; done
finish 3 4 '{"status":"failed","error_code":"Content Policy!"}' >/dev/null
check "WF9 one failed item is marked failed, with a sanitised code; the others succeeded" \
  "$(q "select string_agg(item_index || '=' || status || coalesce(':' || error_code, ''), ',' order by item_index) from public.ai_engine_step_runs where run_id='$RUN' and position=3")" \
  "0=succeeded,1=succeeded,2=succeeded,3=succeeded,4=failed:content_policy_"
check "WF10 each item records the executor that really answered" "$(q "select string_agg(distinct provider_slug || '/' || model, ',') from public.ai_engine_step_runs where run_id='$RUN' and status='succeeded'")" "google/gemini-img"
check "WF11 run cost = sum of step costs (known ones)" "$(q "select sum(cost_usd_micros) from public.ai_engine_step_runs where run_id='$RUN'")" "159000"
check "an unknown cost is stored as NULL with basis unknown — never 0" \
  "$(begin_ owner-aaaa-1111 2 -1 >/dev/null; finish 2 -1 '{"status":"succeeded","provider_slug":"openai","model":"gpt-x","cost_basis":"estimated"}'); $(q "select coalesce(cost_usd_micros::text,'null') || ':' || cost_basis from public.ai_engine_step_runs where run_id='$RUN' and position=2")" "t; null:unknown"
patch() { q "select public.ai_engine_run_patch('$TOKEN', '$RUN', '$1', '$2'::jsonb)"; }
check "only the lease holder may patch the run" "$(patch owner-bbbb-2222 '{"status":"ok"}')" "f"
check "the holder closes it as partial" "$(patch owner-aaaa-1111 '{"status":"partial","outputs":[{"path":"x"}],"progress":{"done":4,"total":5,"failed":1},"api_cost_usd_micros":159000,"cost_unknown":1}')" "t"
check "a finished run never changes again" "$(patch owner-aaaa-1111 '{"status":"ok"}')" "f"
check "…and cannot be claimed again" "$(claim owner-aaaa-1111 reason)" "finished"

check "the driver reads its run and steps through the token" "$(q "select count(*) from public.ai_engine_run_read('$TOKEN', '$RUN')"):$(q "select count(*) from public.ai_engine_step_runs_read('$TOKEN', '$RUN')")" "1:7"
check "…and nothing without it" "$(err "select * from public.ai_engine_step_runs_read('wrong', '$RUN')" authenticated "$U1")" "forbidden"
check "a recorded 'estimated' cost with no amount stays unknown (greatest(0,NULL) trap)" \
  "$(q "select public.ai_provider_call_record('$TOKEN', '[{\"actor_kind\":\"system\",\"consumer\":\"workflow\",\"provider_slug\":\"google\",\"status\":\"succeeded\",\"cost_basis\":\"estimated\",\"run_ref\":\"nocost-1\"}]'::jsonb)" >/dev/null; q "select cost_basis || ':' || coalesce(cost_usd_micros::text,'null') from public.ai_provider_calls where run_ref='nocost-1'")" "unknown:null"
echo "WF15 — what a customer can see"
check "the owner sees status and progress of their own run" "$(as_user "$U1" "select public.ai_engine_run_status('$RUN')->>'status'")" "partial"
check "…but never the steps, models or outputs text" "$(as_user "$U1" "select (public.ai_engine_run_status('$RUN') ?| array['steps','model_label','input','workflow_id'])::text")" "false"
check "another customer sees nothing" "$(as_user "$U2" "select coalesce(public.ai_engine_run_status('$RUN')::text,'null')")" "null"
check "a customer cannot read step runs (RLS)" "$(as_user "$U1" "select count(*) from public.ai_engine_step_runs")" "0"
check "a customer cannot read runs directly (RLS)" "$(as_user "$U1" "select count(*) from public.ai_engine_runs")" "0"
check "the admin reads step runs" "$(as_user "$ADMIN" "select count(*) from public.ai_engine_step_runs where run_id='$RUN'")" "7"

echo "L — the ledger is immutable once closed"
EV=$(q "insert into public.usage_events (user_id, workspace_id, provider_slug, model_slug, credits_charged, credit_tx_id) values ('$U1','$WS','openai','gpt-image',20, gen_random_uuid()) returning id")
check "L1 the admin UPDATE policy is gone" "$(q "select count(*) from pg_policies where tablename='usage_events' and policyname='usage_events_admin_update'")" "0"
check "L1 an admin can no longer UPDATE a usage event" "$(err "update public.usage_events set credits_charged = 0 where id = '$EV'" authenticated "$ADMIN")" "permission denied for table usage_events"
check "L1 …nor DELETE one" "$(err "delete from public.usage_events where id = '$EV'" authenticated "$ADMIN")" "permission denied for table usage_events"
check "WF10 completion records the executor that REALLY served (fallback)" \
  "$(as_user "$U1" "select public.usage_event_complete('$TOKEN', '$EV', 5, 180000, 'req', 'google', 'gemini-img')" >/dev/null; q "select provider_slug || '/' || model_slug || ' requested ' || (metadata->>'requested_provider') || '/' || (metadata->>'requested_model') from public.usage_events where id='$EV'")" \
  "google/gemini-img requested openai/gpt-image"
check "L2 a closed event cannot be rewritten even by the table owner" "$(err "update public.usage_events set credits_charged = 1 where id = '$EV'")" "usage_event_immutable"
check "L2 …but detaching it from a deleted workspace (FK SET NULL) still works" "$(err "update public.usage_events set workspace_id = null where id = '$EV'")" "ok"
EV2=$(q "insert into public.usage_events (user_id, workspace_id, credits_charged, credit_tx_id) values ('$U1','$WS',5, gen_random_uuid()) returning id")
check "an unknown executor is recorded as NULL (unknown), never a guess" \
  "$(as_user "$U1" "select public.usage_event_complete('$TOKEN', '$EV2', 1, 0, null, null::text, null::text)" >/dev/null; q "select coalesce(provider_slug,'null') || ':' || (metadata->>'executor_unknown') from public.usage_events where id='$EV2'")" "null:true"
EV3=$(q "insert into public.usage_events (user_id, workspace_id, credits_charged, credit_tx_id) values ('$U1','$WS',5, gen_random_uuid()) returning id")
check "the legacy 5-argument completion still works (previous build during deploy)" \
  "$(as_user "$U1" "select public.usage_event_complete('$TOKEN', '$EV3', 1, 0, null)" >/dev/null; q "select status from public.usage_events where id='$EV3'")" "succeeded"
EV4=$(q "insert into public.usage_events (user_id, workspace_id, credits_charged, credit_tx_id) values ('$U1','$WS',5, gen_random_uuid()) returning id")
check "a failed event can still be refunded (failed → refunded is not locked)" \
  "$(as_user "$U1" "select public.usage_event_fail('$TOKEN', '$EV4', 'x', 0) is not null"); $(q "select status from public.usage_events where id='$EV4'")" "t; refunded"

check "L3 an FK detach to NULL of the credit / refund transaction is allowed (account deletion keeps working)" \
  "$(err "update public.usage_events set credit_tx_id = null, refund_tx_id = null, service_id = null where id = '$EV'")" "ok"
check "L3 …re-pointing it to another transaction is not" "$(err "update public.usage_events set credit_tx_id = gen_random_uuid() where id = '$EV'")" "usage_event_immutable"

echo "R — review fixes: a closed charge ends the run; resumes are bounded"
EVR=$(q "insert into public.usage_events (user_id, workspace_id, credits_charged, status) values ('$U1','$WS',10,'refunded') returning id")
RUNR=$(q "select public.ai_engine_run_create('$TOKEN', jsonb_build_object('tool_key','retouch','workspace_id','$WS','user_id','$U1','idempotency_key','run-refunded-1','usage_event_id','$EVR','workflow_id','$V2ID','workflow_version',2,'expected_outputs',1,'input','{}'::jsonb))->>'id'")
check "R1 a run whose charge was refunded cannot be claimed (no free resume)" \
  "$(q "select public.ai_engine_run_claim('$TOKEN', '$RUNR', 'owner-rrrr-0001', 60)->>'reason'")" "finished"
check "R1 …and is closed as failed: charge_closed" "$(q "select status || ':' || error from public.ai_engine_runs where id='$RUNR'")" "failed:charge_closed"
RUNI=$(q "select public.ai_engine_run_create('$TOKEN', jsonb_build_object('tool_key','retouch','workspace_id','$WS','user_id','$U1','idempotency_key','run-invoc-1','workflow_id','$V2ID','workflow_version',2,'expected_outputs',1,'input','{}'::jsonb))->>'id'")
q "update public.ai_engine_runs set invocations = 30 where id = '$RUNI'" >/dev/null
check "R2 a run resumed 30 times is closed (invocation_limit)" \
  "$(q "select public.ai_engine_run_claim('$TOKEN', '$RUNI', 'owner-iiii-0001', 60)->>'reason'"):$(q "select error from public.ai_engine_runs where id='$RUNI'")" "finished:invocation_limit"
RUNB=$(q "select public.ai_engine_run_create('$TOKEN', jsonb_build_object('tool_key','retouch','workspace_id','$WS','user_id','$U1','idempotency_key','run-begin-1','workflow_id','$V2ID','workflow_version',2,'expected_outputs',1,'input','{}'::jsonb))->>'id'")
q "select public.ai_engine_run_claim('$TOKEN', '$RUNB', 'owner-bbbb-0001', 60)" >/dev/null
b1=$(q "select public.ai_engine_step_begin('$TOKEN', '$RUNB', 'owner-bbbb-0001', 1, -1, 'A', 'image_edit', 10)->>'attempts'")
q "update public.ai_engine_step_runs set locked_until = now() - interval '1 second' where run_id = '$RUNB'" >/dev/null
b2=$(q "select public.ai_engine_step_begin('$TOKEN', '$RUNB', 'owner-bbbb-0001', 1, -1, 'A', 'image_edit', 10)->>'attempts'")
check "R3 every begin of a step is counted (the runtime bounds resumes with it)" "$b1:$b2" "0:1"

echo "P — pricing"
check "P1 cached-input price column exists and is read through the door" "$(q "select count(*) from public.ai_token_prices_read('$TOKEN')")" "0"
check "P2 per-unit prices: an admin can set an image price by resolution" \
  "$(err "insert into public.ai_unit_prices (provider_slug, model, unit_kind, resolution, quality, usd_micros_per_unit) values ('google','gemini-img','image','2K','*',134000)" authenticated "$ADMIN")" "ok"
check "P2 …a customer cannot read unit prices" "$(as_user "$U1" "select count(*) from public.ai_unit_prices")" "0"
check "P2 …the recorder door needs the token" "$(err "select * from public.ai_unit_prices_read('wrong')" anon)" "forbidden"
check "P2 …and serves them with it" "$(q "select usd_micros_per_unit from public.ai_unit_prices_read('$TOKEN')")" "134000"
check "P3 a workflow-test call does not move the provider card" \
  "$(q "select public.ai_provider_call_record('$TOKEN', '[{\"actor_kind\":\"admin\",\"consumer\":\"workflow_test\",\"provider_slug\":\"google\",\"status\":\"failed\",\"error_code\":\"provider_auth_failed\",\"cost_basis\":\"unknown\"}]'::jsonb)")" "1"

echo "F — feedback pinned to what produced it"
JOB=$(q "insert into public.generation_jobs (workspace_id, user_id, provider_slug, model_id) values ('$WS', '$U1', 'google', '$MODEL') returning id")
q "update public.ai_engine_runs set job_id = '$JOB' where id = '$RUN'" >/dev/null
q "insert into public.generation_feedback (workspace_id, user_id, generation_job_id, verdict) values ('$WS', '$U1', '$JOB', 'like')" >/dev/null
check "F1 a vote carries the run, tool, workflow version, model and provider" \
  "$(q "select (engine_run_id = '$RUN')::text || ':' || tool_key || ':' || workflow_version || ':' || provider_slug from public.generation_feedback where generation_job_id = '$JOB'")" \
  "true:retouch:2:google"
check "F3 a workspace member can still read their vote…" "$(as_user "$U1" "select verdict from public.generation_feedback where generation_job_id = '$JOB'")" "like"
check "F3 …but not the pinned engine facts (admin data)" "$(err "select model_label from public.generation_feedback" authenticated "$U1")" "permission denied for table generation_feedback"
check "F2 a vote changes no workflow and no prompt" "$(q "select count(*) from public.ai_tool_workflows where tool_key='retouch' and status='published'")" "1"

echo
if [ "$fails" -gt 0 ]; then echo "workflow2-sql: $fails check(s) failed"; exit 1; fi
echo "workflow2-sql: all checks passed"
