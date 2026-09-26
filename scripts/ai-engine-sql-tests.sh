#!/usr/bin/env bash
#
# AI ENGINE / TOOL ENGINE UPGRADE — migration 0126 proven on a real Postgres.
#
# 0126 is loaded VERBATIM on top of the pre-0126 shape of the tables it
# touches (ai_tools with its original CHECK, knowledge_sets/examples,
# generation_feedback with its 0016 policies, generation_jobs, generations,
# prompt_sessions) and the helpers it calls (is_admin, is_workspace_member
# from 0002, server_call_ok from 0077). pgvector is not in the harness, so
# `extensions.vector` is a float8[] domain with a cosine `<=>` — enough for
# knowledge_candidates' ordering; the similarity maths is not what is tested.
#
# Test ids match the brief: P (prompts/versions), W (workflow), K (knowledge),
# F (feedback). Local harness only — PROD gets a rolled-back dry run.
#
#   bash scripts/pg-harness-up.sh && npm run test:aiengine:sql
set -euo pipefail

PGSOCK="${PGSOCK:-/tmp/pgtest}"
PGPORT="${PGPORT:-5433}"
DB=aiengine
PSQL0=(psql -h "$PGSOCK" -p "$PGPORT" -U postgres -v ON_ERROR_STOP=1 -X -q -t -A)
PSQL=("${PSQL0[@]}" -d "$DB")

if ! "${PSQL0[@]}" -d postgres -c 'select 1' >/dev/null 2>&1; then
  echo "aiengine-sql: no harness on $PGSOCK:$PGPORT — run: bash scripts/pg-harness-up.sh" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
M=$ROOT/supabase/migrations
MIGRATION="${MIGRATION:-$M/0126_ai_engine_workflows.sql}"
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
FEEDBACK_0016=$(sed -n '/^create table if not exists public.generation_feedback/,/^create index if not exists idx_generation_feedback_job/p' "$M/0016_image_engine_v2.sql")
for v in IS_ADMIN IS_MEMBER SERVER_CALL_OK FEEDBACK_0016 SAVE_PROMPT PUBLISH_PROMPT RESTORE_PROMPT; do
  [ -n "${!v}" ] || { echo "aiengine-sql: could not extract $v" >&2; exit 2; }
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

-- pgvector stand-in.
create domain extensions.vector as double precision[];
create function extensions.cos_dist(a double precision[], b double precision[]) returns double precision
  language sql immutable as \$f\$
  select 1 - (select sum(x*y) from unnest(a, b) as u(x, y))
           / nullif(sqrt((select sum(x*x) from unnest(a) x)) * sqrt((select sum(y*y) from unnest(b) y)), 0) \$f\$;
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

create table public.ai_providers (id uuid primary key default gen_random_uuid(), slug text);
create table public.ai_models (id uuid primary key default gen_random_uuid(), provider_id uuid references public.ai_providers(id), name text);

-- ai_tools / prompts / knowledge as 0070 left them.
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
alter table public.ai_tool_prompts enable row level security;
create policy ai_tool_prompts_admin on public.ai_tool_prompts for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
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
alter table public.knowledge_examples enable row level security;
create policy ke_admin_all on public.knowledge_examples for all using (public.is_admin()) with check (public.is_admin());
create table public.ai_tool_knowledge (tool_key text references public.ai_tools on delete cascade,
  set_id uuid references public.knowledge_sets on delete cascade, enabled boolean not null default true,
  created_at timestamptz not null default now(), primary key (tool_key, set_id));

create type public.job_status as enum ('queued','processing','completed','failed','cancelled');
create table public.prompt_sessions (id uuid primary key default gen_random_uuid(), workspace_id uuid, knowledge_used jsonb);
create table public.generation_jobs (id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id), user_id uuid not null references public.profiles(id),
  status public.job_status not null default 'completed', prompt_session_id uuid references public.prompt_sessions(id));
