-- REGISTRATION CLOSED MEANS CLOSED — INCLUDING BELOW THE APPLICATION.
--
-- The app already refuses to create an account while signup is shut: the
-- server action checks signupAllowedNow() before it calls auth.signUp, and the
-- OAuth callback neutralises a session that turns out to belong to a brand-new
-- user. Both live in Next.js.
--
-- Supabase's own auth endpoints do not. /auth/v1/signup is reachable with the
-- publishable key — which is public by design, because RLS is what protects
-- the data — so anyone who reads it out of the page bundle can POST an e-mail
-- and a password straight past our routes. on_auth_user_created then fires
-- this function and builds a perfectly ordinary account: profile, workspace,
-- wallet, welcome credits. With public login open (which is the whole point of
-- the current pre-launch shape) that account could then sign in normally.
--
-- So the rule moves to where every path has to pass: the trigger. When
-- platform_signup_open() says no, the profile is created BLOCKED, and the
-- welcome bonus is not granted. The row exists in auth.users and can do
-- nothing — the same posture close_out_denied_signup() already takes for the
-- OAuth case, applied at birth instead of afterwards.
--
-- Not an exception, deliberately. Raising here would make Supabase answer 500
-- and would take the app's own signup down with it the moment the two
-- disagreed about the clock; a blocked profile is the reversible version, and
-- an admin can unblock a legitimate account from the users panel (and grant
-- the welcome credits with it, which is why they are withheld rather than
-- given to an account that was refused).
--
-- When signup is OPEN this function behaves exactly as it did before.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ws_id uuid;
  v_wallet_id uuid;
  v_name text;
  v_first text;
  v_last text;
  v_company boolean;
  v_marketing boolean;
  v_terms boolean;
  v_open boolean;
  m jsonb;
begin
  m := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_first := nullif(left(trim(m->>'first_name'), 80), '');
  v_last  := nullif(left(trim(m->>'last_name'), 80), '');
  v_name := coalesce(
    nullif(left(trim(m->>'full_name'), 160), ''),
    nullif(trim(concat_ws(' ', v_first, v_last)), ''),
    split_part(new.email, '@', 1));
  -- Metadata is client-influenced: a garbage value must degrade to false,
  -- never abort the signup.
  v_company   := lower(coalesce(m->>'company_account', 'false')) in ('true','t','1');
  v_marketing := lower(coalesce(m->>'marketing_consent', 'false')) in ('true','t','1');
  v_terms     := lower(coalesce(m->>'accepted_terms', 'false')) in ('true','t','1');

  -- The one new line. Same function the application asks, so the two can
  -- never disagree about whether the door is open.
  v_open := public.platform_signup_open();

  insert into public.profiles (
    id, email, full_name,
    first_name, last_name, phone,
    acquisition_source, acquisition_source_other,
    company_account, company_name, tax_id,
    company_street, company_postal_code, company_city, company_country,
    marketing_consent, marketing_consent_at,
    accepted_terms_at, accepted_privacy_at,
    blocked
  ) values (
    new.id, new.email, v_name,
    v_first, v_last, nullif(left(trim(m->>'phone'), 32), ''),
    nullif(left(m->>'acquisition_source', 40), ''),
    nullif(left(trim(m->>'acquisition_source_other'), 200), ''),
    v_company,
    nullif(left(trim(m->>'company_name'), 200), ''),
    nullif(left(trim(m->>'tax_id'), 20), ''),
    nullif(left(trim(m->>'company_street'), 200), ''),
    nullif(left(trim(m->>'company_postal_code'), 12), ''),
    nullif(left(trim(m->>'company_city'), 120), ''),
    nullif(left(trim(m->>'company_country'), 80), ''),
    v_marketing,
    case when v_marketing then now() end,
    case when v_terms then now() end,
    case when v_terms then now() end,
    -- profiles_role_guard is BEFORE UPDATE, so an insert needs no gate.
    not v_open
  );

  insert into public.user_preferences (user_id, locale)
    values (new.id, coalesce(nullif(m->>'locale',''), 'pl'));
  insert into public.workspaces (name, owner_id) values (v_name, new.id) returning id into v_ws_id;
  insert into public.workspace_members (workspace_id, user_id, role) values (v_ws_id, new.id, 'owner');
  insert into public.credit_wallets (workspace_id, balance) values (v_ws_id, 0) returning id into v_wallet_id;

  -- The workspace and the empty wallet are still built, so unblocking an
  -- account later is one flag rather than a repair job. The BONUS is not:
  -- credits are the thing of value, and an account the platform refused does
  -- not get them.
  if v_open then
    perform public.apply_credit_transaction(
      v_wallet_id, public.get_welcome_credits(), 'bonus', 'Welcome bonus',
      null, '{"source":"signup"}'::jsonb, new.id);
  end if;

  return new;
end;
$function$;
