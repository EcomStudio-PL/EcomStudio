-- 0144 — PRE-LAUNCH LANDING V2: a real double opt-in list, consent records
-- that say exactly what was ticked, first-touch attribution, referrals, and
-- the credits a confirmed signup (and its referrals) may earn once an account
-- exists — every promise behind an owner's approval switch.
--
-- THE CONTRACT IS lib/server/prelaunch/rpc.ts: every function below has the
-- name, argument names and reply keys its wrapper there parses. Nothing in the
-- app touches these tables directly; there is no service-role client.
--
-- WHAT IT ADDS
--
--  1. app_settings 'prelaunch' — the campaign values (launch date, X signup
--     credits, Y referral credits, referral cap, early-access hours, the
--     "standard" comparison figure, the price-lock switch, the master
--     rewards switch, DOI link lifetime, the global DOI mail cap per hour …),
--     each value behind its own `*_approved` flag. PRIVATE: added to
--     app_setting_is_private(), so no anon and no customer reads the row; the
--     page sees only prelaunch_public_config(), which returns APPROVED values
--     only. The SQL never trusts the row: prelaunch_config() is its only
--     parser, re-validates every value and treats anything out of range as
--     "not approved" (the raw settings editor must not be able to mint credits
--     by typing a big number).
--  2. prelaunch_signups — one row per ADDRESS (its own id; the newsletter
--     contact is linked, not the key), prelaunch_optin_tokens (hashed, single
--     use, expiring), prelaunch_consents (append-only; the exact sentence, its
--     version, and — on the terms row — which published versions of the two
--     legal documents it pointed at), prelaunch_reward_claims (the idempotency
--     key of every credit this file can grant).
--  3. newsletter_contact_sources gains first-touch attribution columns,
--     written once per (contact, 'waitlist') and never overwritten.
--  4. Newsletter group 'prelaunch' — membership is added ONLY at DOI, so the
--     confirmed list is selectable as a campaign audience.
--  5. One launch_gallery block per gallery key per page (unique index).
--  6. Functions, all SECURITY DEFINER with `search_path = public, extensions`
--     (pgcrypto lives in `extensions` on PROD — S3):
--       public, anon + authenticated:  prelaunch_public_config
--       server-token gated (anon + authenticated, server_call_ok first):
--         prelaunch_signup, prelaunch_resend, prelaunch_confirm,
--         prelaunch_set_channel, prelaunch_mail_payload, prelaunch_mark_sent
--       the signed-in customer's own grant (authenticated): prelaunch_reward_ensure
--       admin (authenticated, is_admin() first): prelaunch_forget_contact,
--         prelaunch_admin_summary, prelaunch_admin_contact
--     Helpers (config parser, code generator, canonical address, throttles)
--     are plain invoker functions granted to NOBODY: only the definers above
--     reach them.
--  7. waitlist_subscribe (0106) redefined with the identical signature and
--     body except ONE argument: it can no longer grant marketing consent
--     (p_consent := false). The double opt-in is the only door to consent.
--
-- WHAT IT DELIBERATELY DOES NOT DO
--
--  · No backfill. The legacy waitlist rows and the five legacy "consents"
--    (source 'waitlist', version 'v1') are left exactly as they are; a legacy
--    consent is replaced by the DOI evidence only when that person confirms.
--  · No contact is given a first name or a consent before proof of mailbox.
--    The contact itself IS created at submit (the admin's "Oczekujące"), but
--    bare: address, language, source.
--  · No foreign key on any of these tables carries an erasure action. Erasing
--    a contact goes through prelaunch_forget_contact() first (UPDATE-only
--    scrub that unlinks the signup); the admin action calls it, then removes
--    the contact as before.
--  · The wallet is touched ONLY through apply_credit_transaction, type
--    'bonus', never 'topup' (a topup with created_by set would count as paid
--    and unlock watermark-free images, 0143).
--  · newsletter_subscribe (the CMS newsletter form, single opt-in by design)
--    is unchanged — out of scope, reported as an open issue.
--
-- DEPLOY ORDER: this file first, on its own. It is dormant: nothing calls the
-- new functions until the V2 code ships, rewards_active is false and nothing
-- is approved. The waitlist_subscribe change only stops consent granting,
-- which is safe under the old code. Re-runnable: a second apply changes
-- nothing.
--
-- ROLLBACK: revert the code; this file then sits unused. Retiring its objects
-- is a separate, owner-approved migration (the statements that remove objects
-- are not allowed in this file by the PROD connector gate).

set local lock_timeout = '3s';

-- 1 ─────────────────────────────────────────────────────────────────────────
-- THE CAMPAIGN SETTINGS. Seeded dormant: nothing approved, rewards off.
-- survey_bonus_policy 'stack' documents the only policy implementable without
-- touching the welcome survey bonus (0061): the 150 is granted as before and
-- stacks with X. marketing_required and referral_requires_account default to
-- the brief's strict reading and are flagged for the owner/legal.
insert into public.app_settings (key, value) values ('prelaunch', jsonb_build_object(
  'v', 1,
  'launch_at', null, 'launch_at_approved', false,
  'signup_credits', null, 'signup_credits_approved', false,
  'referral_credits', null, 'referral_credits_approved', false,
  'referral_cap', 10,
  'early_access_hours', null, 'early_access_approved', false,
  'standard_credits', null, 'standard_credits_approved', false,
  'price_lock_approved', false,
  'rewards_active', false,
  'reward_claim_until', null,
  'optin_ttl_hours', 72,
  'optin_hourly_cap', 300,
  'marketing_required', true,
  'referral_requires_account', true,
  'survey_bonus_policy', 'stack',
  'campaign', 'prelaunch-2026'))
on conflict (key) do nothing;

-- 0143's six keys verbatim, plus this one.
create or replace function public.app_setting_is_private(p_key text)
returns boolean
language sql
immutable parallel safe
as $$
  select p_key in (
    'notifications',
    'login_security_dispatch',
    'auth_email_hook',
    'ai_background_presets',
    'thumbnail',
    'trial_watermark',
    'prelaunch'
  );
$$;

-- 2 ─────────────────────────────────────────────────────────────────────────
-- ONE ROW PER ADDRESS. Its own id, so tokens, consents, referrals and claims
-- survive the contact being erased (contact_id is then null and the address
-- scrubbed). The address is stored normalised; 'erased:<id>' is the only
-- other shape it can take.
create table if not exists public.prelaunch_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null
    constraint prelaunch_signups_email_shape check (
      email = lower(btrim(email))
      and length(email) <= 254
      and (email ~ '^[a-z0-9!#$%&''*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&''*+/=?^_`{|}~-]+)*@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
           or email ~ '^erased:[0-9a-f-]{36}$')),
  contact_id uuid unique references public.newsletter_contacts(id),
  status text not null default 'pending'
    constraint prelaunch_signups_status_check check (status in ('pending', 'confirmed')),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  -- 8 characters, no I, O, 0 or 1: readable aloud and from a screenshot.
  referral_code text not null unique
    constraint prelaunch_signups_code_shape check (referral_code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  -- From the submit that created the row; at the DOI click it becomes the
  -- referrer of the submission whose link was clicked (the token's), when that
  -- submission came through one — never changed after the confirmation.
  referred_by uuid references public.prelaunch_signups(id),
  -- Set at THIS row's confirmation when its referral counted for referred_by.
  referral_counted_at timestamptz,
  referral_rejected text
    constraint prelaunch_signups_rejected_check check (referral_rejected in (
      'self', 'same_network', 'cap', 'duplicate', 'existing_contact', 'existing_account', 'cluster')),
  -- lower, +tag stripped everywhere, dots stripped for Gmail (one mailbox).
  canonical_email text not null,
  -- Letters, space, apostrophe, hyphen; ≤ 40. Copied to the contact at DOI.
  first_name text constraint prelaunch_signups_first_name_len check (length(first_name) <= 40),
  -- Known before this signup existed (D7): a referral of an address we
  -- already had is not a new person brought in.
  prior_contact boolean not null default false,
  prior_account boolean not null default false,
  -- Keyed hashes (the app computes them; the raw IP never reaches the
  -- database). ip_hash = FIRST submit, last_ip_hash = latest touch.
  ip_hash text constraint prelaunch_signups_ip_len check (length(ip_hash) <= 128),
  last_ip_hash text constraint prelaunch_signups_last_ip_len check (length(last_ip_hash) <= 128),
  last_submit_at timestamptz,
  form_variant text constraint prelaunch_signups_form_check check (form_variant in ('hero', 'final')),
  seller_channel text constraint prelaunch_signups_channel_check
    check (seller_channel in ('allegro', 'amazon', 'own_store', 'multi')),
  -- sha256 of the post-submit answer handle; bound only when the signup was
  -- created by that submit (S7), valid 2 h.
  answer_hash text constraint prelaunch_signups_answer_len check (length(answer_hash) <= 128),
  answer_until timestamptz,
  last_sent_at timestamptz,
  sends_24h integer not null default 0,
  sends_window_at timestamptz,
  -- The latest consent set; a resend's token confirms this one.
  consent_set_id uuid,
  locale text not null default 'pl'
    constraint prelaunch_signups_locale_check check (locale in ('pl', 'en', 'de')),
  updated_at timestamptz not null default now()
);

create unique index if not exists prelaunch_signups_email_key on public.prelaunch_signups (lower(email));
create index if not exists prelaunch_signups_referred_by_idx on public.prelaunch_signups (referred_by);
create index if not exists prelaunch_signups_status_idx on public.prelaunch_signups (status);
create index if not exists prelaunch_signups_canonical_idx on public.prelaunch_signups (canonical_email);
create index if not exists prelaunch_signups_created_idx on public.prelaunch_signups (created_at desc);
create index if not exists prelaunch_signups_touch_idx on public.prelaunch_signups (last_ip_hash, last_submit_at);
create index if not exists prelaunch_signups_answer_idx on public.prelaunch_signups (answer_hash) where answer_hash is not null;

-- MORE CODES FOR ONE SIGNUP. A repeat submit of a known address cannot be
-- handed that address's own code (anyone may type it: a code-to-person oracle,
-- S7), yet the link it shows must still earn for that address. So it gets a
-- fresh alias: random like any code, never equal to the public one, resolving
-- to the same signup. At most 50 per signup; beyond that the route's unstored
-- decoy. Nothing personal in it.
create table if not exists public.prelaunch_referral_aliases (
  code text primary key
    constraint prelaunch_referral_aliases_code_shape check (code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  signup_id uuid not null references public.prelaunch_signups(id),
  created_at timestamptz not null default now()
);

create index if not exists prelaunch_referral_aliases_signup_idx on public.prelaunch_referral_aliases (signup_id);

-- A DOI link carries the raw token; only its sha256 is stored. Single use
-- (used_at), expiring (expires_at), and it says which consent set it confirms.
create table if not exists public.prelaunch_optin_tokens (
  id uuid primary key default gen_random_uuid(),
  signup_id uuid not null references public.prelaunch_signups(id),
  token_hash text not null unique
    constraint prelaunch_optin_tokens_hash_shape check (token_hash ~ '^[0-9a-f]{64}$'),
  consent_set uuid,
  origin text not null default 'signup'
    constraint prelaunch_optin_tokens_origin_check check (origin in ('signup', 'resend_email', 'resend_link')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  -- What happened to the mail (prelaunch_mark_sent, from the route's after()).
  sent_at timestamptz,
  send_failed_at timestamptz,
  ip_hash text constraint prelaunch_optin_tokens_ip_len check (length(ip_hash) <= 128),
  form_variant text constraint prelaunch_optin_tokens_form_check check (form_variant in ('hero', 'final')),
  locale text constraint prelaunch_optin_tokens_locale_check check (locale in ('pl', 'en', 'de')),
  -- What THIS submission said: its referrer (the ref link it came through)
  -- and its first name. The DOI click applies the clicked link's values, so a
  -- stranger who typed the address first decides neither (review S3/S8).
  referrer uuid references public.prelaunch_signups(id),
  first_name text constraint prelaunch_optin_tokens_first_name_len check (length(first_name) <= 40)
);

create index if not exists prelaunch_optin_tokens_signup_idx on public.prelaunch_optin_tokens (signup_id, created_at desc);
create index if not exists prelaunch_optin_tokens_ip_idx on public.prelaunch_optin_tokens (ip_hash, created_at);
create index if not exists prelaunch_optin_tokens_created_idx on public.prelaunch_optin_tokens (created_at);

-- APPEND-ONLY CONSENT RECORDS. Both rows of one submit share a consent_set;
-- the text is the exact sentence that was on screen (resolved by the server
-- from the published page, never sent by the browser), the version is
-- derived from it, and confirmed_at is stamped by the DOI click that
-- confirmed THAT submission.
create table if not exists public.prelaunch_consents (
  id uuid primary key default gen_random_uuid(),
  signup_id uuid not null references public.prelaunch_signups(id),
  consent_set uuid not null,
  consent_key text not null
    constraint prelaunch_consents_key_check check (consent_key in ('terms_privacy', 'marketing_email')),
  consent_version text not null
    constraint prelaunch_consents_version_len check (length(consent_version) between 1 and 64),
  consent_text text not null
    constraint prelaunch_consents_text_len check (length(consent_text) between 1 and 2000),
  -- Terms row only: {regulamin, polityka_prywatnosci} = published_at of the
  -- two CMS pages at submit time.
  doc_versions jsonb,
  locale text constraint prelaunch_consents_locale_check check (locale in ('pl', 'en', 'de')),
  form_variant text constraint prelaunch_consents_form_check check (form_variant in ('hero', 'final')),
  accepted_at timestamptz not null default now(),
  confirmed_at timestamptz,
  ip_hash text constraint prelaunch_consents_ip_len check (length(ip_hash) <= 128),
  constraint prelaunch_consents_one_per_set unique (consent_set, consent_key)
);

create index if not exists prelaunch_consents_signup_idx on public.prelaunch_consents (signup_id, accepted_at desc);

-- THE IDEMPOTENCY KEY OF EVERY CREDIT THIS FILE GRANTS. apply_credit_transaction
-- is atomic but not idempotent; these unique keys are what make a reload, a
-- double request or ten parallel renders pay once:
--   one claim per source signup and kind;
--   one SIGNUP claim per account (an account hopping between confirmed
--   addresses by changing its e-mail cannot collect twice — S2);
--   one SIGNUP claim per mailbox (plus-aliases and Gmail dots of one mailbox
--   cannot collect once per account).
-- The mailbox is kept as a sha256 of the canonical address, never the
-- address: the claim must outlive an erasure (or the erased person could
-- collect again) and must not keep the address (review S7).
-- user_id is the auth user, deliberately without a foreign key (a claim is a
-- ledger record and must not block or follow an account's removal).
create table if not exists public.prelaunch_reward_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  kind text not null constraint prelaunch_reward_claims_kind_check check (kind in ('signup', 'referral')),
  source_signup uuid not null references public.prelaunch_signups(id),
  mailbox_hash text constraint prelaunch_reward_claims_mailbox_shape check (mailbox_hash ~ '^[0-9a-f]{64}$'),
  amount integer not null default 0 constraint prelaunch_reward_claims_amount_check check (amount >= 0),
  credit_transaction_id uuid,
  campaign text not null,
  created_at timestamptz not null default now(),
  constraint prelaunch_reward_claims_one_per_source unique (kind, source_signup)
);

create unique index if not exists prelaunch_reward_claims_one_signup_per_user
  on public.prelaunch_reward_claims (user_id) where kind = 'signup';
create unique index if not exists prelaunch_reward_claims_one_signup_per_mailbox
  on public.prelaunch_reward_claims (mailbox_hash) where kind = 'signup';
create index if not exists prelaunch_reward_claims_user_idx on public.prelaunch_reward_claims (user_id);
create index if not exists prelaunch_reward_claims_created_idx on public.prelaunch_reward_claims (created_at);

-- RLS on all four; admins read, the customer reads their own claims, nobody
-- writes around the functions. Supabase grants every new table to anon and
-- authenticated by default, so the revoke is what makes "no access" true.
alter table public.prelaunch_signups enable row level security;
alter table public.prelaunch_optin_tokens enable row level security;
alter table public.prelaunch_consents enable row level security;
alter table public.prelaunch_reward_claims enable row level security;
alter table public.prelaunch_referral_aliases enable row level security;

revoke all on table public.prelaunch_signups, public.prelaunch_optin_tokens,
  public.prelaunch_consents, public.prelaunch_reward_claims, public.prelaunch_referral_aliases
  from public, anon, authenticated;
grant select on table public.prelaunch_signups, public.prelaunch_optin_tokens,
  public.prelaunch_consents, public.prelaunch_reward_claims to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = 'prelaunch_signups' and policyname = 'prelaunch_signups_admin_select') then
    create policy prelaunch_signups_admin_select on public.prelaunch_signups
      for select to authenticated using (public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = 'prelaunch_optin_tokens' and policyname = 'prelaunch_optin_tokens_admin_select') then
    create policy prelaunch_optin_tokens_admin_select on public.prelaunch_optin_tokens
      for select to authenticated using (public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = 'prelaunch_consents' and policyname = 'prelaunch_consents_admin_select') then
    create policy prelaunch_consents_admin_select on public.prelaunch_consents
      for select to authenticated using (public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = 'prelaunch_reward_claims' and policyname = 'prelaunch_reward_claims_admin_select') then
    create policy prelaunch_reward_claims_admin_select on public.prelaunch_reward_claims
      for select to authenticated using (public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = 'prelaunch_reward_claims' and policyname = 'prelaunch_reward_claims_owner_select') then
    create policy prelaunch_reward_claims_owner_select on public.prelaunch_reward_claims
      for select to authenticated using (user_id = auth.uid());
  end if;
end $$;

-- 3 ─────────────────────────────────────────────────────────────────────────
-- FIRST-TOUCH ATTRIBUTION per (contact, source). Written by prelaunch_signup
-- only where attributed_at is null: the first capture wins and nothing ever
-- overwrites it. The values come from the server's first-touch cookie, never
-- from the request body.
alter table public.newsletter_contact_sources
  add column if not exists utm_source text constraint ncs_utm_source_len check (length(utm_source) <= 120),
  add column if not exists utm_medium text constraint ncs_utm_medium_len check (length(utm_medium) <= 120),
  add column if not exists utm_campaign text constraint ncs_utm_campaign_len check (length(utm_campaign) <= 120),
  add column if not exists utm_content text constraint ncs_utm_content_len check (length(utm_content) <= 120),
  add column if not exists utm_term text constraint ncs_utm_term_len check (length(utm_term) <= 120),
  add column if not exists referrer_host text constraint ncs_referrer_host_len check (length(referrer_host) <= 255),
  add column if not exists landing_path text constraint ncs_landing_path_len check (length(landing_path) <= 255),
  add column if not exists form_variant text constraint ncs_form_variant_len check (length(form_variant) <= 16),
  add column if not exists attributed_at timestamptz;

-- 4 ─────────────────────────────────────────────────────────────────────────
-- THE CONFIRMED LIST AS AN AUDIENCE (D8). A static group; prelaunch_confirm
-- adds the contact through newsletter_upsert_contact's own group argument, so
-- membership exists only after proof of mailbox.
insert into public.newsletter_groups (key, name, description, is_dynamic) values
  ('prelaunch', 'Lista przedpremierowa (potwierdzona)',
   'Kontakty, które potwierdziły zapis na premierę linkiem z e-maila (double opt-in). Uzupełniana automatycznie.',
   false)
on conflict (key) do nothing;

-- 5 ─────────────────────────────────────────────────────────────────────────
-- One gallery block per key on a page: a duplicate, a template copy or two
-- concurrent first saves cannot make "which MINIATURKI is live" ambiguous.
create unique index if not exists cms_blocks_one_launch_gallery
  on public.cms_blocks (page_id, (content->>'gallery')) where type = 'launch_gallery';

-- 6 ─────────────────────────────────────────────────────────────────────────
-- HELPERS. Invoker functions, granted to nobody (section 10): they run with
-- the privileges of the definer that calls them and cannot be reached alone.

-- An integer setting: a JSON number, whole, inside [min, max] — else null.
create or replace function public.prelaunch_cfg_int(p_value jsonb, p_min integer, p_max integer)
returns integer
language plpgsql
immutable
set search_path = public, extensions
as $$
declare
  v numeric;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'number' then return null; end if;
  v := (p_value #>> '{}')::numeric;
  if v <> trunc(v) or v < p_min or v > p_max then return null; end if;
  return v::integer;
end $$;

-- An instant setting: an ISO-8601 string WITH an offset, else null. Never
-- raises — a malformed date must not take the landing page down with it.
create or replace function public.prelaunch_cfg_instant(p_value jsonb)
returns timestamptz
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v text;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'string' then return null; end if;
  v := btrim(p_value #>> '{}');
  if v !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$' then return null; end if;
  return v::timestamptz;
exception when others then
  return null;
end $$;

-- THE ONLY PARSER OF app_settings.prelaunch. Every value re-validated; an
-- unapproved or out-of-range value comes back null ("not approved"). The
-- amounts are returned only when approved AND positive.
create or replace function public.prelaunch_config()
returns jsonb
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  c jsonb;
  v_campaign text;
  v_yes constant jsonb := 'true'::jsonb;
begin
  select value into c from public.app_settings where key = 'prelaunch';
  if c is null or jsonb_typeof(c) <> 'object' then c := '{}'::jsonb; end if;
  v_campaign := case when jsonb_typeof(c->'campaign') = 'string' then btrim(c->>'campaign') end;
  if v_campaign is null or v_campaign !~ '^[a-z0-9][a-z0-9_.-]{0,63}$' then v_campaign := 'prelaunch-2026'; end if;
  return jsonb_build_object(
    'launch_at', case when c->'launch_at_approved' = v_yes then public.prelaunch_cfg_instant(c->'launch_at') end,
    'signup_credits', case when c->'signup_credits_approved' = v_yes
                           then nullif(public.prelaunch_cfg_int(c->'signup_credits', 0, 10000), 0) end,
    'referral_credits', case when c->'referral_credits_approved' = v_yes
                             then nullif(public.prelaunch_cfg_int(c->'referral_credits', 0, 10000), 0) end,
    -- Absent → the seeded 10; present but invalid → 0 (no referral counts).
    'referral_cap', case when c ? 'referral_cap'
                         then coalesce(public.prelaunch_cfg_int(c->'referral_cap', 0, 1000), 0) else 10 end,
    'early_access_hours', case when c->'early_access_approved' = v_yes
                               then public.prelaunch_cfg_int(c->'early_access_hours', 1, 720) end,
    'standard_credits', case when c->'standard_credits_approved' = v_yes
                             then nullif(public.prelaunch_cfg_int(c->'standard_credits', 0, 10000), 0) end,
    -- Booleans are true only when stored as JSON true; absent is false.
    'price_lock', coalesce(c->'price_lock_approved' = v_yes, false),
    'rewards_active', coalesce(c->'rewards_active' = v_yes, false),
    'reward_claim_until', public.prelaunch_cfg_instant(c->'reward_claim_until'),
    'optin_ttl_hours', coalesce(public.prelaunch_cfg_int(c->'optin_ttl_hours', 1, 336), 72),
    'optin_hourly_cap', coalesce(public.prelaunch_cfg_int(c->'optin_hourly_cap', 1, 100000), 300),
    -- Strict unless explicitly switched off by the owner.
    'marketing_required', coalesce(c->'marketing_required', v_yes) <> 'false'::jsonb,
    'referral_requires_account', coalesce(c->'referral_requires_account', v_yes) <> 'false'::jsonb,
    'campaign', v_campaign);
end $$;

-- The address as one mailbox: lower, +tag stripped for every domain, dots
-- stripped and googlemail folded into gmail.com for Gmail.
create or replace function public.prelaunch_canonical_email(p_email text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select case
    when position('@' in v) = 0 then v
    when split_part(v, '@', 2) in ('gmail.com', 'googlemail.com')
      then replace(split_part(split_part(v, '@', 1), '+', 1), '.', '') || '@gmail.com'
    else split_part(split_part(v, '@', 1), '+', 1) || '@' || split_part(v, '@', 2)
  end
  from (select lower(btrim(coalesce(p_email, ''))) as v) x;
$$;

-- 8 characters from 32 symbols: one random byte each, modulo 32 (256 is a
-- multiple of 32, so no bias). extensions.gen_random_bytes is pgcrypto's CSPRNG.
create or replace function public.prelaunch_new_code()
returns text
language plpgsql
volatile
set search_path = public, extensions
as $$
declare
  v_alpha constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_code text;
begin
  for attempt in 1..8 loop
    v_bytes := extensions.gen_random_bytes(8);
    v_code := '';
    for i in 0..7 loop
      v_code := v_code || substr(v_alpha, (get_byte(v_bytes, i) % 32) + 1, 1);
    end loop;
    -- One namespace for codes and aliases: a code resolves to one signup.
    if not exists (select 1 from public.prelaunch_signups where referral_code = v_code)
       and not exists (select 1 from public.prelaunch_referral_aliases where code = v_code) then
      return v_code;
    end if;
  end loop;
  raise exception 'prelaunch_code_space_exhausted';
end $$;

-- A STRICT ADDRESS (review S6): an RFC 5322 dot-atom local part and a domain of
-- LDH labels — no comments, quotes, commas, semicolons, colons or brackets.
-- The looser "anything around an @" let 'a(1)x@gmail.com' or 'y,x@gmail.com'
-- through, which the mailer re-parses into x@gmail.com: unlimited DOI mails
-- to one mailbox past every per-address limit. The address arrives lowercased.
-- lib/server/prelaunch/handles.ts cleanEmail holds the same pattern.
create or replace function public.prelaunch_email_ok(p_email text)
returns boolean
language sql
immutable
set search_path = public, extensions
as $$
  select coalesce(
    length(p_email) <= 254
    and p_email ~ '^[a-z0-9!#$%&''*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&''*+/=?^_`{|}~-]+)*@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$',
    false);
$$;

-- The signup a referral code names: its own code or one of its aliases.
create or replace function public.prelaunch_resolve_code(p_code text)
returns uuid
language sql
stable
set search_path = public, extensions
as $$
  select coalesce(
    (select id from public.prelaunch_signups where referral_code = p_code),
    (select signup_id from public.prelaunch_referral_aliases where code = p_code))
  where p_code ~ '^[A-HJ-NP-Z2-9]{8}$';
$$;

-- One mailbox as a claim stores it: sha256 of the canonical address.
create or replace function public.prelaunch_mailbox_hash(p_canonical text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(extensions.digest('grovbase-prelaunch-mailbox:' || p_canonical, 'sha256'), 'hex');
$$;

-- A first name, strictly: a letter, then letters, spaces, apostrophes or
-- hyphens, 40 at most (Latin letters incl. Polish and German diacritics, by
-- code point so it does not depend on the database locale). Anything else —
-- a URL, digits, markup, an arrow — is not a name and becomes null (S9).
create or replace function public.prelaunch_first_name(p_name text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select case
    when v ~ '^[A-Za-zÀ-ÖØ-öø-ɏ][A-Za-zÀ-ÖØ-öø-ɏ ''’-]{0,39}$'
      then v
  end
  from (select btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')) as v) x;
$$;

-- One string field of an object, control characters stripped, capped; null
-- for anything that is not a non-empty string.
create or replace function public.prelaunch_attr(p_obj jsonb, p_key text, p_max integer)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select case
    when jsonb_typeof(p_obj) = 'object' and jsonb_typeof(p_obj->p_key) = 'string'
      then nullif(left(btrim(regexp_replace(p_obj->>p_key, '[[:cntrl:]]', '', 'g')), p_max), '')
  end;
$$;

-- A consent object as the route sends it: {key, version, text}, both strings
-- non-blank, version ≤ 64, text ≤ 2000.
create or replace function public.prelaunch_consent_ok(p_item jsonb)
returns boolean
language sql
immutable
set search_path = public, extensions
as $$
  select coalesce(
    jsonb_typeof(p_item) = 'object'
    and jsonb_typeof(p_item->'version') = 'string'
    and jsonb_typeof(p_item->'text') = 'string'
    and length(btrim(p_item->>'version')) between 1 and 64
    and length(btrim(p_item->>'text')) between 1 and 2000, false);
$$;

-- THE DURABLE PER-NETWORK THROTTLE (S8), decided BEFORE any write: twenty
-- addresses touched, or twenty DOI mails issued, from one keyed IP hash in
-- the last hour. A null hash (no server secret) relies on the route's
-- in-memory limiter alone.
create or replace function public.prelaunch_ip_busy(p_ip_hash text)
returns boolean
language sql
stable
set search_path = public, extensions
as $$
  select p_ip_hash is not null and (
    (select count(*) from public.prelaunch_signups
      where last_ip_hash = p_ip_hash and last_submit_at > now() - interval '1 hour') >= 20
    or (select count(*) from public.prelaunch_optin_tokens
      where ip_hash = p_ip_hash and created_at > now() - interval '1 hour') >= 20);
$$;

-- WHY NO DOI MAIL MAY GO TO THIS (locked) SIGNUP NOW, or null when one may.
-- A hard suppression never gets a mail; the global hourly cap protects the
-- shared SMTP mailbox (auth mail rides on it too — S13); per address: one
-- mail a minute, five in a rolling 24 hours. The per-address limits and the
-- suppression are judged per MAILBOX too (review S6): x+1@, x+2@ and the
-- dotted Gmail spellings are separate rows but one inbox.
create or replace function public.prelaunch_send_block(p_row public.prelaunch_signups, p_cfg jsonb)
returns text
language plpgsql
stable
set search_path = public, extensions
as $$
begin
  if p_row.status <> 'pending' then return 'confirmed'; end if;
  if position('@' in p_row.email) = 0 then return 'erased'; end if;
  if exists (select 1 from public.newsletter_suppressions
              where (email = p_row.email or public.prelaunch_canonical_email(email) = p_row.canonical_email)
                and reason in ('bounced', 'complained', 'blocked')) then
    return 'suppressed';
  end if;
  if (select count(*) from public.prelaunch_optin_tokens where created_at > now() - interval '1 hour')
     >= coalesce((p_cfg->>'optin_hourly_cap')::integer, 300) then
    return 'global_cap';
  end if;
  if p_row.last_sent_at is not null and p_row.last_sent_at > now() - interval '60 seconds' then
    return 'too_soon';
  end if;
  if p_row.sends_window_at is not null and p_row.sends_window_at > now() - interval '24 hours'
     and p_row.sends_24h >= 5 then
    return 'daily_cap';
  end if;
  if exists (select 1 from public.prelaunch_optin_tokens t
               join public.prelaunch_signups s on s.id = t.signup_id
              where s.canonical_email = p_row.canonical_email
                and t.created_at > now() - interval '60 seconds') then
    return 'too_soon';
  end if;
  if (select count(*) from public.prelaunch_optin_tokens t
        join public.prelaunch_signups s on s.id = t.signup_id
       where s.canonical_email = p_row.canonical_email
         and t.created_at > now() - interval '24 hours') >= 5 then
    return 'daily_cap';
  end if;
  return null;
end $$;

-- Issue one DOI token and count it against the address's rolling window.
create or replace function public.prelaunch_issue_token(
  p_signup uuid, p_hash text, p_origin text, p_ip_hash text, p_consent_set uuid,
  p_form text, p_locale text, p_ttl_hours integer, p_referrer uuid, p_first_name text
) returns uuid
language plpgsql
volatile
set search_path = public, extensions
as $$
declare
  v_id uuid;
begin
  insert into public.prelaunch_optin_tokens
    (signup_id, token_hash, consent_set, origin, expires_at, ip_hash, form_variant, locale, referrer, first_name)
  values
    (p_signup, p_hash, p_consent_set, p_origin, now() + make_interval(hours => p_ttl_hours),
     p_ip_hash, p_form, p_locale, p_referrer, p_first_name)
  returning id into v_id;

  update public.prelaunch_signups set
    last_sent_at = now(),
    sends_24h = case when sends_window_at is null or sends_window_at <= now() - interval '24 hours'
                     then 1 else sends_24h + 1 end,
    sends_window_at = case when sends_window_at is null or sends_window_at <= now() - interval '24 hours'
                           then now() else sends_window_at end,
    updated_at = now()
  where id = p_signup;
  return v_id;
end $$;

-- 7 ─────────────────────────────────────────────────────────────────────────
-- WHAT A VISITOR MAY SEE: approved values only. The launch date only while it
-- is still ahead (D9); the standard comparison figure only when the owner
-- approved it (D2); early-access hours when approved (the page ignores them
-- while EARLY_ACCESS_SUPPORTED is false, lib/launch/campaign.ts).
create or replace function public.prelaunch_public_config()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v jsonb := public.prelaunch_config();
  v_at timestamptz := (v->>'launch_at')::timestamptz;
begin
  return jsonb_build_object(
    'launch_at', case when v_at > now()
                      then to_char(v_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') end,
    'signup_credits', v->'signup_credits',
    'referral_credits', v->'referral_credits',
    'early_access_hours', v->'early_access_hours',
    'standard_credits', v->'standard_credits',
    'price_lock', coalesce((v->>'price_lock')::boolean, false),
    'rewards_active', coalesce((v->>'rewards_active')::boolean, false),
    'optin_ttl_hours', (v->>'optin_ttl_hours')::integer);
end $$;

-- SUBMIT. Server-token gated. The order is the design's, and it matters:
--   validate (no write) → per-network throttle (no write) → lock an existing
--   signup row → contact (bare) → attribution (first write wins) → create the
--   signup row if there was none (a referral code and the answer handle only
--   for the creating call) → decide the DOI mail → consent set (only when a
--   mail is issued or the row was created; ≤ 5 sets per address per 24 h) →
--   token.
-- The reply is the same shape for every outcome; the route turns it into one
-- uniform answer. The answer handle is bound only when this call created the
-- signup (S7); the referral code is the row's own only then, a fresh alias of
-- it for a repeat submit, and none when nothing was stored (the route then
-- sends an unstored decoy).
create or replace function public.prelaunch_signup(
  p_token text,
  p_email text,
  p_first_name text default null,
  p_locale text default 'pl',
  p_form text default 'hero',
  p_consents jsonb default null,
  p_doc_versions jsonb default null,
  p_attr jsonb default null,
  p_ref_code text default null,
  p_ip_hash text default null,
  p_optin_hash text default null,
  p_answer_hash text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_locale text := lower(btrim(coalesce(p_locale, '')));
  v_form text := lower(btrim(coalesce(p_form, '')));
  v_first text := public.prelaunch_first_name(p_first_name);
  v_ip text := case when p_ip_hash ~ '^[0-9a-f]{64}$' then p_ip_hash end;
  v_answer text := case when p_answer_hash ~ '^[0-9a-f]{64}$' then p_answer_hash end;
  v_code text := upper(btrim(coalesce(p_ref_code, '')));
  v_cfg jsonb;
  v_item jsonb;
  v_terms jsonb;
  v_marketing jsonb;
  v_prior_contact boolean;
  v_prior_account boolean;
  v_contact uuid;
  v_referrer uuid;
  v_row public.prelaunch_signups;
  v_created boolean := false;
  v_block text;
  v_sets integer;
  v_set uuid;
  v_token uuid;
  v_alias text;
begin
  if not public.server_call_ok(p_token) then
    raise exception 'forbidden';
  end if;
  if not public.prelaunch_email_ok(v_email) then
    return jsonb_build_object('status', 'invalid');
  end if;
  -- Server-supplied; a malformed hash is a bug in the route, not a visitor.
  if coalesce(p_optin_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'bad_request';
  end if;
  if v_locale not in ('pl', 'en', 'de') then v_locale := 'pl'; end if;
  if v_form not in ('hero', 'final') then v_form := 'hero'; end if;
  v_cfg := public.prelaunch_config();

  -- The consent objects: terms_privacy always, marketing_email unless the
  -- owner made it optional; each at most once, nothing else.
  if p_consents is null or jsonb_typeof(p_consents) <> 'array' then
    return jsonb_build_object('status', 'consent_required');
  end if;
  if jsonb_array_length(p_consents) > 2 then
    return jsonb_build_object('status', 'consent_required');
  end if;
  for v_item in select value from jsonb_array_elements(p_consents) loop
    if not public.prelaunch_consent_ok(v_item) then
      return jsonb_build_object('status', 'consent_required');
    end if;
    if v_item->>'key' = 'terms_privacy' and v_terms is null then
      v_terms := v_item;
    elsif v_item->>'key' = 'marketing_email' and v_marketing is null then
      v_marketing := v_item;
    else
      return jsonb_build_object('status', 'consent_required');
    end if;
  end loop;
  if v_terms is null or (v_marketing is null and (v_cfg->>'marketing_required')::boolean) then
    return jsonb_build_object('status', 'consent_required');
  end if;

  -- BEFORE ANY WRITE: a network past its hourly budget gets the normal-
  -- looking answer and leaves no trace (S8).
  if public.prelaunch_ip_busy(v_ip) then
    return jsonb_build_object('status', 'pending', 'created', false, 'send', false, 'throttled', true,
      'token_id', null, 'signup_id', null, 'email', v_email, 'locale', v_locale, 'referral_code', null);
  end if;

  -- The existing signup row first: locks are always taken signup → contact
  -- (prelaunch_confirm does the same), so a submit and a DOI click of one
  -- address can never wait on each other in a circle.
  select * into v_row from public.prelaunch_signups where lower(email) = v_email for update;

  -- THE CONTACT, BARE: address, language, source — no name, no consent.
  -- Read the two "did we know this person" facts first (D7).
  v_prior_contact := exists (select 1 from public.newsletter_contacts where lower(email) = v_email);
  v_prior_account := exists (select 1 from auth.users where lower(email) = v_email);
  v_contact := public.newsletter_upsert_contact(
    p_email := v_email, p_source_key := 'waitlist', p_locale := v_locale);
  if v_contact is null then
    return jsonb_build_object('status', 'invalid');
  end if;

  update public.newsletter_contact_sources set
    utm_source = public.prelaunch_attr(p_attr, 'utm_source', 120),
    utm_medium = public.prelaunch_attr(p_attr, 'utm_medium', 120),
    utm_campaign = public.prelaunch_attr(p_attr, 'utm_campaign', 120),
    utm_content = public.prelaunch_attr(p_attr, 'utm_content', 120),
    utm_term = public.prelaunch_attr(p_attr, 'utm_term', 120),
    referrer_host = public.prelaunch_attr(p_attr, 'referrer_host', 255),
    landing_path = public.prelaunch_attr(p_attr, 'landing_path', 255),
    form_variant = v_form,
    attributed_at = now()
  where contact_id = v_contact and source_key = 'waitlist' and attributed_at is null;

  -- The referrer THIS submission came through (a code or an alias), never the
  -- address itself. Recorded on the row when it is created and on the token
  -- of every submission, so the clicked link decides (review S3).
  v_referrer := public.prelaunch_resolve_code(v_code);
  if v_referrer is not null and (v_referrer = v_row.id or exists (
       select 1 from public.prelaunch_signups where id = v_referrer and lower(email) = v_email)) then
    v_referrer := null;
  end if;

  if v_row.id is null then
    insert into public.prelaunch_signups (
      email, contact_id, referral_code, referred_by, canonical_email, first_name,
      prior_contact, prior_account, ip_hash, last_ip_hash, last_submit_at,
      form_variant, locale, answer_hash, answer_until
    ) values (
      v_email, v_contact, public.prelaunch_new_code(), v_referrer, public.prelaunch_canonical_email(v_email), v_first,
      v_prior_contact, v_prior_account, v_ip, v_ip, now(),
      v_form, v_locale, v_answer, case when v_answer is not null then now() + interval '2 hours' end
    )
    on conflict ((lower(email))) do nothing
    returning * into v_row;
    v_created := v_row.id is not null;
    if not v_created then
      -- A concurrent first submit of the same address won the insert.
      select * into v_row from public.prelaunch_signups where lower(email) = v_email for update;
    end if;
  end if;

  if not v_created then
    update public.prelaunch_signups set
      contact_id = coalesce(contact_id, v_contact),
      last_ip_hash = coalesce(v_ip, last_ip_hash),
      last_submit_at = now(),
      updated_at = now()
    where id = v_row.id;
  end if;

  v_block := public.prelaunch_send_block(v_row, v_cfg);

  -- The consents of THIS submission, recorded only when it is the one that
  -- created the row or the one a DOI mail is issued for (S8/S11).
  if v_block is null or v_created then
    select count(distinct consent_set) into v_sets from public.prelaunch_consents
      where signup_id = v_row.id and accepted_at > now() - interval '24 hours';
    if v_sets < 5 then
      v_set := gen_random_uuid();
      insert into public.prelaunch_consents
        (signup_id, consent_set, consent_key, consent_version, consent_text, doc_versions, locale, form_variant, ip_hash)
      values
        (v_row.id, v_set, 'terms_privacy', btrim(v_terms->>'version'), btrim(v_terms->>'text'),
         jsonb_build_object('regulamin', public.prelaunch_attr(p_doc_versions, 'regulamin', 64),
                            'polityka_prywatnosci', public.prelaunch_attr(p_doc_versions, 'polityka_prywatnosci', 64)),
         v_locale, v_form, v_ip);
      if v_marketing is not null then
        insert into public.prelaunch_consents
          (signup_id, consent_set, consent_key, consent_version, consent_text, locale, form_variant, ip_hash)
        values
          (v_row.id, v_set, 'marketing_email', btrim(v_marketing->>'version'), btrim(v_marketing->>'text'),
           v_locale, v_form, v_ip);
      end if;
      update public.prelaunch_signups set consent_set_id = v_set where id = v_row.id;
    end if;
  end if;

  if v_block is null then
    -- The mailed submission's name, language and referrer ride on its token;
    -- the DOI click applies the clicked link's (review S8). The row itself is
    -- never renamed by a later submit — anyone can type the address.
    v_token := public.prelaunch_issue_token(
      v_row.id, p_optin_hash, 'signup', v_ip, coalesce(v_set, v_row.consent_set_id),
      v_form, v_locale, (v_cfg->>'optin_ttl_hours')::integer,
      case when v_referrer = v_row.id then null else v_referrer end, v_first);
  end if;

  -- The code this answer may carry: the row's own when this call created it;
  -- otherwise a fresh alias of it (review S1), so the link shown after a
  -- repeat submit earns for the address while staying useless as an oracle —
  -- it never equals the public code and differs on every call.
  if v_created then
    v_alias := v_row.referral_code;
  elsif (select count(*) from public.prelaunch_referral_aliases where signup_id = v_row.id) < 50 then
    v_alias := public.prelaunch_new_code();
    insert into public.prelaunch_referral_aliases (code, signup_id) values (v_alias, v_row.id);
  end if;

  return jsonb_build_object(
    'status', v_row.status,
    'created', v_created,
    'send', v_token is not null,
    'throttled', coalesce(v_block in ('global_cap', 'too_soon', 'daily_cap'), false),
    'token_id', v_token,
    'signup_id', v_row.id,
    'email', v_email,
    'locale', v_locale,
    'referral_code', v_alias);
end $$;

-- RESEND. Exactly one of the address (the "send again" button) or the hash of
-- an old link (the expired-link page). Same throttles as a submit. Older
-- links stay valid until their own expiry. The address is returned ONLY so
-- the route can address the mail; the route never forwards it.
create or replace function public.prelaunch_resend(
  p_token text,
  p_email text default null,
  p_old_hash text default null,
  p_ip_hash text default null,
  p_optin_hash text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ip text := case when p_ip_hash ~ '^[0-9a-f]{64}$' then p_ip_hash end;
  v_cfg jsonb;
  v_row public.prelaunch_signups;
  v_src public.prelaunch_optin_tokens;
  v_origin text;
  v_token uuid;
begin
  if not public.server_call_ok(p_token) then
    raise exception 'forbidden';
  end if;
  if coalesce(p_optin_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'bad_request';
  end if;
  if (p_email is null) = (p_old_hash is null) or public.prelaunch_ip_busy(v_ip) then
    return jsonb_build_object('status', 'noop', 'send', false, 'token_id', null, 'email', null, 'locale', 'pl');
  end if;

  if p_email is not null then
    select * into v_row from public.prelaunch_signups
      where lower(email) = lower(btrim(p_email)) for update;
    v_origin := 'resend_email';
  elsif p_old_hash ~ '^[0-9a-f]{64}$' then
    select s.* into v_row from public.prelaunch_signups s
      join public.prelaunch_optin_tokens t on t.signup_id = s.id
      where t.token_hash = p_old_hash
      for update of s;
    v_origin := 'resend_link';
  end if;
  if v_row.id is null then
    return jsonb_build_object('status', 'noop', 'send', false, 'token_id', null, 'email', null, 'locale', 'pl');
  end if;

  if v_ip is not null then
    update public.prelaunch_signups set last_ip_hash = v_ip, last_submit_at = now() where id = v_row.id;
  end if;

  v_cfg := public.prelaunch_config();
  if public.prelaunch_send_block(v_row, v_cfg) is not null then
    return jsonb_build_object('status', 'noop', 'send', false, 'token_id', null, 'email', null, 'locale', v_row.locale);
  end if;

  -- A resend repeats a submission: the old link's (or the latest one's)
  -- referrer, name and language carry over to the new link.
  if p_old_hash is not null then
    select * into v_src from public.prelaunch_optin_tokens where token_hash = p_old_hash;
  else
    select * into v_src from public.prelaunch_optin_tokens
     where signup_id = v_row.id order by created_at desc, id limit 1;
  end if;

  v_token := public.prelaunch_issue_token(
    v_row.id, p_optin_hash, v_origin, v_ip, coalesce(v_src.consent_set, v_row.consent_set_id),
    v_row.form_variant, coalesce(v_src.locale, v_row.locale), (v_cfg->>'optin_ttl_hours')::integer,
    v_src.referrer, v_src.first_name);
  return jsonb_build_object('status', 'sent', 'send', true, 'token_id', v_token,
                            'email', v_row.email, 'locale', coalesce(v_src.locale, v_row.locale));
end $$;

-- CONFIRM (the DOI click). Locks, in this order (S6):
--   1. the token is CLAIMED by one conditional UPDATE (unused, unexpired) —
--      two concurrent clicks, or a scanner and a human, cannot both pass;
--   2. the signup row FOR UPDATE — two different links of one address
--      confirm it once (one `welcome`);
--   3. the referrer's row FOR UPDATE before counting — the duplicate and
--      cluster rules count under that lock (the cap is a payout rule).
-- Then: the submission's consent set is stamped; the contact gets the first
-- name, the DOI consent (the marketing row's version) and the 'prelaunch'
-- group; a legacy 'waitlist'/'v1' consent is replaced by this evidence (D3);
-- an 'unsubscribed' suppression is lifted through newsletter_resubscribe
-- (S16) while a hard one keeps consent off; the legacy waitlist row is
-- written as confirmed (D15). The e-mail comes back for the welcome mail,
-- server-side only (S12); 'already' carries the public fields only within 7
-- days of the link's expiry (S19).
create or replace function public.prelaunch_confirm(p_token text, p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tok public.prelaunch_optin_tokens;
  v_row public.prelaunch_signups;
  v_ref public.prelaunch_signups;
  v_cfg jsonb;
  v_version text;
  v_has_marketing boolean := false;
  v_reason text;
  v_consent boolean;
  v_contact uuid;
  v_unsub uuid;
  v_reject text;
  v_counted boolean := false;
  v_first text;
  v_locale text;
begin
  if not public.server_call_ok(p_token) then
    raise exception 'forbidden';
  end if;
  if coalesce(p_token_hash, '') !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'invalid');
  end if;

  update public.prelaunch_optin_tokens set used_at = now()
   where token_hash = p_token_hash and used_at is null and expires_at > now()
   returning * into v_tok;

  if v_tok.id is null then
    -- Not claimable: say why, without saying whose.
    select * into v_tok from public.prelaunch_optin_tokens where token_hash = p_token_hash;
    if v_tok.id is null then
      return jsonb_build_object('status', 'invalid');
    end if;
    select * into v_row from public.prelaunch_signups where id = v_tok.signup_id;
    if v_row.id is null or position('@' in v_row.email) = 0 then
      return jsonb_build_object('status', 'invalid');
    end if;
    if v_row.status = 'confirmed' then
      if now() < v_tok.expires_at + interval '7 days' then
        return jsonb_build_object('status', 'already', 'first_name', v_row.first_name,
                                  'locale', v_row.locale, 'referral_code', v_row.referral_code);
      end if;
      return jsonb_build_object('status', 'already');
    end if;
    if v_tok.used_at is null and v_tok.expires_at <= now() then
      return jsonb_build_object('status', 'expired');
    end if;
    return jsonb_build_object('status', 'invalid');
  end if;

  select * into v_row from public.prelaunch_signups where id = v_tok.signup_id for update;
  if v_row.id is null or position('@' in v_row.email) = 0 then
    return jsonb_build_object('status', 'invalid');
  end if;

  -- This click proves the mailbox for the submission the link was issued for.
  if v_tok.consent_set is not null then
    update public.prelaunch_consents set confirmed_at = now()
     where consent_set = v_tok.consent_set and signup_id = v_row.id and confirmed_at is null;
  end if;

  if v_row.status = 'confirmed' then
    return jsonb_build_object('status', 'already', 'first_name', v_row.first_name,
                              'locale', v_row.locale, 'referral_code', v_row.referral_code,
                              'referral_counted', false, 'welcome', false);
  end if;

  v_cfg := public.prelaunch_config();
  -- THE CLICKED SUBMISSION'S name, language and referrer (review S3/S8): the
  -- person proved the mailbox for that link, not for whatever another submit
  -- of the address said. A link without a referrer leaves the row's.
  v_first := v_tok.first_name;
  v_locale := coalesce(v_tok.locale, v_row.locale);
  if v_tok.referrer is not null and v_tok.referrer <> v_row.id
     and v_row.referral_counted_at is null and v_row.referral_rejected is null then
    v_row.referred_by := v_tok.referrer;
    update public.prelaunch_signups set referred_by = v_tok.referrer where id = v_row.id;
  end if;

  if v_tok.consent_set is not null then
    select consent_version into v_version from public.prelaunch_consents
     where consent_set = v_tok.consent_set and signup_id = v_row.id and consent_key = 'marketing_email';
    v_has_marketing := v_version is not null;
  end if;
  select reason into v_reason from public.newsletter_suppressions where email = v_row.email;
  v_consent := v_has_marketing and coalesce(v_reason, '') not in ('bounced', 'complained', 'blocked');

  v_contact := public.newsletter_upsert_contact(
    p_email := v_row.email,
    p_source_key := 'waitlist',
    p_first_name := v_first,
    p_locale := v_locale,
    p_consent := v_consent,
    p_consent_source := 'waitlist_doi',
    p_consent_version := case when v_consent then v_version end,
    p_group_keys := array['prelaunch']);

  if v_consent and v_contact is not null then
    -- D3: the old launch form recorded a terms tick as marketing consent
    -- ('waitlist' / 'v1'). "First yes wins" would keep that flawed record;
    -- this DOI is the real one, so it replaces exactly that shape.
    update public.newsletter_contacts set
      consent_at = now(), consent_source = 'waitlist_doi', consent_version = left(v_version, 40)
    where id = v_contact and marketing_consent
      and consent_source = 'waitlist' and consent_version = 'v1';
    -- S16: the person who unsubscribed has just proved the mailbox and ticked
    -- the marketing consent again — the same act the resubscribe link is.
    if v_reason = 'unsubscribed' then
      select unsubscribe_token into v_unsub from public.newsletter_contacts where id = v_contact;
      perform public.newsletter_resubscribe(v_unsub, v_version);
      update public.newsletter_contacts set consent_source = 'waitlist_doi' where id = v_contact;
    end if;
  end if;

  update public.prelaunch_signups set
    status = 'confirmed',
    confirmed_at = now(),
    contact_id = coalesce(contact_id, v_contact),
    first_name = v_first,
    locale = v_locale,
    updated_at = now()
  where id = v_row.id;

  -- The legacy list keeps holding only CONFIRMED V2 signups (D15). Never
  -- allowed to cost the confirmation.
  begin
    insert into public.waitlist_subscribers (email, source, locale, metadata, first_name, status, confirmed_at)
    values (v_row.email, coalesce(v_row.form_variant, 'hero'), v_locale, '{}'::jsonb,
            v_first, 'confirmed', now())
    on conflict (lower(email)) do update set
      status = 'confirmed',
      confirmed_at = coalesce(public.waitlist_subscribers.confirmed_at, now()),
      updated_at = now();
  exception when others then
    raise notice 'prelaunch: legacy waitlist mirror failed: %', sqlerrm;
  end;

  -- THE REFERRAL, decided once, at this confirmation, under the referrer's lock.
  if v_row.referred_by is not null and v_row.referral_counted_at is null and v_row.referral_rejected is null then
    select * into v_ref from public.prelaunch_signups where id = v_row.referred_by for update;
    if v_ref.id is not null then
      v_reject := case
        when v_ref.id = v_row.id or v_ref.canonical_email = v_row.canonical_email then 'self'
        when v_row.prior_account then 'existing_account'
        when v_row.prior_contact then 'existing_contact'
        when v_row.ip_hash is not null and v_row.ip_hash = v_ref.ip_hash then 'same_network'
        when exists (select 1 from public.prelaunch_signups o
                      where o.referred_by = v_ref.id and o.id <> v_row.id
                        and o.referral_counted_at is not null and o.canonical_email = v_row.canonical_email)
          then 'duplicate'
        -- At most two counted referrals of one referrer from one network.
        when v_row.ip_hash is not null and (select count(*) from public.prelaunch_signups o
                      where o.referred_by = v_ref.id and o.referral_counted_at is not null
                        and o.ip_hash = v_row.ip_hash) >= 2
          then 'cluster'
        -- No 'cap' here (review S2): the cap limits what is PAID
        -- (prelaunch_reward_ensure), not what is counted. Rejecting at the
        -- click filled the cap with referrals that never become payable
        -- (no account) and refused the payable ones after them for good.
      end;
      if v_reject is null then
        update public.prelaunch_signups set referral_counted_at = now() where id = v_row.id;
        v_counted := true;
      else
        update public.prelaunch_signups set referral_rejected = v_reject where id = v_row.id;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'status', 'confirmed',
    'email', v_row.email,
    'first_name', v_first,
    'locale', v_locale,
    'referral_code', v_row.referral_code,
    'referral_counted', v_counted,
    'welcome', true);
end $$;

-- "Gdzie sprzedajesz?" — by the answer handle of the submit that created the
-- signup; the FIRST answer wins (S7).
create or replace function public.prelaunch_set_channel(p_token text, p_answer_hash text, p_channel text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
  v_until timestamptz;
begin
  if not public.server_call_ok(p_token) then
    raise exception 'forbidden';
  end if;
  if coalesce(p_channel, '') not in ('allegro', 'amazon', 'own_store', 'multi')
     or coalesce(p_answer_hash, '') !~ '^[0-9a-f]{64}$' then
    return 'invalid';
  end if;
  select id, answer_until into v_id, v_until from public.prelaunch_signups where answer_hash = p_answer_hash;
  if v_id is null then return 'invalid'; end if;
  if v_until is null or v_until <= now() then return 'expired'; end if;
  update public.prelaunch_signups set seller_channel = p_channel, updated_at = now()
   where id = v_id and seller_channel is null;
  return 'ok';
end $$;

-- The SMTP payload for the DOI mail: waitlist_confirmation_payload's shape
-- WITHOUT its on/off switch — a double opt-in mail must always be sendable.
-- Null only when no mailbox is configured.
create or replace function public.prelaunch_mail_payload(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_cfg record;
begin
  if not (public.is_admin() or public.server_call_ok(p_token)) then
    raise exception 'forbidden';
  end if;
  select * into v_cfg from public.email_settings where id limit 1;
  if not found or coalesce(btrim(v_cfg.smtp_host), '') = '' then
    return null;
  end if;
  return jsonb_build_object(
    'from_name', v_cfg.from_name,
    'from_email', v_cfg.from_email,
    'reply_to', v_cfg.reply_to,
    'smtp', jsonb_build_object(
      'host', v_cfg.smtp_host,
      'port', v_cfg.smtp_port,
      'user', v_cfg.smtp_user,
      'encryption', v_cfg.smtp_encryption,
      'ciphertext', v_cfg.smtp_secret_ciphertext,
      'iv', v_cfg.smtp_secret_iv,
      'auth_tag', v_cfg.smtp_secret_auth_tag));
end $$;

-- What happened to the mail of one token, reported from the route's after():
-- the admin stats count mails SENT, not attempts (D12). First report wins.
create or replace function public.prelaunch_mark_sent(p_token text, p_token_id uuid, p_ok boolean)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.server_call_ok(p_token) then
    raise exception 'forbidden';
  end if;
  if coalesce(p_ok, false) then
    update public.prelaunch_optin_tokens set sent_at = coalesce(sent_at, now()) where id = p_token_id;
  else
    update public.prelaunch_optin_tokens set send_failed_at = coalesce(send_failed_at, now()) where id = p_token_id;
  end if;
  return found;
end $$;

-- 8 ─────────────────────────────────────────────────────────────────────────
-- ADMIN.

-- ERASURE WITHOUT REMOVING ROWS (S4). Unlinks the contact and scrubs every
-- personal value of its pre-launch rows: the address becomes 'erased:<id>',
-- the name, network hashes and answer handle go, unused links stop working,
-- and the legacy waitlist row of the address is scrubbed the same way. What
-- stays is what is not personal: dates, the referral graph, consent sentences
-- and their versions — and a reward claim's mailbox HASH (never the address),
-- kept so an erased person cannot collect the signup credits a second time.
-- The admin's contact erasure calls this first; the contact can then be
-- removed as before.
create or replace function public.prelaunch_forget_contact(p_contact uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r record;
  v_n integer := 0;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  -- Tokens before the signup row: the same lock order as prelaunch_confirm.
  for r in select id, email from public.prelaunch_signups where contact_id = p_contact loop
    update public.prelaunch_optin_tokens set ip_hash = null, first_name = null, used_at = coalesce(used_at, now())
     where signup_id = r.id;
    update public.prelaunch_consents set ip_hash = null where signup_id = r.id;
    update public.waitlist_subscribers set
      email = 'erased:' || id::text, first_name = null, last_name = null, phone = null,
      metadata = '{}'::jsonb, status = 'unsubscribed', updated_at = now()
     where lower(email) = r.email;
    update public.prelaunch_signups set
      contact_id = null,
      email = 'erased:' || id::text,
      canonical_email = 'erased:' || id::text,
      first_name = null,
      ip_hash = null,
      last_ip_hash = null,
      answer_hash = null,
      answer_until = null,
      updated_at = now()
     where id = r.id;
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'signups', v_n);
end $$;

-- THE ADMIN KPIs (D12): one SQL source of truth for Newsletter → Analityka.
-- Signup figures: signups created in [p_from, p_to). Mail figures: DOI tokens
-- created in the range. Rewards: claims created in the range. Arrays are
-- sorted by count, at most 20 rows. confirm_rate is confirmed / signups in
-- [0, 1] (4 decimals), null when there are no signups.
create or replace function public.prelaunch_admin_summary(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_signups integer;
  v_confirmed integer;
  v_pending integer;
  v_expired integer;
  v_counted integer;
  v_mail jsonb;
  v_by_form jsonb;
  v_by_source jsonb;
  v_by_host jsonb;
  v_by_channel jsonb;
  v_rejected jsonb;
  v_top jsonb;
  v_rewards jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  select count(*), count(*) filter (where status = 'confirmed'), count(*) filter (where status = 'pending'),
         count(*) filter (where referral_counted_at is not null)
    into v_signups, v_confirmed, v_pending, v_counted
    from public.prelaunch_signups where created_at >= p_from and created_at < p_to;

  -- Pending, and the newest link it was sent has run out.
  select count(*) into v_expired
    from public.prelaunch_signups s
   where s.created_at >= p_from and s.created_at < p_to and s.status = 'pending'
     and (select max(t.expires_at) from public.prelaunch_optin_tokens t where t.signup_id = s.id) <= now();

  select jsonb_build_object(
           'dois_sent', count(*) filter (where sent_at is not null),
           'resends', count(*) filter (where origin in ('resend_email', 'resend_link')),
           'send_failures', count(*) filter (where send_failed_at is not null and sent_at is null))
    into v_mail
    from public.prelaunch_optin_tokens where created_at >= p_from and created_at < p_to;

  select coalesce(jsonb_agg(x order by x.signups desc, x.form), '[]'::jsonb) into v_by_form from (
    select form_variant as form, count(*) as signups, count(*) filter (where status = 'confirmed') as confirmed
      from public.prelaunch_signups where created_at >= p_from and created_at < p_to
     group by form_variant order by 2 desc limit 20) x;

  select coalesce(jsonb_agg(x order by x.signups desc), '[]'::jsonb) into v_by_source from (
    select cs.utm_source, cs.utm_medium, cs.utm_campaign,
           count(*) as signups, count(*) filter (where s.status = 'confirmed') as confirmed
      from public.prelaunch_signups s
      left join public.newsletter_contact_sources cs on cs.contact_id = s.contact_id and cs.source_key = 'waitlist'
     where s.created_at >= p_from and s.created_at < p_to
     group by 1, 2, 3 order by 4 desc limit 20) x;

  select coalesce(jsonb_agg(x order by x.signups desc), '[]'::jsonb) into v_by_host from (
    select cs.referrer_host as host,
           count(*) as signups, count(*) filter (where s.status = 'confirmed') as confirmed
      from public.prelaunch_signups s
      left join public.newsletter_contact_sources cs on cs.contact_id = s.contact_id and cs.source_key = 'waitlist'
     where s.created_at >= p_from and s.created_at < p_to
     group by 1 order by 2 desc limit 20) x;

  select coalesce(jsonb_agg(x order by x.count desc, x.channel), '[]'::jsonb) into v_by_channel from (
    select seller_channel as channel, count(*) as count
      from public.prelaunch_signups
     where created_at >= p_from and created_at < p_to and seller_channel is not null
     group by 1 order by 2 desc limit 20) x;

  select coalesce(jsonb_agg(x order by x.count desc, x.reason), '[]'::jsonb) into v_rejected from (
    select referral_rejected as reason, count(*) as count
      from public.prelaunch_signups
     where created_at >= p_from and created_at < p_to and referral_rejected is not null
     group by 1 order by 2 desc limit 20) x;

  select coalesce(jsonb_agg(x order by x.counted desc, x.email), '[]'::jsonb) into v_top from (
    select r.id as signup_id, r.email, r.contact_id, count(*) as counted
      from public.prelaunch_signups s
      join public.prelaunch_signups r on r.id = s.referred_by
     where s.created_at >= p_from and s.created_at < p_to and s.referral_counted_at is not null
     group by r.id, r.email, r.contact_id order by 4 desc, 2 limit 20) x;

  select jsonb_build_object(
           'signup_claims', count(*) filter (where kind = 'signup'),
           'signup_credits', coalesce(sum(amount) filter (where kind = 'signup'), 0),
           'referral_claims', count(*) filter (where kind = 'referral'),
           'referral_credits', coalesce(sum(amount) filter (where kind = 'referral'), 0))
    into v_rewards
    from public.prelaunch_reward_claims where created_at >= p_from and created_at < p_to;

  return jsonb_build_object(
    'signups', v_signups,
    'confirmed', v_confirmed,
    'pending', v_pending,
    'expired', v_expired,
    'confirm_rate', case when v_signups > 0 then round(v_confirmed::numeric / v_signups, 4) end,
    'dois_sent', (v_mail->>'dois_sent')::integer,
    'resends', (v_mail->>'resends')::integer,
    'send_failures', (v_mail->>'send_failures')::integer,
    'by_form', v_by_form,
    'by_source', v_by_source,
    'by_referrer_host', v_by_host,
    'by_channel', v_by_channel,
    'referrals', jsonb_build_object('counted', v_counted, 'rejected', v_rejected, 'top', v_top),
    'rewards', v_rewards);
end $$;

-- One contact's pre-launch profile for the contact screen, or null.
create or replace function public.prelaunch_admin_contact(p_contact uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_row public.prelaunch_signups;
  v_referrer text;
  v_referrer_contact uuid;
  v_counted integer;
  v_attr jsonb;
  v_consents jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  select * into v_row from public.prelaunch_signups where contact_id = p_contact;
  if v_row.id is null then
    return null;
  end if;
  select email, contact_id into v_referrer, v_referrer_contact from public.prelaunch_signups where id = v_row.referred_by;
  select count(*) into v_counted from public.prelaunch_signups
   where referred_by = v_row.id and referral_counted_at is not null;
  select jsonb_build_object('utm_source', cs.utm_source, 'utm_medium', cs.utm_medium,
           'utm_campaign', cs.utm_campaign, 'utm_content', cs.utm_content, 'utm_term', cs.utm_term,
           'referrer_host', cs.referrer_host, 'landing_path', cs.landing_path)
    into v_attr
    from public.newsletter_contact_sources cs where cs.contact_id = p_contact and cs.source_key = 'waitlist';
  select coalesce(jsonb_agg(x order by x.accepted_at desc, x.consent_key), '[]'::jsonb) into v_consents from (
    select consent_key, consent_version, consent_text, locale, form_variant, accepted_at, confirmed_at, doc_versions
      from public.prelaunch_consents where signup_id = v_row.id
     order by accepted_at desc, consent_key limit 50) x;
  return jsonb_build_object(
    'signup', jsonb_build_object(
      'status', v_row.status,
      'created_at', v_row.created_at,
      'confirmed_at', v_row.confirmed_at,
      'form_variant', v_row.form_variant,
      'seller_channel', v_row.seller_channel,
      'referral_code', v_row.referral_code,
      'referred_by_email', v_referrer,
      'referred_by_contact_id', v_referrer_contact,
      'referrals_counted', v_counted,
      'referral_rejected', v_row.referral_rejected,
      'locale', v_row.locale,
      'attribution', coalesce(v_attr, jsonb_build_object(
        'utm_source', null, 'utm_medium', null, 'utm_campaign', null, 'utm_content', null,
        'utm_term', null, 'referrer_host', null, 'landing_path', null))),
    'consents', v_consents);
end $$;

-- 9 ─────────────────────────────────────────────────────────────────────────
-- THE CREDITS, lazily, for the signed-in customer's own account (auth.uid(),
-- no user argument — nothing to point at somebody else). Called on app
-- renders; cheap exits first; idempotent through the claim keys above.
--
--   · rewards_active, an unexpired claim window, a verified e-mail, an
--     account not blocked (account_blocked(): a timed block that ran out is
--     no block), a CONFIRMED signup for the account's current address;
--   · the wallet (claim_welcome_bonus's lookup) BEFORE any claim — an invited
--     member without a workspace gets {error:'no_wallet'} and no claim;
--   · one transaction-scoped advisory lock per user: parallel renders queue
--     instead of racing the referral cap, which is recounted every iteration;
--   · the contact is bound to the account (user_id) when free, and an
--     address whose contact belongs to ANOTHER account earns nothing;
--   · SIGNUP: X replaces the standard signup credits, it does not add to
--     them — delta = X minus every signup-like bonus the wallet already got
--     ('signup', 'bootstrap_recovery', 'prelaunch_signup'). Eligible when the
--     account was created after the signup (5 min grace) OR the wallet never
--     received a signup bonus (an account refused at birth, D6). The claim is
--     kept at amount 0 when the delta is 0 (raising X later does not top up).
--     The welcome survey bonus is untouched and stacks (survey_bonus_policy);
--   · REFERRAL: Y per counted referral, at most referral_cap claims per
--     account; with referral_requires_account the referred address must be a
--     verified, unblocked account other than this one (S15).
-- No exception handler anywhere near apply_credit_transaction: a failed grant
-- must roll its claim back with it, never leave a consumed claim behind.
create or replace function public.prelaunch_reward_ensure()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_cfg jsonb;
  v_x integer;
  v_y integer;
  v_cap integer;
  v_campaign text;
  v_until timestamptz;
  v_user record;
  v_own public.prelaunch_signups;
  v_wallet uuid;
  v_bound uuid;
  v_claim uuid;
  v_tx uuid;
  v_prior integer;
  v_delta integer;
  v_signup integer := 0;
  v_refs integer := 0;
  r record;
begin
  if v_uid is null then
    return jsonb_build_object('granted', 0, 'signup', 0, 'referrals', 0, 'error', 'unauthenticated');
  end if;
  v_cfg := public.prelaunch_config();
  if not (v_cfg->>'rewards_active')::boolean then
    return jsonb_build_object('granted', 0, 'signup', 0, 'referrals', 0, 'error', null);
  end if;
  v_until := (v_cfg->>'reward_claim_until')::timestamptz;
  if v_until is not null and now() > v_until then
    return jsonb_build_object('granted', 0, 'signup', 0, 'referrals', 0, 'error', 'closed');
  end if;
  v_x := (v_cfg->>'signup_credits')::integer;
  v_y := (v_cfg->>'referral_credits')::integer;
  v_cap := (v_cfg->>'referral_cap')::integer;
  v_campaign := v_cfg->>'campaign';
  if coalesce(v_x, 0) = 0 and (coalesce(v_y, 0) = 0 or v_cap = 0) then
    return jsonb_build_object('granted', 0, 'signup', 0, 'referrals', 0, 'error', null);
  end if;

  select id, email, email_confirmed_at, created_at into v_user from auth.users where id = v_uid;
  if v_user.id is null or v_user.email_confirmed_at is null then
    return jsonb_build_object('granted', 0, 'signup', 0, 'referrals', 0, 'error', 'unverified');
  end if;
  if public.account_blocked(v_uid) then
    return jsonb_build_object('granted', 0, 'signup', 0, 'referrals', 0, 'error', 'blocked');
  end if;

  select * into v_own from public.prelaunch_signups
   where lower(email) = lower(btrim(coalesce(v_user.email, ''))) and status = 'confirmed';
  if v_own.id is null then
    return jsonb_build_object('granted', 0, 'signup', 0, 'referrals', 0, 'error', 'no_signup');
  end if;

  select w.id into v_wallet
    from public.credit_wallets w
    join public.workspaces ws on ws.id = w.workspace_id
   where ws.owner_id = v_uid
   order by ws.created_at asc
   limit 1;
  if v_wallet is null then
    return jsonb_build_object('granted', 0, 'signup', 0, 'referrals', 0, 'error', 'no_wallet');
  end if;

  perform pg_advisory_xact_lock(hashtext('prelaunch_reward:' || v_uid::text));

  if v_own.contact_id is not null then
    select user_id into v_bound from public.newsletter_contacts where id = v_own.contact_id for update;
    if v_bound is not null and v_bound <> v_uid then
      return jsonb_build_object('granted', 0, 'signup', 0, 'referrals', 0, 'error', 'bound_elsewhere');
    end if;
    if v_bound is null and exists (select 1 from public.profiles where id = v_uid) then
      update public.newsletter_contacts set user_id = v_uid where id = v_own.contact_id;
    end if;
  end if;

  if coalesce(v_x, 0) > 0 and (
       v_user.created_at >= v_own.created_at - interval '5 minutes'
       or not exists (select 1 from public.credit_transactions
                       where wallet_id = v_wallet and type = 'bonus'
                         and metadata->>'source' in ('signup', 'bootstrap_recovery'))) then
    v_claim := null;
    insert into public.prelaunch_reward_claims (user_id, kind, source_signup, mailbox_hash, amount, campaign)
    values (v_uid, 'signup', v_own.id, public.prelaunch_mailbox_hash(v_own.canonical_email), 0, v_campaign)
    on conflict do nothing
    returning id into v_claim;
    if v_claim is not null then
      select coalesce(sum(amount), 0) into v_prior from public.credit_transactions
       where wallet_id = v_wallet and type = 'bonus'
         and metadata->>'source' in ('signup', 'bootstrap_recovery', 'prelaunch_signup');
      v_delta := greatest(0, v_x - v_prior);
      if v_delta > 0 then
        v_tx := public.apply_credit_transaction(
          v_wallet, v_delta, 'bonus'::public.credit_tx_type, 'Bonus premierowy', v_claim,
          jsonb_build_object('source', 'prelaunch_signup', 'campaign', v_campaign), v_uid);
        update public.prelaunch_reward_claims set amount = v_delta, credit_transaction_id = v_tx where id = v_claim;
        v_signup := v_delta;
      end if;
    end if;
  end if;

  if coalesce(v_y, 0) > 0 and v_cap > 0 then
    for r in select s.id, s.email from public.prelaunch_signups s
              where s.referred_by = v_own.id and s.referral_counted_at is not null
              order by s.referral_counted_at, s.id loop
      exit when (select count(*) from public.prelaunch_reward_claims
                  where user_id = v_uid and kind = 'referral') >= v_cap;
      if (v_cfg->>'referral_requires_account')::boolean and not exists (
            select 1 from auth.users u
             where lower(u.email) = r.email and u.email_confirmed_at is not null
               and u.id <> v_uid and not public.account_blocked(u.id)) then
        continue;
      end if;
      v_claim := null;
      insert into public.prelaunch_reward_claims (user_id, kind, source_signup, amount, campaign)
      values (v_uid, 'referral', r.id, v_y, v_campaign)
      on conflict do nothing
      returning id into v_claim;
      if v_claim is not null then
        v_tx := public.apply_credit_transaction(
          v_wallet, v_y, 'bonus'::public.credit_tx_type, 'Bonus za polecenie', v_claim,
          jsonb_build_object('source', 'prelaunch_referral', 'campaign', v_campaign), v_uid);
        update public.prelaunch_reward_claims set credit_transaction_id = v_tx where id = v_claim;
        v_refs := v_refs + v_y;
      end if;
    end loop;
  end if;

  return jsonb_build_object('granted', v_signup + v_refs, 'signup', v_signup, 'referrals', v_refs, 'error', null);
end $$;

-- 10 ────────────────────────────────────────────────────────────────────────
-- THE LEGACY DOOR CLOSES ON CONSENT (S1). waitlist_subscribe stays anon-
-- callable (the CMS newsletter form's forwarder still captures addresses
-- through /api/waitlist), but whatever `metadata.consent` says, it records the
-- contact WITHOUT marketing consent: the only way to consent to the pre-launch
-- list is the double opt-in (prelaunch_confirm). The body is 0106's except:
--   · `p_consent := false`, and no name reaches the contact (a name typed
--     with no proof of mailbox is a stranger's text — review S8);
--   · the strict address check (prelaunch_email_ok, review S6);
--   · ONE ANSWER for a new and a known address, and never a welcome mail
--     (review S5): waitlist_subscribers now mirrors the CONFIRMED pre-launch
--     list (D15), so 'exists' — reachable straight through PostgREST with the
--     public key — would say who confirmed; and a "you are on the list" mail
--     to whatever address was typed is exactly what the double opt-in
--     replaced. `confirmation` stays in the reply, always false, so the route
--     keeps its shape.
create or replace function public.waitlist_subscribe(
  p_email text,
  p_source text default 'landing'::text,
  p_locale text default 'pl'::text,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_source text := left(coalesce(nullif(btrim(p_source), ''), 'landing'), 40);
  v_locale text := left(coalesce(nullif(btrim(p_locale), ''), 'pl'), 8);
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_first text := nullif(left(btrim(coalesce(v_meta->>'first_name', '')), 80), '');
  v_last text := nullif(left(btrim(coalesce(v_meta->>'last_name', '')), 80), '');
  v_phone text := nullif(left(btrim(coalesce(v_meta->>'phone', '')), 32), '');
begin
  if not public.prelaunch_email_ok(v_email) then
    return jsonb_build_object('status', 'invalid');
  end if;

  insert into public.waitlist_subscribers (email, source, locale, metadata, first_name, last_name, phone)
  values (v_email, v_source, v_locale, v_meta, v_first, v_last, v_phone)
  on conflict (lower(email)) do nothing;

  -- THE NEWSLETTER LEARNS ABOUT EVERY SIGNUP, new or repeated (bare: no name,
  -- no consent), wrapped so a fault here can never cost the signup that
  -- already succeeded on the line above.
  begin
    perform public.newsletter_upsert_contact(
      p_email := v_email,
      p_source_key := 'waitlist',
      p_locale := left(v_locale, 2),
      p_consent := false,
      p_consent_source := 'waitlist',
      p_consent_version := coalesce(v_meta->>'consent_version', 'v1')
    );
  exception when others then
    raise notice 'newsletter contact upsert failed for waitlist signup: %', sqlerrm;
  end;

  return jsonb_build_object('status', 'created', 'confirmation', false);
end
$function$;

-- 11 ────────────────────────────────────────────────────────────────────────
-- GRANTS (S18). Every function: revoked from public, anon and authenticated,
-- then granted exactly. The token-gated ones are granted to anon on purpose:
-- the route's request runs as anon and EXECUTE is checked before the body's
-- server_call_ok() gate can run (the 0106 lesson). app_setting_is_private
-- keeps the ACL it had (RLS on app_settings evaluates it as anon).
revoke all on function public.prelaunch_cfg_int(jsonb, integer, integer) from public, anon, authenticated;
revoke all on function public.prelaunch_cfg_instant(jsonb) from public, anon, authenticated;
revoke all on function public.prelaunch_config() from public, anon, authenticated;
revoke all on function public.prelaunch_canonical_email(text) from public, anon, authenticated;
revoke all on function public.prelaunch_new_code() from public, anon, authenticated;
revoke all on function public.prelaunch_first_name(text) from public, anon, authenticated;
revoke all on function public.prelaunch_attr(jsonb, text, integer) from public, anon, authenticated;
revoke all on function public.prelaunch_consent_ok(jsonb) from public, anon, authenticated;
revoke all on function public.prelaunch_ip_busy(text) from public, anon, authenticated;
revoke all on function public.prelaunch_send_block(public.prelaunch_signups, jsonb) from public, anon, authenticated;
revoke all on function public.prelaunch_issue_token(uuid, text, text, text, uuid, text, text, integer, uuid, text)
  from public, anon, authenticated;
revoke all on function public.prelaunch_email_ok(text) from public, anon, authenticated;
revoke all on function public.prelaunch_resolve_code(text) from public, anon, authenticated;
revoke all on function public.prelaunch_mailbox_hash(text) from public, anon, authenticated;

revoke all on function public.prelaunch_public_config() from public, anon, authenticated;
grant execute on function public.prelaunch_public_config() to anon, authenticated;

revoke all on function public.prelaunch_signup(text, text, text, text, text, jsonb, jsonb, jsonb, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.prelaunch_signup(text, text, text, text, text, jsonb, jsonb, jsonb, text, text, text, text) to anon, authenticated;
revoke all on function public.prelaunch_resend(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.prelaunch_resend(text, text, text, text, text) to anon, authenticated;
revoke all on function public.prelaunch_confirm(text, text) from public, anon, authenticated;
grant execute on function public.prelaunch_confirm(text, text) to anon, authenticated;
revoke all on function public.prelaunch_set_channel(text, text, text) from public, anon, authenticated;
grant execute on function public.prelaunch_set_channel(text, text, text) to anon, authenticated;
revoke all on function public.prelaunch_mail_payload(text) from public, anon, authenticated;
grant execute on function public.prelaunch_mail_payload(text) to anon, authenticated;
revoke all on function public.prelaunch_mark_sent(text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.prelaunch_mark_sent(text, uuid, boolean) to anon, authenticated;

revoke all on function public.prelaunch_reward_ensure() from public, anon, authenticated;
grant execute on function public.prelaunch_reward_ensure() to authenticated;

revoke all on function public.prelaunch_forget_contact(uuid) from public, anon, authenticated;
grant execute on function public.prelaunch_forget_contact(uuid) to authenticated;
revoke all on function public.prelaunch_admin_summary(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.prelaunch_admin_summary(timestamptz, timestamptz) to authenticated;
revoke all on function public.prelaunch_admin_contact(uuid) from public, anon, authenticated;
grant execute on function public.prelaunch_admin_contact(uuid) to authenticated;

revoke all on function public.waitlist_subscribe(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.waitlist_subscribe(text, text, text, jsonb) to anon, authenticated;

comment on function public.prelaunch_public_config() is
  'The pre-launch campaign values a visitor may see: approved ones only (launch date only while ahead). Anon-callable.';
comment on function public.prelaunch_signup(text, text, text, text, text, jsonb, jsonb, jsonb, text, text, text, text) is
  'Pre-launch submit: bare contact, signup row, consent set, DOI token. Server-token gated; uniform reply.';
comment on function public.prelaunch_confirm(text, text) is
  'The DOI click: single-use token claim, consent, group, legacy-consent upgrade, referral decision. Server-token gated.';
comment on function public.prelaunch_reward_ensure() is
  'Lazy, idempotent pre-launch credits for the caller''s own verified account (type bonus, never topup).';
comment on function public.prelaunch_forget_contact(uuid) is
  'Admin erasure helper: unlinks and scrubs a contact''s pre-launch rows (UPDATE only) so the contact can be removed.';
comment on function public.waitlist_subscribe(text, text, text, jsonb) is
  'Joins the legacy waiting list. Anon-callable. Since 0144 it never grants marketing consent: the pre-launch double opt-in is the only door.';
