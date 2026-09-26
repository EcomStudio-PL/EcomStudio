-- API / PROVIDERS / REAL COST ECONOMICS — the existing AI stack, measured.
--
-- Nothing here creates a second provider table, a second key store or a second
-- ledger. The customer-facing ledger stays usage_events + credit_transactions,
-- untouched. What was missing is a record of the PROVIDER side of each paid
-- call — which provider and model answered, how many requests it took, the
-- tokens or images it billed, how long it ran — including the calls no
-- customer pays for directly (GrovNews, the product analysis, embeddings), which
-- usage_events cannot hold: its workspace is NOT NULL and its start function is
-- pinned to auth.uid().
--
--   1. ai_provider_credentials  + the connection test's latency, and the last
--                               successful / failed REAL request (kept current
--                               by the recorder below, not by the panel)
--   2. ai_provider_calls        one row per provider request batch; admin-read,
--                               written only through a token-gated function.
--                               Links to usage_events when a customer paid.
--   3. ai_token_prices          the price list used to ESTIMATE the cost of a
--                               token-billed call. Admin-only (app_settings is
--                               readable by every client, cost data is not).
--   4. cms_slug_is_reserved     + 'profile' (the /profile route now exists)
--
-- COST HONESTY. None of the connected providers returns a price. Tokens and
-- images are what the provider REPORTED; the money is usage × our price list
-- and is stored as cost_basis = 'estimated'. 'actual' is reserved for a
-- provider that returns a billed amount; 'unknown' means no price is known and
-- the cost column is NULL — never a guessed zero.
--
-- ZERO BEHAVIOUR CHANGE ON DEPLOY: new columns are nullable, new tables start
-- empty, no existing function changes signature.

/* ── 1. ai_provider_credentials ───────────────────────────────────────────*/

alter table public.ai_provider_credentials
  add column if not exists last_test_latency_ms integer,
  add column if not exists last_success_at timestamptz,
  add column if not exists last_error_at timestamptz,
  add column if not exists last_error_code text;

alter table public.ai_provider_credentials drop constraint if exists ai_provider_credentials_latency_check;
alter table public.ai_provider_credentials add constraint ai_provider_credentials_latency_check
  check (last_test_latency_ms is null or last_test_latency_ms between 0 and 600000);
alter table public.ai_provider_credentials drop constraint if exists ai_provider_credentials_error_code_check;
alter table public.ai_provider_credentials add constraint ai_provider_credentials_error_code_check
  check (last_error_code is null or last_error_code ~ '^[a-z0-9_:.\-]{1,80}$');

/* ── 2. ai_provider_calls ─────────────────────────────────────────────────*/

create table if not exists public.ai_provider_calls (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- WHO. A customer run, a system job with no customer (GrovNews), or an
  -- admin action (a provider test that really generates).
  actor_kind text not null check (actor_kind in ('customer', 'system', 'admin')),
  user_id uuid references public.profiles(id) on delete set null,
  workspace_id uuid references public.workspaces(id) on delete set null,
  -- WHAT asked for it: the subsystem, and the tool when there is one.
  consumer text not null check (consumer in (
    'generation', 'image_tool', 'prompt_engine', 'workflow', 'embeddings',
    'grovnews', 'provider_test'
  )),
  tool_key text check (tool_key is null or tool_key ~ '^[a-z0-9_]{2,64}$'),
  -- WHICH RUN. The customer charge (when there is one), the generation job,
  -- or another run id (a GrovNews daily run, a prompt session).
  usage_event_id uuid references public.usage_events(id) on delete set null,
  job_id uuid references public.generation_jobs(id) on delete set null,
  run_ref text check (run_ref is null or run_ref ~ '^[A-Za-z0-9_:.\-]{1,80}$'),
  -- WHICH API.
  provider_slug text not null check (provider_slug ~ '^[a-z0-9_\-]{2,40}$'),
  model text check (model is null or char_length(model) between 1 and 120),
  status text not null check (status in ('succeeded', 'failed')),
  error_code text check (error_code is null or error_code ~ '^[a-z0-9_:.\-]{1,80}$'),
  -- HOW MUCH, in the units the provider bills. Tokens only when the provider
  -- reported them — never invented for an image API.
  request_count integer not null default 1 check (request_count between 0 and 1000),
  input_tokens bigint check (input_tokens is null or input_tokens >= 0),
  output_tokens bigint check (output_tokens is null or output_tokens >= 0),
  units numeric(14, 3) check (units is null or units >= 0),
  unit_kind text check (unit_kind is null or unit_kind in ('image', 'second', 'request', 'page')),
  cost_usd_micros bigint check (cost_usd_micros is null or cost_usd_micros >= 0),
  cost_basis text not null check (cost_basis in ('actual', 'estimated', 'unknown')),
  currency text not null default 'USD' check (currency = 'USD'),
  duration_ms integer check (duration_ms is null or duration_ms between 0 and 3600000),
  constraint ai_provider_calls_cost_known check ((cost_basis = 'unknown') = (cost_usd_micros is null)),
  constraint ai_provider_calls_units_kind check ((units is null) = (unit_kind is null))
);

create index if not exists ai_provider_calls_created_idx on public.ai_provider_calls (created_at desc);
create index if not exists ai_provider_calls_tool_idx on public.ai_provider_calls (tool_key, created_at desc) where tool_key is not null;
create index if not exists ai_provider_calls_provider_idx on public.ai_provider_calls (provider_slug, created_at desc);
create index if not exists ai_provider_calls_consumer_idx on public.ai_provider_calls (consumer, created_at desc);
create index if not exists ai_provider_calls_usage_idx on public.ai_provider_calls (usage_event_id) where usage_event_id is not null;
create index if not exists ai_provider_calls_run_idx on public.ai_provider_calls (run_ref) where run_ref is not null;

