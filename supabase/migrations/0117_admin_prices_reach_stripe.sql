-- ============================================================================
-- 0117 — THE PRICE AN ADMIN TYPES IS THE PRICE STRIPE CHARGES.
--
-- THE BUG THIS CLOSES.
--
-- `savePlanFullAction`, `updatePlanAction` and `savePackageAction` all write
-- `price_cents` straight to Postgres and never speak to Stripe. The mapping
-- columns — `stripe_price_id_monthly`, `stripe_price_id`— keep pointing at the
-- Price object created when the catalogue was first set up. So:
--
--     admin edits 49,00 zł → 59,00 zł
--     GrovBase shows        59,00 zł
--     Stripe charges        49,00 zł
--
-- and nothing anywhere notices, because the two numbers live in two systems
-- and nothing ever compares them. The customer is billed an amount they were
-- never shown. That is the worst class of billing bug: silent, and in the
-- direction of the merchant.
--
-- ─── WHY A NEW PRICE, NOT AN EDIT ───────────────────────────────────────────
--
-- A Stripe Price is IMMUTABLE in its `unit_amount`. There is no update that
-- changes what a Price charges, by design — a Price is the thing subscriptions
-- and invoices point at, and letting it change retroactively would rewrite what
-- customers already agreed to. The documented flow is: create a NEW Price on
-- the SAME Product, point at it, archive the old one. The Product is the
-- product; the Price is one version of what it costs.
--
-- ─── WHAT THIS MIGRATION ADDS, AND WHY EACH PIECE EARNS ITS PLACE ───────────
--
-- 1. THE AMOUNT STRIPE CONFIRMED, recorded next to the amount GrovBase shows.
--
--    `stripe_price_monthly_cents`, `stripe_price_annual_cents`,
--    `stripe_price_cents` are NOT duplicates of `price_cents`. They are the
--    amount the LIVE Stripe Price object actually carries, written only after
--    Stripe answered. Two numbers from two systems, side by side in one row —
--    which is the only arrangement in which "GrovBase says 59, Stripe says 49"
--    is a thing a query can find, a test can fail on, and checkout can refuse.
--
--    Storing one number and hoping would reproduce the bug with extra steps.
--
-- 2. SYNC STATE, so a failure is visible rather than assumed away.
--
--    `stripe_sync_status` is the row's answer to "is the catalogue entry safe
--    to sell?". Only 'synced' means yes. 'syncing' is the window between
--    creating a Price in Stripe and recording it here — a window that exists
--    because those are two systems and there is no transaction across them.
--
-- 3. ONE FUNCTION THAT WRITES PRICE AND MAPPING TOGETHER.
--
--    `stripe_apply_price` sets the displayed amount, the Stripe ids and the
--    confirmed amount in a SINGLE statement. They cannot drift because they
--    cannot be written separately. An admin action that updated `price_cents`
--    on its own would recreate the bug, so `price_cents` is no longer written
--    by the ordinary save path at all.
--
--    It RETURNS THE PRICE ID IT REPLACED, because the caller's next job is to
--    archive that Price in Stripe and it must not have to guess which one.
--
-- ─── WHAT ORDER THE CALLER MUST USE, AND WHY ────────────────────────────────
--
--    1. create the new Price in Stripe        ← the step that can fail
--    2. stripe_apply_price(...)               ← one atomic local write
--    3. archive the Price it returned         ← best effort
--
-- Stripe first, because a Stripe failure must leave GrovBase's price exactly as
-- it was (the admin sees an error and the old price stays live and correct).
-- If step 2 fails, Stripe holds a Price nothing references — inert, because no
-- checkout can reach a Price id that was never recorded — and the caller
-- archives it to keep the account tidy. If step 3 fails the customer-facing
-- invariant still holds: new purchases use the new id. That is why an archive
-- failure is a note, not a status.
-- ============================================================================

-- ─── 1. WHAT STRIPE CONFIRMED, AND WHETHER IT IS CURRENT ────────────────────

alter table public.subscription_plans
  add column if not exists stripe_price_monthly_cents integer,
  add column if not exists stripe_price_annual_cents  integer,
  add column if not exists stripe_sync_status         text not null default 'unknown',
  add column if not exists stripe_synced_at           timestamptz,
  add column if not exists stripe_sync_error          text;

alter table public.credit_packages
  add column if not exists stripe_price_cents  integer,
  add column if not exists stripe_sync_status  text not null default 'unknown',
  add column if not exists stripe_synced_at    timestamptz,
  add column if not exists stripe_sync_error   text;

comment on column public.subscription_plans.stripe_price_monthly_cents is
  'The unit_amount the LIVE monthly Stripe Price carries, recorded when Stripe '
  'confirmed it. Compared against price_cents to detect drift. Never assumed.';
