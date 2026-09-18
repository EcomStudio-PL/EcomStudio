-- NEWSLETTER — a marketing list that is a different product from the mailbox.
--
-- GrovBase already has mail: a real SMTP transport, an IMAP inbox, auth mail,
-- message templates, an admin notification outbox. None of it is touched here.
-- That system's job is "one message, because something happened". This one's
-- job is "many messages, because somebody decided to write to a list" — and
-- the two have opposite failure modes, so they get separate tables, a separate
-- queue and a separate worker.
--
-- THREE RULES SHAPE EVERY TABLE BELOW.
--
-- 1. CONSENT IS A RECORD, NOT AN ASSUMPTION. Having somebody's address is not
--    permission to market to them. `marketing_consent` is false until an
--    affirmative act sets it, and the act itself is stored: when, from where,
--    and which wording was on screen. The existing waitlist is a SOURCE of
--    addresses and is explicitly NOT a grant of consent — those seven rows
--    signed up for a launch announcement, which is a different purpose.
--
-- 2. EXACTLY ONCE IS A CONSTRAINT, NOT A PROMISE. `unique (campaign_id,
--    step_index, contact_id)` on newsletter_recipients is what makes a cron
--    retry, a worker restart, a double-tapped button and an overlapping
--    invocation all harmless. Nothing in application code has to be careful.
--
-- 3. NOBODY BUT AN ADMIN READS THIS. A contact list is the most exfiltratable
--    thing a SaaS owns. Every table has RLS with exactly one policy, scoped
--    `to authenticated` and guarded by is_admin() — the shape migration 0051
--    had to fix, applied correctly the first time. Anonymous visitors reach
--    exactly three SECURITY DEFINER functions: subscribe, unsubscribe, and the
--    tracking write. They can never select, count or probe a table.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO: it adds no channel to
-- notification_outbox (that queue is admin-notification-only and caps at 500),
-- it changes no existing function, and it grants nothing new on any existing
-- table.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. WHERE ADDRESSES COME FROM
-- ═══════════════════════════════════════════════════════════════════════════
--
-- A registry rather than free text on the contact. The public subscribe
-- function only accepts a key that exists here, which is what stops an
-- anonymous poster from inventing segments: `source` is attacker-supplied on
-- every public form, and an audience filtered by attacker-supplied text is an
-- audience an attacker chooses.
create table if not exists public.newsletter_sources (
  key text primary key
    constraint newsletter_sources_key_shape check (key ~ '^[a-z][a-z0-9_]{1,60}$'),
  name text not null,
  -- Where it physically lives, for an operator reading the list a year later.
  note text,
  created_at timestamptz not null default now()
);

alter table public.newsletter_sources enable row level security;
drop policy if exists "newsletter_sources_admin" on public.newsletter_sources;
create policy "newsletter_sources_admin" on public.newsletter_sources for all
  to authenticated using (public.is_admin()) with check (public.is_admin());

insert into public.newsletter_sources (key, name, note) values
  ('waitlist',  'Lista oczekujących',  'Formularz na stronie powitalnej. Zapis na powiadomienie o premierze — to NIE jest zgoda marketingowa.'),
  ('account',   'Konto użytkownika',   'Adres z rejestracji. Zgoda marketingowa musi zostać wyrażona osobno.'),
  ('form',      'Formularz na stronie', 'Domyślne źródło dla formularzy z page buildera, gdy nie wskazano innego.'),
  ('import',    'Import CSV',          'Baza wgrana przez administratora.'),
  ('manual',    'Dodany ręcznie',      'Pojedynczy kontakt dodany w panelu.')
on conflict (key) do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. THE CONTACT
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.newsletter_contacts (
  id uuid primary key default gen_random_uuid(),

  -- NORMALISED ON THE WAY IN, once, here. `Test@Example.com` and
  -- `test@example.com ` are one person, and the unique index is the only
  -- thing that can actually enforce that across five different writers.
  email text not null
    constraint newsletter_contacts_email_normalised check (email = lower(btrim(email)))
    constraint newsletter_contacts_email_shape check (email ~ '^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$'),

  first_name text,
  last_name text,
  locale text not null default 'pl'
    constraint newsletter_contacts_locale_check check (locale in ('pl', 'en', 'de')),

  source_key text not null default 'form'
    references public.newsletter_sources(key) on update cascade on delete set default,

  -- Set when the address belongs to a real account. Nullable and NOT a
  -- foreign key with cascade on purpose: deleting an account must not silently
  -- delete the record that somebody consented, which is a legal artefact.
  user_id uuid references public.profiles(id) on delete set null,

  tags text[] not null default '{}',

  -- ── CONSENT ─────────────────────────────────────────────────────────────
  -- False until an affirmative act. Everything else here describes that act.
  marketing_consent boolean not null default false,
  consent_at timestamptz,
  consent_source text,
  -- The wording that was on screen. When the copy changes, the version
  -- changes, and an operator can tell who agreed to which text.
  consent_version text,
  unsubscribed_at timestamptz,
  unsubscribe_reason text,

  -- Opaque, unguessable, and stable for the life of the contact: it is what a
  -- one-click unsubscribe link carries, and it must keep working in a mail
  -- somebody opens in six months.
  unsubscribe_token uuid not null default gen_random_uuid(),

  -- Rolled forward by the event writer so the list can be sorted by life sign
  -- without touching newsletter_events.
  last_activity_at timestamptz,
  last_sent_at timestamptz,
  last_opened_at timestamptz,
  last_clicked_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,

  -- Free-form, operator-owned. Never anything a form supplies verbatim.
  metadata jsonb not null default '{}'::jsonb,

  constraint newsletter_contacts_consent_coherent
    check (marketing_consent = false or consent_at is not null)
);