create table public.generations (id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.generation_jobs(id) on delete cascade, workspace_id uuid not null);

$FEEDBACK_0016

-- usage_events as far as the vote evidence goes (server-written since 0101).
create table public.usage_events (id uuid primary key default gen_random_uuid(),
  generation_job_id uuid references public.generation_jobs(id), status text not null default 'pending');
alter table public.usage_events enable row level security;

insert into public.knowledge_sets (name, status) values ('legacy-ready', 'ready'), ('legacy-busy', 'indexing'), ('legacy-error', 'error');
insert into public.ai_tools (tool_key, engine_mode) values
  ('retouch', 'grovbase'), ('fashion_flat_lay', 'grovbase'), ('prompts', 'grovbase'), ('compress', 'off');

create function t.usr(p_email text, p_ws uuid) returns uuid language plpgsql as \$f\$
declare v uuid; begin
  insert into auth.users (email) values (p_email) returning id into v;
  insert into public.profiles (id) values (v);
  if p_ws is not null then insert into public.workspace_members values (p_ws, v); end if;
  return v; end \$f\$;
SQL

"${PSQL[@]}" -f "$MIGRATION" >/dev/null
# Idempotent: a second run of the same file must not fail.
"${PSQL[@]}" -f "$MIGRATION" >/dev/null && echo "  ✓ 0126 re-runs cleanly"

WS=$(q "insert into public.workspaces (name) values ('A') returning id")
WS2=$(q "insert into public.workspaces (name) values ('B') returning id")
ADMIN=$(q "select t.usr('admin@x.pl', null)"); q "update public.profiles set role = 'admin' where id = '$ADMIN'" >/dev/null
U1=$(q "select t.usr('u1@x.pl', '$WS')")
U2=$(q "select t.usr('u2@x.pl', '$WS2')")
MODEL=$(q "insert into public.ai_models (name) values ('img') returning id")

step() { # name, op, out, enabled
  echo "{\"name\":\"$1\",\"operation\":\"$2\",\"output_kind\":\"$3\",\"enabled\":$4,\"prompt_encrypted\":\"c-$1\",\"prompt_iv\":\"iv\",\"prompt_tag\":\"tag\"}"
}
A1=$(step a1 analyze analysis true); A2=$(step a2 analyze text false); IMG=$(step img generate_image image true)
save() { as_user "$ADMIN" "select public.ai_save_tool_workflow('retouch', '$1'::jsonb, 's', '$2', $3)->>'${4:-ok}'"; }

echo "Modes and columns"
check "existing sets (ready or mid-import) stay assigned to GrovShot; failed ones do not (backfill)" "$(q "select string_agg(s.name, ',' order by s.name) from public.ai_tool_knowledge k join public.knowledge_sets s on s.id = k.set_id where k.tool_key = 'prompts'")" "legacy-busy,legacy-ready"
check "engine_mode accepts 'workflow'" "$(err "update public.ai_tools set engine_mode = 'workflow' where tool_key = 'compress'")" "ok"
q "update public.ai_tools set engine_mode = 'off' where tool_key = 'compress'" >/dev/null
check "engine_mode still rejects anything else" "$(err "update public.ai_tools set engine_mode = 'bogus' where tool_key = 'compress'" | grep -c check)" "1"
check "no tool changed mode on deploy" "$(q "select string_agg(tool_key || '=' || engine_mode, ',' order by tool_key) from public.ai_tools")" "compress=off,fashion_flat_lay=grovbase,prompts=grovbase,retouch=grovbase"
check "knowledge_strategy defaults to proven" "$(q "select count(*) from public.ai_tools where knowledge_strategy = 'proven'")" "4"

