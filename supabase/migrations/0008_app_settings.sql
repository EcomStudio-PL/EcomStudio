-- Central application configuration: one source of truth, editable by admins.
create table public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
-- Settings hold no secrets; readable so signup flow can check registration_enabled.
create policy "settings_select_all" on public.app_settings for select using (true);
create policy "settings_admin_write" on public.app_settings for all
  using (public.is_admin()) with check (public.is_admin());

insert into public.app_settings (key, value) values
 ('general', '{"app_name":"EcomStudio","support_email":"","default_locale":"pl","default_theme":"system"}'),
 ('user_defaults', '{"welcome_credits":25,"default_plan":"free"}'),
 ('generation', '{"default_format":"1:1","default_prompt_count":7,"max_reference_images":10,"max_upload_mb":10}'),
 ('security', '{"registration_enabled":true,"maintenance_mode":false}'),
 ('features', '{"prompt_generator":true,"image_generator":true,"video_generation":false,"team_features":false}')
on conflict (key) do nothing;

-- Welcome credits become configurable (fallback 25).
create or replace function public.get_welcome_credits()
returns int language sql stable security definer set search_path = public as $$
  select coalesce((select (value->>'welcome_credits')::int from public.app_settings where key = 'user_defaults'), 25);
$$;
revoke execute on function public.get_welcome_credits() from public, anon, authenticated;

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
  perform public.apply_credit_transaction(v_wallet_id, public.get_welcome_credits(), 'bonus', 'Welcome bonus', null, '{"source":"signup"}'::jsonb, new.id);
  return new;
end;
$$;

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
    perform public.apply_credit_transaction(v_wallet_id, public.get_welcome_credits(), 'bonus', 'Welcome bonus', null, '{"source":"bootstrap_recovery"}'::jsonb, v_uid);
  end if;
end;
$$;
