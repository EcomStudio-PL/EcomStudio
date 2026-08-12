-- =====================================================================
-- SaaS B2B foundation: service catalog, usage ledger, richer credit
-- ledger, CRM, audit log, billing profile, branding, feature flags,
-- CMS (pages/blocks/media), inspirations library.
-- Additive only — nothing existing is dropped or rewritten.
-- =====================================================================

-- ---------- SERVICE CATALOG ----------
create table public.service_catalog (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  category text not null default 'general',
  service_type text not null default 'image'
    check (service_type in ('image','video','prompt','text','audio','other')),
  unit text not null default 'generation',
  provider_id uuid references public.ai_providers(id) on delete set null,
  model_id uuid references public.ai_models(id) on delete set null,
  credits_cost int not null default 1 check (credits_cost >= 0),
  api_cost_usd_micros bigint not null default 0,
  cost_currency text not null default 'USD',
  sale_value_cents int not null default 0,
  sale_currency text not null default 'PLN',
  min_margin_percent numeric not null default 0,
  markup_percent numeric,
  plan_slugs text[],
  enabled boolean not null default true,
  featured boolean not null default false,
  maintenance_mode boolean not null default false,
  sort_order int not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index service_catalog_enabled_idx on public.service_catalog(enabled, sort_order);

alter table public.service_catalog enable row level security;
create policy "services_read" on public.service_catalog for select using (true);
create policy "services_admin_write" on public.service_catalog
  for all using (public.is_admin()) with check (public.is_admin());

-- Price history: never rewrite the past — every pricing change is recorded.
create table public.service_price_history (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null default 'service',
  entity_id uuid not null,
  changed_by uuid references public.profiles(id) on delete set null,
  old_values jsonb not null,
  new_values jsonb not null,
  created_at timestamptz not null default now()
);
create index service_price_history_entity_idx on public.service_price_history(entity_id, created_at desc);
alter table public.service_price_history enable row level security;
create policy "price_history_admin" on public.service_price_history
  for select using (public.is_admin());

create or replace function public.track_service_price_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (old.credits_cost, old.api_cost_usd_micros, old.sale_value_cents, old.markup_percent, old.min_margin_percent)
     is distinct from
     (new.credits_cost, new.api_cost_usd_micros, new.sale_value_cents, new.markup_percent, new.min_margin_percent) then
    insert into public.service_price_history (entity_type, entity_id, changed_by, old_values, new_values)
    values ('service', new.id, auth.uid(),
      jsonb_build_object('credits_cost', old.credits_cost, 'api_cost_usd_micros', old.api_cost_usd_micros,
        'sale_value_cents', old.sale_value_cents, 'markup_percent', old.markup_percent, 'min_margin_percent', old.min_margin_percent),
      jsonb_build_object('credits_cost', new.credits_cost, 'api_cost_usd_micros', new.api_cost_usd_micros,
        'sale_value_cents', new.sale_value_cents, 'markup_percent', new.markup_percent, 'min_margin_percent', new.min_margin_percent));
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger service_price_change before update on public.service_catalog
  for each row execute function public.track_service_price_change();

-- Also track ai_models pricing edits in the same history table.
create or replace function public.track_model_price_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (old.credit_cost, old.internal_cost_usd_micros) is distinct from (new.credit_cost, new.internal_cost_usd_micros) then
    insert into public.service_price_history (entity_type, entity_id, changed_by, old_values, new_values)
    values ('model', new.id, auth.uid(),
      jsonb_build_object('credit_cost', old.credit_cost, 'internal_cost_usd_micros', old.internal_cost_usd_micros),
      jsonb_build_object('credit_cost', new.credit_cost, 'internal_cost_usd_micros', new.internal_cost_usd_micros));
  end if;
  return new;
end;
$$;
create trigger model_price_change before update on public.ai_models
  for each row execute function public.track_model_price_change();

-- Seed the catalog with the platform's core services.
insert into public.service_catalog (slug, name, category, service_type, unit, credits_cost, sort_order) values
  ('image_generation', 'Image generation', 'generation', 'image', 'image', 4, 0),
  ('video_generation', 'Video generation', 'generation', 'video', 'video', 75, 1),
  ('prompt_generation', 'Prompt generation', 'generation', 'prompt', 'prompt-pack', 0, 2),
  ('image_edit', 'Image edit', 'editing', 'image', 'image', 3, 3),
  ('upscale', 'Upscale', 'editing', 'image', 'image', 2, 4),
  ('background_remove', 'Background removal', 'editing', 'image', 'image', 1, 5)
on conflict (slug) do nothing;

-- ---------- USAGE LEDGER (generation ledger, service-agnostic) ----------
create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  service_id uuid references public.service_catalog(id) on delete set null,
  service_slug text not null,
  provider_slug text,
  model_slug text,
  credits_charged int not null default 0,
  api_cost_usd_micros_snapshot bigint not null default 0,
  sale_value_cents_snapshot int not null default 0,
  status text not null default 'pending'
    check (status in ('pending','succeeded','failed','refunded')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error text,
  result_count int not null default 0,
  generation_job_id uuid references public.generation_jobs(id) on delete set null,
  credit_tx_id uuid references public.credit_transactions(id) on delete set null,
  refund_tx_id uuid references public.credit_transactions(id) on delete set null,
  idempotency_key text unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index usage_events_workspace_idx on public.usage_events(workspace_id, created_at desc);
create index usage_events_user_idx on public.usage_events(user_id, created_at desc);
create index usage_events_service_idx on public.usage_events(service_slug, created_at desc);
create index usage_events_status_idx on public.usage_events(status);

alter table public.usage_events enable row level security;
create policy "usage_events_member_read" on public.usage_events
  for select using (public.is_workspace_member(workspace_id) or public.is_admin());
create policy "usage_events_member_insert" on public.usage_events
  for insert with check (public.is_workspace_member(workspace_id) and user_id = auth.uid());
create policy "usage_events_admin_update" on public.usage_events
  for update using (public.is_admin());

-- ---------- CREDIT LEDGER hardening ----------
alter table public.credit_transactions add column if not exists balance_before int;
alter table public.credit_transactions add column if not exists balance_after int;
alter table public.credit_transactions add column if not exists usage_event_id uuid references public.usage_events(id) on delete set null;
create index if not exists credit_transactions_created_idx on public.credit_transactions(created_at desc);
create index if not exists credit_transactions_type_idx on public.credit_transactions(type);

-- Single writer now also records before/after balances — full traceability.
create or replace function public.apply_credit_transaction(
  p_wallet_id uuid,
  p_amount int,
  p_type public.credit_tx_type,
  p_description text default null,
  p_reference_id uuid default null,
  p_metadata jsonb default '{}'::jsonb,
  p_created_by uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_balance int;
  v_tx_id uuid;
begin
  select balance into v_balance from public.credit_wallets where id = p_wallet_id for update;
  if not found then
    raise exception 'wallet_not_found';
  end if;
  if v_balance + p_amount < 0 then
    raise exception 'insufficient_credits';
  end if;
  update public.credit_wallets
    set balance = v_balance + p_amount, updated_at = now()
    where id = p_wallet_id;
  insert into public.credit_transactions
      (wallet_id, amount, type, description, reference_id, metadata, created_by, balance_before, balance_after)
    values
      (p_wallet_id, p_amount, p_type, p_description, p_reference_id, p_metadata, p_created_by, v_balance, v_balance + p_amount)
    returning id into v_tx_id;
  return v_tx_id;
end;
$$;
revoke execute on function public.apply_credit_transaction(uuid,int,public.credit_tx_type,text,uuid,jsonb,uuid) from public, anon, authenticated;

-- ---------- CRM ----------
alter table public.profiles add column if not exists account_manager_id uuid references public.profiles(id) on delete set null;
alter table public.profiles add column if not exists blocked boolean not null default false;
create index if not exists profiles_created_idx on public.profiles(created_at desc);
create index if not exists profiles_manager_idx on public.profiles(account_manager_id);

create table public.crm_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  body text not null,
  pinned boolean not null default false,
  reminder_date date,
  created_at timestamptz not null default now()
);
create index crm_notes_user_idx on public.crm_notes(user_id, created_at desc);
alter table public.crm_notes enable row level security;
create policy "crm_notes_staff" on public.crm_notes
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- AUDIT LOG ----------
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id text,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs(created_at desc);
alter table public.audit_logs enable row level security;
create policy "audit_logs_admin_read" on public.audit_logs for select using (public.is_admin());
create policy "audit_logs_admin_insert" on public.audit_logs
  for insert with check (public.is_admin() and actor_id = auth.uid());

-- ---------- BILLING PROFILE (company data, separate from user profile) ----------
create table public.billing_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.workspaces(id) on delete cascade,
  company_name text,
  vat_id text,
  regon text,
  address_line text,
  postal_code text,
  city text,
  country text,
  billing_email text,
  contact_person text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.billing_profiles enable row level security;
create policy "billing_member" on public.billing_profiles
  for all using (public.is_workspace_member(workspace_id) or public.is_admin())
  with check (public.is_workspace_member(workspace_id) or public.is_admin());

-- ---------- WORKSPACE BRANDING ----------
alter table public.workspaces add column if not exists logo_url text;
alter table public.workspaces add column if not exists brand_color text;
alter table public.workspaces add column if not exists company_name text;

-- ---------- FEATURE FLAGS ----------
create table public.feature_flags (
  id uuid primary key default gen_random_uuid(),
  flag text not null unique,
  enabled boolean not null default false,
  plans text[],
  roles text[],
  rollout_percent int,
  description text,
  created_at timestamptz not null default now()
);
alter table public.feature_flags enable row level security;
create policy "flags_read" on public.feature_flags for select using (true);
create policy "flags_admin_write" on public.feature_flags
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- CMS ----------
create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'image' check (kind in ('image','video','file')),
  storage_path text,
  external_url text,
  poster_url text,
  alt text,
  title text,
  mime text,
  size_bytes bigint,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.media_assets enable row level security;
create policy "media_read" on public.media_assets for select using (true);
create policy "media_admin_write" on public.media_assets
  for all using (public.is_admin()) with check (public.is_admin());

create table public.cms_pages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  status text not null default 'draft' check (status in ('draft','published')),
  published_snapshot jsonb,
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.cms_pages enable row level security;
create policy "cms_pages_read" on public.cms_pages for select using (true);
create policy "cms_pages_admin_write" on public.cms_pages
  for all using (public.is_admin()) with check (public.is_admin());

create table public.cms_blocks (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.cms_pages(id) on delete cascade,
  type text not null,
  sort_order int not null default 0,
  visible boolean not null default true,
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index cms_blocks_page_idx on public.cms_blocks(page_id, sort_order);
alter table public.cms_blocks enable row level security;
create policy "cms_blocks_read" on public.cms_blocks for select using (true);
create policy "cms_blocks_admin_write" on public.cms_blocks
  for all using (public.is_admin()) with check (public.is_admin());

insert into public.cms_pages (slug, title, status) values ('home', 'Strona główna', 'draft')
on conflict (slug) do nothing;

-- ---------- INSPIRATIONS (admin-curated prompt gallery) ----------
create table public.inspirations (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  category text not null default 'lifestyle',
  use_case text,
  prompt text not null,
  negative_prompt text,
  model_slug text,
  format text,
  tags text[] not null default '{}',
  premium boolean not null default false,
  featured boolean not null default false,
  sort_order int not null default 0,
  status text not null default 'draft' check (status in ('draft','published')),
  locale text,
  before_url text,
  after_urls text[] not null default '{}',
  video_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index inspirations_status_idx on public.inspirations(status, featured, sort_order);
alter table public.inspirations enable row level security;
create policy "inspirations_read_published" on public.inspirations
  for select using (status = 'published' or public.is_admin());
create policy "inspirations_admin_write" on public.inspirations
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- HOT-PATH INDEXES on existing tables ----------
create index if not exists generation_jobs_ws_created_idx on public.generation_jobs(workspace_id, created_at desc);
create index if not exists generation_jobs_status_idx on public.generation_jobs(status);
create index if not exists payments_created_idx on public.payments(created_at desc);
create index if not exists payments_status_idx on public.payments(status);
create index if not exists activity_logs_created_idx on public.activity_logs(created_at desc);

-- ---------- STORAGE: public media + workspace branding ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 52428800,
  array['image/png','image/jpeg','image/webp','image/avif','image/gif','video/mp4','video/webm'])
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('workspace-branding', 'workspace-branding', true, 5242880,
  array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

create policy "media_public_read" on storage.objects for select
  using (bucket_id = 'media');
create policy "media_admin_insert" on storage.objects for insert
  with check (bucket_id = 'media' and public.is_admin());
create policy "media_admin_update" on storage.objects for update
  using (bucket_id = 'media' and public.is_admin());
create policy "media_admin_delete" on storage.objects for delete
  using (bucket_id = 'media' and public.is_admin());

create policy "branding_public_read" on storage.objects for select
  using (bucket_id = 'workspace-branding');
create policy "branding_member_insert" on storage.objects for insert
  with check (bucket_id = 'workspace-branding' and public.is_workspace_member((storage.foldername(name))[1]::uuid));
create policy "branding_member_update" on storage.objects for update
  using (bucket_id = 'workspace-branding' and public.is_workspace_member((storage.foldername(name))[1]::uuid));
create policy "branding_member_delete" on storage.objects for delete
  using (bucket_id = 'workspace-branding' and public.is_workspace_member((storage.foldername(name))[1]::uuid));
