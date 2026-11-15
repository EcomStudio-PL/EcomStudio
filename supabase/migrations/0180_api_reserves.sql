-- 0180 — API RESERVE CENTER: what the API providers hold, what customers can
-- still spend, and how much money must be kept ready for it. ADMINS ONLY.
--
-- 1. api_reserve_settings — one row: safety buffer (default 20 %), horizon,
--    scenario, report schedule (daily at 23:00 Europe/Warsaw), alert repeat.
-- 2. api_provider_funds — per provider HOW its money is known:
--      auto      the provider's official API reports the balance IN MONEY
--                (fal.ai: USD; Stability: credits at $0.01) — synchronised by
--                the app. Photoroom / remove.bg report image credits, not money,
--                so they start as manual;
--      manual    no balance API: an admin enters the balance / top-ups and the
--                estimate subtracts the recorded spend since (OpenAI, Anthropic…);
--      postpaid  billed after the fact (Google Cloud for Gemini): no prepaid
--                balance is ever shown, only what to set aside for the invoice;
--      off       not monitored.
--    A value the system cannot know is NULL, never 0.
--    api_provider_fund_events — every balance entry, top-up, correction, sync.
-- 3. api_reserve_snapshot(p_token) — ONE definer read of everything the
--    reserve model needs. Callable by an admin session or by the server token
--    (the hourly/daily reports run without a session). Provider spend is read
--    from ai_provider_calls ONLY — one row per request actually sent, failed
--    paid attempts and fallbacks included; usage_events.actual_api_cost is a
--    sum of those same rows and is never added on top.
-- 4. A third notification channel, 'admin_panel' — the report lands in the
--    admin panel itself. Additive: notification_preferences gains a column,
--    the outbox channel check gains a value, enqueue_notification inserts one
--    more row (already 'sent': there is nothing to deliver, the panel reads it).
--    The telegram and admin_email paths are reproduced verbatim.
-- 5. Four new events (hourly report, daily report, after-sale report, low
--    funds alert), and a pg_cron tick that wakes /api/cron/reserves through
--    pg_net — Vercel Hobby runs one cron a day, so hourly work lives here.
--
-- Nothing here moves a credit or money, buys anything from a provider, or is
-- readable by a customer. PURELY ADDITIVE and re-runnable.
--
-- ROLLBACK (manual): select cron.unschedule('grovbase-api-reserves');
-- drop function api_reserves_cron_tick(), api_reserve_snapshot(text),
-- api_reserve_sale_facts(text, uuid), api_reserve_settings_save(jsonb),
-- api_provider_funds_save(uuid, jsonb), api_provider_fund_record(uuid, text, bigint, text),
-- api_provider_sync_record(text, text, text, bigint, text); drop table
-- api_provider_fund_events, api_provider_funds, api_reserve_settings; delete the
-- four notification_preferences rows; restore enqueue_notification from 0055
-- and the outbox channel check to ('telegram','admin_email').

set local lock_timeout = '3s';

