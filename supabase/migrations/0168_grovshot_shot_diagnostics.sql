-- ════════════════════════════════════════════════════════════════════════════
-- 0168 · GROVBASE SHOT — PROCESS VIEW: EXPERIMENTS, PUBLICATION, RETENTION
--
-- The admin's process view reads what already exists (ai_engine_runs and
-- ai_engine_step_runs, admin-only by their RLS, 0151/0162). The engine now
-- also writes the observed network-boundary payload into those step rows
-- (output.boundary, output.boundary_summary) — no new table. This migration
-- adds only:
--
--   1. grovshot_shot_experiment_create — an admin's paid experiment on ONE
--      shot of an earlier lifestyle order: the admin's prompt and references
--      (photos of THAT order only), one Nano Banana Pro call. It is a test
--      run (grovshot_test): never charged to the customer, never in the
--      customer's gallery. It runs in the order's workspace so its image is
--      stored where the customer could later be shown it — only through (2).
--      The admin confirms the estimated price; a daily ceiling (every admin
--      together, app_settings grovshot_shot.diagnostics) and an hourly count
--      bound the spend. A double click returns the same run.
--   2. grovshot_shot_experiment_publish — the explicit "Dodaj do galerii
--      klienta": the experiment's image becomes one more version of that
--      shot in the customer's order (a generation of the shot's own job),
--      audited with on_behalf_of. Idempotent.
--   3. grovshot_diagnostics_purge + a daily pg_cron job — after the retention
--      (default 30 days) the full payloads go: the step rows keep only
--      output.boundary_summary; an experiment's own prompt text is replaced
--      by its SHA-256. The engine's working data (an order's assembled
--      prompts, which a customer's regeneration reuses) is not diagnostics
--      and stays.
--   4. app_settings grovshot_shot.diagnostics defaults — only when absent.
--
-- Nothing customer-facing changes; no price, limit or flag changes.
--
-- ROLLBACK (manual): select cron.unschedule('grovbase-grovshot-diagnostics-purge');
--   drop function public.grovshot_diagnostics_purge(), public.grovshot_shot_experiment_publish(uuid),
--     public.grovshot_shot_experiment_create(jsonb);
-- ════════════════════════════════════════════════════════════════════════════

set local lock_timeout = '10s';