create unique index if not exists newsletter_contacts_email_key
  on public.newsletter_contacts (email);
create unique index if not exists newsletter_contacts_unsub_token_key
  on public.newsletter_contacts (unsubscribe_token);
create index if not exists newsletter_contacts_source_idx
  on public.newsletter_contacts (source_key, created_at desc);
create index if not exists newsletter_contacts_mailable_idx
  on public.newsletter_contacts (created_at desc)
  where marketing_consent = true and unsubscribed_at is null;

alter table public.newsletter_contacts enable row level security;
drop policy if exists "newsletter_contacts_admin" on public.newsletter_contacts;
create policy "newsletter_contacts_admin" on public.newsletter_contacts for all
  to authenticated using (public.is_admin()) with check (public.is_admin());

drop trigger if exists newsletter_contacts_touch on public.newsletter_contacts;
create trigger newsletter_contacts_touch before update on public.newsletter_contacts
  for each row execute function public.touch_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. SUPPRESSION — the list that always wins
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Keyed on the ADDRESS, not the contact id, so deleting and re-importing a
-- contact cannot resurrect somebody who asked to be left alone.
create table if not exists public.newsletter_suppressions (
  email text primary key
    constraint newsletter_suppressions_email_normalised check (email = lower(btrim(email))),
  reason text not null default 'unsubscribed'
    constraint newsletter_suppressions_reason_check
      check (reason in ('unsubscribed', 'bounced', 'complained', 'blocked')),
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null
);

alter table public.newsletter_suppressions enable row level security;
drop policy if exists "newsletter_suppressions_admin" on public.newsletter_suppressions;
create policy "newsletter_suppressions_admin" on public.newsletter_suppressions for all
  to authenticated using (public.is_admin()) with check (public.is_admin());

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. GROUPS — static lists and saved filters, in one table
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.newsletter_groups (
  id uuid primary key default gen_random_uuid(),
  key text not null
    constraint newsletter_groups_key_shape check (key ~ '^[a-z][a-z0-9_-]{1,60}$'),
  name text not null,
  description text,
  -- A dynamic group has no members table rows; its membership is recomputed
  -- from `rules` every time it is used. One concept, two storage strategies,
  -- because an operator does not care which it is when picking an audience.
  is_dynamic boolean not null default false,
  -- { match: 'all' | 'any', conditions: [{ field, op, value }] }
  rules jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null
);

create unique index if not exists newsletter_groups_key_idx on public.newsletter_groups (key);

alter table public.newsletter_groups enable row level security;
drop policy if exists "newsletter_groups_admin" on public.newsletter_groups;
create policy "newsletter_groups_admin" on public.newsletter_groups for all
  to authenticated using (public.is_admin()) with check (public.is_admin());

drop trigger if exists newsletter_groups_touch on public.newsletter_groups;
create trigger newsletter_groups_touch before update on public.newsletter_groups
  for each row execute function public.touch_updated_at();

