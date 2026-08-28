-- AUTH UPGRADE — richer registration profile + consent records.
--
-- All columns are NULLABLE (or defaulted) so every existing account keeps
-- logging in untouched; the new requirements apply to new registrations,
-- where the signup trigger copies the values out of auth metadata.
-- RLS is unchanged: profiles already enforce own-or-admin select/update,
-- and the role/blocked/account_manager_id trigger guard is untouched.

alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists phone text,
  add column if not exists acquisition_source text,
  add column if not exists acquisition_source_other text,
  add column if not exists company_account boolean not null default false,
  add column if not exists company_name text,
  add column if not exists tax_id text,
  add column if not exists company_street text,
  add column if not exists company_postal_code text,
  add column if not exists company_city text,
  add column if not exists company_country text,
  add column if not exists marketing_consent boolean not null default false,
  add column if not exists marketing_consent_at timestamptz,
  add column if not exists accepted_terms_at timestamptz,
  add column if not exists accepted_privacy_at timestamptz;

-- The signup trigger now copies the registration form (delivered via
-- auth raw_user_meta_data) into the profile row. Every value is length-capped
-- — metadata is client-influenced and must not become unbounded storage.
-- Consent TIMESTAMPS are stamped server-side (now()), never trusted from
-- the client; the booleans only decide whether a stamp is written.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ws_id uuid;
  v_wallet_id uuid;
  v_name text;
  v_first text;
  v_last text;
  v_company boolean;
  v_marketing boolean;
  v_terms boolean;
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
  -- One combined checkbox covers terms AND privacy on the form, so both
  -- timestamps deliberately come from the same accepted_terms flag.
  v_terms     := lower(coalesce(m->>'accepted_terms', 'false')) in ('true','t','1');

  insert into public.profiles (
    id, email, full_name,
    first_name, last_name, phone,
    acquisition_source, acquisition_source_other,
    company_account, company_name, tax_id,
    company_street, company_postal_code, company_city, company_country,
    marketing_consent, marketing_consent_at,
    accepted_terms_at, accepted_privacy_at
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
    case when v_terms then now() end
  );

  insert into public.user_preferences (user_id, locale)
    values (new.id, coalesce(nullif(m->>'locale',''), 'pl'));
  insert into public.workspaces (name, owner_id) values (v_name, new.id) returning id into v_ws_id;
  insert into public.workspace_members (workspace_id, user_id, role) values (v_ws_id, new.id, 'owner');
  insert into public.credit_wallets (workspace_id, balance) values (v_ws_id, 0) returning id into v_wallet_id;
  -- Welcome credits stay admin-configurable (0008), not hardcoded.
  perform public.apply_credit_transaction(v_wallet_id, public.get_welcome_credits(), 'bonus', 'Welcome bonus', null, '{"source":"signup"}'::jsonb, new.id);
  return new;
end;
$$;
