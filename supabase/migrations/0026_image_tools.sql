-- IMAGE TOOLS
--
-- Eight micro-tools for product photos. Five of them are pure sharp work in
-- our own runtime and therefore cost the seller nothing; three need a real
-- model and are priced by the cost engine, which never lets the gross margin
-- fall under the floor configured in app_settings.billing.
--
-- Everything reuses what already exists: service_catalog carries the price
-- and the estimated provider cost, usage_events records each run with the
-- real cost, and ai_providers/ai_provider_credentials hold the keys — so an
-- operator pastes a key in the admin panel instead of waiting for a deploy.

-- 1. Catalogue entries -------------------------------------------------------
-- credits_cost is the admin's FLOOR. The engine may charge more when the
-- active provider is expensive, never less than what the margin rule needs.
insert into public.service_catalog
  (slug, name, category, service_type, unit, credits_cost, api_cost_usd_micros, min_margin_percent, sort_order)
values
  ('tool_upscale',   'Tool — upscale',            'tools', 'image', 'image', 1, 20000, 50, 20),
  ('tool_remove_bg', 'Tool — background removal', 'tools', 'image', 'image', 1,  4000, 50, 21),
  ('tool_expand',    'Tool — AI expand',          'tools', 'image', 'image', 1, 40000, 50, 22),
  ('tool_white_bg',  'Tool — white background',   'tools', 'image', 'image', 0,     0,  0, 23),
  ('tool_shadow',    'Tool — product shadow',     'tools', 'image', 'image', 0,     0,  0, 24),
  ('tool_format',    'Tool — format and size',    'tools', 'image', 'image', 0,     0,  0, 25),
  ('tool_compress',  'Tool — compression',        'tools', 'image', 'image', 0,     0,  0, 26),
  ('tool_watermark', 'Tool — watermark',          'tools', 'image', 'image', 0,     0,  0, 27)
on conflict (slug) do nothing;

-- 2. Providers the tools can use --------------------------------------------
-- Rows only: no key is created here. Each stays inactive until an admin
-- connects it, and the module reports "not configured" until then.
insert into public.ai_providers (slug, name, active)
values
  ('stability', 'Stability AI', false),
  ('clipdrop',  'Clipdrop',     false),
  ('photoroom', 'Photoroom',    false),
  ('removebg',  'remove.bg',    false)
on conflict (slug) do nothing;

-- 3. Margin + buffer settings the cost engine reads --------------------------
update public.app_settings
set value = value || jsonb_build_object('min_margin_percent', 50, 'buffer_percent', 12)
where key = 'billing';

insert into public.app_settings (key, value)
select 'billing', jsonb_build_object(
  'price_per_100_credits', 19, 'usd_to_pln', 4.0,
  'credit_currency', 'PLN', 'min_margin_percent', 50, 'buffer_percent', 12)
where not exists (select 1 from public.app_settings where key = 'billing');

-- 4. Saved tool results ------------------------------------------------------
-- A run stores nothing by default; this table only records what a seller
-- explicitly kept, so trying twenty watermark settings costs zero storage.
create table if not exists public.tool_results (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  tool_slug text not null,
  storage_path text not null,
  mime_type text not null default 'image/png',
  file_size integer not null default 0,
  product_id uuid references public.products(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists tool_results_workspace_idx
  on public.tool_results (workspace_id, created_at desc);

alter table public.tool_results enable row level security;

-- Members see and manage their own workspace's results; admins can read
-- everything for support, exactly like generation assets.
drop policy if exists tool_results_select on public.tool_results;
create policy tool_results_select on public.tool_results
  for select using (public.is_workspace_member(workspace_id) or public.is_admin());

drop policy if exists tool_results_insert on public.tool_results;
create policy tool_results_insert on public.tool_results
  for insert with check (public.is_workspace_member(workspace_id) and user_id = auth.uid());

drop policy if exists tool_results_delete on public.tool_results;
create policy tool_results_delete on public.tool_results
  for delete using (public.is_workspace_member(workspace_id));