/* 1 ── an admin's experiment on one shot ─────────────────────────────────*/
/*
  p_req: { source_run_id, shot (1-based), prompt, references: [order photo
  numbers, in send order, 1–6], confirm_usd_micros (the price the admin was
  shown and accepted) }.
*/
create or replace function public.grovshot_shot_experiment_create(p_req jsonb)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_src public.ai_engine_runs;
  v_pin jsonb;
  v_asm jsonb;
  v_shot integer := nullif(p_req->>'shot', '')::integer;
  v_prompt text := coalesce(p_req->>'prompt', '');
  v_refs jsonb := p_req->'references';
  v_photos integer;
  v_pattern text;
  v_unit bigint;
  v_estimate bigint;
  v_cap bigint;
  v_spent bigint;
  v_hour integer;
  v_input jsonb;
  v_key text;
  v_id uuid;
  r jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select * into v_src from public.ai_engine_runs where id = nullif(p_req->>'source_run_id', '')::uuid;
  if not found or v_src.input->>'pipeline' is distinct from 'lifestyle' or v_src.run_kind not in ('grovshot', 'grovshot_test') then
    return jsonb_build_object('error', 'not_found');
  end if;
  if v_src.input->'experiment' is not null and jsonb_typeof(v_src.input->'experiment') = 'object' then
    -- An experiment of an experiment points back at the real order.
    return jsonb_build_object('error', 'source_is_experiment');
  end if;
  v_photos := jsonb_array_length(v_src.input->'photos');
  if v_shot is null or v_shot < 1 or v_shot > 10 then return jsonb_build_object('error', 'invalid_input'); end if;
  if char_length(btrim(v_prompt)) = 0 or char_length(v_prompt) > 20000 then return jsonb_build_object('error', 'invalid_prompt'); end if;
  if jsonb_typeof(v_refs) is distinct from 'array' or jsonb_array_length(v_refs) not between 1 and 6 then return jsonb_build_object('error', 'invalid_references'); end if;
  for r in select * from jsonb_array_elements(v_refs) loop
    if jsonb_typeof(r) <> 'number' or (r::text)::numeric <> floor((r::text)::numeric) or (r::text)::integer not between 1 and v_photos then
      return jsonb_build_object('error', 'invalid_references');
    end if;
  end loop;
  if (select count(distinct x) from jsonb_array_elements_text(v_refs) x) <> jsonb_array_length(v_refs) then return jsonb_build_object('error', 'invalid_references'); end if;

  select output into v_pin from public.ai_engine_step_runs where run_id = v_src.id and "position" = 1 and item_index = -1 and status = 'succeeded';
  select output into v_asm from public.ai_engine_step_runs where run_id = v_src.id and "position" = 10 and item_index = 30 and status = 'succeeded';
  if v_pin is null or v_asm is null or jsonb_typeof(v_pin->'photo_shas') is distinct from 'array' then return jsonb_build_object('error', 'source_incomplete'); end if;
  select x->>'pattern' into v_pattern from jsonb_array_elements(coalesce(v_asm->'shots', '[]'::jsonb)) x where (x->>'numer')::integer = v_shot limit 1;
  if v_pattern is null then return jsonb_build_object('error', 'shot_not_found'); end if;

  v_unit := nullif(v_pin->>'unit_price_usd_micros', '')::bigint;
  if v_unit is null or v_unit <= 0 then return jsonb_build_object('error', 'price_unknown'); end if;
  -- The per-image price plus the input-token guard the engine reserves (lifestyle.ts).
  v_estimate := v_unit + 10000;
  if coalesce(nullif(p_req->>'confirm_usd_micros', '')::bigint, 0) < v_estimate then
    return jsonb_build_object('error', 'confirm_required', 'estimate_usd_micros', v_estimate);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('grovshot-experiment', 0));
  v_cap := round(coalesce(nullif((select value->'diagnostics'->>'experiment_daily_budget_usd' from public.app_settings where key = 'grovshot_shot'), '')::numeric, 2) * 1000000);
  select coalesce(sum(case when status in ('queued', 'running') then greatest(coalesce(api_cost_usd_micros, 0), coalesce(nullif(input->>'budget_cap_usd_micros', '')::bigint, 0))
                           else coalesce(api_cost_usd_micros, 0) end), 0)
    into v_spent from public.ai_engine_runs
   where run_kind = 'grovshot_test' and input ? 'experiment' and created_at > now() - interval '24 hours';
  if v_spent + v_estimate > v_cap then
    return jsonb_build_object('error', 'experiment_budget', 'spent_usd_micros', v_spent, 'cap_usd_micros', v_cap, 'estimate_usd_micros', v_estimate);
  end if;
  select count(*) into v_hour from public.ai_engine_runs
   where run_kind = 'grovshot_test' and input ? 'experiment' and user_id = v_uid and created_at > now() - interval '1 hour';
  if v_hour >= 20 then return jsonb_build_object('error', 'rate_limited'); end if;

  v_input := (v_src.input - 'regen' - 'user_plan' - 'notes' - 'test_product_id') || jsonb_build_object(
    'test', true, 'test_mode', 'full', 'shots', 1, 'notes', '', 'user_plan', null, 'regen', null,
    'photo_shas', v_pin->'photo_shas', 'unit_price_usd_micros', v_unit, 'budget_cap_usd_micros', v_estimate,
    'quote', jsonb_build_object('unit', 0, 'total', 0),
    'experiment', jsonb_build_object('source_run_id', v_src.id, 'shot', v_shot, 'prompt', v_prompt, 'references', v_refs,
      'pattern', v_pattern, 'confirmed_usd_micros', (p_req->>'confirm_usd_micros')::bigint, 'by', v_uid));
  v_key := 'gsexp:' || v_src.id::text || ':' || v_shot || ':' || floor(extract(epoch from now()) / 300)::bigint::text || ':'
    || left(encode(extensions.digest(convert_to(v_prompt || '|' || v_refs::text, 'UTF8'), 'sha256'), 'hex'), 24);
  insert into public.ai_engine_runs (
    tool_key, workspace_id, user_id, mode, status, run_kind, idempotency_key,
    engine_version, input, expected_outputs, credits, progress
  ) values (
    'prompts', v_src.workspace_id, v_uid, 'grovbase', 'queued', 'grovshot_test', v_key,
    v_src.engine_version, v_input, 1, 0, jsonb_build_object('stage', 'images')
  )
  on conflict (idempotency_key) where idempotency_key is not null do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.ai_engine_runs where idempotency_key = v_key;
    return jsonb_build_object('id', v_id, 'created', false, 'estimate_usd_micros', v_estimate);
  end if;
  perform public.log_activity(v_src.workspace_id, 'admin.grovshot_experiment_created', 'ai_engine_run', v_id,
    jsonb_build_object('source_run_id', v_src.id, 'shot', v_shot, 'references', v_refs, 'estimate_usd_micros', v_estimate,
      'prompt_sha256', encode(extensions.digest(convert_to(v_prompt, 'UTF8'), 'sha256'), 'hex')),
    v_src.user_id);
  return jsonb_build_object('id', v_id, 'created', true, 'estimate_usd_micros', v_estimate);