echo "P — prompt versions (0071 functions, unchanged, with 0126's runtime read)"
sp() { as_user "$ADMIN" "select public.ai_save_tool_prompt('fashion_flat_lay', 'cipher-$1', 'iv', 'tag', 's', 'r', 'manual', $2)->>'${3:-id}'"; }
P1=$(sp v1 true); D2=$(sp v2 false)
check "P2 a draft does not change what production reads" "$(q "select prompt_version || ':' || prompt_encrypted from public.ai_tool_runtime('fashion_flat_lay', '$TOKEN')")" "1:cipher-v1"
check "P3 publishing activates exactly one version" "$(as_user "$ADMIN" "select public.ai_publish_tool_prompt('$D2', 'go')->>'ok'"); $(q "select count(*) from public.ai_tool_prompts where tool_key='fashion_flat_lay' and status='published'")" "true; 1"
check "P3 …the new one" "$(q "select prompt_version from public.ai_tool_runtime('fashion_flat_lay', '$TOKEN')")" "2"
check "P3 a second published row is impossible (unique index)" "$(err "update public.ai_tool_prompts set status='published' where id = '$P1'" | grep -c 'duplicate key')" "1"
check "P8 rollback creates a new version" "$(as_user "$ADMIN" "select public.ai_restore_tool_prompt('$P1', 'back')->>'version'")" "3"
check "P8 …carrying v1's body" "$(q "select prompt_encrypted from public.ai_tool_runtime('fashion_flat_lay', '$TOKEN')")" "cipher-v1"
check "P5 a customer cannot read prompts" "$(as_user "$U1" "select count(*) from public.ai_tool_prompts")" "0"
check "P5 a customer cannot save one" "$(err "select public.ai_save_tool_prompt('fashion_flat_lay', 'x', 'i', 't')" authenticated "$U1")" "not_authorized"

echo "W — workflow definitions"
check "W1 a single image step saves" "$(save "[$IMG]" 'first' true)" "true"
check "W9 exactly one published version" "$(q "select count(*) from public.ai_tool_workflows where tool_key='retouch' and status='published'")" "1"
check "three steps save (W2)" "$(save "[$A1,$A2,$IMG]" 'three' true)" "true"
check "W9 publishing v2 supersedes v1 in the same transaction" \
  "$(q "select string_agg(version || ':' || status, ',' order by version) from public.ai_tool_workflows where tool_key='retouch'")" "1:superseded,2:published"
check "image step not last is refused" "$(save "[$IMG,$A1]" 'x' false error)" "image_step_last"
check "two image steps are refused" "$(save "[$IMG,$IMG]" 'x' false error)" "image_step_last"
check "a disabled image step is refused" "$(save "[$(step img generate_image image false)]" 'x' false error)" "image_step_disabled"
check "no image step is refused" "$(save "[$A1]" 'x' false error)" "image_step_last"
check "nine steps are refused" "$(save "[$A1,$A1,$A1,$A1,$A1,$A1,$A1,$A1,$IMG]" 'x' false error)" "invalid_steps"
check "publishing needs a reason" "$(as_user "$ADMIN" "select public.ai_save_tool_workflow('retouch', '[$IMG]'::jsonb, null, null, true)->>'error'")" "reason_required"
check "an analyze step cannot claim an image output (CHECK)" \
  "$(err "select public.ai_save_tool_workflow('retouch', '[$(step bad analyze image true),$IMG]'::jsonb, null, 'r', false)" authenticated "$ADMIN" | grep -c check)" "1"
check "a model override must be a real model (FK)" \
  "$(err "select public.ai_save_tool_workflow('retouch', '[{\"name\":\"i\",\"operation\":\"generate_image\",\"output_kind\":\"image\",\"enabled\":true,\"model_id\":\"$(q "select gen_random_uuid()")\",\"prompt_encrypted\":\"c\",\"prompt_iv\":\"i\",\"prompt_tag\":\"t\"}]'::jsonb, null, 'r', false)" authenticated "$ADMIN" | grep -c 'foreign key')" "1"

