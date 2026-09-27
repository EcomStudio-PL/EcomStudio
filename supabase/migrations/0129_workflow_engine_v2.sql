-- AI TOOLS · API · WORKFLOW ENGINE v2 — the 0126 workflow system, extended in
-- place. No second workflow table, no second run table, no second ledger:
--
--   1. ai_tools                 + workflow_enabled — Workflow ON/OFF is its own
--                                 switch; the prompt mode (GrovBase / klient /
--                                 hybryda) stays what it was when the switch is
--                                 turned off again
--   2. ai_tool_workflow_steps   + typed steps (AI text, image edit, image
--      ai_tool_workflows          generation, an existing GrovBase tool),
--                                 NAMED outputs, explicit image input, FOR EACH
--                                 fan-out, per-step fallback model, retry and
--                                 error policy; no 8-step ceiling
--   3. ai_engine_runs           becomes the persistent workflow run (queued →
--                                 running → ok/partial/failed) with a lease, the
--                                 one usage event it charged and its outputs
--      ai_engine_step_runs      (new) one row per step and per fan-out item:
--                                 the idempotency key of every provider call,
--                                 the executor that REALLY served it, tokens,
--                                 cost and basis
--   4. usage_events             immutable once closed; the admin UPDATE policy
--                                 and the client table grants are removed; a
--                                 completion can record the provider/model that
--                                 actually served (fallback attribution)
--   5. pricing                  cached-input token price + per-unit prices
--                                 (image/second/request/page × resolution ×
--                                 quality) — absent price = unknown, never 0
--   6. generation_feedback      pinned to the engine run / workflow version /
--                                 prompt version / model / provider / tool
--
-- ZERO BEHAVIOUR CHANGE ON DEPLOY. workflow_enabled defaults to false and no
-- tool on this database runs a workflow today (a tool that did — the legacy
-- 'workflow' engine mode — is carried over to the switch). Existing columns
-- keep their meaning; every new column is nullable or defaulted.

/* ── 1. ai_tools: the Workflow switch ─────────────────────────────────────*/

alter table public.ai_tools add column if not exists workflow_enabled boolean not null default false;

-- The legacy mode becomes the switch; the prompt mode underneath falls back to
-- the GrovBase prompt (the only mode those tools offered besides 'workflow').
update public.ai_tools
   set workflow_enabled = true, engine_mode = 'grovbase'
 where engine_mode = 'workflow';

-- The runtime read gains the switch. Same gate and body otherwise; the return
-- type changes, so the function is re-created (and its grants re-stated).
drop function if exists public.ai_tool_runtime(text, text);
create function public.ai_tool_runtime(p_tool_key text, p_token text)
returns table (
  tool_key text,
  engine_mode text,
  service_slug text,
  allow_model_choice boolean,
  fallback_enabled boolean,
  timeout_ms integer,
  max_attempts smallint,
  primary_model_id uuid,
  fallback_model_id uuid,
  prompt_encrypted text,
  prompt_iv text,
  prompt_tag text,
  prompt_version integer,
  knowledge_strategy text,
  workflow_enabled boolean
)
language plpgsql stable security definer set search_path = public, extensions
as $$
declare
  v_hash text;
begin
  select value->>'dispatch_hash' into v_hash
    from public.app_settings where key = 'notifications';
  if v_hash is null or v_hash = '' then return; end if;
  if encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') is distinct from v_hash then
    return;
  end if;

  return query
  select
    t.tool_key, t.engine_mode, t.service_slug, t.allow_model_choice,
    t.fallback_enabled, t.timeout_ms, t.max_attempts,
    (select m.model_id from public.ai_tool_models m
      where m.tool_key = t.tool_key and m.role = 'primary'),
    (select m.model_id from public.ai_tool_models m
      where m.tool_key = t.tool_key and m.role = 'fallback'),
    p.body_encrypted, p.body_iv, p.body_tag, p.version,
    t.knowledge_strategy,
    t.workflow_enabled
  from public.ai_tools t
  left join public.ai_tool_prompts p
    on p.tool_key = t.tool_key and p.status = 'published'
  where t.tool_key = p_tool_key;
end;
$$;
revoke execute on function public.ai_tool_runtime(text, text) from anon, public;
grant execute on function public.ai_tool_runtime(text, text) to authenticated;

/* ── 2. workflow definition v2 ────────────────────────────────────────────*/

alter table public.ai_tool_workflows
  -- How many final results one run delivers at most — fixed at save time from
  -- the step list (fan-out cap × images per item). The customer is quoted and
  -- charged for this many; undelivered ones are refunded when the run closes.
  add column if not exists max_outputs integer,
  -- Parallel fan-out items per run (never more than the provider limiter
  -- allows; the limiter still applies inside).
  add column if not exists concurrency smallint not null default 3;
alter table public.ai_tool_workflows drop constraint if exists ai_tool_workflows_max_outputs_check;
alter table public.ai_tool_workflows add constraint ai_tool_workflows_max_outputs_check
  check (max_outputs is null or max_outputs between 1 and 50);
alter table public.ai_tool_workflows drop constraint if exists ai_tool_workflows_concurrency_check;
alter table public.ai_tool_workflows add constraint ai_tool_workflows_concurrency_check
  check (concurrency between 1 and 10);

-- Position: the 1..8 ceiling was a product limit, not a technical one. 50 is a
-- safety bound on one definition, far above any real flow.
alter table public.ai_tool_workflow_steps drop constraint if exists ai_tool_workflow_steps_position_check;
alter table public.ai_tool_workflow_steps add constraint ai_tool_workflow_steps_position_check
  check (position between 1 and 50);

alter table public.ai_tool_workflow_steps drop constraint if exists ai_tool_workflow_steps_operation_check;
alter table public.ai_tool_workflow_steps add constraint ai_tool_workflow_steps_operation_check
  check (operation in (
    -- v1 names, still readable (a v1 row runs exactly as it did):
    'analyze', 'generate_image',
    -- v2:
    'ai_text', 'image_edit', 'image_generation', 'tool'
  ));

alter table public.ai_tool_workflow_steps drop constraint if exists ai_tool_workflow_steps_output_kind_check;
alter table public.ai_tool_workflow_steps add constraint ai_tool_workflow_steps_output_kind_check
  check (output_kind in ('text', 'analysis', 'list', 'json', 'image'));

alter table public.ai_tool_workflow_steps
  -- The name later steps use: {{scene_prompts}}, {{clean_image}}. Unique per
  -- version; NULL only on v1 rows (which address outputs as {{stepN}}).
  add column if not exists output_name text,
  -- Which images the step works on: the customer's photos, an earlier image
  -- output by name, or none.
  add column if not exists input_image text,
  -- FOR EACH: the name of an earlier LIST output. The step runs once per item
  -- (in parallel), with the item bound to `item_name`.
  add column if not exists for_each text,
  add column if not exists item_name text,
  -- A list output: how many items the step must return. A fan-out step: the
  -- most items it will run (the list is cut, never padded).
  add column if not exists max_items smallint,
  -- Text model inside the chosen text provider (null = the provider default).
  add column if not exists text_model text,
  -- Image steps: a second model tried when the first fails for a provider-side
  -- reason. The step run records which one REALLY answered.
  add column if not exists fallback_model_id uuid references public.ai_models(id) on delete set null,
  -- 'tool' steps: which existing GrovBase tool runs as the step.
  add column if not exists tool_slug text,
  -- A failed step: stop the run (default) or continue without its output.
  add column if not exists on_error text not null default 'stop',
  -- A failed fan-out item: continue with the others (partial result) or fail
  -- the whole run.
  add column if not exists on_item_error text not null default 'continue';

