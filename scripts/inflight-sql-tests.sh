#!/usr/bin/env bash
#
# GENERACJE W TOKU V2 (0161), PROVEN AGAINST A REAL POSTGRES.
#
# What has to hold:
#   · every plan gets its default once; an admin's own value survives a re-run;
#   · the limit is the live plan's, or the free plan's without one;
#   · a job a customer route does NOT mark is never counted or refused — so no
#     internal path (Miniaturka's Retusz passes, a workflow's steps) can break;
#   · at the limit the next operation is refused BEFORE it exists, and two
#     simultaneous requests with one slot left start exactly one;
#   · the jobs of one click count once; a forged batch cannot run more than 3;
#   · finished work frees the slot at once; an orphan (an old `processing`
#     job, an undriven run) stops counting by itself;
#   · a Miniaturka run is one operation and is refused at the limit too;
#   · the estimate is a median of finished work only, and only where at least
#     5 runs exist; Miniaturka's is split by Retusz on/off;
#   · a customer sees only their own open runs, with the coarse stage, and
#     cannot call the internal functions; nothing here touches a wallet.
#
# Local harness only, its own database, removed on exit (KEEP_DB=1 keeps it).
#
#   bash scripts/pg-harness-up.sh && npm run test:inflight:sql
set -euo pipefail

PGSOCK="${PGSOCK:-/tmp/pgtest}"
PGPORT="${PGPORT:-5433}"
PGCONN=(-h "$PGSOCK" -p "$PGPORT" -U postgres)

if ! psql "${PGCONN[@]}" -d postgres -X -q -t -A -c 'select 1' >/dev/null 2>&1; then
  echo "inflight-sql: no harness on $PGSOCK:$PGPORT — run: bash scripts/pg-harness-up.sh" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
M="$ROOT/supabase/migrations"
MIG="$M/0161_generations_inflight_v2.sql"
[ -f "$MIG" ] || { echo "inflight-sql: $MIG not found" >&2; exit 2; }

extract() { # file, function name, end marker regex
  awk -v start="^create (or replace )?function public[.]$2[(]" -v stop="$3" \
    '$0 ~ start {on=1} on {print} on && $0 ~ stop {exit}' "$1"
}
MEMBER=$(extract "$M/0002_functions_and_triggers.sql" is_workspace_member '^[$][$];')
[ -n "$MEMBER" ] || { echo "inflight-sql: could not extract is_workspace_member" >&2; exit 2; }

DB="${INFLIGHT_DB:-inflight_sqltest}"
WORK=$(mktemp -d)
cleanup() {
  [ "${KEEP_DB:-0}" = "1" ] || dropdb "${PGCONN[@]}" --if-exists --force "$DB" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
q() { psql "${PGCONN[@]}" -d "$DB" -v ON_ERROR_STOP=1 -X -q -t -A "$@"; }

dropdb "${PGCONN[@]}" --if-exists --force "$DB" >/dev/null 2>&1 || true
createdb "${PGCONN[@]}" "$DB"

# The part of PROD 0161 touches: plans, subscriptions, members, the job and
# run tables (the columns the functions read), a wallet that must not move.
q >/dev/null <<'SQL'
set client_min_messages = warning;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema auth;
grant usage on schema public, auth to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
create function auth.uid() returns uuid language sql stable as $f$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$f$;
create table public.workspace_members (workspace_id uuid not null, user_id uuid not null, role text not null default 'owner');
create table public.subscription_plans (
  id uuid primary key default gen_random_uuid(), slug text unique, name text, limits jsonb default '{}'::jsonb);
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, plan_id uuid references public.subscription_plans(id),
  status text not null, created_at timestamptz not null default now());
create table public.generation_jobs (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, user_id uuid,
  status text not null default 'queued', quantity integer default 1, settings jsonb default '{}'::jsonb,
  started_at timestamptz, completed_at timestamptz, created_at timestamptz not null default now());
create table public.ai_engine_runs (
  id uuid primary key default gen_random_uuid(), workspace_id uuid, user_id uuid, run_kind text not null,
  status text not null default 'queued', error text, input jsonb default '{}'::jsonb, progress jsonb default '{}'::jsonb,
  locked_until timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  finished_at timestamptz);
