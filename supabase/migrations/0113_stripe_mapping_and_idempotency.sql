-- ============================================================================
-- 0113 — STRIPE: identity mapping, exactly-once settlement, and the one door
--        through which a payment may reach the credit ledger.
--
-- WHAT THIS IS NOT. It is not a second billing system. Every business value
-- still lives where it already lived — credit_packages, subscription_plans,
-- payments, subscriptions, credit_wallets, credit_transactions. What is added
-- is (a) a stable mapping to Stripe's ids, (b) a dedupe key, and (c) one
-- SECURITY DEFINER function that is the only path from "Stripe says paid" to
-- "the ledger moved".
--
-- ─── WHY A TOKEN-GATED FUNCTION AND NOT A SERVICE-ROLE CLIENT ───────────────
--
-- The obvious Stripe webhook does its database work with a service-role key.
-- This project has decided against that, twice over:
--
--   · apply_credit_transaction() is granted to postgres and service_role only
--     — anon and authenticated both evaluate has_function_privilege = false;
--   · the architecture decision "Aplikacja nie ma klienta service-role" holds
--     repo-wide, and a webhook would be the first exception.
--
-- An exception here would be the worst possible place for one: a service-role
-- client in a route that accepts unauthenticated POSTs is a skeleton key
-- sitting behind a signature check. So the webhook keeps using the ANON key
-- and proves it is the server the way every other background job in this
-- codebase does — a dispatch token checked by server_call_ok() INSIDE a
-- SECURITY DEFINER function (0079, 0082, 0102, 0108). The token never reaches
-- the browser; the anon key alone opens nothing.
--
-- ─── EXACTLY ONCE, IN TWO LAYERS ────────────────────────────────────────────
--
-- Stripe retries, and Stripe also warns that "in some cases, two separate
-- Event objects are generated" for one occurrence. One key cannot cover both:
--
--   layer 1  payment_events.stripe_event_id PRIMARY KEY
--            catches a RETRY of the same event exactly.
--   layer 2  payments UNIQUE (provider, provider_payment_id)
--            catches TWO DIFFERENT events describing the same payment.
--
-- Credits are granted in the same statement sequence as the payments insert,
-- so a conflict on either layer means no ledger movement at all. There is no
-- unique on (event_type, object_id): customer.subscription.updated legitimately
-- repeats for one subscription, and a blanket key there would drop real events.
--
-- ─── REFUNDS ────────────────────────────────────────────────────────────────
-- Recorded, never clawed back. credit_wallets carries CHECK (balance >= 0), so
-- a customer who spent what they bought cannot be debited; inventing a policy
-- there is a business decision, not a migration. stripe_record_refund() writes
-- the fact and raises a flag for a human.
-- ============================================================================

-- ── 1. MAPPING: internal id ↔ Stripe id ─────────────────────────────────────
-- Names are never identifiers. Stripe ids are, and they are stored here so a
-- price can be replaced (Stripe prices are immutable — a price change means a
-- NEW price id) without touching a line of application code.

alter table public.credit_packages
  add column if not exists stripe_product_id text,
  add column if not exists stripe_price_id   text;

alter table public.subscription_plans
  add column if not exists stripe_product_id       text,
  add column if not exists stripe_price_id_monthly text,
  add column if not exists stripe_price_id_annual  text;

-- One Stripe price may back exactly one internal row, or the reverse mapping
-- (webhook price id → which package was bought) stops being a function.
create unique index if not exists credit_packages_stripe_price_key
  on public.credit_packages (stripe_price_id) where stripe_price_id is not null;
create unique index if not exists subscription_plans_stripe_price_monthly_key
  on public.subscription_plans (stripe_price_id_monthly) where stripe_price_id_monthly is not null;
create unique index if not exists subscription_plans_stripe_price_annual_key
  on public.subscription_plans (stripe_price_id_annual) where stripe_price_id_annual is not null;

comment on column public.credit_packages.stripe_price_id is
  'Stripe Price id. Prices are immutable in Stripe: changing the price means '
  'creating a new Price and repointing this column, archiving the old one.';

