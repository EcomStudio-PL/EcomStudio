-- SECURITY HARDENING — tighten the exposed SECURITY DEFINER surface.
-- Findings come from the Supabase security advisor plus a manual read of
-- every definer function body. The credit functions were already internally
-- gated (auth.uid() + workspace membership + FOR UPDATE + refund-replay
-- guards) and keep their behavior; this migration fixes the three functions
-- that were NOT gated and removes grants no legitimate caller uses.

-- 1) set_provider_health had NO auth check: an anonymous caller could mark
--    any provider "down" with a 30-minute cooldown and stall generation for
--    every customer. It is called during authenticated generation flows, so
--    requiring a signed-in caller preserves the app path.
create or replace function public.set_provider_health(
  p_slug text, p_state text, p_cooldown_seconds integer default 0, p_note text default null
) returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if auth.uid() is null then
    raise exception 'unauthenticated';
  end if;
  if p_state not in ('healthy','rate_limited','quota_exhausted','auth_error','degraded','down') then
    raise exception 'invalid_state';
  end if;
  if not exists (select 1 from public.ai_providers where slug = p_slug) then
    raise exception 'unknown_provider';
  end if;
  insert into public.provider_health (provider_slug, state, cooldown_until, note, updated_at)
  values (
    p_slug, p_state,
    case when p_cooldown_seconds > 0
      then now() + make_interval(secs => least(p_cooldown_seconds, 1800))
      else null end,
    left(p_note, 200), now()
  )
  on conflict (provider_slug) do update
    set state = excluded.state,
        cooldown_until = excluded.cooldown_until,
        note = excluded.note,
        updated_at = now();
end $$;

-- 2) log_activity accepted any workspace id: an authenticated user could
--    insert forged audit rows into another customer's activity log. The
--    caller must belong to the workspace — or be an admin acting on a
--    customer's behalf, which is exactly the on_behalf_of use case.
create or replace function public.log_activity(
  p_workspace_id uuid, p_action text, p_entity_type text default null,
  p_entity_id uuid default null, p_metadata jsonb default '{}'::jsonb,
  p_on_behalf_of uuid default null
) returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if auth.uid() is null then
    raise exception 'unauthenticated';
  end if;
  if not (public.is_workspace_member(p_workspace_id) or public.is_admin()) then
    raise exception 'not_authorized';
  end if;
  insert into public.activity_logs (workspace_id, actor_id, on_behalf_of, action, entity_type, entity_id, metadata)
  values (p_workspace_id, auth.uid(), p_on_behalf_of, p_action, p_entity_type, p_entity_id, p_metadata);
end $$;

-- 3) anon has no business executing any of these: every function already
--    rejects unauthenticated callers (or is admin-gated), so the grant only
--    widens the attack surface and trips the advisor. Legitimate calls all
--    run as `authenticated`.
revoke execute on function public.charge_usage_credits(uuid, integer, text, uuid, jsonb) from anon;
revoke execute on function public.complete_usage_event(uuid, integer) from anon;
revoke execute on function public.complete_usage_event(uuid, integer, bigint, text) from anon;
revoke execute on function public.fail_usage_event(uuid, text) from anon;
revoke execute on function public.fail_usage_event(uuid, text, bigint) from anon;
revoke execute on function public.refund_usage_event(uuid) from anon;
revoke execute on function public.get_active_provider_credential(uuid) from anon;
revoke execute on function public.set_generation_favorite(uuid, boolean) from anon;
revoke execute on function public.set_provider_health(text, text, integer, text) from anon;
revoke execute on function public.log_activity(uuid, text, text, uuid, jsonb, uuid) from anon;

-- 4) The price-history trackers are TRIGGER functions — nothing should call
--    them through the API at all.
revoke execute on function public.track_model_price_change() from anon, authenticated;
revoke execute on function public.track_service_price_change() from anon, authenticated;

-- 5) The profiles self-update policy let a BLOCKED user flip their own
--    `blocked` flag back off through a direct PostgREST call (the trigger
--    guarded only `role`). Admin-owned columns now share one guard: a
--    non-admin cannot change role, blocked, or account_manager_id — their
--    own row's ordinary fields stay editable exactly as before.
create or replace function public.prevent_role_escalation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(auth.uid()) then
    if new.role is distinct from old.role then
      raise exception 'not_allowed_to_change_role';
    end if;
    if new.blocked is distinct from old.blocked then
      raise exception 'not_allowed_to_change_blocked';
    end if;
    if new.account_manager_id is distinct from old.account_manager_id then
      raise exception 'not_allowed_to_change_account_manager';
    end if;
  end if;
  return new;
end;
$$;