create table public.credit_wallets (id uuid primary key default gen_random_uuid(), workspace_id uuid, balance integer);
create table public.tool_guides (tool_key text primary key, content jsonb);
create table public.test_results (name text, ok boolean, detail text);
grant insert on public.test_results to anon, authenticated;
SQL
q >/dev/null <<SQL
$MEMBER
SQL
q >/dev/null <<'SQL'
-- Workspaces: 1 free (no subscription), 2 pro (live), 3 lapsed pro, 4 business.
insert into public.subscription_plans (id, slug, name, limits) values
  ('10000000-0000-0000-0000-000000000000', 'free', 'Free', '{}'),
  ('10000000-0000-0000-0000-000000000001', 'starter', 'Starter', '{"max_products": 10}'),
  ('10000000-0000-0000-0000-000000000002', 'pro', 'Pro', '{}'),
  ('10000000-0000-0000-0000-000000000003', 'agency', 'Business', '{"concurrent_generations": 8}');
insert into public.workspace_members (workspace_id, user_id) values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002'),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000003'),
  ('20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000004');
insert into public.subscriptions (workspace_id, plan_id, status) values
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'active'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'canceled'),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000003', 'trialing');
insert into public.credit_wallets (workspace_id, balance) values ('20000000-0000-0000-0000-000000000001', 100);
SQL

q -f "$MIG" >/dev/null 2>"$WORK/mig.err" || { cat "$WORK/mig.err" >&2; exit 1; }

q >/dev/null <<'SQL'
create schema t;
grant usage on schema t to authenticated;
create or replace function t.as_user(p uuid) returns void language sql as $f$
  select set_config('request.jwt.claim.sub', p::text, false), set_config('role', 'authenticated', false)
$f$;
create or replace function t.as_admin() returns void language sql as $f$
  select set_config('role', 'postgres', false), set_config('request.jwt.claim.sub', '', false)
$f$;
-- A job as a customer route writes it (marked) — returns the error, or 'ok'.
create or replace function t.try_job(ws uuid, batch text default null) returns text language plpgsql as $f$
begin
  insert into public.generation_jobs (workspace_id, status, started_at, settings)
  values (ws, 'processing', now(), jsonb_build_object('slot', jsonb_build_object('tool', 'generator', 'batch', batch)));
  return 'ok';
exception when others then return sqlerrm;
end $f$;

grant execute on all functions in schema t to authenticated;
SQL

q >/dev/null <<'SQL'
-- ── defaults ─────────────────────────────────────────────────────────────
insert into public.test_results
select 'defaults: free 1, starter 1, pro 3; an admin''s 8 kept',
  string_agg(slug || '=' || coalesce(limits->>'concurrent_generations', '-'), ',' order by slug) = 'agency=8,free=1,pro=3,starter=1',
  string_agg(slug || '=' || coalesce(limits->>'concurrent_generations', '-'), ',' order by slug)
  from public.subscription_plans;
insert into public.test_results
select 'other limits keys kept', limits->>'max_products' = '10', limits::text
  from public.subscription_plans where slug = 'starter';

-- ── the limit per workspace ──────────────────────────────────────────────
insert into public.test_results
select 'limit: no plan → free (1), live pro → 3, lapsed pro → free, trialing business → 8',
  public.generation_concurrency_limit('20000000-0000-0000-0000-000000000001') = 1
  and public.generation_concurrency_limit('20000000-0000-0000-0000-000000000002') = 3
  and public.generation_concurrency_limit('20000000-0000-0000-0000-000000000003') = 1
  and public.generation_concurrency_limit('20000000-0000-0000-0000-000000000004') = 8, '';

-- ── unmarked jobs: never counted, never refused ──────────────────────────
insert into public.generation_jobs (workspace_id, status, started_at)
select '20000000-0000-0000-0000-000000000001', 'processing', now() from generate_series(1, 5);
insert into public.test_results
select 'five unmarked internal jobs: all written, none counted',
  (select count(*) from public.generation_jobs where workspace_id = '20000000-0000-0000-0000-000000000001') = 5
  and (select count(*) from public.generation_active_operations('20000000-0000-0000-0000-000000000001')) = 0, '';