-- ── 2. WHICH STRIPE CUSTOMER IS THIS WORKSPACE ──────────────────────────────
-- DELIBERATELY NOT A COLUMN ON billing_profiles. That table carries a
-- member-writable ALL policy so a workspace can edit its own invoicing
-- details — which would let a member point their workspace at somebody else's
-- Stripe customer, and with it at somebody else's saved cards and invoices.
-- The mapping is server-owned, so it lives in a server-owned table.
create table if not exists public.stripe_customers (
  workspace_id       uuid primary key references public.workspaces (id) on delete cascade,
  stripe_customer_id text not null unique,
  livemode           boolean not null default false,
  created_at         timestamptz not null default now()
);

alter table public.stripe_customers enable row level security;
-- No policy is declared on purpose: with RLS on and no policy, every client
-- role reads and writes nothing. The SECURITY DEFINER functions below are the
-- only access, and the application reads the mapping through them.
revoke all on table public.stripe_customers from anon, authenticated;

comment on table public.stripe_customers is
  'workspace ↔ Stripe Customer. Server-owned: RLS on with no policy, and no '
  'table grants. Not on billing_profiles, which members may write.';

-- ── 3. THE DEDUPE LEDGER ────────────────────────────────────────────────────
create table if not exists public.payment_events (
  stripe_event_id text primary key,
  event_type      text not null,
  object_id       text,
  workspace_id    uuid references public.workspaces (id) on delete set null,
  outcome         text not null,
  detail          jsonb not null default '{}'::jsonb,
  received_at     timestamptz not null default now()
);

create index if not exists payment_events_type_object_idx
  on public.payment_events (event_type, object_id);
create index if not exists payment_events_received_idx
  on public.payment_events (received_at desc);

alter table public.payment_events enable row level security;
revoke all on table public.payment_events from anon, authenticated;

comment on table public.payment_events is
  'Every Stripe event this deployment has already acted on. PRIMARY KEY on the '
  'Stripe event id is layer 1 of the exactly-once guarantee; the unique on '
  'payments (provider, provider_payment_id) is layer 2. No client access.';

-- ── 4. payments: make replay impossible and record what was bought ──────────
-- The live table has no unique constraint of any kind today, so a webhook
-- replay has zero protection at the database level. That is the gap this
-- closes; everything else here is bookkeeping.

alter table public.payments
  add column if not exists kind            text,
  add column if not exists credits_granted integer not null default 0,
  -- Mirrors usage_events.credit_tx_id: the ledger row is the RECEIPT for this
  -- payment, and P0-02 established that a receipt, not an amount, is what
  -- proves a credit movement happened.
  add column if not exists credit_tx_id    uuid references public.credit_transactions (id),
  add column if not exists stripe_customer_id text,
  add column if not exists package_id      uuid references public.credit_packages (id) on delete set null,
  add column if not exists plan_id         uuid references public.subscription_plans (id) on delete set null;

-- NOT a partial index, deliberately. `ON CONFLICT (provider,
-- provider_payment_id)` can only infer an index whose predicate it is told
-- about, so a `WHERE … is not null` variant makes the upsert raise
-- "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification" — the settlement path fails closed and every payment is
-- rejected. A plain unique index needs no predicate and loses nothing:
-- Postgres treats NULLs as distinct, so rows from a future provider that
-- carries no payment id are still unconstrained.
create unique index if not exists payments_provider_payment_key
  on public.payments (provider, provider_payment_id);