create table if not exists public.newsletter_group_members (
  group_id uuid not null references public.newsletter_groups(id) on delete cascade,
  contact_id uuid not null references public.newsletter_contacts(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (group_id, contact_id)
);

create index if not exists newsletter_group_members_contact_idx
  on public.newsletter_group_members (contact_id);

alter table public.newsletter_group_members enable row level security;
drop policy if exists "newsletter_group_members_admin" on public.newsletter_group_members;
create policy "newsletter_group_members_admin" on public.newsletter_group_members for all
  to authenticated using (public.is_admin()) with check (public.is_admin());

insert into public.newsletter_groups (key, name, description) values
  ('main', 'Newsletter główny', 'Domyślna lista dla zapisów ze strony.')
on conflict (key) do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. CAMPAIGNS
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.newsletter_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,

  -- one_off  — one message, sent once.
  -- sequence — several messages with delays between them.
  -- automation — a sequence started by an event rather than by a date.
  kind text not null default 'one_off'
    constraint newsletter_campaigns_kind_check check (kind in ('one_off', 'sequence', 'automation')),

  status text not null default 'draft'
    constraint newsletter_campaigns_status_check
      check (status in ('draft', 'scheduled', 'sending', 'paused', 'sent', 'cancelled', 'failed')),

  -- { include: [group_id…], exclude: [group_id…] }
  audience jsonb not null default '{"include": [], "exclude": []}'::jsonb,

  scheduled_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,

  -- ── TRACKING ────────────────────────────────────────────────────────────
  track_opens boolean not null default true,
  track_clicks boolean not null default true,
  utm jsonb not null default '{}'::jsonb,

  -- ── A/B ─────────────────────────────────────────────────────────────────
  -- Off by default. When on, `ab_share_pct` of the audience is split between
  -- the variants, the rest waits `ab_decide_after_hours` and then receives the
  -- winner. The metric is deliberately NOT open rate by default: Apple Mail
  -- Privacy Protection opens everything, so an open-rate winner is frequently
  -- a measurement of iPhone share.
  ab_enabled boolean not null default false,
  ab_share_pct integer not null default 20
    constraint newsletter_campaigns_ab_share_check check (ab_share_pct between 2 and 100),
  ab_decide_after_hours integer not null default 4
    constraint newsletter_campaigns_ab_hours_check check (ab_decide_after_hours between 1 and 168),
  ab_metric text not null default 'click'
    constraint newsletter_campaigns_ab_metric_check check (ab_metric in ('click', 'conversion', 'open')),
  ab_winner text,
  ab_decided_at timestamptz,

  -- Stops a promotional sequence the moment the thing it is selling is bought.
  stop_on_conversion boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,

  constraint newsletter_campaigns_scheduled_needs_date
    check (status <> 'scheduled' or scheduled_at is not null)
);

create index if not exists newsletter_campaigns_status_idx
  on public.newsletter_campaigns (status, coalesce(scheduled_at, created_at) desc);
create index if not exists newsletter_campaigns_due_idx
  on public.newsletter_campaigns (scheduled_at)
  where status = 'scheduled';

alter table public.newsletter_campaigns enable row level security;
drop policy if exists "newsletter_campaigns_admin" on public.newsletter_campaigns;
create policy "newsletter_campaigns_admin" on public.newsletter_campaigns for all
  to authenticated using (public.is_admin()) with check (public.is_admin());

drop trigger if exists newsletter_campaigns_touch on public.newsletter_campaigns;
create trigger newsletter_campaigns_touch before update on public.newsletter_campaigns
  for each row execute function public.touch_updated_at();

-- ── THE MESSAGES ───────────────────────────────────────────────────────────
--
-- EVERY campaign uses this table, including a one-off, which is a campaign
-- with exactly one step at index 0. The alternative — a body on the campaign
-- for simple sends and a steps table for sequences — means two code paths and
-- a permanent question of which one is authoritative.
--
-- A/B VARIANTS ARE ROWS, not a second table: two rows share a step_index and
-- differ by `variant`. The audience split then needs no join to know what to
-- send, and a step with one variant is simply a step with one row.
create table if not exists public.newsletter_campaign_steps (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.newsletter_campaigns(id) on delete cascade,
  step_index integer not null default 0
    constraint newsletter_steps_index_check check (step_index between 0 and 50),
  variant text not null default 'A'
    constraint newsletter_steps_variant_check check (variant in ('A', 'B', 'C')),

  -- Minutes AFTER the previous step was sent to this contact. 0 on step 0.
  delay_minutes integer not null default 0
    constraint newsletter_steps_delay_check check (delay_minutes between 0 and 525600),

  subject text not null default '',
  preheader text not null default '',

  -- The two ways to write a mail. `builder` keeps structured blocks so the
  -- editor can round-trip them; `html` is a pasted document. Both end up as
  -- body_html — the renderer decides, the sender never has to.
  editor text not null default 'builder'
    constraint newsletter_steps_editor_check check (editor in ('builder', 'html')),
  blocks jsonb not null default '[]'::jsonb,
  body_html text not null default '',
  body_text text not null default '',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists newsletter_steps_unique
  on public.newsletter_campaign_steps (campaign_id, step_index, variant);
create index if not exists newsletter_steps_campaign_idx
  on public.newsletter_campaign_steps (campaign_id, step_index);

alter table public.newsletter_campaign_steps enable row level security;
drop policy if exists "newsletter_steps_admin" on public.newsletter_campaign_steps;
create policy "newsletter_steps_admin" on public.newsletter_campaign_steps for all
  to authenticated using (public.is_admin()) with check (public.is_admin());

drop trigger if exists newsletter_steps_touch on public.newsletter_campaign_steps;
create trigger newsletter_steps_touch before update on public.newsletter_campaign_steps
  for each row execute function public.touch_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. THE QUEUE — one row per message that will ever be sent
-- ═══════════════════════════════════════════════════════════════════════════
--
-- This table IS the idempotency guarantee. The unique index below is the whole
-- defence against double sending: a cron retry, a restarted worker, an
-- overlapping invocation and an admin who taps "Wyślij" twice all collide on
-- it and lose. No application code has to be careful, which is the point —
-- careful code is code that stops being careful during an incident.
create table if not exists public.newsletter_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.newsletter_campaigns(id) on delete cascade,
  step_index integer not null default 0,
  variant text not null default 'A',
  contact_id uuid not null references public.newsletter_contacts(id) on delete cascade,

  -- Frozen at snapshot time. A contact who changes their address mid-send is
  -- still delivered to the address the audience was built from, and the
  -- per-recipient log keeps meaning something after the contact row changes.
  email text not null,

  status text not null default 'pending'
    constraint newsletter_recipients_status_check
      check (status in ('pending', 'sending', 'sent', 'failed', 'skipped', 'cancelled')),

  -- Not before this moment. Step 0 is immediate; step 2 is "two days after
  -- step 1 actually went out to THIS person", which is why the delay is
  -- resolved into a timestamp per recipient rather than computed at send time.
  send_after timestamptz not null default now(),

  attempts integer not null default 0,
  claimed_at timestamptz,
  next_attempt_at timestamptz,

  sent_at timestamptz,
  -- What the SMTP server actually answered. Kept so "accepted by the mail
  -- server" can be shown instead of a "Delivered" nobody can substantiate.
  smtp_response text,
  message_id text,
  last_error_safe text,

  -- Generated BEFORE the send (never during it) when AI personalisation is on:
  -- { subject, intro, cta, body }. Absent means "use the step as written".
  personalization jsonb,

  created_at timestamptz not null default now()
);

