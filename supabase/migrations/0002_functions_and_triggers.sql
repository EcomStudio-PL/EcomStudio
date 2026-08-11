-- Helper: admin check (security definer to avoid RLS recursion)
create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = uid and role = 'admin');
$$;

create or replace function public.is_workspace_member(ws_id uuid, uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.workspace_members where workspace_id = ws_id and user_id = uid);
$$;

create or replace function public.is_workspace_manager(ws_id uuid, uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.workspace_members where workspace_id = ws_id and user_id = uid and role in ('owner','admin'));
$$;

-- Credit ledger: the ONLY way balances change. Transactional, row-locked, no negative balances.
create or replace function public.apply_credit_transaction(
  p_wallet_id uuid,
  p_amount int,
  p_type public.credit_tx_type,
  p_description text default null,
  p_reference_id uuid default null,
  p_metadata jsonb default '{}'::jsonb,
  p_created_by uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_balance int;
  v_tx_id uuid;
begin
  select balance into v_balance from public.credit_wallets where id = p_wallet_id for update;
  if not found then
    raise exception 'wallet_not_found';
  end if;
  if v_balance + p_amount < 0 then
    raise exception 'insufficient_credits';
  end if;
  update public.credit_wallets
    set balance = v_balance + p_amount, updated_at = now()
    where id = p_wallet_id;
  insert into public.credit_transactions (wallet_id, amount, type, description, reference_id, metadata, created_by)
    values (p_wallet_id, p_amount, p_type, p_description, p_reference_id, p_metadata, p_created_by)
    returning id into v_tx_id;
  return v_tx_id;
end;
$$;
revoke execute on function public.apply_credit_transaction(uuid,int,public.credit_tx_type,text,uuid,jsonb,uuid) from public, anon, authenticated;

-- Audit logging helper (append-only via function)
create or replace function public.log_activity(
  p_workspace_id uuid,
  p_action text,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_metadata jsonb default '{}'::jsonb,
  p_on_behalf_of uuid default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.activity_logs (workspace_id, actor_id, on_behalf_of, action, entity_type, entity_id, metadata)
  values (p_workspace_id, auth.uid(), p_on_behalf_of, p_action, p_entity_type, p_entity_id, p_metadata);
end;
$$;
grant execute on function public.log_activity(uuid,text,text,uuid,jsonb,uuid) to authenticated;

-- Signup automation: profile + preferences + default workspace + membership + wallet + welcome bonus
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ws_id uuid;
  v_wallet_id uuid;
  v_name text;
begin
  v_name := coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1));
  insert into public.profiles (id, email, full_name) values (new.id, new.email, v_name);
  insert into public.user_preferences (user_id, locale)
    values (new.id, coalesce(nullif(new.raw_user_meta_data->>'locale',''), 'pl'));
  insert into public.workspaces (name, owner_id) values (v_name, new.id) returning id into v_ws_id;
  insert into public.workspace_members (workspace_id, user_id, role) values (v_ws_id, new.id, 'owner');
  insert into public.credit_wallets (workspace_id, balance) values (v_ws_id, 0) returning id into v_wallet_id;
  perform public.apply_credit_transaction(v_wallet_id, 25, 'bonus', 'Welcome bonus', null, '{"source":"signup"}'::jsonb, new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Prevent privilege escalation: only admins can change profile.role
create or replace function public.prevent_role_escalation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and not public.is_admin(auth.uid()) then
    raise exception 'not_allowed_to_change_role';
  end if;
  return new;
end;
$$;
create trigger profiles_role_guard before update on public.profiles
  for each row execute function public.prevent_role_escalation();

-- updated_at maintenance
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger workspaces_touch before update on public.workspaces for each row execute function public.touch_updated_at();
create trigger products_touch before update on public.products for each row execute function public.touch_updated_at();
create trigger preferences_touch before update on public.user_preferences for each row execute function public.touch_updated_at();