-- Unindexed FK, flagged in the pre-launch audit; every admin and economics
-- read filters on it.
create index if not exists payments_workspace_idx on public.payments (workspace_id);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'payments_status_check') then
    -- 'succeeded' | 'paid' | 'completed' are what lib/services/economics.ts
    -- already treats as settled; the rest are the states Stripe can leave a
    -- payment in. Listed rather than free text so a typo cannot silently
    -- create revenue.
    alter table public.payments add constraint payments_status_check
      check (status in ('pending','processing','succeeded','paid','completed',
                        'failed','canceled','refunded','partially_refunded','disputed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payments_kind_check') then
    alter table public.payments add constraint payments_kind_check
      check (kind is null or kind in ('credit_pack','custom_credits','subscription'));
  end if;
end $$;

-- ── 5. subscriptions: one row per Stripe subscription ───────────────────────
alter table public.subscriptions
  add column if not exists stripe_price_id       text,
  add column if not exists cancel_at_period_end  boolean not null default false,
  add column if not exists stripe_customer_id    text;

-- Plain, for the same reason as payments_provider_payment_key above: this one
-- backs an ON CONFLICT … DO UPDATE, and a partial index cannot.
create unique index if not exists subscriptions_provider_subscription_key
  on public.subscriptions (provider, provider_subscription_id);

create index if not exists subscriptions_workspace_idx on public.subscriptions (workspace_id);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'subscriptions_status_check') then
    alter table public.subscriptions add constraint subscriptions_status_check
      check (status in ('active','trialing','past_due','canceled','incomplete',
                        'incomplete_expired','unpaid','paused'));
  end if;
end $$;

-- ── 6. THE ONE DOOR: a settled Stripe payment reaching the ledger ───────────
create or replace function public.stripe_settle_payment(
  p_token               text,
  p_event_id            text,
  p_event_type          text,
  p_workspace_id        uuid,
  p_provider_payment_id text,
  p_amount_cents        integer,
  p_currency            text,
  p_kind                text,
  p_credits             integer,
  p_credit_type         credit_tx_type,
  p_description         text,
  p_package_id          uuid,
  p_plan_id             uuid,
  p_stripe_customer_id  text,
  p_metadata            jsonb
)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_payment_id uuid;
  v_wallet_id  uuid;
  v_tx_id      uuid;