-- ── free: one in progress, the second refused ────────────────────────────
insert into public.test_results
select 'free: first generation starts', t.try_job('20000000-0000-0000-0000-000000000001') = 'ok', '';
insert into public.test_results
select 'free: second refused with the limit', r = 'generation_limit_reached:1', r
  from (select t.try_job('20000000-0000-0000-0000-000000000001') r) x;
insert into public.test_results
select 'refused before it existed (no row written)',
  (select count(*) from public.generation_jobs where workspace_id = '20000000-0000-0000-0000-000000000001' and settings ? 'slot') = 1, '';
update public.generation_jobs set status = 'completed', completed_at = now()
 where workspace_id = '20000000-0000-0000-0000-000000000001' and settings ? 'slot';
insert into public.test_results
select 'a finished generation frees the slot at once', t.try_job('20000000-0000-0000-0000-000000000001') = 'ok', '';
update public.generation_jobs set status = 'failed'
 where workspace_id = '20000000-0000-0000-0000-000000000001' and settings ? 'slot';

-- ── one click = one operation; a forged batch is bounded ─────────────────
insert into public.test_results
select 'batch: first photo of a click starts', t.try_job('20000000-0000-0000-0000-000000000001', 'click-a') = 'ok', '';
insert into public.test_results
select 'batch: second photo of the SAME click joins', t.try_job('20000000-0000-0000-0000-000000000001', 'click-a') = 'ok', '';
insert into public.test_results
select 'batch: the click counts once', (select count(*) from public.generation_active_operations('20000000-0000-0000-0000-000000000001')) = 1, '';
insert into public.test_results
select 'batch: another click is a new operation (refused on free)',
  t.try_job('20000000-0000-0000-0000-000000000001', 'click-b') = 'generation_limit_reached:1', '';
insert into public.test_results
select 'batch: third of the click joins', t.try_job('20000000-0000-0000-0000-000000000001', 'click-a') = 'ok', '';
insert into public.test_results
select 'batch: a fourth at once is refused', r = 'generation_batch_full', r
  from (select t.try_job('20000000-0000-0000-0000-000000000001', 'click-a') r) x;
update public.generation_jobs set status = 'completed', completed_at = now()
 where workspace_id = '20000000-0000-0000-0000-000000000001' and settings ? 'slot';

-- ── orphans stop counting ────────────────────────────────────────────────
insert into public.generation_jobs (workspace_id, status, started_at, settings)
values ('20000000-0000-0000-0000-000000000001', 'processing', now() - interval '20 minutes', '{"slot": {"tool": "generator"}}');
insert into public.test_results
select 'an orphaned job (20 min in processing) does not lock the customer out',
  t.try_job('20000000-0000-0000-0000-000000000001') = 'ok', '';
update public.generation_jobs set status = 'completed' where workspace_id = '20000000-0000-0000-0000-000000000001';

-- ── pro: three at once ───────────────────────────────────────────────────
insert into public.test_results
select 'pro: three start, the fourth is refused with 3',
  t.try_job('20000000-0000-0000-0000-000000000002') = 'ok'
  and t.try_job('20000000-0000-0000-0000-000000000002') = 'ok'
  and t.try_job('20000000-0000-0000-0000-000000000002') = 'ok'
  and t.try_job('20000000-0000-0000-0000-000000000002') = 'generation_limit_reached:3', '';
insert into public.test_results
select 'workspaces are separate (pro full, free free)',
  (select count(*) from public.generation_active_operations('20000000-0000-0000-0000-000000000001')) = 0, '';

-- ── Miniaturka runs ──────────────────────────────────────────────────────
update public.generation_jobs set status = 'completed' where workspace_id = '20000000-0000-0000-0000-000000000002';
insert into public.ai_engine_runs (workspace_id, user_id, run_kind, status)
values ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'thumbnail', 'queued');
insert into public.test_results
select 'a Miniaturka run counts as one operation',
  (select count(*) from public.generation_active_operations('20000000-0000-0000-0000-000000000001')) = 1, '';
insert into public.test_results
select 'with a run open, a free generation is refused',
  t.try_job('20000000-0000-0000-0000-000000000001') = 'generation_limit_reached:1', '';
