-- ═══════════════════════════════════════════════════════════════════════════
-- 0161 — GENERACJE W TOKU V2: the plan's parallel-generation limit, enforced
-- by the database; how long a generation usually takes; Miniaturka's stage.
--
-- WHAT THIS ADDS, AND WHAT IT DELIBERATELY DOES NOT.
--
--   · `subscription_plans.limits.concurrent_generations` — how many
--     generations one workspace may have IN PROGRESS at once. Defaults:
--     Bez planu (free) 1, Starter 1, PRO 3, Business (agency) 6. Written only
--     where a plan has no value yet, so an admin's edit (Admin → Plany)
--     survives a re-run. The admin changes it there; no code holds a number.
--
--   · A BEFORE INSERT guard on `generation_jobs` and on Miniaturka runs. The
--     limit is checked at the one moment that cannot race: the row that
--     makes a generation exist. Two parallel requests are serialised on a
--     per-workspace advisory lock, so they cannot both see "one slot left".
--     Only rows a CUSTOMER-FACING route marks (`settings.slot`) are counted
--     or refused — every internal job (a Miniaturka run's Retusz passes, its
--     composition, a workflow's steps, an admin test) is untouched, so no
--     existing path can be broken by this file.
--
--     It refuses BEFORE any credit moves: the job row is written before the
--     charge (lib/server/generation.ts), and the run before its first paid
--     step. Nothing here reads or writes a wallet, a transaction or a usage
--     event. The ledger stays the only place a balance changes.
--
--   · `generation_duration_estimates()` — the median of what really finished
--     in the last 7 days, per tool and image count (and Retusz on/off for
--     Miniaturka), only where at least 5 runs exist. Aggregates only: no row,
--     no user, no workspace leaves the function.
--
--   · `thumbnail_runs_active()` — the caller's own open Miniaturka runs with
--     a COARSE stage (retouch / compose / finish), so the in-progress tile
--     shows the real step instead of a timer-driven guess. Never a model, a
--     prompt, a step output or a cost.
--
-- Orphans never lock a customer out: a job counts only while it is
-- `queued`/`processing` and started in the last 15 minutes (no route lives
-- longer than 300 s), a run only while it is being driven or was touched in
-- the last 10 minutes. The reconciler (0102) still settles their money.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. The limit, per plan ─────────────────────────────────────────────────
update public.subscription_plans
   set limits = coalesce(limits, '{}'::jsonb) || jsonb_build_object(
         'concurrent_generations',
         case slug when 'free' then 1 when 'starter' then 1 when 'pro' then 3 when 'agency' then 6 end)
 where slug in ('free', 'starter', 'pro', 'agency')
   and not (coalesce(limits, '{}'::jsonb) ? 'concurrent_generations');

-- ── 2. The limit, per workspace ────────────────────────────────────────────
-- The live plan (active / trialing / past_due — the same rule as everywhere
-- else) or, without one, the free plan's value ("Bez planu"), else 1. A
-- value that is not a small whole number is ignored, never cast blindly.
create or replace function public.generation_concurrency_limit(p_workspace_id uuid)
returns integer
language sql stable security definer set search_path = public as $$
  select greatest(1, least(50, coalesce(
    (select case when (p.limits->>'concurrent_generations') ~ '^[0-9]{1,3}$'
                 then (p.limits->>'concurrent_generations')::integer end
       from public.subscriptions s
       join public.subscription_plans p on p.id = s.plan_id
      where s.workspace_id = p_workspace_id
        and s.status in ('active', 'trialing', 'past_due')
      order by s.created_at desc
      limit 1),
    (select case when (p.limits->>'concurrent_generations') ~ '^[0-9]{1,3}$'
                 then (p.limits->>'concurrent_generations')::integer end
       from public.subscription_plans p where p.slug = 'free'),
    1)))
$$;
revoke all on function public.generation_concurrency_limit(uuid) from public, anon, authenticated;

-- ── 3. What is in progress right now ───────────────────────────────────────
-- One row per OPERATION: the jobs of one click (a Retusz batch, the shots of
-- one GrovBase session) share `settings.slot.batch` and count once; a
-- Miniaturka run is one operation whatever it is doing inside.
create or replace function public.generation_active_operations(p_workspace_id uuid)
returns table (op_key text, kind text, started_at timestamptz)
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(j.settings->'slot'->>'batch', ''), j.id::text) as op_key,
         'job'::text as kind,
         min(coalesce(j.started_at, j.created_at)) as started_at
    from public.generation_jobs j
   where j.workspace_id = p_workspace_id
     and j.status in ('queued', 'processing')
     and coalesce(j.settings, '{}'::jsonb) ? 'slot'
     and coalesce(j.started_at, j.created_at) > now() - interval '15 minutes'
   group by 1
  union all
  select r.id::text, 'thumbnail'::text, r.created_at
    from public.ai_engine_runs r
   where r.workspace_id = p_workspace_id
     and r.run_kind = 'thumbnail'
     and r.status in ('queued', 'running')
     and (r.locked_until > now() or r.updated_at > now() - interval '10 minutes')
