-- THE CREDIT LEDGER, REBUILT LOCALLY SO IT CAN BE ATTACKED.
--
-- GrovBase's money path lives in Postgres functions. Reading them proves
-- nothing; the only way to know whether a refund can be minted is to try to
-- mint one. Supabase DEV cannot host this test — it has 20 tables and no
-- `usage_events` at all — and PROD is not a place to run attacks. So this file
-- rebuilds the relevant slice of the schema on a throwaway local Postgres.
--
-- FIDELITY MATTERS MORE THAN BREVITY. Every function body below was copied
-- from PROD via pg_get_functiondef on 2026-09-19, not written from memory. The
-- only deliberate differences are:
--   * auth.uid() is a settable stub, so a test can act as a given user.
--   * server_call_ok() reads the same app_settings row, so the token gate is
--     exercised rather than bypassed.
--   * RLS is enabled ONLY on usage_events, with the three production policies
--     copied verbatim, and a non-owner role `app_user` stands in for
--     `authenticated`. That is what makes "a customer can write the billing
--     ledger" testable instead of merely arguable. The other tables are
--     attacked through SECURITY DEFINER functions, which bypass RLS in
--     production too, so policies on them would prove nothing here.
--
-- Usage:  npm run test:ledger:sql

\set ON_ERROR_STOP on

drop schema if exists auth cascade;
drop schema if exists public cascade;
create schema public;
create schema auth;
create extension if not exists pgcrypto with schema public;

-- ── auth.uid() stub ─────────────────────────────────────────────────────────
-- A test sets `app.current_user` and every function sees that caller.
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('app.current_user', true), '')::uuid
$$;

-- ── types ───────────────────────────────────────────────────────────────────
create type public.credit_tx_type as enum
  ('purchase','generation','refund','bonus','adjustment','expiry');

-- ── tables (only the columns the money path touches) ────────────────────────
create table public.workspaces (id uuid primary key default gen_random_uuid());

create table public.profiles (
  id uuid primary key,
  role text not null default 'user'
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null,
  primary key (workspace_id, user_id)
);

create table public.credit_wallets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  balance integer not null default 0,
  updated_at timestamptz not null default now()
);

create table public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.credit_wallets(id) on delete cascade,
  amount integer not null,
  type public.credit_tx_type not null,
  description text,
  reference_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  balance_before integer not null,
  balance_after integer not null,
  created_at timestamptz not null default now()
);

create table public.service_catalog (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  enabled boolean not null default true,
  maintenance_mode boolean not null default false,
  credits_cost integer not null default 1,
  api_cost_usd_micros bigint not null default 0,
  sale_value_cents integer not null default 0
);

create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  service_id uuid references public.service_catalog(id) on delete set null,
  service_slug text not null,
  provider_slug text,
  model_slug text,
  credits_charged integer not null default 0,
  api_cost_usd_micros_snapshot bigint not null default 0,
  sale_value_cents_snapshot integer not null default 0,
  status text not null default 'pending',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error text,
  result_count integer not null default 0,
  generation_job_id uuid,
  credit_tx_id uuid references public.credit_transactions(id) on delete set null,
  refund_tx_id uuid references public.credit_transactions(id) on delete set null,
  idempotency_key text unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  actual_api_cost_usd_micros bigint not null default 0,
  provider_request_id text
);

-- Delivery evidence. The reconciler (0102) refuses to refund a run whose work
-- is already in the customer's hands, so the tables that hold that proof have
-- to exist here or the refuse-to-refund branch cannot be tested.
create table public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade
);

create table public.generations (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.generation_jobs(id) on delete cascade
);

create table public.generation_assets (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null references public.generations(id) on delete cascade
);

create table public.prompt_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade
);

create table public.generated_prompts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.prompt_sessions(id) on delete cascade
);

create table public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb
);

-- ── helpers, same semantics as PROD ─────────────────────────────────────────
create function public.is_workspace_member(p_ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_ws and m.user_id = auth.uid()
  )
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
$$;