echo "W — runtime read"
check "the runtime needs the server token" "$(q "select count(*) from public.ai_tool_workflow_runtime('retouch', 'wrong')")" "0"
check "W2 steps come back in order" "$(q "select string_agg(name, ',' order by position) from public.ai_tool_workflow_runtime('retouch', '$TOKEN')")" "a1,a2,img"
check "W10 the disabled step is returned as disabled (the runner skips it)" "$(q "select enabled from public.ai_tool_workflow_runtime('retouch', '$TOKEN') where name = 'a2'")" "f"
check "W8 the runtime carries the published version" "$(q "select distinct version from public.ai_tool_workflow_runtime('retouch', '$TOKEN')")" "2"
DRAFT=$(as_user "$ADMIN" "select public.ai_save_tool_workflow('retouch', '[$IMG]'::jsonb, 'd', null, false)->>'id'")
check "P2/W a draft does not change what production reads" "$(q "select distinct version from public.ai_tool_workflow_runtime('retouch', '$TOKEN')")" "2"
check "publishing a draft switches production atomically" "$(as_user "$ADMIN" "select public.ai_publish_tool_workflow('$DRAFT', 'go')->>'ok'")" "true"
check "…to the draft's version" "$(q "select distinct version from public.ai_tool_workflow_runtime('retouch', '$TOKEN')")" "3"
V2=$(q "select id from public.ai_tool_workflows where tool_key='retouch' and version = 2")
check "P8/W rollback creates a NEW version" "$(as_user "$ADMIN" "select public.ai_restore_tool_workflow('$V2', 'back')->>'version'")" "4"
check "…with the old version's steps" "$(q "select string_agg(name, ',' order by position) from public.ai_tool_workflow_runtime('retouch', '$TOKEN')")" "a1,a2,img"
check "…and history intact" "$(q "select count(*) from public.ai_tool_workflows where tool_key='retouch'")" "4"

echo "W5 — the customer cannot touch a workflow"
check "a customer cannot save one" "$(err "select public.ai_save_tool_workflow('retouch', '[$IMG]'::jsonb, null, 'r', true)" authenticated "$U1")" "not_authorized"
check "a customer cannot publish one" "$(err "select public.ai_publish_tool_workflow('$V2', 'x')" authenticated "$U1")" "not_authorized"
check "a customer cannot read steps" "$(as_user "$U1" "select count(*) from public.ai_tool_workflow_steps")" "0"
check "a customer cannot insert a step" "$(err "insert into public.ai_tool_workflow_steps (workflow_id, position, name, operation, output_kind, prompt_encrypted, prompt_iv, prompt_tag) values ('$V2', 7, 'x', 'analyze', 'text', 'c', 'i', 't')" authenticated "$U1" | grep -c 'row-level security')" "1"
check "a customer cannot reorder steps" "$(as_user "$U1" "with u as (update public.ai_tool_workflow_steps set position = position + 1 returning 1) select count(*) from u")" "0"
check "a customer without the token reads no runtime" "$(as_user "$U1" "select count(*) from public.ai_tool_workflow_runtime('retouch', 'guess')")" "0"