-- THE CONSTRAINT THIS WHOLE FILE EXISTS FOR.
create unique index if not exists newsletter_recipients_once
  on public.newsletter_recipients (campaign_id, step_index, contact_id);

create index if not exists newsletter_recipients_claimable_idx
  on public.newsletter_recipients (send_after)
  where status = 'pending';
create index if not exists newsletter_recipients_campaign_idx
  on public.newsletter_recipients (campaign_id, status);
create index if not exists newsletter_recipients_contact_idx
  on public.newsletter_recipients (contact_id, sent_at desc);
create index if not exists newsletter_recipients_message_id_idx
  on public.newsletter_recipients (message_id) where message_id is not null;

alter table public.newsletter_recipients enable row level security;
drop policy if exists "newsletter_recipients_admin" on public.newsletter_recipients;
create policy "newsletter_recipients_admin" on public.newsletter_recipients for all
  to authenticated using (public.is_admin()) with check (public.is_admin());

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. EVENTS — one table, because the next metric is always the one nobody
--    planned a column for
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.newsletter_events (
  id bigserial primary key,
  event_type text not null
    constraint newsletter_events_type_check check (event_type in (
      'sent', 'accepted', 'opened', 'clicked', 'replied',
      'unsubscribed', 'bounced', 'complained', 'converted', 'failed'
    )),
  campaign_id uuid references public.newsletter_campaigns(id) on delete cascade,
  step_index integer,
  variant text,
  contact_id uuid references public.newsletter_contacts(id) on delete cascade,
  recipient_id uuid references public.newsletter_recipients(id) on delete cascade,
  link_id uuid,
  -- Deliberately small: a user agent family at most, never an IP, never a
  -- full UA string. An open pixel is not a reason to start profiling people.
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists newsletter_events_campaign_idx
  on public.newsletter_events (campaign_id, event_type, created_at desc);
create index if not exists newsletter_events_contact_idx
  on public.newsletter_events (contact_id, created_at desc);
create index if not exists newsletter_events_recent_idx
  on public.newsletter_events (created_at desc);
-- UNIQUE OPENS AND CLICKS are the honest numbers, so the query that produces
-- them gets an index rather than a count of raw rows.
create index if not exists newsletter_events_unique_idx
  on public.newsletter_events (campaign_id, event_type, contact_id);

alter table public.newsletter_events enable row level security;
drop policy if exists "newsletter_events_admin" on public.newsletter_events;
create policy "newsletter_events_admin" on public.newsletter_events for all
  to authenticated using (public.is_admin()) with check (public.is_admin());

-- ── LINKS ──────────────────────────────────────────────────────────────────
-- Every trackable link in a campaign, resolved once at snapshot time. The
-- redirect endpoint then looks up an id instead of trusting a URL in a query
-- string — which is what stops the tracker becoming an open redirect.
create table if not exists public.newsletter_links (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.newsletter_campaigns(id) on delete cascade,
  url text not null,
  label text,
  created_at timestamptz not null default now()
);

create unique index if not exists newsletter_links_unique
  on public.newsletter_links (campaign_id, md5(url));

alter table public.newsletter_links enable row level security;
drop policy if exists "newsletter_links_admin" on public.newsletter_links;
create policy "newsletter_links_admin" on public.newsletter_links for all
  to authenticated using (public.is_admin()) with check (public.is_admin());

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. TEMPLATES — the newsletter's own, separate from message_templates
-- ═══════════════════════════════════════════════════════════════════════════
--
-- message_templates carries auth and transactional copy keyed by event. Those
-- keys are wired into the auth hook and the waitlist; adding marketing bodies
-- to that table would put campaign drafts one mistake away from the mail that
-- verifies an account. Separate table, no shared keys.
create table if not exists public.newsletter_templates (
  id uuid primary key default gen_random_uuid(),
  key text,
  name text not null,
  category text not null default 'custom',
  subject text not null default '',
  preheader text not null default '',
  editor text not null default 'builder'
    constraint newsletter_templates_editor_check check (editor in ('builder', 'html')),
  blocks jsonb not null default '[]'::jsonb,
  body_html text not null default '',
  -- A built-in cannot be deleted, only copied. An operator's own can be both.
  is_builtin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null
);

create unique index if not exists newsletter_templates_key_idx
  on public.newsletter_templates (key) where key is not null;

alter table public.newsletter_templates enable row level security;
drop policy if exists "newsletter_templates_admin" on public.newsletter_templates;
create policy "newsletter_templates_admin" on public.newsletter_templates for all
  to authenticated using (public.is_admin()) with check (public.is_admin());

drop trigger if exists newsletter_templates_touch on public.newsletter_templates;
create trigger newsletter_templates_touch before update on public.newsletter_templates
  for each row execute function public.touch_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. ATTRIBUTION — built now, honest until there is something to attribute
-- ═══════════════════════════════════════════════════════════════════════════
--
-- PROD has zero rows in `payments` and zero in `subscriptions`: billing is not
-- live. So this table exists, the click path already carries everything needed
-- to fill it, and the dashboard says "brak danych sprzedażowych" rather than
-- rendering a confident 0 zł that looks like a measurement.
create table if not exists public.newsletter_attributions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.newsletter_campaigns(id) on delete cascade,
  contact_id uuid references public.newsletter_contacts(id) on delete set null,
  recipient_id uuid references public.newsletter_recipients(id) on delete set null,
  -- The click that earned the credit, and when it happened.
  click_at timestamptz not null default now(),
  converted_at timestamptz,
  -- Whatever the eventual payment row is. Kept as a loose reference rather
  -- than a foreign key so this table does not have to be rewritten when the
  -- payment provider is chosen.
  order_ref text,
  amount_cents bigint,
  currency text default 'PLN',
  created_at timestamptz not null default now()
);

