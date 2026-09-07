-- AI CONTROL CENTER — the four things the AI stack genuinely lacked.
--
-- GrovBase already has providers (ai_providers), API keys
-- (ai_provider_credentials), models (ai_models), prices (service_catalog),
-- per-request economics (usage_events), provider health (provider_health),
-- module status (feature_availability) and reference knowledge
-- (knowledge_sets). None of that is re-created here.
--
-- What did not exist is the JOIN between them: nothing said "Retusz runs on
-- this model, with this hidden prompt, billing this service". That fact lived
-- in three source files and two tables, and could only be changed by editing
-- code. These tables hold exactly that, and nothing that already has a home.
--
-- Identity comes from the feature registry (lib/features.ts): `tool_key` is a
-- FeatureKey, so the route, the display name and the ACTIVE / COMING_SOON /
-- MAINTENANCE / DISABLED status keep coming from the availability system that
-- the menu and the route guards already read. There is no second visibility
-- switch here on purpose.

/* ── the tool ─────────────────────────────────────────────────────────────*/

create table if not exists public.ai_tools (
  -- A key from lib/features.ts FEATURE_KEYS. Not a foreign key: the registry
  -- is code, and a tool removed from the code should leave a harmless orphan
  -- row rather than break a delete.
  tool_key text primary key,
  -- Which service_catalog row bills this tool. Null for tools that cost the
  -- customer nothing.
  service_slug text,
  /*
    ENGINE MODE — where the words come from.

      off       no hidden prompt at all. Compression, resize and watermark are
                deterministic pixel work; there is nothing to prompt.
      grovbase  a hidden GrovBase system prompt only. The customer writes
                nothing (Retusz, the shot planner).
      user      the customer's prompt only.
      hybrid    hidden system prompt + the customer's input.

    A tool may sit at 'off' with no model and no prompt and be given an engine
    later — that is the point of the column. Shipping a new front-end tool
    must not require a schema change to make it intelligent afterwards.
  */
  engine_mode text not null default 'off'
    check (engine_mode in ('off', 'grovbase', 'user', 'hybrid')),
  -- May the customer choose the model? When false the tool always runs its
  -- primary (and, on failure, its fallback).
  allow_model_choice boolean not null default false,
  fallback_enabled boolean not null default false,
  timeout_ms integer not null default 120000 check (timeout_ms between 5000 and 600000),
  -- Attempts against the PRIMARY model. Capped at the router's own ceiling:
  -- an aggressive retry policy is a way to pay a provider twice for one image.
  max_attempts smallint not null default 1 check (max_attempts between 1 and 3),
  notes text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

comment on table public.ai_tools is
  'AI configuration per customer-facing tool. Identity/status live in the feature registry; credits live in service_catalog.';

/* ── model assignment ─────────────────────────────────────────────────────*/

create table if not exists public.ai_tool_models (
  tool_key text not null references public.ai_tools(tool_key) on delete cascade,
  model_id uuid not null references public.ai_models(id) on delete cascade,
  -- primary  — what the tool runs on
  -- fallback — one extra attempt when the primary is unusable
  -- allowed  — offered to the customer when allow_model_choice is on
  role text not null check (role in ('primary', 'fallback', 'allowed')),
  sort_order integer not null default 0,
  primary key (tool_key, model_id)
);

-- One primary and one fallback per tool: "which model does this run on" must
-- have exactly one answer.
create unique index if not exists ai_tool_models_one_primary
  on public.ai_tool_models (tool_key) where role = 'primary';
create unique index if not exists ai_tool_models_one_fallback
  on public.ai_tool_models (tool_key) where role = 'fallback';

/* ── prompt versions ──────────────────────────────────────────────────────*/

-- Hidden prompts are GrovBase IP. The body is encrypted with the same
-- APP_ENCRYPTION_KEY as every other secret, is never selected by a
-- client-reachable policy, and reaches the runtime only through the
-- token-guarded function at the bottom of this file.
--
-- Publishing never overwrites: it inserts a new version and supersedes the
-- previous one, so "restore the version from Tuesday" is always possible.
create table if not exists public.ai_tool_prompts (
  id uuid primary key default gen_random_uuid(),
  tool_key text not null references public.ai_tools(tool_key) on delete cascade,
  version integer not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'superseded')),
  body_encrypted text not null,
  body_iv text not null,
  body_tag text not null,
  -- An admin-facing one-liner about the body. Safe to show in a list; the
  -- body itself is not.
  summary text,
  -- Why this version exists. Required by the publish action.
  reason text,
  -- 'knowledge' marks a candidate proposed from imported reference material.
  -- It still has to be published by a person — uploaded files are data, never
  -- instructions, and they can never reach production on their own.
  source text not null default 'manual' check (source in ('manual', 'knowledge')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (tool_key, version)
);

create unique index if not exists ai_tool_prompts_one_published
  on public.ai_tool_prompts (tool_key) where status = 'published';
create index if not exists ai_tool_prompts_tool_idx
  on public.ai_tool_prompts (tool_key, version desc);

/* ── knowledge assignment ─────────────────────────────────────────────────*/