alter table public.ai_provider_calls enable row level security;
drop policy if exists ai_provider_calls_admin_read on public.ai_provider_calls;
create policy ai_provider_calls_admin_read on public.ai_provider_calls
  for select to authenticated using (public.is_admin());
revoke all on public.ai_provider_calls from anon, authenticated;
grant select on public.ai_provider_calls to authenticated;

comment on table public.ai_provider_calls is
  'Provider side of every paid AI/API call: provider, model, requests, reported tokens/units, estimated or actual cost. Admin read only; written only by ai_provider_call_record (server token). usage_events stays the customer ledger.';

/*
  THE ONLY WRITER. Server token required (the same proof-of-server every
  unattended path uses). Up to 50 rows per call. Every field is re-validated
  here; a malformed row is skipped rather than failing the whole batch, because
  losing the telemetry of nine good calls over one bad one helps nobody.

  It also keeps ai_provider_credentials.last_success_at / last_error_at current
  from REAL traffic, so the panel's "last successful request" is a fact about
  production and not about the last time someone pressed Test.
*/
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
      v_cost := case when v_basis = 'unknown' then null
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
        units, unit_kind, cost_usd_micros, cost_basis, duration_ms
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
        v_units, v_kind, v_cost, v_basis,
        least(3600000, greatest(0, nullif(v_row->>'duration_ms', '')::integer))
      );
      v_count := v_count + 1;

      -- The provider's live status comes from production traffic. A provider
      -- test is an admin probe and updates its own columns instead.
      if coalesce(v_row->>'consumer', '') <> 'provider_test' then
        if v_status = 'succeeded' then
          update public.ai_provider_credentials c
             set last_success_at = now()
            from public.ai_providers p
           where p.id = c.provider_id and p.slug = v_provider;
        else
          update public.ai_provider_credentials c
             set last_error_at = now(), last_error_code = v_error
            from public.ai_providers p
           where p.id = c.provider_id and p.slug = v_provider;
        end if;
      end if;
    exception when others then
      -- One malformed row (bad uuid, unknown consumer, a foreign key that no
      -- longer exists) is dropped; the rest of the batch is kept.
      null;
    end;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.ai_provider_call_record(text, jsonb) from public;
-- anon too: GrovNews and the other unattended jobs run without a session and
-- prove themselves with the token, exactly like every other server-only RPC.
grant execute on function public.ai_provider_call_record(text, jsonb) to anon, authenticated;

/* ── 3. ai_token_prices ───────────────────────────────────────────────────*/

create table if not exists public.ai_token_prices (
  provider_slug text not null check (provider_slug ~ '^[a-z0-9_\-]{2,40}$'),
  model text not null check (char_length(model) between 1 and 120),
  -- USD micros per ONE MILLION tokens (so $0.15 / 1M = 150000).
  input_usd_micros_per_mtok bigint not null check (input_usd_micros_per_mtok between 0 and 1000000000),
  output_usd_micros_per_mtok bigint not null check (output_usd_micros_per_mtok between 0 and 1000000000),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  primary key (provider_slug, model)
);

alter table public.ai_token_prices enable row level security;
drop policy if exists ai_token_prices_admin on public.ai_token_prices;
create policy ai_token_prices_admin on public.ai_token_prices
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.ai_token_prices from anon, authenticated;
grant select, insert, update, delete on public.ai_token_prices to authenticated;

-- The recorder runs without an admin session, so it reads prices through a
-- token-gated door rather than a looser policy.
create or replace function public.ai_token_prices_read(p_token text)
returns table (provider_slug text, model text, input_usd_micros_per_mtok bigint, output_usd_micros_per_mtok bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.server_call_ok(p_token)) then raise exception 'forbidden'; end if;
  return query select t.provider_slug, t.model, t.input_usd_micros_per_mtok, t.output_usd_micros_per_mtok
                 from public.ai_token_prices t;
end;
$$;
revoke all on function public.ai_token_prices_read(text) from public;
grant execute on function public.ai_token_prices_read(text) to anon, authenticated;

comment on table public.ai_token_prices is
  'Admin-entered provider list prices per 1M tokens, used only to ESTIMATE the cost of token-billed calls. Absent price = cost unknown, never zero.';

/* ── 4. /profile is an application route now ──────────────────────────────*/

do $$
declare v_def text;
begin
  select pg_get_functiondef('public.cms_slug_is_reserved(text)'::regprocedure) into v_def;
  if v_def is not null and position('''profile''' in v_def) = 0 then
    -- Rebuilt from the live definition so every slug reserved so far stays
    -- reserved; only 'profile' is added to the list.
    execute replace(v_def, '''settings''', '''settings'', ''profile''');
  end if;
end $$;

-- ROLLBACK:
--   drop function if exists public.ai_token_prices_read(text);
--   drop table if exists public.ai_token_prices;
--   drop function if exists public.ai_provider_call_record(text, jsonb);
--   drop table if exists public.ai_provider_calls;
--   alter table public.ai_provider_credentials drop column if exists last_test_latency_ms,
--     drop column if exists last_success_at, drop column if exists last_error_at,
--     drop column if exists last_error_code;
