-- AI ENGINE / TOOL ENGINE UPGRADE — the existing "Narzędzia i silniki" system,
-- extended in place. Nothing here creates a second prompt system, a second
-- knowledge base or a second feedback table:
--
--   1. ai_tools            + 'workflow' engine mode, + knowledge_strategy
--   2. ai_tool_workflows   versioned multi-step definitions (draft/published/
--      ai_tool_workflow_steps  superseded, exactly like ai_tool_prompts), with
--                          real CHECK constraints instead of a JSON blob, and
--                          atomic save / publish / restore functions
--   3. knowledge_examples  + review state, scene, category, confidence, usage
--                          and feedback counters; a tool-scoped, token-gated
--                          candidate read (only ASSIGNED sets, only APPROVED
--                          and ENABLED examples, only READY sets)
--   4. generation_feedback + 'like' / 'dislike', one vote per user per job,
--                          written only through a definer function that checks
--                          the caller owns the job
--   5. ai_engine_runs      admin-only trace of what served each run (versions,
--                          model, knowledge ids, step timings). It lives OUTSIDE
--                          generation_jobs.settings on purpose: that column is
--                          readable by the customer's workspace.
--
-- ZERO BEHAVIOUR CHANGE ON DEPLOY. No tool's mode is changed, no prompt or
-- workflow is created, existing knowledge examples stay approved (the column
-- default), every READY set stays reachable by GrovShot (explicitly assigned
-- below), and existing feedback rows keep their verdicts.

/* ── 1. ai_tools ──────────────────────────────────────────────────────────*/

alter table public.ai_tools drop constraint if exists ai_tools_engine_mode_check;
alter table public.ai_tools add constraint ai_tools_engine_mode_check
  check (engine_mode in ('off', 'grovbase', 'user', 'hybrid', 'workflow'));

-- How retrieval weighs proven examples against variety. 'proven' is the
-- deterministic ranking; 'diverse' lets lower-ranked, still-qualified examples
-- through now and then. Feedback moves the ranking, never a prompt.
alter table public.ai_tools add column if not exists knowledge_strategy text not null default 'proven';
alter table public.ai_tools drop constraint if exists ai_tools_knowledge_strategy_check;
alter table public.ai_tools add constraint ai_tools_knowledge_strategy_check
  check (knowledge_strategy in ('proven', 'diverse'));

-- The runtime read gains one column. Same gate, same body otherwise; the
-- return type changes, so the function is re-created.
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
  knowledge_strategy text
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
    t.knowledge_strategy
  from public.ai_tools t
  left join public.ai_tool_prompts p
    on p.tool_key = t.tool_key and p.status = 'published'
  where t.tool_key = p_tool_key;
end;
$$;

revoke execute on function public.ai_tool_runtime(text, text) from anon, public;

/* ── 2. workflows ─────────────────────────────────────────────────────────*/

create table if not exists public.ai_tool_workflows (
  id uuid primary key default gen_random_uuid(),
  tool_key text not null references public.ai_tools(tool_key) on delete cascade,
  version integer not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'superseded')),
  summary text,
  reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (tool_key, version)
);
create unique index if not exists ai_tool_workflows_one_published
  on public.ai_tool_workflows (tool_key) where status = 'published';
create index if not exists ai_tool_workflows_tool_idx
  on public.ai_tool_workflows (tool_key, version desc);