create index if not exists newsletter_attributions_campaign_idx
  on public.newsletter_attributions (campaign_id, converted_at desc);
create unique index if not exists newsletter_attributions_order_idx
  on public.newsletter_attributions (order_ref) where order_ref is not null;

alter table public.newsletter_attributions enable row level security;
drop policy if exists "newsletter_attributions_admin" on public.newsletter_attributions;
create policy "newsletter_attributions_admin" on public.newsletter_attributions for all
  to authenticated using (public.is_admin()) with check (public.is_admin());

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. AUTOMATIONS — what starts a sequence without a person pressing send
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.newsletter_automations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  enabled boolean not null default false,
  trigger_type text not null
    constraint newsletter_automations_trigger_check check (trigger_type in (
      'group_joined', 'form_submitted', 'account_created', 'no_click', 'clicked', 'converted'
    )),
  -- { group_id } | { source_key } | { campaign_id, within_days }
  trigger_config jsonb not null default '{}'::jsonb,
  -- The sequence this trigger runs. Its steps are ordinary campaign steps.
  campaign_id uuid not null references public.newsletter_campaigns(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null
);

create index if not exists newsletter_automations_live_idx
  on public.newsletter_automations (trigger_type) where enabled;

alter table public.newsletter_automations enable row level security;
drop policy if exists "newsletter_automations_admin" on public.newsletter_automations;
create policy "newsletter_automations_admin" on public.newsletter_automations for all
  to authenticated using (public.is_admin()) with check (public.is_admin());

drop trigger if exists newsletter_automations_touch on public.newsletter_automations;
create trigger newsletter_automations_touch before update on public.newsletter_automations
  for each row execute function public.touch_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 11. THE THREE DOORS AN ANONYMOUS VISITOR MAY USE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Not one of the tables above has an anon policy, so these functions are the
-- entire public surface. Each validates its own input: the route in front of
-- it is a rate limiter, not the boundary.

-- ── SUBSCRIBE ──────────────────────────────────────────────────────────────
--
-- Returns 'created' | 'updated' | 'invalid' | 'rate_limited' | 'suppressed'.
--
-- CONSENT IS AN ARGUMENT, AND FALSE IS A VALID ANSWER. A form that collects an
-- address without a ticked box still gets to record the address — that is how
-- the waitlist works — but it records marketing_consent = false, and no
-- campaign will ever reach it. Nothing here can infer consent.
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
  v_name text := nullif(btrim(coalesce(p_first_name, '')), '');
  v_locale text := coalesce(nullif(btrim(coalesce(p_locale, '')), ''), 'pl');
  v_source text;
  v_recent integer;
  v_id uuid;
  v_existed boolean;
  v_group uuid;
  v_key text;
