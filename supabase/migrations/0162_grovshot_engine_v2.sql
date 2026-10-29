-- ════════════════════════════════════════════════════════════════════════════
-- 0162 · GROVBASE SHOT — LIFESTYLE ENGINE V2
--
-- The new GrovShot lifestyle engine runs as a code-defined pipeline on the
-- Workflow v2 run store (ai_engine_runs + ai_engine_step_runs, 0129) — the
-- same store, lease and per-step idempotency Miniaturka uses (0139). This
-- migration only ADDS what that needs; nothing existing changes behaviour:
--
--   1. run kinds 'grovshot' (a customer order) and 'grovshot_test' (an admin
--      test of draft or published versions, never charged);
--   2. grovshot_run_create — the order, in the customer's own session, with
--      the open-run, hourly and daily caps and a balance check that counts
--      what the member's other open orders may still charge;
--   3. grovshot_run_status / grovshot_runs_active — the customer's view, a
--      closed vocabulary built key by key (never progress/input/outputs raw,
--      never a prompt, card, plan, verdict text, model or cost);
--   4. grovshot_analysis_lookup — reuse of an earlier analysis of the SAME
--      photo bytes (and, for the card, the same description), server only;
--   5. the plan's parallel-generation guard (0161) counts a V2 order as one
--      operation, exactly like a Miniaturka run;
--   6. ai_tools rows for the six stage keys (prompts are versioned per key
--      in ai_tool_prompts — nothing is published here);
--   7. the feature flag grovshot_engine_v2, OFF (enabled = false, admins
--      only once an admin switches it on in Admin → System);
--   8. 👍/👎 on a V2 shot pinned to its run from server-written evidence.
--
-- ROLLBACK: switch the flag off (Admin → System). No data needs undoing;
-- the functions below are inert while the flag is off. To remove entirely
-- (manual, only once no 'grovshot' rows exist): drop the functions of §2–4,
-- restore 0161 §3–4 and 0129 §6, re-add ai_engine_runs_v2_check without the
-- two kinds, delete the six ai_tools rows and the flag row.
-- ════════════════════════════════════════════════════════════════════════════

-- 1 ─────────────────────────────────────────────────────────────────────────
alter table public.ai_engine_runs drop constraint if exists ai_engine_runs_v2_check;
alter table public.ai_engine_runs add constraint ai_engine_runs_v2_check check (
  run_kind in ('trace', 'workflow', 'workflow_test', 'thumbnail', 'grovshot', 'grovshot_test')
  and (idempotency_key is null or char_length(idempotency_key) between 8 and 200)
  and jsonb_typeof(input) = 'object'
  and jsonb_typeof(outputs) = 'array'
  and jsonb_typeof(progress) = 'object'
  and (expected_outputs is null or expected_outputs between 1 and 50)
  and (lease_owner is null or char_length(lease_owner) <= 80)
  and invocations >= 0 and cost_unknown >= 0
  and (api_cost_usd_micros is null or api_cost_usd_micros >= 0)
);
create index if not exists ai_engine_runs_grovshot_user_idx
  on public.ai_engine_runs (user_id, created_at desc) where run_kind in ('grovshot', 'grovshot_test');

comment on column public.ai_engine_runs.input is
  'The inputs a resumed run needs (storage paths, sizes, quoted unit price, config versions). Never a prompt in plain text: a GrovShot V2 run keeps its start-time stage bodies SEALED (AES-GCM ciphertext under the prompt key).';

-- 2 ─────────────────────────────────────────────────────────────────────────
/*
  CREATE a GrovShot V2 order (or an admin test). Server token AND the
  customer's own session: the run belongs to auth.uid() in a workspace they
  are a member of. Idempotent on its key (the server derives it from the
  request's content, so a double click is one order).

  Refusals, all before anything is paid:
    too_many_runs      two open V2 orders already (open = touched ≤ 45 min);
    rate_limited       more orders this hour than the published config allows;
    analysis_limit     too many orders today that ended before any charge
                       (each one is an analysis GrovBase paid for);
    insufficient_credits  the balance cannot cover this order on top of what
                       the member's other open orders may still charge.
  Nothing is charged here: a shot is charged when it is delivered.
*/
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
    -- The same order still open: the same order (a double click, a lost
    -- answer). Finished: the customer asks for it again on purpose — a new
    -- order under a derived key.
    if v_existing.status in ('queued', 'running') then
      return jsonb_build_object('id', v_existing.id, 'created', false, 'status', v_existing.status);
    end if;
    v_key := left(v_key, 180) || ':' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);
  end if;

  -- One decision at a time per member: two simultaneous submits count each other.
  perform pg_advisory_xact_lock(hashtextextended('grovshot-create:' || v_uid::text, 0));

  if v_kind = 'grovshot' then
    if (select count(*) from public.ai_engine_runs
         where run_kind = 'grovshot' and user_id = v_uid
           and status in ('queued', 'running') and updated_at > now() - interval '45 minutes') >= 2 then
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
    -- The balance must cover this order AND what the member's other open
    -- orders in this workspace may still charge (quoted − charged so far).
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

