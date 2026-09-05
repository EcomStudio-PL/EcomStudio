-- COMMUNICATIONS — mailbox + Telegram notifications, without a service-role key.
--
-- Two integrations (an IMAP/SMTP mailbox and a Telegram bot) plus the outbox
-- that carries events to them. The whole design turns on one problem:
--
--   The events worth announcing are fired from UNPRIVILEGED paths. A waitlist
--   signup runs as `anon`. A registration runs as a brand-new `authenticated`
--   user. A generation failure runs as an ordinary customer. Every one of them
--   must be able to say "this happened" — and NONE of them may read the bot
--   token, the mailbox password, or even learn whether the feature is on.
--
-- So the tables are admin-only under RLS and the unprivileged paths get exactly
-- three SECURITY DEFINER doors, each of which returns nothing an attacker can
-- learn from:
--
--   enqueue_notification()        write-only. Returns void in every case.
--   notification_dispatch_claim() reads config + ciphertext, but only for a
--                                 caller that already knows the dispatch token.
--   notification_dispatch_finish() writes the outcome back.
--
-- The dispatch token is never stored here. The server DERIVES it from the
-- encryption key it already holds (sha256("grovbase-notify-dispatch:" + key))
-- and the database keeps only sha256(token). So the deployment needs no new
-- environment variable, and a leaked anon key still claims nothing.
--
-- mail_sync_context() / mail_sync_commit() are the same door for the mailbox
-- poller: it reads the IMAP config and the password CIPHERTEXT (useless without
-- the key) and writes back where it got to.

-- ── 0. digest() ──────────────────────────────────────────────────────────
-- Supabase ships pgcrypto in the `extensions` schema; 0042 installs `vector`
-- there the same way. Created here so a database built from these migrations
-- alone also has it. The definer functions below set
-- `search_path = public, extensions`, so digest() resolves whether pgcrypto
-- sits in `extensions` (Supabase) or in `public` (some local stacks).
create extension if not exists pgcrypto with schema extensions;