alter table public.ai_tool_workflow_steps drop constraint if exists ai_tool_workflow_steps_v2_check;
alter table public.ai_tool_workflow_steps add constraint ai_tool_workflow_steps_v2_check check (
  (output_name is null or output_name ~ '^[a-z][a-z0-9_]{0,39}$')
  and (input_image is null or input_image ~ '^(customer|none|[a-z][a-z0-9_]{0,39})$')
  and (for_each is null or for_each ~ '^[a-z][a-z0-9_]{0,39}$')
  and (item_name is null or item_name ~ '^[a-z][a-z0-9_]{0,39}$')
  and (max_items is null or max_items between 1 and 50)
  and (text_model is null or text_model ~ '^[a-z0-9][a-z0-9.\-]{0,79}$')
  and (tool_slug is null or tool_slug ~ '^[a-z_]{2,40}$')
  and on_error in ('stop', 'continue')
  and on_item_error in ('continue', 'fail_run')
  and ((for_each is null) = (item_name is null))
);

-- One shape rule per operation. v1 rows keep satisfying it unchanged.
alter table public.ai_tool_workflow_steps drop constraint if exists ai_tool_workflow_steps_check;
alter table public.ai_tool_workflow_steps drop constraint if exists ai_tool_workflow_steps_shape_check;
alter table public.ai_tool_workflow_steps add constraint ai_tool_workflow_steps_shape_check check (
  (operation in ('generate_image', 'image_generation', 'image_edit')
     and output_kind = 'image' and text_provider is null and tool_slug is null)
  or (operation in ('analyze', 'ai_text')
     and output_kind in ('text', 'analysis', 'list', 'json') and model_id is null
     and fallback_model_id is null and tool_slug is null)
  or (operation = 'tool'
     and output_kind = 'image' and model_id is null and fallback_model_id is null
     and text_provider is null and tool_slug is not null)
);

-- A step may wait for a slow provider: the ceiling is a sanity bound, not a
-- quality cap. 15 min; the default is the whole invocation budget.
alter table public.ai_tool_workflow_steps drop constraint if exists ai_tool_workflow_steps_timeout_ms_check;
alter table public.ai_tool_workflow_steps add constraint ai_tool_workflow_steps_timeout_ms_check
  check (timeout_ms between 5000 and 900000);
alter table public.ai_tool_workflow_steps alter column timeout_ms set default 280000;
alter table public.ai_tool_workflow_steps drop constraint if exists ai_tool_workflow_steps_max_attempts_check;
alter table public.ai_tool_workflow_steps add constraint ai_tool_workflow_steps_max_attempts_check
  check (max_attempts between 1 and 5);

create unique index if not exists ai_tool_workflow_steps_output_name_uq
  on public.ai_tool_workflow_steps (workflow_id, output_name) where output_name is not null;

