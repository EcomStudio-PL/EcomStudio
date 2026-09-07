-- ADMIN CRM — the two facts about an account that live in auth, not in public.
--
-- `profiles` knows a customer's name, role and whether an operator blocked
-- them. It does not know whether they ever confirmed their e-mail or when they
-- last signed in, because those belong to `auth.users`, which no client role
-- may read. The CRM needs both: "Niezweryfikowani" is a filter an operator
-- actually uses, and "resend verification" must not be offered to somebody who
-- verified months ago.
--
-- Rather than invent the state in the UI, this exposes exactly those two
-- columns, to admins only.

create or replace function public.admin_user_facts(p_ids uuid[])
returns table (id uuid, email_confirmed_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  -- SECURITY DEFINER reads auth.users, so the guard is the whole point.
  if not public.is_admin(auth.uid()) then
    raise exception 'not_authorized';
  end if;
  return query
    select u.id, u.email_confirmed_at, u.last_sign_in_at
    from auth.users u
    where u.id = any(p_ids);
end;
$$;

revoke execute on function public.admin_user_facts(uuid[]) from anon, public;

-- ADMIN CRM — closing an account without destroying the books.
--
-- A hard `delete from auth.users` cascades: profiles → workspaces → payments.
-- The customer's invoices would go with them, which is both wrong accounting
-- and, in most of Europe, not ours to do. What an operator actually wants from
-- "Usuń konto" is that the person can no longer sign in and their personal
-- data is gone.
--
-- So this anonymises and locks:
--   * the profile's name, phone and company details are cleared,
--   * the e-mail becomes an unusable placeholder carrying the account id,
--   * `blocked` is set, which every login path already honours.
--
-- Payments, credit transactions and usage events keep their workspace foreign
-- key and their amounts. Nothing that a ledger needs is touched.
create or replace function public.admin_soft_delete_user(p_user_id uuid, p_confirm_email text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_email text;
begin
  if not public.is_admin(v_actor) then
    raise exception 'not_authorized';
  end if;
  -- An admin cannot close their own account from the CRM: it would lock the
  -- panel behind a door nobody is left holding a key to.
  if p_user_id = v_actor then
    raise exception 'cannot_delete_self';
  end if;

  select email into v_email from public.profiles where id = p_user_id;
  if v_email is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  -- The typed confirmation is checked HERE, not only in the dialog: a mistyped
  -- address must fail on the server too, or the confirmation is decoration.
  if lower(coalesce(p_confirm_email, '')) <> lower(v_email) then
    return jsonb_build_object('ok', false, 'error', 'confirmation_mismatch');
  end if;

  update public.profiles set
    email = 'usuniete-' || left(p_user_id::text, 8) || '@grovbase.invalid',
    full_name = null, first_name = null, last_name = null, phone = null,
    company_name = null, tax_id = null, company_street = null,
    company_postal_code = null, company_city = null, company_country = null,
    avatar_url = null,
    blocked = true,
    updated_at = now()
  where id = p_user_id;

  return jsonb_build_object('ok', true, 'email', v_email);
end;
$$;

revoke execute on function public.admin_soft_delete_user(uuid, text) from anon, public;