begin
  if v_email !~ '^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$' or length(v_email) > 254 then
    return jsonb_build_object('status', 'invalid');
  end if;
  if v_locale not in ('pl', 'en', 'de') then v_locale := 'pl'; end if;

  -- An unknown source is not an error and is not accepted either: it falls
  -- back to the generic form source. This is what keeps segment names out of
  -- the hands of whoever is posting to the endpoint.
  select key into v_source from public.newsletter_sources
    where key = lower(btrim(coalesce(p_source_key, '')));
  if v_source is null then v_source := 'form'; end if;

  -- Somebody who asked to be left alone stays left alone, even if they are
  -- typed into a form again by somebody else.
  if exists (select 1 from public.newsletter_suppressions where email = v_email) then
    return jsonb_build_object('status', 'suppressed');
  end if;

  -- Survives a restart, unlike an in-memory limiter. Five signups an hour per
  -- address is far past any honest use.
  select count(*) into v_recent from public.newsletter_contacts
    where email = v_email and created_at > now() - interval '1 hour';
  if v_recent >= 5 then
    return jsonb_build_object('status', 'rate_limited');
  end if;

  select id into v_id from public.newsletter_contacts where email = v_email;
  v_existed := v_id is not null;

  if not v_existed then
    insert into public.newsletter_contacts (
      email, first_name, locale, source_key,
      marketing_consent, consent_at, consent_source, consent_version
    ) values (
      v_email, left(v_name, 120), v_locale, v_source,
      coalesce(p_consent, false),
      case when coalesce(p_consent, false) then now() end,
      case when coalesce(p_consent, false) then left(coalesce(p_consent_source, v_source), 120) end,
      case when coalesce(p_consent, false) then left(coalesce(p_consent_version, 'v1'), 40) end
    )
    returning id into v_id;
  else
    -- CONSENT ONLY EVER MOVES FORWARD HERE. A second form submission may GRANT
    -- consent; it can never silently revoke it, and it never overwrites an
    -- earlier, already-recorded grant with a newer date.
    update public.newsletter_contacts set
      first_name = coalesce(first_name, left(v_name, 120)),
      marketing_consent = marketing_consent or coalesce(p_consent, false),
      consent_at = case
        when marketing_consent then consent_at
        when coalesce(p_consent, false) then now()
        else consent_at end,
      consent_source = case
        when marketing_consent then consent_source
        when coalesce(p_consent, false) then left(coalesce(p_consent_source, v_source), 120)
        else consent_source end,
      consent_version = case
        when marketing_consent then consent_version
        when coalesce(p_consent, false) then left(coalesce(p_consent_version, 'v1'), 40)
        else consent_version end,
      -- Re-subscribing after an unsubscribe is a deliberate act and clears it.
      unsubscribed_at = case when coalesce(p_consent, false) then null else unsubscribed_at end
    where id = v_id;
  end if;

  foreach v_key in array coalesce(p_group_keys, array[]::text[]) loop
    select id into v_group from public.newsletter_groups
      where key = lower(btrim(v_key)) and is_dynamic = false;
    if v_group is not null then
      insert into public.newsletter_group_members (group_id, contact_id)
      values (v_group, v_id) on conflict do nothing;
    end if;
  end loop;

  return jsonb_build_object('status', case when v_existed then 'updated' else 'created' end);
end $$;