$$;
revoke all on function public.generation_active_operations(uuid) from public, anon, authenticated;

-- ── 4. The guard ───────────────────────────────────────────────────────────
-- Raises `generation_limit_reached:<limit>` (the route turns it into the
-- customer's message) or `generation_batch_full` (more than 3 jobs of one
-- click running at once — no panel sends that many; it bounds a forged
-- batch key to the size of a real one).
create or replace function public.generation_slot_guard()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_batch text;
  v_in_batch integer;
  v_limit integer;
  v_active integer;
begin
  if tg_table_name = 'generation_jobs' then
    if not (coalesce(new.settings, '{}'::jsonb) ? 'slot') then return new; end if;
    v_batch := nullif(new.settings->'slot'->>'batch', '');
  elsif tg_table_name = 'ai_engine_runs' then
    if new.run_kind is distinct from 'thumbnail' then return new; end if;
    v_batch := null;
  else
    return new;
  end if;
  if new.workspace_id is null then return new; end if;

  -- One decision at a time per workspace: the second of two simultaneous
  -- requests waits here and then counts the first.
  perform pg_advisory_xact_lock(hashtextextended('generation-slot:' || new.workspace_id::text, 0));

  if v_batch is not null then
    select count(*) into v_in_batch
      from public.generation_jobs j
     where j.workspace_id = new.workspace_id
       and j.settings->'slot'->>'batch' = v_batch
       and j.status in ('queued', 'processing')
       and coalesce(j.started_at, j.created_at) > now() - interval '15 minutes';
    if v_in_batch > 0 then
      -- The same click, already counted.
      if v_in_batch >= 3 then raise exception 'generation_batch_full'; end if;
      return new;
    end if;
  end if;

  v_limit := public.generation_concurrency_limit(new.workspace_id);
  select count(*) into v_active from public.generation_active_operations(new.workspace_id);
  if v_active >= v_limit then
    raise exception 'generation_limit_reached:%', v_limit;
  end if;
  return new;
end $$;
revoke all on function public.generation_slot_guard() from public, anon, authenticated;

drop trigger if exists generation_jobs_slot_guard on public.generation_jobs;
create trigger generation_jobs_slot_guard
  before insert on public.generation_jobs
  for each row execute function public.generation_slot_guard();

drop trigger if exists ai_engine_runs_slot_guard on public.ai_engine_runs;
create trigger ai_engine_runs_slot_guard
  before insert on public.ai_engine_runs
  for each row execute function public.generation_slot_guard();

