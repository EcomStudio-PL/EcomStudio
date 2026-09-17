-- "NAPISZ DO NAS" — the one other thing an anonymous visitor may write.
--
-- The contact page needs somewhere to put a message. Two things it must NOT
-- be: a table anon can read (that would publish everyone's enquiries) and a
-- second mail system (GrovBase already has one, and §47 of the brief is
-- explicit about not duplicating it).
--
-- So this follows waitlist_subscribe exactly, because that pattern is already
-- deployed, reviewed and understood:
--
--   · the table has RLS with NO anon policy at all — anon cannot select,
--     update or delete, and cannot insert directly either;
--   · one SECURITY DEFINER function is granted to anon. It validates, stores,
--     and answers with a single word. It is the security boundary; the route
--     in front of it is only a rate limiter and a validator;
--   · the notification goes out through notification_outbox like every other
--     GrovBase event, so Telegram and the admin e-mail both work the day this
--     ships without a line of new delivery code.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. THE TABLE
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  -- 'sales' | 'support' | 'partnership' | 'press' | 'other' — a closed list,
  -- because the value ends up in a subject line an operator triages by.
  topic text not null default 'other',
  name text not null,
  email text not null,
  message text not null,
  locale text not null default 'pl',
  -- Which page the message came from, so an operator knows the context.
  source text,
  -- User agent and referrer only. NOT an IP: a contact form does not need
  -- to build a profile of the person writing to us.
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'new',
  created_at timestamptz not null default now(),
  handled_at timestamptz,
  handled_by uuid references public.profiles(id) on delete set null,
  constraint contact_messages_topic_check
    check (topic in ('sales', 'support', 'partnership', 'press', 'other')),
  constraint contact_messages_status_check
    check (status in ('new', 'handled', 'spam'))
);

create index if not exists contact_messages_new_idx
  on public.contact_messages (created_at desc) where status = 'new';

alter table public.contact_messages enable row level security;

-- No anon policy. An anonymous visitor writes through the function below and
-- can never read the table, count it, or probe it.
drop policy if exists "contact_messages_admin" on public.contact_messages;
create policy "contact_messages_admin" on public.contact_messages for all
  to authenticated using (public.is_admin()) with check (public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────
-- 2. THE ONE WAY IN
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.submit_contact_message(
  p_topic text,
  p_name text,
  p_email text,
  p_message text,
  p_locale text default 'pl',
  p_source text default null,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_name text := trim(coalesce(p_name, ''));
  v_message text := trim(coalesce(p_message, ''));
  v_topic text := coalesce(nullif(trim(coalesce(p_topic, '')), ''), 'other');
  v_recent integer;
  v_id uuid;
begin
  -- Shape checks live here as well as in the route, because the route is not
  -- the boundary — this function is, and it is callable directly.
  if v_email !~ '^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$' then
    return jsonb_build_object('status', 'invalid');
  end if;
  if length(v_message) < 5 or length(v_message) > 4000 then
    return jsonb_build_object('status', 'invalid');
  end if;
  if length(v_name) = 0 or length(v_name) > 120 then
    return jsonb_build_object('status', 'invalid');
  end if;
  if v_topic not in ('sales', 'support', 'partnership', 'press', 'other') then
    v_topic := 'other';
  end if;

  -- A per-address brake that survives a restart, unlike the in-memory limiter
  -- in front of it. Five messages an hour from one address is far past anyone
  -- with something to say and well short of useful for a script.
  select count(*) into v_recent from public.contact_messages
    where email = v_email and created_at > now() - interval '1 hour';
  if v_recent >= 5 then
    return jsonb_build_object('status', 'rate_limited');
  end if;

  insert into public.contact_messages (topic, name, email, message, locale, source, metadata)
  values (
    v_topic, left(v_name, 120), left(v_email, 254), left(v_message, 4000),
    coalesce(nullif(p_locale, ''), 'pl'), left(coalesce(p_source, ''), 80),
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return jsonb_build_object('status', 'created', 'id', v_id);
end $$;

-- Supabase re-grants EXECUTE to public by name on create, so the revoke has
-- to name `public` AND the roles explicitly (see 0083 for the same trap).
revoke all on function public.submit_contact_message(text, text, text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.submit_contact_message(text, text, text, text, text, text, jsonb)
  to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. THE NOTIFICATION
-- ─────────────────────────────────────────────────────────────────────────
-- A new event type in the existing catalogue, in the group an operator would
-- look for it under. Both channels start ON, because a contact message nobody
-- is told about is a lost customer — and both are switchable in Komunikacja
-- exactly like every other event.
insert into public.notification_preferences
  (event_type, category, sort_order, telegram_enabled, admin_email_enabled)
values ('contact.message', 'users', 35, true, true)
on conflict (event_type) do nothing;