revoke all on function public.newsletter_subscribe(text, text, text, text, text[], boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.newsletter_subscribe(text, text, text, text, text[], boolean, text, text)
  to anon, authenticated;

-- ── UNSUBSCRIBE ────────────────────────────────────────────────────────────
--
-- One click, no login, no confirmation page that asks them to reconsider. The
-- token is the authorisation; it identifies a contact and nothing else, and it
-- cannot be used to read anything.
create or replace function public.newsletter_unsubscribe(
  p_token uuid,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contact record;
begin
  select id, email into v_contact from public.newsletter_contacts
    where unsubscribe_token = p_token;
  if v_contact.id is null then
    return jsonb_build_object('status', 'unknown');
  end if;

  update public.newsletter_contacts
     set marketing_consent = false,
         unsubscribed_at = coalesce(unsubscribed_at, now()),
         unsubscribe_reason = left(nullif(btrim(coalesce(p_reason, '')), ''), 200)
   where id = v_contact.id;

  -- BOTH, deliberately. The flag answers "may we mail this contact"; the
  -- suppression row answers "may we mail this ADDRESS", and it survives the
  -- contact being deleted and re-imported from a CSV six months later.
  insert into public.newsletter_suppressions (email, reason)
  values (v_contact.email, 'unsubscribed')
  on conflict (email) do nothing;

  -- Anything still queued for them stops being queued. Already-sent mail
  -- cannot be recalled, and nothing here pretends otherwise.
  update public.newsletter_recipients
     set status = 'cancelled'
   where contact_id = v_contact.id and status = 'pending';

  insert into public.newsletter_events (event_type, contact_id)
  values ('unsubscribed', v_contact.id);

  return jsonb_build_object('status', 'unsubscribed');
end $$;

revoke all on function public.newsletter_unsubscribe(uuid, text) from public, anon, authenticated;
grant execute on function public.newsletter_unsubscribe(uuid, text) to anon, authenticated;

-- ── TRACKING WRITE ─────────────────────────────────────────────────────────
--
-- The open pixel and the click redirect both land here. It takes a RECIPIENT
-- id, which is unguessable, and writes one event. It returns the destination
-- for a click so the redirect never has to trust a URL from the query string —
-- an open redirect in a marketing mail is a phishing kit with our domain on it.
create or replace function public.newsletter_track(
  p_recipient uuid,
  p_event text,
  p_link uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec record;
  v_url text;
begin
  if p_event not in ('opened', 'clicked') then
    return jsonb_build_object('status', 'ignored');
  end if;

  select r.id, r.campaign_id, r.step_index, r.variant, r.contact_id
    into v_rec
    from public.newsletter_recipients r
   where r.id = p_recipient and r.status = 'sent';
  if v_rec.id is null then
    return jsonb_build_object('status', 'unknown');
  end if;

  if p_link is not null then
    select url into v_url from public.newsletter_links
      where id = p_link and campaign_id = v_rec.campaign_id;
    if v_url is null then
      return jsonb_build_object('status', 'unknown');
    end if;
  end if;

  insert into public.newsletter_events
    (event_type, campaign_id, step_index, variant, contact_id, recipient_id, link_id)
  values
    (p_event, v_rec.campaign_id, v_rec.step_index, v_rec.variant, v_rec.contact_id, v_rec.id, p_link);

  update public.newsletter_contacts
     set last_activity_at = now(),
         last_opened_at = case when p_event = 'opened' then now() else last_opened_at end,
         last_clicked_at = case when p_event = 'clicked' then now() else last_clicked_at end
   where id = v_rec.contact_id;

  -- A click is the moment attribution starts counting, so the row is opened
  -- here rather than at purchase time — by then the campaign is long gone.
  if p_event = 'clicked' then
    insert into public.newsletter_attributions (campaign_id, contact_id, recipient_id)
    values (v_rec.campaign_id, v_rec.contact_id, v_rec.id);
  end if;

  return jsonb_build_object('status', 'ok', 'url', v_url);
end $$;

revoke all on function public.newsletter_track(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.newsletter_track(uuid, text, uuid) to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 12. THE QUEUE'S DOOR — server-only, and nothing like the mailbox cron
-- ═══════════════════════════════════════════════════════════════════════════
--
-- /api/cron/mail authorises EITHER a bearer secret OR an ambient admin
-- session, on a GET. That is defensible for a mailbox poll; for a bulk send it
-- would mean a mass mailing could be fired by a navigation carrying an admin
-- cookie. These two take the dispatch token and nothing else — there is no
-- session path into them at all.
--
-- The claim/finish contract is copied from 0052/0053 deliberately: attempts
-- spent at claim, a five-minute reaper for invocations that died mid-batch,
-- FOR UPDATE SKIP LOCKED so two workers never fight over a row.
create or replace function public.newsletter_queue_claim(
  p_token text,
  p_limit integer default 25
) returns table (
  id uuid,
  campaign_id uuid,
  step_index integer,
  variant text,
  contact_id uuid,
  email text,
  attempts integer,
  personalization jsonb,
  first_name text,
  locale text,
  unsubscribe_token uuid
)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 200));
begin
  if not public.server_call_ok(p_token) then
    return;
  end if;

  return query
  with claimed as (
    update public.newsletter_recipients r
       set attempts = r.attempts + 1,
           claimed_at = now(),
           status = 'sending'
     where r.id in (
       select c.id
         from public.newsletter_recipients c
         join public.newsletter_campaigns k on k.id = c.campaign_id
         join public.newsletter_contacts ctc on ctc.id = c.contact_id
        where c.status in ('pending', 'sending')
          and c.send_after <= now()
          and (c.next_attempt_at is null or c.next_attempt_at <= now())
          -- SUPPRESSION IS CHECKED HERE, AT THE LAST POSSIBLE MOMENT, not
          -- when the audience was frozen. Somebody who unsubscribes while a
          -- campaign is halfway through its queue must not receive the rest
          -- of it, and an address an operator blocks by hand has to take
          -- effect on the very next batch.
          and ctc.marketing_consent = true
          and ctc.unsubscribed_at is null
          and not exists (
            select 1 from public.newsletter_suppressions s where s.email = c.email
          )
          -- A row claimed by an invocation that then died is re-claimable
          -- after five minutes; one claimed a second ago is not.
          and (c.claimed_at is null or c.claimed_at < now() - interval '5 minutes')
          and c.attempts < 5
          -- A paused or cancelled campaign hands out nothing. This is what
          -- makes "Wstrzymaj" take effect within one batch rather than at the
          -- end of the send.
          and k.status = 'sending'
        order by c.send_after, c.created_at
        limit v_limit
        for update skip locked
     )
    returning r.id, r.campaign_id, r.step_index, r.variant, r.contact_id,
              r.email, r.attempts, r.personalization
  )
  select c.id, c.campaign_id, c.step_index, c.variant, c.contact_id,
         c.email, c.attempts, c.personalization,
         ct.first_name, ct.locale, ct.unsubscribe_token
    from claimed c
    join public.newsletter_contacts ct on ct.id = c.contact_id
   order by c.id;
end $$;

revoke all on function public.newsletter_queue_claim(text, integer) from public, anon, authenticated;
grant execute on function public.newsletter_queue_claim(text, integer) to anon, authenticated;

create or replace function public.newsletter_queue_finish(
  p_token text,
  p_id uuid,
  p_status text,
  p_error text default null,
  p_message_id text default null,
  p_smtp_response text default null
) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_rec record;
begin
  if not public.server_call_ok(p_token) then return; end if;
  if p_status is null or p_status not in ('sent', 'failed', 'skipped') then return; end if;

  select id, campaign_id, step_index, variant, contact_id, attempts
    into v_rec from public.newsletter_recipients where id = p_id;
  if v_rec.id is null then return; end if;

  update public.newsletter_recipients
     -- A failure is an attempt, not a verdict: a 4xx greylist, a dropped
     -- connection and a timeout all arrive here. Below the ceiling the row
     -- goes back to pending with a backoff; the fifth failure stays failed,
     -- because the claim would refuse it anyway.
     set status = case
           when p_status = 'failed' and v_rec.attempts < 5 then 'pending'
           else p_status
         end,
         next_attempt_at = case
           when p_status = 'failed' and v_rec.attempts < 5
             then now() + (power(3, v_rec.attempts) * interval '1 minute')
           else null
         end,
         claimed_at = null,
         sent_at = case when p_status = 'sent' then now() else sent_at end,
         message_id = coalesce(left(nullif(btrim(coalesce(p_message_id, '')), ''), 250), message_id),
         smtp_response = left(nullif(btrim(coalesce(p_smtp_response, '')), ''), 300),
         last_error_safe = left(nullif(btrim(coalesce(p_error, '')), ''), 200)
   where id = p_id;

  if p_status = 'sent' then
    insert into public.newsletter_events
      (event_type, campaign_id, step_index, variant, contact_id, recipient_id)
    values ('sent', v_rec.campaign_id, v_rec.step_index, v_rec.variant, v_rec.contact_id, v_rec.id);
    update public.newsletter_contacts
       set last_sent_at = now(), last_activity_at = now()
     where id = v_rec.contact_id;
  elsif p_status = 'failed' and v_rec.attempts >= 5 then
    insert into public.newsletter_events
      (event_type, campaign_id, step_index, variant, contact_id, recipient_id)
    values ('failed', v_rec.campaign_id, v_rec.step_index, v_rec.variant, v_rec.contact_id, v_rec.id);
  end if;

  -- The campaign closes itself when its last row does. Doing it here means a
  -- campaign cannot be left saying "sending" forever because the invocation
  -- that would have closed it timed out.
  update public.newsletter_campaigns k
     set status = 'sent', finished_at = now()
   where k.id = v_rec.campaign_id
     and k.status = 'sending'
     and not exists (
       select 1 from public.newsletter_recipients r
        where r.campaign_id = k.id and r.status in ('pending', 'sending')
     );
end $$;

revoke all on function public.newsletter_queue_finish(text, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.newsletter_queue_finish(text, uuid, text, text, text, text)
  to anon, authenticated;

-- ── DUE CAMPAIGNS ──────────────────────────────────────────────────────────
-- Moves a scheduled campaign to 'sending' when its moment arrives. Separate
-- from the claim so the worker's first act is cheap and its second act is
-- bounded.
create or replace function public.newsletter_start_due(p_token text)
returns integer
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_count integer := 0;
begin
  if not public.server_call_ok(p_token) then return 0; end if;

  with started as (
    update public.newsletter_campaigns
       set status = 'sending', started_at = coalesce(started_at, now())
     where status = 'scheduled'
       and scheduled_at is not null
       and scheduled_at <= now()
       and exists (
         select 1 from public.newsletter_recipients r
          where r.campaign_id = newsletter_campaigns.id and r.status = 'pending'
       )
    returning id
  )
  select count(*) into v_count from started;
  return v_count;
end $$;

revoke all on function public.newsletter_start_due(text) from public, anon, authenticated;
grant execute on function public.newsletter_start_due(text) to anon, authenticated;
