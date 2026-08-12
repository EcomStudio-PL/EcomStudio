-- Speed + economics, without touching fidelity.
--
-- 1) PRODUCT ANALYSIS CACHE — analysing the same photographs twice costs the
--    user time and costs us provider calls, and the answer is deterministic
--    for a given reference set. Cached by a hash of the reference paths plus
--    the engine version, so any engine change invalidates it automatically.
create table if not exists public.product_analysis_cache (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  reference_hash text not null,
  engine_version int not null,
  image_analysis jsonb not null,
  feature_manifest jsonb not null,
  product_lock jsonb not null,
  analysis_model text,
  hits int not null default 0,
  created_at timestamptz not null default now(),
  unique (workspace_id, reference_hash, engine_version)
);
alter table public.product_analysis_cache enable row level security;
create policy "pac_select" on public.product_analysis_cache for select
  using (public.is_workspace_member(workspace_id) or public.is_admin());
create policy "pac_insert" on public.product_analysis_cache for insert
  with check (public.is_workspace_member(workspace_id));
create policy "pac_update" on public.product_analysis_cache for update
  using (public.is_workspace_member(workspace_id));
create index if not exists idx_pac_lookup
  on public.product_analysis_cache (workspace_id, reference_hash, engine_version);

alter table public.prompt_sessions
  add column if not exists reference_hash text,
  add column if not exists cache_hit boolean not null default false;

-- 2) REAL API COST — usage_events already snapshot the catalog price; the
--    actual provider cost of a specific call belongs next to it so admin
--    profitability is computed from recorded facts, never from guesses.
alter table public.usage_events
  add column if not exists actual_api_cost_usd_micros bigint not null default 0,
  add column if not exists provider_request_id text;

comment on column public.usage_events.actual_api_cost_usd_micros is
  'Real provider cost of this call in USD micros, derived from the model config at execution time (outputs x per-image cost). Never estimated after the fact.';

create index if not exists idx_usage_events_cost
  on public.usage_events (workspace_id, created_at desc)
  include (actual_api_cost_usd_micros, credits_charged, status);
