-- ════════════════════════════════════════════════════════════════════════════
-- 0097 — THE NEWSLETTER BECOMES THE CONTACT LIST
--
-- Until now GrovBase kept three separate answers to "who are our people":
--
--   waitlist_subscribers   everyone who signed up on the launch page
--   auth.users / profiles  everyone with an account
--   newsletter_contacts    everyone the newsletter module knew about — nobody
--
-- The third was empty in production while the first held real leads, because
-- the launch page writes through waitlist_subscribe() and nothing told the
-- newsletter. An operator opening Newsletter → Kontakty saw "0" next to a
-- waitlist that had been collecting addresses for two weeks.
--
-- THIS MIGRATION MAKES newsletter_contacts THE ONE LIST, and it does it
-- without touching the public launch page, its form, its rate limiting, its
-- honeypot, its confirmation mail or its Telegram ping. The landing page still
-- posts to the same route, which still calls the same function; that function
-- now also records the person as a contact.
--
-- FOUR RULES THIS ENCODES.
--
-- 1. THE NORMALISED ADDRESS IS THE IDENTITY. `Jan@Email.pl` and `jan@email.pl`
--    are one person. There was a unique index on `email` but not on
--    `lower(email)`, so the guarantee depended on every caller remembering to
--    lowercase. One that forgot would have split a contact in two. The index
--    below makes it the database's promise instead.
--
-- 2. A CONTACT HAS SOURCES, PLURAL. Somebody who joined the waitlist and then
--    opened an account arrived twice, and both arrivals are true. `source_key`
--    stays as "where we first met" for compatibility; the new table records
--    every way we have met since.
--
-- 3. AN ACCOUNT IS NOT A CONSENT. This is the rule the whole migration is
--    arranged around. Linking a user makes them VISIBLE in the contact list;
--    it does not make them mailable, and `marketing_consent` is never set by
--    the account backfill. Somebody who registered without ticking a marketing
--    box is a contact with `Konto: TAK` and `Zgoda: NIE`, and the send path
--    already filters on consent.
--
-- 4. CONSENT ONLY EVER GOES UP HERE. The upsert can grant it and can never
--    revoke it; withdrawing is newsletter_unsubscribe()'s job, which writes a
--    suppression. A contact who already said yes keeps their original
--    consent_at, because the date of an agreement is part of the agreement.
--
-- NOTHING IS DROPPED. waitlist_subscribers keeps every row and keeps receiving
-- them; it is now a legacy store that the launch page still writes to, and the
-- newsletter is the source of truth the admin reads. Deleting it is a separate
-- decision with its own migration.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. THE NORMALISED ADDRESS IS UNIQUE ─────────────────────────────────────
--
-- Created before anything else inserts, so the backfill below cannot be the
-- thing that introduces the duplicate this is meant to prevent. Every existing
-- row was written lowercased by the application, so this cannot fail on data
-- that is already there — and if a future caller forgets, it fails loudly at
-- the write instead of quietly making a second person.

create unique index if not exists newsletter_contacts_email_lower_key
  on public.newsletter_contacts (lower(email));

-- ── 2. EVERY WAY WE HAVE MET THIS PERSON ────────────────────────────────────

create table if not exists public.newsletter_contact_sources (
  contact_id uuid not null references public.newsletter_contacts(id) on delete cascade,
  source_key text not null references public.newsletter_sources(key) on delete cascade,
  -- Kept separately so the timeline can say "joined the waitlist in September,
  -- opened an account in October" rather than collapsing both to one date.
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (contact_id, source_key)
);

create index if not exists newsletter_contact_sources_source_idx
  on public.newsletter_contact_sources (source_key, first_seen_at desc);

alter table public.newsletter_contact_sources enable row level security;

-- Same shape as every other newsletter table in 0051/0094: admins read and
-- write through the authenticated role, anon is not mentioned at all, and the
-- public write path goes through a definer function instead.
drop policy if exists newsletter_contact_sources_admin on public.newsletter_contact_sources;
create policy newsletter_contact_sources_admin on public.newsletter_contact_sources
  to authenticated using (public.is_admin()) with check (public.is_admin());

-- ── 3. THE TWO SOURCES THIS MIGRATION NEEDS ─────────────────────────────────
--
-- `waitlist` is what the launch page has always called itself in
-- waitlist_subscribers.source ('landing'), renamed here to what an operator
-- reads on screen. Both keys are idempotent: re-running changes nothing.

insert into public.newsletter_sources (key, name, note) values
  ('waitlist', 'LP Powitalna', 'Zapis przez publiczną stronę premiery.'),
  ('account',  'Konto GrovBase', 'Osoba założyła konto w aplikacji. To NIE jest zgoda marketingowa.')
