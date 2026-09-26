-- ============================================================================
-- 0123 — GROVNEWS STAGE 3: A PAID MONTHLY SUBSCRIPTION, A LAUNCH BONUS, AND AN
--        INDIVIDUAL DISCOUNT CODE FOR THE MONTHLY GROVBASE PLANS.
-- ============================================================================
--
-- WHAT THIS IS NOT. It is not a second billing system and it does not touch the
-- credit ledger. There is still one Stripe account, one webhook, one Stripe
-- Customer per workspace (stripe_customers) and one exactly-once key per event
-- (payment_events). Nothing below calls apply_credit_transaction(), writes
-- credit_wallets / credit_transactions, or writes payments / subscriptions:
-- GrovNews is an ADD-ON, so a GrovNews subscription lives in its own table and
-- can never be mistaken for — or block — the workspace's plan subscription.
--
-- ─── 1. MONETISATION CONFIG ──────────────────────────────────────────────────
--   grovnews_billing   one row: monthly price in grosze (admin-set, never
--                      hardcoded), sales on/off, the ONE Stripe Product, the
--                      Price new purchases resolve to, and its sync state.
--   grovnews_prices    every GrovNews Price ever created. A Price is immutable
--                      in Stripe, so a price change is a NEW Price; the old one
--                      is archived for new sales and keeps billing whoever is
--                      already on it. The webhook recognises a GrovNews invoice
--                      by any Price in here, old or new.
--
-- ─── 2. PAID ACCESS ─────────────────────────────────────────────────────────
--   grovnews_subscriptions  one row per Stripe subscription, written ONLY by
--                      the signed webhook (token-gated functions below).
--                      `paid_through` is the end of the last PAID period and
--                      only ever moves forward on invoice.paid — so access is
--                      exactly the period paid for: cancel-at-period-end keeps
--                      it to the end, a renewal that is not paid does not
--                      extend it, and a subscription that ends early cuts it.
--   grovnews_invoices  layer 2 of exactly-once for GrovNews money (layer 1 is
--                      payment_events, shared with the rest of the webhook).
--   grovnews_checkout_locks  one short-lived lock per user, so a double click
--                      or two parallel requests start at most ONE subscription.
--
--   The canonical resolver from 0122 is extended — and nothing else is:
--   access = an active Stage 1 entitlement OR a paid subscription whose
--   paid_through is still ahead. The reader, the RLS on posts, the group sync
--   and the send-time guard all ask that one function, so the mailing path
--   follows paid access with no change of its own.
--
--   PAID can no longer be written into grovnews_entitlements at all (CHECK
--   constraint): paid access comes from a confirmed Stripe event, never from a
--   row an admin could type.
--
-- ─── 3. LAUNCH CAMPAIGN ─────────────────────────────────────────────────────
--   grovnews_launch_campaigns  DRAFT → ACTIVE → ENDED | DISABLED; at most one
--                      ACTIVE (partial unique index). Config is editable only
--                      as a DRAFT, so what a customer was promised cannot move
--                      under them. Stored in UTC; the admin UI shows Warsaw.
--   grovnews_launch_claims  one per (campaign, user) — the unique constraint IS
--                      the double-grant protection.
--   grovnews_launch_codes   one per (campaign, user): GROV-XXXX-XXXX, 40 random
--                      bits, not derived from anything about the user. Stored in
--                      plain text because the customer's settings page shows it
--                      again later; the column is readable by NOBODY through the
--                      API (no policy for customers, column grants exclude it for
--                      admins) and reaches its owner only through
--                      grovnews_my_state(). A code is bound to its owner and is
--                      worthless to anyone else: every check resolves it WITH the
--                      signed-in user's id, supplied by the server.
--
--   Eligibility (decided here, never in a browser): the account was created
--   inside [window_start, window_end], the existing welcome survey has been
--   completed (welcome_bonus_offers.claimed_at — answers are only ever written
--   by claim_welcome_bonus), the account is not blocked, and the campaign is
--   ACTIVE at the moment of the claim. The existing credit bonus is untouched.
--
-- ─── 4. DISCOUNT CODE FOR MONTHLY PLANS ─────────────────────────────────────
--   The code maps to ONE Stripe Coupon per campaign (created by the server at
--   activation, restricted with applies_to to the eligible plans' Products).
--   The browser sends only the code; the coupon, the amount and the eligibility
--   are resolved here. The code is marked redeemed only when the webhook sees
--   the plan subscription's invoice PAID — an abandoned checkout leaves it
--   usable, and a retried event cannot redeem it twice.
--
-- ─── SECURITY ───────────────────────────────────────────────────────────────
--   Tables: RLS on. Customers read NOTHING directly (their own state comes from
--   grovnews_my_state(), keyed on auth.uid() — no user id argument, so no IDOR).
--   Admins read through select policies; every write is a function. Money-path
--   and checkout functions are token-gated (server_call_ok), like 0113–0118.
--   Campaign edits are admin-gated inside the function (is_admin()).
--
-- ROLLBACK (manual; only while no GrovNews payment exists): restore
-- grovnews_user_has_access from 0122, drop the functions below, drop the
-- constraint grovnews_entitlements_not_paid, then drop the tables in reverse
-- order. Once a real payment exists, do not drop grovnews_subscriptions /
-- grovnews_invoices — they are the record of what was paid.
-- DEPLOY ORDER: this migration BEFORE the code (the code calls these functions;
-- without them GrovNews sales stay unavailable and the webhook answers 500 for
-- a GrovNews event, which Stripe retries). Sales start OFF.

begin;

-- ══ 1. MONETISATION CONFIG ═══════════════════════════════════════════════════

create table public.grovnews_billing (
  id                 boolean primary key default true check (id),
  sales_enabled      boolean not null default false,
  price_cents        integer check (price_cents is null or price_cents between 200 and 1000000),
  currency           text not null default 'PLN' check (currency = 'PLN'),
  stripe_product_id  text,
  stripe_price_id    text,
  stripe_price_cents integer,
  sync_status        text not null default 'unsynced'
                     check (sync_status in ('unsynced', 'syncing', 'synced', 'failed')),
  sync_error         text check (sync_error is null or length(sync_error) <= 200),
  synced_at          timestamptz,
  price_changed_at   timestamptz,
  updated_by         uuid references auth.users (id) on delete set null,
  updated_at         timestamptz not null default now()
);

insert into public.grovnews_billing (id) values (true);

create table public.grovnews_prices (
  stripe_price_id   text primary key,
  stripe_product_id text not null,
  unit_amount       integer not null check (unit_amount > 0),
  currency          text not null,
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  archived_at       timestamptz
);

-- ══ 2. PAID ACCESS ═══════════════════════════════════════════════════════════

create table public.grovnews_subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  -- SET NULL, not cascade: what was paid outlives the account that paid it,
  -- exactly as `payments` does (0084).
  user_id                uuid references public.profiles (id) on delete set null,
  workspace_id           uuid references public.workspaces (id) on delete set null,
  stripe_subscription_id text not null unique,
  stripe_customer_id     text,
  stripe_price_id        text,
  unit_amount_cents      integer,
  currency               text not null default 'PLN',
  status                 text not null
                         check (status in ('incomplete', 'incomplete_expired', 'trialing', 'active',
                                           'past_due', 'canceled', 'unpaid', 'paused')),
  current_period_start   timestamptz,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  canceled_at            timestamptz,
  ended_at               timestamptz,
  -- The end of the last PAID period. Only invoice.paid moves it forward;
  -- only the subscription ending early moves it back.
  paid_through           timestamptz,
  last_event_at          timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index grovnews_subscriptions_user_idx on public.grovnews_subscriptions (user_id);
create index grovnews_subscriptions_paid_idx on public.grovnews_subscriptions (paid_through)
  where paid_through is not null;

create trigger grovnews_subscriptions_touch before update on public.grovnews_subscriptions
  for each row execute function public.touch_updated_at();

create table public.grovnews_invoices (
  stripe_invoice_id      text primary key,
  stripe_subscription_id text not null,
  user_id                uuid references public.profiles (id) on delete set null,
  workspace_id           uuid references public.workspaces (id) on delete set null,
  amount_paid_cents      integer not null check (amount_paid_cents >= 0),
  currency               text not null,
  period_start           timestamptz,
  period_end             timestamptz,
  stripe_event_id        text not null,
  paid_at                timestamptz not null default now()
);

create index grovnews_invoices_subscription_idx on public.grovnews_invoices (stripe_subscription_id);

create table public.grovnews_checkout_locks (
  user_id                uuid primary key references public.profiles (id) on delete cascade,
  attempt_id             uuid not null,
  locked_until           timestamptz not null,
  stripe_subscription_id text,
  updated_at             timestamptz not null default now()
);

-- PAID is never a hand-written row. 0 such rows exist; validated here.
alter table public.grovnews_entitlements
  add constraint grovnews_entitlements_not_paid check (source <> 'PAID') not valid;
alter table public.grovnews_entitlements validate constraint grovnews_entitlements_not_paid;

-- ══ 3. LAUNCH CAMPAIGN ═══════════════════════════════════════════════════════

create table public.grovnews_launch_campaigns (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (length(name) between 1 and 120),
  status              text not null default 'DRAFT'
                      check (status in ('DRAFT', 'ACTIVE', 'ENDED', 'DISABLED')),
  window_start        timestamptz not null,
  window_end          timestamptz not null,
  access_mode         text not null check (access_mode in ('DAYS', 'FOREVER', 'UNTIL')),
  access_days         integer,
  access_until        timestamptz,
  discount_enabled    boolean not null default false,
  discount_type       text check (discount_type in ('PERCENT', 'AMOUNT')),
  discount_value      integer,
  discount_duration   text check (discount_duration in ('ONCE', 'REPEATING')),
  discount_months     integer,
  eligible_plan_ids   uuid[] not null default '{}',
  code_valid_days     integer,
  stripe_coupon_id    text,
  activated_at        timestamptz,
  ended_at            timestamptz,
  created_by          uuid references auth.users (id) on delete set null,
  updated_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint grovnews_launch_window_ok check (window_end > window_start),
  constraint grovnews_launch_access_ok check (
    (access_mode = 'DAYS' and access_days between 1 and 3650 and access_until is null)
    or (access_mode = 'FOREVER' and access_days is null and access_until is null)
    or (access_mode = 'UNTIL' and access_until is not null and access_days is null)),
  constraint grovnews_launch_discount_ok check (
    (not discount_enabled and discount_type is null and discount_value is null
      and discount_duration is null and discount_months is null and code_valid_days is null)
    or (discount_enabled
      and ((discount_type = 'PERCENT' and discount_value between 1 and 90)
        or (discount_type = 'AMOUNT' and discount_value between 1 and 1000000))
      and ((discount_duration = 'ONCE' and discount_months is null)
        or (discount_duration = 'REPEATING' and discount_months between 1 and 12))
      and cardinality(eligible_plan_ids) between 1 and 10
      and code_valid_days between 1 and 365)),
  constraint grovnews_launch_active_has_coupon check (
    status = 'DRAFT' or not discount_enabled or stripe_coupon_id is not null)
);

-- AT MOST ONE ACTIVE CAMPAIGN. Two would make "which bonus does this person
-- get" a race.
create unique index grovnews_launch_one_active on public.grovnews_launch_campaigns ((true))
  where status = 'ACTIVE';

create trigger grovnews_launch_campaigns_touch before update on public.grovnews_launch_campaigns
  for each row execute function public.touch_updated_at();

create table public.grovnews_launch_claims (
  id                uuid primary key default gen_random_uuid(),
  campaign_id       uuid not null references public.grovnews_launch_campaigns (id) on delete restrict,
  user_id           uuid not null references public.profiles (id) on delete cascade,
  claimed_at        timestamptz not null default now(),
  access_granted    boolean not null default false,
  access_expires_at timestamptz,
  constraint grovnews_launch_one_claim unique (campaign_id, user_id)
);

create index grovnews_launch_claims_user_idx on public.grovnews_launch_claims (user_id);

create table public.grovnews_launch_codes (
  id                       uuid primary key default gen_random_uuid(),
  campaign_id              uuid not null references public.grovnews_launch_campaigns (id) on delete restrict,
  user_id                  uuid not null references public.profiles (id) on delete cascade,
  code                     text not null unique check (code ~ '^GROV-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$'),
  created_at               timestamptz not null default now(),
  expires_at               timestamptz not null,
  redeemed_at              timestamptz,
  redeemed_subscription_id text,
  constraint grovnews_launch_one_code unique (campaign_id, user_id)
);

create index grovnews_launch_codes_user_idx on public.grovnews_launch_codes (user_id);

-- ══ 4. ROW LEVEL SECURITY ════════════════════════════════════════════════════
-- Customers read none of these directly. Admins read; nobody writes except
-- through the functions below.

alter table public.grovnews_billing          enable row level security;
alter table public.grovnews_prices           enable row level security;
alter table public.grovnews_subscriptions    enable row level security;
alter table public.grovnews_invoices         enable row level security;
alter table public.grovnews_checkout_locks   enable row level security;
alter table public.grovnews_launch_campaigns enable row level security;
alter table public.grovnews_launch_claims    enable row level security;
alter table public.grovnews_launch_codes     enable row level security;

revoke all on table public.grovnews_billing, public.grovnews_prices, public.grovnews_subscriptions,
  public.grovnews_invoices, public.grovnews_checkout_locks, public.grovnews_launch_campaigns,
  public.grovnews_launch_claims, public.grovnews_launch_codes from anon, authenticated;

grant select on table public.grovnews_billing, public.grovnews_prices, public.grovnews_subscriptions,
  public.grovnews_invoices, public.grovnews_launch_campaigns, public.grovnews_launch_claims
  to authenticated;
-- The code itself is not among the columns an admin can select.
grant select (id, campaign_id, user_id, created_at, expires_at, redeemed_at, redeemed_subscription_id)
  on table public.grovnews_launch_codes to authenticated;

create policy grovnews_billing_admin_read on public.grovnews_billing
  for select to authenticated using ((select public.is_admin()));
create policy grovnews_prices_admin_read on public.grovnews_prices
  for select to authenticated using ((select public.is_admin()));
create policy grovnews_subscriptions_admin_read on public.grovnews_subscriptions
  for select to authenticated using ((select public.is_admin()));
create policy grovnews_invoices_admin_read on public.grovnews_invoices
  for select to authenticated using ((select public.is_admin()));
create policy grovnews_launch_campaigns_admin_read on public.grovnews_launch_campaigns
  for select to authenticated using ((select public.is_admin()));
create policy grovnews_launch_claims_admin_read on public.grovnews_launch_claims
  for select to authenticated using ((select public.is_admin()));
create policy grovnews_launch_codes_admin_read on public.grovnews_launch_codes
  for select to authenticated using ((select public.is_admin()));
-- grovnews_checkout_locks: no policy at all — server functions only.

-- ══ 5. THE CANONICAL RESOLVER LEARNS ABOUT PAID ACCESS ═══════════════════════
-- 0122's definition plus ONE branch. Nothing else in the access path changes:
-- grovnews_has_access, grovnews_eligible_contacts, the group sync and the send
-- guard all delegate here.
create or replace function public.grovnews_user_has_access(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null
     and not public.account_blocked(p_user_id)
     and (
       exists (
         select 1 from public.grovnews_entitlements e
          where e.user_id = p_user_id
            and e.status = 'ACTIVE'
            and e.starts_at <= now()
            and (e.expires_at is null or e.expires_at > now())
       )
       or exists (
         select 1 from public.grovnews_subscriptions s
          where s.user_id = p_user_id
            and s.paid_through > now()
       )
     );
$$;

revoke all on function public.grovnews_user_has_access(uuid) from public, anon, authenticated;

-- ══ 6. WHAT A CUSTOMER MAY SEE ═══════════════════════════════════════════════

-- The public offer: is GrovNews Premium on sale, and for how much. Only a
-- price whose Stripe Price is confirmed to be the displayed amount is
-- offered — the same parity rule sellable() applies to plans.
create function public.grovnews_offer()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'available', b.sales_enabled and b.sync_status = 'synced' and b.stripe_price_id is not null
                 and b.price_cents is not null and b.stripe_price_cents = b.price_cents,
    'price_cents', b.price_cents,
    'currency', b.currency)
    from public.grovnews_billing b where b.id;
$$;

revoke all on function public.grovnews_offer() from public, anon;
grant execute on function public.grovnews_offer() to authenticated;

-- Everything the signed-in customer needs about THEIR OWN GrovNews state, in
-- one call. No argument: it answers for auth.uid() and nobody else.
create function public.grovnews_my_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_paid jsonb;
  v_launch jsonb;
  v_sources jsonb;
begin
  if v_user is null then return null; end if;

  select coalesce(jsonb_agg(distinct e.source), '[]'::jsonb) into v_sources
    from public.grovnews_entitlements e
   where e.user_id = v_user and e.status = 'ACTIVE' and e.starts_at <= now()
     and (e.expires_at is null or e.expires_at > now());

  -- The subscription that matters: a live one first, then the most recent.
  select jsonb_build_object(
           'status', s.status,
           'price_cents', s.unit_amount_cents,
           'currency', s.currency,
           'current_period_end', s.current_period_end,
           'paid_through', s.paid_through,
           'cancel_at_period_end', s.cancel_at_period_end,
           'live', s.status in ('active', 'trialing', 'past_due'),
           'has_access', coalesce(s.paid_through > now(), false))
    into v_paid
    from public.grovnews_subscriptions s
   where s.user_id = v_user and s.status not in ('incomplete', 'incomplete_expired')
   order by (s.status in ('active', 'trialing', 'past_due')) desc, s.created_at desc
   limit 1;

  select jsonb_build_object(
           'campaign_status', c.status,
           'access_granted', cl.access_granted,
           'access_expires_at', cl.access_expires_at,
           'forever', cl.access_granted and cl.access_expires_at is null,
           'code', case when k.id is not null and k.redeemed_at is null and k.expires_at > now()
                          and c.status <> 'DISABLED' then k.code end,
           'code_expires_at', k.expires_at,
           'code_redeemed', k.redeemed_at is not null,
           'discount_type', c.discount_type,
           'discount_value', c.discount_value,
           'discount_duration', c.discount_duration,
           'discount_months', c.discount_months,
           'plans', (select coalesce(jsonb_agg(p.name order by p.sort_order), '[]'::jsonb)
                       from public.subscription_plans p where p.id = any (c.eligible_plan_ids)))
    into v_launch
    from public.grovnews_launch_claims cl
    join public.grovnews_launch_campaigns c on c.id = cl.campaign_id
    left join public.grovnews_launch_codes k on k.campaign_id = cl.campaign_id and k.user_id = cl.user_id
   where cl.user_id = v_user
   order by cl.claimed_at desc
   limit 1;

  return jsonb_build_object(
    'access', public.grovnews_user_has_access(v_user),
    'sources', v_sources,
    'offer', public.grovnews_offer(),
    'paid', v_paid,
    'launch', v_launch);
end $$;

revoke all on function public.grovnews_my_state() from public, anon;
grant execute on function public.grovnews_my_state() to authenticated;

-- ══ 7. PRICE SYNC (server, token-gated) ══════════════════════════════════════

-- Read the config for the server (price id included).
create function public.grovnews_billing_state(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare v jsonb;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  select to_jsonb(b) into v from public.grovnews_billing b where b.id;
  return v;
end $$;

-- Record progress of a sync: 'syncing' before Stripe is asked, 'failed' with a
-- reason, and the Product id the moment it exists (so a retry never creates a
-- second one).
create function public.grovnews_billing_mark(
  p_token text, p_status text, p_error text, p_product_id text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if p_status not in ('syncing', 'failed', 'synced', 'unsynced') then raise exception 'invalid_status'; end if;
  update public.grovnews_billing
     set sync_status = p_status,
         sync_error = left(p_error, 200),
         stripe_product_id = coalesce(stripe_product_id, p_product_id)
   where id;
end $$;

-- THE ONE LOCAL WRITE OF A PRICE CHANGE. Compare-and-swap on the Price being
-- replaced: two admins changing the price at once cannot both win, and the
-- loser's new Price is archived by the caller.
create function public.grovnews_billing_apply_price(
  p_token text, p_expected_previous text, p_product_id text, p_price_id text,
  p_amount integer, p_currency text, p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_prev text;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if p_amount is null or p_amount < 200 or p_amount > 1000000 then raise exception 'invalid_amount'; end if;
  if p_price_id is null or p_product_id is null then raise exception 'invalid_price'; end if;

  select stripe_price_id into v_prev from public.grovnews_billing where id for update;
  -- The same Price applied twice (a retried request) is not a conflict.
  if v_prev = p_price_id then
    return jsonb_build_object('status', 'applied', 'previous_price_id', null);
  end if;
  if v_prev is distinct from p_expected_previous then
    return jsonb_build_object('status', 'conflict');
  end if;

  insert into public.grovnews_prices (stripe_price_id, stripe_product_id, unit_amount, currency, created_by)
  values (p_price_id, p_product_id, p_amount, upper(p_currency), p_actor)
  on conflict (stripe_price_id) do nothing;
  update public.grovnews_prices set archived_at = now()
   where stripe_price_id = v_prev and archived_at is null;

  update public.grovnews_billing
     set price_cents = p_amount,
         stripe_price_cents = p_amount,
         currency = upper(p_currency),
         stripe_product_id = p_product_id,
         stripe_price_id = p_price_id,
         sync_status = 'synced',
         sync_error = null,
         synced_at = now(),
         price_changed_at = now(),
         updated_by = p_actor
   where id;

  return jsonb_build_object('status', 'applied', 'previous_price_id', v_prev);
end $$;

-- Sales on/off. Turning sales ON needs a confirmed Price; turning them OFF only
-- blocks NEW checkouts — no subscription is touched.
create function public.grovnews_billing_set_sales(p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare b public.grovnews_billing;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select * into b from public.grovnews_billing where id for update;
  if coalesce(p_enabled, false) and not (b.sync_status = 'synced' and b.stripe_price_id is not null
       and b.price_cents is not null and b.stripe_price_cents = b.price_cents) then
    return jsonb_build_object('status', 'no_price');
  end if;
  update public.grovnews_billing
     set sales_enabled = coalesce(p_enabled, false), updated_by = auth.uid(), updated_at = now()
   where id;
  return jsonb_build_object('status', 'applied', 'before', b.sales_enabled);
end $$;

-- ══ 8. CHECKOUT (server, token-gated) ════════════════════════════════════════

-- The subscription that decides "may this person buy": a live one first.
create function public.grovnews_subscription_for(p_token text, p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare v jsonb;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  select jsonb_build_object(
           'stripe_subscription_id', s.stripe_subscription_id,
           'status', s.status,
           'live', s.status in ('active', 'trialing', 'past_due'),
           'paid_through', s.paid_through,
           'has_access', coalesce(s.paid_through > now(), false),
           'cancel_at_period_end', s.cancel_at_period_end)
    into v
    from public.grovnews_subscriptions s
   where s.user_id = p_user_id
   order by (s.status in ('active', 'trialing', 'past_due')) desc, s.created_at desc
   limit 1;
  return v;
end $$;

-- ONE CHECKOUT AT A TIME PER USER. Takes a two-minute lock unless one is held;
-- a second request inside the window gets the subscription the first one
-- started (to resume it) or "in progress" — never a second subscription.
create function public.grovnews_checkout_begin(p_token text, p_user_id uuid, p_attempt uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row public.grovnews_checkout_locks;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if p_user_id is null or p_attempt is null then raise exception 'invalid'; end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    return jsonb_build_object('status', 'unknown_user');
  end if;

  if exists (select 1 from public.grovnews_subscriptions s
              where s.user_id = p_user_id and s.status in ('active', 'trialing', 'past_due')) then
    return jsonb_build_object('status', 'already_active');
  end if;

  insert into public.grovnews_checkout_locks (user_id, attempt_id, locked_until)
  values (p_user_id, p_attempt, now() + interval '2 minutes')
  on conflict (user_id) do update
     set attempt_id = excluded.attempt_id, locked_until = excluded.locked_until,
         stripe_subscription_id = null, updated_at = now()
   where grovnews_checkout_locks.locked_until < now()
  returning * into v_row;

  if v_row.user_id is null then
    select * into v_row from public.grovnews_checkout_locks where user_id = p_user_id;
    return jsonb_build_object('status', 'in_progress',
                              'stripe_subscription_id', v_row.stripe_subscription_id);
  end if;
  return jsonb_build_object('status', 'locked');
end $$;

-- Remember which subscription this attempt started, or release the lock when
-- the attempt failed before creating one.
create function public.grovnews_checkout_attach(
  p_token text, p_user_id uuid, p_attempt uuid, p_subscription_id text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if p_subscription_id is null then
    delete from public.grovnews_checkout_locks where user_id = p_user_id and attempt_id = p_attempt;
  else
    update public.grovnews_checkout_locks
       set stripe_subscription_id = p_subscription_id, updated_at = now()
     where user_id = p_user_id and attempt_id = p_attempt;
  end if;
end $$;

-- After Stripe CONFIRMED a cancel / resume at period end, reflect it at once;
-- the webhook's subscription.updated will say the same thing moments later.
create function public.grovnews_subscription_set_cancel(
  p_token text, p_user_id uuid, p_subscription_id text, p_cancel boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  update public.grovnews_subscriptions
     set cancel_at_period_end = coalesce(p_cancel, false)
   where stripe_subscription_id = p_subscription_id and user_id = p_user_id
     and status in ('active', 'trialing', 'past_due');
  return found;
end $$;

-- ══ 9. THE WEBHOOK (server, token-gated) ═════════════════════════════════════

-- Is this Stripe object a GrovNews one? By stable ids: any GrovNews Price ever
-- created, or a subscription already recorded as GrovNews.
create function public.grovnews_is_billing_object(
  p_token text, p_subscription_id text, p_price_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  return (p_price_id is not null and exists (select 1 from public.grovnews_prices where stripe_price_id = p_price_id))
      or (p_subscription_id is not null and exists (select 1 from public.grovnews_subscriptions
                                                     where stripe_subscription_id = p_subscription_id));
end $$;

-- invoice.paid for GrovNews: extend paid_through to the end of the period that
-- was paid. Exactly once per event (payment_events) and per invoice
-- (grovnews_invoices). NO CREDITS: nothing here reaches the ledger.
create function public.grovnews_invoice_paid(
  p_token text, p_event_id text, p_event_type text, p_invoice_id text, p_subscription_id text,
  p_user_id uuid, p_workspace_id uuid, p_customer_id text, p_price_id text,
  p_amount_paid integer, p_currency text, p_period_start timestamptz, p_period_end timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ws   uuid := (select id from public.workspaces where id = p_workspace_id);
  v_user uuid;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;

  insert into public.payment_events (stripe_event_id, event_type, object_id, workspace_id, outcome, detail)
  values (p_event_id, p_event_type, p_invoice_id, v_ws, 'processing', jsonb_build_object('kind', 'grovnews'))
  on conflict (stripe_event_id) do nothing;
  if not found then return jsonb_build_object('status', 'duplicate_event'); end if;

  v_user := coalesce(
    (select id from public.profiles where id = p_user_id),
    (select user_id from public.grovnews_subscriptions where stripe_subscription_id = p_subscription_id));
  if v_user is null or p_subscription_id is null or p_period_end is null then
    update public.payment_events set outcome = 'unresolved_user' where stripe_event_id = p_event_id;
    return jsonb_build_object('status', 'unresolved_workspace');
  end if;

  insert into public.grovnews_invoices (stripe_invoice_id, stripe_subscription_id, user_id, workspace_id,
    amount_paid_cents, currency, period_start, period_end, stripe_event_id)
  values (p_invoice_id, p_subscription_id, v_user, v_ws, greatest(coalesce(p_amount_paid, 0), 0),
    upper(coalesce(nullif(p_currency, ''), 'PLN')), p_period_start, p_period_end, p_event_id)
  on conflict (stripe_invoice_id) do nothing;
  if not found then
    update public.payment_events set outcome = 'already_settled' where stripe_event_id = p_event_id;
    return jsonb_build_object('status', 'already_settled');
  end if;

  insert into public.grovnews_subscriptions (user_id, workspace_id, stripe_subscription_id, stripe_customer_id,
    stripe_price_id, currency, status, current_period_start, current_period_end, paid_through)
  values (v_user, v_ws, p_subscription_id, p_customer_id, p_price_id,
    upper(coalesce(nullif(p_currency, ''), 'PLN')), 'active', p_period_start, p_period_end, p_period_end)
  on conflict (stripe_subscription_id) do update
     set paid_through = case
           -- a late invoice for a subscription that already ENDED cannot
           -- reach past the moment it ended
           when grovnews_subscriptions.status = 'canceled' and grovnews_subscriptions.ended_at is not null
             then least(greatest(coalesce(grovnews_subscriptions.paid_through, excluded.paid_through),
                                 excluded.paid_through), grovnews_subscriptions.ended_at)
           else greatest(coalesce(grovnews_subscriptions.paid_through, excluded.paid_through),
                         excluded.paid_through) end,
         -- A paid invoice means Stripe has made the subscription active; the
         -- subscription.updated event says so too, possibly later.
         status = case when grovnews_subscriptions.status in ('incomplete', 'past_due', 'unpaid')
                       then 'active' else grovnews_subscriptions.status end,
         user_id = coalesce(grovnews_subscriptions.user_id, excluded.user_id),
         workspace_id = coalesce(grovnews_subscriptions.workspace_id, excluded.workspace_id),
         stripe_customer_id = coalesce(grovnews_subscriptions.stripe_customer_id, excluded.stripe_customer_id);

  -- Paid: whatever checkout lock this person holds has done its job.
  delete from public.grovnews_checkout_locks where user_id = v_user;

  update public.payment_events
     set outcome = 'applied', detail = detail || jsonb_build_object('paid_through', p_period_end)
   where stripe_event_id = p_event_id;
  return jsonb_build_object('status', 'applied');
end $$;

-- customer.subscription.created / updated / deleted for GrovNews. State only;
-- never extends access (only a paid invoice does). Events can arrive out of
-- order, so an older event never overwrites a newer one, and `canceled` is
-- terminal. A deletion cuts paid_through back to when the subscription ended.
create function public.grovnews_sync_subscription(
  p_token text, p_event_id text, p_event_type text, p_event_created timestamptz,
  p_subscription_id text, p_user_id uuid, p_workspace_id uuid, p_customer_id text,
  p_price_id text, p_unit_amount integer, p_currency text, p_status text,
  p_period_start timestamptz, p_period_end timestamptz, p_cancel_at_period_end boolean,
  p_canceled_at timestamptz, p_ended_at timestamptz, p_deleted boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ws     uuid := (select id from public.workspaces where id = p_workspace_id);
  v_user   uuid;
  v_status text := case when coalesce(p_deleted, false) then 'canceled' else p_status end;
  v_row    public.grovnews_subscriptions;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if v_status not in ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused') then
    v_status := 'incomplete';
  end if;

  insert into public.payment_events (stripe_event_id, event_type, object_id, workspace_id, outcome, detail)
  values (p_event_id, p_event_type, p_subscription_id, v_ws, 'processing', jsonb_build_object('kind', 'grovnews'))
  on conflict (stripe_event_id) do nothing;
  if not found then return jsonb_build_object('status', 'duplicate_event'); end if;

  select * into v_row from public.grovnews_subscriptions where stripe_subscription_id = p_subscription_id for update;
  v_user := coalesce(v_row.user_id, (select id from public.profiles where id = p_user_id));

  if v_row.id is null then
    if v_user is null then
      update public.payment_events set outcome = 'unresolved_user' where stripe_event_id = p_event_id;
      return jsonb_build_object('status', 'unresolved_workspace');
    end if;
    insert into public.grovnews_subscriptions (user_id, workspace_id, stripe_subscription_id, stripe_customer_id,
      stripe_price_id, unit_amount_cents, currency, status, current_period_start, current_period_end,
      cancel_at_period_end, canceled_at, ended_at, last_event_at)
    values (v_user, v_ws, p_subscription_id, p_customer_id, p_price_id, p_unit_amount,
      upper(coalesce(nullif(p_currency, ''), 'PLN')), v_status, p_period_start, p_period_end,
      coalesce(p_cancel_at_period_end, false), p_canceled_at, p_ended_at, p_event_created);
  elsif coalesce(p_deleted, false) then
    update public.grovnews_subscriptions
       set status = 'canceled',
           cancel_at_period_end = false,
           canceled_at = coalesce(p_canceled_at, canceled_at, now()),
           ended_at = coalesce(p_ended_at, ended_at, now()),
           paid_through = least(paid_through, coalesce(p_ended_at, now())),
           last_event_at = greatest(coalesce(last_event_at, p_event_created), p_event_created)
     where id = v_row.id;
  elsif v_row.status <> 'canceled'
        and (v_row.last_event_at is null or p_event_created is null or p_event_created >= v_row.last_event_at) then
    update public.grovnews_subscriptions
       set status = case
                      -- A stale "incomplete" after money arrived is not news.
                      when v_status in ('incomplete', 'incomplete_expired') and v_row.paid_through is not null
                        then v_row.status
                      else v_status end,
           stripe_price_id = coalesce(p_price_id, stripe_price_id),
           unit_amount_cents = coalesce(p_unit_amount, unit_amount_cents),
           current_period_start = coalesce(p_period_start, current_period_start),
           current_period_end = coalesce(p_period_end, current_period_end),
           cancel_at_period_end = coalesce(p_cancel_at_period_end, false),
           canceled_at = p_canceled_at,
           ended_at = p_ended_at,
           stripe_customer_id = coalesce(stripe_customer_id, p_customer_id),
           last_event_at = coalesce(p_event_created, last_event_at)
     where id = v_row.id;
  else
    update public.payment_events set outcome = 'stale' where stripe_event_id = p_event_id;
    return jsonb_build_object('status', 'applied', 'stale', true);
  end if;

  update public.payment_events set outcome = 'applied' where stripe_event_id = p_event_id;
  return jsonb_build_object('status', 'applied');
end $$;

-- ══ 10. LAUNCH CAMPAIGN ══════════════════════════════════════════════════════

-- The pure eligibility question, shared by the claim and by tests.
create function public.grovnews_launch_eligible(p_user_id uuid, p_campaign_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.grovnews_launch_campaigns c
      join auth.users u on u.id = p_user_id
     where c.id = p_campaign_id
       and c.status = 'ACTIVE'
       and u.created_at >= c.window_start
       and u.created_at <= c.window_end
       and exists (select 1 from public.welcome_bonus_offers w
                    where w.user_id = p_user_id and w.claimed_at is not null)
       and exists (select 1 from public.profiles p where p.id = p_user_id)
       and not public.account_blocked(p_user_id));
$$;

revoke all on function public.grovnews_launch_eligible(uuid, uuid) from public, anon, authenticated;

-- A fresh code: GROV-XXXX-XXXX from 32 unambiguous characters (no I, O, 0, 1),
-- 40 random bits, nothing derived from the user.
create function public.grovnews_new_code()
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_alpha constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := gen_random_bytes(8);
  v_out text := 'GROV-';
begin
  for i in 0..7 loop
    if i = 4 then v_out := v_out || '-'; end if;
    v_out := v_out || substr(v_alpha, (get_byte(v_bytes, i) & 31) + 1, 1);
  end loop;
  return v_out;
end $$;

revoke all on function public.grovnews_new_code() from public, anon, authenticated;

-- THE CLAIM. Called for the signed-in user only (auth.uid()) — after the
-- welcome survey, and lazily on GrovNews / settings pages so a person who
-- completed the survey before the campaign went live is not left out. One
-- claim per (campaign, user) by constraint; a repeat call returns 'claimed'.
-- Access is EXTEND-ONLY: a longer LAUNCH_BONUS entitlement is never shortened,
-- an admin's REVOKE is never undone, and no other source is touched.
create function public.grovnews_launch_ensure()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user   uuid := auth.uid();
  c        public.grovnews_launch_campaigns;
  v_claim  uuid;
  v_exp    timestamptz;
  v_grant  boolean;
  v_code   text;
  v_tries  integer := 0;
begin
  if v_user is null then return jsonb_build_object('status', 'anonymous'); end if;

  select * into c from public.grovnews_launch_campaigns where status = 'ACTIVE' limit 1;
  if c.id is null then return jsonb_build_object('status', 'no_campaign'); end if;
  if exists (select 1 from public.grovnews_launch_claims where campaign_id = c.id and user_id = v_user) then
    return jsonb_build_object('status', 'claimed');
  end if;
  if not public.grovnews_launch_eligible(v_user, c.id) then
    return jsonb_build_object('status', 'not_eligible');
  end if;

  v_exp := case c.access_mode
             when 'DAYS' then now() + make_interval(days => c.access_days)
             when 'UNTIL' then c.access_until
             else null end;
  -- A fixed end date already in the past grants no access (the code still
  -- stands on its own).
  v_grant := not (c.access_mode = 'UNTIL' and c.access_until <= now());

  insert into public.grovnews_launch_claims (campaign_id, user_id, access_granted, access_expires_at)
  values (c.id, v_user, v_grant, case when v_grant then v_exp end)
  on conflict (campaign_id, user_id) do nothing
  returning id into v_claim;
  if v_claim is null then return jsonb_build_object('status', 'claimed'); end if;

  if v_grant then
    insert into public.grovnews_entitlements (user_id, source, status, starts_at, expires_at, internal_note)
    values (v_user, 'LAUNCH_BONUS', 'ACTIVE', now(), v_exp, 'launch_campaign:' || c.id)
    on conflict (user_id, source) do update
       set expires_at = case
             -- still running: keep whichever lasts longer (NULL = forever)
             when grovnews_entitlements.status = 'ACTIVE'
                  and (grovnews_entitlements.expires_at is null or grovnews_entitlements.expires_at > now())
               then case when grovnews_entitlements.expires_at is null or excluded.expires_at is null then null
                         else greatest(grovnews_entitlements.expires_at, excluded.expires_at) end
             else excluded.expires_at end,
           starts_at = case
             when grovnews_entitlements.status = 'ACTIVE'
                  and (grovnews_entitlements.expires_at is null or grovnews_entitlements.expires_at > now())
               then least(grovnews_entitlements.starts_at, now())
             else now() end,
           status = 'ACTIVE',
           internal_note = excluded.internal_note
     where grovnews_entitlements.status <> 'REVOKED';
    -- What the customer actually holds now (it may be longer than this grant).
    select case when e.status = 'ACTIVE' then e.expires_at else v_exp end into v_exp
      from public.grovnews_entitlements e where e.user_id = v_user and e.source = 'LAUNCH_BONUS';
    update public.grovnews_launch_claims
       set access_expires_at = v_exp,
           access_granted = exists (select 1 from public.grovnews_entitlements e
                                     where e.user_id = v_user and e.source = 'LAUNCH_BONUS' and e.status = 'ACTIVE')
     where id = v_claim;
  end if;

  if c.discount_enabled then
    loop
      v_tries := v_tries + 1;
      begin
        insert into public.grovnews_launch_codes (campaign_id, user_id, code, expires_at)
        values (c.id, v_user, public.grovnews_new_code(), now() + make_interval(days => c.code_valid_days))
        returning code into v_code;
        exit;
      exception when unique_violation then
        -- a collision on the code itself (2^-40 per pair) — draw again
        if v_tries >= 5 then raise; end if;
      end;
    end loop;
  end if;

  return jsonb_build_object('status', 'granted', 'access_granted', v_grant,
                            'access_expires_at', v_exp, 'code_issued', v_code is not null);
end $$;

revoke all on function public.grovnews_launch_ensure() from public, anon;
grant execute on function public.grovnews_launch_ensure() to authenticated;

-- Save a DRAFT (create when p_id is null). Admin-only, checked here. A campaign
-- that is live, ended or disabled cannot be edited: what was promised stays.
create function public.grovnews_launch_save(p_id uuid, p_config jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_disc boolean;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  v_disc := coalesce((p_config->>'discount_enabled')::boolean, false);
  if p_id is not null and not exists (select 1 from public.grovnews_launch_campaigns
                                        where id = p_id and status = 'DRAFT') then
    return jsonb_build_object('status', 'not_draft');
  end if;
  if v_disc and exists (select 1 from unnest(coalesce(
       array(select jsonb_array_elements_text(p_config->'eligible_plan_ids'))::uuid[], '{}')) x(id)
       where not exists (select 1 from public.subscription_plans p where p.id = x.id and p.price_cents > 0)) then
    return jsonb_build_object('status', 'invalid_plan');
  end if;

  if p_id is null then
    insert into public.grovnews_launch_campaigns (name, window_start, window_end, access_mode, access_days,
      access_until, discount_enabled, discount_type, discount_value, discount_duration, discount_months,
      eligible_plan_ids, code_valid_days, created_by, updated_by)
    values (
      p_config->>'name', (p_config->>'window_start')::timestamptz, (p_config->>'window_end')::timestamptz,
      p_config->>'access_mode', (p_config->>'access_days')::integer, (p_config->>'access_until')::timestamptz,
      v_disc,
      case when v_disc then p_config->>'discount_type' end,
      case when v_disc then (p_config->>'discount_value')::integer end,
      case when v_disc then p_config->>'discount_duration' end,
      case when v_disc then (p_config->>'discount_months')::integer end,
      case when v_disc then coalesce(array(select jsonb_array_elements_text(p_config->'eligible_plan_ids'))::uuid[], '{}') else '{}' end,
      case when v_disc then (p_config->>'code_valid_days')::integer end,
      auth.uid(), auth.uid())
    returning id into v_id;
  else
    update public.grovnews_launch_campaigns
       set name = p_config->>'name',
           window_start = (p_config->>'window_start')::timestamptz,
           window_end = (p_config->>'window_end')::timestamptz,
           access_mode = p_config->>'access_mode',
           access_days = (p_config->>'access_days')::integer,
           access_until = (p_config->>'access_until')::timestamptz,
           discount_enabled = v_disc,
           discount_type = case when v_disc then p_config->>'discount_type' end,
           discount_value = case when v_disc then (p_config->>'discount_value')::integer end,
           discount_duration = case when v_disc then p_config->>'discount_duration' end,
           discount_months = case when v_disc then (p_config->>'discount_months')::integer end,
           eligible_plan_ids = case when v_disc then coalesce(array(select jsonb_array_elements_text(p_config->'eligible_plan_ids'))::uuid[], '{}') else '{}' end,
           code_valid_days = case when v_disc then (p_config->>'code_valid_days')::integer end,
           updated_by = auth.uid()
     where id = p_id and status = 'DRAFT'
    returning id into v_id;
  end if;
  return jsonb_build_object('status', 'saved', 'id', v_id);
exception
  when check_violation or invalid_text_representation or invalid_datetime_format
       or datetime_field_overflow or not_null_violation or numeric_value_out_of_range then
    return jsonb_build_object('status', 'invalid');
end $$;

-- ACTIVATE. Server-only (token): the server has just created the Stripe Coupon
-- (when the campaign has a discount) and hands its id over. Re-validates here:
-- DRAFT, a sane window, every eligible plan paid, sold monthly, mapped to a
-- Stripe Product, and still charging at least 2 zł after the discount — a
-- first invoice of 0 zł has no payment to confirm and would break checkout.
create function public.grovnews_launch_activate(
  p_token text, p_id uuid, p_coupon_id text, p_actor uuid, p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare c public.grovnews_launch_campaigns;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  select * into c from public.grovnews_launch_campaigns where id = p_id for update;
  if c.id is null or c.status <> 'DRAFT' then return jsonb_build_object('status', 'not_draft'); end if;
  -- The coupon was built from the draft as the server read it. A save in
  -- between would attach a coupon with other terms: refuse, let the admin retry.
  if c.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('status', 'changed');
  end if;
  if c.window_end <= now() then return jsonb_build_object('status', 'window_over'); end if;
  if c.access_mode = 'UNTIL' and c.access_until <= now() then
    return jsonb_build_object('status', 'access_over');
  end if;
  if exists (select 1 from public.grovnews_launch_campaigns where status = 'ACTIVE') then
    return jsonb_build_object('status', 'another_active');
  end if;
  if c.discount_enabled then
    if p_coupon_id is null or p_coupon_id = '' then return jsonb_build_object('status', 'no_coupon'); end if;
    if exists (
      select 1 from unnest(c.eligible_plan_ids) x(id)
       where not exists (
         select 1 from public.subscription_plans p
          where p.id = x.id and p.active and p.price_cents > 0
            and p.stripe_product_id is not null and p.stripe_price_id_monthly is not null
            and (case when c.discount_type = 'PERCENT'
                      then p.price_cents - round(p.price_cents * c.discount_value / 100.0)
                      else p.price_cents - c.discount_value end) >= 200)) then
      return jsonb_build_object('status', 'plan_ineligible');
    end if;
  end if;

  update public.grovnews_launch_campaigns
     set status = 'ACTIVE', activated_at = now(),
         stripe_coupon_id = case when c.discount_enabled then p_coupon_id end,
         updated_by = p_actor
   where id = p_id;
  return jsonb_build_object('status', 'applied');
end $$;

-- End (window closed on purpose) or disable (switched off). Both stop NEW
-- claims; every grant already made stays. A DISABLED campaign's unused codes
-- stop working as well — that is the emergency brake; an ENDED campaign's
-- codes run to their own expiry.
create function public.grovnews_launch_set_status(p_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_before text;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_status not in ('ENDED', 'DISABLED') then return jsonb_build_object('status', 'invalid'); end if;
  select status into v_before from public.grovnews_launch_campaigns where id = p_id for update;
  if v_before is null then return jsonb_build_object('status', 'invalid'); end if;
  if not (v_before = 'ACTIVE' or (v_before = 'DRAFT' and p_status = 'DISABLED')
          or (v_before = 'ENDED' and p_status = 'DISABLED')) then
    return jsonb_build_object('status', 'invalid_transition');
  end if;
  update public.grovnews_launch_campaigns
     set status = p_status, ended_at = coalesce(ended_at, now()), updated_by = auth.uid()
   where id = p_id;
  return jsonb_build_object('status', 'applied', 'before', v_before);
end $$;

-- ══ 11. THE DISCOUNT CODE AT THE PLAN CHECKOUT (server, token-gated) ══════════

-- Resolve a code FOR THIS USER against THIS plan. p_user_id is the signed-in
-- user as the server read it from the session — never a browser value. Another
-- person's code answers exactly like a code that does not exist.
create function public.grovnews_launch_code_resolve(
  p_token text, p_user_id uuid, p_code text, p_plan_id uuid, p_period text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  k public.grovnews_launch_codes;
  c public.grovnews_launch_campaigns;
  v_price integer;
  v_after integer;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  select * into k from public.grovnews_launch_codes
   where code = upper(btrim(coalesce(p_code, ''))) and user_id = p_user_id;
  if k.id is null then return jsonb_build_object('ok', false, 'reason', 'code_invalid'); end if;
  select * into c from public.grovnews_launch_campaigns where id = k.campaign_id;
  if k.redeemed_at is not null then return jsonb_build_object('ok', false, 'reason', 'code_used'); end if;
  if k.expires_at <= now() or c.status = 'DISABLED' then
    return jsonb_build_object('ok', false, 'reason', 'code_expired');
  end if;
  if not c.discount_enabled or c.stripe_coupon_id is null then
    return jsonb_build_object('ok', false, 'reason', 'code_invalid');
  end if;
  if coalesce(p_period, 'monthly') <> 'monthly' then
    return jsonb_build_object('ok', false, 'reason', 'code_monthly_only');
  end if;
  if not (p_plan_id = any (c.eligible_plan_ids)) then
    return jsonb_build_object('ok', false, 'reason', 'code_plan');
  end if;
  select price_cents into v_price from public.subscription_plans where id = p_plan_id;
  v_after := case when c.discount_type = 'PERCENT'
                  then v_price - round(v_price * c.discount_value / 100.0)::integer
                  else v_price - c.discount_value end;
  if v_price is null or v_after < 200 then
    return jsonb_build_object('ok', false, 'reason', 'code_plan');
  end if;
  return jsonb_build_object(
    'ok', true, 'code_id', k.id, 'coupon_id', c.stripe_coupon_id,
    'discount_type', c.discount_type, 'discount_value', c.discount_value,
    'discount_duration', c.discount_duration, 'discount_months', c.discount_months,
    'first_charge_cents', v_after);
end $$;

-- invoice.paid on a plan subscription that carried a code: mark it used. Only
-- a PAID invoice gets here, so an abandoned checkout never uses a code; the
-- `redeemed_at is null` guard makes a retried event a no-op.
create function public.grovnews_launch_code_redeem(
  p_token text, p_code_id uuid, p_subscription_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_prev text;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  update public.grovnews_launch_codes
     set redeemed_at = now(), redeemed_subscription_id = p_subscription_id
   where id = p_code_id and redeemed_at is null;
  if found then return jsonb_build_object('status', 'redeemed'); end if;
  select redeemed_subscription_id into v_prev from public.grovnews_launch_codes where id = p_code_id;
  return jsonb_build_object('status', case when v_prev is null then 'unknown_code'
                                           when v_prev = p_subscription_id then 'already_redeemed'
                                           else 'redeemed_elsewhere' end);
end $$;

-- ══ 12. GRANTS ═══════════════════════════════════════════════════════════════
-- Token-gated doors are granted like 0113's: the DISPATCH TOKEN is the gate,
-- not the role. Admin doors check is_admin() inside.
do $$
declare f text;
begin
  foreach f in array array[
    'public.grovnews_billing_state(text)',
    'public.grovnews_billing_mark(text,text,text,text)',
    'public.grovnews_billing_apply_price(text,text,text,text,integer,text,uuid)',
    'public.grovnews_subscription_for(text,uuid)',
    'public.grovnews_checkout_begin(text,uuid,uuid)',
    'public.grovnews_checkout_attach(text,uuid,uuid,text)',
    'public.grovnews_subscription_set_cancel(text,uuid,text,boolean)',
    'public.grovnews_is_billing_object(text,text,text)',
    'public.grovnews_invoice_paid(text,text,text,text,text,uuid,uuid,text,text,integer,text,timestamptz,timestamptz)',
    'public.grovnews_sync_subscription(text,text,text,timestamptz,text,uuid,uuid,text,text,integer,text,text,timestamptz,timestamptz,boolean,timestamptz,timestamptz,boolean)',
    'public.grovnews_launch_activate(text,uuid,text,uuid,timestamptz)',
    'public.grovnews_launch_code_resolve(text,uuid,text,uuid,text)',
    'public.grovnews_launch_code_redeem(text,uuid,text)'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.grovnews_billing_set_sales(boolean)',
    'public.grovnews_launch_save(uuid,jsonb)',
    'public.grovnews_launch_set_status(uuid,text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;
