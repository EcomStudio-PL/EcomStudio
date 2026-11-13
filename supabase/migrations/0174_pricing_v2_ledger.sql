-- 0174 — CENNIK V2 (2/3): exact fractional credits, credit pools, annual
-- tranches, server-approved top-up orders.
--
-- WHAT THIS MIGRATION DOES NOT DO: it changes no balance, no ledger row, no
-- price and no plan. Every existing wallet keeps its exact balance; the
-- balance is simply recorded as a "legacy" pool that never expires and is
-- always spendable (admin and test accounts keep testing as before). Prices
-- move in 0175, in one transaction, only after the Stripe Prices exist.
--
-- 1. FRACTIONS. Tool prices now include 0.5 / 0.75 / 1.25 / 1.75 credits.
--    Every credit amount becomes numeric(14,2): an EXACT decimal (hundredths),
--    so 0.1 + 0.2 is 0.30 here, never 0.30000000000000004. A type change, not
--    an UPDATE: 49788 stays 49788.00. apply_credit_transaction refuses any
--    amount with more than two decimals instead of rounding it.
--
-- 2. POOLS (credit_lots). The wallet balance stays the one number every screen
--    reads; underneath it, each grant is a lot:
--      subscription  a paid month's credits — expire at the end of that month
--      topup         bought with a top-up — never expire, spendable only while
--                    the workspace has an active paid plan (kept, not lost,
--                    when the plan ends; usable again when one is bought)
--      bonus         welcome bonus, pre-launch rewards, admin grants, refunds
--                    of charges older than this migration — never expire,
--                    always spendable (the behaviour every credit had so far)
--      legacy        the balance each wallet held before this migration
--    A charge takes subscription credits first (earliest expiry first), then
--    top-ups, then bonus/legacy. Every movement in or out of a lot is a row in
--    credit_lot_moves tied to the ledger entry that caused it, so a refund goes
--    back to the very lots the charge came from, and revenue can be attributed
--    to the purchase that paid for each credit used.
--    INVARIANT: wallet.balance = sum(lots.remaining) — credit_lots_audit().
--
-- 3. ANNUAL PLANS (subscription_tranches). One payment, twelve monthly grants.
--    Tranche 1 is granted when the invoice is paid (webhook); 2..12 by the
--    pg_cron tick below when their month starts. Dates are calendar months
--    from the paid period's start, in UTC (Jan 31 + 1 month = Feb 28/29). A
--    tranche is granted at most once: its row is locked, its status checked,
--    and credit_lots has a UNIQUE index on tranche_id, so a retried or late
--    tick cannot grant it twice.
--
-- 4. TOP-UP ORDERS (credit_orders). The amount and the credits of a top-up are
--    decided by the server and stored BEFORE the payment is created; the
--    webhook grants the order's credits only if Stripe reports exactly the
--    order's amount and currency for that workspace. Metadata never decides.
--
-- Everything that writes is SECURITY DEFINER and either server-token gated or
-- revoked from clients; members may only READ their own lots and tranches.

set check_function_bodies = off;

/* ── 0. a restorable copy of the pricing configuration before 0175 ─────────*/

create table if not exists public.billing_config_snapshots (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  taken_at timestamptz not null default now(),
  data jsonb not null
);
alter table public.billing_config_snapshots enable row level security;
revoke all on public.billing_config_snapshots from anon, authenticated;
drop policy if exists billing_config_snapshots_admin_read on public.billing_config_snapshots;
create policy billing_config_snapshots_admin_read on public.billing_config_snapshots
  for select to authenticated using (public.is_admin(auth.uid()));
grant select on public.billing_config_snapshots to authenticated;

insert into public.billing_config_snapshots (label, data)
select 'before-pricing-v2', jsonb_build_object(
  'plans', (select jsonb_agg(to_jsonb(p) order by p.sort_order) from public.subscription_plans p),
  'packages', (select jsonb_agg(to_jsonb(c) order by c.sort_order) from public.credit_packages c),
  'models', (select jsonb_agg(jsonb_build_object('id', m.id, 'model_identifier', m.model_identifier, 'name', m.name,
                'credit_cost', m.credit_cost, 'pricing', m.pricing, 'metadata', m.metadata)) from public.ai_models m),
  'services', (select jsonb_agg(jsonb_build_object('slug', s.slug, 'credits_cost', s.credits_cost)) from public.service_catalog s),
  'wallets', (select jsonb_agg(jsonb_build_object('id', w.id, 'workspace_id', w.workspace_id, 'balance', w.balance)) from public.credit_wallets w))
where not exists (select 1 from public.billing_config_snapshots where label = 'before-pricing-v2');

/* ── 1. exact fractional credits ───────────────────────────────────────────*/

alter table public.credit_wallets alter column balance type numeric(14,2);
alter table public.credit_transactions
  alter column amount type numeric(14,2),
  alter column balance_before type numeric(14,2),
  alter column balance_after type numeric(14,2);
alter table public.usage_events alter column credits_charged type numeric(14,2);
alter table public.payments alter column credits_granted type numeric(14,2);
alter table public.generation_jobs alter column credits_charged type numeric(14,2);
alter table public.ai_engine_runs alter column credits type numeric(14,2);
alter table public.ai_models alter column credit_cost type numeric(10,2);
alter table public.service_catalog alter column credits_cost type numeric(10,2);

-- What a payment cost to take, when Stripe reports it (balance transaction),
-- and the billing period of a subscription payment. Analytics only.
alter table public.payments
  add column if not exists billing_period text,
  add column if not exists stripe_fee_amount integer,
  add column if not exists stripe_fee_currency text,
  add column if not exists stripe_net_amount integer,
  add column if not exists stripe_exchange_rate numeric,
  add column if not exists tax_cents integer;

/* ── 2. pools ──────────────────────────────────────────────────────────────*/

create table if not exists public.credit_lots (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.credit_wallets(id) on delete cascade,
  kind text not null check (kind in ('subscription', 'topup', 'bonus', 'legacy')),
  amount numeric(14,2) not null check (amount > 0),
  remaining numeric(14,2) not null check (remaining >= 0 and remaining <= amount),
  expires_at timestamptz,
  source_tx_id uuid references public.credit_transactions(id) on delete set null,
  payment_id uuid references public.payments(id) on delete set null,
  provider_subscription_id text,
  plan_id uuid references public.subscription_plans(id) on delete set null,
  billing_period text check (billing_period is null or billing_period in ('monthly', 'annual')),
  tranche_id uuid,
  expired_at timestamptz,
  created_at timestamptz not null default now(),
  constraint credit_lots_subscription_expires check (kind <> 'subscription' or expires_at is not null)
);
create index if not exists credit_lots_wallet_open on public.credit_lots (wallet_id) where remaining > 0;
create index if not exists credit_lots_expiring on public.credit_lots (expires_at) where kind = 'subscription' and remaining > 0;
create index if not exists credit_lots_subscription on public.credit_lots (provider_subscription_id) where provider_subscription_id is not null;
create unique index if not exists credit_lots_one_per_tranche on public.credit_lots (tranche_id) where tranche_id is not null;

