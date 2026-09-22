-- ============================================================================
-- 0115 — THE WEBHOOK MUST BE ABLE TO READ WHAT IT IS CREDITING.
--
-- THE BUG THIS FIXES, FOUND BEFORE THE FIRST REAL PAYMENT AND NOT AFTER.
--
-- The webhook decides how many credits a payment is worth by reading the row:
-- `credit_packages` for a pack, `subscription_plans` for a renewal. It reads
-- them with the ANON key, because this application has no service-role client
-- and a webhook carries no user session.
--
-- Those two tables carry this policy:
--
--     using (active = true or public.is_admin())
--
-- and `is_admin()` is NOT executable by `anon`:
--
--     has_function_privilege('anon', 'public.is_admin()', 'execute') = false
--
-- `is_admin()` takes no arguments, so it does not vary per row, so the planner
-- hoists it into an InitPlan and evaluates it ONCE, up front — for every query,
-- including one that only ever touches active rows. The result is not "no rows
-- visible". It is a hard error:
--
--     ERROR: 42501: permission denied for function is_admin
--
-- The call site destructured only `data`, so that error arrived as `null`,
-- which is indistinguishable from "no such package" — and the handler treats no
-- package as ZERO CREDITS. A customer would have paid 79 zł, received nothing,
-- and Stripe would have been told 200 OK, so it would never retry. Silent, and
-- exactly the failure the whole design exists to prevent.
--
-- ─── WHY A FUNCTION RATHER THAN A GRANT ─────────────────────────────────────
--
-- Granting `is_admin()` to anon would make the policy evaluable and is the
-- one-line fix. It is not the right one, for two reasons.
--
--   1. IT WOULD STILL BE WRONG FOR A WITHDRAWN PACKAGE. `active = true` hides
--      deactivated rows from anon. A purchase can be in flight when an admin
--      withdraws a package — the customer's money is already gone — and that
--      payment must still credit what was bought. Under RLS it would credit 0.
--
--   2. THE MONEY PATH ALREADY HAS A WAY TO PROVE IT IS THE SERVER. Every write
--      the webhook makes goes through a SECURITY DEFINER function gated by the
--      dispatch token (0113/0114). Its READS were the one place still pretending
--      to be an anonymous visitor. One door, one proof, for both directions.
--
-- This function therefore reads the catalogue WITHOUT the active filter, on
-- purpose: it answers "what was bought", not "what is on sale".
-- ============================================================================

create or replace function public.stripe_catalogue(
  p_token      text,
  p_package_id uuid,
  p_plan_id    uuid,
  p_price_id   text
)
returns jsonb
language plpgsql security definer stable set search_path = public, extensions as $$
declare
  v_package jsonb := null;
  v_plan    jsonb := null;
begin
  if not public.server_call_ok(p_token) then
    raise exception 'forbidden';
  end if;

  -- A PACKAGE, by its own id first, then by the Stripe price that was charged.
  -- The price id is the stronger evidence — it is what Stripe actually billed —
  -- but the id is what GrovBase itself wrote into the session metadata, so it
  -- is tried first and the price is the fallback for anything created outside
  -- the app.
  select jsonb_build_object(
           'id', id, 'name', name,
           'credits', credits, 'bonus_credits', bonus_credits,
           'active', active)
    into v_package
    from public.credit_packages
   where (p_package_id is not null and id = p_package_id)
      or (p_package_id is null and p_price_id is not null and stripe_price_id = p_price_id)
   limit 1;

  select jsonb_build_object(
           'id', id, 'name', name, 'slug', slug,
           'monthly_credits', monthly_credits, 'bonus_credits', bonus_credits,
           'active', active)
    into v_plan
    from public.subscription_plans
   where (p_plan_id is not null and id = p_plan_id)
      or (p_plan_id is null and p_price_id is not null
          and (stripe_price_id_monthly = p_price_id or stripe_price_id_annual = p_price_id))
   limit 1;

  return jsonb_build_object('package', v_package, 'plan', v_plan);
end;
$$;

comment on function public.stripe_catalogue(text, uuid, uuid, text) is
  'What was bought, for the webhook that must credit it. Token-gated and '
  'SECURITY DEFINER because the webhook holds only the anon key, and the RLS '
  'policy on these tables calls is_admin(), which anon may not execute. '
  'Deliberately ignores `active`: a purchase in flight when a package is '
  'withdrawn must still credit what the customer paid for.';

revoke execute on function public.stripe_catalogue(text, uuid, uuid, text) from public;
grant  execute on function public.stripe_catalogue(text, uuid, uuid, text) to anon, authenticated;
