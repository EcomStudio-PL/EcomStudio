-- PREMIERA / WAITLIST — a second, switchable front door plus the list it fills.
--
-- Three things live here:
--   1. two app_settings keys: which homepage is live, and the launch page's
--      editable copy (marketing text, world-readable like the rest of that
--      table — nothing secret ever goes in it);
--   2. waitlist_subscribers, which anonymous visitors can WRITE THROUGH ONE
--      FUNCTION and never read;
--   3. email_settings, admin-only, holding the sender identity, the optional
--      confirmation template and an SMTP password stored the way every other
--      secret in this app is: AES-256-GCM ciphertext whose key lives only in
--      the server env (APP_ENCRYPTION_KEY).

-- ── 1. Settings ──────────────────────────────────────────────────────────
-- mode: 'full' renders the existing landing page, 'waitlist' the launch page.
insert into public.app_settings (key, value)
values ('homepage', jsonb_build_object('mode', 'full'))
on conflict (key) do nothing;

-- The launch page's copy is stored as OVERRIDES only: {published:{pl:{...}},
-- draft:{...}}, each an object of flat field keys ("hero.h1") to strings, per
-- locale. Anything absent falls back to the shipped dictionary text, so the
-- page is complete in pl/en/de from the first deploy and an admin edit is a
-- diff rather than a copy of everything.
insert into public.app_settings (key, value)
values ('launch_page', jsonb_build_object('published', '{}'::jsonb, 'draft', '{}'::jsonb))
on conflict (key) do nothing;

-- ── 2. Subscribers ───────────────────────────────────────────────────────
create table if not exists public.waitlist_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'unsubscribed')),
  source text not null default 'landing',
  locale text not null default 'pl',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz
);

-- One row per address, case-insensitively: "Jan@Firma.pl" and "jan@firma.pl"
-- are the same person, and the signup path must be able to say so rather than
-- raise a constraint error at them.
create unique index if not exists waitlist_subscribers_email_key
  on public.waitlist_subscribers (lower(email));
create index if not exists waitlist_subscribers_created_idx
  on public.waitlist_subscribers (created_at desc);
create index if not exists waitlist_subscribers_status_idx
  on public.waitlist_subscribers (status);

alter table public.waitlist_subscribers enable row level security;

-- ADMINS ONLY. There is deliberately no policy for anon or authenticated:
-- the list of who is waiting for the launch is a marketing asset and a pile
-- of personal data, and the only write anyone else can do goes through the
-- definer function below, which returns a status word and never a row.
drop policy if exists "waitlist_admin_all" on public.waitlist_subscribers;
create policy "waitlist_admin_all" on public.waitlist_subscribers for all
  using (public.is_admin()) with check (public.is_admin());