-- 3 ─────────────────────────────────────────────────────────────────────────
/*
  THE CUSTOMER'S VIEW of their own order, built key by key from a closed
  vocabulary. Per shot (from the server-written step rows, row-atomic):
    delivered      its image is in the library (job id for the tile);
    not_delivered  with a reason: quality_failed | insufficient_credits |
                   unavailable — and whether credits came back (refunded) or
                   were never taken (the default: a shot is charged only when
                   it is delivered);
    working / queued.
  Notes are codes + photo numbers only (the client translates them).
*/
create or replace function public.grovshot_shot_states(p_run public.ai_engine_runs)
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'shot', s.n + 1,
      'state', case
                 when st.status = 'succeeded' then 'delivered'
                 when st.status = 'failed' then 'not_delivered'
                 when exists (select 1 from public.ai_engine_step_runs x
                               where x.run_id = p_run.id and x."position" between 5 and 8
                                 and x.item_index between s.n * 5 and s.n * 5 + 4 and x.status = 'running') then 'working'
                 else 'queued' end,
      'reason', case when st.status = 'failed' then
                  case when st.error_code = 'qc_rejected' then 'quality_failed'
                       when st.error_code = 'insufficient_credits' then 'insufficient_credits'
                       else 'unavailable' end end,
      'refunded', st.status = 'failed' and exists (
                    select 1 from public.ai_engine_step_runs c
                     where c.run_id = p_run.id and c."position" = 6
                       and c.item_index between s.n * 5 and s.n * 5 + 4 and c.status = 'succeeded'),
      'job_id', case when st.status = 'succeeded' and p_run.run_kind = 'grovshot'
                       and coalesce(st.output->>'job_id', '') ~ '^[0-9a-f-]{36}$'
                     then st.output->>'job_id' end
    ) order by s.n), '[]'::jsonb)
    -- A run that ended before a plan existed has no shots to list.
    from generate_series(0, case
           when p_run.status not in ('queued', 'running') and coalesce(p_run.progress->>'planned', '') !~ '^[0-9]{1,2}$' then -1
           else least(greatest(coalesce(case when (p_run.progress->>'planned') ~ '^[0-9]{1,2}$' then (p_run.progress->>'planned')::integer end,
                                         p_run.expected_outputs, 1), 1), 10) - 1 end) s(n)
    left join public.ai_engine_step_runs st
      on st.run_id = p_run.id and st."position" = 9 and st.item_index = s.n
$$;
revoke all on function public.grovshot_shot_states(public.ai_engine_runs) from public, anon, authenticated;

create or replace function public.grovshot_stage(p_stage text)
returns text
language sql immutable set search_path = public as $$
  select case when p_stage in ('analyze', 'plan', 'scenes', 'images', 'qc', 'results', 'done', 'failed', 'attention')
              then p_stage end
$$;

create or replace function public.grovshot_notes(p_progress jsonb)
returns jsonb
language sql immutable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'code', n->>'code',
      'photo', case when (n->>'photo') ~ '^(10|[1-9])$' then (n->>'photo')::integer end,
      'row', case when (n->>'row') ~ '^(10|[1-9])$' then (n->>'row')::integer end,
      'ask', case when n->>'ask' = 'true' then true end))), '[]'::jsonb)
    from jsonb_array_elements(case when jsonb_typeof(p_progress->'notes') = 'array' then p_progress->'notes' else '[]'::jsonb end) n
   where (n->>'code') ~ '^[a-z_]{2,40}$'
$$;