/*
  SAVE v2. Validates the shape the database can see — the full data-flow check
  (names referenced before they exist, a list feeding FOR EACH, an image feeding
  an image step, the last enabled step producing images) runs in the
  application AND here, so a hand-made RPC call cannot store a workflow that
  would reference an output it never gets.
*/
-- One more (defaulted) argument, so the old signature is dropped first: two
-- overloads that both accept five arguments would make every call ambiguous.
-- The previous build calls it with five named arguments and keeps working.
drop function if exists public.ai_save_tool_workflow(text, jsonb, text, text, boolean);
create or replace function public.ai_save_tool_workflow(
  p_tool_key text,
  p_steps jsonb,
  p_summary text default null,
  p_reason text default null,
  p_publish boolean default false,
  p_concurrency integer default 3
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_version integer;
  v_id uuid;
  v_n integer;
  v_step jsonb;
  v_pos integer;
  v_op text;
  v_out text;
  v_kind text;
  v_names text[] := '{}';
  v_lists text[] := '{}';
  v_images text[] := '{}';
  v_last_image integer := 0;
  v_last_enabled integer := 0;
  v_max_outputs integer := null;
  v_ref text;
  v_item text;
  v_concurrency integer := least(10, greatest(1, coalesce(p_concurrency, 3)));
begin
  if not public.is_admin(v_actor) then
    raise exception 'not_authorized';
  end if;
  if p_tool_key is null or not exists (select 1 from public.ai_tools t where t.tool_key = p_tool_key) then
    return jsonb_build_object('ok', false, 'error', 'unknown_tool');
  end if;
  if jsonb_typeof(p_steps) is distinct from 'array' then
    return jsonb_build_object('ok', false, 'error', 'invalid_steps');
  end if;
  v_n := jsonb_array_length(p_steps);
  if v_n < 1 or v_n > 50 then
    return jsonb_build_object('ok', false, 'error', 'invalid_steps');
  end if;

  for v_pos in 1..v_n loop
    v_step := p_steps -> (v_pos - 1);
    v_op := v_step->>'operation';
    v_out := nullif(v_step->>'output_name', '');
    v_kind := v_step->>'output_kind';
    if v_op is null or v_op not in ('analyze', 'generate_image', 'ai_text', 'image_edit', 'image_generation', 'tool') then
      return jsonb_build_object('ok', false, 'error', 'invalid_steps', 'step', v_pos);
    end if;
    -- A 'tool' step runs an existing tool with its own instruction; every
    -- other step needs one.
    if v_op <> 'tool' and coalesce(btrim(v_step->>'prompt_encrypted'), '') = '' then
      return jsonb_build_object('ok', false, 'error', 'empty_prompt', 'step', v_pos);
    end if;
    -- v2 steps are addressed by name.
    if v_op in ('ai_text', 'image_edit', 'image_generation', 'tool') then
      if v_out is null or v_out !~ '^[a-z][a-z0-9_]{0,39}$' then
        return jsonb_build_object('ok', false, 'error', 'output_name', 'step', v_pos);
      end if;
      if v_out = any(v_names) then
        return jsonb_build_object('ok', false, 'error', 'output_duplicate', 'step', v_pos);
      end if;
      -- References: only names produced by EARLIER steps. No forward edge
      -- means no cycle and no recursion inside a definition.
      v_item := nullif(v_step->>'item_name', '');
      v_ref := nullif(v_step->>'for_each', '');
      if v_ref is not null and not (v_ref = any(v_lists)) then
        return jsonb_build_object('ok', false, 'error', 'for_each_unknown', 'step', v_pos, 'name', v_ref);
      end if;
      if v_item is not null and (v_item = any(v_names) or v_item = v_out) then
        return jsonb_build_object('ok', false, 'error', 'output_duplicate', 'step', v_pos);
      end if;
      v_ref := nullif(v_step->>'input_image', '');
      if v_ref is not null and v_ref not in ('customer', 'none')
         and not (v_ref = any(v_images)) and v_ref is distinct from v_item then
        return jsonb_build_object('ok', false, 'error', 'input_unknown', 'step', v_pos, 'name', v_ref);
      end if;
      v_names := v_names || v_out;
      -- Collections a later FOR EACH may iterate: a list a text step returns,
      -- and the per-item results of any FOR EACH step.
      if v_kind = 'list' or nullif(v_step->>'for_each', '') is not null then v_lists := v_lists || v_out; end if;
      if v_kind = 'image' then v_images := v_images || v_out; end if;
    end if;
    if coalesce((v_step->>'enabled')::boolean, true) then
      v_last_enabled := v_pos;
      if v_kind = 'image' then v_last_image := v_pos; end if;
    end if;
  end loop;

  -- The run's result is the LAST enabled step, and it must be images.
  if v_last_enabled = 0 or v_last_image <> v_last_enabled then
    return jsonb_build_object('ok', false, 'error', 'image_step_last');
  end if;
  v_step := p_steps -> (v_last_image - 1);
  if nullif(v_step->>'for_each', '') is not null then
    v_max_outputs := least(50, greatest(1, coalesce((v_step->>'max_items')::integer, 1)));
  else
    v_max_outputs := 1;
  end if;

  if p_publish and coalesce(btrim(p_reason), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'reason_required');
  end if;

  perform 1 from public.ai_tools where tool_key = p_tool_key for update;
  select coalesce(max(version), 0) + 1 into v_version
    from public.ai_tool_workflows where tool_key = p_tool_key;

  if p_publish then
    update public.ai_tool_workflows set status = 'superseded'
     where tool_key = p_tool_key and status = 'published';
  end if;

  insert into public.ai_tool_workflows (tool_key, version, status, summary, reason, created_by, published_at, max_outputs, concurrency)
  values (
    p_tool_key, v_version,
    case when p_publish then 'published' else 'draft' end,
    nullif(btrim(coalesce(p_summary, '')), ''),
    nullif(btrim(coalesce(p_reason, '')), ''),
    v_actor,
    case when p_publish then now() else null end,
    v_max_outputs, v_concurrency
  ) returning id into v_id;

  insert into public.ai_tool_workflow_steps (
    workflow_id, position, name, enabled, operation, output_kind, use_images,
    model_id, text_provider, timeout_ms, max_attempts, condition,
    prompt_encrypted, prompt_iv, prompt_tag,
    output_name, input_image, for_each, item_name, max_items, text_model,
    fallback_model_id, tool_slug, on_error, on_item_error
  )
  select v_id, s.ord::smallint,
         left(btrim(coalesce(s.v->>'name', '')), 80),
         coalesce((s.v->>'enabled')::boolean, true),
         s.v->>'operation',
         s.v->>'output_kind',
         coalesce((s.v->>'use_images')::boolean, true),
         nullif(s.v->>'model_id', '')::uuid,
         nullif(s.v->>'text_provider', ''),
         coalesce((s.v->>'timeout_ms')::integer, 280000),
         coalesce((s.v->>'max_attempts')::smallint, 1),
         coalesce(nullif(s.v->>'condition', ''), 'always'),
         s.v->>'prompt_encrypted', s.v->>'prompt_iv', s.v->>'prompt_tag',
         nullif(s.v->>'output_name', ''),
         nullif(s.v->>'input_image', ''),
         nullif(s.v->>'for_each', ''),
         nullif(s.v->>'item_name', ''),
         nullif(s.v->>'max_items', '')::smallint,
         nullif(s.v->>'text_model', ''),
         nullif(s.v->>'fallback_model_id', '')::uuid,
         nullif(s.v->>'tool_slug', ''),
         coalesce(nullif(s.v->>'on_error', ''), 'stop'),
         coalesce(nullif(s.v->>'on_item_error', ''), 'continue')
    from jsonb_array_elements(p_steps) with ordinality as s(v, ord);

  return jsonb_build_object('ok', true, 'id', v_id, 'version', v_version, 'max_outputs', v_max_outputs);
end;
$$;
revoke execute on function public.ai_save_tool_workflow(text, jsonb, text, text, boolean, integer) from anon, public;
grant execute on function public.ai_save_tool_workflow(text, jsonb, text, text, boolean, integer) to authenticated;

-- Rollback copies every v2 column forward too.
create or replace function public.ai_restore_tool_workflow(p_id uuid, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_src public.ai_tool_workflows;
  v_version integer;
  v_id uuid;
begin
  if not public.is_admin(v_actor) then
    raise exception 'not_authorized';
  end if;
  select * into v_src from public.ai_tool_workflows where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;

  perform 1 from public.ai_tool_workflows where tool_key = v_src.tool_key for update;
  select coalesce(max(version), 0) + 1 into v_version
    from public.ai_tool_workflows where tool_key = v_src.tool_key;
  update public.ai_tool_workflows set status = 'superseded'
   where tool_key = v_src.tool_key and status = 'published';
  insert into public.ai_tool_workflows (tool_key, version, status, summary, reason, created_by, published_at, max_outputs, concurrency)
  values (v_src.tool_key, v_version, 'published', v_src.summary,
          coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'restore v' || v_src.version),
          v_actor, now(), v_src.max_outputs, v_src.concurrency)
  returning id into v_id;
  insert into public.ai_tool_workflow_steps (
    workflow_id, position, name, enabled, operation, output_kind, use_images,
    model_id, text_provider, timeout_ms, max_attempts, condition,
    prompt_encrypted, prompt_iv, prompt_tag,
    output_name, input_image, for_each, item_name, max_items, text_model,
    fallback_model_id, tool_slug, on_error, on_item_error
  )
  select v_id, position, name, enabled, operation, output_kind, use_images,
         model_id, text_provider, timeout_ms, max_attempts, condition,
         prompt_encrypted, prompt_iv, prompt_tag,
         output_name, input_image, for_each, item_name, max_items, text_model,
         fallback_model_id, tool_slug, on_error, on_item_error
    from public.ai_tool_workflow_steps where workflow_id = v_src.id;
  return jsonb_build_object('ok', true, 'id', v_id, 'version', v_version,
                            'from_version', v_src.version, 'tool_key', v_src.tool_key);
end;
$$;
revoke execute on function public.ai_restore_tool_workflow(uuid, text) from anon, public;
grant execute on function public.ai_restore_tool_workflow(uuid, text) to authenticated;

/*
  THE RUNTIME READ, BY VERSION. A run is pinned to the version it started on:
  a publish in the middle of a run (or between two invocations of a resumed
  run) changes nothing for it. `p_workflow_id` null = the tool's published
  version. Token-gated like every runtime read.
*/
create or replace function public.ai_tool_workflow_read(p_token text, p_tool_key text, p_workflow_id uuid default null)
returns table (
  workflow_id uuid,
  version integer,
  status text,
  max_outputs integer,
  concurrency smallint,
  "position" smallint,
  name text,
  enabled boolean,
  operation text,
  output_kind text,
  use_images boolean,
  model_id uuid,
  fallback_model_id uuid,
  text_provider text,
  text_model text,
  timeout_ms integer,
  max_attempts smallint,
  condition text,
  output_name text,
  input_image text,
  for_each text,
  item_name text,
  max_items smallint,
  tool_slug text,
  on_error text,
  on_item_error text,
  prompt_encrypted text,
  prompt_iv text,
  prompt_tag text
)
language plpgsql stable security definer set search_path = public, extensions
as $$
begin
  if not public.server_call_ok(p_token) then return; end if;
  return query
  select w.id, w.version, w.status, w.max_outputs, w.concurrency,
         s.position, s.name, s.enabled, s.operation, s.output_kind, s.use_images,
         s.model_id, s.fallback_model_id, s.text_provider, s.text_model,
         s.timeout_ms, s.max_attempts, s.condition,
         s.output_name, s.input_image, s.for_each, s.item_name, s.max_items,
         s.tool_slug, s.on_error, s.on_item_error,
         s.prompt_encrypted, s.prompt_iv, s.prompt_tag
    from public.ai_tool_workflows w
    join public.ai_tool_workflow_steps s on s.workflow_id = w.id
   where w.tool_key = p_tool_key
     and ((p_workflow_id is null and w.status = 'published') or w.id = p_workflow_id)
   order by s.position;
end;
$$;
revoke all on function public.ai_tool_workflow_read(text, text, uuid) from public, anon;
grant execute on function public.ai_tool_workflow_read(text, text, uuid) to authenticated;

/* ── 3. runs ──────────────────────────────────────────────────────────────*/

alter table public.ai_engine_runs drop constraint if exists ai_engine_runs_status_check;
alter table public.ai_engine_runs add constraint ai_engine_runs_status_check
  check (status in ('queued', 'running', 'ok', 'partial', 'failed', 'blocked'));

alter table public.ai_engine_runs
  -- 'trace' = the one-shot record every engine run writes (unchanged);
  -- 'workflow' = a persistent customer run; 'workflow_test' = an admin test.
  add column if not exists run_kind text not null default 'trace',
  add column if not exists idempotency_key text,
  add column if not exists usage_event_id uuid references public.usage_events(id) on delete set null,
  -- The customer's inputs a resumed run needs (storage paths, the hint, size,
  -- framing, the unit price it was quoted). Never a prompt.
  add column if not exists input jsonb not null default '{}'::jsonb,
  -- Final results: [{path, step, item}] in the workspace's own storage area.
  add column if not exists outputs jsonb not null default '[]'::jsonb,
  add column if not exists progress jsonb not null default '{}'::jsonb,
  add column if not exists expected_outputs integer,
  add column if not exists locked_until timestamptz,
  add column if not exists lease_owner text,
  add column if not exists invocations integer not null default 0,
  add column if not exists cost_unknown integer not null default 0,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists finished_at timestamptz;