do $$ begin
  insert into public.ai_engine_runs (workspace_id, user_id, run_kind, status)
  values ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'thumbnail', 'queued');
  insert into public.test_results values ('a second Miniaturka run is refused on free', false, 'inserted');
exception when others then
  insert into public.test_results values ('a second Miniaturka run is refused on free', sqlerrm = 'generation_limit_reached:1', sqlerrm);
end $$;
insert into public.ai_engine_runs (workspace_id, user_id, run_kind, status)
values ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'trace', 'running');
insert into public.test_results
select 'trace/workflow rows are not Miniaturka runs (written, not counted)',
  (select count(*) from public.generation_active_operations('20000000-0000-0000-0000-000000000001')) = 1, '';
update public.ai_engine_runs set updated_at = now() - interval '15 minutes', locked_until = null
 where run_kind = 'thumbnail' and workspace_id = '20000000-0000-0000-0000-000000000001';
insert into public.test_results
select 'an undriven run untouched for 15 min stops counting',
  (select count(*) from public.generation_active_operations('20000000-0000-0000-0000-000000000001')) = 0, '';
update public.ai_engine_runs set locked_until = now() + interval '2 minutes'
 where run_kind = 'thumbnail' and workspace_id = '20000000-0000-0000-0000-000000000001';
insert into public.test_results
select 'a run being driven counts however long its call takes',
  (select count(*) from public.generation_active_operations('20000000-0000-0000-0000-000000000001')) = 1, '';
update public.ai_engine_runs set status = 'ok', finished_at = now()
 where run_kind = 'thumbnail' and workspace_id = '20000000-0000-0000-0000-000000000001';

-- ── no wallet moved ──────────────────────────────────────────────────────
insert into public.test_results
select 'the wallet never moved', balance = 100, balance::text from public.credit_wallets;
SQL