-- ── 3. Email settings ────────────────────────────────────────────────────
-- Single row (id is a constant true), so it is read without a lookup key and
-- can never fork into two competing configurations.
create table if not exists public.email_settings (
  id boolean primary key default true check (id),
  from_name text not null default 'GrovBase',
  from_email text not null default '',
  reply_to text not null default '',
  smtp_host text not null default '',
  smtp_port integer not null default 587,
  smtp_user text not null default '',
  -- AES-256-GCM, exactly like ai_provider_credentials. Never plaintext.
  smtp_secret_ciphertext text,
  smtp_secret_iv text,
  smtp_secret_auth_tag text,
  smtp_encryption text not null default 'auto'
    check (smtp_encryption in ('auto', 'tls', 'ssl')),
  confirmation_enabled boolean not null default false,
  confirmation_subject text not null default 'Jesteś na liście GrovBase 🚀',
  confirmation_body text not null default
    'Dzięki za zapis. Damy Ci znać jako jednemu z pierwszych, gdy GrovBase wystartuje.',
  last_tested_at timestamptz,
  last_test_status text,
  last_test_error_safe text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
insert into public.email_settings (id) values (true) on conflict (id) do nothing;

alter table public.email_settings enable row level security;
drop policy if exists "email_settings_admin_all" on public.email_settings;
create policy "email_settings_admin_all" on public.email_settings for all
  using (public.is_admin()) with check (public.is_admin());

-- ── 4. The one public write path ─────────────────────────────────────────
-- Anonymous visitors get exactly this: subscribe an address, learn whether it
-- was new, and — only when a row was actually created AND the admin turned
-- confirmation on — receive the instructions the server needs to send that
-- one email. The SMTP password comes back as ciphertext, useless without
-- APP_ENCRYPTION_KEY, and a repeat address returns 'exists' with no config at
-- all, so the endpoint cannot be used as a configuration oracle.
create or replace function public.waitlist_subscribe(
  p_email text,
  p_source text default 'landing',
  p_locale text default 'pl',
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_source text := left(coalesce(nullif(btrim(p_source), ''), 'landing'), 40);
  v_locale text := left(coalesce(nullif(btrim(p_locale), ''), 'pl'), 8);
  v_rows int := 0;
  v_cfg record;
begin
  -- Shape check in the database too: this function is the security boundary,
  -- not the route that calls it.
  if v_email !~ '^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$' or length(v_email) > 254 then
    return jsonb_build_object('status', 'invalid');
  end if;

  insert into public.waitlist_subscribers (email, source, locale, metadata)
  values (v_email, v_source, v_locale, coalesce(p_metadata, '{}'::jsonb))
  on conflict (lower(email)) do nothing;
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    return jsonb_build_object('status', 'exists');
  end if;

  select * into v_cfg from public.email_settings where id limit 1;
  if not found or not v_cfg.confirmation_enabled then
    return jsonb_build_object('status', 'created');
  end if;

  return jsonb_build_object(
    'status', 'created',
    'mail', jsonb_build_object(
      'from_name', v_cfg.from_name,
      'from_email', v_cfg.from_email,
      'reply_to', v_cfg.reply_to,
      'subject', v_cfg.confirmation_subject,
      'body', v_cfg.confirmation_body,
      'smtp', jsonb_build_object(
        'host', v_cfg.smtp_host,
        'port', v_cfg.smtp_port,
        'user', v_cfg.smtp_user,
        'encryption', v_cfg.smtp_encryption,
        'ciphertext', v_cfg.smtp_secret_ciphertext,
        'iv', v_cfg.smtp_secret_iv,
        'auth_tag', v_cfg.smtp_secret_auth_tag
      )
    )
  );
end;
$$;

revoke execute on function public.waitlist_subscribe(text, text, text, jsonb) from public;
grant execute on function public.waitlist_subscribe(text, text, text, jsonb) to anon, authenticated;

-- The admin's own "test connection" and any authenticated server-side send
-- read the transport through here rather than through the table, so the row
-- itself stays admin-only and the plaintext password never exists at rest.
create or replace function public.email_transport()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cfg record;
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;
  select * into v_cfg from public.email_settings where id limit 1;
  if not found then return jsonb_build_object('configured', false); end if;
  return jsonb_build_object(
    'configured', coalesce(nullif(v_cfg.smtp_host, ''), null) is not null,
    'from_name', v_cfg.from_name,
    'from_email', v_cfg.from_email,
    'reply_to', v_cfg.reply_to,
    'host', v_cfg.smtp_host,
    'port', v_cfg.smtp_port,
    'user', v_cfg.smtp_user,
    'encryption', v_cfg.smtp_encryption,
    'ciphertext', v_cfg.smtp_secret_ciphertext,
    'iv', v_cfg.smtp_secret_iv,
    'auth_tag', v_cfg.smtp_secret_auth_tag
  );
end;
$$;
revoke execute on function public.email_transport() from public, anon;
grant execute on function public.email_transport() to authenticated;

-- Keep updated_at honest on both new tables.
drop trigger if exists waitlist_touch on public.waitlist_subscribers;
create trigger waitlist_touch before update on public.waitlist_subscribers
  for each row execute function public.touch_updated_at();
drop trigger if exists email_settings_touch on public.email_settings;
create trigger email_settings_touch before update on public.email_settings
  for each row execute function public.touch_updated_at();