begin
  if not public.server_call_ok(p_token) then
    raise exception 'forbidden';
  end if;

  -- LAYER 1 — this exact event, already acted on?
  insert into public.payment_events (stripe_event_id, event_type, object_id, workspace_id, outcome, detail)
  values (p_event_id, p_event_type, p_provider_payment_id, p_workspace_id, 'processing',
          jsonb_build_object('kind', p_kind))
  on conflict (stripe_event_id) do nothing;
  if not found then
    return jsonb_build_object('status', 'duplicate_event');
  end if;

  -- LAYER 2 — this payment, already settled by some OTHER event?
  insert into public.payments (
    workspace_id, amount_cents, currency, status, provider, provider_payment_id,
    kind, package_id, plan_id, stripe_customer_id, metadata
  ) values (
    p_workspace_id, p_amount_cents, coalesce(nullif(p_currency, ''), 'PLN'), 'succeeded',
    'stripe', p_provider_payment_id, p_kind, p_package_id, p_plan_id, p_stripe_customer_id,
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (provider, provider_payment_id) do nothing
  returning id into v_payment_id;

  if v_payment_id is null then
    update public.payment_events set outcome = 'already_settled' where stripe_event_id = p_event_id;
    return jsonb_build_object('status', 'already_settled');
  end if;

  -- THE LEDGER. Only now, and only through the one function that may move a
  -- balance. A workspace with no wallet is a real state (deleted workspace,
  -- or an account removed mid-flight) — record the payment, grant nothing,
  -- and say so rather than raising, because raising would make Stripe retry
  -- forever against a workspace that is never coming back.
  if coalesce(p_credits, 0) > 0 then
    select id into v_wallet_id from public.credit_wallets where workspace_id = p_workspace_id;
    if v_wallet_id is null then
      update public.payment_events set outcome = 'no_wallet' where stripe_event_id = p_event_id;
      return jsonb_build_object('status', 'settled_without_credits',
                                'payment_id', v_payment_id, 'reason', 'no_wallet');
    end if;

    v_tx_id := public.apply_credit_transaction(
      v_wallet_id, p_credits, p_credit_type, p_description, v_payment_id,
      jsonb_build_object('stripe_event_id', p_event_id,
                         'stripe_payment_id', p_provider_payment_id,
                         'payment_id', v_payment_id),
      null
    );

    update public.payments
       set credits_granted = p_credits, credit_tx_id = v_tx_id
     where id = v_payment_id;
  end if;

  update public.payment_events
     set outcome = 'applied',
         detail = detail || jsonb_build_object('payment_id', v_payment_id, 'credit_tx_id', v_tx_id)
   where stripe_event_id = p_event_id;

  return jsonb_build_object('status', 'applied', 'payment_id', v_payment_id, 'credit_tx_id', v_tx_id);
end;
$$;

-- ── 7. Subscription lifecycle — state only, never credits ───────────────────
-- Credits for a renewal arrive through stripe_settle_payment() on invoice.paid,
-- keyed on the INVOICE id. Granting them here as well would pay twice for one
-- renewal, because subscription.updated also fires on every renewal.
create or replace function public.stripe_sync_subscription(
  p_token                   text,
  p_event_id                text,
  p_event_type              text,
  p_workspace_id            uuid,
  p_provider_subscription_id text,
  p_plan_id                 uuid,
  p_status                  text,
  p_current_period_start    timestamptz,
  p_current_period_end      timestamptz,
  p_cancel_at_period_end    boolean,
  p_stripe_price_id         text,
  p_stripe_customer_id      text,
  p_metadata                jsonb
)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid;
begin
  if not public.server_call_ok(p_token) then
    raise exception 'forbidden';
  end if;

  insert into public.payment_events (stripe_event_id, event_type, object_id, workspace_id, outcome)
  values (p_event_id, p_event_type, p_provider_subscription_id, p_workspace_id, 'processing')
  on conflict (stripe_event_id) do nothing;
  if not found then
    return jsonb_build_object('status', 'duplicate_event');
  end if;

  insert into public.subscriptions (
    workspace_id, plan_id, status, current_period_start, current_period_end,
    provider, provider_subscription_id, stripe_price_id, stripe_customer_id,
    cancel_at_period_end, metadata
  ) values (
    p_workspace_id, p_plan_id, p_status,
    coalesce(p_current_period_start, now()), p_current_period_end,
    'stripe', p_provider_subscription_id, p_stripe_price_id, p_stripe_customer_id,
    coalesce(p_cancel_at_period_end, false), coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (provider, provider_subscription_id) do update
    set status               = excluded.status,
        plan_id              = excluded.plan_id,
        current_period_start = excluded.current_period_start,
        current_period_end   = excluded.current_period_end,
        stripe_price_id      = excluded.stripe_price_id,
        cancel_at_period_end = excluded.cancel_at_period_end,
        metadata             = excluded.metadata
  returning id into v_id;

  update public.payment_events
     set outcome = 'applied', detail = jsonb_build_object('subscription_id', v_id)
   where stripe_event_id = p_event_id;

  return jsonb_build_object('status', 'applied', 'subscription_id', v_id);
end;
$$;

-- ── 8. Refund / dispute — recorded, flagged, never clawed back ──────────────
create or replace function public.stripe_record_refund(
  p_token               text,
  p_event_id            text,
  p_event_type          text,
  p_provider_payment_id text,
  p_amount_cents        integer,
  p_status              text,
  p_metadata            jsonb
)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_payment public.payments%rowtype;
begin
  if not public.server_call_ok(p_token) then
    raise exception 'forbidden';
  end if;

  insert into public.payment_events (stripe_event_id, event_type, object_id, outcome)
  values (p_event_id, p_event_type, p_provider_payment_id, 'processing')
  on conflict (stripe_event_id) do nothing;
  if not found then
    return jsonb_build_object('status', 'duplicate_event');
  end if;

  -- A REFUND MUST NAME A PAYMENT WE ACTUALLY RECORDED. P0-02's lesson: a
  -- money-returning path that trusts an amount instead of a prior receipt is
  -- how credits get minted.
  select * into v_payment from public.payments
   where provider = 'stripe' and provider_payment_id = p_provider_payment_id;

  if not found then
    update public.payment_events set outcome = 'unknown_payment' where stripe_event_id = p_event_id;
    return jsonb_build_object('status', 'unknown_payment');
  end if;

  update public.payments
     set status = coalesce(nullif(p_status, ''), 'refunded'),
         metadata = metadata || jsonb_build_object(
           'refund', jsonb_build_object(
             'stripe_event_id', p_event_id,
             'amount_cents', p_amount_cents,
             -- NO CLAWBACK. credit_wallets carries CHECK (balance >= 0), so a
             -- customer who already spent what they bought cannot be debited,
             -- and choosing who absorbs that is a business decision nobody has
             -- made. The flag is what a human acts on.
             'credits_clawed_back', false,
             'needs_review', true))
   where id = v_payment.id;

  update public.payment_events
     set outcome = 'recorded',
         detail = jsonb_build_object('payment_id', v_payment.id,
                                     'credits_originally_granted', v_payment.credits_granted)
   where stripe_event_id = p_event_id;

  return jsonb_build_object('status', 'recorded', 'payment_id', v_payment.id,
                            'credits_clawed_back', false, 'needs_review', true);
end;
$$;

-- ── 9. Customer mapping, read and write, server-side only ───────────────────
create or replace function public.stripe_link_customer(
  p_token text, p_workspace_id uuid, p_stripe_customer_id text, p_livemode boolean
)
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v_existing text;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;

  -- Never create a second Customer for a workspace that already has one: the
  -- first one owns the saved cards, the invoices and the portal session.
  select stripe_customer_id into v_existing
    from public.stripe_customers where workspace_id = p_workspace_id;
  if v_existing is not null then return v_existing; end if;

  insert into public.stripe_customers (workspace_id, stripe_customer_id, livemode)
  values (p_workspace_id, p_stripe_customer_id, coalesce(p_livemode, false))
  on conflict (workspace_id) do nothing;

  select stripe_customer_id into v_existing
    from public.stripe_customers where workspace_id = p_workspace_id;
  return v_existing;
end;
$$;

create or replace function public.stripe_customer_for(p_token text, p_workspace_id uuid)
returns text
language plpgsql security definer stable set search_path = public, extensions as $$
declare v text;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  select stripe_customer_id into v from public.stripe_customers where workspace_id = p_workspace_id;
  return v;
end;
$$;

-- ── 10. GRANTS ──────────────────────────────────────────────────────────────
-- Granted to anon the same way 0079/0102/0108 grant their server functions:
-- the DISPATCH TOKEN is the gate, not the role. The anon key is public by
-- design and opens none of these without it.
revoke execute on function public.stripe_settle_payment(text,text,text,uuid,text,integer,text,text,integer,credit_tx_type,text,uuid,uuid,text,jsonb) from public;
revoke execute on function public.stripe_sync_subscription(text,text,text,uuid,text,uuid,text,timestamptz,timestamptz,boolean,text,text,jsonb) from public;
revoke execute on function public.stripe_record_refund(text,text,text,text,integer,text,jsonb) from public;
revoke execute on function public.stripe_link_customer(text,uuid,text,boolean) from public;
revoke execute on function public.stripe_customer_for(text,uuid) from public;

grant execute on function public.stripe_settle_payment(text,text,text,uuid,text,integer,text,text,integer,credit_tx_type,text,uuid,uuid,text,jsonb) to anon, authenticated;
grant execute on function public.stripe_sync_subscription(text,text,text,uuid,text,uuid,text,timestamptz,timestamptz,boolean,text,text,jsonb) to anon, authenticated;
grant execute on function public.stripe_record_refund(text,text,text,text,integer,text,jsonb) to anon, authenticated;
grant execute on function public.stripe_link_customer(text,uuid,text,boolean) to anon, authenticated;
grant execute on function public.stripe_customer_for(text,uuid) to anon, authenticated;

comment on function public.stripe_settle_payment(text,text,text,uuid,text,integer,text,text,integer,credit_tx_type,text,uuid,uuid,text,jsonb) is
  'The only path from a confirmed Stripe payment to the credit ledger. '
  'Token-gated, exactly-once in two layers, and it reaches the balance solely '
  'through apply_credit_transaction().';
