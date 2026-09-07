-- SECURITY — a registered customer could mint themselves credits.
--
-- `ensure_welcome_bonus_offer` is SECURITY DEFINER and EXECUTE is granted to
-- `authenticated`, so it is reachable at /rest/v1/rpc/ensure_welcome_bonus_offer
-- with nothing but a normal login. It took p_user_id, p_amount, p_hours,
-- p_campaign_version and p_eligible_at and believed all five.
--
-- The attack was one request:
--
--   POST /rest/v1/rpc/ensure_welcome_bonus_offer
--   { p_user_id: <my own id>, p_amount: 1000000, p_hours: 72,
--     p_campaign_version: 999, p_eligible_at: now() }
--
-- The `on conflict (user_id, campaign_version) do nothing` guard does not fire,
-- because 999 is a campaign that does not exist. claim_welcome_bonus() then
-- picks the newest offer — `order by campaign_version desc limit 1`, which is
-- exactly the forged one — and credits reward_amount through the ledger. The
-- claim path itself is sound; it was being handed a poisoned row.
--
-- THE FUNCTION NO LONGER BELIEVES ITS OWN ARGUMENTS.
--
-- The offer's value, duration and campaign now come from app_settings, which is
-- where the admin panel already writes them and where lib/server/welcome-bonus.ts
-- already reads them — one source of truth, on the server side of the wire. The
-- caller may still only create an offer for THEMSELVES, and only once their
-- e-mail is confirmed, which is the same rule the application enforces.
--
-- The signature is unchanged on purpose: lib/server/welcome-bonus.ts keeps
-- calling it exactly as before, its arguments are simply no longer trusted, and
-- an offer created by the legitimate path is byte-for-byte what it was.
--
-- Not addressed here, deliberately: an admin creating an offer on a customer's
-- behalf. Nothing does that today, and inventing the capability inside a
-- security fix is how security fixes grow holes.

create or replace function public.ensure_welcome_bonus_offer(
  p_user_id uuid,
  p_amount integer,
  p_hours integer,
  p_campaign_version integer,
  p_eligible_at timestamptz
)
returns public.welcome_bonus_offers
language plpgsql security definer set search_path = public
as $$
declare
  v_offer public.welcome_bonus_offers;
  v_config jsonb;
  v_amount integer;
  v_hours integer;
  v_campaign integer;
  v_verified_at timestamptz;
begin
  -- 1. You may only ever create your own offer.
  if auth.uid() is null then
    raise exception 'unauthenticated';
  end if;
  if p_user_id is null or p_user_id <> auth.uid() then
    raise exception 'not_authorized';
  end if;

  -- 2. And only after confirming your e-mail — the same precondition the
  --    application checks before it calls this, enforced again here because a
  --    direct RPC call skips the application entirely.
  select email_confirmed_at into v_verified_at from auth.users where id = p_user_id;
  if v_verified_at is null then
    raise exception 'not_verified';
  end if;

  -- 3. The offer is whatever the admin configured. Not whatever was posted.
  select value into v_config from public.app_settings where key = 'welcome_bonus';
  if v_config is null or coalesce((v_config->>'active')::boolean, false) is not true then
    raise exception 'bonus_inactive';
  end if;
  v_amount   := coalesce((v_config->>'amount')::integer, 0);
  v_hours    := coalesce((v_config->>'hours')::integer, 0);
  v_campaign := coalesce((v_config->>'campaign_version')::integer, 1);
  if v_amount <= 0 or v_amount > 100000 or v_hours <= 0 or v_hours > 8760 then
    raise exception 'invalid_offer_config';
  end if;

  -- 4. And it starts when the account was actually confirmed, not when the
  --    caller says it did.
  insert into public.welcome_bonus_offers
      (user_id, campaign_version, reward_amount, eligible_at, expires_at)
    values
      (p_user_id, v_campaign, v_amount, v_verified_at,
       v_verified_at + make_interval(hours => v_hours))
    on conflict (user_id, campaign_version) do nothing;

  select * into v_offer from public.welcome_bonus_offers
    where user_id = p_user_id and campaign_version = v_campaign;

  if v_offer.status = 'ELIGIBLE' and v_offer.expires_at <= now() then
    update public.welcome_bonus_offers set status = 'EXPIRED'
      where id = v_offer.id returning * into v_offer;
  end if;

  return v_offer;
end;
$$;

-- Nothing signed-out has ever had a reason to call these three, and two of them
-- carry a PUBLIC grant that includes `anon`. Removing it costs nothing — every
-- legitimate caller is an authenticated session — and it takes the whole
-- unauthenticated surface off the table.
--
-- STILL OPEN, deliberately not changed here (see docs/security-audit.md):
--
--   * set_provider_health(text,text,integer,text) — any AUTHENTICATED user can
--     still mark a provider degraded for up to 30 minutes. The obvious guard is
--     to require an admin or a recent usage_event of the caller's own against
--     that provider; the router writes health during a generation attempt, and
--     if that correlation is ever absent the guard silently stops provider
--     failover from learning anything. That is a worse failure than the
--     nuisance it prevents, and it cannot be exercised end-to-end from here, so
--     it is written up rather than guessed at.
--   * get_active_provider_credential(uuid) — any AUTHENTICATED user can still
--     read the AES-GCM ciphertext, IV, auth tag and base_url of provider
--     credentials. The plaintext needs APP_ENCRYPTION_KEY, which is server-only
--     and never leaves the server, so this is credential material rather than a
--     usable key. The fix is the p_token pattern this schema already uses
--     (notification_dispatch_claim, integration_dispatch_read); it changes six
--     call sites on the generation path.
revoke execute on function public.ensure_welcome_bonus_offer(uuid, integer, integer, integer, timestamptz) from anon;
revoke execute on function public.set_provider_health(text, text, integer, text) from anon, public;
revoke execute on function public.get_active_provider_credential(uuid) from anon, public;