-- ── 5. The customer's view of their limit ──────────────────────────────────
create or replace function public.generation_limit_state(p_workspace_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if p_workspace_id is null or not public.is_workspace_member(p_workspace_id) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  return jsonb_build_object(
    'limit', public.generation_concurrency_limit(p_workspace_id),
    'active', (select count(*) from public.generation_active_operations(p_workspace_id)),
    'plan', coalesce((
      select p.slug from public.subscriptions s join public.subscription_plans p on p.id = s.plan_id
       where s.workspace_id = p_workspace_id and s.status in ('active', 'trialing', 'past_due')
       order by s.created_at desc limit 1), 'free'));
end $$;
revoke all on function public.generation_limit_state(uuid) from public, anon;
grant execute on function public.generation_limit_state(uuid) to authenticated;

-- ── 6. How long it usually takes ───────────────────────────────────────────
-- Finished work only (completed jobs, ok runs), last 7 days, plausible
-- durations only, and no Miniaturka step counted as a job of its own. A
-- bucket with fewer than 5 runs has no estimate at all: the tile then shows
-- only the timer.
create or replace function public.generation_duration_estimates()
returns jsonb
language sql stable security definer set search_path = public as $$
  with j as (
    select coalesce(nullif(settings->>'operation', ''),
                    case when nullif(settings->>'concept_id', '') is not null then 'concept' else 'generator' end) as op,
           greatest(1, least(coalesce(quantity, 1), 4)) as n,
           extract(epoch from (completed_at - started_at)) * 1000 as ms
      from public.generation_jobs
     where status = 'completed'
       and completed_at > now() - interval '7 days'
       and started_at is not null
       and completed_at > started_at
       and completed_at - started_at < interval '10 minutes'
       and not (coalesce(settings, '{}'::jsonb) ? 'run_id')
  ), r as (
    select case when input->>'retouch' = 'true' then 'retouch' else 'plain' end as variant,
           extract(epoch from (finished_at - created_at)) * 1000 as ms
      from public.ai_engine_runs
     where run_kind = 'thumbnail'
       and status = 'ok'
       and finished_at > now() - interval '7 days'
       and finished_at > created_at
       and finished_at - created_at < interval '30 minutes'
  ), buckets as (
    select op || ':' || n as k, count(*) as c, percentile_cont(0.5) within group (order by ms) as med
      from j group by op, n
    union all
    select 'ecommerce_thumbnail:' || variant, count(*), percentile_cont(0.5) within group (order by ms)
      from r group by variant
  )
  select jsonb_build_object(
    'window_days', 7,
    'min_sample', 5,
    'medians', coalesce((select jsonb_object_agg(k, round(med)::bigint) from buckets where c >= 5), '{}'::jsonb))
$$;
revoke all on function public.generation_duration_estimates() from public, anon;
grant execute on function public.generation_duration_estimates() to authenticated;

-- ── 7. The caller's open Miniaturka runs, with their real stage ────────────
create or replace function public.thumbnail_runs_active(p_workspace_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', r.id,
      'status', r.status,
      'stage', case
                 when r.progress->>'stage' = 'retouch' then 'retouch'
                 when r.progress->>'stage' in ('prepare', 'compose') and r.status = 'running' then 'compose'
                 when r.progress->>'stage' = 'finish' then 'finish'
                 else null end,
      'retouch', r.input->>'retouch' = 'true',
      'photos', coalesce(jsonb_array_length(case when jsonb_typeof(r.input->'photos') = 'array' then r.input->'photos' end), 0),
      'driving', coalesce(r.locked_until > now(), false),
      'cancelling', r.error = 'cancel_requested',
      'created_at', r.created_at,
      'updated_at', r.updated_at) as x
      from public.ai_engine_runs r
     where r.run_kind = 'thumbnail'
       and r.user_id = auth.uid()
       and r.workspace_id = p_workspace_id
       and public.is_workspace_member(p_workspace_id)
       and r.status in ('queued', 'running')
       and r.created_at > now() - interval '6 hours'
     order by r.created_at desc
     limit 10
  ) q
$$;
revoke all on function public.thumbnail_runs_active(uuid) from public, anon;
grant execute on function public.thumbnail_runs_active(uuid) to authenticated;

-- ── 8. Drag & drop zdjęć V2: the "drag to reorder" line, per tool ──────────
-- The admin writes it in the tool's guide (Admin → the tool → Przewodnik),
-- stored as `tool_guides.content.hints.reorder` {pl,en,de}; the existing
-- check (tool_guide_content_ok) already holds every string in it to the
-- content rules. Read exactly like the guide itself: presentation only,
-- the same audience (anon included — a visitor's panel shows it too).
create or replace function public.tool_guide_hints()
returns table (tool_key text, hints jsonb)
language sql
stable
security definer
set search_path = public
as $fn$
  select g.tool_key, g.content -> 'hints'
    from public.tool_guides g
   where jsonb_typeof(g.content -> 'hints') = 'object';
$fn$;
revoke all on function public.tool_guide_hints() from public, anon, authenticated;
grant execute on function public.tool_guide_hints() to anon, authenticated;
