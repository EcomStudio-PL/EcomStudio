-- ════════════════════════════════════════════════════════════════════════════
-- 0163 · GROVBASE SHOT V2 — THE SERVER WORKER (an order needs no browser)
--
-- Until now every invocation of a V2 order ran in the CUSTOMER'S session:
-- the start request, then hops that carried the customer's access token, then
-- whatever page the customer opened. When that token expired (about an hour)
-- or the hops ran out, a running order waited for the customer to come back.
--
-- From here the customer's session is used ONCE — to accept the order
-- (grovshot_run_create checks auth.uid(), the workspace, the caps and the
-- balance). Every later step runs in a TRUSTED SERVER CONTEXT: the anonymous
-- client plus the server's dispatch token (exactly what the GrovNews job and
-- the trial-originals sweep use; no service-role key exists in this product).
-- A pg_cron tick wakes /api/grovshot/worker every minute while an order is
-- waiting; the worker claims it (the 0129 lease: one driver at a time) and
-- advances it. What the server may do is bounded here, in SQL:
--
--   1. grovshot_srv_scope — the ONLY door: the server token, an OPEN V2 order
--      and the caller holding its UNEXPIRED lease. Inside that one
--      transaction the order's owner is the acting user (auth.uid()), so the
--      ledger, the library and the activity log keep their own checks
--      (membership, the wallet's workspace…) — nothing is re-implemented.
--   2. one function per thing an order does — charge, complete, refund, job,
--      library rows, the session mirror, notifications, activity, the
--      analysis reuse, the balance — each tied to THAT order (its workspace,
--      its jobs, its idempotency keys) and never to a caller-supplied user;
--      an admin TEST order can never charge or write customer rows;
--   3. storage: the server arms EXACT objects (an order's own photos; its own
--      job folders) for three minutes; an anonymous storage request is
--      allowed only for an armed object of an order whose lease is live
--      (the trial-originals sweep's pattern, 0143);
--   4. the run-store functions (0129), already token-gated, are callable by
--      the anonymous role (they refuse without the token, as before);
--   5. grovshot_srv_due + the pg_cron tick (every minute, a no-op while no
--      order waits); the origin and token come from the vault entries the
--      newsletter scheduler already keeps;
--   6. the published per-token prices of the Claude models (Anthropic list
--      prices; editable in the price list like every other row).
--
-- ROLLBACK (manual): select cron.unschedule('grovbase-grovshot-worker');
--   drop the grovshot_worker_* / grovshot_storage_* policies on
--   storage.objects; drop function public.grovshot_srv_* ,
--   public.grovshot_storage_ok, public.grovshot_worker_tick;
--   drop table public.grovshot_storage_grants; revoke execute on the six
--   ai_engine_run/step functions and provider_health_set from anon;
--   drop policy provider_health_server_select on public.provider_health.
-- ════════════════════════════════════════════════════════════════════════════

set local lock_timeout = '10s';

-- 1 ─────────────────────────────────────────────────────────────────────────
create or replace function public.grovshot_srv_scope(p_token text, p_run_id uuid, p_owner text)
returns public.ai_engine_runs
language plpgsql security definer set search_path = public as $$
declare
  v_run public.ai_engine_runs;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  select * into v_run from public.ai_engine_runs where id = p_run_id;
  if not found or v_run.run_kind not in ('grovshot', 'grovshot_test') or v_run.user_id is null or v_run.workspace_id is null then
    raise exception 'not_found';
  end if;
  if v_run.status not in ('queued', 'running') or v_run.lease_owner is distinct from p_owner
     or v_run.locked_until is null or v_run.locked_until <= now() then
    raise exception 'not_owner';
  end if;
  -- For the rest of THIS transaction the order's owner is the acting user:
  -- the functions called after this keep their own auth.uid() checks.
  perform set_config('request.jwt.claim.sub', v_run.user_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_run.user_id, 'role', 'authenticated')::text, true);
  return v_run;
end $$;
revoke all on function public.grovshot_srv_scope(text, uuid, text) from public, anon, authenticated;

-- 2 ─────────────────────────────────────────────────────────────────────────
-- The owner's account state and the workspace's wallet (read fresh).
create or replace function public.grovshot_srv_context(p_token text, p_run_id uuid, p_owner text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_run public.ai_engine_runs;
  v_profile jsonb;
  v_wallet jsonb;
begin
  v_run := public.grovshot_srv_scope(p_token, p_run_id, p_owner);
  select to_jsonb(p) - 'role' into v_profile from (
    select pr.blocked, pr.blocked_until, pr.blocked_reason from public.profiles pr where pr.id = v_run.user_id) p;
  select jsonb_build_object('id', w.id, 'balance', w.balance) into v_wallet
    from public.credit_wallets w where w.workspace_id = v_run.workspace_id;
  return jsonb_build_object(
    'profile', v_profile, 'member', public.is_workspace_member(v_run.workspace_id),
    'wallet_id', v_wallet->'id', 'balance', v_wallet->'balance');
end $$;

-- An earlier analysis of the same bytes (0162), for this order's workspace.
create or replace function public.grovshot_srv_analysis(p_token text, p_run_id uuid, p_owner text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_run public.ai_engine_runs;
begin
  v_run := public.grovshot_srv_scope(p_token, p_run_id, p_owner);
  return public.grovshot_analysis_lookup(p_token, v_run.workspace_id, v_run.input->>'photo_key', v_run.input->>'card_key');
end $$;

-- The customer-visible session and one concept per shot (customer orders only).
create or replace function public.grovshot_srv_mirror(p_token text, p_run_id uuid, p_owner text, p_session jsonb, p_concepts jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_run public.ai_engine_runs;
  v_s public.prompt_sessions;
  v_c jsonb;
  v_g public.generated_prompts;
  v_session uuid;
  v_id uuid;
  v_out jsonb := '[]'::jsonb;
begin
  v_run := public.grovshot_srv_scope(p_token, p_run_id, p_owner);
  if v_run.run_kind <> 'grovshot' then raise exception 'not_found'; end if;
  v_s := jsonb_populate_record(null::public.prompt_sessions, coalesce(p_session, '{}'::jsonb));
  insert into public.prompt_sessions (
    workspace_id, user_id, product_id, product_name, description, extra_info, aspect_ratio, style, resolution,
    reference_paths, status, mode, session_type
  ) values (
    v_run.workspace_id, v_run.user_id, null, left(coalesce(v_s.product_name, ''), 120), null, null,
    coalesce(v_s.aspect_ratio, v_run.input->>'aspect_ratio'), null, coalesce(v_s.resolution, v_run.input->>'resolution'),
    array(select jsonb_array_elements_text(coalesce(v_run.input->'photos', '[]'::jsonb))), 'ready', 'engine', 'lifestyle'
  ) returning id into v_session;
  for v_c in select * from jsonb_array_elements(coalesce(p_concepts, '[]'::jsonb)) loop
    v_g := jsonb_populate_record(null::public.generated_prompts, v_c);
    insert into public.generated_prompts (
      product_id, workspace_id, session_id, concept_name, shot_type, scene_type, customer_title, customer_description,
      prompt_text, negative_prompt, prompt_encrypted, prompt_iv, prompt_tag, primary_reference, supporting_references,
      reference_indices, reference_image_ids, reference_rationale, format, style, priority, status, lock_strength, model_id
    ) values (
      null, v_run.workspace_id, v_session, left(coalesce(v_g.concept_name, ''), 200), 'scene', null,
      left(v_g.customer_title, 200), left(v_g.customer_description, 1000),
      '', null, v_g.prompt_encrypted, v_g.prompt_iv, v_g.prompt_tag, v_g.primary_reference, '[]'::jsonb,
      coalesce(v_g.reference_indices, '{}'), '{}', null, coalesce(v_g.format, v_run.input->>'aspect_ratio'), null,
      v_g.priority, 'ready', 'LOW', v_g.model_id
    ) returning id into v_id;
    v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_id, 'priority', v_g.priority));
  end loop;
  return jsonb_build_object('session_id', v_session, 'concepts', v_out);
end $$;

-- A shot's job (customer orders only), stamped with THIS order.
create or replace function public.grovshot_srv_job_create(p_token text, p_run_id uuid, p_owner text, p_job jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_run public.ai_engine_runs;
  v_j public.generation_jobs;
  v_id uuid;
begin
  v_run := public.grovshot_srv_scope(p_token, p_run_id, p_owner);
  if v_run.run_kind <> 'grovshot' then raise exception 'not_found'; end if;
  v_j := jsonb_populate_record(null::public.generation_jobs, coalesce(p_job, '{}'::jsonb));
  if v_j.prompt_id is not null and not exists (
       select 1 from public.generated_prompts g where g.id = v_j.prompt_id and g.workspace_id = v_run.workspace_id) then
    raise exception 'not_found';
  end if;
  if v_j.prompt_session_id is not null and not exists (
       select 1 from public.prompt_sessions s where s.id = v_j.prompt_session_id and s.workspace_id = v_run.workspace_id) then
    raise exception 'not_found';
  end if;
  insert into public.generation_jobs (
    workspace_id, user_id, model_id, provider_slug, prompt_text, aspect_ratio, quantity, resolution,
    prompt_id, prompt_session_id, prompt_origin, status, started_at, reference_image_ids, settings
  ) values (
    v_run.workspace_id, v_run.user_id, v_j.model_id, v_j.provider_slug, null, v_j.aspect_ratio, 1, v_j.resolution,
    v_j.prompt_id, v_j.prompt_session_id, coalesce(v_j.prompt_origin, 'ecomstudio'), 'processing', now(), '{}',
    coalesce(v_j.settings, '{}'::jsonb) || jsonb_build_object('engine', 'grovshot_v2', 'run_id', v_run.id::text)
  ) returning id into v_id;
  return v_id;
end $$;

-- Close a job of THIS order: completed (at the order's quoted unit) or failed.
create or replace function public.grovshot_srv_job_update(
  p_token text, p_run_id uuid, p_owner text, p_job_id uuid, p_status text, p_error text, p_latency_ms integer, p_settings jsonb
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_run public.ai_engine_runs;
  v_unit integer;
  v_n integer;
begin
  v_run := public.grovshot_srv_scope(p_token, p_run_id, p_owner);
  if p_status not in ('completed', 'failed') then raise exception 'invalid_status'; end if;
  v_unit := coalesce(nullif(v_run.input->'quote'->>'unit', '')::integer, 0);
  update public.generation_jobs j set
    status = p_status::public.job_status,
    credits_charged = case when p_status = 'completed' then greatest(0, v_unit) else 0 end,
    completed_at = now(),
    error_message = case when p_status = 'failed' then left(coalesce(p_error, 'failed'), 200) else j.error_message end,
    error_class = case when p_status = 'failed' then left(coalesce(p_error, 'failed'), 80) else j.error_class end,
    latency_ms = coalesce(p_latency_ms, j.latency_ms),
    settings = case when jsonb_typeof(p_settings) = 'object'
                    then coalesce(j.settings, '{}'::jsonb) || (p_settings - 'run_id' - 'engine') else j.settings end
  where j.id = p_job_id and j.workspace_id = v_run.workspace_id and j.settings->>'run_id' = v_run.id::text;
  get diagnostics v_n = row_count;
  return v_n = 1;
end $$;

-- THIS order's jobs (one item, or all), status and settings only.
create or replace function public.grovshot_srv_jobs(p_token text, p_run_id uuid, p_owner text, p_item integer)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_run public.ai_engine_runs;
begin
  v_run := public.grovshot_srv_scope(p_token, p_run_id, p_owner);
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', j.id, 'status', j.status, 'settings', j.settings) order by j.created_at)
      from public.generation_jobs j
     where j.workspace_id = v_run.workspace_id and j.settings->>'run_id' = v_run.id::text
       and (p_item is null or j.settings->>'shot_item' = p_item::text)), '[]'::jsonb);
end $$;

-- A delivered shot's library rows, for a job of THIS order, at its own path.
create or replace function public.grovshot_srv_library_add(
  p_token text, p_run_id uuid, p_owner text, p_job_id uuid, p_path text, p_width integer, p_height integer,
  p_quality text, p_score numeric, p_shot integer
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_run public.ai_engine_runs;
  v_gen uuid;
  v_asset uuid;
begin
  v_run := public.grovshot_srv_scope(p_token, p_run_id, p_owner);
  if not exists (select 1 from public.generation_jobs j where j.id = p_job_id and j.workspace_id = v_run.workspace_id
                   and j.settings->>'run_id' = v_run.id::text) then raise exception 'not_found'; end if;
  if p_path is null or p_path !~ ('^' || v_run.workspace_id::text || '/' || p_job_id::text || '/[A-Za-z0-9_.-]+$') then
    raise exception 'invalid_path';
  end if;
  if p_quality not in ('passed', 'warning') then raise exception 'invalid_quality'; end if;
  insert into public.generations (job_id, workspace_id, quality_status, product_match_score)
  values (p_job_id, v_run.workspace_id, p_quality::public.quality_status, p_score) returning id into v_gen;
  insert into public.generation_assets (generation_id, asset_type, storage_path, width, height, metadata)
  values (v_gen, 'image', p_path, p_width, p_height, jsonb_build_object('tool', 'prompts', 'engine', 'grovshot_v2', 'shot', p_shot))
  returning id into v_asset;
  return jsonb_build_object('generation_id', v_gen, 'asset_id', v_asset);
end $$;

-- A job's library rows (generation + its assets' paths).
create or replace function public.grovshot_srv_library_rows(p_token text, p_run_id uuid, p_owner text, p_job_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_run public.ai_engine_runs;
begin
  v_run := public.grovshot_srv_scope(p_token, p_run_id, p_owner);
  return coalesce((
    select jsonb_agg(jsonb_build_object('generation_id', g.id, 'asset_id', a.id, 'storage_path', a.storage_path))
      from public.generations g
      join public.generation_jobs j on j.id = g.job_id
      left join public.generation_assets a on a.generation_id = g.id
     where g.job_id = p_job_id and g.workspace_id = v_run.workspace_id and j.settings->>'run_id' = v_run.id::text), '[]'::jsonb);
end $$;

-- Remove a job's library rows (before its refund); the count left (0 = gone).
create or replace function public.grovshot_srv_library_remove(p_token text, p_run_id uuid, p_owner text, p_job_id uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_run public.ai_engine_runs;
  v_left integer;
begin
  v_run := public.grovshot_srv_scope(p_token, p_run_id, p_owner);
  if not exists (select 1 from public.generation_jobs j where j.id = p_job_id and j.workspace_id = v_run.workspace_id
                   and j.settings->>'run_id' = v_run.id::text) then return 0; end if;
  delete from public.generation_assets a using public.generations g
   where a.generation_id = g.id and g.job_id = p_job_id and g.workspace_id = v_run.workspace_id;
  delete from public.generations g where g.job_id = p_job_id and g.workspace_id = v_run.workspace_id;
  select count(*) into v_left from public.generations g where g.job_id = p_job_id;
  return v_left;
end $$;

-- The shot's concept points at its delivered job (👍/👎, „Regeneruj”).
create or replace function public.grovshot_srv_concept_done(p_token text, p_run_id uuid, p_owner text, p_concept_id uuid, p_job_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_run public.ai_engine_runs;
  v_n integer;
begin
  v_run := public.grovshot_srv_scope(p_token, p_run_id, p_owner);
  update public.generated_prompts g set last_job_id = p_job_id, generation_count = 1
   where g.id = p_concept_id and g.workspace_id = v_run.workspace_id
     and exists (select 1 from public.generation_jobs j where j.id = p_job_id and j.workspace_id = v_run.workspace_id
                   and j.settings->>'run_id' = v_run.id::text);
  get diagnostics v_n = row_count;
  return v_n = 1;
end $$;

-- THE CHARGE of one delivered shot: the order's own quoted unit, the order's
-- own idempotency prefix, a job of this order — through the ledger's own
-- usage_event_start (wallet, membership, insufficient credits: unchanged).
create or replace function public.grovshot_srv_usage_start(
  p_token text, p_run_id uuid, p_owner text, p_wallet_id uuid, p_job_id uuid, p_key text,
  p_provider_slug text, p_model_slug text, p_metadata jsonb
) returns table (event_id uuid, status text)
language plpgsql security definer set search_path = public as $$
declare
  v_run public.ai_engine_runs;
  v_unit integer;
begin
  v_run := public.grovshot_srv_scope(p_token, p_run_id, p_owner);
  if v_run.run_kind <> 'grovshot' then raise exception 'not_found'; end if;
  if p_key is null or left(p_key, char_length('gsv2:' || v_run.id::text || ':')) <> 'gsv2:' || v_run.id::text || ':' then
    raise exception 'invalid_key';
  end if;
  if not exists (select 1 from public.generation_jobs j where j.id = p_job_id and j.workspace_id = v_run.workspace_id
                   and j.settings->>'run_id' = v_run.id::text) then raise exception 'not_found'; end if;
  v_unit := nullif(v_run.input->'quote'->>'unit', '')::integer;
  if v_unit is null or v_unit <= 0 then raise exception 'invalid_amount'; end if;
  return query select * from public.usage_event_start(
    p_token, v_run.user_id, v_run.workspace_id, p_wallet_id, 'image_generation', v_unit,
    p_provider_slug, p_model_slug, p_job_id, p_key,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('operation', 'grovshot_v2', 'run_id', v_run.id::text));
end $$;

-- An event of THIS order (its metadata says so).
create or replace function public.grovshot_srv_event_of_run(p_run public.ai_engine_runs, p_event_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.usage_events e
                  where e.id = p_event_id and e.workspace_id = p_run.workspace_id and e.metadata->>'run_id' = p_run.id::text);
$$;
revoke all on function public.grovshot_srv_event_of_run(public.ai_engine_runs, uuid) from public, anon, authenticated;

create or replace function public.grovshot_srv_usage_complete(
  p_token text, p_run_id uuid, p_owner text, p_event_id uuid, p_api_cost_usd_micros bigint, p_provider_slug text, p_model_slug text
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_run public.ai_engine_runs;
begin
  v_run := public.grovshot_srv_scope(p_token, p_run_id, p_owner);
  if not public.grovshot_srv_event_of_run(v_run, p_event_id) then raise exception 'not_found'; end if;
  perform public.usage_event_complete(p_token, p_event_id, 1, p_api_cost_usd_micros, null, p_provider_slug, p_model_slug);
  return true;
end $$;

create or replace function public.grovshot_srv_usage_fail(
  p_token text, p_run_id uuid, p_owner text, p_event_id uuid, p_error text, p_api_cost_usd_micros bigint
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_run public.ai_engine_runs;
begin
  v_run := public.grovshot_srv_scope(p_token, p_run_id, p_owner);
  if not public.grovshot_srv_event_of_run(v_run, p_event_id) then raise exception 'not_found'; end if;
  perform public.usage_event_fail(p_token, p_event_id, p_error, p_api_cost_usd_micros);
  return true;
end $$;

-- An event of THIS order, by id or by its idempotency key.
create or replace function public.grovshot_srv_event(p_token text, p_run_id uuid, p_owner text, p_event_id uuid, p_key text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_run public.ai_engine_runs;
  v_e record;
begin
  v_run := public.grovshot_srv_scope(p_token, p_run_id, p_owner);
  select e.id, e.status, e.generation_job_id into v_e from public.usage_events e
   where e.workspace_id = v_run.workspace_id and e.metadata->>'run_id' = v_run.id::text
     and ((p_event_id is not null and e.id = p_event_id) or (p_event_id is null and p_key is not null and e.idempotency_key = p_key))
   order by e.created_at desc limit 1;
  if not found then return null; end if;
  return jsonb_build_object('id', v_e.id, 'status', v_e.status, 'job_id', v_e.generation_job_id);
end $$;

-- The library's thumbnails of a delivered asset of THIS order.
create or replace function public.grovshot_srv_derivatives(
  p_token text, p_run_id uuid, p_owner text, p_asset_id uuid, p_thumb text, p_preview text
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_run public.ai_engine_runs;
begin
  v_run := public.grovshot_srv_scope(p_token, p_run_id, p_owner);
  if not exists (select 1 from public.generation_assets a join public.generations g on g.id = a.generation_id
                   join public.generation_jobs j on j.id = g.job_id
                  where a.id = p_asset_id and g.workspace_id = v_run.workspace_id and j.settings->>'run_id' = v_run.id::text) then
    raise exception 'not_found';
  end if;
  return public.set_asset_derivatives(p_asset_id, p_thumb, p_preview);
end $$;

-- The order's activity rows, as the owner (two actions only).
create or replace function public.grovshot_srv_log(
  p_token text, p_run_id uuid, p_owner text, p_action text, p_entity_type text, p_entity_id uuid, p_metadata jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_run public.ai_engine_runs;
begin
  v_run := public.grovshot_srv_scope(p_token, p_run_id, p_owner);
  if p_action not in ('grovshot_v2.completed', 'generation.completed') then raise exception 'invalid_action'; end if;
  perform public.log_activity(v_run.workspace_id, p_action, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb), null);
end $$;

-- „Generacja gotowa” in the owner's Aktywność (deduplicated by key).
create or replace function public.grovshot_srv_notify(
  p_token text, p_run_id uuid, p_owner text, p_href text, p_meta jsonb, p_dedupe text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_run public.ai_engine_runs;
begin
  v_run := public.grovshot_srv_scope(p_token, p_run_id, p_owner);
  if v_run.run_kind <> 'grovshot' then return; end if;
  if p_href is not null and p_href !~ '^/library' then raise exception 'invalid_href'; end if;
  insert into public.notifications (user_id, type, title, body, href, meta, dedupe_key)
  values (v_run.user_id, 'generation_done', 'generation_done', null, p_href, coalesce(p_meta, '{}'::jsonb), left(p_dedupe, 200))
  on conflict do nothing;
end $$;

-- 3 ─────────────────────────────────────────────────────────────────────────
create table if not exists public.grovshot_storage_grants (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.ai_engine_runs(id) on delete cascade,
  bucket text not null check (bucket in ('product-images', 'generation-assets')),
  name text not null check (char_length(name) between 3 and 512),
  is_prefix boolean not null default false,
  ops text[] not null check (ops <@ array['read', 'write', 'delete']::text[] and cardinality(ops) between 1 and 3),
  expires_at timestamptz not null
);
create index if not exists grovshot_storage_grants_lookup_idx on public.grovshot_storage_grants (bucket, name);
create index if not exists grovshot_storage_grants_expiry_idx on public.grovshot_storage_grants (expires_at);
alter table public.grovshot_storage_grants enable row level security;
-- No policy: only the functions below read or write it.
revoke all on public.grovshot_storage_grants from anon, authenticated;

/*
  ARM storage objects for THIS order, for three minutes:
    product-images     read only, and only the order's own photo paths;
    generation-assets  a job folder of this order (<workspace>/<job>/…), or
                       an admin test's folder (<workspace>/gsv2-test/<run>/…).
  A name is an exact object, or (p_prefix) a folder ending with "/".
*/
create or replace function public.grovshot_srv_storage_grant(
  p_token text, p_run_id uuid, p_owner text, p_bucket text, p_names text[], p_prefix boolean, p_ops text[]
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_run public.ai_engine_runs;
  v_name text;
  v_parts text[];
  v_n integer := 0;
begin
  v_run := public.grovshot_srv_scope(p_token, p_run_id, p_owner);
  if p_names is null or cardinality(p_names) not between 1 and 20 then raise exception 'invalid_input'; end if;
  if p_ops is null or cardinality(p_ops) = 0 or not (p_ops <@ array['read', 'write', 'delete']::text[]) then raise exception 'invalid_input'; end if;
  delete from public.grovshot_storage_grants where expires_at < now() - interval '10 minutes';
  foreach v_name in array p_names loop
    if v_name is null or v_name ~ '\.\.' or char_length(v_name) not between 3 and 512 then raise exception 'invalid_path'; end if;
    if p_bucket = 'product-images' then
      if coalesce(p_prefix, false) or p_ops <> array['read']::text[]
         or not (coalesce(v_run.input->'photos', '[]'::jsonb) ? v_name) then raise exception 'invalid_path'; end if;
    elsif p_bucket = 'generation-assets' then
      v_parts := string_to_array(v_name, '/');
      if v_parts[1] is distinct from v_run.workspace_id::text then raise exception 'invalid_path'; end if;
      if v_parts[2] = 'gsv2-test' then
        if v_run.run_kind <> 'grovshot_test' or v_parts[3] is distinct from v_run.id::text then raise exception 'invalid_path'; end if;
      elsif v_run.run_kind <> 'grovshot' or v_parts[2] !~ '^[0-9a-f-]{36}$' or not exists (
              select 1 from public.generation_jobs j where j.id = v_parts[2]::uuid and j.workspace_id = v_run.workspace_id
                 and j.settings->>'run_id' = v_run.id::text) then
        raise exception 'invalid_path';
      end if;
      if coalesce(p_prefix, false) and right(v_name, 1) <> '/' then raise exception 'invalid_path'; end if;
    else
      raise exception 'invalid_bucket';
    end if;
    insert into public.grovshot_storage_grants (run_id, bucket, name, is_prefix, ops, expires_at)
    values (v_run.id, p_bucket, v_name, coalesce(p_prefix, false), p_ops, now() + interval '3 minutes');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- What the storage policies ask: an armed object of an order whose lease is live.
create or replace function public.grovshot_storage_ok(p_bucket text, p_name text, p_op text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.grovshot_storage_grants g
      join public.ai_engine_runs r on r.id = g.run_id
     where g.bucket = p_bucket and p_op = any (g.ops) and g.expires_at > now()
       and (g.name = p_name or (g.is_prefix and left(p_name, char_length(g.name)) = g.name))
       and r.status in ('queued', 'running') and r.locked_until > now());
$$;
revoke all on function public.grovshot_storage_ok(text, text, text) from public;
grant execute on function public.grovshot_storage_ok(text, text, text) to anon;

drop policy if exists grovshot_worker_photos_read on storage.objects;
create policy grovshot_worker_photos_read on storage.objects for select to anon
  using (bucket_id = 'product-images' and public.grovshot_storage_ok(bucket_id, name, 'read'));
drop policy if exists grovshot_worker_assets_read on storage.objects;
create policy grovshot_worker_assets_read on storage.objects for select to anon
  using (bucket_id = 'generation-assets' and public.grovshot_storage_ok(bucket_id, name, 'read'));
drop policy if exists grovshot_worker_assets_insert on storage.objects;
create policy grovshot_worker_assets_insert on storage.objects for insert to anon
  with check (bucket_id = 'generation-assets' and public.grovshot_storage_ok(bucket_id, name, 'write'));
drop policy if exists grovshot_worker_assets_update on storage.objects;
create policy grovshot_worker_assets_update on storage.objects for update to anon
  using (bucket_id = 'generation-assets' and public.grovshot_storage_ok(bucket_id, name, 'write'))
  with check (bucket_id = 'generation-assets' and public.grovshot_storage_ok(bucket_id, name, 'write'));
drop policy if exists grovshot_worker_assets_delete on storage.objects;
create policy grovshot_worker_assets_delete on storage.objects for delete to anon
  using (bucket_id = 'generation-assets' and public.grovshot_storage_ok(bucket_id, name, 'delete'));

-- 4 ─────────────────────────────────────────────────────────────────────────
-- Already refusing without the server token (0129, 0077); only the grants change.
grant execute on function public.ai_engine_run_read(text, uuid) to anon;
grant execute on function public.ai_engine_step_runs_read(text, uuid) to anon;
grant execute on function public.ai_engine_run_claim(text, uuid, text, integer) to anon;
grant execute on function public.ai_engine_run_patch(text, uuid, text, jsonb) to anon;
grant execute on function public.ai_engine_step_begin(text, uuid, text, integer, integer, text, text, integer) to anon;
grant execute on function public.ai_engine_step_finish(text, uuid, text, integer, integer, jsonb) to anon;
grant execute on function public.provider_health_set(text, text, text, integer, text) to anon;
-- The image router reads provider cooldowns; the server's own request only.
drop policy if exists provider_health_server_select on public.provider_health;
create policy provider_health_server_select on public.provider_health for select to anon
  using ((select public.server_request_ok()));

-- The worker functions: callable by the anonymous role; each refuses without
-- the server token and the order's live lease (grovshot_srv_scope).
revoke all on function public.grovshot_srv_context(text, uuid, text) from public;
revoke all on function public.grovshot_srv_analysis(text, uuid, text) from public;
revoke all on function public.grovshot_srv_mirror(text, uuid, text, jsonb, jsonb) from public;
revoke all on function public.grovshot_srv_job_create(text, uuid, text, jsonb) from public;
revoke all on function public.grovshot_srv_job_update(text, uuid, text, uuid, text, text, integer, jsonb) from public;
revoke all on function public.grovshot_srv_jobs(text, uuid, text, integer) from public;
revoke all on function public.grovshot_srv_library_add(text, uuid, text, uuid, text, integer, integer, text, numeric, integer) from public;
revoke all on function public.grovshot_srv_library_rows(text, uuid, text, uuid) from public;
revoke all on function public.grovshot_srv_library_remove(text, uuid, text, uuid) from public;
revoke all on function public.grovshot_srv_concept_done(text, uuid, text, uuid, uuid) from public;
revoke all on function public.grovshot_srv_usage_start(text, uuid, text, uuid, uuid, text, text, text, jsonb) from public;
revoke all on function public.grovshot_srv_usage_complete(text, uuid, text, uuid, bigint, text, text) from public;
revoke all on function public.grovshot_srv_usage_fail(text, uuid, text, uuid, text, bigint) from public;
revoke all on function public.grovshot_srv_event(text, uuid, text, uuid, text) from public;
revoke all on function public.grovshot_srv_derivatives(text, uuid, text, uuid, text, text) from public;
revoke all on function public.grovshot_srv_log(text, uuid, text, text, text, uuid, jsonb) from public;
revoke all on function public.grovshot_srv_notify(text, uuid, text, text, jsonb, text) from public;
revoke all on function public.grovshot_srv_storage_grant(text, uuid, text, text, text[], boolean, text[]) from public;
grant execute on function public.grovshot_srv_context(text, uuid, text) to anon;
grant execute on function public.grovshot_srv_analysis(text, uuid, text) to anon;
grant execute on function public.grovshot_srv_mirror(text, uuid, text, jsonb, jsonb) to anon;
grant execute on function public.grovshot_srv_job_create(text, uuid, text, jsonb) to anon;
grant execute on function public.grovshot_srv_job_update(text, uuid, text, uuid, text, text, integer, jsonb) to anon;
grant execute on function public.grovshot_srv_jobs(text, uuid, text, integer) to anon;
grant execute on function public.grovshot_srv_library_add(text, uuid, text, uuid, text, integer, integer, text, numeric, integer) to anon;
grant execute on function public.grovshot_srv_library_rows(text, uuid, text, uuid) to anon;
grant execute on function public.grovshot_srv_library_remove(text, uuid, text, uuid) to anon;
grant execute on function public.grovshot_srv_concept_done(text, uuid, text, uuid, uuid) to anon;
grant execute on function public.grovshot_srv_usage_start(text, uuid, text, uuid, uuid, text, text, text, jsonb) to anon;
grant execute on function public.grovshot_srv_usage_complete(text, uuid, text, uuid, bigint, text, text) to anon;
grant execute on function public.grovshot_srv_usage_fail(text, uuid, text, uuid, text, bigint) to anon;
grant execute on function public.grovshot_srv_event(text, uuid, text, uuid, text) to anon;
grant execute on function public.grovshot_srv_derivatives(text, uuid, text, uuid, text, text) to anon;
grant execute on function public.grovshot_srv_log(text, uuid, text, text, text, uuid, jsonb) to anon;
grant execute on function public.grovshot_srv_notify(text, uuid, text, text, jsonb, text) to anon;
grant execute on function public.grovshot_srv_storage_grant(text, uuid, text, text, text[], boolean, text[]) to anon;

-- 5 ─────────────────────────────────────────────────────────────────────────
create index if not exists ai_engine_runs_grovshot_open_idx on public.ai_engine_runs (created_at)
  where run_kind in ('grovshot', 'grovshot_test') and status in ('queued', 'running');

-- Orders waiting for a driver (nobody holds their lease), oldest first.
create or replace function public.grovshot_srv_due(p_token text, p_limit integer)
returns table (id uuid, user_id uuid, workspace_id uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  return query
    select r.id, r.user_id, r.workspace_id from public.ai_engine_runs r
     where r.run_kind in ('grovshot', 'grovshot_test') and r.status in ('queued', 'running')
       and (r.locked_until is null or r.locked_until < now())
       and r.created_at > now() - interval '24 hours'
       and r.user_id is not null and r.workspace_id is not null
     order by coalesce(r.locked_until, r.created_at)
     limit least(greatest(coalesce(p_limit, 1), 1), 5);
end $$;
revoke all on function public.grovshot_srv_due(text, integer) from public;
grant execute on function public.grovshot_srv_due(text, integer) to anon;

-- The minute tick: wakes the worker only while an order waits for a driver.
create or replace function public.grovshot_worker_tick()
returns text
language plpgsql security definer set search_path = public, vault, extensions as $$
declare
  v_url text;
  v_origin text;
  v_token text;
  v_fn text;
  v_request bigint;
begin
  if not exists (
    select 1 from public.ai_engine_runs r
     where r.run_kind in ('grovshot', 'grovshot_test') and r.status in ('queued', 'running')
       and (r.locked_until is null or r.locked_until < now()) and r.created_at > now() - interval '24 hours') then
    return 'idle';
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'grovbase.newsletter.worker_url';
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'grovbase.newsletter.worker_token';
  v_origin := substring(btrim(coalesce(v_url, '')) from '^(https://[^/]+)');
  if v_origin is null or v_token is null or btrim(v_token) = '' then return 'not_configured'; end if;
  select n.nspname || '.' || p.proname into v_fn
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.proname = 'http_post' and n.nspname in ('net', 'extensions', 'public')
   order by case n.nspname when 'net' then 0 when 'extensions' then 1 else 2 end
   limit 1;
  if v_fn is null then return 'no_pg_net'; end if;
  execute format('select %s(url := $1, headers := $2, body := $3, timeout_milliseconds := $4)', v_fn)
  into v_request
  using v_origin || '/api/grovshot/worker',
        jsonb_build_object('Content-Type', 'application/json', 'x-grovshot-token', btrim(v_token)),
        '{}'::jsonb,
        5000;
  return 'posted:' || coalesce(v_request::text, 'unknown');
end $$;
revoke all on function public.grovshot_worker_tick() from public, anon, authenticated;

-- 6 ─────────────────────────────────────────────────────────────────────────
-- Anthropic list prices (USD micros per million tokens; cache reads where
-- Anthropic publishes them). Existing rows are left as an admin set them.
insert into public.ai_token_prices (provider_slug, model, input_usd_micros_per_mtok, output_usd_micros_per_mtok, cached_input_usd_micros_per_mtok)
values
  ('anthropic', 'claude-opus-5-5', 4000000, 20000000, 200000),
  ('anthropic', 'claude-sonnet-5-5', 2000000, 10000000, 200000),
  ('anthropic', 'claude-haiku-5-5', 100000, 500000, null),
  ('anthropic', 'claude-fable-5-1', 10000000, 50000000, 250000)
on conflict (provider_slug, model) do nothing;

-- The minute schedule (idempotent; a project without pg_cron is told so).
do $$
declare
  v_name constant text := 'grovbase-grovshot-worker';
  v_existing integer;
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise notice 'grovshot worker: pg_cron is not installed; orders then move only while a page or the start request drives them.';
    return;
  end if;
  execute 'select count(*) from cron.job where jobname = $1' into v_existing using v_name;
  if v_existing > 0 then
    execute 'select cron.unschedule($1)' using v_name;
  end if;
  execute 'select cron.schedule($1, $2, $3)' using v_name, '* * * * *', 'select public.grovshot_worker_tick();';
exception when others then
  raise notice 'grovshot worker: the job could not be scheduled (%).', sqlerrm;
end $$;