-- One row per step. Every knob is a real column with a real constraint; the
-- step prompt is sealed exactly like ai_tool_prompts (AES-256-GCM, app key).
create table if not exists public.ai_tool_workflow_steps (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.ai_tool_workflows(id) on delete cascade,
  position smallint not null check (position between 1 and 8),
  name text not null check (char_length(name) between 1 and 80),
  enabled boolean not null default true,
  -- 'analyze': a text/vision call that returns TEXT or ANALYSIS for later
  -- steps. 'generate_image': the image model — always the last step, and the
  -- only step that is billed (once, through the ledger).
  operation text not null check (operation in ('analyze', 'generate_image')),
  output_kind text not null check (output_kind in ('text', 'analysis', 'image')),
  use_images boolean not null default true,
  -- NULL = "Według narzędzia". An image-model override points at a real model
  -- row; a text override names one of the two text-capable providers.
  model_id uuid references public.ai_models(id) on delete set null,
  text_provider text check (text_provider in ('openai', 'google')),
  timeout_ms integer not null default 60000 check (timeout_ms between 5000 and 300000),
  max_attempts smallint not null default 1 check (max_attempts between 1 and 3),
  condition text not null default 'always'
    check (condition in ('always', 'if_hint', 'if_previous_nonempty')),
  prompt_encrypted text not null,
  prompt_iv text not null,
  prompt_tag text not null,
  unique (workflow_id, position),
  check (
    (operation = 'generate_image' and output_kind = 'image' and text_provider is null)
    or (operation = 'analyze' and output_kind in ('text', 'analysis') and model_id is null)
  )
);
create index if not exists ai_tool_workflow_steps_wf_idx on public.ai_tool_workflow_steps (workflow_id, position);

alter table public.ai_tool_workflows enable row level security;
alter table public.ai_tool_workflow_steps enable row level security;
drop policy if exists ai_tool_workflows_admin on public.ai_tool_workflows;
create policy ai_tool_workflows_admin on public.ai_tool_workflows for all to authenticated
  using ((select public.is_admin(auth.uid()))) with check ((select public.is_admin(auth.uid())));
drop policy if exists ai_tool_workflow_steps_admin on public.ai_tool_workflow_steps;
create policy ai_tool_workflow_steps_admin on public.ai_tool_workflow_steps for all to authenticated
  using ((select public.is_admin(auth.uid()))) with check ((select public.is_admin(auth.uid())));