-- ── 1. integration_settings ──────────────────────────────────────────────
-- One row per integration, seeded below so the admin panel always has both to
-- edit. `config` is the non-secret half and is safe to hand to the browser;
-- `secrets` holds ONLY AES-256-GCM envelopes ({c: ciphertext, i: iv, t: auth
-- tag}, all base64) and never leaves the server. Nothing in this table is
-- readable without is_admin(), and the server strips `secrets` down to a
-- boolean before it reaches any UI.
create table if not exists public.integration_settings (
  type text primary key check (type in ('mail', 'telegram')),
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  secrets jsonb not null default '{}'::jsonb,
  status text not null default 'not_configured'
    check (status in ('not_configured', 'connected', 'error')),
  last_tested_at timestamptz,
  -- Already scrubbed by the server (safeError): a stored error must never be
  -- able to leak the credential that produced it.
  last_error_safe text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

-- ── 2. notification_preferences ──────────────────────────────────────────
-- The admin's on/off switch per event. enqueue_notification() consults this
-- and nothing else, so turning an event off silences it at the database
-- boundary rather than somewhere downstream that could be bypassed.
create table if not exists public.notification_preferences (
  event_type text primary key,
  telegram_enabled boolean not null default false,
  category text not null,
  sort_order integer not null default 100,
  updated_at timestamptz not null default now()
);

-- ── 3. mail_sync_state ───────────────────────────────────────────────────
-- Where the mailbox poller got to, per folder. `uid_validity` is the important
-- one: when a server renumbers a mailbox it bumps UIDVALIDITY, and a poller
-- that ignored it would replay the entire mailbox as "new mail". The poller
-- re-baselines instead (see mail_sync_commit).
create table if not exists public.mail_sync_state (
  id uuid primary key default gen_random_uuid(),
  folder text not null unique,
  last_uid bigint not null default 0,
  uid_validity bigint,
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_error_safe text,
  updated_at timestamptz not null default now()
);

-- ── 4. notification_outbox ───────────────────────────────────────────────
-- Events wait here between "something happened" and "Telegram accepted it".
-- The queue exists so a failing bot cannot break a signup: enqueueing is a
-- local insert, delivery is somebody else's problem a moment later.
create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  last_error_safe text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

-- The status vocabulary has no 'claimed' value, so a claim is marked with a
-- timestamp instead. Without it two overlapping drains — trivially possible
-- when a request-time drain meets the cron — would both pick up the same
-- pending row and send the message twice.
alter table public.notification_outbox
  add column if not exists claimed_at timestamptz;

-- THE duplicate guard. One row per dedupe_key, and partial so the many events
-- that have no natural key (they pass null) never collide with each other.
create unique index if not exists notification_outbox_dedupe_key
  on public.notification_outbox (dedupe_key) where dedupe_key is not null;

-- The drain's only query: oldest pending first.
create index if not exists notification_outbox_pending_idx
  on public.notification_outbox (created_at) where status = 'pending';

create index if not exists notification_outbox_created_idx
  on public.notification_outbox (created_at desc);

-- ── 5. RLS — admin only, and only ever `to authenticated` ────────────────
-- Every policy below mentions is_admin(), and `anon` has no EXECUTE on it, so
-- a policy left on the `public` role would raise "permission denied for
-- function is_admin" for signed-out visitors instead of simply returning
-- nothing (the bug 0051 had to fix for the CMS). anon never touches these
-- tables directly — it goes through the definer functions — so scoping the
-- policies to `authenticated` costs nothing and removes the trap.
alter table public.integration_settings enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.mail_sync_state enable row level security;
alter table public.notification_outbox enable row level security;

drop policy if exists "integration_settings_admin_all" on public.integration_settings;
create policy "integration_settings_admin_all" on public.integration_settings for all
  to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "notification_preferences_admin_all" on public.notification_preferences;
create policy "notification_preferences_admin_all" on public.notification_preferences for all
  to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "mail_sync_state_admin_all" on public.mail_sync_state;
create policy "mail_sync_state_admin_all" on public.mail_sync_state for all
  to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "notification_outbox_admin_all" on public.notification_outbox;
create policy "notification_outbox_admin_all" on public.notification_outbox for all
  to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ── 6. Seeds ─────────────────────────────────────────────────────────────
-- Prefilled with the mailbox the product already owns, so the admin's first
-- visit is "type the password and press test" rather than "fill in nine
-- fields". Every value stays editable from the panel; nothing here is secret.
insert into public.integration_settings (type, config)
values (
  'mail',
  jsonb_build_object(
    'account_name', 'GrovBase',
    'email', 'contact@grovbase.com',
    'from_name', 'GrovBase',
    'imap_host', 'host483417.hostido.net.pl',
    'imap_port', 993,
    'imap_secure', true,
    'imap_user', 'contact@grovbase.com',
    'smtp_host', 'host483417.hostido.net.pl',
    'smtp_port', 587,
    'smtp_encryption', 'starttls',
    'smtp_user', 'contact@grovbase.com',
    'smtp_same_as_imap', true,
    'mirror_to_email_settings', false,
    'sent_folder', ''
  )
)
on conflict (type) do nothing;

insert into public.integration_settings (type, config)
values (
  'telegram',
  jsonb_build_object(
    'chat_id', '',
    'channel_name', 'GrovBase — Powiadomienia'
  )
)
on conflict (type) do nothing;

-- All ten events, every one OFF. An admin opts in; nothing starts talking to
-- Telegram because a migration ran. The six sales events have no module behind
-- them yet (payments/subscriptions exist as tables and nothing writes to them),
-- so they are listed here to be switchable, not because they fire today.
insert into public.notification_preferences (event_type, category, sort_order)
values
  ('mail.received',         'mail',   10),
  ('user.registered',       'users',  20),
  ('waitlist.signup',       'users',  30),
  ('payment.received',      'sales',  40),
  ('credits.purchased',     'sales',  50),
  ('subscription.created',  'sales',  60),
  ('subscription.renewed',  'sales',  70),
  ('payment.failed',        'sales',  80),
  ('subscription.cancelled', 'sales', 90),
  ('system.error',          'system', 100)
on conflict (event_type) do nothing;

-- The dispatch hash lives in app_settings, which is world-readable by design.
-- That is safe and deliberate: what is stored is sha256 of a token derived from
-- a 32-byte key, so reading it grants nothing — but it means NOTHING ELSE may
-- ever be put under this key. The server fills it in on first admin load
-- (ensureDispatchHash); an empty string means "dispatch not armed" and every
-- function below refuses.
insert into public.app_settings (key, value)
values ('notifications', jsonb_build_object('dispatch_hash', ''))
on conflict (key) do nothing;

-- ── 7. The write-only door ───────────────────────────────────────────────
-- Callable by anon. It reveals NOTHING: void on success, void when the event is
-- switched off, void when the payload is junk, void when the queue is full. A
-- caller cannot use it to discover which events an admin has enabled, and the
-- dedupe index means calling it twice with the same key still sends once.
--
-- It carries the dispatch token as well. The DATABASE role here is anon — a
-- waitlist signup has no session — but the PROCESS is always our own server,
-- and our server holds the encryption key the token is derived from. So
-- requiring the token costs the real callers nothing and takes the queue away
-- from anyone who merely has the publishable anon key: without it they could
-- push up to the 500-row ceiling of fabricated events and have Telegram
-- deliver every one of them.
create or replace function public.enqueue_notification(
  p_event text,
  p_payload jsonb default '{}'::jsonb,
  p_dedupe text default null,
  p_token text default null
) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_dedupe text := left(nullif(btrim(coalesce(p_dedupe, '')), ''), 200);
  v_hash text;
begin
  select value->>'dispatch_hash' into v_hash
    from public.app_settings where key = 'notifications';

  if v_hash is null or v_hash = '' then
    return;
  end if;
  if encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') is distinct from v_hash then
    return;
  end if;

  -- Switched off (or unknown) events are dropped silently. No exception: an
  -- error is an oracle, and this function is reachable by anyone.
  if not exists (
    select 1 from public.notification_preferences
     where event_type = p_event and telegram_enabled
  ) then
    return;
  end if;

  -- An anon-callable queue needs a ceiling. Refusing to grow past a backlog of
  -- 500 pending rows keeps a flood from filling the table; a healthy queue
  -- never has more than a handful of rows in it.
  if (select count(*) from public.notification_outbox where status = 'pending') >= 500 then
    return;
  end if;

  -- Same reasoning for the payload: the formatter truncates everything it
  -- prints anyway, so nothing legitimate needs more than a few KB.
  if length(v_payload::text) > 8000 then
    v_payload := '{}'::jsonb;
  end if;

  -- The index predicate has to be repeated for Postgres to infer the partial
  -- unique index as the conflict arbiter.
  insert into public.notification_outbox (event_type, payload, dedupe_key)
  values (p_event, v_payload, v_dedupe)
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
end;
$$;

-- The three-argument shape from an earlier draft of this file had no token
-- gate. Dropped rather than left callable, so nothing can reach the ungated
-- overload on a database where that version was already applied.
drop function if exists public.enqueue_notification(text, jsonb, text);

revoke execute on function public.enqueue_notification(text, jsonb, text, text) from public;
grant execute on function public.enqueue_notification(text, jsonb, text, text) to anon, authenticated;

-- ── 8. The dispatcher's door ─────────────────────────────────────────────
-- Claims pending work AND hands back the Telegram config plus the bot-token
-- ciphertext, because the caller (a Next.js route with no service-role key)
-- cannot read integration_settings itself. The token check is what makes that
-- safe, and a mismatch returns ZERO ROWS rather than raising — an exception
-- would confirm to a guesser that they had reached a real check.
--
-- bot_token_ciphertext is the {c, i, t} envelope, not a token: worthless
-- without APP_ENCRYPTION_KEY, which only the server process holds.
create or replace function public.notification_dispatch_claim(
  p_token text,
  p_limit integer default 10
) returns table (
  id uuid,
  event_type text,
  payload jsonb,
  dedupe_key text,
  attempts integer,
  created_at timestamptz,
  telegram_enabled boolean,
  telegram_config jsonb,
  bot_token_ciphertext jsonb
)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_hash text;
  v_limit integer := greatest(1, least(coalesce(p_limit, 10), 50));
begin
  select value->>'dispatch_hash' into v_hash
    from public.app_settings where key = 'notifications';

  if v_hash is null or v_hash = '' then
    return;
  end if;
  if encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') is distinct from v_hash then
    return;
  end if;

  return query
  with claimed as (
    update public.notification_outbox o
       set attempts = o.attempts + 1,
           claimed_at = now()
     where o.id in (
       select c.id
         from public.notification_outbox c
        -- A claim older than five minutes belonged to a serverless invocation
        -- that died mid-drain. Re-claiming it is how nothing gets stranded.
        where c.status = 'pending'
          and (c.claimed_at is null or c.claimed_at < now() - interval '5 minutes')
          and c.attempts < 5
        order by c.created_at
        limit v_limit
        for update skip locked
     )
    returning o.id, o.event_type, o.payload, o.dedupe_key, o.attempts, o.created_at
  )
  select c.id,
         c.event_type,
         c.payload,
         c.dedupe_key,
         c.attempts,
         c.created_at,
         coalesce(t.enabled, false),
         coalesce(t.config, '{}'::jsonb),
         t.secrets->'bot_token'
    from claimed c
    left join public.integration_settings t on t.type = 'telegram'
   order by c.created_at;
end;
$$;

revoke execute on function public.notification_dispatch_claim(text, integer) from public;
grant execute on function public.notification_dispatch_claim(text, integer) to anon, authenticated;

-- Writes the outcome back. Same token gate, same silence on mismatch. Clearing
-- claimed_at matters even on failure: it is what lets a later drain look at the
-- row again instead of treating it as somebody else's in-flight work.
create or replace function public.notification_dispatch_finish(
  p_token text,
  p_id uuid,
  p_status text,
  p_error text default null
) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_hash text;
begin
  select value->>'dispatch_hash' into v_hash
    from public.app_settings where key = 'notifications';

  if v_hash is null or v_hash = '' then
    return;
  end if;
  if encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') is distinct from v_hash then
    return;
  end if;
  if p_status is null or p_status not in ('sent', 'failed', 'skipped') then
    return;
  end if;

  update public.notification_outbox
     set status = p_status,
         last_error_safe = left(nullif(btrim(coalesce(p_error, '')), ''), 200),
         sent_at = case when p_status = 'sent' then now() else sent_at end,
         claimed_at = null
   where notification_outbox.id = p_id;
end;
$$;

revoke execute on function public.notification_dispatch_finish(text, uuid, text, text) from public;
grant execute on function public.notification_dispatch_finish(text, uuid, text, text) to anon, authenticated;

-- ── 9. The mailbox poller's door ─────────────────────────────────────────
-- Same trick for IMAP: the cron route has no service-role key, so it asks here
-- for the mail config, the password CIPHERTEXT and the per-folder cursor. A
-- wrong (or missing) token gets SQL NULL — indistinguishable from "mail is not
-- configured", which is exactly the point.
create or replace function public.mail_sync_context(p_token text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_hash text;
  v_row record;
begin
  select value->>'dispatch_hash' into v_hash
    from public.app_settings where key = 'notifications';

  if v_hash is null or v_hash = '' then
    return null;
  end if;
  if encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') is distinct from v_hash then
    return null;
  end if;

  select * into v_row from public.integration_settings where type = 'mail';
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'enabled', v_row.enabled,
    'status', v_row.status,
    'config', v_row.config,
    -- Ciphertext envelopes only. This column never holds plaintext.
    'secrets', v_row.secrets,
    'folders', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'folder', s.folder,
                'last_uid', s.last_uid,
                'uid_validity', s.uid_validity,
                'last_checked_at', s.last_checked_at,
                'last_success_at', s.last_success_at
              ) order by s.folder)
         from public.mail_sync_state s),
      '[]'::jsonb
    )
  );
