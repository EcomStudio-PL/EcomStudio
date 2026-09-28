-- RETUSZ NETWORK-BOUNDARY CAPTURE — admin-only record of the request as sent.
--
-- The Google adapter reads back the exact JSON string it hands to fetch
-- (lib/ai/providers/google-boundary.ts) and the engine records it, together
-- with the published → resolved → provider prompt chain in plain SHA-256, on
-- the tool's engine-run row. ai_engine_runs is readable by admins only
-- (ai_engine_runs_admin_read); the customer-readable job row keeps its keyed
-- digests. The capture holds no API key (URL without its query), no prompt
-- text (length + SHA-256) and no image bytes (SHA-256 + size).
--
-- Additive: one nullable column; the RPC is the 0126 body plus that column
-- (an object of at most 64 KiB, anything else is stored as null).

alter table public.ai_engine_runs add column if not exists network_boundary jsonb;

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
    steps, knowledge_example_ids, scene_example_id, credits, api_cost_usd_micros, duration_ms,
    network_boundary
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
    nullif(p_run->>'duration_ms', '')::integer,
    case when jsonb_typeof(p_run->'network_boundary') = 'object'
          and octet_length((p_run->'network_boundary')::text) <= 65536
         then p_run->'network_boundary' end
  ) returning id into v_id;

  -- Usage is counted only for runs that produced something.
  if p_run->>'status' = 'ok' and array_length(v_examples, 1) > 0 then
    update public.knowledge_examples set usage_count = usage_count + 1 where id = any(v_examples);
  end if;
  return v_id;
end $$;
revoke all on function public.ai_engine_run_record(text, jsonb) from public, anon;
grant execute on function public.ai_engine_run_record(text, jsonb) to authenticated;
