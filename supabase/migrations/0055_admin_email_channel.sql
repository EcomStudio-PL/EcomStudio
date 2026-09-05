-- ADMIN E-MAIL CHANNEL — the outbox learns to deliver two ways.
--
-- 0052 built the notification queue around a single destination: one event in,
-- one Telegram message out. Telegram is excellent at "look at this now" and bad
-- at "keep this" — an operator who wants a record of every registration in the
-- inbox they already read has nowhere to put it. So a notification now names a
-- CHANNEL, and the same event can go to both.
--
-- Three things had to move for that to be true rather than merely declared:
--
--   1. The duplicate guard was a unique index on (dedupe_key) ALONE. The same
--      signup enqueued for telegram and for admin_email carries the SAME
--      dedupe key, so the second insert would collide with the first and one
--      of the two channels would silently never be delivered. The index is now
--      on (channel, dedupe_key): still one message per event per channel,
--      which is what the guard was always meant to say.
--
--   2. 0053 made the claim hand out NOTHING until Telegram was configured —
--      correct when Telegram was the only destination, and a silent eater of
--      e-mail notifications the moment it is not. The precondition is now
--      per-channel: a telegram row waits for a chat id and a bot token, an
--      admin_email row waits for an SMTP host, a user, a password envelope and
--      a recipient, and neither blocks the other.
--
--   3. The recipient address had to live somewhere. NOT app_settings: that
--      table is world-readable by policy, and 0052 reserves its "notifications"
--      key for the dispatch hash and nothing else. It goes in the MAIL
--      integration's `config` instead, next to the SMTP host it belongs with —
--      admin-only under RLS, and handed to the dispatcher through the same
--      token-gated door as everything else here.
--
-- The password itself never moves: the claim returns the {c, i, t} AES-256-GCM
-- envelope exactly as it returns the bot token, and only the server process
-- holds the key that opens it.
--
-- Also here, because the same forms are being made configurable: waitlist rows
-- gain the optional name/phone the landing form is about to collect, and
-- app_settings gains a "registration" row saying which fields each form shows.

-- ── 1. notification_preferences learns a second switch ───────────────────
-- One boolean per channel, so the admin panel keeps its shape: a row per event,
-- a column per destination. telegram_enabled is NOT touched anywhere in this
-- file — those switches are configured in production already.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'notification_preferences'
       and column_name = 'admin_email_enabled'
  ) then
    alter table public.notification_preferences
      add column admin_email_enabled boolean not null default false;

    -- The two events that are actually wired and actually worth an e-mail: a
    -- new customer and a new waitlist address. Everything else stays off, the
    -- way 0052 seeded Telegram — a migration must not start sending mail the
    -- operator never asked for.
    --
    -- Seeded INSIDE the "column did not exist" branch on purpose: it runs once,
    -- on the migration that creates the column, so re-applying this file can
    -- never switch an event back on that an admin has since switched off.
    update public.notification_preferences
       set admin_email_enabled = true
     where event_type in ('user.registered', 'waitlist.signup');
  end if;
end $$;

-- ── 2. notification_outbox learns which way it is going ──────────────────
-- Defaulting to 'telegram' is what makes this migration safe on a live queue:
-- every row already waiting keeps the destination it was enqueued for.
alter table public.notification_outbox
  add column if not exists channel text not null default 'telegram';

-- Dropped and re-added rather than guarded, the way 0054 widened the
-- integration_settings type check, so re-running the file converges.
alter table public.notification_outbox
  drop constraint if exists notification_outbox_channel_check;
alter table public.notification_outbox
  add constraint notification_outbox_channel_check
  check (channel in ('telegram', 'admin_email'));

-- THE duplicate guard, corrected. Keyed on dedupe_key alone (0052) it said
-- "one message per event", which was the same sentence as "one message per
-- event per channel" only while there was exactly one channel. With two, the
-- old index would let the telegram row win the insert race and drop the
-- admin_email row on the floor — no error, no queue entry, no mail, ever.
-- Still partial: the many events that pass a null key never collide.
drop index if exists public.notification_outbox_dedupe_key;

create unique index if not exists notification_outbox_channel_dedupe_key
  on public.notification_outbox (channel, dedupe_key) where dedupe_key is not null;

-- notification_outbox_pending_idx is deliberately left on (created_at) where
-- status = 'pending'. The claim still orders by created_at and still reads the
-- whole pending head; adding channel to the front of the key would buy a
-- cheaper channel filter (a handful of rows) at the cost of the free ordering
-- (a sort on every claim). The index the drain needs is the one it has.

