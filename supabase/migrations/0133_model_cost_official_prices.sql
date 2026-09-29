-- 0133 — ONE PRICE PER GENERATION, AND THE REAL PROVIDER COST.
--
-- 1. THE "GROVBASE SURCHARGE" IS REMOVED. 0031 seeded
--    ai_models.ecom_surcharge_credits = ceil(ecom_target_pln 10 zł × 100 /
--    price_per_100_credits 19) − credit_cost, i.e. 53 − base for every image
--    model, and the concept path (GrovShot, category workflows, engine
--    retakes) charged base + surcharge: Nano Banana Pro 7 + 46 = 53 credits
--    (12 + 46 = 58 at 4K), ≈ 10 zł. A GrovBase prompt now costs exactly what
--    the model costs. The column stays (a build that still reads it keeps
--    working) but is pinned to 0, so nothing can add it again.
--
-- 2. CUSTOMER PRICE of Nano Banana Pro (credits, from ai_models.pricing):
--    1K 7 · 2K 7 · 4K 12. Separate from what Google costs us.
--
-- 3. PROVIDER COST of Nano Banana Pro (gemini-3-pro-image) = Google's official
--    STANDARD price per output image: 1K $0.134 · 2K $0.134 · 4K $0.24 (image
--    output $120 / 1M tokens; 1120 tokens at 1K/2K, 2000 at 4K). The flat
--    $0.039 seeded by 0022 was the Gemini 2.5 Flash Image price.
--    Input tokens ($2 / 1M) and thinking tokens ($12 / 1M, the text-output
--    rate) are priced ONLY from the usage Google's own response reports — the
--    token row below prices nothing that was not reported.
--
-- 4. ai_provider_calls records the thinking tokens, the size a call was priced
--    at and the per-image base price next to the total, so the admin sees the
--    official base cost and the real per-job cost side by side.
--
-- USD/PLN (billing.usd_to_pln) stays an ANALYTICS rate only: customer prices
-- are credits from ai_models.pricing, never derived from a USD figure.

/* ── 1. no engine surcharge ───────────────────────────────────────────────*/

update public.ai_models set ecom_surcharge_credits = 0 where ecom_surcharge_credits <> 0;
alter table public.ai_models drop constraint if exists ai_models_no_engine_surcharge;
alter table public.ai_models add constraint ai_models_no_engine_surcharge check (ecom_surcharge_credits = 0);
comment on column public.ai_models.ecom_surcharge_credits is
  'Removed in 0133 and pinned to 0: a GrovBase prompt is priced at the model''s own credits.';

-- The target that seeded the surcharge ("~10 zł per engine image").
update public.app_settings set value = value - 'ecom_target_pln'
 where key = 'billing' and value ? 'ecom_target_pln';

/* ── 2. customer price, 3. provider price — Nano Banana Pro ───────────────*/

update public.ai_models
   set pricing = jsonb_build_object('1K', 7, '2K', 7, '4K', 12),
       credit_cost = 7,
       internal_cost_usd_micros = 134000
 where model_identifier = 'gemini-3-pro-image'
   and provider_id = (select id from public.ai_providers where slug = 'google')
   and coalesce(display_name, name) ilike 'Nano Banana Pro%'
   and (pricing is distinct from jsonb_build_object('1K', 7, '2K', 7, '4K', 12)
        or credit_cost <> 7 or internal_cost_usd_micros <> 134000);

insert into public.ai_unit_prices (provider_slug, model, unit_kind, resolution, quality, usd_micros_per_unit)
values ('google', 'gemini-3-pro-image', 'image', '1K', '*', 134000),
       ('google', 'gemini-3-pro-image', 'image', '2K', '*', 134000),
       ('google', 'gemini-3-pro-image', 'image', '4K', '*', 240000)
on conflict (provider_slug, model, unit_kind, resolution, quality)
do update set usd_micros_per_unit = excluded.usd_micros_per_unit, updated_at = now();

-- Input $2 / 1M; output = the TEXT-output rate $12 / 1M, which is what
-- thinking is billed at. Image output is never priced from tokens (the
-- per-image price above is the image), so this row cannot double it.
insert into public.ai_token_prices (provider_slug, model, input_usd_micros_per_mtok, output_usd_micros_per_mtok)
values ('google', 'gemini-3-pro-image', 2000000, 12000000)
on conflict (provider_slug, model)
do update set input_usd_micros_per_mtok = excluded.input_usd_micros_per_mtok,
              output_usd_micros_per_mtok = excluded.output_usd_micros_per_mtok,
              updated_at = now();

/* ── 4. per-call breakdown ────────────────────────────────────────────────*/

alter table public.ai_provider_calls
  add column if not exists thought_tokens bigint check (thought_tokens is null or thought_tokens >= 0),
  add column if not exists base_cost_usd_micros bigint check (base_cost_usd_micros is null or base_cost_usd_micros >= 0),
  add column if not exists resolution text check (resolution is null or resolution ~ '^[0-9]{1,5}[Kkp]?$');

comment on column public.ai_provider_calls.thought_tokens is
  'Thinking tokens the provider reported (a share of output_tokens), priced at the text-output rate.';
comment on column public.ai_provider_calls.base_cost_usd_micros is
  'Image calls: official per-image price × images, without tokens. cost_usd_micros = this + reported input/thinking tokens.';
comment on column public.ai_provider_calls.resolution is
  'Output size the image call was priced at (1K / 2K / 4K).';

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
  v_base bigint;
  v_res text;
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
      -- The per-image base price, recorded next to the total (0133). Unknown
      -- stays NULL, like the total.
      v_base := case when nullif(v_row->>'base_cost_usd_micros', '') is null then null
                     else greatest(0, (v_row->>'base_cost_usd_micros')::bigint) end;
      v_res := case when coalesce(v_row->>'resolution', '') ~ '^[0-9]{1,5}[Kkp]?$' then v_row->>'resolution' else null end;
      v_units := nullif(v_row->>'units', '')::numeric;
      v_kind := nullif(v_row->>'unit_kind', '');
      if v_units is null or v_kind is null then v_units := null; v_kind := null; end if;
      v_error := case when v_status = 'failed'
                      then left(regexp_replace(lower(coalesce(v_row->>'error_code', 'provider_error')), '[^a-z0-9_:.\-]', '_', 'g'), 80)
                      else null end;

      insert into public.ai_provider_calls (
        actor_kind, user_id, workspace_id, consumer, tool_key, usage_event_id, job_id, run_ref,
        provider_slug, model, status, error_code, request_count, input_tokens, output_tokens,
        cached_input_tokens, units, unit_kind, cost_usd_micros, cost_basis, duration_ms,
        thought_tokens, base_cost_usd_micros, resolution
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
        least(3600000, greatest(0, nullif(v_row->>'duration_ms', '')::integer)),
        -- NULL first (greatest(0, NULL) = 0): "not reported" is not "zero".
        case when nullif(v_row->>'thought_tokens', '') is null then null
             else greatest(0, (v_row->>'thought_tokens')::bigint) end,
        v_base, v_res
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
