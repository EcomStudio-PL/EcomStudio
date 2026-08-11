-- Recovery path: users that exist in auth.users but are missing application
-- records (created before the signup trigger, or after a partial failure)
-- can self-heal. Idempotent: never duplicates workspaces, wallets or bonuses.
create or replace function public.bootstrap_current_user()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_name text;
  v_ws_id uuid;
  v_wallet_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  select email, coalesce(raw_user_meta_data->>'full_name', split_part(email, '@', 1))
    into v_email, v_name
    from auth.users where id = v_uid;

  insert into public.profiles (id, email, full_name)
    values (v_uid, v_email, v_name)
    on conflict (id) do nothing;

  insert into public.user_preferences (user_id)
    values (v_uid)
    on conflict (user_id) do nothing;

  select workspace_id into v_ws_id
    from public.workspace_members
    where user_id = v_uid
    order by created_at asc
    limit 1;

  if v_ws_id is null then
    insert into public.workspaces (name, owner_id) values (v_name, v_uid) returning id into v_ws_id;
    insert into public.workspace_members (workspace_id, user_id, role) values (v_ws_id, v_uid, 'owner');
  end if;

  if not exists (select 1 from public.credit_wallets where workspace_id = v_ws_id) then
    insert into public.credit_wallets (workspace_id, balance) values (v_ws_id, 0) returning id into v_wallet_id;
    perform public.apply_credit_transaction(v_wallet_id, 25, 'bonus', 'Welcome bonus', null, '{"source":"bootstrap_recovery"}'::jsonb, v_uid);
  end if;
end;
$$;
revoke execute on function public.bootstrap_current_user() from public, anon;
grant execute on function public.bootstrap_current_user() to authenticated;