create table if not exists public.credit_lot_moves (
  id bigint generated always as identity primary key,
  lot_id uuid not null references public.credit_lots(id) on delete cascade,
  tx_id uuid not null references public.credit_transactions(id) on delete cascade,
  amount numeric(14,2) not null check (amount <> 0),
  created_at timestamptz not null default now()
);
create index if not exists credit_lot_moves_tx on public.credit_lot_moves (tx_id);
create index if not exists credit_lot_moves_lot on public.credit_lot_moves (lot_id);

create table if not exists public.subscription_tranches (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.credit_wallets(id) on delete cascade,
  workspace_id uuid not null,
  payment_id uuid not null references public.payments(id),
  provider_subscription_id text,
  plan_id uuid not null references public.subscription_plans(id),
  tranche_no smallint not null check (tranche_no between 1 and 12),
  credits numeric(14,2) not null check (credits > 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'granted', 'void')),
  granted_tx_id uuid references public.credit_transactions(id),
  lot_id uuid references public.credit_lots(id),
  granted_at timestamptz,
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz not null default now(),
  constraint subscription_tranches_window check (ends_at > starts_at),
  constraint subscription_tranches_once unique (payment_id, tranche_no)
);
create index if not exists subscription_tranches_due on public.subscription_tranches (starts_at) where status = 'pending';
create index if not exists subscription_tranches_sub on public.subscription_tranches (provider_subscription_id);

alter table public.credit_lots drop constraint if exists credit_lots_tranche_fk;
alter table public.credit_lots add constraint credit_lots_tranche_fk
  foreign key (tranche_id) references public.subscription_tranches(id) on delete set null;

create table if not exists public.credit_orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  credits integer not null check (credits > 0),
  amount_cents integer not null check (amount_cents > 0),
  currency text not null,
  pricing_version text not null,
  status text not null default 'open' check (status in ('open', 'paid', 'canceled')),
  provider_payment_id text unique,
  payment_id uuid references public.payments(id),
  created_by uuid,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists credit_orders_workspace on public.credit_orders (workspace_id, created_at desc);

-- Members READ their own pools and schedule (the wallet breakdown); nobody
-- writes them except the definer functions below. Orders: server only.
alter table public.credit_lots enable row level security;
alter table public.credit_lot_moves enable row level security;
alter table public.subscription_tranches enable row level security;
alter table public.credit_orders enable row level security;
revoke all on public.credit_lots, public.credit_lot_moves, public.subscription_tranches, public.credit_orders from anon, authenticated;
grant select on public.credit_lots, public.subscription_tranches to authenticated;

drop policy if exists credit_lots_member_read on public.credit_lots;
create policy credit_lots_member_read on public.credit_lots for select to authenticated
  using (exists (select 1 from public.credit_wallets w where w.id = wallet_id
                  and (public.is_workspace_member(w.workspace_id) or public.is_admin(auth.uid()))));
drop policy if exists subscription_tranches_member_read on public.subscription_tranches;
create policy subscription_tranches_member_read on public.subscription_tranches for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_admin(auth.uid()));
-- Admin analytics reads moves and orders through admin-only definer functions.

/* ── 3. THE LEDGER — one door, now with pools ──────────────────────────────*/

-- The integer signature is replaced, not overloaded: one function may move a
-- balance, and callers that pass an integer reach it through the implicit cast.
drop function if exists public.apply_credit_transaction(uuid, integer, public.credit_tx_type, text, uuid, jsonb, uuid);

create or replace function public.credit_plan_live(p_workspace_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.subscriptions s
                  where s.workspace_id = p_workspace_id and s.status = 'active'
                    and (s.current_period_end is null or s.current_period_end > now()));
$$;
revoke all on function public.credit_plan_live(uuid) from public, anon;
grant execute on function public.credit_plan_live(uuid) to authenticated, service_role;

