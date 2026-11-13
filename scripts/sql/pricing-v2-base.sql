-- CENNIK V2 REHEARSAL — the schema 0174 lands on, as PROD has it today
-- (columns and types read from PROD's information_schema on 2026-11-13: every
-- credit amount an INTEGER, the full credit_tx_type enum, the money tables).
-- Function bodies that 0174 patches or replaces are loaded verbatim from the
-- migrations by scripts/pricing-v2-sql-tests.sh, not retyped here.

\set ON_ERROR_STOP on

drop schema if exists auth cascade;
drop schema if exists public cascade;
drop schema if exists extensions cascade;
create schema public;
create schema auth;
create schema extensions;
create extension if not exists pgcrypto with schema extensions;
set search_path = public, extensions;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
grant usage on schema public, auth, extensions to anon, authenticated, service_role;
-- Supabase's default: new tables and functions in public are granted to both
-- client roles, so a REVOKE in the migration is what makes "no access" true.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('app.current_user', true), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

create type public.credit_tx_type as enum
  ('subscription','topup','generation','refund','bonus','admin_adjustment','purchase','promotion','admin_grant','manual_adjustment');
create type public.job_status as enum ('queued','running','completed','failed','canceled');

create table public.profiles (id uuid primary key, email text, role text not null default 'user', full_name text);
create table public.workspaces (id uuid primary key default gen_random_uuid(), name text, owner_id uuid);
create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null, primary key (workspace_id, user_id));
create table public.app_settings (key text primary key, value jsonb not null default '{}'::jsonb);

create table public.credit_wallets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.workspaces(id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());

create table public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.credit_wallets(id) on delete cascade,
  amount integer not null,
  type public.credit_tx_type not null,
  description text,
  reference_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  balance_before integer,
  balance_after integer,
  usage_event_id uuid);

create table public.faq_items (id uuid primary key default gen_random_uuid(), question jsonb, answer jsonb);
create table public.service_catalog (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null, name text not null,
  category text not null default 'general', service_type text not null default 'image', unit text not null default 'generation',
  metadata jsonb not null default '{}'::jsonb,
  enabled boolean not null default true, maintenance_mode boolean not null default false,
  credits_cost integer not null default 1 check (credits_cost >= 0),
  api_cost_usd_micros bigint not null default 0, sale_value_cents integer not null default 0);

create table public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  status public.job_status default 'queued',
  credits_charged integer default 0,
  settings jsonb default '{}'::jsonb,
  completed_at timestamptz, error_message text, error_class text, latency_ms integer,
  created_at timestamptz default now());
create table public.generations (id uuid primary key default gen_random_uuid(), job_id uuid not null references public.generation_jobs(id) on delete cascade);
create table public.generation_assets (id uuid primary key default gen_random_uuid(), generation_id uuid not null references public.generations(id) on delete cascade);
create table public.prompt_sessions (id uuid primary key default gen_random_uuid(), workspace_id uuid);
create table public.generated_prompts (id uuid primary key default gen_random_uuid(), session_id uuid);

create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  service_id uuid references public.service_catalog(id) on delete set null,
  service_slug text not null, provider_slug text, model_slug text,
  credits_charged integer not null default 0,
  api_cost_usd_micros_snapshot bigint not null default 0,
  sale_value_cents_snapshot integer not null default 0,
  status text not null default 'pending' check (status in ('pending','succeeded','failed','refunded')),
  started_at timestamptz not null default now(), finished_at timestamptz, error text,
  result_count integer not null default 0,
  generation_job_id uuid references public.generation_jobs(id) on delete set null,
  credit_tx_id uuid references public.credit_transactions(id) on delete set null,
  refund_tx_id uuid references public.credit_transactions(id) on delete set null,
  idempotency_key text unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  actual_api_cost_usd_micros bigint not null default 0,
  provider_request_id text);

create table public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null, name text not null, description text,
  active boolean not null default true, featured boolean not null default false,
  price_cents integer not null default 0, annual_price_cents integer not null default 0,
  currency text not null default 'PLN',
  monthly_credits integer not null default 0, bonus_credits integer not null default 0,
  features jsonb not null default '{}'::jsonb, limits jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0, created_at timestamptz not null default now(),
  stripe_product_id text, stripe_price_id_monthly text, stripe_price_id_annual text,
  stripe_price_monthly_cents integer, stripe_price_annual_cents integer,
  stripe_sync_status text not null default 'unknown', stripe_synced_at timestamptz, stripe_sync_error text);

create table public.credit_packages (
  id uuid primary key default gen_random_uuid(),
  name text not null, credits integer not null check (credits > 0), bonus_credits integer not null default 0,
  price_cents integer not null, currency text not null default 'PLN', active boolean not null default true,
  featured boolean not null default false, sort_order integer not null default 0, badge text, description text,
  created_at timestamptz not null default now(), stripe_product_id text, stripe_price_id text,
  stripe_price_cents integer, stripe_sync_status text not null default 'unknown', stripe_synced_at timestamptz, stripe_sync_error text);

