-- ============================================================================
-- 0058 — MESSAGE TEMPLATES: the editable copy behind every app notification.
--
-- One row per (event_type, channel). `draft` is what the admin is editing;
-- `published` is the ONLY thing production ever renders — publishing copies
-- draft → published and bumps the version, so an open editor can never change
-- a production e-mail mid-sentence. A missing row (or a missing published
-- value) means "use the built-in default", which is exactly the message the
-- app shipped with.
--
-- RLS: admins read and write; nobody else sees the table at all. The
-- dispatcher often runs WITHOUT an admin session (cron, a signing-up
-- customer), so the published value — and only the published value — is
-- reachable through a SECURITY DEFINER lookup gated by the same dispatch
-- token the notification queue already uses (0052): sha256(token) must match
-- app_settings->'notifications'->>'dispatch_hash'.
-- ============================================================================

create table if not exists public.message_templates (
  key text primary key,                        -- "user.registered:telegram"
  event_type text not null,
  channel text not null check (channel in ('email', 'telegram')),
  draft jsonb,
  published jsonb,
  published_version integer not null default 0,
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  unique (event_type, channel)
);

alter table public.message_templates enable row level security;

drop policy if exists message_templates_admin on public.message_templates;
create policy message_templates_admin on public.message_templates
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- The dispatcher's read: published only, token-gated, null on any miss.
create or replace function public.message_template_lookup(
  p_token text, p_event text, p_channel text
)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_hash text;
  v_published jsonb;
begin
  select value->>'dispatch_hash' into v_hash
    from public.app_settings where key = 'notifications';
  if v_hash is null or v_hash = '' then return null; end if;
  if encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') is distinct from v_hash then
    return null;
  end if;

  select published into v_published
    from public.message_templates
   where event_type = p_event and channel = p_channel and published is not null;
  return v_published;
end;
$$;

revoke execute on function public.message_template_lookup(text, text, text) from public;
grant execute on function public.message_template_lookup(text, text, text) to anon, authenticated;