create or replace function public.apply_credit_transaction(
  p_wallet_id uuid,
  p_amount numeric,
  p_type public.credit_tx_type,
  p_description text default null,
  p_reference_id uuid default null,
  p_metadata jsonb default '{}'::jsonb,
  p_created_by uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_amount numeric(14,2);
  v_balance numeric(14,2);
  v_ws uuid;
  v_tx uuid;
  v_need numeric(14,2);
  v_take numeric(14,2);
  v_kind text;
  v_expires timestamptz;
  v_lot uuid;
  v_row record;
  v_debit uuid;
  v_live boolean;
  v_any boolean;
begin
  if p_amount is null or p_amount = 0 then raise exception 'invalid_amount'; end if;
  v_amount := round(p_amount, 2);
  -- Hundredths are the unit. A third decimal is a caller bug, not a rounding
  -- opportunity in anyone's favour.
  if v_amount <> p_amount then raise exception 'invalid_amount'; end if;

  select balance, workspace_id into v_balance, v_ws
    from public.credit_wallets where id = p_wallet_id for update;
  if not found then raise exception 'wallet_not_found'; end if;
  if v_balance + v_amount < 0 then raise exception 'insufficient_credits'; end if;

  insert into public.credit_transactions
      (wallet_id, amount, type, description, reference_id, metadata, created_by, balance_before, balance_after)
    values
      (p_wallet_id, v_amount, p_type, p_description, p_reference_id, v_meta, p_created_by, v_balance, v_balance + v_amount)
    returning id into v_tx;
  update public.credit_wallets set balance = v_balance + v_amount, updated_at = now() where id = p_wallet_id;

  if v_amount > 0 then
    v_need := v_amount;

    -- A REFUND OF A CHARGE goes back to the lots that charge took from, in
    -- reverse order, never more than was taken minus what was already returned.
    if p_type = 'refund' and p_reference_id is not null then
      select credit_tx_id into v_debit from public.usage_events where id = p_reference_id;
      if v_debit is not null then
        for v_row in
          select m.lot_id,
                 (-sum(m.amount))
                   - coalesce((select sum(r.amount) from public.credit_lot_moves r
                                 join public.credit_transactions rt on rt.id = r.tx_id
                                where r.lot_id = m.lot_id and r.amount > 0 and rt.type = 'refund'
                                  and rt.reference_id = p_reference_id and rt.id <> v_tx), 0) as open,
                 max(m.id) as last_move
            from public.credit_lot_moves m
           where m.tx_id = v_debit and m.amount < 0
           group by m.lot_id
           order by max(m.id) desc
        loop
          exit when v_need <= 0;
          continue when v_row.open <= 0;
          v_take := least(v_need, v_row.open);
          update public.credit_lots set remaining = remaining + v_take where id = v_row.lot_id;
          insert into public.credit_lot_moves (lot_id, tx_id, amount) values (v_row.lot_id, v_tx, v_take);
          v_need := v_need - v_take;
        end loop;
      end if;
      -- A charge from before the pools existed: its credits came from what is
      -- now the legacy pool, so that is where they return.
      if v_need > 0 then
        select id into v_lot from public.credit_lots
         where wallet_id = p_wallet_id and kind = 'legacy' order by created_at limit 1 for update;
        if v_lot is null then
          insert into public.credit_lots (wallet_id, kind, amount, remaining, source_tx_id)
          values (p_wallet_id, 'legacy', v_need, v_need, v_tx) returning id into v_lot;
        else
          update public.credit_lots set amount = amount + v_need, remaining = remaining + v_need where id = v_lot;
        end if;
        insert into public.credit_lot_moves (lot_id, tx_id, amount) values (v_lot, v_tx, v_need);
      end if;
      return v_tx;
    end if;

    -- A GRANT opens a lot. Its kind is the caller's statement when it makes
    -- one; otherwise purchases with a payment are top-ups and everything
    -- else (welcome bonus, rewards, admin grants) is bonus — exactly how
    -- those credits behaved before pools existed.
    v_kind := nullif(v_meta->>'lot_kind', '');
    if v_kind is null then
      v_kind := case
        when p_type = 'subscription' then 'subscription'
        when p_type in ('topup', 'purchase') and (v_meta ? 'payment_id') then 'topup'
        else 'bonus' end;
    end if;
    if v_kind not in ('subscription', 'topup', 'bonus') then raise exception 'invalid_lot_kind'; end if;
    v_expires := nullif(v_meta->>'lot_expires_at', '')::timestamptz;
    if v_kind = 'subscription' and v_expires is null then
      -- A subscription grant that did not say when it ends (a caller from
      -- before 0174): one month, never "forever".
      v_expires := now() + interval '1 month';
    end if;
    if v_kind <> 'subscription' then v_expires := null; end if;

    insert into public.credit_lots (wallet_id, kind, amount, remaining, expires_at, source_tx_id, payment_id,
                                    provider_subscription_id, plan_id, billing_period, tranche_id)
    values (p_wallet_id, v_kind, v_amount, v_amount, v_expires, v_tx,
            nullif(v_meta->>'payment_id', '')::uuid,
            nullif(v_meta->>'provider_subscription_id', ''),
            nullif(v_meta->>'plan_id', '')::uuid,
            nullif(v_meta->>'billing_period', ''),
            nullif(v_meta->>'tranche_id', '')::uuid)
    returning id into v_lot;
    insert into public.credit_lot_moves (lot_id, tx_id, amount) values (v_lot, v_tx, v_amount);
    return v_tx;
  end if;

  -- A DEBIT.
  v_need := -v_amount;

  -- Targeted: an expiry or a plan-change reversal names its lot.
  if v_meta ? 'lot_id' then
    select id, remaining into v_row from public.credit_lots
     where id = (v_meta->>'lot_id')::uuid and wallet_id = p_wallet_id for update;
    if not found or v_row.remaining < v_need then raise exception 'lot_insufficient'; end if;
    update public.credit_lots
       set remaining = remaining - v_need,
           expired_at = case when p_type = 'expiration' and remaining - v_need = 0 then now() else expired_at end
     where id = v_row.id;
    insert into public.credit_lot_moves (lot_id, tx_id, amount) values (v_row.id, v_tx, -v_need);
    return v_tx;
  end if;
  if p_type = 'expiration' then raise exception 'lot_required'; end if;

  -- Spending: subscription (earliest expiry first) → top-up (only with an
  -- active paid plan) → bonus / legacy. An administrator's correction may
  -- take any credit, locked top-ups included.
  v_live := public.credit_plan_live(v_ws);
  v_any := p_type in ('admin_adjustment', 'manual_adjustment');
  for v_row in
    select id, remaining from public.credit_lots
     where wallet_id = p_wallet_id and remaining > 0
       and (kind <> 'subscription' or expires_at > now())
       and (kind <> 'topup' or v_live or v_any)
     order by case kind when 'subscription' then 0 when 'topup' then 1 else 2 end,
              expires_at nulls last, created_at, id
     for update
  loop
    exit when v_need <= 0;
    v_take := least(v_need, v_row.remaining);
    update public.credit_lots set remaining = remaining - v_take where id = v_row.id;
    insert into public.credit_lot_moves (lot_id, tx_id, amount) values (v_row.id, v_tx, -v_take);
    v_need := v_need - v_take;
  end loop;
  if v_need > 0 then raise exception 'insufficient_credits'; end if;
  return v_tx;
end $$;
revoke all on function public.apply_credit_transaction(uuid, numeric, public.credit_tx_type, text, uuid, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.apply_credit_transaction(uuid, numeric, public.credit_tx_type, text, uuid, jsonb, uuid)
  to service_role;

-- Every existing balance becomes ONE legacy lot of exactly that size. An
-- INSERT into the new table; the wallets themselves are not written.
insert into public.credit_lots (wallet_id, kind, amount, remaining)
select w.id, 'legacy', w.balance, w.balance
  from public.credit_wallets w
 where w.balance > 0
   and not exists (select 1 from public.credit_lots l where l.wallet_id = w.id);

/* ── 4. what a member can spend right now ──────────────────────────────────*/

create or replace function public.credit_wallet_state(p_workspace_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_wallet uuid;
  v_balance numeric;
  v_live boolean;
  r record;
begin
  if not (public.is_workspace_member(p_workspace_id) or public.is_admin(auth.uid()) or public.server_request_ok()) then
    raise exception 'not_authorized';
  end if;
  select id, balance into v_wallet, v_balance from public.credit_wallets where workspace_id = p_workspace_id;
  if v_wallet is null then return null; end if;
  v_live := public.credit_plan_live(p_workspace_id);
  select
    coalesce(sum(remaining) filter (where kind = 'subscription' and expires_at > now()), 0) as subscription,
    coalesce(sum(remaining) filter (where kind = 'topup'), 0) as topup,
    coalesce(sum(remaining) filter (where kind in ('bonus', 'legacy')), 0) as bonus,
    coalesce(sum(remaining) filter (where kind = 'subscription' and expires_at <= now()), 0) as expiring_now,
    min(expires_at) filter (where kind = 'subscription' and expires_at > now() and remaining > 0) as next_expiry,
    coalesce(sum(remaining) filter (where kind = 'subscription' and expires_at > now()
              and expires_at = (select min(l2.expires_at) from public.credit_lots l2
                                 where l2.wallet_id = v_wallet and l2.kind = 'subscription'
                                   and l2.expires_at > now() and l2.remaining > 0)), 0) as next_expiry_amount
    into r
    from public.credit_lots where wallet_id = v_wallet and remaining > 0;
  return jsonb_build_object(
    'wallet_id', v_wallet,
    'balance', v_balance,
    'spendable', r.subscription + (case when v_live then r.topup else 0 end) + r.bonus,
    'subscription', r.subscription,
    'topup', r.topup,
    'topup_locked', case when v_live then 0 else r.topup end,
    'bonus', r.bonus,
    'plan_live', v_live,
    'next_expiry', r.next_expiry,
    'next_expiry_amount', r.next_expiry_amount);
end $$;
revoke all on function public.credit_wallet_state(uuid) from public, anon;
grant execute on function public.credit_wallet_state(uuid) to authenticated, service_role;

-- Admin / test check: every wallet whose balance differs from its lots.
create or replace function public.credit_lots_audit()
returns table (wallet_id uuid, balance numeric, lots numeric)
language sql stable security definer set search_path = public as $$
  select w.id, w.balance, coalesce((select sum(l.remaining) from public.credit_lots l where l.wallet_id = w.id), 0)
    from public.credit_wallets w
   where w.balance <> coalesce((select sum(l.remaining) from public.credit_lots l where l.wallet_id = w.id), 0)
     and (public.is_admin(auth.uid()) or auth.uid() is null);
$$;
revoke all on function public.credit_lots_audit() from public, anon;
grant execute on function public.credit_lots_audit() to authenticated, service_role;

/* ── 5. annual tranches and expiry ─────────────────────────────────────────*/

-- Grant one pending tranche (locked by the caller). Never twice: status and
-- the unique lot index both refuse a second grant.
create or replace function public.credit_tranche_grant(p_tranche_id uuid)
returns uuid
language plpgsql security definer set search_path = public set timezone = 'UTC' as $$
declare
  t public.subscription_tranches;
  v_tx uuid;
  v_lot uuid;
  v_expires timestamptz;
begin
  select * into t from public.subscription_tranches where id = p_tranche_id for update;
  if not found or t.status <> 'pending' then return null; end if;
  -- A tick that ran late (an outage) still gives the customer a full window.
  v_expires := case when t.ends_at > now() then t.ends_at else now() + (t.ends_at - t.starts_at) end;
  v_tx := public.apply_credit_transaction(
    t.wallet_id, t.credits, 'subscription',
    'Abonament roczny: przydział ' || t.tranche_no || '/12', t.payment_id,
    jsonb_build_object('lot_kind', 'subscription', 'lot_expires_at', v_expires, 'plan_id', t.plan_id,
                       'billing_period', 'annual', 'provider_subscription_id', t.provider_subscription_id,
                       'payment_id', t.payment_id, 'tranche_id', t.id, 'tranche_no', t.tranche_no),
    null);
  select id into v_lot from public.credit_lots where source_tx_id = v_tx;
  update public.subscription_tranches
     set status = 'granted', granted_tx_id = v_tx, lot_id = v_lot, granted_at = now()
   where id = t.id;
  return v_tx;
end $$;
revoke all on function public.credit_tranche_grant(uuid) from public, anon, authenticated;

-- Twelve monthly windows from the paid period's start (calendar months, UTC),
-- the last one ending at the period's end. A window shorter than a month (a
-- mid-year upgrade) gets that share of the monthly credits.
create or replace function public.credit_schedule_annual(
  p_wallet_id uuid, p_workspace_id uuid, p_payment_id uuid, p_subscription text, p_plan_id uuid,
  p_credits_per_month numeric, p_period_start timestamptz, p_period_end timestamptz
) returns integer
language plpgsql security definer set search_path = public set timezone = 'UTC' as $$
declare
  n integer := 0;
  s timestamptz;
  e timestamptz;
  full_end timestamptz;
  share numeric;
  credits numeric(14,2);
  v_id uuid;
begin
  if p_period_end <= p_period_start or p_credits_per_month <= 0 then raise exception 'invalid_schedule'; end if;
  loop
    n := n + 1;
    exit when n > 12;
    s := p_period_start + (n - 1) * interval '1 month';
    exit when s >= p_period_end;
    full_end := p_period_start + n * interval '1 month';
    e := least(full_end, p_period_end);
    share := extract(epoch from (e - s)) / extract(epoch from (full_end - s));
    credits := case when share >= 0.999 then p_credits_per_month else floor(p_credits_per_month * share * 100) / 100 end;
    continue when credits <= 0;
    insert into public.subscription_tranches (wallet_id, workspace_id, payment_id, provider_subscription_id, plan_id,
                                              tranche_no, credits, starts_at, ends_at)
    values (p_wallet_id, p_workspace_id, p_payment_id, p_subscription, p_plan_id, n, credits, s, e)
    on conflict (payment_id, tranche_no) do nothing
    returning id into v_id;
    -- The first window starts now: grant it with the payment.
    if v_id is not null and s <= now() then perform public.credit_tranche_grant(v_id); end if;
  end loop;
  return n - 1;
end $$;
revoke all on function public.credit_schedule_annual(uuid, uuid, uuid, text, uuid, numeric, timestamptz, timestamptz)
  from public, anon, authenticated;

-- Expire one subscription lot's remainder, through the ledger.
create or replace function public.credit_lot_expire(p_lot_id uuid, p_reason text default 'period_end')
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  l public.credit_lots;
begin
  select * into l from public.credit_lots where id = p_lot_id for update;
  if not found or l.remaining <= 0 then return null; end if;
  return public.apply_credit_transaction(
    l.wallet_id, -l.remaining, 'expiration',
    case when p_reason = 'period_end' then 'Wygaśnięcie kredytów abonamentowych' else 'Korekta kredytów po zmianie planu' end,
    l.payment_id,
    jsonb_build_object('lot_id', l.id, 'reason', p_reason, 'expires_at', l.expires_at), null);
end $$;
revoke all on function public.credit_lot_expire(uuid, text) from public, anon, authenticated;

-- THE TICK (pg_cron, every 10 minutes): due tranches first, then expiries.
-- Safe to run any number of times, late, or concurrently (row locks + SKIP
-- LOCKED); nothing a member does on a page can make it grant.
create or replace function public.credit_lots_tick(p_limit integer default 200)
returns jsonb
language plpgsql security definer set search_path = public set timezone = 'UTC' as $$
declare
  v_granted integer := 0;
  v_expired integer := 0;
  r record;
begin
  for r in
    select id from public.subscription_tranches
     where status = 'pending' and starts_at <= now()
     order by starts_at limit greatest(1, least(coalesce(p_limit, 200), 1000))
     for update skip locked
  loop
    if public.credit_tranche_grant(r.id) is not null then v_granted := v_granted + 1; end if;
  end loop;
  for r in
    select id from public.credit_lots
     where kind = 'subscription' and remaining > 0 and expires_at <= now()
     order by expires_at limit greatest(1, least(coalesce(p_limit, 200), 1000))
     for update skip locked
  loop
    if public.credit_lot_expire(r.id, 'period_end') is not null then v_expired := v_expired + 1; end if;
  end loop;
  return jsonb_build_object('granted', v_granted, 'expired', v_expired);
end $$;
revoke all on function public.credit_lots_tick(integer) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where command = 'select public.credit_lots_tick();') then
      perform cron.schedule('credit-lots-tick', '*/10 * * * *', 'select public.credit_lots_tick();');
    end if;
  end if;
end $$;

/* ── 6. top-up orders (server-approved price, before any payment) ──────────*/

create or replace function public.credit_order_create(
  p_token text, p_workspace_id uuid, p_credits integer, p_amount_cents integer, p_currency text, p_pricing_version text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if auth.uid() is null or not public.is_workspace_member(p_workspace_id) then raise exception 'not_authorized'; end if;
  if p_credits is null or p_credits <= 0 or p_amount_cents is null or p_amount_cents <= 0 then raise exception 'invalid_amount'; end if;
  insert into public.credit_orders (workspace_id, credits, amount_cents, currency, pricing_version, created_by)
  values (p_workspace_id, p_credits, p_amount_cents, upper(p_currency), p_pricing_version, auth.uid())
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.credit_order_create(text, uuid, integer, integer, text, text) from public, anon;
grant execute on function public.credit_order_create(text, uuid, integer, integer, text, text) to authenticated, service_role;

create or replace function public.credit_order_attach(p_token text, p_order_id uuid, p_provider_payment_id text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  update public.credit_orders set provider_payment_id = p_provider_payment_id
   where id = p_order_id and status = 'open' and provider_payment_id is null
     and public.is_workspace_member(workspace_id);
  get diagnostics v_n = row_count;
  return v_n = 1;
end $$;
revoke all on function public.credit_order_attach(text, uuid, text) from public, anon;
grant execute on function public.credit_order_attach(text, uuid, text) to authenticated, service_role;

/* ── 6b. the informational złoty rate (NBP), last good reading kept ────────*/

create table if not exists public.fx_rates (
  pair text not null,
  rate numeric(12,6) not null check (rate > 0),
  effective_date date not null,
  source text not null,
  table_no text,
  fetched_at timestamptz not null default now(),
  primary key (pair, effective_date)
);
alter table public.fx_rates enable row level security;
revoke all on public.fx_rates from anon, authenticated;
grant select on public.fx_rates to anon, authenticated;
drop policy if exists fx_rates_read on public.fx_rates;
create policy fx_rates_read on public.fx_rates for select to anon, authenticated using (true);

create or replace function public.fx_rate_store(p_token text, p_pair text, p_rate numeric, p_date date, p_source text, p_table text)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if p_rate is null or p_rate <= 0 or p_rate > 100 or p_date is null or p_date > current_date + 1 then return false; end if;
  insert into public.fx_rates (pair, rate, effective_date, source, table_no)
  values (upper(p_pair), p_rate, p_date, p_source, p_table)
  on conflict (pair, effective_date) do update set fetched_at = now();
  return true;
end $$;
revoke all on function public.fx_rate_store(text, text, numeric, date, text, text) from public;
grant execute on function public.fx_rate_store(text, text, numeric, date, text, text) to anon, authenticated, service_role;

/* ── 7. settlement v2 — subscriptions (monthly / annual / plan change) and
        top-up orders. Same two idempotency layers as stripe_settle_payment. */

create or replace function public.stripe_settle_v2(
  p_token text, p_event_id text, p_event_type text, p_workspace_id uuid,
  p_provider_payment_id text, p_amount_cents integer, p_currency text, p_kind text,
  p_plan_id uuid, p_stripe_customer_id text, p_metadata jsonb,
  p_grants jsonb, p_order_id uuid
) returns jsonb
language plpgsql security definer set search_path = public, extensions set timezone = 'UTC' as $$
declare
  v_payment_id uuid;
  v_wallet_id uuid;
  v_tx uuid;
  v_total numeric(14,2) := 0;
  v_order public.credit_orders;
  g jsonb;
  v_sub text;
  v_amount numeric(14,2);
  l record;
  v_left numeric(14,2);
  v_take numeric(14,2);
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if p_kind not in ('subscription', 'custom_credits') then raise exception 'invalid_kind'; end if;

  insert into public.payment_events (stripe_event_id, event_type, object_id, workspace_id, outcome, detail)
  values (p_event_id, p_event_type, p_provider_payment_id, p_workspace_id, 'processing', jsonb_build_object('kind', p_kind))
  on conflict (stripe_event_id) do nothing;
  if not found then return jsonb_build_object('status', 'duplicate_event'); end if;

  insert into public.payments (workspace_id, amount_cents, currency, status, provider, provider_payment_id,
                               kind, plan_id, stripe_customer_id, metadata, billing_period)
  values (p_workspace_id, p_amount_cents, upper(coalesce(nullif(p_currency, ''), 'USD')), 'succeeded', 'stripe',
          p_provider_payment_id, p_kind, p_plan_id, p_stripe_customer_id, coalesce(p_metadata, '{}'::jsonb),
          nullif(coalesce(p_metadata, '{}'::jsonb)->>'billing_period', ''))
  on conflict (provider, provider_payment_id) do nothing
  returning id into v_payment_id;
  if v_payment_id is null then
    update public.payment_events set outcome = 'already_settled' where stripe_event_id = p_event_id;
    return jsonb_build_object('status', 'already_settled');
  end if;

  select id into v_wallet_id from public.credit_wallets where workspace_id = p_workspace_id;
  if v_wallet_id is null then
    update public.payment_events set outcome = 'no_wallet' where stripe_event_id = p_event_id;
    return jsonb_build_object('status', 'settled_without_credits', 'payment_id', v_payment_id, 'reason', 'no_wallet');
  end if;

  -- A TOP-UP: the order the server priced, or nothing.
  if p_kind = 'custom_credits' then
    select * into v_order from public.credit_orders where id = p_order_id for update;
    if not found or v_order.workspace_id <> p_workspace_id or v_order.status <> 'open'
       or v_order.amount_cents <> p_amount_cents or upper(v_order.currency) <> upper(p_currency)
       or (v_order.provider_payment_id is not null and v_order.provider_payment_id <> p_provider_payment_id) then
      update public.payments set metadata = metadata || jsonb_build_object('anomaly', 'order_mismatch', 'needs_review', true,
             'order_id', p_order_id) where id = v_payment_id;
      update public.payment_events set outcome = 'order_mismatch' where stripe_event_id = p_event_id;
      return jsonb_build_object('status', 'order_mismatch', 'payment_id', v_payment_id);
    end if;
    v_tx := public.apply_credit_transaction(
      v_wallet_id, v_order.credits, 'topup', 'Doładowanie: ' || v_order.credits || ' kredytów', v_payment_id,
      jsonb_build_object('lot_kind', 'topup', 'payment_id', v_payment_id, 'order_id', v_order.id,
                         'stripe_event_id', p_event_id, 'stripe_payment_id', p_provider_payment_id), null);
    update public.credit_orders set status = 'paid', paid_at = now(), payment_id = v_payment_id,
           provider_payment_id = p_provider_payment_id where id = v_order.id;
    update public.payments set credits_granted = v_order.credits, credit_tx_id = v_tx where id = v_payment_id;
    update public.payment_events set outcome = 'applied',
           detail = detail || jsonb_build_object('payment_id', v_payment_id, 'credit_tx_id', v_tx)
     where stripe_event_id = p_event_id;
    return jsonb_build_object('status', 'applied', 'payment_id', v_payment_id, 'credit_tx_id', v_tx);
  end if;

  -- A SUBSCRIPTION INVOICE: the grants the server derived from its lines.
  for g in select * from jsonb_array_elements(coalesce(p_grants, '[]'::jsonb)) loop
    v_sub := nullif(g->>'subscription', '');
    if g->>'type' = 'lot' then
      v_amount := round((g->>'credits')::numeric, 2);
      if v_amount > 0 then
        v_tx := public.apply_credit_transaction(
          v_wallet_id, v_amount, 'subscription', coalesce(g->>'description', 'Abonament'), v_payment_id,
          jsonb_build_object('lot_kind', 'subscription', 'lot_expires_at', g->>'expires_at',
                             'plan_id', g->>'plan_id', 'billing_period', coalesce(g->>'billing_period', 'monthly'),
                             'provider_subscription_id', v_sub, 'payment_id', v_payment_id,
                             'stripe_event_id', p_event_id), null);
        v_total := v_total + v_amount;
      end if;
    elsif g->>'type' = 'annual' then
      perform public.credit_schedule_annual(
        v_wallet_id, p_workspace_id, v_payment_id, v_sub, (g->>'plan_id')::uuid,
        round((g->>'credits_per_month')::numeric, 2),
        (g->>'period_start')::timestamptz, (g->>'period_end')::timestamptz);
      select coalesce(sum(credits), 0) + v_total into v_total
        from public.subscription_tranches where payment_id = v_payment_id and status = 'granted';
    elsif g->>'type' = 'revert' then
      -- Credit for unused time of the previous plan: its future tranches are
      -- void and the unused share of its current credits is taken back —
      -- never more than what is left of them.
      update public.subscription_tranches set status = 'void', voided_at = now(), void_reason = 'plan_change'
       where provider_subscription_id = v_sub and status = 'pending';
      -- With an amount (a monthly plan: Stripe's credit line / the plan price),
      -- that much; without one (an annual plan), each current lot's unused
      -- share of its own window, by time.
      v_left := case when nullif(g->>'credits', '') is null then null else round((g->>'credits')::numeric, 2) end;
      for l in
        select id, remaining, amount, created_at, expires_at from public.credit_lots
         where wallet_id = v_wallet_id and provider_subscription_id = v_sub and kind = 'subscription'
           and remaining > 0 and expires_at > now()
           and (nullif(g->>'plan_id', '') is null or plan_id = (g->>'plan_id')::uuid)
         order by expires_at desc, created_at desc
         for update
      loop
        exit when v_left is not null and v_left <= 0;
        v_take := case when v_left is not null then least(v_left, l.remaining)
                       else least(l.remaining, floor(l.amount
                              * greatest(0, extract(epoch from (l.expires_at - now())))
                              / greatest(1, extract(epoch from (l.expires_at - l.created_at))) * 100) / 100) end;
        continue when v_take <= 0;
        perform public.apply_credit_transaction(
          v_wallet_id, -v_take, 'expiration', 'Korekta kredytów po zmianie planu', v_payment_id,
          jsonb_build_object('lot_id', l.id, 'reason', 'plan_change_proration', 'stripe_event_id', p_event_id), null);
        if v_left is not null then v_left := v_left - v_take; end if;
      end loop;
    end if;
  end loop;

  update public.payments set credits_granted = v_total where id = v_payment_id;
  update public.payment_events set outcome = 'applied',
         detail = detail || jsonb_build_object('payment_id', v_payment_id, 'credits', v_total)
   where stripe_event_id = p_event_id;
  return jsonb_build_object('status', 'applied', 'payment_id', v_payment_id, 'credits', v_total);
end $$;
revoke all on function public.stripe_settle_v2(text, text, text, uuid, text, integer, text, text, uuid, text, jsonb, jsonb, uuid)
  from public, anon;
grant execute on function public.stripe_settle_v2(text, text, text, uuid, text, integer, text, text, uuid, text, jsonb, jsonb, uuid)
  to anon, authenticated, service_role;

-- Which plan, and which billing period, a Stripe Price is — the mapping
-- columns are the authority (an invoice line names the Price it billed).
create or replace function public.stripe_plan_for_price(p_token text, p_price_id text)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare r public.subscription_plans;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if p_price_id is null or p_price_id = '' then return null; end if;
  select * into r from public.subscription_plans
   where stripe_price_id_monthly = p_price_id or stripe_price_id_annual = p_price_id limit 1;
  if not found then return null; end if;
  return jsonb_build_object('id', r.id, 'name', r.name, 'slug', r.slug,
    'credits', r.monthly_credits + r.bonus_credits,
    'period', case when r.stripe_price_id_annual = p_price_id then 'annual' else 'monthly' end,
    'price_cents', case when r.stripe_price_id_annual = p_price_id then r.annual_price_cents else r.price_cents end);
end $$;
revoke all on function public.stripe_plan_for_price(text, text) from public;
grant execute on function public.stripe_plan_for_price(text, text) to anon, authenticated, service_role;

-- What a payment cost to take (Stripe balance transaction). Analytics only,
-- written once; a payment without it reads "Brak danych".
create or replace function public.payment_record_fees(
  p_token text, p_provider_payment_id text, p_fee integer, p_net integer, p_currency text, p_exchange_rate numeric, p_tax_cents integer
) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  update public.payments
     set stripe_fee_amount = coalesce(stripe_fee_amount, p_fee),
         stripe_net_amount = coalesce(stripe_net_amount, p_net),
         stripe_fee_currency = coalesce(stripe_fee_currency, upper(p_currency)),
         stripe_exchange_rate = coalesce(stripe_exchange_rate, p_exchange_rate),
         tax_cents = coalesce(tax_cents, p_tax_cents)
   where provider = 'stripe' and provider_payment_id = p_provider_payment_id;
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;
revoke all on function public.payment_record_fees(text, text, integer, integer, text, numeric, integer) from public;
grant execute on function public.payment_record_fees(text, text, integer, integer, text, numeric, integer) to anon, authenticated, service_role;

-- A refund is still recorded and flagged, never clawed back (unchanged). Two
-- additions: an invoice is found by its PaymentIntent too, and a FULL refund
-- stops the future tranches of that payment (what was granted stays).
create or replace function public.stripe_record_refund(p_token text, p_event_id text, p_event_type text, p_provider_payment_id text, p_amount_cents integer, p_status text, p_metadata jsonb)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_payment public.payments%rowtype;
  v_void integer := 0;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  insert into public.payment_events (stripe_event_id, event_type, object_id, outcome)
  values (p_event_id, p_event_type, p_provider_payment_id, 'processing')
  on conflict (stripe_event_id) do nothing;
  if not found then return jsonb_build_object('status', 'duplicate_event'); end if;

  select * into v_payment from public.payments
   where provider = 'stripe' and (provider_payment_id = p_provider_payment_id or metadata->>'payment_intent' = p_provider_payment_id)
   order by created_at desc limit 1;
  if not found then
    update public.payment_events set outcome = 'unknown_payment' where stripe_event_id = p_event_id;
    return jsonb_build_object('status', 'unknown_payment');
  end if;

  update public.payments
     set status = coalesce(nullif(p_status, ''), 'refunded'),
         metadata = metadata || jsonb_build_object('refund', jsonb_build_object(
           'stripe_event_id', p_event_id, 'amount_cents', p_amount_cents,
           'credits_clawed_back', false, 'needs_review', true))
   where id = v_payment.id;
  if coalesce(nullif(p_status, ''), 'refunded') = 'refunded' then
    update public.subscription_tranches set status = 'void', voided_at = now(), void_reason = 'refunded'
     where payment_id = v_payment.id and status = 'pending';
    get diagnostics v_void = row_count;
  end if;
  update public.payment_events
     set outcome = 'recorded',
         detail = jsonb_build_object('payment_id', v_payment.id, 'credits_originally_granted', v_payment.credits_granted,
                                     'tranches_voided', v_void)
   where stripe_event_id = p_event_id;
  return jsonb_build_object('status', 'recorded', 'payment_id', v_payment.id,
                            'credits_clawed_back', false, 'needs_review', true, 'tranches_voided', v_void);
end $$;

/* ── 8. the usage ledger, in hundredths ────────────────────────────────────*/

drop function if exists public.usage_event_start(text, uuid, uuid, uuid, text, integer, text, text, uuid, text, jsonb);
create or replace function public.usage_event_start(
  p_token text, p_user_id uuid, p_workspace_id uuid, p_wallet_id uuid, p_service_slug text,
  p_credits numeric default null, p_provider_slug text default null, p_model_slug text default null,
  p_generation_job_id uuid default null, p_idempotency_key text default null, p_metadata jsonb default '{}'::jsonb
) returns table (event_id uuid, status text)
language plpgsql security definer set search_path = public as $$
declare
  v_service record;
  v_credits numeric(14,2);
  v_event uuid;
  v_ws uuid;
  v_tx uuid;
  v_status text;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  if p_user_id is distinct from auth.uid() then raise exception 'not_authorized'; end if;
  if not public.is_workspace_member(p_workspace_id) then raise exception 'not_authorized'; end if;

  select * into v_service from public.service_catalog where slug = p_service_slug and enabled;
  if not found then return query select null::uuid, 'service_unavailable'::text; return; end if;
  if v_service.maintenance_mode then return query select null::uuid, 'maintenance'::text; return; end if;

  -- Hundredths only: a price with a third decimal is refused, never rounded.
  if p_credits is not null and round(p_credits, 2) <> p_credits then
    return query select null::uuid, 'invalid_amount'::text; return;
  end if;
  v_credits := greatest(0, coalesce(p_credits, v_service.credits_cost));
  if v_credits > 10000 then
    return query select null::uuid, 'invalid_amount'::text; return;
  end if;

  if v_credits > 0 then
    select workspace_id into v_ws from public.credit_wallets where id = p_wallet_id;
    if v_ws is null or v_ws <> p_workspace_id then raise exception 'not_authorized'; end if;
  end if;

  begin
    insert into public.usage_events (
      user_id, workspace_id, service_id, service_slug, provider_slug, model_slug,
      credits_charged, api_cost_usd_micros_snapshot, sale_value_cents_snapshot,
      generation_job_id, idempotency_key, metadata
    ) values (
      auth.uid(), p_workspace_id, v_service.id, v_service.slug, p_provider_slug, p_model_slug,
      v_credits, v_service.api_cost_usd_micros, v_service.sale_value_cents,
      p_generation_job_id, p_idempotency_key, coalesce(p_metadata, '{}'::jsonb)
    )
    on conflict (idempotency_key) do nothing
    returning id into v_event;

    if v_event is null then
      v_status := 'duplicate_request';
    elsif v_credits > 0 then
      v_tx := public.apply_credit_transaction(
        p_wallet_id, -v_credits, 'generation', v_service.name, v_event,
        coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('service', v_service.slug),
        auth.uid());
      update public.usage_events set credit_tx_id = v_tx where id = v_event;
      v_status := 'ok';
    else
      v_status := 'ok';
    end if;
  exception when raise_exception then
    v_event := null;
    v_status := case when sqlerrm = 'insufficient_credits' then 'insufficient_credits' else 'event_failed' end;
  end;

  return query select v_event, v_status;
end $$;
revoke all on function public.usage_event_start(text, uuid, uuid, uuid, text, numeric, text, text, uuid, text, jsonb) from public, anon;
grant execute on function public.usage_event_start(text, uuid, uuid, uuid, text, numeric, text, text, uuid, text, jsonb) to authenticated, service_role;

drop function if exists public.usage_event_charge(text, uuid, integer, text, uuid, jsonb);
create or replace function public.usage_event_charge(p_token text, p_wallet_id uuid, p_amount numeric, p_description text, p_reference_id uuid, p_metadata jsonb default '{}'::jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_ws uuid; v_ev_ws uuid; v_tx uuid;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  if p_amount <= 0 or p_amount > 10000 or round(p_amount, 2) <> p_amount then raise exception 'invalid_amount'; end if;
  select workspace_id into v_ws from public.credit_wallets where id = p_wallet_id;
  if v_ws is null or not public.is_workspace_member(v_ws) then raise exception 'not_authorized'; end if;
  select workspace_id into v_ev_ws from public.usage_events where id = p_reference_id;
  if v_ev_ws is null or v_ev_ws <> v_ws then raise exception 'not_authorized'; end if;
  v_tx := public.apply_credit_transaction(p_wallet_id, -p_amount, 'generation', p_description, p_reference_id, p_metadata, auth.uid());
  update public.usage_events set credit_tx_id = v_tx where id = p_reference_id;
  return v_tx;
end $$;
revoke all on function public.usage_event_charge(text, uuid, numeric, text, uuid, jsonb) from public, anon;
grant execute on function public.usage_event_charge(text, uuid, numeric, text, uuid, jsonb) to authenticated, service_role;

drop function if exists public.usage_event_refund_partial(text, uuid, integer);
create or replace function public.usage_event_refund_partial(p_token text, p_event_id uuid, p_amount numeric)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_event record;
  v_wallet uuid;
  v_tx uuid;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  select id, workspace_id, credits_charged, status, refund_tx_id, metadata, credit_tx_id
    into v_event from public.usage_events where id = p_event_id for update;
  if v_event.id is null or not public.is_workspace_member(v_event.workspace_id) then raise exception 'not_authorized'; end if;
  if v_event.status <> 'pending'
     or v_event.refund_tx_id is not null
     or coalesce((v_event.metadata->>'partial_refund_tx') is not null, false)
     or v_event.credit_tx_id is null
     or p_amount is null or p_amount <= 0 or p_amount >= v_event.credits_charged
     or round(p_amount, 2) <> p_amount then
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
revoke all on function public.usage_event_refund_partial(text, uuid, numeric) from public, anon;
grant execute on function public.usage_event_refund_partial(text, uuid, numeric) to authenticated, service_role;

-- The stale-run reconciler keeps the delivered share EXACTLY (hundredths)
-- instead of an integer floor per image.
do $$
declare
  v_def text := pg_get_functiondef('public.usage_events_reconcile_stale(integer, integer)'::regprocedure);
  v_new text;
begin
  -- Already patched (a re-run): nothing to do.
  if position('* 100) / 100' in v_def) > 0 then return; end if;
  v_new := replace(v_def, E'v_keep integer;', E'v_keep numeric(14,2);');
  v_new := replace(v_new, E'v_short integer;', E'v_short numeric(14,2);');
  v_new := replace(v_new,
    E'v_keep := floor(v_row.credits_charged::numeric / v_expected)\n                  * v_delivered;',
    E'v_keep := floor(v_row.credits_charged::numeric * v_delivered / v_expected * 100) / 100;');
  if v_new = v_def then raise exception 'reconcile_patch_not_applied'; end if;
  if position('v_keep numeric(14,2)' in v_new) = 0 or position('* 100) / 100' in v_new) = 0 then
    raise exception 'reconcile_patch_incomplete';
  end if;
  execute v_new;
end $$;

/* ── 9. readers that held a balance in an integer ──────────────────────────*/

do $$
declare v_def text; v_new text;
begin
  -- claim_welcome_bonus reports the balance after the grant.
  v_def := pg_get_functiondef('public.claim_welcome_bonus(jsonb)'::regprocedure);
  v_new := replace(v_def, 'v_balance integer;', 'v_balance numeric;');
  if v_new <> v_def then execute v_new; end if;

  -- GrovShot V2: the order's quoted total and unit may be fractional.
  v_def := pg_get_functiondef('public.grovshot_run_create(text, jsonb)'::regprocedure);
  v_new := replace(v_def, 'v_total integer := coalesce(nullif(p_run->''input''->''quote''->>''total'', '''')::integer, -1);',
                          'v_total numeric := coalesce(nullif(p_run->''input''->''quote''->>''total'', '''')::numeric, -1);');
  v_new := replace(v_new, 'v_balance integer;', 'v_balance numeric;');
  v_new := replace(v_new, 'v_outstanding integer;', 'v_outstanding numeric;');
  v_new := replace(v_new, 'coalesce(nullif(r.input->''quote''->>''total'', '''')::integer, 0)',
                          'coalesce(nullif(r.input->''quote''->>''total'', '''')::numeric, 0)');
  if position('v_total numeric' in v_new) = 0 or position('v_outstanding numeric' in v_new) = 0
     or position('->>''total'', '''')::integer' in v_new) > 0 then
    raise exception 'grovshot_run_create_patch_incomplete';
  end if;
  execute v_new;

  v_def := pg_get_functiondef('public.grovshot_srv_job_update(text, uuid, text, uuid, text, text, integer, jsonb)'::regprocedure);
  v_new := replace(v_def, 'v_unit integer;', 'v_unit numeric;');
  v_new := replace(v_new, '->>''unit'', '''')::integer', '->>''unit'', '''')::numeric');
  if position('v_unit numeric' in v_new) = 0 or position('->>''unit'', '''')::integer' in v_new) > 0 then
    raise exception 'grovshot_job_update_patch_incomplete';
  end if;
  execute v_new;
end $$;

-- GrovShot V2: one shot's charge is the order's unit; the order's product
-- analysis (quote.analysis) rides on the FIRST shot that is charged and not
-- refunded — so it is paid once per order, and not at all when nothing is
-- delivered. A regenerated shot (its own order, analysis 0) is the unit only.
create or replace function public.grovshot_srv_usage_start(
  p_token text, p_run_id uuid, p_owner text, p_wallet_id uuid, p_job_id uuid, p_key text,
  p_provider_slug text, p_model_slug text, p_metadata jsonb
) returns table (event_id uuid, status text)
language plpgsql security definer set search_path = public as $$
declare
  v_run public.ai_engine_runs;
  v_unit numeric;
  v_analysis numeric;
  v_first boolean;
begin
  v_run := public.grovshot_srv_scope(p_token, p_run_id, p_owner);
  if v_run.run_kind <> 'grovshot' then raise exception 'not_found'; end if;
  if p_key is null or left(p_key, char_length('gsv2:' || v_run.id::text || ':')) <> 'gsv2:' || v_run.id::text || ':' then
    raise exception 'invalid_key';
  end if;
  if not exists (select 1 from public.generation_jobs j where j.id = p_job_id and j.workspace_id = v_run.workspace_id
                   and j.settings->>'run_id' = v_run.id::text) then raise exception 'not_found'; end if;
  v_unit := nullif(v_run.input->'quote'->>'unit', '')::numeric;
  if v_unit is null or v_unit <= 0 then raise exception 'invalid_amount'; end if;
  v_analysis := greatest(0, coalesce(nullif(v_run.input->'quote'->>'analysis', '')::numeric, 0));
  if v_analysis > 0 then
    perform pg_advisory_xact_lock(hashtextextended('gsv2-analysis:' || v_run.id::text, 0));
    v_first := not exists (select 1 from public.usage_events e
                            where e.workspace_id = v_run.workspace_id and e.metadata->>'run_id' = v_run.id::text
                              and e.metadata ? 'analysis_credits' and e.status in ('pending', 'succeeded'));
  else
    v_first := false;
  end if;
  return query select * from public.usage_event_start(
    p_token, v_run.user_id, v_run.workspace_id, p_wallet_id, 'image_generation',
    v_unit + case when v_first then v_analysis else 0 end,
    p_provider_slug, p_model_slug, p_job_id, p_key,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('operation', 'grovshot_v2', 'run_id', v_run.id::text)
      || case when v_first then jsonb_build_object('analysis_credits', v_analysis) else '{}'::jsonb end);
end $$;

-- Totals that summed balances into a bigint.
drop function if exists public.credit_wallets_total();
create function public.credit_wallets_total() returns numeric
language sql stable set search_path = public as $$
  select coalesce(sum(balance), 0)::numeric from public.credit_wallets;
$$;
grant execute on function public.credit_wallets_total() to anon, authenticated, service_role;

drop function if exists public.generation_credits_total();
create function public.generation_credits_total() returns numeric
language sql stable set search_path = public as $$
  select coalesce(sum(abs(amount)), 0)::numeric from public.credit_transactions where type = 'generation';
$$;
grant execute on function public.generation_credits_total() to anon, authenticated, service_role;

-- The admin customer list showed the balance as an integer.
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.admin_customer_rows(text, text, text, text, text, timestamptz, text, integer, integer)'::regprocedure);
  if position('credits integer,' in v_def) > 0 then
    drop function public.admin_customer_rows(text, text, text, text, text, timestamptz, text, integer, integer);
    execute replace(v_def, 'credits integer,', 'credits numeric,');
    revoke all on function public.admin_customer_rows(text, text, text, text, text, timestamptz, text, integer, integer) from public, anon;
    grant execute on function public.admin_customer_rows(text, text, text, text, text, timestamptz, text, integer, integer) to authenticated, service_role;
  end if;
end $$;