create table if not exists public.ai_tool_knowledge (
  tool_key text not null references public.ai_tools(tool_key) on delete cascade,
  set_id uuid not null references public.knowledge_sets(id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (tool_key, set_id)
);

comment on table public.ai_tool_knowledge is
  'Which reference sets a tool may draw on. The files are not duplicated — one set can serve several tools.';

/* ── provider budgets and alert thresholds ────────────────────────────────*/

-- Health (provider_health) answers "is it responding". This answers "are we
-- about to run out of money on it". Nothing here invents a provider balance:
-- these are OUR budgets, measured against OUR recorded spend in usage_events,
-- which is a number we can stand behind for every provider.
create table if not exists public.ai_provider_budgets (
  provider_id uuid primary key references public.ai_providers(id) on delete cascade,
  monthly_budget_usd_micros bigint check (monthly_budget_usd_micros is null or monthly_budget_usd_micros > 0),
  warn_percent smallint not null default 75 check (warn_percent between 1 and 100),
  critical_percent smallint not null default 90 check (critical_percent between 1 and 100),
  -- A single request costing more than this is an anomaly worth a message.
  max_request_usd_micros bigint check (max_request_usd_micros is null or max_request_usd_micros > 0),
  -- Failure rate over the last 24h, in percent, that counts as a spike.
  failure_rate_percent smallint check (failure_rate_percent is null or failure_rate_percent between 1 and 100),
  alerts_enabled boolean not null default true,
  -- Set when an alert is sent so the same threshold is not re-announced hourly.
  last_alert_level text check (last_alert_level is null or last_alert_level in ('warn', 'critical')),
  last_alert_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

/* ── RLS: admin only, no exceptions ───────────────────────────────────────*/

alter table public.ai_tools enable row level security;
alter table public.ai_tool_models enable row level security;
alter table public.ai_tool_prompts enable row level security;
alter table public.ai_tool_knowledge enable row level security;
alter table public.ai_provider_budgets enable row level security;

do $$
declare t text;
begin
  foreach t in array array['ai_tools', 'ai_tool_models', 'ai_tool_prompts', 'ai_tool_knowledge', 'ai_provider_budgets']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    -- One policy, all commands: these tables are the admin panel's own data.
    -- The customer runtime never reads them directly — it goes through
    -- ai_tool_runtime() below, which is SECURITY DEFINER and token-guarded.
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()))',
      t || '_admin', t);
  end loop;
end $$;

/* ── the runtime read ─────────────────────────────────────────────────────*/

-- The generation path needs the engine mode, the model and the hidden prompt
-- while running as the CUSTOMER. It must not be able to read the prompt on its
-- own behalf, so this uses the dispatch-token pattern already proven by the
-- notification outbox: the server derives a token from a key only it holds and
-- the database compares sha256(token) with the published hash. Holding the
-- anon key — which every browser has — is not enough.
create or replace function public.ai_tool_runtime(p_tool_key text, p_token text)
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
  prompt_version integer
)
-- `search_path` includes extensions so digest() resolves whether pgcrypto
-- lives in public or in extensions — the same note 0052 carries.
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
    p.body_encrypted, p.body_iv, p.body_tag, p.version
  from public.ai_tools t
  left join public.ai_tool_prompts p
    on p.tool_key = t.tool_key and p.status = 'published'
  where t.tool_key = p_tool_key;
end;
$$;

revoke execute on function public.ai_tool_runtime(text, text) from anon, public;

/* ── seed: what the code does TODAY, written down ─────────────────────────*/

-- These rows describe the behaviour already shipping, so the new screens open
-- showing the truth rather than an empty registry. Nothing here changes how a
-- single request runs.
insert into public.ai_tools (tool_key, service_slug, engine_mode, allow_model_choice, notes) values
  -- The shot planner writes every word; the customer supplies photos and a brief.
  ('prompts',        'prompt_generation', 'grovbase', false, 'GrovShot — planner + shot engine'),
  -- The customer's prompt, plus the platform's Product Lock contract.
  ('generator',      'image_generation',  'hybrid',   true,  'Własny prompt + Product Lock'),
  -- GrovBase writes the whole retouch prompt; the customer writes nothing.
  ('retouch',        'image_edit',        'grovbase', false, 'Retusz zdjęć'),
  -- Deterministic pixel work in our own runtime: nothing to prompt.
  ('editor',         'tool_editor',       'off',      false, 'sharp pipeline'),
  ('resize',         'tool_format',       'off',      false, 'sharp pipeline'),
  ('compress',       'tool_compress',     'off',      false, 'sharp pipeline'),
  ('tool_watermark', 'tool_watermark',    'off',      false, 'sharp pipeline'),
  -- Paid provider calls, but parameter-driven rather than prompt-driven.
  ('tool_upscale',   'tool_upscale',      'off',      false, 'provider super-resolution'),
  ('tool_expand',    'tool_expand',       'off',      false, 'provider outpainting'),
  ('video',          'video_generation',  'off',      false, 'no engine yet')
on conflict (tool_key) do nothing;

-- Retusz is the one tool that hard-codes its model in source
-- (lib/server/retouch.ts, by API identifier). Recording it here is what lets
-- an operator see and change it without a deploy.
insert into public.ai_tool_models (tool_key, model_id, role)
select 'retouch', m.id, 'primary'
from public.ai_models m
where m.model_identifier = 'gemini-3-pro-image-preview'
order by m.created_at
limit 1
on conflict (tool_key, model_id) do nothing;