echo "K — knowledge retrieval"
S_READY=$(q "insert into public.knowledge_sets (name, status, product_category) values ('ready', 'ready', 'agd') returning id")
S_OTHER=$(q "insert into public.knowledge_sets (name, status) values ('other tool', 'ready') returning id")
S_BUSY=$(q "insert into public.knowledge_sets (name, status) values ('indexing', 'indexing') returning id")
q "insert into public.ai_tool_knowledge (tool_key, set_id) values ('retouch', '$S_READY'), ('retouch', '$S_BUSY'), ('prompts', '$S_OTHER')" >/dev/null
ex() { q "insert into public.knowledge_examples (set_id, enabled, review_status, hint_encrypted, hint_iv, hint_tag, scene, embedding)
  values ('$1', $2, '$3', 'h', 'i', 't', '$4', array[1,0,0]::double precision[]) returning id"; }
E_OK=$(ex "$S_READY" true approved "kuchnia")
E_PEND=$(ex "$S_READY" true pending "pdf-kandydat")
E_REJ=$(ex "$S_READY" true rejected "odrzucony")
E_OFF=$(ex "$S_READY" false approved "wyłączony")
E_BUSY=$(ex "$S_BUSY" true approved "niegotowy")
E_OTHER=$(ex "$S_OTHER" true approved "inne narzędzie")
check "K6 only approved + enabled examples of READY sets" "$(q "select string_agg(scene, ',') from public.knowledge_candidates('$TOKEN', 'retouch', null, 20)")" "kuchnia"
check "K7 a tool sees only its own assigned sets" "$(q "select string_agg(scene, ',') from public.knowledge_candidates('$TOKEN', 'prompts', null, 20)")" "inne narzędzie"
check "K7 a detached assignment stops retrieval" "$(q "update public.ai_tool_knowledge set enabled = false where tool_key = 'prompts'; select count(*) from public.knowledge_candidates('$TOKEN', 'prompts', null, 20)")" "0"
q "insert into public.knowledge_examples (set_id, review_status, hint_encrypted, hint_iv, hint_tag, scene) values ('$S_READY', 'approved', 'h', 'i', 't', 'bez-wektora')" >/dev/null
check "with a query vector, unembedded examples are not candidates" "$(q "select count(*) from public.knowledge_candidates('$TOKEN', 'retouch', array[1,0,0]::double precision[], 20) where scene = 'bez-wektora'")" "0"
check "a similarity is returned when a vector is given" "$(q "select round(similarity::numeric, 2) from public.knowledge_candidates('$TOKEN', 'retouch', array[1,0,0]::double precision[], 5)")" "1.00"
check "K8 the customer cannot read candidates without the token" "$(err "select * from public.knowledge_candidates('guess', 'retouch', null, 5)" authenticated "$U1")" "forbidden"
check "K8 the customer cannot read examples directly" "$(as_user "$U1" "select count(*) from public.knowledge_examples")" "0"
check "existing examples default to approved (no behaviour change)" "$(q "select column_default from information_schema.columns where table_name='knowledge_examples' and column_name='review_status'")" "'approved'::text"
check "review_status rejects unknown values" "$(err "update public.knowledge_examples set review_status = 'maybe' where id = '$E_OK'" | grep -c check)" "1"
check "K5 knowledge cannot publish a prompt (no function writes ai_tool_prompts)" "$(q "select count(*) from pg_proc where prosrc ilike '%ai_tool_prompts%' and proname in ('knowledge_candidates','ai_engine_run_record','generation_feedback_submit')")" "0"

echo "Trace"
JOB=$(q "insert into public.generation_jobs (workspace_id, user_id) values ('$WS', '$U1') returning id")
GEN=$(q "insert into public.generations (job_id, workspace_id) values ('$JOB', '$WS') returning id")
q "insert into public.usage_events (generation_job_id, status) values ('$JOB', 'succeeded')" >/dev/null
RUN="{\"tool_key\":\"retouch\",\"workspace_id\":\"$WS\",\"user_id\":\"$U1\",\"job_id\":\"$JOB\",\"mode\":\"workflow\",\"status\":\"ok\",\"workflow_version\":2,\"knowledge_example_ids\":[\"$E_OK\"],\"steps\":[{\"n\":1,\"name\":\"a1\",\"status\":\"ok\"}]}"
check "the trace needs the server token" "$(err "select public.ai_engine_run_record('guess', '$RUN'::jsonb)" authenticated "$U1")" "forbidden"
q "select public.ai_engine_run_record('$TOKEN', '$RUN'::jsonb)" >/dev/null
check "W8 the run records its workflow version" "$(q "select workflow_version from public.ai_engine_runs where job_id = '$JOB'")" "2"
check "a successful run counts example usage" "$(q "select usage_count from public.knowledge_examples where id = '$E_OK'")" "1"
check "the customer cannot read the trace" "$(as_user "$U1" "select count(*) from public.ai_engine_runs")" "0"
check "the admin can" "$(as_user "$ADMIN" "select count(*) from public.ai_engine_runs")" "1"
check "the customer cannot write a trace row directly" "$(err "insert into public.ai_engine_runs (tool_key, mode, status) values ('x','off','ok')" authenticated "$U1" | grep -c 'row-level security')" "1"

echo "F — feedback"
PROMPTS_BEFORE=$(q "select md5(coalesce(string_agg(id::text || status, ','), '')) from public.ai_tool_prompts")
vote() { as_user "$1" "select public.generation_feedback_submit('$2', $3, $4)->>'${5:-ok}'"; }
check "F1 👍 saves" "$(vote "$U1" "$GEN" "'like'" "array['good_scene']")" "true"
check "F1 …one row" "$(q "select count(*) from public.generation_feedback where generation_job_id = '$JOB'")" "1"
check "F3 a second 👍 (double click) does not duplicate" "$(vote "$U1" "$GEN" "'like'" "array['good_scene']"); $(q "select count(*) from public.generation_feedback where generation_job_id = '$JOB'")" "true; 1"
check "F6 the example moved up once" "$(q "select positive_count || '/' || negative_count from public.knowledge_examples where id = '$E_OK'")" "1/0"
check "F2 👎 replaces the vote (still one row)" "$(vote "$U1" "$GEN" "'dislike'" "array['wrong_product','bad_scene','hack']"); $(q "select count(*) || ':' || max(verdict) from public.generation_feedback where generation_job_id = '$JOB'")" "true; 1:dislike"
check "reasons are filtered to the allowed list" "$(q "select array_to_string(issues, ',') from public.generation_feedback where generation_job_id = '$JOB'")" "bad_scene,wrong_product"
check "F6 counters follow the change, not both" "$(q "select positive_count || '/' || negative_count from public.knowledge_examples where id = '$E_OK'")" "0/1"
check "withdrawing the vote removes it" "$(vote "$U1" "$GEN" "null" "'{}'"); $(q "select count(*) from public.generation_feedback where generation_job_id = '$JOB'")" "true; 0"
check "…and the counters return to zero" "$(q "select positive_count || '/' || negative_count from public.knowledge_examples where id = '$E_OK'")" "0/0"
check "F4 another user cannot rate this result" "$(vote "$U2" "$GEN" "'like'" "'{}'" error)" "not_found"
JOB_RUN=$(q "insert into public.generation_jobs (workspace_id, user_id, status) values ('$WS', '$U1', 'processing') returning id")
GEN_RUN=$(q "insert into public.generations (job_id, workspace_id) values ('$JOB_RUN', '$WS') returning id")
check "a job still running cannot be rated" "$(vote "$U1" "$GEN_RUN" "'like'" "'{}'" error)" "not_found"
check "an unknown verdict is refused" "$(vote "$U1" "$GEN" "'love'" "'{}'" error)" "invalid_verdict"
check "anon cannot vote" "$(err "select public.generation_feedback_submit('$GEN', 'like', '{}')" anon "" | grep -c 'permission denied')" "1"
check "a vote cannot be inserted directly (bypassing the counters)" "$(err "insert into public.generation_feedback (workspace_id, user_id, generation_job_id, verdict) values ('$WS', '$U1', '$JOB', 'like')" authenticated "$U1" | grep -c 'row-level security')" "1"
check "a legacy verdict cannot target someone else's job" "$(err "insert into public.generation_feedback (workspace_id, user_id, generation_job_id, verdict) values ('$WS2', '$U2', '$JOB', 'accepted')" authenticated "$U2" | grep -c 'row-level security')" "1"
check "the owner's legacy verdict still works" "$(err "insert into public.generation_feedback (workspace_id, user_id, generation_job_id, verdict) values ('$WS', '$U1', '$JOB', 'accepted')" authenticated "$U1")" "ok"
vote "$U1" "$GEN" "'like'" "'{}'" >/dev/null
check "a user reads only their own vote" "$(as_user "$U1" "select count(*) from public.generation_feedback_mine(array['$GEN']::uuid[])"),$(as_user "$U2" "select count(*) from public.generation_feedback_mine(array['$GEN']::uuid[])")" "1,0"
# Concept jobs: examples reach feedback through the SESSION's server-written run.
SESS=$(q "insert into public.prompt_sessions (workspace_id, knowledge_used) values ('$WS', '[\"$E_REJ\"]'::jsonb) returning id")
q "select public.ai_engine_run_record('$TOKEN', '{\"tool_key\":\"prompts\",\"workspace_id\":\"$WS\",\"user_id\":\"$U1\",\"prompt_session_id\":\"$SESS\",\"mode\":\"grovbase\",\"status\":\"ok\",\"knowledge_example_ids\":[\"$E_OTHER\"]}'::jsonb)" >/dev/null
JOB_C=$(q "insert into public.generation_jobs (workspace_id, user_id, prompt_session_id) values ('$WS', '$U1', '$SESS') returning id")
GEN_C=$(q "insert into public.generations (job_id, workspace_id) values ('$JOB_C', '$WS') returning id")
q "insert into public.usage_events (generation_job_id, status) values ('$JOB_C', 'succeeded')" >/dev/null
vote "$U1" "$GEN_C" "'like'" "'{}'" >/dev/null
check "a concept job credits the examples its session's RUN used" "$(q "select positive_count from public.knowledge_examples where id = '$E_OTHER'")" "1"
check "…never ids a customer wrote into prompt_sessions.knowledge_used" "$(q "select positive_count from public.knowledge_examples where id = '$E_REJ'")" "0"
check "F7 one vote does not reach the ranking threshold (5)" "$(q "select (positive_count + negative_count) < 5 from public.knowledge_examples where id = '$E_OTHER'")" "t"
# A job the customer fabricated through RLS (status 'completed', no charge):
FAKE=$(as_user "$U1" "insert into public.generation_jobs (workspace_id, user_id, status, prompt_session_id) values ('$WS', '$U1', 'completed', '$SESS') returning id")
FAKE_GEN=$(q "insert into public.generations (job_id, workspace_id) values ('$FAKE', '$WS') returning id")
vote "$U1" "$FAKE_GEN" "'like'" "'{}'" >/dev/null
check "a fabricated, never-billed job cannot move the ranking" "$(q "select positive_count from public.knowledge_examples where id = '$E_OTHER'")" "1"
check "a teammate's result is not offered for rating" "$(as_user "$U2" "select count(*) from public.generation_feedback_mine(array['$GEN_C']::uuid[])")" "0"
check "the owner's result is offered, with their vote" "$(as_user "$U1" "select verdict from public.generation_feedback_mine(array['$GEN_C']::uuid[])")" "like"
check "F5 feedback never touched a prompt" "$(q "select md5(coalesce(string_agg(id::text || status, ','), '')) from public.ai_tool_prompts")" "$PROMPTS_BEFORE"
check "F5 feedback never touched a workflow" "$(q "select count(*) from public.ai_tool_workflows where tool_key='retouch'")" "4"

echo "Runtime prompt read (ai_tool_runtime re-created)"
check "the runtime read still needs the token" "$(q "select count(*) from public.ai_tool_runtime('retouch', 'guess')")" "0"
check "…and returns the strategy with it" "$(q "select knowledge_strategy from public.ai_tool_runtime('retouch', '$TOKEN')")" "proven"

echo
if [ "$fails" -eq 0 ]; then echo "All AI engine SQL tests passed."; else echo "$fails FAILED"; exit 1; fi