-- Save a new version (draft, or published in the same transaction). The step
-- list is validated HERE as well as in the application: a workflow that does
-- not end in exactly one enabled image step cannot produce a result, so it
-- cannot be stored at all.
create or replace function public.ai_save_tool_workflow(
  p_tool_key text,
  p_steps jsonb,
  p_summary text default null,
  p_reason text default null,
  p_publish boolean default false
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
  v_images integer := 0;
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
  if v_n < 1 or v_n > 8 then
    return jsonb_build_object('ok', false, 'error', 'invalid_steps');
  end if;
  for v_pos in 1..v_n loop
    v_step := p_steps -> (v_pos - 1);
    if coalesce(btrim(v_step->>'prompt_encrypted'), '') = '' then
      return jsonb_build_object('ok', false, 'error', 'empty_prompt');
    end if;
    if v_step->>'operation' = 'generate_image' then
      v_images := v_images + 1;
      if v_pos <> v_n then
        return jsonb_build_object('ok', false, 'error', 'image_step_last');
      end if;
      if coalesce((v_step->>'enabled')::boolean, true) = false then
        return jsonb_build_object('ok', false, 'error', 'image_step_disabled');
      end if;
    end if;
  end loop;
  if v_images <> 1 then
    return jsonb_build_object('ok', false, 'error', 'image_step_last');
  end if;
  if p_publish and coalesce(btrim(p_reason), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'reason_required');
  end if;

  select coalesce(max(version), 0) + 1 into v_version
    from public.ai_tool_workflows where tool_key = p_tool_key;

  if p_publish then
    update public.ai_tool_workflows set status = 'superseded'
     where tool_key = p_tool_key and status = 'published';
  end if;

  insert into public.ai_tool_workflows (tool_key, version, status, summary, reason, created_by, published_at)
  values (
    p_tool_key, v_version,
    case when p_publish then 'published' else 'draft' end,
    nullif(btrim(coalesce(p_summary, '')), ''),
    nullif(btrim(coalesce(p_reason, '')), ''),
    v_actor,
    case when p_publish then now() else null end
  ) returning id into v_id;

  insert into public.ai_tool_workflow_steps (
    workflow_id, position, name, enabled, operation, output_kind, use_images,
    model_id, text_provider, timeout_ms, max_attempts, condition,
    prompt_encrypted, prompt_iv, prompt_tag
  )
  select v_id, s.ord::smallint,
         left(btrim(coalesce(s.v->>'name', '')), 80),
         coalesce((s.v->>'enabled')::boolean, true),
         s.v->>'operation',
         s.v->>'output_kind',
         coalesce((s.v->>'use_images')::boolean, true),
         nullif(s.v->>'model_id', '')::uuid,
         nullif(s.v->>'text_provider', ''),
         coalesce((s.v->>'timeout_ms')::integer, 60000),
         coalesce((s.v->>'max_attempts')::smallint, 1),
         coalesce(nullif(s.v->>'condition', ''), 'always'),
         s.v->>'prompt_encrypted', s.v->>'prompt_iv', s.v->>'prompt_tag'
    from jsonb_array_elements(p_steps) with ordinality as s(v, ord);

  return jsonb_build_object('ok', true, 'id', v_id, 'version', v_version);
end;
$$;
revoke execute on function public.ai_save_tool_workflow(text, jsonb, text, text, boolean) from anon, public;

create or replace function public.ai_publish_tool_workflow(p_id uuid, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.ai_tool_workflows;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'not_authorized';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'reason_required');
  end if;
  select * into v_row from public.ai_tool_workflows where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if v_row.status = 'published' then
    return jsonb_build_object('ok', true, 'already', true, 'tool_key', v_row.tool_key);
  end if;
  if v_row.status <> 'draft' then
    return jsonb_build_object('ok', false, 'error', 'not_draft');
  end if;
  update public.ai_tool_workflows set status = 'superseded'
   where tool_key = v_row.tool_key and status = 'published';
  update public.ai_tool_workflows
     set status = 'published', published_at = now(),
         reason = coalesce(nullif(btrim(p_reason), ''), reason)
   where id = p_id;
  return jsonb_build_object('ok', true, 'tool_key', v_row.tool_key, 'version', v_row.version);
end;
$$;
revoke execute on function public.ai_publish_tool_workflow(uuid, text) from anon, public;

-- Rollback = copy an old version FORWARD as a new published version. History
-- is never rewritten.
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
  insert into public.ai_tool_workflows (tool_key, version, status, summary, reason, created_by, published_at)
  values (v_src.tool_key, v_version, 'published', v_src.summary,
          coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'restore v' || v_src.version),
          v_actor, now())
  returning id into v_id;
  insert into public.ai_tool_workflow_steps (
    workflow_id, position, name, enabled, operation, output_kind, use_images,
    model_id, text_provider, timeout_ms, max_attempts, condition,
    prompt_encrypted, prompt_iv, prompt_tag
  )
  select v_id, position, name, enabled, operation, output_kind, use_images,
         model_id, text_provider, timeout_ms, max_attempts, condition,
         prompt_encrypted, prompt_iv, prompt_tag
    from public.ai_tool_workflow_steps where workflow_id = v_src.id;
  return jsonb_build_object('ok', true, 'id', v_id, 'version', v_version,
                            'from_version', v_src.version, 'tool_key', v_src.tool_key);
end;
$$;
revoke execute on function public.ai_restore_tool_workflow(uuid, text) from anon, public;

-- The runtime read of the PUBLISHED workflow, token-gated like
-- ai_tool_runtime. The server reads it ONCE at the start of a run, so a
-- publish in the middle of a run cannot change the steps that run uses.
create or replace function public.ai_tool_workflow_runtime(p_tool_key text, p_token text)
returns table (
  workflow_id uuid,
  version integer,
  "position" smallint,
  name text,
  enabled boolean,
  operation text,
  output_kind text,
  use_images boolean,
  model_id uuid,
  text_provider text,
  timeout_ms integer,
  max_attempts smallint,
  condition text,
  prompt_encrypted text,
  prompt_iv text,
  prompt_tag text
)
language plpgsql stable security definer set search_path = public, extensions
as $$
begin
  if not public.server_call_ok(p_token) then return; end if;
  return query
  select w.id, w.version, s.position, s.name, s.enabled, s.operation, s.output_kind,
         s.use_images, s.model_id, s.text_provider, s.timeout_ms, s.max_attempts,
         s.condition, s.prompt_encrypted, s.prompt_iv, s.prompt_tag
    from public.ai_tool_workflows w
    join public.ai_tool_workflow_steps s on s.workflow_id = w.id
   where w.tool_key = p_tool_key and w.status = 'published'
   order by s.position;
