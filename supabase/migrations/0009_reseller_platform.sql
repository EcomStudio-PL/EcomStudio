-- Encrypted provider credentials. Ciphertext only (AES-256-GCM, key held
-- server-side in APP_ENCRYPTION_KEY). Admin-only access; plaintext never stored.
create table public.ai_provider_credentials (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null unique references public.ai_providers(id) on delete cascade,
  credential_name text not null default 'api_key',
  encrypted_value text not null,
  iv text not null,
  auth_tag text not null,
  last_four text not null default '',
  base_url text,
  active boolean not null default true,
  last_tested_at timestamptz,
  last_test_status text,
  last_test_error_safe text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
alter table public.ai_provider_credentials enable row level security;
create policy "cred_admin_all" on public.ai_provider_credentials for all
  using (public.is_admin()) with check (public.is_admin());

-- Credit top-up packages (independent of subscription plans).
create table public.credit_packages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  credits int not null check (credits > 0),
  bonus_credits int not null default 0 check (bonus_credits >= 0),
  price_cents int not null check (price_cents >= 0),
  currency text not null default 'PLN',
  active boolean not null default true,
  featured boolean not null default false,
  sort_order int not null default 0,
  badge text,
  description text,
  created_at timestamptz not null default now()
);
alter table public.credit_packages enable row level security;
create policy "pkg_select_active" on public.credit_packages for select
  using (active = true or public.is_admin());
create policy "pkg_admin_write" on public.credit_packages for all
  using (public.is_admin()) with check (public.is_admin());

insert into public.credit_packages (name, credits, bonus_credits, price_cents, sort_order, featured, badge) values
 ('Start', 100, 0, 1900, 0, false, null),
 ('Standard', 500, 50, 7900, 1, true, 'Najpopularniejszy'),
 ('Pro', 1000, 150, 13900, 2, false, null),
 ('Business', 2500, 500, 29900, 3, false, 'Najlepsza wartość');

-- Model economics (admin-only visibility enforced in app layer; provider costs
-- are internal). Additive columns only.
alter table public.ai_models add column if not exists internal_cost_usd_micros bigint not null default 0;
alter table public.ai_models add column if not exists quality_tier text not null default 'standard';
alter table public.ai_models add column if not exists speed_tier text not null default 'standard';
alter table public.ai_models add column if not exists max_reference_images int not null default 4;
alter table public.ai_models add column if not exists description text;

-- Plan extensions.
alter table public.subscription_plans add column if not exists description text;
alter table public.subscription_plans add column if not exists annual_price_cents int not null default 0;
alter table public.subscription_plans add column if not exists featured boolean not null default false;

-- Reseller billing configuration (single source of truth for credit value).
insert into public.app_settings (key, value) values
 ('billing', '{"credit_currency":"PLN","price_per_100_credits":19,"usd_to_pln":4.0}')
on conflict (key) do nothing;

-- Additional providers for the reseller catalog.
insert into public.ai_providers (slug, name, active, metadata) values
 ('higgsfield','Higgsfield',false,'{"kind":"image_video"}'),
 ('anthropic','Anthropic',false,'{"kind":"text"}')
on conflict (slug) do nothing;

-- Ledger adjustment with admin-chosen type (bonus / refund / topup / admin_adjustment).
create or replace function public.admin_adjust_credits_v2(
  p_wallet_id uuid,
  p_amount int,
  p_type public.credit_tx_type,
  p_description text default null,
  p_metadata jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_tx uuid;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'not_admin';
  end if;
  if p_type not in ('bonus','refund','topup','admin_adjustment') then
    raise exception 'invalid_type';
  end if;
  v_tx := public.apply_credit_transaction(
    p_wallet_id, p_amount, p_type, p_description, null,
    p_metadata || jsonb_build_object('source','admin_panel'), auth.uid());
  return v_tx;
end;
$$;
revoke execute on function public.admin_adjust_credits_v2(uuid,int,public.credit_tx_type,text,jsonb) from public, anon;
grant execute on function public.admin_adjust_credits_v2(uuid,int,public.credit_tx_type,text,jsonb) to authenticated;
