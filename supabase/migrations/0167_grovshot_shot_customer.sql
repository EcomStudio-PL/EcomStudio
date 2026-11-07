-- ════════════════════════════════════════════════════════════════════════════
-- 0167 · GROVBASE SHOT — STAGE 2 (the customer's sets) + the plan limits go
--
--   1. NO MORE PER-PLAN CONCURRENCY. generation_slot_guard (0161/0162) stops
--      refusing a job because the plan's `concurrent_generations` is reached.
--      What stays: the duplicate-click guard of one batch, and an ANTI-ABUSE
--      ceiling that is the same for everyone (12 operations in progress per
--      workspace) — the providers are paced by the global queue (0166 slots),
--      the money by the balance check and the ledger. The plans' limits JSON
--      is left in place (nothing reads it; removing data is not needed).
--   2. grovshot_run_create: the open-orders cap per member goes from 2 to 10
--      (an anti-abuse ceiling, not a plan limit); the hourly cap, the daily
--      cap of uncharged analyses and the balance check stay exactly as they
--      were.
--   3. grovshot_shot_choices — which version of a shot the customer uses
--      (the ZIP takes it); written only through grovshot_shot_choose.
--   4. grovshot_shot_reports — "Zgłoś problem" (reason + comment), written
--      only through grovshot_shot_report; never changes an image, never
--      charges, never writes a rule (the admin reads it in the quality panel).
--   5. grovshot_sets — the member's own lifestyle sets in a closed vocabulary
--      (no prompt, no card, no model): product name, per shot its title, its
--      kind (hero / uzycie / detal), its state, its regenerations' runs, the
--      chosen version.
--
-- ROLLBACK (manual): restore 0162's generation_slot_guard and grovshot_run_create;
--   drop function public.grovshot_sets(uuid, integer), public.grovshot_shot_report(uuid, text, text),
--   public.grovshot_shot_choose(uuid); drop table public.grovshot_shot_reports, public.grovshot_shot_choices.
-- ════════════════════════════════════════════════════════════════════════════

set local lock_timeout = '10s';

/* 1 ── no per-plan concurrency ──────────────────────────────────────────*/
create or replace function public.generation_slot_guard()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_batch text;
  v_in_batch integer;
  v_active integer;
  -- The same for every plan: a runaway client, not a pricing tier.
  c_abuse_ceiling constant integer := 12;
begin
  if tg_table_name = 'generation_jobs' then
    if not (coalesce(new.settings, '{}'::jsonb) ? 'slot') then return new; end if;
    v_batch := nullif(new.settings->'slot'->>'batch', '');
  elsif tg_table_name = 'ai_engine_runs' then
    if new.run_kind is null or new.run_kind not in ('thumbnail', 'grovshot') then return new; end if;
    v_batch := null;
  else
    return new;
  end if;
  if new.workspace_id is null then return new; end if;

  perform pg_advisory_xact_lock(hashtextextended('generation-slot:' || new.workspace_id::text, 0));

  if v_batch is not null then
    select count(*) into v_in_batch
      from public.generation_jobs j
     where j.workspace_id = new.workspace_id
       and j.settings->'slot'->>'batch' = v_batch
       and j.status in ('queued', 'processing')
       and coalesce(j.started_at, j.created_at) > now() - interval '15 minutes';
    if v_in_batch > 0 then
      -- The same click, already counted (a double click cannot multiply it).
      if v_in_batch >= 3 then raise exception 'generation_batch_full'; end if;
      return new;
    end if;
  end if;

  select count(*) into v_active from public.generation_active_operations(new.workspace_id);
  if v_active >= c_abuse_ceiling then
    raise exception 'generation_limit_reached:%', c_abuse_ceiling;
  end if;
  return new;
end $$;
revoke all on function public.generation_slot_guard() from public, anon, authenticated;

-- The panel's state: no plan limit to show any more (the ceiling is anti-abuse).
create or replace function public.generation_limit_state(p_workspace_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if p_workspace_id is null or not public.is_workspace_member(p_workspace_id) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  return jsonb_build_object('limit', null, 'active', (select count(*) from public.generation_active_operations(p_workspace_id)), 'plan', null);
end $$;

/* 2 ── the open-orders cap is anti-abuse (10), not 2 ─────────────────────*/
create or replace function public.grovshot_run_create(p_token text, p_run jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_ws uuid := nullif(p_run->>'workspace_id', '')::uuid;
  v_key text := nullif(p_run->>'idempotency_key', '');
  v_kind text := case when p_run->>'run_kind' = 'grovshot_test' then 'grovshot_test' else 'grovshot' end;
  v_shots integer := nullif(p_run->>'shots', '')::integer;
  v_total integer := coalesce(nullif(p_run->'input'->'quote'->>'total', '')::integer, -1);
  v_per_hour integer := least(greatest(coalesce(nullif(p_run->>'runs_per_hour', '')::integer, 20), 1), 200);
  v_per_day integer := least(greatest(coalesce(nullif(p_run->>'uncharged_per_day', '')::integer, 30), 1), 500);
  v_existing public.ai_engine_runs;
  v_balance integer;
  v_outstanding integer;
  v_id uuid;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if v_uid is null then return jsonb_build_object('error', 'unauthenticated'); end if;
  if v_ws is null or not public.is_workspace_member(v_ws) then return jsonb_build_object('error', 'forbidden'); end if;
  if v_kind = 'grovshot_test' and not public.is_admin(v_uid) then return jsonb_build_object('error', 'forbidden'); end if;
  if v_key is null or char_length(v_key) not between 8 and 200 then return jsonb_build_object('error', 'invalid_input'); end if;
  if jsonb_typeof(p_run->'input') is distinct from 'object' then return jsonb_build_object('error', 'invalid_input'); end if;
  if v_shots is null or v_shots not between 1 and 10 then return jsonb_build_object('error', 'invalid_input'); end if;
  if v_kind = 'grovshot' and v_total < 0 then return jsonb_build_object('error', 'invalid_input'); end if;

  select * into v_existing from public.ai_engine_runs where idempotency_key = v_key;
  if found then
    if v_existing.user_id is distinct from v_uid or v_existing.run_kind <> v_kind then
      return jsonb_build_object('error', 'forbidden');
    end if;
    if v_existing.status in ('queued', 'running') then
      return jsonb_build_object('id', v_existing.id, 'created', false, 'status', v_existing.status);
    end if;
    v_key := left(v_key, 180) || ':' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('grovshot-create:' || v_uid::text, 0));

  if v_kind = 'grovshot' then
    if (select count(*) from public.ai_engine_runs
         where run_kind = 'grovshot' and user_id = v_uid
           and status in ('queued', 'running') and updated_at > now() - interval '45 minutes') >= 10 then
      return jsonb_build_object('error', 'too_many_runs');
    end if;
    if (select count(*) from public.ai_engine_runs
         where run_kind = 'grovshot' and user_id = v_uid and created_at > now() - interval '1 hour') >= v_per_hour then
      return jsonb_build_object('error', 'rate_limited');
    end if;
    if (select count(*) from public.ai_engine_runs
         where run_kind = 'grovshot' and user_id = v_uid and created_at > now() - interval '24 hours'
           and status in ('blocked', 'failed') and coalesce(credits, 0) = 0) >= v_per_day then
      return jsonb_build_object('error', 'analysis_limit');
    end if;
    select coalesce(w.balance, 0) into v_balance from public.credit_wallets w where w.workspace_id = v_ws;
    select coalesce(sum(greatest(0, coalesce(nullif(r.input->'quote'->>'total', '')::integer, 0) - coalesce(r.credits, 0))), 0)
      into v_outstanding
      from public.ai_engine_runs r
     where r.run_kind = 'grovshot' and r.workspace_id = v_ws
       and r.status in ('queued', 'running') and r.updated_at > now() - interval '45 minutes';
    if coalesce(v_balance, 0) - v_outstanding < v_total then
      return jsonb_build_object('error', 'insufficient_credits',
        'missing', v_total - (coalesce(v_balance, 0) - v_outstanding));
    end if;
  end if;

  insert into public.ai_engine_runs (
    tool_key, workspace_id, user_id, mode, status, run_kind, idempotency_key,
    engine_version, prompt_version, input, expected_outputs, credits, progress
  ) values (
    'prompts', v_ws, v_uid, 'grovbase', 'queued', v_kind, v_key,
    left(nullif(p_run->>'engine_version', ''), 40),
    nullif(p_run->>'prompt_version', '')::integer,
    p_run->'input', v_shots, 0,
    jsonb_build_object('stage', 'analyze')
  )
  on conflict (idempotency_key) where idempotency_key is not null do nothing
  returning id into v_id;
  if v_id is null then
    select * into v_existing from public.ai_engine_runs where idempotency_key = v_key;
    if v_existing.user_id is distinct from v_uid then return jsonb_build_object('error', 'forbidden'); end if;
    return jsonb_build_object('id', v_existing.id, 'created', false, 'status', v_existing.status);
  end if;
  return jsonb_build_object('id', v_id, 'created', true, 'status', 'queued');
end $$;
revoke all on function public.grovshot_run_create(text, jsonb) from public, anon;
grant execute on function public.grovshot_run_create(text, jsonb) to authenticated;

/* 3–4 ── the chosen version, the reports ──────────────────────────────────*/
create table if not exists public.grovshot_shot_choices (
  run_id uuid not null references public.ai_engine_runs(id) on delete cascade,
  shot integer not null check (shot between 1 and 10),
  generation_id uuid not null references public.generations(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  chosen_by uuid references public.profiles(id) on delete set null,
  chosen_at timestamptz not null default now(),
  primary key (run_id, shot)
);
alter table public.grovshot_shot_choices enable row level security;
drop policy if exists grovshot_shot_choices_member_read on public.grovshot_shot_choices;
create policy grovshot_shot_choices_member_read on public.grovshot_shot_choices for select to authenticated
  using ((select public.is_workspace_member(workspace_id)) or (select public.is_admin()));
revoke insert, update, delete on public.grovshot_shot_choices from anon, authenticated;

create table if not exists public.grovshot_shot_reports (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_engine_runs(id) on delete cascade,
  shot integer not null check (shot between 1 and 10),
  generation_id uuid references public.generations(id) on delete set null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  reason text not null check (reason in ('product_changed', 'wrong_scale', 'hands_faces', 'light_mood', 'scene_mismatch', 'other')),
  comment text check (comment is null or char_length(comment) <= 1000),
  kb_version integer,
  created_at timestamptz not null default now()
);
create index if not exists grovshot_shot_reports_idx on public.grovshot_shot_reports (created_at desc);
alter table public.grovshot_shot_reports enable row level security;
drop policy if exists grovshot_shot_reports_admin_read on public.grovshot_shot_reports;
create policy grovshot_shot_reports_admin_read on public.grovshot_shot_reports for select to authenticated
  using ((select public.is_admin()));
revoke insert, update, delete on public.grovshot_shot_reports from anon, authenticated;

-- The set a generation belongs to: its run (a regeneration points at the
-- order it regenerates) and the shot number — from the server-written job
-- and run rows, never from anything a member can edit.
create or replace function public.grovshot_shot_of_generation(p_generation_id uuid)
returns table (root_run uuid, shot integer, workspace_id uuid, kb_version integer)
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(r.input->'regen'->>'source_run_id', '')::uuid, r.id),
         coalesce(nullif(r.input->'regen'->>'shot', '')::integer, nullif(j.settings->>'shot', '')::integer),
         g.workspace_id,
         nullif(r.input->'kb'->>'version', '')::integer
    from public.generations g
    join public.generation_jobs j on j.id = g.job_id
    join public.ai_engine_runs r on r.id = (j.settings->>'run_id')::uuid
   where g.id = p_generation_id and r.run_kind = 'grovshot' and r.input->>'pipeline' = 'lifestyle'
$$;
revoke all on function public.grovshot_shot_of_generation(uuid) from public, anon, authenticated;

create or replace function public.grovshot_shot_choose(p_generation_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v record;
begin
  select * into v from public.grovshot_shot_of_generation(p_generation_id);
  if not found or v.shot is null or not public.is_workspace_member(v.workspace_id) then return jsonb_build_object('error', 'not_found'); end if;
  insert into public.grovshot_shot_choices (run_id, shot, generation_id, workspace_id, chosen_by)
  values (v.root_run, v.shot, p_generation_id, v.workspace_id, auth.uid())
  on conflict (run_id, shot) do update set generation_id = excluded.generation_id, chosen_by = excluded.chosen_by, chosen_at = now();
  return jsonb_build_object('ok', true, 'run_id', v.root_run, 'shot', v.shot);
end $$;
revoke all on function public.grovshot_shot_choose(uuid) from public, anon;
grant execute on function public.grovshot_shot_choose(uuid) to authenticated;

create or replace function public.grovshot_shot_report(p_generation_id uuid, p_reason text, p_comment text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v record;
  v_recent integer;
begin
  select * into v from public.grovshot_shot_of_generation(p_generation_id);
  if not found or v.shot is null or not public.is_workspace_member(v.workspace_id) then return jsonb_build_object('error', 'not_found'); end if;
  if p_reason not in ('product_changed', 'wrong_scale', 'hands_faces', 'light_mood', 'scene_mismatch', 'other') then
    return jsonb_build_object('error', 'invalid_input');
  end if;
  -- Anti-abuse: a handful per hour per member is plenty.
  select count(*) into v_recent from public.grovshot_shot_reports where user_id = auth.uid() and created_at > now() - interval '1 hour';
  if v_recent >= 30 then return jsonb_build_object('error', 'rate_limited'); end if;
  insert into public.grovshot_shot_reports (run_id, shot, generation_id, workspace_id, user_id, reason, comment, kb_version)
  values (v.root_run, v.shot, p_generation_id, v.workspace_id, auth.uid(), p_reason,
          nullif(left(btrim(coalesce(p_comment, '')), 1000), ''), v.kb_version);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.grovshot_shot_report(uuid, text, text) from public, anon;
grant execute on function public.grovshot_shot_report(uuid, text, text) to authenticated;

/* 5 ── the member's own sets (closed vocabulary) ─────────────────────────*/
create or replace function public.grovshot_sets(p_workspace_id uuid, p_limit integer)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.is_workspace_member(p_workspace_id) then raise exception 'forbidden'; end if;
  return (
    select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) from (
      select jsonb_build_object(
        'id', r.id, 'created_at', r.created_at, 'status', r.status, 'stage', public.grovshot_stage(r.progress->>'stage'),
        'ordered', (r.input->>'shots')::integer, 'ratio', r.input->>'aspect_ratio', 'resolution', r.input->>'resolution',
        'unit', (r.input->'quote'->>'unit')::integer,
        'product', (select ps.product_name from public.prompt_sessions ps
                     where ps.id = (select (m.output->>'session_id')::uuid from public.ai_engine_step_runs m
                                     where m.run_id = r.id and m."position" = 4 and m.item_index = -1 and m.status = 'succeeded'
                                       and coalesce(m.output->>'session_id', '') ~ '^[0-9a-f-]{36}$')),
        'shots', public.grovshot_shot_states(r),
        'kinds', (select coalesce(jsonb_agg(u->>'typ' order by (u->>'numer')::integer), '[]'::jsonb)
                    from public.ai_engine_step_runs p, jsonb_array_elements(case when jsonb_typeof(p.output->'raw'->'ujecia') = 'array' then p.output->'raw'->'ujecia' else '[]'::jsonb end) u
                   where p.run_id = r.id and p."position" = 3 and p.status = 'succeeded'
                     and p.item_index = (select max(q.item_index) from public.ai_engine_step_runs q
                                          where q.run_id = r.id and q."position" = 3 and q.status = 'succeeded' and coalesce((q.output->>'usable')::boolean, true))),
        'titles', (select coalesce(jsonb_agg(g.customer_title order by g.priority), '[]'::jsonb) from public.generated_prompts g
                    where g.session_id = (select (m.output->>'session_id')::uuid from public.ai_engine_step_runs m
                                           where m.run_id = r.id and m."position" = 4 and m.item_index = -1 and m.status = 'succeeded'
                                             and coalesce(m.output->>'session_id', '') ~ '^[0-9a-f-]{36}$')),
        'regens', (select coalesce(jsonb_agg(jsonb_build_object(
                      'id', rr.id, 'shot', (rr.input->'regen'->>'shot')::integer, 'status', rr.status, 'created_at', rr.created_at,
                      'state', (public.grovshot_shot_states(rr))->0) order by rr.created_at), '[]'::jsonb)
                     from public.ai_engine_runs rr
                    where rr.run_kind = 'grovshot' and rr.user_id = v_uid and rr.input->'regen'->>'source_run_id' = r.id::text),
        'chosen', (select coalesce(jsonb_object_agg(c.shot::text, c.generation_id), '{}'::jsonb) from public.grovshot_shot_choices c where c.run_id = r.id)
      ) as x
        from public.ai_engine_runs r
       where r.run_kind = 'grovshot' and r.user_id = v_uid and r.workspace_id = p_workspace_id
         and r.input->>'pipeline' = 'lifestyle' and r.input->'regen' is null
       order by r.created_at desc
       limit least(greatest(coalesce(p_limit, 10), 1), 30)
    ) s
  );
end $$;
revoke all on function public.grovshot_sets(uuid, integer) from public, anon;
grant execute on function public.grovshot_sets(uuid, integer) to authenticated;