end;
$$;
revoke all on function public.ai_tool_workflow_runtime(text, text) from public, anon;
grant execute on function public.ai_tool_workflow_runtime(text, text) to authenticated;

/* ── 3. knowledge ─────────────────────────────────────────────────────────*/

-- review_status defaults to 'approved' so every example that exists today
-- keeps being retrieved exactly as before. New PDF extractions (and anything
-- the importer could not pair with certainty) are written as 'pending' and
-- are invisible to retrieval until an admin approves them.
alter table public.knowledge_examples
  add column if not exists review_status text not null default 'approved',
  add column if not exists scene text,
  add column if not exists product_category text,
  add column if not exists confidence numeric(4, 3),
  add column if not exists source_kind text not null default 'zip',
  add column if not exists source_ref text,
  add column if not exists usage_count integer not null default 0,
  add column if not exists positive_count integer not null default 0,
  add column if not exists negative_count integer not null default 0,
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists reviewed_at timestamptz;
alter table public.knowledge_examples drop constraint if exists knowledge_examples_review_status_check;
alter table public.knowledge_examples add constraint knowledge_examples_review_status_check
  check (review_status in ('pending', 'approved', 'rejected'));
alter table public.knowledge_examples drop constraint if exists knowledge_examples_confidence_check;
alter table public.knowledge_examples add constraint knowledge_examples_confidence_check
  check (confidence is null or (confidence >= 0 and confidence <= 1));
alter table public.knowledge_examples drop constraint if exists knowledge_examples_source_kind_check;
alter table public.knowledge_examples add constraint knowledge_examples_source_kind_check
  check (source_kind in ('zip', 'pdf', 'manual'));
alter table public.knowledge_examples drop constraint if exists knowledge_examples_counts_check;
alter table public.knowledge_examples add constraint knowledge_examples_counts_check
  check (usage_count >= 0 and positive_count >= 0 and negative_count >= 0);
create index if not exists knowledge_examples_review_idx on public.knowledge_examples (set_id, review_status);

-- TOOL-SCOPED CANDIDATES. Only sets ASSIGNED to the tool (and the assignment
-- enabled), only READY sets, only ENABLED + APPROVED examples with a sealed
-- hint. Returns the raw signals; the ranking itself is plain code on the
-- server (lib/ai/knowledge-ranking.ts) so it can be tested without a model.
create or replace function public.knowledge_candidates(
  p_token text,
  p_tool_key text,
  p_embedding extensions.vector default null,
  p_limit integer default 20
) returns table (
  id uuid,
  similarity double precision,
  result_rating integer,
  usage_count integer,
  positive_count integer,
  negative_count integer,
  scene text,
  product_category text,
  tags text[],
  hint_encrypted text,
  hint_iv text,
  hint_tag text,
  created_at timestamptz
)
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  return query
    select e.id,
           case when p_embedding is not null and e.embedding is not null
                then (1 - (e.embedding <=> p_embedding))::double precision end,
           e.result_rating, e.usage_count, e.positive_count, e.negative_count,
           e.scene, coalesce(e.product_category, s.product_category), e.tags,
           e.hint_encrypted, e.hint_iv, e.hint_tag, e.created_at
      from public.knowledge_examples e
      join public.knowledge_sets s on s.id = e.set_id
      join public.ai_tool_knowledge k on k.set_id = s.id and k.tool_key = p_tool_key and k.enabled
     where e.enabled
       and e.review_status = 'approved'
       and e.hint_encrypted is not null
       and s.status = 'ready'
       and (p_embedding is null or e.embedding is not null)
     order by case when p_embedding is not null and e.embedding is not null
                   then e.embedding <=> p_embedding end nulls last,
              e.created_at desc
     limit least(greatest(coalesce(p_limit, 20), 1), 40);