# ── two simultaneous requests, one slot ────────────────────────────────────
# Session A takes the slot and holds its transaction open; B starts while A is
# still open, waits on the workspace lock, and must count A.
q -c "update public.generation_jobs set status = 'completed' where workspace_id = '20000000-0000-0000-0000-000000000001'" >/dev/null
( psql "${PGCONN[@]}" -d "$DB" -X -q -t -A -c "
    begin;
    insert into public.generation_jobs (workspace_id, status, started_at, settings)
      values ('20000000-0000-0000-0000-000000000001', 'processing', now(), '{\"slot\": {\"tool\": \"a\"}}');
    select pg_sleep(1.5);
    commit;" >"$WORK/a.out" 2>"$WORK/a.err" && echo 0 >"$WORK/a.rc" || echo 1 >"$WORK/a.rc" ) &
sleep 0.4
( psql "${PGCONN[@]}" -d "$DB" -X -q -t -A -c "
    insert into public.generation_jobs (workspace_id, status, started_at, settings)
      values ('20000000-0000-0000-0000-000000000001', 'processing', now(), '{\"slot\": {\"tool\": \"b\"}}');" \
    >"$WORK/b.out" 2>"$WORK/b.err" && echo 0 >"$WORK/b.rc" || echo 1 >"$WORK/b.rc" ) &
wait
A_RC=$(cat "$WORK/a.rc"); B_RC=$(cat "$WORK/b.rc")
B_ERR=$(tr -d '\n' <"$WORK/b.err" | sed "s/'/''/g")
q >/dev/null <<SQL
insert into public.test_results values ('race: the first of two simultaneous requests starts', '$A_RC' = '0', '$A_RC');
insert into public.test_results values ('race: the second waits, counts the first and is refused',
  '$B_RC' <> '0' and position('generation_limit_reached:1' in '$B_ERR') > 0, '$B_ERR');
insert into public.test_results
select 'race: exactly one job exists', count(*) = 1, count(*)::text
  from public.generation_jobs where workspace_id = '20000000-0000-0000-0000-000000000001' and status = 'processing';
SQL

q >/dev/null <<'SQL'
update public.generation_jobs set status = 'completed', completed_at = now() where status = 'processing';
delete from public.generation_jobs;
delete from public.ai_engine_runs;

-- ── estimates ────────────────────────────────────────────────────────────
-- Retusz ×1: five finished (20,22,24,26,40 s) → median 24 s. Plus noise that
-- must be ignored: a failed one, a 12-minute one, an 8-day-old one, and a
-- Miniaturka step (run_id) that is not a job of its own.
insert into public.generation_jobs (workspace_id, status, quantity, settings, started_at, completed_at)
select '20000000-0000-0000-0000-000000000002', 'completed', 1, '{"operation": "image_retouch"}',
       now() - interval '1 hour', now() - interval '1 hour' + make_interval(secs => s)
  from unnest(array[20, 22, 24, 26, 40]) s;
insert into public.generation_jobs (workspace_id, status, quantity, settings, started_at, completed_at) values
  ('20000000-0000-0000-0000-000000000002', 'failed', 1, '{"operation": "image_retouch"}', now() - interval '1 hour', now() - interval '59 minutes'),
  ('20000000-0000-0000-0000-000000000002', 'completed', 1, '{"operation": "image_retouch"}', now() - interval '1 hour', now() - interval '48 minutes'),
  ('20000000-0000-0000-0000-000000000002', 'completed', 1, '{"operation": "image_retouch"}', now() - interval '8 days', now() - interval '8 days' + interval '1 second'),
  ('20000000-0000-0000-0000-000000000002', 'completed', 1, '{"operation": "image_retouch", "run_id": "x"}', now() - interval '1 hour', now() - interval '1 hour' + interval '1 second');
-- Generator ×2: only four finished → no estimate.
insert into public.generation_jobs (workspace_id, status, quantity, settings, started_at, completed_at)
select '20000000-0000-0000-0000-000000000002', 'completed', 2, '{}', now() - interval '1 hour', now() - interval '1 hour' + interval '50 seconds'
  from generate_series(1, 4);
-- Miniaturka: five plain runs (60 s), five with Retusz (100 s), one failed.
insert into public.ai_engine_runs (workspace_id, run_kind, status, input, created_at, finished_at)
select '20000000-0000-0000-0000-000000000002', 'thumbnail', 'ok', jsonb_build_object('retouch', r),
       now() - interval '2 hours', now() - interval '2 hours' + make_interval(secs => case when r then 100 else 60 end)
  from (select g > 5 as r from generate_series(1, 10) g) x;
insert into public.ai_engine_runs (workspace_id, run_kind, status, input, created_at, finished_at)
values ('20000000-0000-0000-0000-000000000002', 'thumbnail', 'failed', '{"retouch": true}', now() - interval '2 hours', now() - interval '1 hour');

select t.as_user('00000000-0000-0000-0000-000000000002');
insert into public.test_results
select 'estimate: Retusz ×1 median 24 s from finished work only',
  (public.generation_duration_estimates()->'medians'->>'image_retouch:1')::numeric = 24000,
  public.generation_duration_estimates()::text;
insert into public.test_results
select 'estimate: fewer than 5 runs → none',
  not (public.generation_duration_estimates()->'medians' ? 'generator:2'), public.generation_duration_estimates()::text;
insert into public.test_results
select 'estimate: Miniaturka split by Retusz (60 s / 100 s)',
  (public.generation_duration_estimates()->'medians'->>'ecommerce_thumbnail:plain')::numeric = 60000
  and (public.generation_duration_estimates()->'medians'->>'ecommerce_thumbnail:retouch')::numeric = 100000,
  public.generation_duration_estimates()::text;
select t.as_admin();

-- ── open runs and their stage ────────────────────────────────────────────
-- Fixtures written with triggers off: four open runs exceed Pro's 3 on purpose.
set session_replication_role = replica;
insert into public.ai_engine_runs (id, workspace_id, user_id, run_kind, status, input, progress) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002',
   'thumbnail', 'running', '{"retouch": true, "photos": ["a", "b", "c"]}', '{"stage": "retouch"}'),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002',
   'thumbnail', 'running', '{"retouch": false, "photos": ["a"]}', '{"stage": "compose"}'),
  ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002',
   'thumbnail', 'queued', '{"photos": ["a"]}', '{"stage": "prepare"}'),
  ('30000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000009',
   'thumbnail', 'running', '{"photos": ["a"]}', '{"stage": "compose"}');