comment on column public.credit_packages.stripe_price_cents is
  'The unit_amount the LIVE Stripe Price carries, recorded when Stripe '
  'confirmed it. Compared against price_cents to detect drift. Never assumed.';

-- 'unknown' is the honest default for every row that predates this migration:
-- those Prices were created by hand and nothing has verified them yet. It is
-- deliberately NOT 'synced' — claiming a sync nobody performed is the same
-- class of lie this migration exists to end. A verification pass moves them.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'subscription_plans_stripe_sync_status_check'
  ) then
    alter table public.subscription_plans
      add constraint subscription_plans_stripe_sync_status_check
      check (stripe_sync_status in ('unknown', 'syncing', 'synced', 'failed', 'reconcile'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'credit_packages_stripe_sync_status_check'
  ) then
    alter table public.credit_packages
      add constraint credit_packages_stripe_sync_status_check
      check (stripe_sync_status in ('unknown', 'syncing', 'synced', 'failed', 'reconcile'));
  end if;
end $$;

-- ─── 2. THE ONE STATEMENT THAT MOVES A PRICE ────────────────────────────────
--
-- Gated by the dispatch token like every other function on the money path
-- (0113/0114/0115), because this one decides what customers are charged. An
-- admin session alone is not sufficient proof: the caller must be the SERVER,
-- which is the only thing that has just watched Stripe confirm the amount it
-- is about to record.

create or replace function public.stripe_apply_price(
  p_token             text,
  p_entity            text,     -- 'plan' | 'package'
  p_entity_id         uuid,
  p_period            text,     -- 'monthly' | 'annual'; ignored for a package
  p_price_cents       integer,
  p_currency          text,
  p_stripe_product_id text,
  p_stripe_price_id   text      -- null means "this period is not for sale"
)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_previous text;
  v_found    boolean := false;
begin
  if not public.server_call_ok(p_token) then
    raise exception 'forbidden';
  end if;
  if p_price_cents is null or p_price_cents < 0 then
    raise exception 'invalid_amount';
  end if;

  if p_entity = 'package' then
    select stripe_price_id into v_previous
      from public.credit_packages where id = p_entity_id for update;
    if not found then return jsonb_build_object('status', 'unknown_entity'); end if;

    update public.credit_packages
       set price_cents        = p_price_cents,
           -- The displayed amount and the confirmed amount are set together,
           -- from the same argument, in the same statement. There is no
           -- interleaving in which they disagree.
           stripe_price_cents = p_price_cents,
           currency           = coalesce(p_currency, currency),
           stripe_product_id  = coalesce(p_stripe_product_id, stripe_product_id),
           stripe_price_id    = p_stripe_price_id,
           stripe_sync_status = 'synced',
           stripe_synced_at   = now(),
           stripe_sync_error  = null
     where id = p_entity_id;
    v_found := true;

  elsif p_entity = 'plan' then
    if p_period not in ('monthly', 'annual') then
      raise exception 'invalid_period';
    end if;

    if p_period = 'monthly' then
      select stripe_price_id_monthly into v_previous
        from public.subscription_plans where id = p_entity_id for update;
      if not found then return jsonb_build_object('status', 'unknown_entity'); end if;
      update public.subscription_plans
         set price_cents                = p_price_cents,
             stripe_price_monthly_cents = p_price_cents,
             currency                   = coalesce(p_currency, currency),
             stripe_product_id          = coalesce(p_stripe_product_id, stripe_product_id),
             stripe_price_id_monthly    = p_stripe_price_id,
             stripe_synced_at           = now(),
             stripe_sync_error          = null,
             -- A PLAN HAS TWO PRICES AND ONE STATUS. It is 'synced' only when
             -- BOTH periods agree with Stripe: the monthly one this statement
             -- just wrote, and the annual one as it already stands. An annual
             -- price of 0 means "not sold annually", which is a consistent
             -- state, not an unsynced one.
             stripe_sync_status         = case
               when annual_price_cents = 0 and stripe_price_id_annual is null then 'synced'
               when annual_price_cents = coalesce(stripe_price_annual_cents, -1) then 'synced'
               else 'reconcile'
             end
       where id = p_entity_id;
    else
      select stripe_price_id_annual into v_previous
        from public.subscription_plans where id = p_entity_id for update;
      if not found then return jsonb_build_object('status', 'unknown_entity'); end if;
      update public.subscription_plans
         set annual_price_cents        = p_price_cents,
             stripe_price_annual_cents = case when p_stripe_price_id is null then null
                                              else p_price_cents end,
             currency                  = coalesce(p_currency, currency),
             stripe_product_id         = coalesce(p_stripe_product_id, stripe_product_id),
             stripe_price_id_annual    = p_stripe_price_id,
             stripe_synced_at          = now(),
             stripe_sync_error         = null,
             stripe_sync_status        = case
               when price_cents = coalesce(stripe_price_monthly_cents, -1) then 'synced'
               else 'reconcile'
             end
       where id = p_entity_id;
    end if;
    v_found := true;
  else
    raise exception 'invalid_entity';
  end if;

  return jsonb_build_object(
    'status', case when v_found then 'applied' else 'unknown_entity' end,
    -- The Price this replaced, so the caller can archive exactly that one and
    -- never has to re-derive it from a row it has already overwritten.
    'previous_price_id', v_previous
  );
end $$;

-- ─── 3. SAYING SO WHEN IT DID NOT WORK ──────────────────────────────────────
--
-- Marking 'syncing' BEFORE the Stripe call and 'failed' after a refusal is what
-- turns a silent half-change into something the admin screen can show and a
-- human can retry. It touches no amount and no id: a status may never be the
-- thing that changes what a customer is charged.

create or replace function public.stripe_mark_price_sync(
  p_token     text,
  p_entity    text,
  p_entity_id uuid,
  p_status    text,
  p_error     text
)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.server_call_ok(p_token) then
    raise exception 'forbidden';
  end if;
  if p_status not in ('unknown', 'syncing', 'synced', 'failed', 'reconcile') then
    raise exception 'invalid_status';
  end if;

  if p_entity = 'package' then
    update public.credit_packages
       set stripe_sync_status = p_status,
           stripe_sync_error  = p_error
     where id = p_entity_id;
  elsif p_entity = 'plan' then
    update public.subscription_plans
       set stripe_sync_status = p_status,
           stripe_sync_error  = p_error
     where id = p_entity_id;
  else
    raise exception 'invalid_entity';
  end if;

  return jsonb_build_object('status', 'marked');
end $$;

-- ─── 4. WHAT IS UNSAFE TO SELL RIGHT NOW ────────────────────────────────────
--
-- One query an operator, a test and a health check can all ask: which catalogue
-- entries would charge an amount other than the one they display? An empty
-- result is the invariant holding. A non-empty one names every row and both
-- numbers, which is exactly what a human needs to fix it.

create or replace view public.stripe_price_drift as
  select 'plan'::text  as entity, id, name, 'monthly'::text as period,
         price_cents as grovbase_cents, stripe_price_monthly_cents as stripe_cents,
         stripe_sync_status, stripe_synced_at
    from public.subscription_plans
   where active and price_cents > 0
     and (stripe_sync_status <> 'synced'
          or stripe_price_monthly_cents is distinct from price_cents)
  union all
  select 'plan', id, name, 'annual',
         annual_price_cents, stripe_price_annual_cents,
         stripe_sync_status, stripe_synced_at
    from public.subscription_plans
   where active and annual_price_cents > 0
     and (stripe_sync_status <> 'synced'
          or stripe_price_annual_cents is distinct from annual_price_cents)
  union all
  select 'package', id, name, null::text,
         price_cents, stripe_price_cents,
         stripe_sync_status, stripe_synced_at
    from public.credit_packages
   where active
     and (stripe_sync_status <> 'synced'
          or stripe_price_cents is distinct from price_cents);

-- SECURITY INVOKER, so the view does not become a way around the catalogue's
-- own RLS. A plain view runs as its owner and would show every row — including
-- withdrawn ones — to any authenticated caller. Nothing here is a secret, but a
-- diagnostic that quietly widens visibility is how a leak gets built later.
alter view public.stripe_price_drift set (security_invoker = true);

comment on view public.stripe_price_drift is
  'Catalogue entries whose displayed price is not provably the price Stripe '
  'would charge. Empty is the invariant holding.';

-- The view reads the catalogue tables and is therefore subject to their RLS
-- for anyone but the definer. It is an ADMIN diagnostic; no anon grant.
revoke all on public.stripe_price_drift from anon;
grant select on public.stripe_price_drift to authenticated;

-- ─── 5. GRANTS, THE SAME SHAPE AS EVERY OTHER SERVER FUNCTION ───────────────
--
-- Executable by anon/authenticated only in the sense that the ROLE may call it;
-- `server_call_ok(p_token)` inside is what actually decides. Same pattern as
-- 0113/0114/0115 — the grant is not the gate.

revoke execute on function public.stripe_apply_price(text,text,uuid,text,integer,text,text,text) from public;
revoke execute on function public.stripe_mark_price_sync(text,text,uuid,text,text) from public;

grant execute on function public.stripe_apply_price(text,text,uuid,text,integer,text,text,text) to anon, authenticated;
grant execute on function public.stripe_mark_price_sync(text,text,uuid,text,text) to anon, authenticated;