-- ── 3. Where the mail goes ───────────────────────────────────────────────
-- `new || existing` adds the key without clobbering the nine the operator has
-- already configured (right side wins on conflict), and the `not ?` guard means
-- an address they have since changed is never overwritten — the same shape 0054
-- used for max_accounts_per_ip. Nothing secret goes in `config`; this is an
-- address, and the row is admin-only under RLS regardless.
update public.integration_settings
   set config = jsonb_build_object('admin_notify_to', 'contact@grovbase.com') || config
 where type = 'mail'
   and not config ? 'admin_notify_to';

-- ── 4. The write-only door, once per enabled channel ─────────────────────
-- Everything 0052 said about this function still holds: callable by anon,
-- gated on the dispatch token, and an ORACLE-FREE void in every case — void on
-- success, void when the event is switched off, void when both channels are
-- off, void when the payload is junk, void when the queue is full. A caller
-- cannot use it to discover which events or which channels an admin enabled.
--
-- The only change is arity: one row per enabled channel instead of one row, and
-- nothing at all when both switches are off. The two inserts are written out
-- rather than generated from a values list because the queue is the part of
-- this system that must be obvious on sight.
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
  v_telegram boolean;
  v_admin_email boolean;
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
  -- error is an oracle, and this function is reachable by anyone. An unknown
  -- event leaves both flags null, which coalesce reads as "off".
  select p.telegram_enabled, p.admin_email_enabled
    into v_telegram, v_admin_email
    from public.notification_preferences p
   where p.event_type = p_event;

  if not coalesce(v_telegram, false) and not coalesce(v_admin_email, false) then
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

  -- Both channels carry the SAME dedupe key on purpose — it identifies the
  -- event, not the delivery — and the unique index is what keeps that from
  -- meaning "one of you". The index predicate has to be repeated for Postgres
  -- to infer the partial unique index as the conflict arbiter.
  if coalesce(v_telegram, false) then
    insert into public.notification_outbox (event_type, payload, dedupe_key, channel)
    values (p_event, v_payload, v_dedupe, 'telegram')
    on conflict (channel, dedupe_key) where dedupe_key is not null do nothing;
  end if;

  if coalesce(v_admin_email, false) then
    insert into public.notification_outbox (event_type, payload, dedupe_key, channel)
    values (p_event, v_payload, v_dedupe, 'admin_email')
    on conflict (channel, dedupe_key) where dedupe_key is not null do nothing;
  end if;
end;
$$;

revoke execute on function public.enqueue_notification(text, jsonb, text, text) from public;
grant execute on function public.enqueue_notification(text, jsonb, text, text) to anon, authenticated;

-- ── 5. The dispatcher's door, for both destinations ──────────────────────
-- DROPPED first: RETURNS TABLE is part of the signature, so a plain CREATE OR
-- REPLACE cannot add columns to it. The token gate, the five-minute re-claim,
-- the attempts ceiling and every column 0052/0053 returned are reproduced
-- verbatim below; what is new is `channel` plus the three values the e-mail
-- dispatcher needs, and a precondition that now asks per channel.
--
-- smtp_password_ciphertext is the {c, i, t} envelope, not a password —
-- worthless without APP_ENCRYPTION_KEY, which only the server process holds.
-- The same is true of bot_token_ciphertext. Neither column ever holds plaintext.
drop function if exists public.notification_dispatch_claim(text, integer);

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
  channel text,
  telegram_enabled boolean,
  telegram_config jsonb,
  bot_token_ciphertext jsonb,
  mail_config jsonb,
  smtp_password_ciphertext jsonb,
  admin_email_to text
)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_hash text;
  v_limit integer := greatest(1, least(coalesce(p_limit, 10), 50));
  v_telegram_ok boolean;
  v_mail_ok boolean;