set session_replication_role = origin;
select t.as_user('00000000-0000-0000-0000-000000000002');
insert into public.test_results
select 'open runs: own only, newest first, coarse stage',
  jsonb_array_length(x) = 3
  and (select string_agg(coalesce(e->>'stage', 'queued'), ',' order by e->>'id') from jsonb_array_elements(x) e) = 'retouch,compose,queued'
  and (select bool_and((e->>'id') <> '30000000-0000-0000-0000-000000000004') from jsonb_array_elements(x) e)
  and (select (e->>'photos')::int from jsonb_array_elements(x) e where e->>'id' = '30000000-0000-0000-0000-000000000001') = 3,
  x::text
  from (select public.thumbnail_runs_active('20000000-0000-0000-0000-000000000002') x) y;
insert into public.test_results
select 'open runs: nothing for a workspace the caller is not in',
  public.thumbnail_runs_active('20000000-0000-0000-0000-000000000001') = '[]'::jsonb, '';
insert into public.test_results
select 'limit state: member sees the limit and the workspace''s active count (all members)',
  (public.generation_limit_state('20000000-0000-0000-0000-000000000002')->>'limit') = '3'
  and (public.generation_limit_state('20000000-0000-0000-0000-000000000002')->>'active') = '4'
  and (public.generation_limit_state('20000000-0000-0000-0000-000000000002')->>'plan') = 'pro',
  public.generation_limit_state('20000000-0000-0000-0000-000000000002')::text;
insert into public.test_results
select 'limit state: a stranger gets nothing', public.generation_limit_state('20000000-0000-0000-0000-000000000001') ? 'error', '';
do $$ begin
  perform public.generation_concurrency_limit('20000000-0000-0000-0000-000000000002');
  insert into public.test_results values ('a customer cannot call the internal limit', false, 'called');
exception when others then
  insert into public.test_results values ('a customer cannot call the internal limit', true, sqlerrm);
end $$;
do $$ begin
  perform * from public.generation_active_operations('20000000-0000-0000-0000-000000000002');
  insert into public.test_results values ('a customer cannot list operations directly', false, 'called');
exception when others then
  insert into public.test_results values ('a customer cannot list operations directly', true, sqlerrm);
end $$;
select t.as_admin();
SQL

# The reorder line (Drag & drop zdjęć V2): saved hints only, readable by a visitor.
q >/dev/null <<'SQL'
insert into public.tool_guides (tool_key, content) values
  ('retouch', '{"tutorial": {}, "hints": {"reorder": {"pl": "Ułóż zdjęcia po kolei."}}}'),
  ('generator', '{"tutorial": {}, "hints": {"reorder": {}}}'),
  ('prompts', '{"tutorial": {}}');
select set_config('role', 'anon', false);
insert into public.test_results
select 'hints: only guides that saved one; an empty one (hidden) is kept; a visitor may read them',
  count(*) = 2 and bool_or(tool_key = 'retouch' and hints->'reorder'->>'pl' = 'Ułóż zdjęcia po kolei.')
  and bool_or(tool_key = 'generator' and hints->'reorder' = '{}'::jsonb), count(*)::text
  from public.tool_guide_hints();
select set_config('role', 'postgres', false);
SQL

# Re-run: an admin's change survives, nothing is duplicated.
q -c "update public.subscription_plans set limits = limits || '{\"concurrent_generations\": 5}' where slug = 'pro'" >/dev/null
q -f "$MIG" >/dev/null 2>"$WORK/mig2.err" || { cat "$WORK/mig2.err" >&2; exit 1; }
q >/dev/null <<'SQL'
insert into public.test_results
select 'an admin''s value survives a re-run', limits->>'concurrent_generations' = '5', limits::text
  from public.subscription_plans where slug = 'pro';
insert into public.test_results
select 're-run keeps one trigger per table', count(*) = 2, count(*)::text
  from pg_trigger where not tgisinternal and tgname like '%slot_guard';
SQL

FAIL=0
while IFS='|' read -r name ok detail; do
  if [ "$ok" = "t" ]; then echo "  ok   $name"; else echo "  FAIL $name — $detail"; FAIL=1; fi
done < <(q -c "select name, ok, detail from public.test_results")
TOTAL=$(q -c "select count(*) from public.test_results")
if [ "$FAIL" = "0" ]; then echo "inflight-sql: $TOTAL/$TOTAL passed"; else echo "inflight-sql: FAILED"; exit 1; fi
