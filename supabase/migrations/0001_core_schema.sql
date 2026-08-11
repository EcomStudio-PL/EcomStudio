-- EcomStudio core schema
create type public.user_role as enum ('user','admin');
create type public.workspace_role as enum ('owner','admin','editor','viewer','operator');
create type public.product_status as enum ('draft','ready','processing','completed','archived');
create type public.job_status as enum ('queued','processing','completed','failed','cancelled');
create type public.prompt_status as enum ('draft','ready','used','archived');
create type public.quality_status as enum ('pending','passed','warning','failed','skipped');
create type public.credit_tx_type as enum ('subscription','topup','generation','refund','bonus','admin_adjustment');
create type public.asset_type as enum ('image','video','text');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role public.user_role not null default 'user',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  locale text not null default 'pl' check (locale in ('pl','en','de')),
  theme text not null default 'system' check (theme in ('light','dark','system')),
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.workspace_role not null default 'owner',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  description text,
  category text,
  marketplace text,
  status public.product_status not null default 'draft',
  instructions text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index products_workspace_idx on public.products(workspace_id, created_at desc);

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  storage_path text not null,
  sort_order int not null default 0,
  image_type text not null default 'reference',
  is_primary boolean not null default false,
  ai_description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index product_images_product_idx on public.product_images(product_id, sort_order);

create table public.prompt_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  name text not null,
  shot_type text not null,
  template text not null,
  format text not null default '1:1',
  style text,
  priority int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.generated_prompts (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  concept_name text not null,
  shot_type text not null,
  prompt_text text not null,
  reference_image_ids uuid[] not null default '{}',
  reference_rationale text,
  format text not null default '1:1',
  style text,
  priority int not null default 0,
  status public.prompt_status not null default 'draft',
  created_at timestamptz not null default now()
);
create index generated_prompts_product_idx on public.generated_prompts(product_id, priority);

create table public.ai_providers (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  active boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.ai_models (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.ai_providers(id) on delete cascade,
  model_identifier text not null,
  name text not null,
  type text not null default 'image' check (type in ('image','video','text')),
  active boolean not null default false,
  credit_cost int not null default 1,
  estimated_api_cost numeric(10,4) not null default 0,
  capabilities jsonb not null default '{}'::jsonb,
  supported_aspect_ratios text[] not null default '{"1:1","4:5","16:9","9:16"}',
  supports_reference_images boolean not null default true,
  supports_video boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (provider_id, model_identifier)
);

create table public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  model_id uuid references public.ai_models(id) on delete set null,
  prompt_id uuid references public.generated_prompts(id) on delete set null,
  prompt_text text,
  material_type text,
  aspect_ratio text not null default '1:1',
  reference_image_ids uuid[] not null default '{}',
  status public.job_status not null default 'queued',
  error_message text,
  credits_charged int not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index generation_jobs_workspace_idx on public.generation_jobs(workspace_id, created_at desc);

create table public.generations (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.generation_jobs(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_match_score numeric(5,2),
  quality_status public.quality_status not null default 'pending',
  quality_notes text,
  quality_check_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index generations_workspace_idx on public.generations(workspace_id, created_at desc);

create table public.generation_assets (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null references public.generations(id) on delete cascade,
  asset_type public.asset_type not null default 'image',
  storage_path text not null,
  width int,
  height int,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.credit_wallets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.workspaces(id) on delete cascade,
  balance int not null default 0 check (balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.credit_wallets(id) on delete cascade,
  amount int not null,
  type public.credit_tx_type not null,
  description text,
  reference_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index credit_transactions_wallet_idx on public.credit_transactions(wallet_id, created_at desc);

create table public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  monthly_credits int not null default 0,
  price_cents int not null default 0,
  currency text not null default 'PLN',
  active boolean not null default true,
  features jsonb not null default '{}'::jsonb,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  plan_id uuid not null references public.subscription_plans(id),
  status text not null default 'active',
  current_period_start timestamptz not null default now(),
  current_period_end timestamptz,
  provider text,
  provider_subscription_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  amount_cents int not null,
  currency text not null default 'PLN',
  status text not null default 'pending',
  provider text,
  provider_payment_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.usage_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  quantity int not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  on_behalf_of uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index activity_logs_ws_idx on public.activity_logs(workspace_id, created_at desc);