-- 1 ─────────────────────────────────────────────────────────────────────────
create table if not exists public.api_reserve_settings (
  id text primary key default 'main' check (id = 'main'),
  enabled boolean not null default true,
  buffer_percent numeric(6,2) not null default 20 check (buffer_percent >= 0 and buffer_percent <= 500),
  horizon_days integer not null default 30 check (horizon_days between 1 and 365),
  scenario text not null default 'standard' check (scenario in ('standard', 'cautious')),
  cautious_factor numeric(6,2) not null default 1.5 check (cautious_factor >= 1 and cautious_factor <= 10),
  history_days integer not null default 90 check (history_days between 7 and 365),
  min_history_credits numeric(14,2) not null default 50 check (min_history_credits >= 0),
  daily_report_hour smallint not null default 23 check (daily_report_hour between 0 and 23),
  report_timezone text not null default 'Europe/Warsaw' check (length(report_timezone) between 1 and 64),
  hourly_skip_empty boolean not null default true,
  alert_repeat_hours integer not null default 6 check (alert_repeat_hours between 1 and 168),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
insert into public.api_reserve_settings (id) values ('main') on conflict (id) do nothing;

-- 2 ─────────────────────────────────────────────────────────────────────────
create table if not exists public.api_provider_funds (
  provider_id uuid primary key references public.ai_providers(id) on delete cascade,
  mode text not null default 'manual' check (mode in ('auto', 'manual', 'postpaid', 'off')),
  balance_usd_micros bigint,
  balance_basis text check (balance_basis in ('confirmed', 'manual')),
  balance_at timestamptz,
  credit_limit_usd_micros bigint check (credit_limit_usd_micros is null or credit_limit_usd_micros >= 0),
  warn_usd_micros bigint not null default 20000000 check (warn_usd_micros >= 0),
  critical_usd_micros bigint not null default 5000000 check (critical_usd_micros >= 0),
  billing_url text check (billing_url is null or billing_url ~ '^https://[^\s]+$'),
  last_sync_at timestamptz,
  last_sync_status text check (last_sync_status in ('ok', 'error', 'unsupported', 'not_configured')),
  last_sync_error_safe text check (last_sync_error_safe is null or length(last_sync_error_safe) <= 300),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

create table if not exists public.api_provider_fund_events (
  id bigint generated always as identity primary key,
  provider_id uuid not null references public.ai_providers(id) on delete cascade,
  kind text not null check (kind in ('balance_set', 'topup', 'correction', 'sync')),
  amount_usd_micros bigint,
  balance_usd_micros bigint,
  note text check (note is null or length(note) <= 300),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists api_provider_fund_events_provider_idx
  on public.api_provider_fund_events (provider_id, created_at desc);

-- How each known provider's money can be known (official APIs only; see
-- lib/server/api-reserves/providers.ts). Only rows that do not exist yet: an
-- admin's later choice is never overwritten by a re-run.
insert into public.api_provider_funds (provider_id, mode, billing_url)
select p.id, v.mode, v.url
  from public.ai_providers p
  join (values
    ('google', 'postpaid', 'https://console.cloud.google.com/billing'),
    ('openai', 'manual', 'https://platform.openai.com/settings/organization/billing/overview'),
    ('anthropic', 'manual', 'https://console.anthropic.com/settings/billing'),
    ('fal', 'auto', 'https://fal.ai/dashboard/billing'),
    ('photoroom', 'manual', 'https://app.photoroom.com/api-dashboard'),
    ('removebg', 'manual', 'https://www.remove.bg/dashboard'),
    ('stability', 'auto', 'https://platform.stability.ai/account/credits'),
    ('clipdrop', 'manual', 'https://clipdrop.co/apis/account'),
    ('higgsfield', 'manual', null)
  ) as v(slug, mode, url) on v.slug = p.slug
 where not exists (select 1 from public.api_provider_funds f where f.provider_id = p.id);

alter table public.api_reserve_settings enable row level security;
alter table public.api_provider_funds enable row level security;
alter table public.api_provider_fund_events enable row level security;

do $policy$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'api_reserve_settings' and policyname = 'api_reserve_settings_admin_read') then
    create policy api_reserve_settings_admin_read on public.api_reserve_settings for select to authenticated using ((select public.is_admin()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'api_provider_funds' and policyname = 'api_provider_funds_admin_read') then
    create policy api_provider_funds_admin_read on public.api_provider_funds for select to authenticated using ((select public.is_admin()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'api_provider_fund_events' and policyname = 'api_provider_fund_events_admin_read') then
    create policy api_provider_fund_events_admin_read on public.api_provider_fund_events for select to authenticated using ((select public.is_admin()));
  end if;
end $policy$;
-- No write policy anywhere: the functions below are the only doors.
revoke insert, update, delete on public.api_reserve_settings, public.api_provider_funds, public.api_provider_fund_events
  from anon, authenticated;

-- ── writers (admin session) ────────────────────────────────────────────────
create or replace function public.api_reserve_settings_save(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tz text := coalesce(nullif(btrim(p->>'report_timezone'), ''), 'Europe/Warsaw');
begin
  if not public.is_admin() then raise exception 'not_admin' using errcode = '42501'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'bad_input'; end if;
  -- An unknown zone name raises here, before anything is written.
  perform now() at time zone v_tz;
  update public.api_reserve_settings set
    enabled = coalesce((p->>'enabled')::boolean, enabled),
    buffer_percent = coalesce((p->>'buffer_percent')::numeric, buffer_percent),
    horizon_days = coalesce((p->>'horizon_days')::integer, horizon_days),
    scenario = coalesce(p->>'scenario', scenario),
    cautious_factor = coalesce((p->>'cautious_factor')::numeric, cautious_factor),
    history_days = coalesce((p->>'history_days')::integer, history_days),
    min_history_credits = coalesce((p->>'min_history_credits')::numeric, min_history_credits),
    daily_report_hour = coalesce((p->>'daily_report_hour')::smallint, daily_report_hour),
    report_timezone = v_tz,
    hourly_skip_empty = coalesce((p->>'hourly_skip_empty')::boolean, hourly_skip_empty),
    alert_repeat_hours = coalesce((p->>'alert_repeat_hours')::integer, alert_repeat_hours),
    updated_at = now(), updated_by = auth.uid()
  where id = 'main';
  return (select to_jsonb(s) from public.api_reserve_settings s where id = 'main');
end $$;
revoke all on function public.api_reserve_settings_save(jsonb) from public, anon;
grant execute on function public.api_reserve_settings_save(jsonb) to authenticated;

create or replace function public.api_provider_funds_save(p_provider uuid, p jsonb)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not_admin' using errcode = '42501'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'bad_input'; end if;
  if not exists (select 1 from public.ai_providers where id = p_provider) then raise exception 'not_found'; end if;
  insert into public.api_provider_funds (provider_id) values (p_provider) on conflict (provider_id) do nothing;
  update public.api_provider_funds set
    mode = coalesce(p->>'mode', mode),
    warn_usd_micros = coalesce((p->>'warn_usd_micros')::bigint, warn_usd_micros),
    critical_usd_micros = coalesce((p->>'critical_usd_micros')::bigint, critical_usd_micros),
    credit_limit_usd_micros = case when p ? 'credit_limit_usd_micros' then (p->>'credit_limit_usd_micros')::bigint else credit_limit_usd_micros end,
    billing_url = case when p ? 'billing_url' then nullif(btrim(p->>'billing_url'), '') else billing_url end,
    updated_at = now(), updated_by = auth.uid()
  where provider_id = p_provider;
end $$;
revoke all on function public.api_provider_funds_save(uuid, jsonb) from public, anon;
grant execute on function public.api_provider_funds_save(uuid, jsonb) to authenticated;

-- balance_set: "the provider shows X now" (a new manual base);
-- topup: "I added X" (raises the estimate from the current base);
-- correction: ± X on the estimate (with a note).
create or replace function public.api_provider_fund_record(p_provider uuid, p_kind text, p_amount_usd_micros bigint, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not_admin' using errcode = '42501'; end if;
  if p_kind not in ('balance_set', 'topup', 'correction') or p_amount_usd_micros is null then raise exception 'bad_input'; end if;
  if p_kind in ('balance_set', 'topup') and p_amount_usd_micros < 0 then raise exception 'bad_input'; end if;
  if abs(p_amount_usd_micros) > 100000000000000 then raise exception 'bad_input'; end if;
  if not exists (select 1 from public.ai_providers where id = p_provider) then raise exception 'not_found'; end if;
  insert into public.api_provider_funds (provider_id) values (p_provider) on conflict (provider_id) do nothing;
  if p_kind = 'balance_set' then
    update public.api_provider_funds
       set balance_usd_micros = p_amount_usd_micros, balance_basis = 'manual', balance_at = now(),
           updated_at = now(), updated_by = auth.uid()
     where provider_id = p_provider;
  end if;
  insert into public.api_provider_fund_events (provider_id, kind, amount_usd_micros, balance_usd_micros, note, created_by)
  values (p_provider, p_kind, p_amount_usd_micros,
          case when p_kind = 'balance_set' then p_amount_usd_micros end,
          left(nullif(btrim(coalesce(p_note, '')), ''), 300), auth.uid());
end $$;
revoke all on function public.api_provider_fund_record(uuid, text, bigint, text) from public, anon;
grant execute on function public.api_provider_fund_record(uuid, text, bigint, text) to authenticated;

-- The app's synchronisation result (official balance APIs). Server token or
-- an admin session. A failed sync keeps the last confirmed balance and says so.
create or replace function public.api_provider_sync_record(p_token text, p_slug text, p_status text, p_balance_usd_micros bigint, p_error text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_provider uuid;
begin
  if not (public.is_admin() or public.server_call_ok(p_token)) then raise exception 'not_admin' using errcode = '42501'; end if;
  if p_status not in ('ok', 'error', 'unsupported', 'not_configured') then raise exception 'bad_input'; end if;
  select id into v_provider from public.ai_providers where slug = p_slug;
  if v_provider is null then raise exception 'not_found'; end if;
  insert into public.api_provider_funds (provider_id) values (v_provider) on conflict (provider_id) do nothing;
  if p_status = 'ok' and p_balance_usd_micros is not null then
    update public.api_provider_funds
       set balance_usd_micros = p_balance_usd_micros, balance_basis = 'confirmed', balance_at = now(),
           last_sync_at = now(), last_sync_status = 'ok', last_sync_error_safe = null
     where provider_id = v_provider;
    insert into public.api_provider_fund_events (provider_id, kind, amount_usd_micros, balance_usd_micros, note)
    values (v_provider, 'sync', p_balance_usd_micros, p_balance_usd_micros, null);
  else
    update public.api_provider_funds
       set last_sync_at = now(), last_sync_status = p_status, last_sync_error_safe = left(p_error, 300)
     where provider_id = v_provider;
  end if;
end $$;
revoke all on function public.api_provider_sync_record(text, text, text, bigint, text) from public, anon;
grant execute on function public.api_provider_sync_record(text, text, text, bigint, text) to anon, authenticated;

-- 3 ─────────────────────────────────────────────────────────────────────────
create or replace function public.api_reserve_snapshot(p_token text default null)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  s public.api_reserve_settings;
  v_now timestamptz := now();
  v_tz text;
  v_today timestamptz;
  v_month timestamptz;
  v_hist timestamptz;
  v_from timestamptz;
  v_h interval;
  v_out jsonb;
begin
  if not (public.is_admin() or public.server_call_ok(p_token)) then raise exception 'not_admin' using errcode = '42501'; end if;
  select * into s from public.api_reserve_settings where id = 'main';
  v_tz := coalesce(s.report_timezone, 'Europe/Warsaw');
  v_today := date_trunc('day', v_now at time zone v_tz) at time zone v_tz;
  v_month := date_trunc('month', v_now at time zone v_tz) at time zone v_tz;
  v_hist := v_now - make_interval(days => coalesce(s.history_days, 90));
  v_from := least(v_month, v_now - interval '30 days', v_hist);
  v_h := make_interval(days => coalesce(s.horizon_days, 30));

  with internal as (
    select w.id from public.workspaces w where public.finance_is_internal(w.id)
  ), calls as (
    select c.provider_slug, c.created_at, c.cost_usd_micros as cost, c.status,
           case when c.actor_kind = 'admin' then 'internal'
                when c.actor_kind = 'system' then 'system'
                when c.workspace_id in (select id from internal) then 'internal'
                else 'customer' end as cls
      from public.ai_provider_calls c
     where c.created_at >= v_from
  ), spend as (
    select provider_slug, cls,
      coalesce(sum(cost) filter (where created_at >= v_now - interval '1 hour'), 0) as h1,
      coalesce(sum(cost) filter (where created_at >= v_today), 0) as today,
      coalesce(sum(cost) filter (where created_at >= v_now - interval '24 hours'), 0) as d1,
      coalesce(sum(cost) filter (where created_at >= v_now - interval '7 days'), 0) as d7,
      coalesce(sum(cost) filter (where created_at >= v_now - interval '30 days'), 0) as d30,
      coalesce(sum(cost) filter (where created_at >= v_month), 0) as month,
      coalesce(sum(cost) filter (where created_at >= v_hist), 0) as hist,
      count(*) filter (where created_at >= v_now - interval '1 hour') as calls_h1,
      count(*) filter (where created_at >= v_today) as calls_today,
      count(*) filter (where created_at >= v_now - interval '24 hours') as calls_d1,
      count(*) filter (where created_at >= v_month) as calls_month,
      count(*) filter (where created_at >= v_now - interval '30 days') as calls_d30,
      count(*) filter (where cost is null and created_at >= v_now - interval '1 hour') as unknown_h1,
      count(*) filter (where cost is null and created_at >= v_today) as unknown_today,
      count(*) filter (where cost is null and created_at >= v_month) as unknown_month,
      count(*) filter (where cost is null and created_at >= v_now - interval '30 days') as unknown_d30,
      count(*) filter (where status = 'failed' and coalesce(cost, 0) > 0 and created_at >= v_month) as failed_paid_month
    from calls group by provider_slug, cls
  ), lots as (
    select l.kind, l.remaining, l.expires_at, (w.workspace_id in (select id from internal)) as internal
      from public.credit_lots l join public.credit_wallets w on w.id = l.wallet_id
     where l.remaining > 0 and (l.kind <> 'subscription' or l.expires_at > v_now)
  ), tranches as (
    select t.credits, t.starts_at, (t.workspace_id in (select id from internal)) as internal
      from public.subscription_tranches t where t.status = 'pending'
  ), tx as (
    select t.type, t.amount, t.created_at, t.metadata, (w.workspace_id in (select id from internal)) as internal
      from public.credit_transactions t join public.credit_wallets w on w.id = t.wallet_id
     where t.created_at >= least(v_from, v_hist)
  ), expired_lots as (
    select l.id, l.amount
      from public.credit_lots l join public.credit_wallets w on w.id = l.wallet_id
     where l.kind = 'subscription' and l.expires_at >= v_hist and l.expires_at <= v_now
       and not (w.workspace_id in (select id from internal))
  ), pays as (
    select p.kind, p.amount_cents, upper(p.currency) as currency, p.created_at,
           coalesce(p.metadata->>'billing_reason', '') as reason
      from public.payments p
     where p.status = 'succeeded' and p.created_at >= least(v_month, v_now - interval '24 hours')
       and (p.workspace_id is null or not (p.workspace_id in (select id from internal)))
  )
  select jsonb_build_object(
    'now', v_now, 'today_start', v_today, 'month_start', v_month, 'history_start', v_hist,
    'settings', to_jsonb(s),
    'spend', coalesce((select jsonb_agg(to_jsonb(x)) from spend x), '[]'::jsonb),
    'pools', (select jsonb_object_agg(cls, j) from (
        select case when internal then 'internal' else 'customer' end as cls, jsonb_build_object(
          'subscription', coalesce(sum(remaining) filter (where kind = 'subscription'), 0),
          'topup', coalesce(sum(remaining) filter (where kind = 'topup'), 0),
          'bonus', coalesce(sum(remaining) filter (where kind = 'bonus'), 0),
          'legacy', coalesce(sum(remaining) filter (where kind = 'legacy'), 0),
          'expiring_24h', coalesce(sum(remaining) filter (where kind = 'subscription' and expires_at <= v_now + interval '24 hours'), 0),
          'expiring_7d', coalesce(sum(remaining) filter (where kind = 'subscription' and expires_at <= v_now + interval '7 days'), 0),
          'expiring_horizon', coalesce(sum(remaining) filter (where kind = 'subscription' and expires_at <= v_now + v_h), 0)) as j
          from lots group by 1) z),
    'tranches', (select jsonb_object_agg(cls, j) from (
        select case when internal then 'internal' else 'customer' end as cls, jsonb_build_object(
          'total', coalesce(sum(credits), 0),
          'within_24h', coalesce(sum(credits) filter (where starts_at <= v_now + interval '24 hours'), 0),
          'within_7d', coalesce(sum(credits) filter (where starts_at <= v_now + interval '7 days'), 0),
          'within_horizon', coalesce(sum(credits) filter (where starts_at <= v_now + v_h), 0)) as j
          from tranches group by 1) z),
    'credits_month', (select jsonb_object_agg(cls, j) from (
        select case when internal then 'internal' else 'customer' end as cls, jsonb_build_object(
          'granted_subscription', coalesce(sum(amount) filter (where type = 'subscription' and amount > 0 and created_at >= v_month), 0),
          'granted_topup', coalesce(sum(amount) filter (where type in ('topup', 'purchase') and amount > 0 and created_at >= v_month), 0),
          'granted_bonus', coalesce(sum(amount) filter (where type in ('bonus', 'promotion', 'admin_grant', 'admin_adjustment', 'manual_adjustment') and amount > 0 and created_at >= v_month), 0),
          'used', coalesce(-sum(amount) filter (where type in ('generation', 'refund') and created_at >= v_month), 0),
          'expired', coalesce(-sum(amount) filter (where type = 'expiration' and created_at >= v_month), 0),
          'used_d1', coalesce(-sum(amount) filter (where type in ('generation', 'refund') and created_at >= v_now - interval '24 hours'), 0),
          'used_today', coalesce(-sum(amount) filter (where type in ('generation', 'refund') and created_at >= v_today), 0),
          'used_d7', coalesce(-sum(amount) filter (where type in ('generation', 'refund') and created_at >= v_now - interval '7 days'), 0),
          'used_d30', coalesce(-sum(amount) filter (where type in ('generation', 'refund') and created_at >= v_now - interval '30 days'), 0),
          'used_hist', coalesce(-sum(amount) filter (where type in ('generation', 'refund') and created_at >= v_hist), 0),
          'granted_today', coalesce(sum(amount) filter (where type in ('subscription', 'topup', 'purchase') and amount > 0 and created_at >= v_today), 0)) as j
          from tx group by 1) z),
    'expired_history', jsonb_build_object(
        'lots', (select count(*) from expired_lots),
        'granted', coalesce((select sum(amount) from expired_lots), 0),
        'unused', coalesce((select -sum(m.amount) from public.credit_lot_moves m
                              join public.credit_transactions t on t.id = m.tx_id
                             where m.lot_id in (select id from expired_lots) and t.type = 'expiration'
                               and coalesce(t.metadata->>'reason', 'period_end') = 'period_end'), 0)),
    'sales', jsonb_build_object(
        'h1', (select jsonb_build_object('count', count(*), 'new', count(*) filter (where kind = 'subscription' and reason = 'subscription_create'),
                 'renewals', count(*) filter (where kind = 'subscription' and reason = 'subscription_cycle'),
                 'changes', count(*) filter (where kind = 'subscription' and reason = 'subscription_update'),
                 'topups', count(*) filter (where kind <> 'subscription'),
                 'revenue', coalesce((select jsonb_object_agg(currency, cents) from (select currency, sum(amount_cents) cents from pays where created_at >= v_now - interval '1 hour' group by 1) r), '{}'::jsonb))
               from pays where created_at >= v_now - interval '1 hour'),
        'today', (select jsonb_build_object('count', count(*), 'new', count(*) filter (where kind = 'subscription' and reason = 'subscription_create'),
                 'renewals', count(*) filter (where kind = 'subscription' and reason = 'subscription_cycle'),
                 'changes', count(*) filter (where kind = 'subscription' and reason = 'subscription_update'),
                 'topups', count(*) filter (where kind <> 'subscription'),
                 'revenue', coalesce((select jsonb_object_agg(currency, cents) from (select currency, sum(amount_cents) cents from pays where created_at >= v_today group by 1) r), '{}'::jsonb))
               from pays where created_at >= v_today),
        'month', (select jsonb_build_object('count', count(*),
                 'revenue', coalesce((select jsonb_object_agg(currency, cents) from (select currency, sum(amount_cents) cents from pays where created_at >= v_month group by 1) r), '{}'::jsonb))
               from pays where created_at >= v_month)),
    'providers', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'slug', p.slug, 'name', p.name, 'active', p.active,
        'has_key', exists (select 1 from public.ai_provider_credentials k where k.provider_id = p.id and k.active),
        'mode', coalesce(f.mode, 'manual'), 'balance', f.balance_usd_micros, 'basis', f.balance_basis, 'balance_at', f.balance_at,
        'credit_limit', f.credit_limit_usd_micros, 'warn', coalesce(f.warn_usd_micros, 20000000), 'critical', coalesce(f.critical_usd_micros, 5000000),
        'billing_url', f.billing_url, 'last_sync_at', f.last_sync_at, 'last_sync_status', f.last_sync_status, 'last_sync_error', f.last_sync_error_safe,
        'spend_since_balance', case when f.balance_at is null then null else
            (select coalesce(sum(c.cost_usd_micros), 0) from public.ai_provider_calls c where c.provider_slug = p.slug and c.created_at > f.balance_at) end,
        'unknown_since_balance', case when f.balance_at is null then null else
            (select count(*) from public.ai_provider_calls c where c.provider_slug = p.slug and c.created_at > f.balance_at and c.cost_usd_micros is null) end,
        'adjust_since_balance', case when f.balance_at is null then null else
            (select coalesce(sum(e.amount_usd_micros), 0) from public.api_provider_fund_events e
              where e.provider_id = p.id and e.kind in ('topup', 'correction') and e.created_at > f.balance_at) end,
        'events', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'amount', e.amount_usd_micros, 'balance', e.balance_usd_micros, 'note', e.note, 'at', e.created_at) order by e.created_at desc)
                              from (select * from public.api_provider_fund_events e2 where e2.provider_id = p.id order by e2.created_at desc limit 8) e), '[]'::jsonb))
        order by p.active desc, p.name)
      from public.ai_providers p left join public.api_provider_funds f on f.provider_id = p.id), '[]'::jsonb),
    'models', coalesce((select jsonb_agg(jsonb_build_object('provider', p.slug, 'model', m.model_identifier, 'name', coalesce(m.display_name, m.name),
        'pricing', m.pricing, 'credit_cost', m.credit_cost, 'customer', (m.visible_managed or m.visible_custom)))
        from public.ai_models m join public.ai_providers p on p.id = m.provider_id where m.active), '[]'::jsonb),
    'unit_prices', coalesce((select jsonb_agg(jsonb_build_object('provider', u.provider_slug, 'model', u.model, 'unit_kind', u.unit_kind,
        'resolution', u.resolution, 'quality', u.quality, 'usd_micros', u.usd_micros_per_unit)) from public.ai_unit_prices u), '[]'::jsonb)
  ) into v_out;
  return v_out;