end;
$$;

revoke execute on function public.mail_sync_context(text) from public;
grant execute on function public.mail_sync_context(text) to anon, authenticated;

-- Writes the cursor back. Two cases matter:
--   * p_error given → record the failure, leave the cursor alone. A mailbox
--     that was briefly unreachable must not look like a mailbox with no mail.
--   * UIDVALIDITY changed → the old UIDs mean nothing now, so the cursor is
--     REPLACED (it may go down). Otherwise it only ever moves forward, so a
--     late-arriving batch cannot rewind it and replay old messages as new.
create or replace function public.mail_sync_commit(
  p_token text,
  p_folder text,
  p_last_uid bigint default null,
  p_uid_validity bigint default null,
  p_error text default null
) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_hash text;
  v_folder text := left(nullif(btrim(coalesce(p_folder, '')), ''), 200);
  v_error text := left(nullif(btrim(coalesce(p_error, '')), ''), 200);
  v_existing record;
  v_rebaseline boolean;
begin
  select value->>'dispatch_hash' into v_hash
    from public.app_settings where key = 'notifications';

  if v_hash is null or v_hash = '' then
    return;
  end if;
  if encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') is distinct from v_hash then
    return;
  end if;
  if v_folder is null then
    return;
  end if;

  insert into public.mail_sync_state (folder)
  values (v_folder)
  on conflict (folder) do nothing;

  select * into v_existing from public.mail_sync_state where folder = v_folder;
  if not found then
    return;
  end if;

  if v_error is not null then
    update public.mail_sync_state
       set last_checked_at = now(),
           last_error_safe = v_error
     where folder = v_folder;
    return;
  end if;

  v_rebaseline := p_uid_validity is not null
    and v_existing.uid_validity is not null
    and v_existing.uid_validity is distinct from p_uid_validity;

  update public.mail_sync_state
     set last_uid = case
           when p_last_uid is null then last_uid
           when v_rebaseline then p_last_uid
           else greatest(last_uid, p_last_uid)
         end,
         uid_validity = coalesce(p_uid_validity, uid_validity),
         last_checked_at = now(),
         last_success_at = now(),
         last_error_safe = null
   where folder = v_folder;
end;
$$;

revoke execute on function public.mail_sync_commit(text, text, bigint, bigint, text) from public;
grant execute on function public.mail_sync_commit(text, text, bigint, bigint, text) to anon, authenticated;

-- ── 10. updated_at maintenance ───────────────────────────────────────────
-- notification_outbox is deliberately absent: a queue row is written once and
-- finished once, and created_at / sent_at already tell that story.
drop trigger if exists integration_settings_touch on public.integration_settings;
create trigger integration_settings_touch before update on public.integration_settings
  for each row execute function public.touch_updated_at();

drop trigger if exists notification_preferences_touch on public.notification_preferences;
create trigger notification_preferences_touch before update on public.notification_preferences
  for each row execute function public.touch_updated_at();

drop trigger if exists mail_sync_state_touch on public.mail_sync_state;
create trigger mail_sync_state_touch before update on public.mail_sync_state
  for each row execute function public.touch_updated_at();