end $$;
revoke all on function public.knowledge_candidates(text, text, extensions.vector, integer) from public, anon;
grant execute on function public.knowledge_candidates(text, text, extensions.vector, integer) to authenticated;

-- NO CHANGE FOR KNOWLEDGE THAT ALREADY SERVES GROVSHOT. Until now the
-- planner searched every READY set; from now on a tool reads only the sets
-- assigned to it. Every set that is READY at migration time is therefore
-- assigned to 'prompts' explicitly, so the planner keeps exactly the memory it
-- had (and an admin can detach it). On a database with no sets this is a no-op.
insert into public.ai_tool_knowledge (tool_key, set_id, enabled)
select 'prompts', s.id, true
  from public.knowledge_sets s
 where s.status = 'ready'
   and exists (select 1 from public.ai_tools t where t.tool_key = 'prompts')
on conflict (tool_key, set_id) do nothing;

/* ── 5. engine run trace (before feedback, which reads it) ────────────────*/

create table if not exists public.ai_engine_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tool_key text not null,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  job_id uuid references public.generation_jobs(id) on delete set null,
  prompt_session_id uuid references public.prompt_sessions(id) on delete set null,
  mode text not null check (mode in ('off', 'grovbase', 'user', 'hybrid', 'workflow')),
  status text not null check (status in ('ok', 'failed', 'blocked')),
  error text check (error is null or char_length(error) <= 80),
  engine_version text,
  prompt_version integer,
  workflow_id uuid references public.ai_tool_workflows(id) on delete set null,
  workflow_version integer,
  model_id uuid references public.ai_models(id) on delete set null,
  model_label text,
  -- [{n, name, op, status, ms, attempts, error}] — names, codes and timings
  -- only. Never a prompt, never a model output.
  steps jsonb not null default '[]'::jsonb check (jsonb_typeof(steps) = 'array'),
  knowledge_example_ids uuid[] not null default '{}',
  scene_example_id uuid,
  credits integer,
  api_cost_usd_micros bigint,
  duration_ms integer
);
create index if not exists ai_engine_runs_tool_idx on public.ai_engine_runs (tool_key, created_at desc);
create index if not exists ai_engine_runs_job_idx on public.ai_engine_runs (job_id);

alter table public.ai_engine_runs enable row level security;
drop policy if exists ai_engine_runs_admin_read on public.ai_engine_runs;
create policy ai_engine_runs_admin_read on public.ai_engine_runs for select to authenticated
  using ((select public.is_admin(auth.uid())));
-- No insert/update/delete policy: rows are written only by the server-token
-- function below, from the customer's own request.