create or replace function public.grovshot_run_status(p_run_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', r.id,
    'kind', r.run_kind,
    'status', r.status,
    'stage', public.grovshot_stage(r.progress->>'stage'),
    'error', case when r.status in ('failed', 'blocked') then
               case when r.error in ('needs_attention', 'needs_dimensions', 'blocked_input', 'plan_invalid',
                                     'prompt_unconfigured', 'config_invalid', 'analysis_unavailable', 'invocation_limit',
                                     'insufficient_credits', 'unavailable', 'analysis_limit', 'reference_changed',
                                     'model_unavailable', 'feature_unavailable', 'account_blocked', 'not_delivered')
                    then r.error else 'common_error' end end,
    'shots', public.grovshot_shot_states(r),
    'ordered', r.expected_outputs,
    'notes', public.grovshot_notes(r.progress),
    'credits', coalesce(r.credits, 0),
    'driving', coalesce(r.locked_until > now(), false),
    'created_at', r.created_at,
    'finished_at', r.finished_at)
  from public.ai_engine_runs r
  where r.id = p_run_id
    and r.run_kind in ('grovshot', 'grovshot_test')
    and r.user_id = auth.uid()
    and public.is_workspace_member(r.workspace_id)
$$;
revoke all on function public.grovshot_run_status(uuid) from public, anon;
grant execute on function public.grovshot_run_status(uuid) to authenticated;

-- The caller's open V2 orders, for the in-progress tiles (0161 shape).
create or replace function public.grovshot_runs_active(p_workspace_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', r.id,
      'status', r.status,
      'stage', public.grovshot_stage(r.progress->>'stage'),
      'ordered', r.expected_outputs,
      'planned', case when (r.progress->>'planned') ~ '^(10|[1-9])$' then (r.progress->>'planned')::integer end,
      'delivered', (select count(*) from public.ai_engine_step_runs st
                     where st.run_id = r.id and st."position" = 9 and st.status = 'succeeded'),
      'settled', (select count(*) from public.ai_engine_step_runs st
                   where st.run_id = r.id and st."position" = 9 and st.status in ('succeeded', 'failed')),
      'ratio', case when (r.input->>'aspect_ratio') ~ '^(auto|[0-9]{1,2}:[0-9]{1,2})$' then r.input->>'aspect_ratio' end,
      'driving', coalesce(r.locked_until > now(), false),
      'created_at', r.created_at,
      'updated_at', r.updated_at) as x
      from public.ai_engine_runs r
     where r.run_kind = 'grovshot'
       and r.user_id = auth.uid()
       and r.workspace_id = p_workspace_id
       and public.is_workspace_member(p_workspace_id)
       and r.status in ('queued', 'running')
       and r.created_at > now() - interval '6 hours'
     order by r.created_at desc
     limit 10
  ) q
$$;
revoke all on function public.grovshot_runs_active(uuid) from public, anon;
grant execute on function public.grovshot_runs_active(uuid) to authenticated;

