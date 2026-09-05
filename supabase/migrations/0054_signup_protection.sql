-- SIGNUP PROTECTION — per-IP registration cap + Turnstile captcha config.
--
-- Two guards against mass registration through our own form, both wired the
-- same way as the 0052 notification doors: unprivileged callers (a signup runs
-- as `anon`) reach SECURITY DEFINER functions gated by the dispatch token the
-- server already derives from its encryption key, and learn nothing from a
-- wrong token.
--
--   signup_ip_allowed()  asks "may this IP register another account?"
--   signup_ip_record()   remembers that a registration happened.
--   captcha_site_key()   hands the browser the PUBLIC half of the captcha
--                        config — deliberately not token-gated, see below.
--
-- The captcha itself is a third integration_settings row ('captcha'): the
-- site key sits in `config` (public by nature — it is rendered into the
-- registration page), the secret key in `secrets` as the usual AES-256-GCM
-- {c, i, t} envelope that only the server can open.

-- ── 1. Widen integration_settings to a third integration ─────────────────
-- The original check named only mail and telegram. Constraint name verified
-- against production (pg_constraint): integration_settings_type_check.
alter table public.integration_settings
  drop constraint if exists integration_settings_type_check;
alter table public.integration_settings
  add constraint integration_settings_type_check
  check (type in ('mail', 'telegram', 'captcha'));

-- Seeded like mail/telegram in 0052, so the admin panel always has the row to
-- edit. Nothing here is secret; the secret key arrives later via the panel.
insert into public.integration_settings (type, config)
values ('captcha', jsonb_build_object('provider', 'turnstile', 'site_key', ''))
on conflict (type) do nothing;

-- ── 2. signup_events — one row per completed registration ────────────────
-- The counter behind the per-IP cap. Only the hash of the IP is stored;
-- email/user_id exist so an admin can audit a burst after the fact.
create table if not exists public.signup_events (
  id uuid primary key default gen_random_uuid(),
  ip_hash text not null,
  email text,
  user_id uuid,
  created_at timestamptz not null default now()
);

-- The only query the guard runs: count by ip_hash.
create index if not exists signup_events_ip_hash_idx
  on public.signup_events (ip_hash);

-- Admin-only under RLS, and only ever `to authenticated` — a policy on the
-- `public` role calling is_admin() would raise for signed-out visitors
-- instead of returning nothing (the 0051 lesson). anon never touches the
-- table directly; it goes through the definer functions below.
alter table public.signup_events enable row level security;

drop policy if exists "signup_events_admin_all" on public.signup_events;
create policy "signup_events_admin_all" on public.signup_events for all
  to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ── 3. The limit setting ─────────────────────────────────────────────────
-- Lives under app_settings.security next to registration_enabled, so the
-- generic SettingsEditor on /admin/system can already edit it. The insert
-- covers a database where the row does not exist at all; the update adds the
-- key to an existing row WITHOUT clobbering its other keys — `new || existing`
-- keeps every existing key (right side wins on conflict) and the `not ?`
-- guard means we never overwrite an admin's chosen value either.
insert into public.app_settings (key, value)
values ('security', jsonb_build_object('max_accounts_per_ip', 3))
on conflict (key) do nothing;

update public.app_settings
   set value = jsonb_build_object('max_accounts_per_ip', 3) || value
 where key = 'security'
   and not value ? 'max_accounts_per_ip';

-- ── 4. The guard ─────────────────────────────────────────────────────────
-- FAIL-OPEN BY DESIGN. This guard exists to stop mass registration through
-- OUR form — it is a speed bump for abusers, not an authentication boundary.
-- If the dispatch hash is unarmed, the token is wrong, or the limit setting
-- is missing/zero/negative/garbled, it returns TRUE: a broken guard must
-- never lock real customers out of registration, and a caller holding only
-- the anon key with a wrong token learns nothing from "true" (it is the same
-- answer a fresh IP gets). Only when the token verifies AND
-- max_accounts_per_ip > 0 AND this IP has already registered that many
-- accounts does it say no.
create or replace function public.signup_ip_allowed(
  p_token text,
  p_ip_hash text
) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_hash text;
  v_limit integer;
begin
  select value->>'dispatch_hash' into v_hash
    from public.app_settings where key = 'notifications';

  if v_hash is null or v_hash = '' then
    return true;
  end if;
  if encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') is distinct from v_hash then
    return true;
  end if;

  -- The regex guard means a hand-edited non-numeric value fails open instead
  -- of throwing (the settings editor is a free-form JSON field).
  select case
           when value->>'max_accounts_per_ip' ~ '^[0-9]+$'
             then (value->>'max_accounts_per_ip')::integer
           else null
         end
    into v_limit
    from public.app_settings where key = 'security';

  if v_limit is null or v_limit <= 0 then
    return true;
  end if;

  return (select count(*) from public.signup_events where ip_hash = p_ip_hash)
         < v_limit;
end;
$$;

revoke execute on function public.signup_ip_allowed(text, text) from public;
grant execute on function public.signup_ip_allowed(text, text) to anon, authenticated;

-- ── 5. The recorder ──────────────────────────────────────────────────────
-- Write-only, and a silent no-op on a bad or missing token — so the anon key
-- alone cannot flood the table, and a guesser gets the same void either way.
create or replace function public.signup_ip_record(
  p_token text,
  p_ip_hash text,
  p_email text default null,
  p_user_id uuid default null
) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_hash text;
  v_ip text := left(nullif(btrim(coalesce(p_ip_hash, '')), ''), 200);
  v_email text := left(nullif(btrim(coalesce(p_email, '')), ''), 200);
begin
  select value->>'dispatch_hash' into v_hash
    from public.app_settings where key = 'notifications';

  if v_hash is null or v_hash = '' then
    return;
  end if;
  if encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') is distinct from v_hash then
    return;
  end if;
  if v_ip is null then
    return;
  end if;

  insert into public.signup_events (ip_hash, email, user_id)
  values (v_ip, v_email, p_user_id);
end;
$$;

revoke execute on function public.signup_ip_record(text, text, text, uuid) from public;
grant execute on function public.signup_ip_record(text, text, text, uuid) to anon, authenticated;

-- ── 6. The site key ──────────────────────────────────────────────────────
-- NOT token-gated: the site key is public by nature — Turnstile renders it
-- into the registration page for every visitor, so gating it would protect
-- nothing. What IS guarded is coherence: the key is returned only when the
-- captcha is fully configured — site key non-empty AND the secret-key
-- envelope present ({c, i, t} object in secrets). A half-configured captcha
-- (site key typed, secret not yet saved) must not brick registration by
-- making the form demand a captcha token the server cannot verify.
-- Empty string means "no captcha", same as "not configured at all".
create or replace function public.captcha_site_key()
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_site text;
begin
  select nullif(btrim(coalesce(config->>'site_key', '')), '')
    into v_site
    from public.integration_settings
   where type = 'captcha'
     and jsonb_typeof(secrets->'secret_key') = 'object';

  return coalesce(v_site, '');
end;
$$;

revoke execute on function public.captcha_site_key() from public;
grant execute on function public.captcha_site_key() to anon, authenticated;