create or replace function public.ai_engine_run_record(p_token text, p_run jsonb)
returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id uuid;
  v_examples uuid[];
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if jsonb_typeof(p_run->'steps') = 'array' and jsonb_array_length(p_run->'steps') > 20 then
    raise exception 'invalid_steps';
  end if;
  select coalesce(array_agg(distinct x::uuid), '{}') into v_examples
    from jsonb_array_elements_text(coalesce(p_run->'knowledge_example_ids', '[]'::jsonb)) x
   where x ~ '^[0-9a-fA-F-]{36}$';
  v_examples := v_examples[1:10];

  insert into public.ai_engine_runs (
    tool_key, workspace_id, user_id, job_id, prompt_session_id, mode, status, error,
    engine_version, prompt_version, workflow_id, workflow_version, model_id, model_label,
    steps, knowledge_example_ids, scene_example_id, credits, api_cost_usd_micros, duration_ms
  ) values (
    left(p_run->>'tool_key', 60),
    nullif(p_run->>'workspace_id', '')::uuid,
    nullif(p_run->>'user_id', '')::uuid,
    nullif(p_run->>'job_id', '')::uuid,
    nullif(p_run->>'prompt_session_id', '')::uuid,
    p_run->>'mode',
    p_run->>'status',
    left(nullif(p_run->>'error', ''), 80),
    left(nullif(p_run->>'engine_version', ''), 40),
    nullif(p_run->>'prompt_version', '')::integer,
    nullif(p_run->>'workflow_id', '')::uuid,
    nullif(p_run->>'workflow_version', '')::integer,
    nullif(p_run->>'model_id', '')::uuid,
    left(nullif(p_run->>'model_label', ''), 120),
    coalesce(p_run->'steps', '[]'::jsonb),
    v_examples,
    nullif(p_run->>'scene_example_id', '')::uuid,
    nullif(p_run->>'credits', '')::integer,
    nullif(p_run->>'api_cost_usd_micros', '')::bigint,
    nullif(p_run->>'duration_ms', '')::integer
  ) returning id into v_id;

  -- Usage is counted only for runs that produced something.
  if p_run->>'status' = 'ok' and array_length(v_examples, 1) > 0 then
    update public.knowledge_examples set usage_count = usage_count + 1 where id = any(v_examples);
  end if;
  return v_id;
end $$;
revoke all on function public.ai_engine_run_record(text, jsonb) from public, anon;
grant execute on function public.ai_engine_run_record(text, jsonb) to authenticated;

/* ── 4. feedback ──────────────────────────────────────────────────────────*/

alter table public.generation_feedback drop constraint if exists generation_feedback_verdict_check;
alter table public.generation_feedback add constraint generation_feedback_verdict_check
  check (verdict in ('accepted', 'regenerate', 'like', 'dislike'));
alter table public.generation_feedback add column if not exists updated_at timestamptz;

-- One 👍/👎 per user per job. Partial, so the legacy accept/regenerate rows
-- (append-only by design) are untouched.
create unique index if not exists generation_feedback_one_vote
  on public.generation_feedback (generation_job_id, user_id)
  where verdict in ('like', 'dislike');

-- The direct insert path now requires that the job belongs to the caller and
-- to the workspace named on the row, and may only carry the legacy verdicts:
-- votes go through generation_feedback_submit(), which also keeps the
-- knowledge counters consistent.
drop policy if exists gf_insert on public.generation_feedback;
create policy gf_insert on public.generation_feedback for insert with check (
  user_id = (select auth.uid())
  and public.is_workspace_member(workspace_id)
  and verdict in ('accepted', 'regenerate')
  and exists (
    select 1 from public.generation_jobs j
     where j.id = generation_job_id
       and j.workspace_id = generation_feedback.workspace_id
       and j.user_id = (select auth.uid())
  )
);