alter table public.ai_engine_runs drop constraint if exists ai_engine_runs_v2_check;
alter table public.ai_engine_runs add constraint ai_engine_runs_v2_check check (
  run_kind in ('trace', 'workflow', 'workflow_test')
  and (idempotency_key is null or char_length(idempotency_key) between 8 and 200)
  and jsonb_typeof(input) = 'object'
  and jsonb_typeof(outputs) = 'array'
  and jsonb_typeof(progress) = 'object'
  and (expected_outputs is null or expected_outputs between 1 and 50)
  and (lease_owner is null or char_length(lease_owner) <= 80)
  and invocations >= 0 and cost_unknown >= 0
  and (api_cost_usd_micros is null or api_cost_usd_micros >= 0)
);
create unique index if not exists ai_engine_runs_idem_uq
  on public.ai_engine_runs (idempotency_key) where idempotency_key is not null;
create index if not exists ai_engine_runs_user_idx
  on public.ai_engine_runs (user_id, created_at desc) where run_kind = 'workflow';
create index if not exists ai_engine_runs_open_idx
  on public.ai_engine_runs (status, updated_at) where status in ('queued', 'running');

create table if not exists public.ai_engine_step_runs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_engine_runs(id) on delete cascade,
  "position" smallint not null check ("position" between 1 and 50),
  -- -1 = the step itself; 0..49 = one fan-out item.
  item_index smallint not null default -1 check (item_index between -1 and 49),
  step_name text check (step_name is null or char_length(step_name) <= 80),
  operation text not null check (operation in ('analyze', 'generate_image', 'ai_text', 'image_edit', 'image_generation', 'tool')),
  status text not null default 'pending' check (status in ('pending', 'running', 'succeeded', 'failed', 'skipped')),
  attempts smallint not null default 0 check (attempts between 0 and 20),
  -- WHO REALLY ANSWERED — the executor after any fallback. NULL = unknown.
  provider_slug text check (provider_slug is null or provider_slug ~ '^[a-z0-9_\-]{2,40}$'),
  model text check (model is null or char_length(model) <= 120),
  input_tokens bigint check (input_tokens is null or input_tokens >= 0),
  output_tokens bigint check (output_tokens is null or output_tokens >= 0),
  units numeric(14, 3) check (units is null or units >= 0),
  unit_kind text check (unit_kind is null or unit_kind in ('image', 'second', 'request', 'page')),
  cost_usd_micros bigint check (cost_usd_micros is null or cost_usd_micros >= 0),
  cost_basis text not null default 'unknown' check (cost_basis in ('actual', 'estimated', 'unknown')),
  error_code text check (error_code is null or error_code ~ '^[a-z0-9_:.\-]{1,80}$'),
  -- The step's result for later steps: text / list / json values, or image
  -- storage paths. ADMIN-READ ONLY (it can carry GrovBase-authored text).
  output jsonb,
  locked_until timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  created_at timestamptz not null default now(),
  unique (run_id, "position", item_index),
  constraint ai_engine_step_runs_cost_known check ((cost_basis = 'unknown') = (cost_usd_micros is null))
);
create index if not exists ai_engine_step_runs_run_idx on public.ai_engine_step_runs (run_id, "position", item_index);

alter table public.ai_engine_step_runs enable row level security;
drop policy if exists ai_engine_step_runs_admin_read on public.ai_engine_step_runs;
create policy ai_engine_step_runs_admin_read on public.ai_engine_step_runs for select to authenticated
  using ((select public.is_admin(auth.uid())));
revoke all on public.ai_engine_step_runs from anon, authenticated;
grant select on public.ai_engine_step_runs to authenticated;

-- ai_engine_runs stays admin-read; its client grants are narrowed the same way.
revoke insert, update, delete, truncate on public.ai_engine_runs from anon, authenticated;