begin
  select value->>'dispatch_hash' into v_hash
    from public.app_settings where key = 'notifications';

  if v_hash is null or v_hash = '' then
    return;
  end if;
  if encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') is distinct from v_hash then
    return;
  end if;

  -- Claiming is destructive: it spends an attempt, and the dispatcher then
  -- closes an undeliverable row as 'skipped', which burns the dedupe key for
  -- good. But "token saved, chat id not picked yet" is a NORMAL state of the
  -- setup wizard, not corruption. So hand out nothing that cannot be delivered
  -- yet: those rows stay pending with attempts untouched, and the first drain
  -- after the admin finishes setup sends the backlog.
  --
  -- 0053 asked this question ONCE, about Telegram, and returned no rows at all
  -- when the answer was no. With a second channel that would eat every e-mail
  -- notification on a deployment that never set Telegram up, so the two
  -- destinations are now judged independently.
  select exists (
    select 1 from public.integration_settings
     where type = 'telegram'
       and btrim(coalesce(config->>'chat_id', '')) <> ''
       -- The secret is the {c, i, t} envelope. A missing key and a JSON null
       -- both mean "no token", and jsonb_typeof answers for both at once.
       and jsonb_typeof(secrets->'bot_token') = 'object'
  ) into v_telegram_ok;

  -- Everything deliver() needs and cannot invent: a server to talk to, a user
  -- to authenticate as, a password it can decrypt, and somebody to send to.
  select exists (
    select 1 from public.integration_settings
     where type = 'mail'
       and btrim(coalesce(config->>'smtp_host', '')) <> ''
       and btrim(coalesce(config->>'smtp_user', '')) <> ''
       and jsonb_typeof(secrets->'smtp_password') = 'object'
       and btrim(coalesce(config->>'admin_notify_to', '')) <> ''
  ) into v_mail_ok;

  if not v_telegram_ok and not v_mail_ok then
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
          and (
            (c.channel = 'telegram' and v_telegram_ok)
            or (c.channel = 'admin_email' and v_mail_ok)
          )
        order by c.created_at
        limit v_limit
        for update skip locked
     )
    returning o.id, o.event_type, o.payload, o.dedupe_key, o.attempts, o.created_at, o.channel
  )
  select c.id,
         c.event_type,
         c.payload,
         c.dedupe_key,
         c.attempts,
         c.created_at,
         c.channel,
         coalesce(t.enabled, false),
         coalesce(t.config, '{}'::jsonb),
         t.secrets->'bot_token',
         coalesce(m.config, '{}'::jsonb),
         m.secrets->'smtp_password',
         -- Trimmed and nulled here so the dispatcher's "is there a recipient"
         -- test is the same one the precondition above already made.
         nullif(btrim(coalesce(m.config->>'admin_notify_to', '')), '')
    from claimed c
    left join public.integration_settings t on t.type = 'telegram'
    left join public.integration_settings m on m.type = 'mail'
   order by c.created_at;
end;
$$;

revoke execute on function public.notification_dispatch_claim(text, integer) from public;
grant execute on function public.notification_dispatch_claim(text, integer) to anon, authenticated;

-- ── 6. The waitlist collects a name ──────────────────────────────────────
-- Nullable, because every field the landing form adds is optional by design and
-- every row already on the list predates them.
alter table public.waitlist_subscribers
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists phone text;

-- The signature is NOT extended. waitlist_subscribe(text, text, text, jsonb) is
-- called with four positional arguments today; a fifth defaulted parameter
-- would make that call ambiguous against the old overload the moment both
-- exist, and dropping the old one mid-deploy would break the live route. The
-- values arrive in p_metadata, which the function already receives and already
-- stores — so the form sends three more keys and nothing else changes shape.
--
-- Everything else here is 0048 verbatim: the same regex boundary, the same
-- created / exists / invalid answers, and the same confirmation-mail payload,
-- because app/api/waitlist/route.ts reads all of them.
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
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
  -- Capped to the same widths the registration trigger uses for profiles
  -- (0039): metadata is client-influenced and must not become unbounded
  -- storage. A key that is absent, blank or not a string lands as null.
  v_first text := nullif(left(btrim(coalesce(v_meta->>'first_name', '')), 80), '');
  v_last text := nullif(left(btrim(coalesce(v_meta->>'last_name', '')), 80), '');
  v_phone text := nullif(left(btrim(coalesce(v_meta->>'phone', '')), 32), '');
  v_rows int := 0;
  v_cfg record;
begin
  -- Shape check in the database too: this function is the security boundary,
  -- not the route that calls it.
  if v_email !~ '^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$' or length(v_email) > 254 then
    return jsonb_build_object('status', 'invalid');
  end if;

  insert into public.waitlist_subscribers (email, source, locale, metadata, first_name, last_name, phone)
  values (v_email, v_source, v_locale, v_meta, v_first, v_last, v_phone)
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

-- ── 7. Which fields each signup form shows ───────────────────────────────
-- World-readable on purpose, like every other app_settings row: the register
-- page and the landing form are rendered for signed-out visitors and have to
-- know which fields to draw before anyone has an account. Nothing here is
-- secret — it is a list of form fields.
--
-- FLAT STRING SCALARS ONLY. /admin/system renders every app_settings row
-- through the generic SettingsEditor, which puts each value in a text/number/
-- checkbox input; a nested object would reach the admin as "[object Object]"
-- and be saved back as one. The `wl_` prefix is what keeps the landing form's
-- three fields flat instead of nesting them under a "waitlist" key.
--
-- Every value is one of hidden | optional | required. The columns behind them
-- already exist (profiles since 0039, waitlist_subscribers above), so this row
-- decides what is ASKED, never what can be stored.
--
-- Inserted whole or not at all: the row does not exist in any deployment yet,
-- so there is no partial version to repair and no admin choice to merge around.
insert into public.app_settings (key, value)
values ('registration', jsonb_build_object(
  'first_name', 'required',
  'last_name', 'required',
  'phone', 'optional',
  'acquisition', 'optional',
  'wl_first_name', 'optional',
  'wl_last_name', 'hidden',
  'wl_phone', 'optional'
))
on conflict (key) do nothing;