create or replace function public.generation_feedback_submit(
  p_generation_id uuid,
  p_verdict text,
  p_reasons text[] default '{}'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_job uuid;
  v_ws uuid;
  v_owner uuid;
  v_status text;
  v_old text;
  v_reasons text[];
  v_examples uuid[];
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_verdict is not null and p_verdict not in ('like', 'dislike') then
    return jsonb_build_object('ok', false, 'error', 'invalid_verdict');
  end if;

  select g.job_id, j.workspace_id, j.user_id, j.status::text
    into v_job, v_ws, v_owner, v_status
    from public.generations g
    join public.generation_jobs j on j.id = g.job_id
   where g.id = p_generation_id;
  -- Someone else's result, a result in a workspace the caller left, or a job
  -- that did not complete: indistinguishable from "does not exist".
  if v_job is null or v_owner is distinct from v_uid or v_status <> 'completed'
     or not public.is_workspace_member(v_ws, v_uid) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select coalesce(array_agg(distinct r order by r), '{}') into v_reasons
    from unnest(coalesce(p_reasons, '{}'::text[])) r
   where (p_verdict = 'like' and r in ('good_fidelity', 'good_scene', 'good_style'))
      or (p_verdict = 'dislike' and r in ('wrong_product', 'bad_scene', 'bad_composition',
                                          'bad_colors', 'too_artificial', 'other'));

  -- Serialise this user's vote on this job: a double click is two requests,
  -- and the counters below must move once.
  perform pg_advisory_xact_lock(hashtext('gf:' || v_job::text || ':' || v_uid::text));
  select verdict into v_old from public.generation_feedback
   where generation_job_id = v_job and user_id = v_uid and verdict in ('like', 'dislike');

  if p_verdict is null then
    delete from public.generation_feedback
     where generation_job_id = v_job and user_id = v_uid and verdict in ('like', 'dislike');
  else
    insert into public.generation_feedback (workspace_id, user_id, generation_job_id, verdict, issues)
    values (v_ws, v_uid, v_job, p_verdict, v_reasons)
    on conflict (generation_job_id, user_id) where verdict in ('like', 'dislike')
    do update set verdict = excluded.verdict, issues = excluded.issues, updated_at = now();
  end if;

  -- Ranking signal only. The examples this job was built from move up or
  -- down; no prompt, no version and no instruction is touched.
  --
  -- WHICH examples is decided from SERVER-WRITTEN evidence only: the job must
  -- carry a succeeded usage event (usage_events is server-written since 0101,
  -- so a customer cannot fabricate a "completed" job to vote with), and the
  -- example ids come from ai_engine_runs (server-token writes) — never from
  -- prompt_sessions.knowledge_used, which a workspace member can edit.
  if v_old is distinct from p_verdict
     and exists (select 1 from public.usage_events u
                  where u.generation_job_id = v_job and u.status = 'succeeded') then
    select coalesce(array_agg(distinct x), '{}') into v_examples from (
      select unnest(r.knowledge_example_ids) as x
        from public.ai_engine_runs r
       where r.status = 'ok'
         and r.workspace_id = v_ws
         and (r.job_id = v_job
              or (r.prompt_session_id is not null
                  and r.prompt_session_id = (select j.prompt_session_id from public.generation_jobs j where j.id = v_job)))
    ) q;
    if array_length(v_examples, 1) > 0 then
      update public.knowledge_examples set
        positive_count = greatest(0, positive_count
          + (case when p_verdict = 'like' then 1 else 0 end)
          - (case when v_old = 'like' then 1 else 0 end)),
        negative_count = greatest(0, negative_count
          + (case when p_verdict = 'dislike' then 1 else 0 end)
          - (case when v_old = 'dislike' then 1 else 0 end))
       where id = any(v_examples);
    end if;
  end if;

  return jsonb_build_object('ok', true, 'verdict', p_verdict, 'reasons', to_jsonb(coalesce(v_reasons, '{}'::text[])));
end $$;
revoke all on function public.generation_feedback_submit(uuid, text, text[]) from public, anon;
grant execute on function public.generation_feedback_submit(uuid, text, text[]) to authenticated;

-- The caller's own results among a set of generations, with their vote (or
-- null). A result not returned here is not the caller's to rate — the gallery
-- hides the thumbs for teammates' results instead of failing on a click.
create or replace function public.generation_feedback_mine(p_generation_ids uuid[])
returns table (generation_id uuid, verdict text, reasons text[])
language sql stable security definer set search_path = public as $$
  select g.id, f.verdict, f.issues
    from public.generations g
    join public.generation_jobs j on j.id = g.job_id
    left join public.generation_feedback f
      on f.generation_job_id = g.job_id
     and f.user_id = auth.uid()
     and f.verdict in ('like', 'dislike')
   where g.id = any((coalesce(p_generation_ids, '{}'::uuid[]))[1:200])
     and j.user_id = auth.uid()
     and j.status = 'completed';
$$;
revoke all on function public.generation_feedback_mine(uuid[]) from public, anon;
grant execute on function public.generation_feedback_mine(uuid[]) to authenticated;