/*
  CREATE a persistent run — idempotent on its key: the same click, submitted
  twice, gets the same run back instead of a second one.
*/
create or replace function public.ai_engine_run_create(p_token text, p_run jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_existing public.ai_engine_runs;
  v_key text := nullif(p_run->>'idempotency_key', '');
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if v_key is not null then
    select * into v_existing from public.ai_engine_runs where idempotency_key = v_key;
    if found then
      return jsonb_build_object('id', v_existing.id, 'created', false, 'status', v_existing.status);
    end if;
  end if;
  insert into public.ai_engine_runs (
    tool_key, workspace_id, user_id, job_id, mode, status, run_kind, idempotency_key,
    usage_event_id, engine_version, prompt_version, workflow_id, workflow_version,
    input, expected_outputs, credits, progress
  ) values (
    left(p_run->>'tool_key', 60),
    nullif(p_run->>'workspace_id', '')::uuid,
    nullif(p_run->>'user_id', '')::uuid,
    nullif(p_run->>'job_id', '')::uuid,
    'workflow',
    'queued',
    case when p_run->>'run_kind' = 'workflow_test' then 'workflow_test' else 'workflow' end,
    v_key,
    nullif(p_run->>'usage_event_id', '')::uuid,
    left(nullif(p_run->>'engine_version', ''), 40),
    nullif(p_run->>'prompt_version', '')::integer,
    nullif(p_run->>'workflow_id', '')::uuid,
    nullif(p_run->>'workflow_version', '')::integer,
    case when jsonb_typeof(p_run->'input') = 'object' then p_run->'input' else '{}'::jsonb end,
    nullif(p_run->>'expected_outputs', '')::integer,
    nullif(p_run->>'credits', '')::integer,
    jsonb_build_object('done', 0, 'total', coalesce(nullif(p_run->>'expected_outputs', '')::integer, 1), 'failed', 0)
  )
  on conflict (idempotency_key) where idempotency_key is not null do nothing
  returning id into v_id;
  if v_id is null then
    select * into v_existing from public.ai_engine_runs where idempotency_key = v_key;
    return jsonb_build_object('id', v_existing.id, 'created', false, 'status', v_existing.status);
  end if;
  return jsonb_build_object('id', v_id, 'created', true, 'status', 'queued');
end $$;
revoke all on function public.ai_engine_run_create(text, jsonb) from public, anon;
grant execute on function public.ai_engine_run_create(text, jsonb) to authenticated;

/*
  CLAIM the run for one invocation. Two pollers (two tabs, a double poll)
  cannot drive the same run at once: only the holder of an unexpired lease
  proceeds. A lease is short and renewed per step, so a killed invocation
  frees the run within seconds.
*/
create or replace function public.ai_engine_run_claim(p_token text, p_run_id uuid, p_owner text, p_lease_seconds integer)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row public.ai_engine_runs;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if p_owner is null or char_length(p_owner) not between 8 and 80 then raise exception 'invalid_owner'; end if;
  -- A CUSTOMER RUN WHOSE CHARGE IS NO LONGER OPEN NEVER RUNS AGAIN. The stale-
  -- charge reconciler (0102) refunds a pending event with nothing delivered;
  -- resuming that run afterwards would deliver images for free. It is closed
  -- here instead, and so is a run that has been resumed an unreasonable number
  -- of times (each invocation is paid provider work).
  update public.ai_engine_runs r
     set status = 'failed',
         error = case when r.invocations >= 30 then 'invocation_limit' else 'charge_closed' end,
         locked_until = null, finished_at = now(), updated_at = now()
   where r.id = p_run_id
     and r.status in ('queued', 'running')
     and (r.locked_until is null or r.locked_until < now() or r.lease_owner = p_owner)
     and (r.invocations >= 30
          or (r.run_kind = 'workflow' and r.usage_event_id is not null and exists (
                select 1 from public.usage_events e where e.id = r.usage_event_id and e.status <> 'pending')));
  update public.ai_engine_runs
     set locked_until = now() + make_interval(secs => least(greatest(coalesce(p_lease_seconds, 60), 10), 900)),
         lease_owner = p_owner,
         invocations = invocations + 1,
         status = case when status = 'queued' then 'running' else status end,
         updated_at = now()
   where id = p_run_id
     and status in ('queued', 'running')
     and (locked_until is null or locked_until < now() or lease_owner = p_owner)
  returning * into v_row;
  if not found then
    select * into v_row from public.ai_engine_runs where id = p_run_id;
    if not found then return jsonb_build_object('claimed', false, 'reason', 'not_found'); end if;
    return jsonb_build_object('claimed', false,
      'reason', case when v_row.status in ('queued', 'running') then 'busy' else 'finished' end,
      'status', v_row.status);
  end if;
  return jsonb_build_object('claimed', true, 'status', v_row.status, 'invocations', v_row.invocations);
end $$;
revoke all on function public.ai_engine_run_claim(text, uuid, text, integer) from public, anon;
grant execute on function public.ai_engine_run_claim(text, uuid, text, integer) to authenticated;

/*
  PATCH the run — only the lease holder, only forward. A finished run
  (ok / partial / failed / blocked) never changes again.
*/
create or replace function public.ai_engine_run_patch(p_token text, p_run_id uuid, p_owner text, p_patch jsonb)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_row public.ai_engine_runs;
  v_status text := nullif(p_patch->>'status', '');
  v_examples uuid[];
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  select * into v_row from public.ai_engine_runs where id = p_run_id for update;
  if not found then return false; end if;
  if v_row.status not in ('queued', 'running') then return false; end if;
  if v_row.lease_owner is distinct from p_owner then return false; end if;
  if v_status is not null and v_status not in ('running', 'ok', 'partial', 'failed', 'blocked') then
    raise exception 'invalid_status';
  end if;
  update public.ai_engine_runs set
    status = coalesce(v_status, status),
    error = case when p_patch ? 'error' then left(nullif(p_patch->>'error', ''), 80) else error end,
    job_id = coalesce(nullif(p_patch->>'job_id', '')::uuid, job_id),
    usage_event_id = coalesce(nullif(p_patch->>'usage_event_id', '')::uuid, usage_event_id),
    outputs = case when jsonb_typeof(p_patch->'outputs') = 'array' then p_patch->'outputs' else outputs end,
    progress = case when jsonb_typeof(p_patch->'progress') = 'object' then p_patch->'progress' else progress end,
    steps = case when jsonb_typeof(p_patch->'steps') = 'array' and jsonb_array_length(p_patch->'steps') <= 200
                 then p_patch->'steps' else steps end,
    credits = coalesce(nullif(p_patch->>'credits', '')::integer, credits),
    api_cost_usd_micros = case when p_patch ? 'api_cost_usd_micros'
                               then greatest(0, nullif(p_patch->>'api_cost_usd_micros', '')::bigint)
                               else api_cost_usd_micros end,
    cost_unknown = coalesce(greatest(0, nullif(p_patch->>'cost_unknown', '')::integer), cost_unknown),
    model_label = coalesce(left(nullif(p_patch->>'model_label', ''), 120), model_label),
    duration_ms = coalesce(nullif(p_patch->>'duration_ms', '')::integer, duration_ms),
    knowledge_example_ids = case when jsonb_typeof(p_patch->'knowledge_example_ids') = 'array'
      then (select coalesce(array_agg(distinct x::uuid), '{}') from jsonb_array_elements_text(p_patch->'knowledge_example_ids') x
             where x ~ '^[0-9a-fA-F-]{36}$')
      else knowledge_example_ids end,
    locked_until = case when coalesce(v_status, '') in ('ok', 'partial', 'failed', 'blocked') then null
                        when p_patch ? 'lease_seconds'
                          then now() + make_interval(secs => least(greatest((p_patch->>'lease_seconds')::integer, 10), 900))
                        else locked_until end,
    finished_at = case when coalesce(v_status, '') in ('ok', 'partial', 'failed', 'blocked') then now() else finished_at end,
    updated_at = now()
  where id = p_run_id;
  -- Knowledge usage is counted once, when a run produced something.
  if v_status in ('ok', 'partial') then
    select knowledge_example_ids into v_examples from public.ai_engine_runs where id = p_run_id;
    if coalesce(array_length(v_examples, 1), 0) > 0 then
      update public.knowledge_examples set usage_count = usage_count + 1 where id = any(v_examples);
    end if;
  end if;
  return true;
end $$;
revoke all on function public.ai_engine_run_patch(text, uuid, text, jsonb) from public, anon;
grant execute on function public.ai_engine_run_patch(text, uuid, text, jsonb) to authenticated;

/*
  BEGIN one step (or one fan-out item). Idempotent: a step that already
  succeeded is never executed again — its stored output is returned instead,
  so a resumed or retried run never pays a provider twice for the same work.
*/
create or replace function public.ai_engine_step_begin(
  p_token text, p_run_id uuid, p_owner text, p_position integer, p_item integer,
  p_name text, p_operation text, p_lease_seconds integer
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_run public.ai_engine_runs;
  v_step public.ai_engine_step_runs;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  select * into v_run from public.ai_engine_runs where id = p_run_id;
  if not found or v_run.status not in ('queued', 'running') or v_run.lease_owner is distinct from p_owner then
    return jsonb_build_object('state', 'not_owner');
  end if;
  insert into public.ai_engine_step_runs (run_id, "position", item_index, step_name, operation, status)
  values (p_run_id, p_position, coalesce(p_item, -1), left(p_name, 80), p_operation, 'pending')
  on conflict (run_id, "position", item_index) do nothing;
  select * into v_step from public.ai_engine_step_runs
   where run_id = p_run_id and "position" = p_position and item_index = coalesce(p_item, -1)
   for update;
  if v_step.status = 'succeeded' then
    return jsonb_build_object('state', 'done', 'output', v_step.output, 'provider', v_step.provider_slug, 'model', v_step.model);
  end if;
  if v_step.status in ('failed', 'skipped') then
    return jsonb_build_object('state', v_step.status, 'error', v_step.error_code);
  end if;
  if v_step.status = 'running' and v_step.locked_until is not null and v_step.locked_until > now() then
    return jsonb_build_object('state', 'busy');
  end if;
  -- Every begin is counted: a step that keeps being resumed (each time a paid
  -- call) is visible to the runtime, which fails it past its attempt budget.
  update public.ai_engine_step_runs
     set status = 'running',
         attempts = least(20, attempts + 1),
         started_at = coalesce(started_at, now()),
         locked_until = now() + make_interval(secs => least(greatest(coalesce(p_lease_seconds, 300), 10), 900))
   where id = v_step.id;
  return jsonb_build_object('state', 'run', 'attempts', v_step.attempts);
end $$;
revoke all on function public.ai_engine_step_begin(text, uuid, text, integer, integer, text, text, integer) from public, anon;
grant execute on function public.ai_engine_step_begin(text, uuid, text, integer, integer, text, text, integer) to authenticated;

create or replace function public.ai_engine_step_finish(
  p_token text, p_run_id uuid, p_owner text, p_position integer, p_item integer, p_result jsonb
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_run public.ai_engine_runs;
  v_status text := p_result->>'status';
  v_basis text := coalesce(p_result->>'cost_basis', 'unknown');
  v_cost bigint;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  select * into v_run from public.ai_engine_runs where id = p_run_id;
  if not found or v_run.lease_owner is distinct from p_owner then return false; end if;
  if v_status not in ('succeeded', 'failed', 'skipped') then raise exception 'invalid_status'; end if;
  -- greatest(0, NULL) is 0 in Postgres: the NULL test comes first, so a cost
  -- that was not sent stays unknown instead of becoming a confident zero.
  v_cost := case when v_basis = 'unknown' or nullif(p_result->>'cost_usd_micros', '') is null then null
                 else greatest(0, (p_result->>'cost_usd_micros')::bigint) end;
  if v_basis <> 'unknown' and v_cost is null then v_basis := 'unknown'; end if;
  update public.ai_engine_step_runs set
    status = v_status,
    attempts = least(20, greatest(attempts, coalesce(nullif(p_result->>'attempts', '')::integer, attempts))),
    provider_slug = nullif(lower(p_result->>'provider_slug'), ''),
    model = left(nullif(p_result->>'model', ''), 120),
    input_tokens = nullif(p_result->>'input_tokens', '')::bigint,
    output_tokens = nullif(p_result->>'output_tokens', '')::bigint,
    units = nullif(p_result->>'units', '')::numeric,
    unit_kind = nullif(p_result->>'unit_kind', ''),
    cost_usd_micros = v_cost,
    cost_basis = v_basis,
    error_code = case when v_status = 'failed'
                      then left(regexp_replace(lower(coalesce(p_result->>'error_code', 'error')), '[^a-z0-9_:.\-]', '_', 'g'), 80)
                      else null end,
    output = case when v_status = 'succeeded' then p_result->'output' else null end,
    duration_ms = nullif(p_result->>'duration_ms', '')::integer,
    finished_at = now(),
    locked_until = null
  where run_id = p_run_id and "position" = p_position and item_index = coalesce(p_item, -1)
    -- Never overwrite a success: a late duplicate finisher is a no-op.
    and status <> 'succeeded';
  return found;
end $$;
revoke all on function public.ai_engine_step_finish(text, uuid, text, integer, integer, jsonb) from public, anon;
grant execute on function public.ai_engine_step_finish(text, uuid, text, integer, integer, jsonb) to authenticated;

/*
  THE DRIVER'S READS. The run is driven inside the customer's own request (the
  ledger functions need that session), and runs / step runs are admin-read
  under RLS — so the server reads them through the token, never the customer.
*/
create or replace function public.ai_engine_run_read(p_token text, p_run_id uuid)
returns setof public.ai_engine_runs
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  return query select * from public.ai_engine_runs where id = p_run_id;
end $$;
revoke all on function public.ai_engine_run_read(text, uuid) from public, anon;
grant execute on function public.ai_engine_run_read(text, uuid) to authenticated;

create or replace function public.ai_engine_step_runs_read(p_token text, p_run_id uuid)
returns setof public.ai_engine_step_runs
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  return query select * from public.ai_engine_step_runs where run_id = p_run_id order by "position", item_index;
end $$;
revoke all on function public.ai_engine_step_runs_read(text, uuid) from public, anon;
grant execute on function public.ai_engine_step_runs_read(text, uuid) to authenticated;

/*
  THE CUSTOMER'S VIEW of their own run: status, progress, result paths and a
  safe error code. No step list, no model, no output text, no prompt.
*/
create or replace function public.ai_engine_run_status(p_run_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', r.id, 'status', r.status, 'progress', r.progress, 'outputs', r.outputs,
    'error', r.error, 'job_id', r.job_id, 'tool_key', r.tool_key, 'credits', r.credits,
    'created_at', r.created_at, 'finished_at', r.finished_at,
    -- Whether an invocation is driving it right now (a poll need not start one).
    'driving', coalesce(r.locked_until > now(), false))
    from public.ai_engine_runs r
   where r.id = p_run_id
     and r.run_kind = 'workflow'
     and r.user_id = auth.uid()
     and public.is_workspace_member(r.workspace_id);
$$;
revoke all on function public.ai_engine_run_status(uuid) from public, anon;
grant execute on function public.ai_engine_run_status(uuid) to authenticated;

/* ── 4. usage_events: the ledger is immutable once closed ─────────────────*/

-- An admin could rewrite any historical charge without a trace. Corrections
-- go through the ledger functions (refunds, credit adjustments), never an
-- UPDATE on a closed row.
drop policy if exists usage_events_admin_update on public.usage_events;
revoke insert, update, delete, truncate on public.usage_events from anon, authenticated;

create or replace function public.usage_events_guard()
returns trigger
language plpgsql set search_path = public as $$
begin
  -- A pending event is still being worked on (complete / fail / partial
  -- refund / reconcile); a failed one may still be refunded. A SUCCEEDED or
  -- REFUNDED event is history. Detaching it from a deleted user, workspace or
  -- job (the foreign keys' SET NULL) is allowed; changing what was charged,
  -- what it cost or what it was is not.
  if old.status in ('succeeded', 'refunded') and (
       (
         new.status, new.credits_charged, new.api_cost_usd_micros_snapshot, new.sale_value_cents_snapshot,
         new.actual_api_cost_usd_micros, new.result_count,
         new.service_slug, new.provider_slug, new.model_slug, new.metadata, new.error,
         new.started_at, new.finished_at, new.created_at, new.idempotency_key, new.provider_request_id
       ) is distinct from (
         old.status, old.credits_charged, old.api_cost_usd_micros_snapshot, old.sale_value_cents_snapshot,
         old.actual_api_cost_usd_micros, old.result_count,
         old.service_slug, old.provider_slug, old.model_slug, old.metadata, old.error,
         old.started_at, old.finished_at, old.created_at, old.idempotency_key, old.provider_request_id
       )
       -- Foreign keys declared ON DELETE SET NULL (the credit transactions of a
       -- deleted wallet, a retired service): detaching to NULL is allowed —
       -- account deletion must keep working — re-pointing is not.
       or (new.credit_tx_id is not null and new.credit_tx_id is distinct from old.credit_tx_id)
       or (new.refund_tx_id is not null and new.refund_tx_id is distinct from old.refund_tx_id)
       or (new.service_id is not null and new.service_id is distinct from old.service_id)
     ) then
    raise exception 'usage_event_immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists usage_events_guard on public.usage_events;
create trigger usage_events_guard before update on public.usage_events
  for each row execute function public.usage_events_guard();

/*
  COMPLETE, WITH THE EXECUTOR. The 0101 function recorded the provider/model
  chosen at the START; a fallback that actually served the call was never
  written back, so the ledger said "OpenAI" for an image Google made. This
  overload records who really answered (and keeps the requested pair in the
  metadata when they differ). Passing NULLs means "could not be determined":
  the columns become NULL — unknown — never a guess.
*/
create or replace function public.usage_event_complete(
  p_token text,
  p_event_id uuid,
  p_result_count integer,
  p_api_cost_usd_micros bigint,
  p_request_id text,
  p_provider_slug text,
  p_model_slug text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_row record;
  v_provider text := nullif(lower(btrim(coalesce(p_provider_slug, ''))), '');
  v_model text := nullif(btrim(coalesce(p_model_slug, '')), '');
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  select workspace_id, provider_slug, model_slug into v_row from public.usage_events where id = p_event_id;
  if v_row.workspace_id is null or not public.is_workspace_member(v_row.workspace_id) then
    raise exception 'not_authorized';
  end if;
  update public.usage_events
    set status = 'succeeded',
        result_count = greatest(0, coalesce(p_result_count, 0)),
        actual_api_cost_usd_micros = greatest(0, coalesce(p_api_cost_usd_micros, 0)),
        provider_request_id = left(p_request_id, 200),
        provider_slug = left(v_provider, 60),
        model_slug = left(v_model, 120),
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
          'requested_provider', case when v_row.provider_slug is distinct from v_provider
                                       or v_row.model_slug is distinct from v_model then v_row.provider_slug end,
          'requested_model', case when v_row.provider_slug is distinct from v_provider
                                    or v_row.model_slug is distinct from v_model then v_row.model_slug end,
          'executor_unknown', case when v_provider is null then true end)),
        idempotency_key = null,
        finished_at = now()
    where id = p_event_id and status = 'pending';
end $$;
revoke all on function public.usage_event_complete(text, uuid, integer, bigint, text, text, text) from public, anon;
grant execute on function public.usage_event_complete(text, uuid, integer, bigint, text, text, text) to authenticated;

/* ── 5. pricing ───────────────────────────────────────────────────────────*/

alter table public.ai_token_prices
  add column if not exists cached_input_usd_micros_per_mtok bigint;
alter table public.ai_token_prices drop constraint if exists ai_token_prices_cached_check;
alter table public.ai_token_prices add constraint ai_token_prices_cached_check
  check (cached_input_usd_micros_per_mtok is null or cached_input_usd_micros_per_mtok between 0 and 1000000000);

drop function if exists public.ai_token_prices_read(text);
create function public.ai_token_prices_read(p_token text)
returns table (provider_slug text, model text, input_usd_micros_per_mtok bigint,
               output_usd_micros_per_mtok bigint, cached_input_usd_micros_per_mtok bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.server_call_ok(p_token)) then raise exception 'forbidden'; end if;
  return query select t.provider_slug, t.model, t.input_usd_micros_per_mtok, t.output_usd_micros_per_mtok,
                      t.cached_input_usd_micros_per_mtok
                 from public.ai_token_prices t;
end;
$$;
revoke all on function public.ai_token_prices_read(text) from public;
grant execute on function public.ai_token_prices_read(text) to anon, authenticated;

-- Everything that is not billed by the token: an image (by size and quality),
-- a second of video, a request, a page. '*' = any value. The most specific
-- matching row wins; no row = the cost is UNKNOWN (never zero).
create table if not exists public.ai_unit_prices (
  provider_slug text not null check (provider_slug ~ '^[a-z0-9_\-]{2,40}$'),
  model text not null check (char_length(model) between 1 and 120),
  unit_kind text not null check (unit_kind in ('image', 'second', 'request', 'page')),
  resolution text not null default '*' check (resolution ~ '^(\*|[0-9]{1,5}[Kkp]?|[0-9]{2,5}x[0-9]{2,5})$'),
  quality text not null default '*' check (quality ~ '^(\*|[a-z]{2,16})$'),
  usd_micros_per_unit bigint not null check (usd_micros_per_unit between 0 and 100000000000),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  primary key (provider_slug, model, unit_kind, resolution, quality)
);
alter table public.ai_unit_prices enable row level security;
drop policy if exists ai_unit_prices_admin on public.ai_unit_prices;
create policy ai_unit_prices_admin on public.ai_unit_prices
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.ai_unit_prices from anon, authenticated;
grant select, insert, update, delete on public.ai_unit_prices to authenticated;

create or replace function public.ai_unit_prices_read(p_token text)
returns table (provider_slug text, model text, unit_kind text, resolution text, quality text, usd_micros_per_unit bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.server_call_ok(p_token)) then raise exception 'forbidden'; end if;
  return query select u.provider_slug, u.model, u.unit_kind, u.resolution, u.quality, u.usd_micros_per_unit
                 from public.ai_unit_prices u;
end;
$$;
revoke all on function public.ai_unit_prices_read(text) from public;
grant execute on function public.ai_unit_prices_read(text) to anon, authenticated;

-- The recorder may now carry cached-input tokens too (reported by the
-- provider, never estimated). Additive column on the trace.
alter table public.ai_provider_calls
  add column if not exists cached_input_tokens bigint;
alter table public.ai_provider_calls drop constraint if exists ai_provider_calls_cached_check;
alter table public.ai_provider_calls add constraint ai_provider_calls_cached_check
  check (cached_input_tokens is null or cached_input_tokens >= 0);
alter table public.ai_provider_calls drop constraint if exists ai_provider_calls_consumer_check;
alter table public.ai_provider_calls add constraint ai_provider_calls_consumer_check
  check (consumer in ('generation', 'image_tool', 'prompt_engine', 'workflow', 'embeddings',
                      'grovnews', 'provider_test', 'workflow_test'));

create or replace function public.ai_provider_call_record(p_token text, p_calls jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb;
  v_count integer := 0;
  v_basis text;
  v_cost bigint;
  v_units numeric;
  v_kind text;
  v_status text;
  v_provider text;
  v_error text;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if p_calls is null or jsonb_typeof(p_calls) <> 'array' then raise exception 'invalid_calls'; end if;
  if jsonb_array_length(p_calls) > 50 then raise exception 'too_many_calls'; end if;

  for v_row in select value from jsonb_array_elements(p_calls) loop
    begin
      v_provider := lower(v_row->>'provider_slug');
      v_status := v_row->>'status';
      v_basis := coalesce(v_row->>'cost_basis', 'unknown');
      -- NULL first: greatest(0, NULL) = 0 would turn a missing cost into a
      -- confident zero (0127 had exactly that; fixed here).
      v_cost := case when v_basis = 'unknown' or nullif(v_row->>'cost_usd_micros', '') is null then null
                     else greatest(0, (v_row->>'cost_usd_micros')::bigint) end;
      if v_basis <> 'unknown' and v_cost is null then v_basis := 'unknown'; end if;
      v_units := nullif(v_row->>'units', '')::numeric;
      v_kind := nullif(v_row->>'unit_kind', '');
      if v_units is null or v_kind is null then v_units := null; v_kind := null; end if;
      v_error := case when v_status = 'failed'
                      then left(regexp_replace(lower(coalesce(v_row->>'error_code', 'provider_error')), '[^a-z0-9_:.\-]', '_', 'g'), 80)
                      else null end;

      insert into public.ai_provider_calls (
        actor_kind, user_id, workspace_id, consumer, tool_key, usage_event_id, job_id, run_ref,
        provider_slug, model, status, error_code, request_count, input_tokens, output_tokens,
        cached_input_tokens, units, unit_kind, cost_usd_micros, cost_basis, duration_ms
      ) values (
        v_row->>'actor_kind',
        nullif(v_row->>'user_id', '')::uuid,
        nullif(v_row->>'workspace_id', '')::uuid,
        v_row->>'consumer',
        nullif(v_row->>'tool_key', ''),
        nullif(v_row->>'usage_event_id', '')::uuid,
        nullif(v_row->>'job_id', '')::uuid,
        nullif(v_row->>'run_ref', ''),
        v_provider,
        left(nullif(v_row->>'model', ''), 120),
        v_status,
        v_error,
        least(1000, greatest(0, coalesce((v_row->>'request_count')::integer, 1))),
        nullif(v_row->>'input_tokens', '')::bigint,
        nullif(v_row->>'output_tokens', '')::bigint,
        nullif(v_row->>'cached_input_tokens', '')::bigint,
        v_units, v_kind, v_cost, v_basis,
        least(3600000, greatest(0, nullif(v_row->>'duration_ms', '')::integer))
      );
      v_count := v_count + 1;

      -- Only production traffic moves the provider card, and only a failure
      -- that says something about the PROVIDER marks it (see 0127).
      if coalesce(v_row->>'consumer', '') not in ('provider_test', 'workflow_test') then
        if v_status = 'succeeded' then
          update public.ai_provider_credentials c
             set last_success_at = now()
            from public.ai_providers p
           where p.id = c.provider_id and p.slug = v_provider;
        elsif v_error ~ ('^(provider_(auth_failed|quota|out_of_credit|rate_limited|timeout|error|download_failed)'
                         || '|model_unavailable|analysis_(unavailable|timeout|overloaded|model_missing|error)'
                         || '|network|http_(401|402|403|408|429|5[0-9][0-9]))$') then
          update public.ai_provider_credentials c
             set last_error_at = now(), last_error_code = v_error
            from public.ai_providers p
           where p.id = c.provider_id and p.slug = v_provider;
        end if;
      end if;
    exception when others then
      null;
    end;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.ai_provider_call_record(text, jsonb) from public;
grant execute on function public.ai_provider_call_record(text, jsonb) to anon, authenticated;

/* ── 6. feedback pinned to what produced the result ───────────────────────*/

alter table public.generation_feedback
  add column if not exists engine_run_id uuid references public.ai_engine_runs(id) on delete set null,
  add column if not exists tool_key text,
  add column if not exists workflow_version integer,
  add column if not exists prompt_version integer,
  add column if not exists model_label text,
  add column if not exists provider_slug text;

/*
  Filled on every vote FROM SERVER-WRITTEN EVIDENCE (ai_engine_runs and the
  job row), never from what the voter sent. A vote is only a signal: nothing
  here publishes, edits or ranks a prompt or a workflow.
*/
create or replace function public.generation_feedback_pin()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_run public.ai_engine_runs;
  v_job record;
begin
  if new.verdict not in ('like', 'dislike') then return new; end if;
  select * into v_run from public.ai_engine_runs r
   where r.job_id = new.generation_job_id and r.status in ('ok', 'partial')
   order by r.created_at desc limit 1;
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
drop trigger if exists generation_feedback_pin on public.generation_feedback;
create trigger generation_feedback_pin before insert or update of verdict on public.generation_feedback
  for each row execute function public.generation_feedback_pin();

-- The pinned engine facts (run, versions, model, provider) are admin data:
-- a workspace member keeps reading the feedback columns they always could,
-- not the new ones.
revoke select on public.generation_feedback from authenticated;
grant select (id, workspace_id, user_id, generation_job_id, asset_path, verdict, issues, comment, created_at, updated_at)
  on public.generation_feedback to authenticated;

-- ROLLBACK (manual, in this order):
--   drop trigger if exists generation_feedback_pin on public.generation_feedback;
--   drop function if exists public.generation_feedback_pin();
--   alter table public.generation_feedback drop column if exists engine_run_id, drop column if exists tool_key,
--     drop column if exists workflow_version, drop column if exists prompt_version,
--     drop column if exists model_label, drop column if exists provider_slug;
--   drop function if exists public.ai_unit_prices_read(text); drop table if exists public.ai_unit_prices;
--   drop function if exists public.usage_event_complete(text, uuid, integer, bigint, text, text, text);
--   drop trigger if exists usage_events_guard on public.usage_events; drop function if exists public.usage_events_guard();
--   drop function if exists public.ai_engine_run_read(text, uuid), public.ai_engine_step_runs_read(text, uuid);
--   drop function if exists public.ai_engine_run_status(uuid), public.ai_engine_step_finish(text, uuid, text, integer, integer, jsonb),
--     public.ai_engine_step_begin(text, uuid, text, integer, integer, text, text, integer),
--     public.ai_engine_run_patch(text, uuid, text, jsonb), public.ai_engine_run_claim(text, uuid, text, integer),
--     public.ai_engine_run_create(text, jsonb), public.ai_tool_workflow_read(text, text, uuid);
--   drop table if exists public.ai_engine_step_runs;
--   (the added columns are nullable/defaulted and can stay)