end $$;
revoke all on function public.api_reserve_snapshot(text) from public, anon;
grant execute on function public.api_reserve_snapshot(text) to anon, authenticated;

-- One confirmed sale, for the after-sale report: what was paid and how many
-- credits it put (or scheduled) on the customer's account.
create or replace function public.api_reserve_sale_facts(p_token text, p_payment_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  p public.payments;
begin
  if not (public.is_admin() or public.server_call_ok(p_token)) then raise exception 'not_admin' using errcode = '42501'; end if;
  select * into p from public.payments where id = p_payment_id;
  if not found then return null; end if;
  return jsonb_build_object(
    'id', p.id, 'kind', p.kind, 'amount_cents', p.amount_cents, 'currency', upper(p.currency), 'status', p.status,
    'billing_period', p.billing_period, 'billing_reason', p.metadata->>'billing_reason', 'created_at', p.created_at,
    'plan_slug', (select sp.slug from public.subscription_plans sp where sp.id = p.plan_id),
    'plan_name', (select sp.name from public.subscription_plans sp where sp.id = p.plan_id),
    'internal', case when p.workspace_id is null then false else public.finance_is_internal(p.workspace_id) end,
    'credits_now', coalesce((select sum(l.amount) from public.credit_lots l where l.payment_id = p.id), 0),
    'credits_scheduled', coalesce((select sum(t.credits) from public.subscription_tranches t where t.payment_id = p.id and t.status = 'pending'), 0));
end $$;
revoke all on function public.api_reserve_sale_facts(text, uuid) from public, anon;
grant execute on function public.api_reserve_sale_facts(text, uuid) to anon, authenticated;

-- 4 ─────────────────────────────────────────────────────────────────────────
alter table public.notification_preferences
  add column if not exists admin_panel_enabled boolean not null default false;

alter table public.notification_outbox drop constraint if exists notification_outbox_channel_check;
alter table public.notification_outbox add constraint notification_outbox_channel_check
  check (channel in ('telegram', 'admin_email', 'admin_panel'));

-- 0055's function with ONE addition: an enabled admin_panel channel stores
-- the message as already delivered ('sent') — the panel is where it is read,
-- so the dispatcher (which claims only 'pending') never sees it. Everything
-- else is 0055 verbatim: token gate, oracle-free void, 500-row ceiling,
-- 8000-character payload cap, one dedupe key per event across channels.
create or replace function public.enqueue_notification(
  p_event text,
  p_payload jsonb default '{}'::jsonb,
  p_dedupe text default null,
  p_token text default null
) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_dedupe text := left(nullif(btrim(coalesce(p_dedupe, '')), ''), 200);
  v_hash text;
  v_telegram boolean;
  v_admin_email boolean;
  v_admin_panel boolean;
begin
  select value->>'dispatch_hash' into v_hash
    from public.app_settings where key = 'notifications';

  if v_hash is null or v_hash = '' then
    return;
  end if;
  if encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') is distinct from v_hash then
    return;
  end if;

  select p.telegram_enabled, p.admin_email_enabled, p.admin_panel_enabled
    into v_telegram, v_admin_email, v_admin_panel
    from public.notification_preferences p
   where p.event_type = p_event;

  if not coalesce(v_telegram, false) and not coalesce(v_admin_email, false) and not coalesce(v_admin_panel, false) then
    return;
  end if;

  if (select count(*) from public.notification_outbox where status = 'pending') >= 500 then
    return;
  end if;

  if length(v_payload::text) > 8000 then
    v_payload := '{}'::jsonb;
  end if;

  if coalesce(v_telegram, false) then
    insert into public.notification_outbox (event_type, payload, dedupe_key, channel)
    values (p_event, v_payload, v_dedupe, 'telegram')
    on conflict (channel, dedupe_key) where dedupe_key is not null do nothing;
  end if;

  if coalesce(v_admin_email, false) then
    insert into public.notification_outbox (event_type, payload, dedupe_key, channel)
    values (p_event, v_payload, v_dedupe, 'admin_email')
    on conflict (channel, dedupe_key) where dedupe_key is not null do nothing;
  end if;

  if coalesce(v_admin_panel, false) then
    insert into public.notification_outbox (event_type, payload, dedupe_key, channel, status, sent_at)
    values (p_event, v_payload, v_dedupe, 'admin_panel', 'sent', now())
    on conflict (channel, dedupe_key) where dedupe_key is not null do nothing;
  end if;
end;
$$;
revoke execute on function public.enqueue_notification(text, jsonb, text, text) from public;
grant execute on function public.enqueue_notification(text, jsonb, text, text) to anon, authenticated;

-- 5 ─────────────────────────────────────────────────────────────────────────
-- The four events. Defaults: everything lands in the panel; the after-sale
-- report and the low-funds alert also on Telegram; the daily report and the
-- alert also by e-mail; the hourly report only in the panel. Inserted once —
-- an admin's later choice is never switched back by a re-run.
insert into public.notification_preferences (event_type, category, sort_order, telegram_enabled, admin_email_enabled, admin_panel_enabled)
values
  ('finance.reserve_sale', 'finance', 110, true, false, true),
  ('finance.reserve_hourly', 'finance', 120, false, false, true),
  ('finance.reserve_daily', 'finance', 130, true, true, true),
  ('finance.funds_low', 'finance', 140, true, true, true)
on conflict (event_type) do nothing;

-- 6 ─────────────────────────────────────────────────────────────────────────
-- Every 15 minutes: wake /api/cron/reserves (the app decides what is due —
-- hourly report, the daily report at its local hour, low-funds alerts with
-- their own repeat window — and dedupe keys make a repeated wake harmless).
-- The destination is the operator's own: grovbase.reserves.worker_url when
-- set, otherwise the origin of the newsletter worker URL already stored in
-- Vault; the credential is the dispatch token stored there. Nothing is
-- guessed: without them the tick returns 'not_configured' and posts nothing.
create or replace function public.api_reserves_cron_tick()
returns text
language plpgsql security definer set search_path = public, vault, extensions as $$
declare
  v_enabled boolean;
  v_url text;
  v_base text;
  v_token text;
  v_fn text;
  v_request bigint;
begin
  select enabled into v_enabled from public.api_reserve_settings where id = 'main';
  if not coalesce(v_enabled, false) then return 'disabled'; end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'grovbase.reserves.worker_url';
  if v_url is null or btrim(v_url) = '' then
    select decrypted_secret into v_base from vault.decrypted_secrets where name = 'grovbase.newsletter.worker_url';
    if v_base ~ '^https://[^/]+' then
      v_url := substring(v_base from '^(https://[^/]+)') || '/api/cron/reserves';
    end if;
  end if;
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'grovbase.newsletter.worker_token';
  if v_url is null or btrim(v_url) = '' or v_token is null or btrim(v_token) = '' then
    return 'not_configured';
  end if;

  select n.nspname || '.' || p.proname into v_fn
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.proname = 'http_post' and n.nspname in ('net', 'extensions', 'public')
   order by case n.nspname when 'net' then 0 when 'extensions' then 1 else 2 end
   limit 1;
  if v_fn is null then return 'no_pg_net'; end if;

  -- Fire and forget, the way 0095 posts to the newsletter worker.
  execute format('select %s(url := $1, headers := $2, body := $3, timeout_milliseconds := $4)', v_fn)
    into v_request
    using btrim(v_url),
          jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || btrim(v_token)),
          '{}'::jsonb,
          30000;
  return 'posted:' || coalesce(v_request::text, '?');
end $$;
revoke all on function public.api_reserves_cron_tick() from public, anon, authenticated;

do $$
declare
  v_existing integer;
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise notice 'api reserves: pg_cron is absent; schedule api_reserves_cron_tick() by other means.';
    return;
  end if;
  execute 'select count(*) from cron.job where jobname = $1' into v_existing using 'grovbase-api-reserves';
  if v_existing > 0 then execute 'select cron.unschedule($1)' using 'grovbase-api-reserves'; end if;
  execute 'select cron.schedule($1, $2, $3)'
    using 'grovbase-api-reserves', '*/15 * * * *', 'select public.api_reserves_cron_tick();';
end $$;

comment on table public.api_provider_funds is
  'API Reserve Center (0180): how each provider''s money is known — auto (official balance API), manual (admin-entered, estimated after), postpaid (no prepaid balance). NULL = unknown, never 0. Admin only.';
