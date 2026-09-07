-- PERFORMANCE — two admin figures that were counted in JavaScript over tables
-- that grow with the customer base.
--
--   * Analytics › Klienci summed every row of credit_wallets to show one
--     number: the credits outstanding across the platform.
--   * Rejestracja i bonus read every row of welcome_bonus_offers — status,
--     eligible_at, claimed_at, expires_at — to produce four counters and an
--     average.
--
-- Both are aggregates, so they belong in SQL. Both are SECURITY INVOKER on
-- purpose, exactly like generation_credits_total() in 0037: RLS still decides
-- which rows the caller may aggregate, so neither function grants anything a
-- customer could not already read about themselves.

create or replace function public.credit_wallets_total()
returns bigint
language sql stable security invoker set search_path = public
as $$
  select coalesce(sum(balance), 0)::bigint from public.credit_wallets;
$$;

-- One row of counters instead of one row per customer. The average is folded
-- in here too, so the offers table is read once and never leaves the database.
create or replace function public.welcome_bonus_stats()
returns table (
  issued bigint,
  claimed bigint,
  expired bigint,
  pending bigint,
  avg_hours_to_claim numeric
)
language sql stable security invoker set search_path = public
as $$
  select
    count(*)::bigint as issued,
    count(*) filter (where claimed_at is not null)::bigint as claimed,
    count(*) filter (where claimed_at is null and expires_at <= now())::bigint as expired,
    count(*) filter (where claimed_at is null and expires_at > now())::bigint as pending,
    avg(extract(epoch from (claimed_at - eligible_at)) / 3600.0)
      filter (where claimed_at is not null) as avg_hours_to_claim
  from public.welcome_bonus_offers;
$$;

-- The partial predicate the counters above filter on. Small table today; the
-- index is here because the query exists, not on speculation.
create index if not exists welcome_bonus_offers_claimed_idx
  on public.welcome_bonus_offers (claimed_at, expires_at);
