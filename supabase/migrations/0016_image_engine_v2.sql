-- IMAGE ENGINE V2: client-facing model catalog (display names, per-resolution
-- pricing — providers stay backend-only), prompt sessions with real image
-- analysis + Product Feature Manifest + Product Lock, richer generated
-- prompts (scene strategy, reference roles, negative prompts), generation
-- feedback loop and extended job telemetry.

-- ============================================================
-- 1. MODEL CATALOG: display identity + per-resolution credit config
--    display_name  = what the CUSTOMER sees (never the provider)
--    model_identifier stays the technical model_key (admin-only)
--    pricing       = {"1K": 2, "2K": 5, "4K": 8} credits per image
-- ============================================================
alter table public.ai_models
  add column if not exists display_name text,
  add column if not exists badge text,
  add column if not exists sort_order int not null default 100,
  add column if not exists pricing jsonb not null default '{}'::jsonb,
  add column if not exists supported_resolutions text[] not null default '{1K}'::text[],
  add column if not exists supports_negative_prompt boolean not null default true,
  add column if not exists max_prompt_length int not null default 6000;

comment on column public.ai_models.display_name is 'Customer-facing model name. Providers are backend infrastructure and are never shown in the client UI.';
comment on column public.ai_models.pricing is 'Per-resolution credit price per image, e.g. {"1K":2,"2K":5,"4K":8}. Falls back to credit_cost when a key is missing.';

-- ============================================================
-- 2. PROMPT SESSIONS: one "Generate 5 prompts" run — inputs, per-image
--    analysis, feature manifest and the structured Product Lock.
-- ============================================================
create table if not exists public.prompt_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  description text,
  extra_info text,
  aspect_ratio text not null default '1:1',
  style text,
  reference_paths text[] not null default '{}'::text[],
  image_analysis jsonb not null default '[]'::jsonb,
  feature_manifest jsonb not null default '{}'::jsonb,
  product_lock jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','analyzing','ready','failed')),
  error text,
  analysis_model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.prompt_sessions enable row level security;
create policy "ps_select" on public.prompt_sessions for select
  using (public.is_workspace_member(workspace_id) or public.is_admin());
create policy "ps_insert" on public.prompt_sessions for insert
  with check (public.is_workspace_member(workspace_id) and user_id = auth.uid());
create policy "ps_update" on public.prompt_sessions for update
  using (public.is_workspace_member(workspace_id));
create policy "ps_delete" on public.prompt_sessions for delete
  using (public.is_workspace_member(workspace_id));
create index if not exists idx_prompt_sessions_ws on public.prompt_sessions (workspace_id, created_at desc);

drop trigger if exists prompt_sessions_touch on public.prompt_sessions;
create trigger prompt_sessions_touch before update on public.prompt_sessions
  for each row execute function public.touch_updated_at();

-- ============================================================
-- 3. GENERATED PROMPTS: scene strategy + reference role data. Each prompt
--    knows its primary/supporting references (by 1-based image number in
--    the session gallery), its negative prompt and its lock strength.
-- ============================================================
alter table public.generated_prompts
  add column if not exists session_id uuid references public.prompt_sessions(id) on delete cascade,
  add column if not exists negative_prompt text,
  add column if not exists scene_type text,
  add column if not exists primary_reference int,
  add column if not exists supporting_references jsonb not null default '[]'::jsonb,
  add column if not exists reference_indices int[] not null default '{}'::int[],
  add column if not exists lock_strength text not null default 'STRONG';
create index if not exists idx_generated_prompts_session on public.generated_prompts (session_id);

-- ============================================================
-- 4. GENERATION FEEDBACK: accept / regenerate + "what was wrong" —
--    stored now, used later to improve the prompt engine.
-- ============================================================
create table if not exists public.generation_feedback (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  generation_job_id uuid not null references public.generation_jobs(id) on delete cascade,
  asset_path text,
  verdict text not null check (verdict in ('accepted','regenerate')),
  issues text[] not null default '{}'::text[],
  comment text,
  created_at timestamptz not null default now()
);
alter table public.generation_feedback enable row level security;
create policy "gf_select" on public.generation_feedback for select
  using (public.is_workspace_member(workspace_id) or public.is_admin());
create policy "gf_insert" on public.generation_feedback for insert
  with check (public.is_workspace_member(workspace_id) and user_id = auth.uid());
create index if not exists idx_generation_feedback_job on public.generation_feedback (generation_job_id);

-- ============================================================
-- 5. GENERATION JOBS: telemetry for history/admin (latency, provider
--    request id, error class) + links back to the prompt session.
-- ============================================================
alter table public.generation_jobs
  add column if not exists prompt_session_id uuid references public.prompt_sessions(id) on delete set null,
  add column if not exists negative_prompt text,
  add column if not exists latency_ms int,
  add column if not exists request_id text,
  add column if not exists error_class text;