on conflict (key) do nothing;

-- ── 4. ONE WRITE LAYER ──────────────────────────────────────────────────────
--
-- Everything that can create a contact goes through here: the launch page, the
-- public newsletter form, the account backfill, and any import that is wired
-- to it later. Four callers writing four slightly different upserts is how a
-- list grows duplicates and inconsistent consent, so there is one.
--
-- NOT granted to anon or authenticated. It is called BY definer functions that
-- are, which keeps the security boundary where 0094 put it.

create or replace function public.newsletter_upsert_contact(
  p_email text,
  p_source_key text,
  p_first_name text default null,
  p_last_name text default null,
  p_locale text default 'pl',
  p_consent boolean default false,
  p_consent_source text default null,
  p_consent_version text default null,
  p_user_id uuid default null,
  p_group_keys text[] default '{}',
  p_created_at timestamptz default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_first text := nullif(left(btrim(coalesce(p_first_name, '')), 120), '');
  v_last  text := nullif(left(btrim(coalesce(p_last_name, '')), 120), '');
  v_locale text := coalesce(nullif(btrim(coalesce(p_locale, '')), ''), 'pl');
  v_source text;
  v_id uuid;
  v_consent boolean := coalesce(p_consent, false);
  v_group uuid;
  v_key text;
begin
  if v_email !~ '^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$' or length(v_email) > 254 then
    return null;
  end if;
  if v_locale not in ('pl', 'en', 'de') then v_locale := 'pl'; end if;

  -- An unknown source becomes 'form' rather than an error: a caller passing a
  -- key nobody registered should still not lose the contact.
  select key into v_source from public.newsletter_sources
    where key = lower(btrim(coalesce(p_source_key, '')));
  if v_source is null then v_source := 'form'; end if;

  select id into v_id from public.newsletter_contacts where lower(email) = v_email;

  if v_id is null then
    insert into public.newsletter_contacts (
      email, first_name, last_name, locale, source_key, user_id,
      marketing_consent, consent_at, consent_source, consent_version, created_at
    ) values (
      v_email, v_first, v_last, v_locale, v_source, p_user_id,
      v_consent,
      case when v_consent then coalesce(p_created_at, now()) end,
      case when v_consent then left(coalesce(p_consent_source, v_source), 120) end,
      case when v_consent then left(coalesce(p_consent_version, 'v1'), 40) end,
      coalesce(p_created_at, now())
    )
    returning id into v_id;
  else
    update public.newsletter_contacts set
      -- Existing values win: a name somebody typed on the launch page is not
      -- overwritten by a null from a later account link.
      first_name = coalesce(first_name, v_first),
      last_name  = coalesce(last_name, v_last),
      user_id    = coalesce(user_id, p_user_id),
      -- CONSENT ONLY GOES UP, and its date is the date of the FIRST yes.
      marketing_consent = marketing_consent or v_consent,
      consent_at = case
        when marketing_consent then consent_at
        when v_consent then coalesce(p_created_at, now())
        else consent_at end,
      consent_source = case
        when marketing_consent then consent_source
        when v_consent then left(coalesce(p_consent_source, v_source), 120)
        else consent_source end,
      consent_version = case
        when marketing_consent then consent_version
        when v_consent then left(coalesce(p_consent_version, 'v1'), 40)
        else consent_version end,
      -- A fresh yes lifts an earlier unsubscribe; it does not touch a
      -- suppression, which is a harder stop and lives in its own table.
      unsubscribed_at = case when v_consent then null else unsubscribed_at end,
      -- The earliest arrival is the contact's real birthday. The backfill
      -- hands us dates older than the row, so take the smaller one.
      created_at = least(created_at, coalesce(p_created_at, created_at)),
      updated_at = now()
    where id = v_id;
  end if;

  -- The source, recorded rather than replaced.
  insert into public.newsletter_contact_sources (contact_id, source_key, first_seen_at, last_seen_at)
  values (v_id, v_source, coalesce(p_created_at, now()), now())
  on conflict (contact_id, source_key) do update
    set first_seen_at = least(public.newsletter_contact_sources.first_seen_at, excluded.first_seen_at),
        last_seen_at = greatest(public.newsletter_contact_sources.last_seen_at, excluded.last_seen_at);

  foreach v_key in array coalesce(p_group_keys, array[]::text[]) loop
    select id into v_group from public.newsletter_groups
      where key = lower(btrim(v_key)) and is_dynamic = false;
    if v_group is not null then
      insert into public.newsletter_group_members (group_id, contact_id)
      values (v_group, v_id) on conflict do nothing;
    end if;
  end loop;

  return v_id;
end $$;

revoke all on function public.newsletter_upsert_contact(
  text, text, text, text, text, boolean, text, text, uuid, text[], timestamptz
) from public, anon, authenticated;

comment on function public.newsletter_upsert_contact(
  text, text, text, text, text, boolean, text, text, uuid, text[], timestamptz
) is
  'The one place a newsletter contact is created or enriched. Normalises the address, never duplicates it, records the source rather than replacing it, links an account without granting consent, and can raise consent but never lower it.';

-- ── 5. THE PUBLIC NEWSLETTER FORM DELEGATES ─────────────────────────────────
--
-- Same signature, same return words, same suppression and rate-limit guards —
-- only the upsert in the middle is now the shared one, so the form and the
-- launch page cannot drift apart.

create or replace function public.newsletter_subscribe(
  p_email text,
  p_first_name text default null,
  p_locale text default 'pl',
  p_source_key text default 'form',
  p_group_keys text[] default '{}',
  p_consent boolean default false,
  p_consent_version text default null,
  p_consent_source text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_recent integer;
  v_existed boolean;
  v_id uuid;
begin
  if v_email !~ '^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$' or length(v_email) > 254 then
    return jsonb_build_object('status', 'invalid');
  end if;

  if exists (select 1 from public.newsletter_suppressions where email = v_email) then
    return jsonb_build_object('status', 'suppressed');
  end if;

  select count(*) into v_recent from public.newsletter_contacts
    where lower(email) = v_email and created_at > now() - interval '1 hour';
  if v_recent >= 5 then
    return jsonb_build_object('status', 'rate_limited');
  end if;

  -- Read BEFORE the upsert: afterwards the row always exists, so 'created' and
  -- 'updated' would become indistinguishable and the public form would tell a
  -- returning subscriber they had just been added.
  select id into v_id from public.newsletter_contacts where lower(email) = v_email;
  v_existed := v_id is not null;

  v_id := public.newsletter_upsert_contact(
    p_email := v_email,
    p_source_key := coalesce(p_source_key, 'form'),
    p_first_name := p_first_name,
    p_locale := p_locale,
    p_consent := coalesce(p_consent, false),
    p_consent_source := p_consent_source,
    p_consent_version := p_consent_version,
    p_group_keys := p_group_keys
  );

  if v_id is null then
    return jsonb_build_object('status', 'invalid');
  end if;
  return jsonb_build_object('status', case when v_existed then 'updated' else 'created' end);
end $$;

-- ── 6. THE LAUNCH PAGE NOW FEEDS THE NEWSLETTER ─────────────────────────────
--
-- THE ONE CHANGE THAT FIXES "0 KONTAKTÓW". Everything else in this function is
-- byte-for-byte what it was: the shape check, the insert into
-- waitlist_subscribers, the 'exists' answer, the confirmation-mail payload.
--
-- The contact upsert happens BEFORE the 'exists' return on purpose. Somebody
-- re-submitting the form is not a new waitlist row, but they may be a contact
-- we are missing — and after this migration ships, that is exactly the case
-- for every address that signed up before it.
--
-- It is also deliberately NOT inside the `if v_rows = 0` branch: a brand-new
-- signup and a repeat signup both have to land in the contact list.
--
-- CONSENT COMES FROM THE FORM, not from the fact that somebody typed an
-- address. The landing form's checkbox arrives in metadata.consent; when it is
-- absent the contact is created WITHOUT marketing consent and is visible but
-- not mailable.

create or replace function public.waitlist_subscribe(
  p_email text,
  p_source text default 'landing',
  p_locale text default 'pl',
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_source text := left(coalesce(nullif(btrim(p_source), ''), 'landing'), 40);
  v_locale text := left(coalesce(nullif(btrim(p_locale), ''), 'pl'), 8);
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_first text := nullif(left(btrim(coalesce(v_meta->>'first_name', '')), 80), '');
  v_last text := nullif(left(btrim(coalesce(v_meta->>'last_name', '')), 80), '');
  v_phone text := nullif(left(btrim(coalesce(v_meta->>'phone', '')), 32), '');
  v_consent boolean := coalesce((v_meta->>'consent')::boolean, false);
  v_rows int := 0;
  v_cfg record;
begin
  if v_email !~ '^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$' or length(v_email) > 254 then
    return jsonb_build_object('status', 'invalid');
  end if;

  insert into public.waitlist_subscribers (email, source, locale, metadata, first_name, last_name, phone)
  values (v_email, v_source, v_locale, v_meta, v_first, v_last, v_phone)
  on conflict (lower(email)) do nothing;
  get diagnostics v_rows = row_count;

  -- THE NEWSLETTER LEARNS ABOUT EVERY SIGNUP, new or repeated. Wrapped so a
  -- fault here can never cost the signup that already succeeded on the line
  -- above — the launch page's job is to capture the lead, and the contact list
  -- is downstream of that.
  begin
    perform public.newsletter_upsert_contact(
      p_email := v_email,
      p_source_key := 'waitlist',
      p_first_name := v_first,
      p_last_name := v_last,
      p_locale := left(v_locale, 2),
      p_consent := v_consent,
      p_consent_source := 'waitlist',
      p_consent_version := coalesce(v_meta->>'consent_version', 'v1')
    );
  exception when others then
    raise notice 'newsletter contact upsert failed for waitlist signup: %', sqlerrm;
  end;

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

-- ── 7. BACKFILL: THE WAITLIST WE ALREADY HAVE ───────────────────────────────
--
-- Idempotent by construction — it goes through the same upsert, which finds an
-- existing contact by normalised address and enriches it instead of inserting.
-- Running this migration twice migrates nothing the second time.
--
-- created_at is carried over so a lead who joined in September does not appear
-- to have arrived the day we migrated, and so the "all time" range starts
-- where the data really starts.

do $$
declare
  r record;
begin
  for r in
    select email, first_name, last_name, locale, created_at, metadata
      from public.waitlist_subscribers
     order by created_at asc
  loop
    perform public.newsletter_upsert_contact(
      p_email := r.email,
      p_source_key := 'waitlist',
      p_first_name := r.first_name,
      p_last_name := r.last_name,
      p_locale := left(coalesce(r.locale, 'pl'), 2),
      -- The row records what the person agreed to at the time. An older row
      -- with no consent key in its metadata did not record one, so it does not
      -- get one invented here: it becomes a visible, non-mailable contact.
      p_consent := coalesce((r.metadata->>'consent')::boolean, false),
      p_consent_source := 'waitlist',
      p_consent_version := coalesce(r.metadata->>'consent_version', 'v1'),
      p_created_at := r.created_at
    );
  end loop;
end $$;

-- ── 8. BACKFILL: THE ACCOUNTS WE ALREADY HAVE ───────────────────────────────
--
-- READ THE THIRD RULE AT THE TOP BEFORE CHANGING THIS. `p_consent` is not
-- passed, so it defaults to false and the upsert's "consent only goes up" rule
-- means no existing consent is disturbed and no new one is invented. A person
-- who joined the waitlist WITH consent and then registered keeps their
-- consent; a person who only ever registered gets a contact with
-- marketing_consent = false.
--
-- Nothing from auth is copied except the id: no password hash, no factors, no
-- tokens. The contact carries a foreign key and reads the rest live.

do $$
declare
  r record;
begin
  for r in
    -- DRIVEN FROM `profiles`, NOT FROM auth.users, because
    -- newsletter_contacts.user_id references profiles(id). A user row without
    -- a profile would produce a foreign key this insert cannot satisfy, so the
    -- join is inner: an account with no profile is not linkable and is left
    -- for the profile bootstrap to create.
    --
    -- `profiles` carries the name; the language lives in user_preferences and
    -- is read live by the app, so it is deliberately NOT copied here. A
    -- contact created from an account takes the app default and keeps whatever
    -- the waitlist already recorded if it got there first.
    select p.id as user_id, u.email, u.created_at,
           p.first_name, p.last_name
      from public.profiles p
      join auth.users u on u.id = p.id
     where u.email is not null and u.deleted_at is null
     order by u.created_at asc
  loop
    perform public.newsletter_upsert_contact(
      p_email := r.email,
      p_source_key := 'account',
      p_first_name := r.first_name,
      p_last_name := r.last_name,
      p_user_id := r.user_id,
      p_created_at := r.created_at
    );
  end loop;
end $$;

-- ── 9. THE INDEXES THE NEW READS ACTUALLY USE ───────────────────────────────
--
-- Only these three. The contact list filters by source through the join table
-- (indexed above), by consent through the partial index 0094 already has, and
-- orders by created_at. `user_id` is new and is what "has an account" filters
-- on; it is partial because the rows without one are the majority and are
-- never the answer to that filter.

create index if not exists newsletter_contacts_user_idx
  on public.newsletter_contacts (user_id) where user_id is not null;

-- "Nowe kontakty" on the dashboard is a count over a window, on every render.
create index if not exists newsletter_contacts_created_idx
  on public.newsletter_contacts (created_at desc);
