-- 0139 — MINIATURKA AI: Retusz AI (optional, per photo) → GPT Image 2.5
-- Sunburst (one request, every photo) → local 2560×2560 finish.
--
-- ADDITIVE ONLY. No table, column, row, price or policy that exists today is
-- dropped or rewritten; one CHECK constraint is widened by one value and one
-- denylist function gains one key (both listed verbatim below).
--
-- APPLY IT BEFORE THE DEPLOY THAT USES IT. The code reads every object below
-- defensively: no config reader → the tool reports "not configured", no run
-- function → the start refuses, and nothing is charged either way.
--
-- 1. REGISTRY ROW. Miniaturka gets its own row in the tool registry
--    (`ecommerce_thumbnail` — the same key as its feature switch and its
--    library operation, like the Moda tools), so its prompt is written and
--    published in Admin → Narzędzia i silniki → Silnik, never in code.
--    engine_mode 'grovbase': the published prompt only, no variables.
--
-- 2. THE SERVICE, UNPRICED. `tool_thumbnail` bills the Sunburst step. It is
--    inserted DISABLED with credits_cost 0: GrovBase does not choose the sale
--    price — the operator sets it (Admin → Usługi) and enables the row. Until
--    then the tool refuses before any call (`price_unconfigured`), so a zero
--    can never be charged for a paid provider call. Each optional Retusz pass
--    is billed by Retusz itself, at its own price, exactly as on /retusz.
--
-- 3. THE CONFIGURATION, PRIVATE. `app_settings.thumbnail` holds the model,
--    request quality and size, the photo limit, the local-finish parameters,
--    the operator's provider token rates and the approved prompt digest. It
--    joins the 0107/0138 private list (the four keys already there are kept
--    verbatim) and the server reads it through a token-gated function, like
--    the "Dodaj tło AI" presets. Admins read/write it via settings_admin_write.
--
-- 4. DURABLE RUNS. A Miniaturka run is an `ai_engine_runs` row of the new
--    kind 'thumbnail' with one `ai_engine_step_runs` row per step (Retusz per
--    photo, the Sunburst composition, the local finish) — the 0129 lease and
--    step functions unchanged. 'thumbnail' runs are invisible to
--    ai_engine_run_status (which answers for 'workflow' runs only), so the
--    workflow poller can never pick one up. Four functions of their own:
--      thumbnail_run_create  server token + the caller's own session; at most
--                            two open runs per member; idempotent on its key
--      thumbnail_run_status  the customer's view of THEIR run (no model, no
--                            prompt, no provider usage)
--      thumbnail_runs_recent the customer's recent runs (resume after refresh)
--      thumbnail_run_cancel  the customer stops THEIR run between steps
--
-- ROLLBACK (manual, in this order; nothing else depends on these objects):
--   drop function if exists public.thumbnail_run_cancel(uuid);
--   drop function if exists public.thumbnail_runs_recent(uuid, integer);
--   drop function if exists public.thumbnail_run_status(uuid);
--   drop function if exists public.thumbnail_run_create(text, jsonb);
--   drop function if exists public.thumbnail_config_read(text);
--   drop index if exists public.ai_engine_runs_thumbnail_user_idx;
--   (re-add ai_engine_runs_v2_check without 'thumbnail' once no such rows exist)
--   (restore app_setting_is_private without 'thumbnail' — 0138's body)
--   delete from public.app_settings where key = 'thumbnail';
--   delete from public.ai_tools where tool_key = 'ecommerce_thumbnail';
--   delete from public.service_catalog where slug = 'tool_thumbnail';

-- 1 ─────────────────────────────────────────────────────────────────────────
insert into public.ai_tools (tool_key, service_slug, engine_mode, allow_model_choice, fallback_enabled, timeout_ms, max_attempts, notes)
values ('ecommerce_thumbnail', 'tool_thumbnail', 'grovbase', false, false, 240000, 1,
        'Miniaturka: Retusz (opcjonalnie) → GPT Image 2.5 Sunburst → 2560×2560')
on conflict (tool_key) do nothing;

-- 2 ─────────────────────────────────────────────────────────────────────────
insert into public.service_catalog
  (slug, name, category, service_type, unit, credits_cost, api_cost_usd_micros, min_margin_percent, enabled, sort_order, metadata)
values
  ('tool_thumbnail', 'Miniaturka AI', 'tools', 'image', 'image', 0, 0, 50, false, 34,
   jsonb_build_object('note', 'Price is set by the operator. Retusz passes are billed by Retusz.'))
on conflict (slug) do nothing;

-- 3 ─────────────────────────────────────────────────────────────────────────
create or replace function public.app_setting_is_private(p_key text)
returns boolean
language sql
immutable parallel safe
as $$
  select p_key in (
    'notifications',
    'login_security_dispatch',
    'auth_email_hook',
    'ai_background_presets',
    'thumbnail'
  );
$$;

insert into public.app_settings (key, value)
values ('thumbnail', jsonb_build_object(
  'v', 1,
  'model', 'gpt-image-2.5-sunburst',
  'size', '2048x2048',
  'quality', 'high',
  'max_photos', 10,
  'timeout_ms', 200000,
  'finish', jsonb_build_object(
    'target', 2560, 'margin_percent', 3, 'brightness_percent', 5,
    'kernel', 'lanczos3', 'format', 'png'),
  -- USD per one million tokens, entered by the operator from OpenAI's price
  -- list. Null = unknown: a cost is never computed from a guessed rate.
  'token_prices', jsonb_build_object(
    'text_input', null, 'cached_text_input', null,
    'image_input', null, 'cached_image_input', null,
    'image_output', null, 'text_output', null),
  'approved_prompt', null
))
on conflict (key) do nothing;

create or replace function public.thumbnail_config_read(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  return coalesce((select s.value from public.app_settings s where s.key = 'thumbnail'), '{}'::jsonb);
end $$;
revoke all on function public.thumbnail_config_read(text) from public, anon;
grant execute on function public.thumbnail_config_read(text) to authenticated;
comment on function public.thumbnail_config_read(text) is
  'Miniaturka configuration (model, quality, limits, finish, token rates, approved prompt digest) for GrovBase''s own server only: gated by server_call_ok. The row is private (app_setting_is_private).';

-- 4 ─────────────────────────────────────────────────────────────────────────
alter table public.ai_engine_runs drop constraint if exists ai_engine_runs_v2_check;
alter table public.ai_engine_runs add constraint ai_engine_runs_v2_check check (
  run_kind in ('trace', 'workflow', 'workflow_test', 'thumbnail')
  and (idempotency_key is null or char_length(idempotency_key) between 8 and 200)
  and jsonb_typeof(input) = 'object'
  and jsonb_typeof(outputs) = 'array'
  and jsonb_typeof(progress) = 'object'
  and (expected_outputs is null or expected_outputs between 1 and 50)
  and (lease_owner is null or char_length(lease_owner) <= 80)
  and invocations >= 0 and cost_unknown >= 0
  and (api_cost_usd_micros is null or api_cost_usd_micros >= 0)
);
create index if not exists ai_engine_runs_thumbnail_user_idx
  on public.ai_engine_runs (user_id, created_at desc) where run_kind = 'thumbnail';

/*
  CREATE a Miniaturka run. Server token AND the customer's own session: the
  run belongs to auth.uid() in a workspace they are a member of — never to an
  id the request names. Idempotent on its key (one click submitted twice is
  one run). At most two open runs per member: a third is refused, so a
  hammered button cannot queue paid work.
*/
create or replace function public.thumbnail_run_create(p_token text, p_run jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_ws uuid := nullif(p_run->>'workspace_id', '')::uuid;
  v_key text := nullif(p_run->>'idempotency_key', '');
  v_existing public.ai_engine_runs;
  v_open integer;
  v_id uuid;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if v_uid is null then return jsonb_build_object('error', 'unauthenticated'); end if;
  if v_ws is null or not public.is_workspace_member(v_ws) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if v_key is null or char_length(v_key) not between 8 and 200 then
    return jsonb_build_object('error', 'invalid_input');
  end if;
  if jsonb_typeof(p_run->'input') is distinct from 'object' then
    return jsonb_build_object('error', 'invalid_input');
  end if;
  select * into v_existing from public.ai_engine_runs where idempotency_key = v_key;
  if found then
    if v_existing.user_id is distinct from v_uid or v_existing.run_kind <> 'thumbnail' then
      return jsonb_build_object('error', 'forbidden');
    end if;
    return jsonb_build_object('id', v_existing.id, 'created', false, 'status', v_existing.status);
  end if;
  -- Open = queued/running and touched in the last 45 minutes. An abandoned
  -- run (tab closed for good) stops counting instead of locking the tool.
  select count(*) into v_open from public.ai_engine_runs
   where run_kind = 'thumbnail' and user_id = v_uid
     and status in ('queued', 'running') and updated_at > now() - interval '45 minutes';
  if v_open >= 2 then return jsonb_build_object('error', 'too_many_runs'); end if;
  insert into public.ai_engine_runs (
    tool_key, workspace_id, user_id, mode, status, run_kind, idempotency_key,
    engine_version, prompt_version, input, expected_outputs, credits, progress
  ) values (
    'ecommerce_thumbnail', v_ws, v_uid, 'grovbase', 'queued', 'thumbnail', v_key,
    left(nullif(p_run->>'engine_version', ''), 40),
    nullif(p_run->>'prompt_version', '')::integer,
    p_run->'input', 1,
    nullif(p_run->>'credits', '')::integer,
    jsonb_build_object('stage', 'prepare')
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
revoke all on function public.thumbnail_run_create(text, jsonb) from public, anon;
grant execute on function public.thumbnail_run_create(text, jsonb) to authenticated;

/*
  THE CUSTOMER'S VIEW of their own run: status, stage, the photos and the
  Retusz choice they started with, the quote, each step's state and the
  storage paths of what it produced in THEIR workspace. Never the model, the
  prompt, a provider usage figure or a cost.
*/
create or replace function public.thumbnail_run_status(p_run_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', r.id, 'status', r.status, 'error', r.error, 'progress', r.progress,
    'outputs', r.outputs, 'credits', r.credits, 'job_id', r.job_id,
    'created_at', r.created_at, 'finished_at', r.finished_at,
    'driving', coalesce(r.locked_until > now(), false),
    'photos', coalesce(r.input->'photos', '[]'::jsonb),
    'retouch', coalesce((r.input->>'retouch')::boolean, false),
    'quote', coalesce(r.input->'quote', '{}'::jsonb),
    'steps', coalesce((
      select jsonb_agg(jsonb_build_object(
        'position', s."position", 'item', s.item_index, 'status', s.status,
        'error', s.error_code,
        'path', case when s."position" in (1, 3) then s.output->>'path' end,
        'job_id', case when s."position" in (1, 3) then s.output->>'job_id' end,
        'width', case when s."position" = 3 then s.output->'width' end,
        'height', case when s."position" = 3 then s.output->'height' end
      ) order by s."position", s.item_index)
      from public.ai_engine_step_runs s where s.run_id = r.id), '[]'::jsonb))
    from public.ai_engine_runs r
   where r.id = p_run_id
     and r.run_kind = 'thumbnail'
     and r.user_id = auth.uid()
     and public.is_workspace_member(r.workspace_id);
$$;
revoke all on function public.thumbnail_run_status(uuid) from public, anon;
grant execute on function public.thumbnail_run_status(uuid) to authenticated;

/* The customer's recent runs in one workspace, newest first — what the panel
   reopens after a refresh. Ids and states only. */
create or replace function public.thumbnail_runs_recent(p_workspace_id uuid, p_limit integer)
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) from (
    select jsonb_build_object('id', r.id, 'status', r.status, 'error', r.error,
      'created_at', r.created_at, 'finished_at', r.finished_at) as x
      from public.ai_engine_runs r
     where r.run_kind = 'thumbnail'
       and r.user_id = auth.uid()
       and r.workspace_id = p_workspace_id
       and public.is_workspace_member(p_workspace_id)
     order by r.created_at desc
     limit least(greatest(coalesce(p_limit, 5), 1), 20)
  ) q;
$$;
revoke all on function public.thumbnail_runs_recent(uuid, integer) from public, anon;
grant execute on function public.thumbnail_runs_recent(uuid, integer) to authenticated;

/*
  CANCEL — the customer's own open run. Nobody driving it (no live lease):
  it closes at once; nothing of it is in flight, so nothing is charged.
  Being driven: the request is recorded (`error = 'cancel_requested'`) and the
  driver stops at its next step boundary — a step already in flight finishes
  and is billed (its result is kept in the library). Never touches a charge.
*/
create or replace function public.thumbnail_run_cancel(p_run_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row public.ai_engine_runs;
begin
  select * into v_row from public.ai_engine_runs
   where id = p_run_id and run_kind = 'thumbnail' and user_id = auth.uid()
   for update;
  if not found or not public.is_workspace_member(v_row.workspace_id) then
    return jsonb_build_object('state', 'not_found');
  end if;
  if v_row.status not in ('queued', 'running') then
    return jsonb_build_object('state', 'finished', 'status', v_row.status);
  end if;
  if v_row.locked_until is null or v_row.locked_until < now() then
    update public.ai_engine_runs
       set status = 'failed', error = 'cancelled', locked_until = null,
           finished_at = now(), updated_at = now()
     where id = p_run_id;
    return jsonb_build_object('state', 'cancelled');
  end if;
  update public.ai_engine_runs set error = 'cancel_requested', updated_at = now() where id = p_run_id;
  return jsonb_build_object('state', 'requested');
end $$;
revoke all on function public.thumbnail_run_cancel(uuid) from public, anon;
grant execute on function public.thumbnail_run_cancel(uuid) to authenticated;
