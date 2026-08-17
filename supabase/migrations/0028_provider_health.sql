-- PROVIDER HEALTH — the router's short-term memory.
--
-- One 429 must not brand a provider broken forever, and a dead quota must
-- not be retried on every click. Each provider carries a lightweight state
-- with a cooldown timestamp; the generation router skips providers inside
-- their cooldown when an alternative exists, and an admin's successful test
-- clears the state.
--
-- Writes go through a SECURITY DEFINER function because health changes are
-- discovered during customer-initiated generations, and members have no
-- direct write access to infrastructure tables. The function only accepts
-- known states and caps the cooldown, so the worst a hostile client could do
-- is shuffle the fallback order for half an hour.

create table if not exists public.provider_health (
  provider_slug text primary key,
  state text not null default 'healthy'
    check (state in ('healthy','rate_limited','quota_exhausted','auth_error','degraded','down')),
  cooldown_until timestamptz,
  note text,
  updated_at timestamptz not null default now()
);

alter table public.provider_health enable row level security;

-- Reading the state is harmless (it contains no secrets) and the client UI
-- may some day want to show "provider busy" hints.
drop policy if exists provider_health_select on public.provider_health;
create policy provider_health_select on public.provider_health
  for select using (auth.role() = 'authenticated');

create or replace function public.set_provider_health(
  p_slug text, p_state text, p_cooldown_seconds integer default 0, p_note text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
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

revoke all on function public.set_provider_health(text, text, integer, text) from public;
grant execute on function public.set_provider_health(text, text, integer, text) to authenticated;