create function public.server_call_ok(p_token text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_hash text;
begin
  select value->>'dispatch_hash' into v_hash from public.app_settings where key = 'notifications';
  if v_hash is null or v_hash = '' then return false; end if;
  return encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') = v_hash;
end $$;

-- ── PROD BODIES, verbatim (pg_get_functiondef, 2026-09-19) ──────────────────

create function public.apply_credit_transaction(
  p_wallet_id uuid, p_amount integer, p_type public.credit_tx_type,
  p_description text default null, p_reference_id uuid default null,
  p_metadata jsonb default '{}'::jsonb, p_created_by uuid default null
) returns uuid language plpgsql security definer set search_path to 'public' as $function$
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
$function$;

create function public.usage_event_charge(
  p_token text, p_wallet_id uuid, p_amount integer, p_description text,
  p_reference_id uuid, p_metadata jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare v_ws uuid; v_ev_ws uuid; v_tx uuid;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  if p_amount <= 0 or p_amount > 10000 then raise exception 'invalid_amount'; end if;
  select workspace_id into v_ws from public.credit_wallets where id = p_wallet_id;
  if v_ws is null or not public.is_workspace_member(v_ws) then raise exception 'not_authorized'; end if;
  select workspace_id into v_ev_ws from public.usage_events where id = p_reference_id;
  if v_ev_ws is null or v_ev_ws <> v_ws then raise exception 'not_authorized'; end if;
  v_tx := public.apply_credit_transaction(
    p_wallet_id, -p_amount, 'generation', p_description, p_reference_id, p_metadata, auth.uid());
  update public.usage_events set credit_tx_id = v_tx where id = p_reference_id;
  return v_tx;
end $function$;

-- usage_event_fail as it stands on PROD TODAY, including the P0-02 defect.
-- The remediation migration replaces it; the test suite runs first against
-- this version (must FAIL) and then against the patched one (must PASS).
create function public.usage_event_fail(
  p_token text, p_event_id uuid, p_error text, p_api_cost_usd_micros bigint default 0
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_event record;
  v_wallet uuid;
  v_tx uuid;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  select id, workspace_id, credits_charged, status, refund_tx_id
    into v_event from public.usage_events where id = p_event_id for update;
  if v_event.id is null or not public.is_workspace_member(v_event.workspace_id) then
    raise exception 'not_authorized';
  end if;
  if v_event.status = 'pending' then
    update public.usage_events
      set status = 'failed', error = left(coalesce(p_error, 'error'), 200),
          finished_at = now(),
          actual_api_cost_usd_micros = greatest(0, coalesce(p_api_cost_usd_micros, 0))
      where id = p_event_id;
    v_event.status := 'failed';
  end if;
  if v_event.status <> 'failed' or v_event.refund_tx_id is not null or v_event.credits_charged <= 0 then
    return null;
  end if;
  select id into v_wallet from public.credit_wallets where workspace_id = v_event.workspace_id;
  v_tx := public.apply_credit_transaction(
    v_wallet, v_event.credits_charged, 'refund', 'Refund: generation failed',
    p_event_id, jsonb_build_object('reason', left(coalesce(p_error, 'error'), 100)), auth.uid());
  update public.usage_events set status = 'refunded', refund_tx_id = v_tx where id = p_event_id;
  return v_tx;
end $$;

-- usage_event_refund_partial as it stands on PROD TODAY, carrying the same
-- shape of guard as usage_event_fail and the same missing precondition.
create function public.usage_event_refund_partial(
  p_token text, p_event_id uuid, p_amount integer
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_event record;
  v_wallet uuid;
  v_tx uuid;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  select id, workspace_id, credits_charged, status, refund_tx_id, metadata
    into v_event from public.usage_events where id = p_event_id for update;
  if v_event.id is null or not public.is_workspace_member(v_event.workspace_id) then
    raise exception 'not_authorized';
  end if;
  if v_event.status <> 'pending'
     or v_event.refund_tx_id is not null
     or coalesce((v_event.metadata->>'partial_refund_tx') is not null, false)
     or p_amount is null or p_amount <= 0 or p_amount >= v_event.credits_charged then
    return null;
  end if;
  select id into v_wallet from public.credit_wallets where workspace_id = v_event.workspace_id;
  v_tx := public.apply_credit_transaction(
    v_wallet, p_amount, 'refund', 'Refund: partial delivery',
    p_event_id, jsonb_build_object('reason', 'partial_delivery', 'amount', p_amount), auth.uid());
  update public.usage_events
     set credits_charged = credits_charged - p_amount,
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('partial_refund_tx', v_tx)
   where id = p_event_id;
  return v_tx;
end $$;

-- usage_event_complete as it stands on PROD TODAY — the success half of the
-- lifecycle, needed to test what happens to a key once a run is over.
create function public.usage_event_complete(
  p_token text, p_event_id uuid, p_result_count integer,
  p_api_cost_usd_micros bigint default 0, p_request_id text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_ws uuid;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  select workspace_id into v_ws from public.usage_events where id = p_event_id;
  if v_ws is null or not public.is_workspace_member(v_ws) then raise exception 'not_authorized'; end if;
  update public.usage_events
    set status = 'succeeded',
        result_count = greatest(0, coalesce(p_result_count, 0)),
        actual_api_cost_usd_micros = greatest(0, coalesce(p_api_cost_usd_micros, 0)),
        provider_request_id = left(p_request_id, 200),
        finished_at = now()
    where id = p_event_id and status = 'pending';
end $$;

-- ── usage_events RLS, as it stands on PROD TODAY ────────────────────────────
-- `app_user` is this harness's `authenticated`: an ordinary role that owns
-- nothing, so policies actually apply to it. `usage_events_member_insert` is
-- the policy the remediation drops; it is created here so the test can watch
-- it let a customer write a billing row.
-- `anon` and `authenticated` exist so the migrations' GRANT/REVOKE lines apply
-- verbatim instead of having to be edited out — an edited migration is not the
-- migration that ships.
do $$
declare r text;
begin
  foreach r in array array['app_user', 'anon', 'authenticated'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin', r);
    end if;
  end loop;
end $$;
grant usage on schema public to app_user;
grant select, insert on public.usage_events to app_user;
grant select on public.credit_wallets, public.credit_transactions, public.service_catalog to app_user;

alter table public.usage_events enable row level security;

create policy usage_events_member_read on public.usage_events
  for select using (public.is_workspace_member(workspace_id) or public.is_admin());
create policy usage_events_member_insert on public.usage_events
  for insert with check (public.is_workspace_member(workspace_id) and user_id = auth.uid());
create policy usage_events_admin_update on public.usage_events
  for update using (public.is_admin());

-- ── fixture ─────────────────────────────────────────────────────────────────
-- The dispatch token and its sha256, so server_call_ok() is exercised for real.
insert into public.app_settings (key, value) values
  ('notifications', jsonb_build_object(
    'dispatch_hash', encode(digest('test-server-token', 'sha256'), 'hex')));

do $$
declare v_ws uuid; v_user uuid; v_wallet uuid;
begin
  v_ws := gen_random_uuid();
  v_user := gen_random_uuid();
  insert into public.workspaces (id) values (v_ws);
  insert into public.profiles (id, role) values (v_user, 'user');
  insert into public.workspace_members (workspace_id, user_id) values (v_ws, v_user);
  insert into public.credit_wallets (workspace_id, balance) values (v_ws, 0) returning id into v_wallet;
  insert into public.service_catalog (slug, name, credits_cost) values ('test-tool', 'Test tool', 5);
  -- Handles for the test script.
  create table public.t_fixture as
    select v_ws as workspace_id, v_user as user_id, v_wallet as wallet_id;
end $$;