create table public.ai_models (
  id uuid primary key default gen_random_uuid(),
  model_identifier text not null, name text not null, display_name text,
  active boolean not null default true, credit_cost integer not null default 1,
  pricing jsonb, metadata jsonb not null default '{}'::jsonb,
  supported_resolutions text[], ecom_surcharge_credits integer not null default 0 check (ecom_surcharge_credits = 0));

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  plan_id uuid not null references public.subscription_plans(id),
  status text not null default 'active',
  current_period_start timestamptz not null default now(), current_period_end timestamptz,
  provider text, provider_subscription_id text, metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), stripe_price_id text,
  cancel_at_period_end boolean not null default false, stripe_customer_id text,
  unique (provider, provider_subscription_id));

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete set null,
  amount_cents integer not null, currency text not null default 'PLN',
  status text not null default 'pending', provider text, provider_payment_id text,
  metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
  archived_workspace_id uuid, archived_account_email text, archived_at timestamptz,
  kind text check (kind is null or kind in ('credit_pack','custom_credits','subscription')),
  credits_granted integer not null default 0,
  credit_tx_id uuid references public.credit_transactions(id),
  stripe_customer_id text,
  package_id uuid references public.credit_packages(id) on delete set null,
  plan_id uuid references public.subscription_plans(id) on delete set null,
  unique (provider, provider_payment_id));

create table public.payment_events (
  stripe_event_id text primary key, event_type text not null, object_id text, workspace_id uuid,
  outcome text not null, detail jsonb not null default '{}'::jsonb, received_at timestamptz not null default now());

create table public.ai_engine_runs (
  id uuid primary key default gen_random_uuid(),
  tool_key text, workspace_id uuid, user_id uuid, mode text, status text default 'queued',
  run_kind text, idempotency_key text unique, engine_version text, prompt_version integer,
  input jsonb, expected_outputs integer, credits integer default 0, progress jsonb,
  lease_owner text, locked_until timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now());

-- helpers with PROD's signatures and meaning
create function public.is_workspace_member(ws_id uuid, uid uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.workspace_members m where m.workspace_id = ws_id and m.user_id = uid)
$$;
create function public.is_admin(uid uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = uid and p.role = 'admin')
$$;
create function public.server_call_ok(p_token text) returns boolean
language plpgsql stable security definer set search_path = public, extensions as $$
declare v_hash text;
begin
  select value->>'dispatch_hash' into v_hash from public.app_settings where key = 'notifications';
  if v_hash is null or v_hash = '' then return false; end if;
  return encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') = v_hash;
end $$;
create function public.server_request_ok() returns boolean language sql stable as $$ select false $$;
insert into public.app_settings (key, value)
values ('notifications', jsonb_build_object('dispatch_hash', encode(extensions.digest('srv-token', 'sha256'), 'hex')));

-- The welcome-bonus claim: only its declarations matter to 0174 (it reports a
-- balance through `v_balance integer`), so its shape is reproduced, not its tables.
create function public.claim_welcome_bonus(p_answers jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_balance integer;
begin
  select balance into v_balance from public.credit_wallets limit 1;
  return jsonb_build_object('balance', v_balance);
end $$;

-- PROD's old integer ledger door (0001/0099 body), replaced by 0174.
create function public.apply_credit_transaction(p_wallet_id uuid, p_amount integer, p_type credit_tx_type, p_description text default null, p_reference_id uuid default null, p_metadata jsonb default '{}'::jsonb, p_created_by uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_balance int; v_tx_id uuid;
begin
  select balance into v_balance from public.credit_wallets where id = p_wallet_id for update;
  if not found then raise exception 'wallet_not_found'; end if;
  if v_balance + p_amount < 0 then raise exception 'insufficient_credits'; end if;
  update public.credit_wallets set balance = v_balance + p_amount, updated_at = now() where id = p_wallet_id;
  insert into public.credit_transactions (wallet_id, amount, type, description, reference_id, metadata, created_by, balance_before, balance_after)
  values (p_wallet_id, p_amount, p_type, p_description, p_reference_id, p_metadata, p_created_by, v_balance, v_balance + p_amount)
  returning id into v_tx_id;
  return v_tx_id;
end; $$;
revoke all on function public.apply_credit_transaction(uuid, integer, credit_tx_type, text, uuid, jsonb, uuid) from public, anon, authenticated;

create function public.credit_wallets_total() returns bigint language sql stable set search_path = public as $$
  select coalesce(sum(balance), 0)::bigint from public.credit_wallets; $$;
create function public.generation_credits_total() returns bigint language sql stable set search_path = public as $$
  select coalesce(sum(abs(amount)), 0)::bigint from public.credit_transactions where type = 'generation'; $$;

create table public.ai_provider_calls (
  id uuid primary key default gen_random_uuid(), created_at timestamptz default now(), usage_event_id uuid, provider_slug text, model text,
  status text, input_tokens bigint, output_tokens bigint, thought_tokens bigint, resolution text, cost_usd_micros bigint, cost_basis text);