-- ============================================================
-- 6. INITIAL MODEL CATALOG CONFIG (spec: editable config, not hardcoded).
--    Existing rows are upgraded in place; new display models are inserted.
--    Providers/model keys stay admin-editable; the client only ever sees
--    display_name + pricing.
-- ============================================================
-- Display models are decoupled from endpoints: two display models may share
-- one technical model key (e.g. GPT Image 2 Medium/High differ only by the
-- quality parameter), so the old uniqueness no longer applies.
alter table public.ai_models drop constraint if exists ai_models_provider_id_model_identifier_key;
create index if not exists idx_ai_models_provider_key on public.ai_models (provider_id, model_identifier);

-- Nano Banana = existing gemini-2.5-flash-image
update public.ai_models set
  display_name = 'Nano Banana',
  sort_order = 10,
  pricing = '{"1K": 2}'::jsonb,
  supported_resolutions = '{1K}'::text[],
  credit_cost = 2
where model_identifier = 'gemini-2.5-flash-image';

-- Nano Banana Pro = gemini-3-pro-image-preview (recommended for product fidelity)
insert into public.ai_models
  (provider_id, model_identifier, name, display_name, type, active, credit_cost,
   quality_tier, speed_tier, max_reference_images, supports_reference_images,
   supported_aspect_ratios, badge, sort_order, pricing, supported_resolutions, capabilities)
select p.id, 'gemini-3-pro-image-preview', 'Nano Banana Pro', 'Nano Banana Pro', 'image', true, 7,
   'premium', 'standard', 6, true,
   '{1:1,4:5,16:9,9:16}'::text[], 'recommended', 20,
   '{"1K": 7, "2K": 7, "4K": 12}'::jsonb, '{1K,2K,4K}'::text[], '{"fidelity":"max"}'::jsonb
from public.ai_providers p where p.slug = 'google'
  and not exists (select 1 from public.ai_models where display_name = 'Nano Banana Pro');

-- Nano Banana 2: same endpoint as Pro today — seeded DISABLED so we never
-- sell two prices for one identical route; admin enables it when a distinct
-- model key exists.
insert into public.ai_models
  (provider_id, model_identifier, name, display_name, type, active, credit_cost,
   quality_tier, speed_tier, max_reference_images, supports_reference_images,
   supported_aspect_ratios, badge, sort_order, pricing, supported_resolutions, metadata)
select p.id, 'gemini-3-pro-image', 'Nano Banana 2', 'Nano Banana 2', 'image', false, 4,
   'high', 'standard', 6, true,
   '{1:1,4:5,16:9,9:16}'::text[], null, 15,
   '{"1K": 4, "2K": 5, "4K": 8}'::jsonb, '{1K,2K,4K}'::text[],
   '{"note":"disabled until this model key is live; edit model key + enable in admin"}'::jsonb
from public.ai_providers p where p.slug = 'google'
  and not exists (select 1 from public.ai_models where display_name = 'Nano Banana 2');

-- GPT Image 2 Medium = existing gpt-image-1 at medium quality
update public.ai_models set
  display_name = 'GPT Image 2 Medium',
  sort_order = 30,
  pricing = '{"1K": 2}'::jsonb,
  supported_resolutions = '{1K}'::text[],
  credit_cost = 2,
  metadata = metadata || '{"quality":"medium"}'::jsonb
where model_identifier = 'gpt-image-1';

-- GPT Image 2 High = gpt-image-1 at high quality
insert into public.ai_models
  (provider_id, model_identifier, name, display_name, type, active, credit_cost,
   quality_tier, speed_tier, max_reference_images, supports_reference_images,
   supported_aspect_ratios, badge, sort_order, pricing, supported_resolutions, metadata)
select p.id, 'gpt-image-1', 'GPT Image 2 High', 'GPT Image 2 High', 'image', true, 8,
   'premium', 'slow', 0, false,
   '{1:1,4:5,16:9,9:16}'::text[], 'high_quality', 40,
   '{"2K": 8, "4K": 20}'::jsonb, '{2K,4K}'::text[], '{"quality":"high"}'::jsonb
from public.ai_providers p where p.slug = 'openai'
  and not exists (select 1 from public.ai_models where display_name = 'GPT Image 2 High');

-- FLUX 1.1 Pro keeps working through fal but gets a display identity too.
update public.ai_models set
  display_name = 'Flux Pro 1.1',
  sort_order = 50,
  pricing = '{"1K": 3, "2K": 4}'::jsonb,
  supported_resolutions = '{1K,2K}'::text[]
where model_identifier = 'flux-pro-1.1';