end $$;
revoke all on function public.grovshot_shot_experiment_create(jsonb) from public, anon;
grant execute on function public.grovshot_shot_experiment_create(jsonb) to authenticated;

/* 2 ── "Dodaj do galerii klienta" ─────────────────────────────────────────*/
create or replace function public.grovshot_shot_experiment_publish(p_run_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_run public.ai_engine_runs;
  v_src public.ai_engine_runs;
  v_settle jsonb;
  v_round jsonb;
  v_path text;
  v_job uuid;
  v_shot integer;
  v_gen uuid;
  v_asset uuid;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select * into v_run from public.ai_engine_runs where id = p_run_id and run_kind = 'grovshot_test';
  if not found or jsonb_typeof(v_run.input->'experiment') is distinct from 'object' then return jsonb_build_object('error', 'not_found'); end if;
  if v_run.status <> 'ok' then return jsonb_build_object('error', 'not_delivered'); end if;
  select g.id into v_gen from public.generation_assets a join public.generations g on g.id = a.generation_id
   where a.metadata->>'experiment_run_id' = v_run.id::text limit 1;
  if v_gen is not null then return jsonb_build_object('ok', true, 'generation_id', v_gen, 'duplicate', true); end if;
  select output into v_settle from public.ai_engine_step_runs where run_id = v_run.id and "position" = 9 and item_index = 0 and status = 'succeeded';
  v_path := v_settle->>'path';
  if v_path is null or v_settle->>'state' is distinct from 'delivered'
     or v_path !~ ('^' || v_run.workspace_id::text || '/gsv2-test/' || v_run.id::text || '/[A-Za-z0-9_.-]+$') then
    return jsonb_build_object('error', 'not_delivered');
  end if;
  select * into v_src from public.ai_engine_runs where id = (v_run.input->'experiment'->>'source_run_id')::uuid;
  if not found or v_src.run_kind <> 'grovshot' or v_src.workspace_id <> v_run.workspace_id then return jsonb_build_object('error', 'no_target'); end if;
  v_shot := (v_run.input->'experiment'->>'shot')::integer;
  select j.id into v_job from public.generation_jobs j
   where j.workspace_id = v_src.workspace_id and j.settings->>'run_id' = v_src.id::text and nullif(j.settings->>'shot', '')::integer = v_shot
   order by j.created_at limit 1;
  if v_job is null then return jsonb_build_object('error', 'no_target'); end if;
  select output into v_round from public.ai_engine_step_runs where run_id = v_run.id and "position" = 5 and status = 'succeeded' and (output->>'ok')::boolean
   order by item_index desc limit 1;
  insert into public.generations (job_id, workspace_id, quality_status, product_match_score)
  values (v_job, v_src.workspace_id, 'skipped'::public.quality_status, null) returning id into v_gen;
  insert into public.generation_assets (generation_id, asset_type, storage_path, width, height, metadata)
  values (v_gen, 'image', v_path, nullif(v_round->>'width', '')::integer, nullif(v_round->>'height', '')::integer,
    jsonb_build_object('tool', 'prompts', 'engine', 'grovshot_v2', 'pipeline', 'lifestyle', 'shot', v_shot,
      'experiment_run_id', v_run.id, 'published_by', auth.uid()))
  returning id into v_asset;
  perform public.log_activity(v_src.workspace_id, 'admin.grovshot_experiment_published', 'ai_engine_run', v_run.id,
    jsonb_build_object('source_run_id', v_src.id, 'shot', v_shot, 'generation_id', v_gen), v_src.user_id);
  return jsonb_build_object('ok', true, 'generation_id', v_gen, 'asset_id', v_asset, 'duplicate', false);
end $$;
revoke all on function public.grovshot_shot_experiment_publish(uuid) from public, anon;
grant execute on function public.grovshot_shot_experiment_publish(uuid) to authenticated;

/* 3 ── retention of the full diagnostics ─────────────────────────────────*/
create or replace function public.grovshot_diagnostics_purge()
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_days integer := coalesce(nullif((select value->'diagnostics'->>'retention_days' from public.app_settings where key = 'grovshot_shot'), '')::integer, 30);
  v_steps integer;
  v_runs integer;
begin
  v_days := least(greatest(v_days, 1), 365);
  update public.ai_engine_step_runs s set output = s.output - 'boundary'
    from public.ai_engine_runs r
   where r.id = s.run_id and r.input->>'pipeline' = 'lifestyle'
     and s.output ? 'boundary' and coalesce(s.finished_at, s.started_at, r.created_at) < now() - make_interval(days => v_days);
  get diagnostics v_steps = row_count;
  -- An experiment's own prompt is diagnostics too: its hash stays.
  update public.ai_engine_runs r set input = jsonb_set(r.input, '{experiment,prompt}',
      to_jsonb('[usunięto po ' || v_days || ' dniach] sha256:' || encode(extensions.digest(convert_to(r.input->'experiment'->>'prompt', 'UTF8'), 'sha256'), 'hex')))
   where r.run_kind = 'grovshot_test' and jsonb_typeof(r.input->'experiment') = 'object'
     and r.created_at < now() - make_interval(days => v_days)
     and coalesce(r.input->'experiment'->>'prompt', '') !~ '^\[usunięto po ';
  get diagnostics v_runs = row_count;
  update public.ai_engine_step_runs s set output = jsonb_set(s.output, '{shots,0,text}', '"[usunięto]"'::jsonb)
    from public.ai_engine_runs r
   where r.id = s.run_id and r.run_kind = 'grovshot_test' and jsonb_typeof(r.input->'experiment') = 'object'
     and s."position" = 10 and s.item_index = 30 and r.created_at < now() - make_interval(days => v_days)
     and s.output->'shots'->0->>'text' is distinct from '[usunięto]';
  return jsonb_build_object('days', v_days, 'steps', v_steps, 'experiments', v_runs);
end $$;
revoke all on function public.grovshot_diagnostics_purge() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'grovbase-grovshot-diagnostics-purge') then
    perform cron.unschedule('grovbase-grovshot-diagnostics-purge');
  end if;
  perform cron.schedule('grovbase-grovshot-diagnostics-purge', '23 3 * * *', 'select public.grovshot_diagnostics_purge()');
end $$;

/* 4 ── defaults (only when absent) ────────────────────────────────────────*/
update public.app_settings
   set value = value || jsonb_build_object('diagnostics', jsonb_build_object('retention_days', 30, 'experiment_daily_budget_usd', 2))
 where key = 'grovshot_shot' and not (value ? 'diagnostics');