-- 4 ─────────────────────────────────────────────────────────────────────────
/*
  ANALYSIS REUSE, server only. The photo check (position 1) is reused for the
  same ordered photo BYTES (p_photo_key = hash of the shas + stage versions);
  the card (position 2) only when the description, dimensions and versions
  match too (p_card_key). Only finished runs of this workspace from the last
  7 days, only steps that succeeded. Returns the stored outputs for the
  server to copy — the customer never reads them.
*/
create or replace function public.grovshot_analysis_lookup(
  p_token text, p_workspace_id uuid, p_photo_key text, p_card_key text
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_validate jsonb;
  v_card jsonb;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if auth.uid() is null or p_workspace_id is null or not public.is_workspace_member(p_workspace_id) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if coalesce(char_length(p_photo_key), 0) not between 16 and 128 then return jsonb_build_object('validate', null, 'card', null); end if;
  select st.output into v_validate
    from public.ai_engine_runs r
    join public.ai_engine_step_runs st on st.run_id = r.id and st."position" = 1 and st.item_index = -1 and st.status = 'succeeded'
   where r.run_kind = 'grovshot' and r.workspace_id = p_workspace_id
     and r.status not in ('queued', 'running')
     and r.created_at > now() - interval '7 days'
     and r.input->>'photo_key' = p_photo_key
   order by r.created_at desc limit 1;
  if p_card_key is not null and char_length(p_card_key) between 16 and 128 then
    select st.output into v_card
      from public.ai_engine_runs r
      join public.ai_engine_step_runs st on st.run_id = r.id and st."position" = 2 and st.item_index = -1 and st.status = 'succeeded'
     where r.run_kind = 'grovshot' and r.workspace_id = p_workspace_id
       and r.status not in ('queued', 'running')
       and r.created_at > now() - interval '7 days'
       and r.input->>'card_key' = p_card_key
     order by r.created_at desc limit 1;
  end if;
  return jsonb_build_object('validate', v_validate, 'card', v_card);
end $$;
revoke all on function public.grovshot_analysis_lookup(text, uuid, text, text) from public, anon;
grant execute on function public.grovshot_analysis_lookup(text, uuid, text, text) to authenticated;

-- 5 ─────────────────────────────────────────────────────────────────────────
-- 0161 §3–4 restated: a V2 order counts as ONE operation, like Miniaturka.
-- Its per-shot jobs carry no `slot` and are not counted again.
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
  select r.id::text, r.run_kind, r.created_at
    from public.ai_engine_runs r
   where r.workspace_id = p_workspace_id
     and r.run_kind in ('thumbnail', 'grovshot')
     and r.status in ('queued', 'running')
     and (r.locked_until > now() or r.updated_at > now() - interval '10 minutes')
$$;
revoke all on function public.generation_active_operations(uuid) from public, anon, authenticated;

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
    if new.run_kind is null or new.run_kind not in ('thumbnail', 'grovshot') then return new; end if;
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

-- 6 ─────────────────────────────────────────────────────────────────────────
-- The six stage keys: rows only, so the existing versioned prompt machinery
-- (ai_save_tool_prompt / publish / restore, 0071) works for them. Nothing is
-- published by this migration — with nothing published, every V2 order is
-- refused before any paid call (prompt_unconfigured).
insert into public.ai_tools (tool_key, engine_mode, notes) values
  ('grovshot_v2_validate', 'grovbase', 'GrovShot V2 · Etap 0: sprawdzenie zdjęć (szablon systemowy + wiadomość z danymi).'),
  ('grovshot_v2_card', 'grovbase', 'GrovShot V2 · Etap 1: karta produktu.'),
  ('grovshot_v2_plan', 'grovbase', 'GrovShot V2 · Etap 2: plan ujęć.'),
  ('grovshot_v2_shot', 'grovbase', 'GrovShot V2 · Etap 3: wzorzec promptu ujęcia (10 bloków).'),
  ('grovshot_v2_qc', 'grovbase', 'GrovShot V2 · Etap 4: kontrola jakości.'),
  ('grovshot_v2_config', 'grovbase', 'GrovShot V2 · konfiguracja silnika (JSON): przepisy stylu, stopki, negative, progi QC, kandydaci, budżet.')
on conflict (tool_key) do nothing;

-- 7 ─────────────────────────────────────────────────────────────────────────
insert into public.feature_flags (flag, enabled, roles, rollout_percent, description) values
  ('grovshot_engine_v2', false, array['admin'], 100,
   'GrovShot Lifestyle Engine V2. Off = every order runs on V1. On with roles {admin} = admins only. Running orders keep the engine they started with.')
on conflict (flag) do nothing;

-- 8 ─────────────────────────────────────────────────────────────────────────
/*
  0129 §6 restated with one more source of truth. A V2 shot's job has no run
  pointing at it (the run holds many jobs), so the run is found through the
  shot's own ledger event — server-written (usage_events), never the
  member-writable job row: metadata.run_id of a SUCCEEDED grovshot_v2 event
  of that job, in the same workspace.
*/
create or replace function public.generation_feedback_pin()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_run public.ai_engine_runs;
  v_job record;
  v_run_id uuid;
begin
  if new.verdict not in ('like', 'dislike') then return new; end if;
  select * into v_run from public.ai_engine_runs r
   where r.job_id = new.generation_job_id and r.status in ('ok', 'partial')
   order by r.created_at desc limit 1;
  if v_run.id is null then
    select case when (e.metadata->>'run_id') ~ '^[0-9a-fA-F-]{36}$' then (e.metadata->>'run_id')::uuid end
      into v_run_id
      from public.usage_events e
     where e.generation_job_id = new.generation_job_id
       and e.metadata->>'operation' = 'grovshot_v2'
       and e.status = 'succeeded'
     order by e.created_at desc limit 1;
    if v_run_id is not null then
      select * into v_run from public.ai_engine_runs r
       where r.id = v_run_id and r.run_kind = 'grovshot' and r.workspace_id = new.workspace_id;
    end if;
  end if;
  select j.provider_slug, m.model_identifier into v_job
    from public.generation_jobs j left join public.ai_models m on m.id = j.model_id
   where j.id = new.generation_job_id;
  new.engine_run_id := v_run.id;
  new.tool_key := v_run.tool_key;
  new.workflow_version := v_run.workflow_version;
  new.prompt_version := v_run.prompt_version;
  new.model_label := left(coalesce(v_run.model_label, v_job.model_identifier), 120);
  new.provider_slug := left(v_job.provider_slug, 40);
  return new;
end $$;
