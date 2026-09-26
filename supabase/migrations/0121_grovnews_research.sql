-- ============================================================================
-- 0121 — GROVNEWS, STAGE 2: sources → research → posts → daily edition → mail
-- ============================================================================
--
-- EXTENDS STAGE 1 (0119/0120); REPLACES NOTHING. The posts, categories and
-- entitlements are used as they are. What is new:
--
--   grovnews_settings        one row: REVIEW/AUTOMATIC, the daily hour, the
--                            thresholds, how many topics an edition holds
--   grovnews_sources         where material comes from (RSS, Atom, public
--                            feeds, a page, an API adapter, manual entry)
--   grovnews_research_items  the inbox between a source and a post: a URL, a
--                            title, a short extract, the AI's own analysis.
--                            NEVER a copy of somebody else's article.
--   grovnews_editions        one daily edition per Warsaw date (UNIQUE)
--   grovnews_edition_posts   which posts an edition carries, in what order
--   grovnews_runs            the daily job's ledger: one DAILY row per date
--
-- ── WHO CAN DO WHAT ─────────────────────────────────────────────────────────
--
-- Every new table: an ADMIN, through RLS, and nobody else. A customer — with
-- or without GrovNews — reads, writes and triggers none of it. A subscriber
-- sees the day's edition only through `grovnews_current_edition()`, which
-- answers under the Stage 1 access rule and returns published posts only.
--
-- The unattended job has no user (the app has no service-role client, ADR
-- "Aplikacja nie ma klienta service-role"). It proves it is the server with
-- the dispatch token, checked by `server_call_ok()` inside SECURITY DEFINER
-- functions below — the pattern of 0094/0095/0108. Those functions are
-- granted to anon AND authenticated because Postgres checks EXECUTE before
-- the body runs; the token, not the role, is the gate (REV-M1/M2).
--
-- ── THE RULE THIS FILE ENFORCES BELOW THE APPLICATION ───────────────────────
--
-- FIRST THE POST IS PUBLISHED, ONLY THEN CAN A MAIL LINK TO IT.
--   · an edition cannot become READY / PUBLISHED / QUEUED / SENT unless every
--     post it carries is PUBLISHED and already live (trigger);
--   · while an edition that is not yet sent carries a post, that post cannot
--     be unpublished, archived, re-dated into the future or re-slugged, and a
--     post in a SENT edition keeps its slug, so the links in a mail that went
--     out keep working (trigger);
--   · an edition gets at most one campaign, ever (UNIQUE + immutable), and
--     cannot be marked SENT unless its campaign actually closed with at least
--     one message accepted — no "SENT" for a send of nothing.
--
-- ── MAIL GOES THROUGH THE EXISTING NEWSLETTER, NOT BESIDE IT ────────────────
--
-- There is no second mail system here. A digest is an ordinary
-- newsletter_campaigns row with one step, drained by the existing pg_cron tick
-- and worker (0095), which re-checks consent and suppression on EVERY batch.
-- The recipients are the dedicated newsletter group `grovnews`, whose members
-- are existing contacts linked to users holding an active entitlement — no
-- contact is created or duplicated, and a contact without marketing consent,
-- unsubscribed or suppressed is never queued. An entitlement is access to the
-- app; it is NOT consent to e-mail.
--
-- In REVIEW mode (the default) an admin builds the campaign through the
-- existing newsletter actions. Only AUTOMATIC mode, switched on by an admin,
-- uses `grovnews_edition_send()` — the one unattended door, which refuses to
-- run in REVIEW mode even with a valid token.
--
-- ── ONE CHANGE OUTSIDE GROVNEWS ─────────────────────────────────────────────
--
-- `provider_credential_read(text, uuid)` gains EXECUTE for anon. Its body
-- already refuses anything without the dispatch token (0077); only the grant
-- kept the sessionless daily job from reaching the admin's configured AI
-- provider. Same argument, same shape as 0079 (secret_read). No other
-- existing object is altered.

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. SETTINGS — one row
-- ═══════════════════════════════════════════════════════════════════════════
create table public.grovnews_settings (
  id              boolean primary key default true check (id),
  mode            text not null default 'REVIEW' check (mode in ('REVIEW', 'AUTOMATIC')),
  daily_enabled   boolean not null default false,
  run_hour        integer not null default 6 check (run_hour between 0 and 23),
  timezone        text not null default 'Europe/Warsaw' check (timezone = 'Europe/Warsaw'),
  min_relevance   integer not null default 60 check (min_relevance between 0 and 100),
  min_importance  integer not null default 60 check (min_importance between 0 and 100),
  max_topics      integer not null default 5 check (max_topics between 1 and 10),
  -- Law and tax are never published without a human by default. This lets an
  -- admin allow it for material from an OFFICIAL source only — never for a
  -- single unofficial one, and never for anything flagged for review.
  auto_publish_official_sensitive boolean not null default false,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users (id) on delete set null
);

insert into public.grovnews_settings (id) values (true);

create trigger grovnews_settings_touch before update on public.grovnews_settings
  for each row execute function public.touch_updated_at();

alter table public.grovnews_settings enable row level security;
create policy grovnews_settings_admin on public.grovnews_settings
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. SOURCES
-- ═══════════════════════════════════════════════════════════════════════════
create table public.grovnews_sources (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (length(btrim(name)) between 1 and 120),
  source_type      text not null
                   check (source_type in ('RSS', 'ATOM', 'PUBLIC_FEED', 'API', 'MANUAL', 'WEB_PAGE')),
  -- https only: the fetcher refuses anything else, so the table does too.
  url              text check (url is null or (url ~* '^https://' and length(url) <= 2000)),
  enabled          boolean not null default true,
  category_id      uuid references public.grovnews_categories (id) on delete set null,
  priority         integer not null default 50 check (priority between 0 and 100),
  official_source  boolean not null default false,
  language         text not null default 'pl' check (language in ('pl', 'en', 'de')),
  last_checked_at  timestamptz,
  last_success_at  timestamptz,
  last_error       text check (last_error is null or length(last_error) <= 300),
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- A fetchable source without a URL is a configuration nobody can act on.
  constraint grovnews_sources_url_needed check (source_type = 'MANUAL' or url is not null)
);

create unique index grovnews_sources_url_key on public.grovnews_sources (lower(url)) where url is not null;
create index grovnews_sources_enabled_idx on public.grovnews_sources (enabled, priority desc);

create trigger grovnews_sources_touch before update on public.grovnews_sources
  for each row execute function public.touch_updated_at();

alter table public.grovnews_sources enable row level security;
create policy grovnews_sources_admin on public.grovnews_sources
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. RESEARCH ITEMS — the inbox
-- ═══════════════════════════════════════════════════════════════════════════
--
-- What is kept is what verification needs and no more: the URL, the title,
-- a short extract (capped), the dates, a hash. The article itself stays on
-- its publisher's site. `ai_*` columns are GrovNews' own words.
create table public.grovnews_research_items (
  id                   uuid primary key default gen_random_uuid(),
  source_id            uuid references public.grovnews_sources (id) on delete set null,
  canonical_url        text not null check (canonical_url ~* '^https?://' and length(canonical_url) <= 2000),
  -- The dedupe key: lower-cased host, no fragment, no tracking parameters.
  normalized_url       text not null check (length(normalized_url) between 8 and 2000),
  source_title         text not null check (length(btrim(source_title)) between 1 and 500),
  source_excerpt       text not null default '' check (length(source_excerpt) <= 2000),
  source_published_at  timestamptz,
  discovered_at        timestamptz not null default now(),
  content_hash         text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  title_norm           text not null default '' check (length(title_norm) <= 500),
  category_id          uuid references public.grovnews_categories (id) on delete set null,
  relevance_score      integer check (relevance_score between 0 and 100),
  importance_score     integer check (importance_score between 0 and 100),
  status               text not null default 'NEW'
                       check (status in ('NEW', 'ANALYZED', 'SELECTED', 'REJECTED', 'USED', 'DUPLICATE')),
  ai_title             text check (ai_title is null or length(ai_title) <= 200),
  ai_summary           text check (ai_summary is null or length(ai_summary) <= 2000),
  ai_reason            text check (ai_reason is null or length(ai_reason) <= 1000),
  -- Law, tax, regulation or money: a higher bar before anything is published.
  sensitive            boolean not null default false,
  review_required      boolean not null default false,
  review_reason        text check (review_reason is null or length(review_reason) <= 300),
  duplicate_of         uuid references public.grovnews_research_items (id) on delete set null,
  post_id              uuid references public.grovnews_posts (id) on delete set null,
  selected_at          timestamptz,
  analyzed_at          timestamptz,
  analysis_attempts    integer not null default 0 check (analysis_attempts between 0 and 20),
  analysis_error       text check (analysis_error is null or length(analysis_error) <= 200),
  metadata             jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint grovnews_items_not_self_duplicate check (duplicate_of is null or duplicate_of <> id)
);

-- THE SAME URL IS ONE ITEM, however many times a job re-reads the feed.
create unique index grovnews_items_url_key on public.grovnews_research_items (normalized_url);
create index grovnews_items_status_idx on public.grovnews_research_items (status, discovered_at desc);
create index grovnews_items_hash_idx on public.grovnews_research_items (content_hash);
create index grovnews_items_source_idx on public.grovnews_research_items (source_id, discovered_at desc);
create index grovnews_items_duplicate_idx on public.grovnews_research_items (duplicate_of) where duplicate_of is not null;
create index grovnews_items_post_idx on public.grovnews_research_items (post_id) where post_id is not null;

create trigger grovnews_items_touch before update on public.grovnews_research_items
  for each row execute function public.touch_updated_at();

alter table public.grovnews_research_items enable row level security;
create policy grovnews_items_admin on public.grovnews_research_items
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. EDITIONS
-- ═══════════════════════════════════════════════════════════════════════════
create table public.grovnews_editions (
  id                 uuid primary key default gen_random_uuid(),
  -- ONE EDITION PER WARSAW DATE. A re-run job, a double click and a cron
  -- retry all meet this index and lose.
  edition_date       date not null unique,
  title              text not null check (length(btrim(title)) between 1 and 200),
  intro              text not null default '' check (length(intro) <= 1500),
  status             text not null default 'DRAFT'
                     check (status in ('DRAFT', 'READY', 'PUBLISHED', 'QUEUED', 'SENT', 'FAILED', 'ARCHIVED')),
  auto_generated     boolean not null default false,
  generated_at       timestamptz,
  published_at       timestamptz,
  email_subject      text check (email_subject is null or length(email_subject) between 1 and 200),
  email_preview      text check (email_preview is null or length(email_preview) <= 300),
  email_body         text check (email_body is null or length(email_body) <= 400000),
  email_prepared_at  timestamptz,
  -- At most one campaign per edition, ever: the second-send guard.
  campaign_id        uuid unique references public.newsletter_campaigns (id) on delete set null,
  queued_at          timestamptz,
  sent_at            timestamptz,
  email_recipients   integer check (email_recipients is null or email_recipients >= 0),
  failure_reason     text check (failure_reason is null or length(failure_reason) <= 200),
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint grovnews_editions_published_dated check (status in ('DRAFT', 'READY', 'ARCHIVED') or published_at is not null)
);

create index grovnews_editions_status_idx on public.grovnews_editions (status, edition_date desc);

create trigger grovnews_editions_touch before update on public.grovnews_editions
  for each row execute function public.touch_updated_at();

alter table public.grovnews_editions enable row level security;
create policy grovnews_editions_admin on public.grovnews_editions
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create table public.grovnews_edition_posts (
  edition_id   uuid not null references public.grovnews_editions (id) on delete cascade,
  post_id      uuid not null references public.grovnews_posts (id) on delete cascade,
  position     integer not null check (position between 1 and 50),
  featured     boolean not null default false,
  -- The post's 2–4 short paragraphs in the mail. GrovNews' own words, built
  -- from the PUBLISHED post, never from the source material directly.
  email_blurb  text check (email_blurb is null or length(email_blurb) <= 1500),
  created_at   timestamptz not null default now(),
  -- The same post twice in one edition is impossible, not merely unlikely.
  primary key (edition_id, post_id),
  constraint grovnews_edition_posts_position_key unique (edition_id, position) deferrable initially deferred
);

create index grovnews_edition_posts_post_idx on public.grovnews_edition_posts (post_id);

alter table public.grovnews_edition_posts enable row level security;
create policy grovnews_edition_posts_admin on public.grovnews_edition_posts
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ── 4.1 An edition moves forward only over published posts ────────────────
create function public.grovnews_editions_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_posts integer;
  v_unpublished integer;
begin
  -- An edition's campaign is set once. It may go back to NULL only because
  -- the campaign itself was deleted (the FK's ON DELETE SET NULL).
  if tg_op = 'UPDATE' and old.campaign_id is not null
     and new.campaign_id is not null and new.campaign_id <> old.campaign_id then
    raise exception 'grovnews_campaign_immutable' using errcode = '23514';
  end if;

  if new.status in ('READY', 'PUBLISHED', 'QUEUED', 'SENT')
     and (tg_op = 'INSERT' or new.status is distinct from old.status) then
    select count(*),
           count(*) filter (where p.status <> 'PUBLISHED' or p.published_at is null or p.published_at > now()
                                  or p.slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$')
      into v_posts, v_unpublished
      from public.grovnews_edition_posts ep
      join public.grovnews_posts p on p.id = ep.post_id
     where ep.edition_id = new.id;
    if v_posts = 0 then
      raise exception 'grovnews_edition_empty' using errcode = '23514';
    end if;
    if v_unpublished > 0 then
      raise exception 'grovnews_edition_unpublished_posts' using errcode = '23514';
    end if;
  end if;

  if new.status = 'QUEUED' and (tg_op = 'INSERT' or old.status is distinct from 'QUEUED') then
    -- The campaign must be live AND aimed at exactly the GrovNews group — an
    -- edition cannot be recorded as queued against some other mailing.
    if new.campaign_id is null or not exists (
      select 1 from public.newsletter_campaigns k
        join public.newsletter_groups g on g.key = 'grovnews' and not g.is_dynamic
       where k.id = new.campaign_id and k.status in ('scheduled', 'sending', 'sent')
         and k.audience->'include' = jsonb_build_array(g.id::text)
         and coalesce(jsonb_array_length(k.audience->'exclude'), 0) = 0
    ) then
      raise exception 'grovnews_edition_not_queued' using errcode = '23514';
    end if;
  end if;

  -- NO "SENT" FOR A SEND OF NOTHING: the campaign has closed AND at least one
  -- message was accepted by the mail server.
  if new.status = 'SENT' and (tg_op = 'INSERT' or old.status is distinct from 'SENT') then
    if new.campaign_id is null or not exists (
      select 1 from public.newsletter_campaigns k
       where k.id = new.campaign_id and k.status = 'sent'
    ) or not exists (
      select 1 from public.newsletter_recipients r
       where r.campaign_id = new.campaign_id and r.status = 'sent'
    ) then
      raise exception 'grovnews_edition_not_sent' using errcode = '23514';
    end if;
  end if;

  return new;
end $$;

revoke all on function public.grovnews_editions_guard() from public, anon, authenticated;

create trigger grovnews_editions_guard before insert or update on public.grovnews_editions
  for each row execute function public.grovnews_editions_guard();

-- ── 4.2 An edition's post list changes only while it is a draft ────────────
create function public.grovnews_edition_posts_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_edition uuid := case when tg_op = 'DELETE' then old.edition_id else new.edition_id end;
begin
  select e.status into v_status from public.grovnews_editions e where e.id = v_edition;
  -- The edition itself is being deleted (cascade): nothing left to protect.
  if v_status is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- The mail copy may be edited until the mail is queued; the list itself
  -- (which posts, in what order, which is featured) only in a draft.
  if tg_op = 'UPDATE'
     and new.edition_id = old.edition_id and new.post_id = old.post_id
     and new.position = old.position and new.featured = old.featured then
    if v_status in ('QUEUED', 'SENT', 'FAILED', 'ARCHIVED') then
      raise exception 'grovnews_edition_locked' using errcode = '23514';
    end if;
    return new;
  end if;

  if v_status <> 'DRAFT' then
    raise exception 'grovnews_edition_locked' using errcode = '23514';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

revoke all on function public.grovnews_edition_posts_guard() from public, anon, authenticated;

create trigger grovnews_edition_posts_guard before insert or update or delete on public.grovnews_edition_posts
  for each row execute function public.grovnews_edition_posts_guard();

-- ── 4.3 A post an edition relies on stays reachable ────────────────────────
create function public.grovnews_posts_edition_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Until the mail has gone: no unpublishing, no archiving, no moving into the
  -- future, no new slug.
  if (new.status is distinct from old.status
      or new.slug is distinct from old.slug
      or (new.published_at is distinct from old.published_at and (new.published_at is null or new.published_at > now())))
     and exists (
       select 1 from public.grovnews_edition_posts ep
         join public.grovnews_editions e on e.id = ep.edition_id
        where ep.post_id = old.id and e.status in ('READY', 'PUBLISHED', 'QUEUED')
     ) then
    raise exception 'grovnews_post_in_edition' using errcode = '23514';
  end if;

  -- After it has gone: the slug stays, so the links in the sent mail work.
  -- (Unpublishing stays possible — an editor must be able to take a post
  -- down — but not silently breaking every link by renaming it.)
  if new.slug is distinct from old.slug and exists (
       select 1 from public.grovnews_edition_posts ep
         join public.grovnews_editions e on e.id = ep.edition_id
        where ep.post_id = old.id and e.status = 'SENT'
     ) then
    raise exception 'grovnews_post_in_edition' using errcode = '23514';
  end if;

  return new;
end $$;

revoke all on function public.grovnews_posts_edition_lock() from public, anon, authenticated;

create trigger grovnews_posts_edition_lock before update on public.grovnews_posts
  for each row execute function public.grovnews_posts_edition_lock();

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. RUNS — the daily job's ledger
-- ═══════════════════════════════════════════════════════════════════════════
create table public.grovnews_runs (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null default 'DAILY' check (kind in ('DAILY')),
  run_date      date not null,
  status        text not null default 'RUNNING' check (status in ('RUNNING', 'DONE', 'FAILED')),
  stage         text not null default 'INGEST'
                check (stage in ('INGEST', 'ANALYZE', 'DRAFT', 'EDITION', 'SEND', 'DONE')),
  trigger       text not null default 'CRON' check (trigger in ('CRON', 'ADMIN')),
  invocations   integer not null default 0 check (invocations >= 0),
  -- A lease, not a lock: an invocation that dies releases it by expiring.
  locked_until  timestamptz,
  stats         jsonb not null default '{}'::jsonb check (jsonb_typeof(stats) = 'object'),
  error         text check (error is null or length(error) <= 300),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  updated_at    timestamptz not null default now()
);

-- ONE DAILY RUN PER WARSAW DATE.
create unique index grovnews_runs_daily_once on public.grovnews_runs (run_date) where kind = 'DAILY';

create trigger grovnews_runs_touch before update on public.grovnews_runs
  for each row execute function public.touch_updated_at();

alter table public.grovnews_runs enable row level security;
create policy grovnews_runs_admin on public.grovnews_runs
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. THE JOB'S DOORS — dispatch token or nothing
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 6.1 Which AI providers the admin switched on (ids and slugs only) ──────
-- `ai_providers` is readable only to a signed-in user; the daily job has none.
-- Credentials still go through provider_credential_read → readProviderKey,
-- exactly like every other model call — this returns no secret.
create function public.grovnews_ai_providers(p_token text)
returns table (id uuid, slug text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  return query
    select p.id, p.slug from public.ai_providers p
     where p.active and p.slug in ('openai', 'google');
end $$;

revoke all on function public.grovnews_ai_providers(text) from public, anon, authenticated;
grant execute on function public.grovnews_ai_providers(text) to anon, authenticated;

-- ── 6.2 Everything a run needs to start ────────────────────────────────────
create function public.grovnews_job_context(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'settings', (select to_jsonb(s) - 'id' - 'updated_by' from public.grovnews_settings s where s.id),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'name', s.name, 'type', s.source_type, 'url', s.url,
               'category_id', s.category_id, 'priority', s.priority,
               'official', s.official_source, 'language', s.language)
             order by s.priority desc, s.name)
        from public.grovnews_sources s where s.enabled), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'slug', c.slug, 'name', c.name) order by c.sort_order)
        from public.grovnews_categories c where c.is_active), '[]'::jsonb),
    -- Dedupe memory: what was found recently, as hashes and normalised titles.
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'hash', r.content_hash, 'title', r.title_norm))
        from (select i.id, i.content_hash, i.title_norm
                from public.grovnews_research_items i
               where i.discovered_at > now() - interval '14 days' and i.duplicate_of is null
               order by i.discovered_at desc
               limit 3000) r), '[]'::jsonb)
  );
end $$;

revoke all on function public.grovnews_job_context(text) from public, anon, authenticated;
grant execute on function public.grovnews_job_context(text) to anon, authenticated;

-- ── 6.3 Store what one source yielded ──────────────────────────────────────
--
-- Idempotent by construction: the same URL is skipped, the same content under
-- another URL is recorded as a DUPLICATE of the first (kept as a reference,
-- never a second story). Items older than a week are remembered — so the next
-- read does not treat them as new — but never analysed.
create function public.grovnews_ingest(
  p_token text,
  p_source_id uuid,
  p_ok boolean,
  p_error text,
  p_items jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.grovnews_sources%rowtype;
  v_item jsonb;
  v_dup uuid;
  v_status text;
  v_inserted integer := 0;
  v_duplicates integer := 0;
  v_skipped integer := 0;
  v_stale integer := 0;
  v_id uuid;
  v_new jsonb := '[]'::jsonb;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  select * into v_source from public.grovnews_sources where id = p_source_id;
  if not found then raise exception 'unknown_source'; end if;

  update public.grovnews_sources
     set last_checked_at = now(),
         last_success_at = case when p_ok then now() else last_success_at end,
         last_error = case when p_ok then null else left(coalesce(p_error, 'error'), 300) end
   where id = p_source_id;

  if not coalesce(p_ok, false) or p_items is null or jsonb_typeof(p_items) <> 'array' then
    return jsonb_build_object('inserted', 0, 'duplicates', 0, 'skipped', 0, 'stale', 0, 'items', '[]'::jsonb);
  end if;

  for v_item in select value from jsonb_array_elements(p_items) with ordinality e(value, n) where n <= 60 loop
    -- Shape checks: a malformed item is skipped, never half-stored.
    if coalesce(v_item->>'url', '') !~* '^https?://'
       or length(v_item->>'url') > 2000
       or length(coalesce(v_item->>'nurl', '')) not between 8 and 2000
       or length(btrim(coalesce(v_item->>'title', ''))) not between 1 and 500
       or coalesce(v_item->>'hash', '') !~ '^[0-9a-f]{64}$' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if exists (select 1 from public.grovnews_research_items i where i.normalized_url = v_item->>'nurl') then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- The caller's title-similarity verdict, if it names a real item…
    v_dup := null;
    if coalesce(v_item->>'duplicate_of', '') ~ '^[0-9a-f-]{36}$' then
      select i.id into v_dup from public.grovnews_research_items i where i.id = (v_item->>'duplicate_of')::uuid;
    end if;
    -- …and the database's own: identical content under another URL.
    if v_dup is null then
      select i.id into v_dup from public.grovnews_research_items i
       where i.content_hash = v_item->>'hash' and i.duplicate_of is null
       order by i.discovered_at limit 1;
    end if;

    v_status := case
      when v_dup is not null then 'DUPLICATE'
      when coalesce(v_item->>'stale', '') = 'true' then 'REJECTED'
      else 'NEW' end;

    -- One bad item (an unparseable date, say) is skipped on its own; it never
    -- takes the rest of the source's batch down with it.
    begin
      insert into public.grovnews_research_items (
        source_id, canonical_url, normalized_url, source_title, source_excerpt, source_published_at,
        content_hash, title_norm, category_id, status, duplicate_of, review_reason, metadata
      ) values (
        p_source_id, v_item->>'url', v_item->>'nurl', btrim(left(v_item->>'title', 500)),
        left(coalesce(v_item->>'excerpt', ''), 2000),
        case when coalesce(v_item->>'published_at', '') ~ '^\d{4}-\d{2}-\d{2}T' then (v_item->>'published_at')::timestamptz end,
        v_item->>'hash', left(coalesce(v_item->>'title_norm', ''), 500), v_source.category_id, v_status, v_dup,
        case when v_status = 'REJECTED' then 'stale' end,
        case when jsonb_typeof(v_item->'metadata') = 'object' then v_item->'metadata' else '{}'::jsonb end
      )
      on conflict (normalized_url) do nothing
      returning id into v_id;
    exception when others then
      v_id := null;
    end;

    if v_id is null then
      v_skipped := v_skipped + 1;
    elsif v_status = 'DUPLICATE' then
      v_duplicates := v_duplicates + 1;
    elsif v_status = 'REJECTED' then
      v_stale := v_stale + 1;
    else
      v_inserted := v_inserted + 1;
      -- Handed back so the same run can recognise this story when another
      -- source reports it a moment later.
      v_new := v_new || jsonb_build_array(jsonb_build_object(
        'id', v_id, 'hash', v_item->>'hash', 'title', left(coalesce(v_item->>'title_norm', ''), 500)));
    end if;
    v_id := null;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'duplicates', v_duplicates, 'skipped', v_skipped,
                            'stale', v_stale, 'items', v_new);
end $$;

revoke all on function public.grovnews_ingest(text, uuid, boolean, text, jsonb) from public, anon, authenticated;
grant execute on function public.grovnews_ingest(text, uuid, boolean, text, jsonb) to anon, authenticated;

-- ── 6.4 The next items to analyse, or to write up ──────────────────────────
create function public.grovnews_work_items(p_token text, p_kind text, p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 50));
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;

  if p_kind = 'analyze' then
    -- A story nobody got to in three days is no longer news. It leaves the
    -- queue as REJECTED rather than costing a model call.
    update public.grovnews_research_items
       set status = 'REJECTED', review_reason = coalesce(review_reason, 'expired')
     where status = 'NEW' and discovered_at < now() - interval '3 days';

    return coalesce((
      select jsonb_agg(to_jsonb(q)) from (
        select i.id, i.canonical_url as url, i.source_title as title, i.source_excerpt as excerpt,
               i.source_published_at as published_at,
               coalesce(s.name, '') as source_name, coalesce(s.official_source, false) as official,
               coalesce(s.priority, 50) as priority, c.slug as category
          from public.grovnews_research_items i
          left join public.grovnews_sources s on s.id = i.source_id
          left join public.grovnews_categories c on c.id = i.category_id
         where i.status = 'NEW' and i.analysis_attempts < 3
         order by coalesce(s.official_source, false) desc, coalesce(s.priority, 50) desc,
                  i.source_published_at desc nulls last, i.discovered_at desc
         limit v_limit) q), '[]'::jsonb);
  elsif p_kind = 'draft' then
    return coalesce((
      select jsonb_agg(to_jsonb(q)) from (
        select i.id, i.canonical_url as url, i.source_title as title, i.source_excerpt as excerpt,
               i.source_published_at as published_at, i.ai_title, i.ai_summary, i.ai_reason,
               i.category_id, i.relevance_score, i.importance_score, i.sensitive, i.review_required,
               coalesce(s.name, '') as source_name, coalesce(s.official_source, false) as official,
               coalesce(s.language, 'pl') as language,
               -- Every other place the same story was found: extra references.
               coalesce((select jsonb_agg(jsonb_build_object(
                          'url', d.canonical_url, 'title', d.source_title,
                          'source', coalesce(ds.name, ''), 'official', coalesce(ds.official_source, false)))
                          from public.grovnews_research_items d
                          left join public.grovnews_sources ds on ds.id = d.source_id
                         where d.duplicate_of = i.id), '[]'::jsonb) as related
          from public.grovnews_research_items i
          left join public.grovnews_sources s on s.id = i.source_id
         where i.status = 'SELECTED' and i.post_id is null
         order by i.importance_score desc nulls last, i.relevance_score desc nulls last
         limit v_limit) q), '[]'::jsonb);
  end if;
  raise exception 'invalid_kind';
end $$;

revoke all on function public.grovnews_work_items(text, text, integer) from public, anon, authenticated;
grant execute on function public.grovnews_work_items(text, text, integer) to anon, authenticated;

-- ── 6.5 Store one analysis ─────────────────────────────────────────────────
--
-- Only an item still waiting (NEW) is written: an admin who rejected or
-- selected it in the meantime keeps their decision. A failed call is counted
-- and nothing else changes — a model that did not answer never publishes
-- anything, and after three failures the item waits for a human.
create function public.grovnews_save_analysis(p_token text, p_item_id uuid, p_result jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cat uuid;
  v_dup uuid;
  v_rel integer;
  v_imp integer;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if p_result is null or jsonb_typeof(p_result) <> 'object' then raise exception 'invalid_result'; end if;

  if not coalesce((p_result->>'ok')::boolean, false) then
    update public.grovnews_research_items
       set analysis_attempts = least(analysis_attempts + 1, 20),
           analysis_error = left(coalesce(p_result->>'error', 'error'), 200)
     where id = p_item_id and status = 'NEW';
    return case when found then 'failed' else 'skipped' end;
  end if;

  v_rel := greatest(0, least(100, coalesce((p_result->>'relevance')::numeric, 0)::integer));
  v_imp := greatest(0, least(100, coalesce((p_result->>'importance')::numeric, 0)::integer));

  select c.id into v_cat from public.grovnews_categories c
   where c.slug = p_result->>'category' and c.is_active;

  if coalesce(p_result->>'duplicate_of', '') ~ '^[0-9a-f-]{36}$' then
    select i.id into v_dup from public.grovnews_research_items i
     where i.id = (p_result->>'duplicate_of')::uuid and i.id <> p_item_id and i.duplicate_of is null;
  end if;

  update public.grovnews_research_items
     set status = case when v_dup is not null then 'DUPLICATE' else 'ANALYZED' end,
         duplicate_of = v_dup,
         category_id = coalesce(v_cat, category_id),
         relevance_score = v_rel,
         importance_score = v_imp,
         ai_title = nullif(left(btrim(coalesce(p_result->>'title', '')), 200), ''),
         ai_summary = nullif(left(btrim(coalesce(p_result->>'summary', '')), 2000), ''),
         ai_reason = nullif(left(btrim(coalesce(p_result->>'reason', '')), 1000), ''),
         sensitive = coalesce((p_result->>'sensitive')::boolean, false),
         review_required = coalesce((p_result->>'review_required')::boolean, false),
         review_reason = nullif(left(btrim(coalesce(p_result->>'review_reason', '')), 300), ''),
         analyzed_at = now(),
         analysis_error = null
   where id = p_item_id and status = 'NEW';
  return case when found then 'saved' else 'skipped' end;
end $$;

revoke all on function public.grovnews_save_analysis(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.grovnews_save_analysis(text, uuid, jsonb) to anon, authenticated;

-- ── 6.6 Pick the day's topics ──────────────────────────────────────────────
--
-- The best-scoring analysed items above both thresholds, up to the daily cap
-- minus what was already picked today (Warsaw). Repeating it picks nothing
-- twice.
create function public.grovnews_select_top(p_token text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.grovnews_settings%rowtype;
  v_today date := (now() at time zone 'Europe/Warsaw')::date;
  v_taken integer;
  v_room integer;
  v_count integer;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  select * into v_settings from public.grovnews_settings where id;

  select count(*) into v_taken from public.grovnews_research_items
   where selected_at is not null and (selected_at at time zone 'Europe/Warsaw')::date = v_today;
  v_room := greatest(0, v_settings.max_topics - v_taken);
  if v_room = 0 then return 0; end if;

  with pick as (
    select i.id from public.grovnews_research_items i
     where i.status = 'ANALYZED'
       and i.discovered_at > now() - interval '36 hours'
       and coalesce(i.relevance_score, 0) >= v_settings.min_relevance
       and coalesce(i.importance_score, 0) >= v_settings.min_importance
     order by i.importance_score desc, i.relevance_score desc, i.discovered_at desc
     limit v_room
     for update skip locked
  )
  update public.grovnews_research_items i
     set status = 'SELECTED', selected_at = now()
    from pick where i.id = pick.id;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.grovnews_select_top(text) from public, anon, authenticated;
grant execute on function public.grovnews_select_top(text) to anon, authenticated;

-- ── 6.7 Turn one selected item into a post ─────────────────────────────────
--
-- ONE ITEM, ONE POST: the item row is locked and a second call returns the
-- first call's post. Whether the post is published right away is decided
-- HERE, from the stored settings and the stored analysis — the caller's
-- `p_publish` is a request, not a permission. REVIEW mode, anything flagged
-- for review, anything below the thresholds, anything resting on a single
-- unofficial source, and law/tax without an official source of its own (and
-- the admin's explicit consent) always stays a DRAFT.
create function public.grovnews_create_post(p_token text, p_item_id uuid, p_post jsonb, p_publish boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.grovnews_research_items%rowtype;
  v_settings public.grovnews_settings%rowtype;
  v_official boolean;
  v_corroborated boolean;
  v_cat_slug text;
  v_sensitive boolean;
  v_publish boolean;
  v_slug text;
  v_title text := btrim(coalesce(p_post->>'title', ''));
  v_excerpt text := btrim(coalesce(p_post->>'excerpt', ''));
  v_content text := coalesce(p_post->>'content', '');
  v_category uuid;
  v_minutes integer;
  v_tags text[];
  v_post uuid;
  v_status text;
  v_existing jsonb;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;

  select * into v_item from public.grovnews_research_items where id = p_item_id for update;
  if not found then raise exception 'unknown_item'; end if;
  if v_item.post_id is not null then
    select jsonb_build_object('post_id', p.id, 'slug', p.slug, 'status', p.status, 'created', false)
      into v_existing from public.grovnews_posts p where p.id = v_item.post_id;
    if v_existing is not null then return v_existing; end if;
  end if;
  if v_item.status <> 'SELECTED' then raise exception 'item_not_selected'; end if;

  if length(v_title) not between 1 and 200 or length(v_excerpt) > 600 or length(v_content) > 200000
     or length(btrim(v_content)) = 0 or jsonb_typeof(coalesce(p_post->'sources', 'null'::jsonb)) <> 'array' then
    raise exception 'invalid_post';
  end if;

  v_slug := lower(coalesce(p_post->>'slug', ''));
  if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(v_slug) > 110 then raise exception 'invalid_slug'; end if;
  while exists (select 1 from public.grovnews_posts p where p.slug = v_slug) loop
    v_slug := left(regexp_replace(v_slug, '-[0-9a-f]{6}$', ''), 110) || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 6);
  end loop;

  select c.id into v_category from public.grovnews_categories c where c.id = v_item.category_id;
  v_minutes := greatest(1, least(240, coalesce((p_post->>'read_minutes')::integer, 1)));
  select coalesce(array_agg(left(lower(btrim(t)), 40)) filter (where btrim(t) <> ''), '{}')
    into v_tags from (select jsonb_array_elements_text(coalesce(p_post->'tags', '[]'::jsonb)) t limit 20) x;

  select * into v_settings from public.grovnews_settings where id;
  -- OFFICIAL means the item's OWN source: the post is written from this item's
  -- material, so a duplicate from an official site must not lend it authority.
  select coalesce(s.official_source, false) into v_official from public.grovnews_sources s where s.id = v_item.source_id;
  v_official := coalesce(v_official, false);
  -- Corroborated: the same story was also found at a DIFFERENT source.
  v_corroborated := exists (select 1 from public.grovnews_research_items d
                             where d.duplicate_of = v_item.id and d.source_id is distinct from v_item.source_id
                               and d.source_id is not null);
  select c.slug into v_cat_slug from public.grovnews_categories c where c.id = v_item.category_id;
  v_sensitive := v_item.sensitive or coalesce(v_cat_slug in ('prawo', 'podatki'), false);

  v_publish := coalesce(p_publish, false)
    and v_settings.mode = 'AUTOMATIC'
    and not v_item.review_required
    and coalesce(v_item.relevance_score, 0) >= v_settings.min_relevance
    and coalesce(v_item.importance_score, 0) >= v_settings.min_importance
    -- ONE UNOFFICIAL SOURCE ALWAYS NEEDS A HUMAN.
    and (v_official or v_corroborated)
    and (not v_sensitive or (v_official and v_settings.auto_publish_official_sensitive));

  insert into public.grovnews_posts (
    slug, title, excerpt, content, category_id, tags, sources, estimated_read_minutes,
    language, status, published_at, created_by
  ) values (
    v_slug, v_title, v_excerpt, v_content, v_category, v_tags, p_post->'sources', v_minutes,
    case when p_post->>'language' in ('pl', 'en', 'de') then p_post->>'language' else 'pl' end,
    case when v_publish then 'PUBLISHED' else 'DRAFT' end,
    case when v_publish then now() end,
    null
  ) returning id, status into v_post, v_status;

  update public.grovnews_research_items set post_id = v_post, status = 'USED' where id = v_item.id;

  return jsonb_build_object('post_id', v_post, 'slug', v_slug, 'status', v_status, 'created', true);
end $$;

revoke all on function public.grovnews_create_post(text, uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.grovnews_create_post(text, uuid, jsonb, boolean) to anon, authenticated;

-- ── 6.8 Build (or top up) the day's edition ────────────────────────────────
--
-- Candidates are posts from the last 36 hours that no other live edition
-- carries. With p_published_only (AUTOMATIC) only PUBLISHED posts qualify, and
-- a non-empty edition is then published in the same transaction — the edition
-- guard re-checks every post. A non-draft edition is never touched, and a day
-- with nothing worth sending gets no edition at all.
create function public.grovnews_build_edition(p_token text, p_date date, p_published_only boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.grovnews_settings%rowtype;
  v_edition public.grovnews_editions%rowtype;
  v_created boolean := false;
  v_next integer;
  v_added integer := 0;
  v_room integer;
  r record;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if p_date is null then raise exception 'invalid_date'; end if;
  select * into v_settings from public.grovnews_settings where id;

  select * into v_edition from public.grovnews_editions where edition_date = p_date for update;
  if found and v_edition.status <> 'DRAFT' then
    return jsonb_build_object('edition_id', v_edition.id, 'status', v_edition.status, 'created', false, 'added', 0);
  end if;

  if not found then
    if not exists (
      select 1 from public.grovnews_posts p
       where (p.status = 'PUBLISHED' and p.published_at <= now() and p.published_at > now() - interval '36 hours')
          or (not coalesce(p_published_only, false) and p.status = 'DRAFT'
              and p.created_at > now() - interval '36 hours'
              and exists (select 1 from public.grovnews_research_items i where i.post_id = p.id))
    ) then
      return jsonb_build_object('edition_id', null, 'status', null, 'created', false, 'added', 0);
    end if;
    insert into public.grovnews_editions (edition_date, title, status, auto_generated, generated_at)
    values (p_date, 'GrovNews — ' || to_char(p_date, 'DD.MM.YYYY'), 'DRAFT', true, now())
    on conflict (edition_date) do nothing
    returning * into v_edition;
    if v_edition.id is null then
      select * into v_edition from public.grovnews_editions where edition_date = p_date for update;
      if v_edition.status <> 'DRAFT' then
        return jsonb_build_object('edition_id', v_edition.id, 'status', v_edition.status, 'created', false, 'added', 0);
      end if;
    else
      v_created := true;
    end if;
  end if;

  select coalesce(max(position), 0) + 1, v_settings.max_topics - count(*)
    into v_next, v_room from public.grovnews_edition_posts where edition_id = v_edition.id;

  for r in
    select p.id,
           coalesce((select max(i.importance_score) from public.grovnews_research_items i where i.post_id = p.id), 0) as score
      from public.grovnews_posts p
     where ((p.status = 'PUBLISHED' and p.published_at <= now() and p.published_at > now() - interval '36 hours')
            or (not coalesce(p_published_only, false) and p.status = 'DRAFT'
                and p.created_at > now() - interval '36 hours'
                and exists (select 1 from public.grovnews_research_items i where i.post_id = p.id)))
       and not exists (select 1 from public.grovnews_edition_posts ep where ep.post_id = p.id)
     order by score desc, coalesce(p.published_at, p.created_at) desc
     limit greatest(v_room, 0)
  loop
    insert into public.grovnews_edition_posts (edition_id, post_id, position, featured)
    values (v_edition.id, r.id, v_next, v_next = 1)
    -- The target must be named: the (edition_id, position) key is deferrable,
    -- and Postgres refuses a deferrable constraint as an implicit arbiter.
    on conflict (edition_id, post_id) do nothing;
    v_next := v_next + 1;
    v_added := v_added + 1;
  end loop;

  if coalesce(p_published_only, false)
     and exists (select 1 from public.grovnews_edition_posts where edition_id = v_edition.id) then
    update public.grovnews_editions set status = 'READY' where id = v_edition.id;
    update public.grovnews_editions set status = 'PUBLISHED', published_at = now() where id = v_edition.id
    returning * into v_edition;
  end if;

  return jsonb_build_object('edition_id', v_edition.id, 'status', v_edition.status,
                            'created', v_created, 'added', v_added);
end $$;

revoke all on function public.grovnews_build_edition(text, date, boolean) from public, anon, authenticated;
grant execute on function public.grovnews_build_edition(text, date, boolean) to anon, authenticated;

-- ── 6.8b What the mail is written from ─────────────────────────────────────
--
-- The edition and its posts — PUBLISHED and live only, in order — for the
-- mail writer. The admin path and the daily job read the same thing, so the
-- mail can only ever be written from what a subscriber can already open.
create function public.grovnews_edition_mail_source(p_token text, p_edition_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_edition public.grovnews_editions%rowtype;
begin
  if not (public.is_admin() or public.server_call_ok(p_token)) then raise exception 'forbidden'; end if;
  select * into v_edition from public.grovnews_editions where id = p_edition_id;
  if not found then return null; end if;
  return jsonb_build_object(
    'date', v_edition.edition_date,
    'title', v_edition.title,
    'intro', v_edition.intro,
    'posts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'slug', p.slug, 'title', p.title, 'excerpt', p.excerpt,
               'content', left(p.content, 6000), 'email_summary', p.email_summary, 'blurb', ep.email_blurb)
             order by ep.position)
        from public.grovnews_edition_posts ep
        join public.grovnews_posts p on p.id = ep.post_id
       where ep.edition_id = v_edition.id
         and p.status = 'PUBLISHED' and p.published_at <= now()), '[]'::jsonb)
  );
end $$;

revoke all on function public.grovnews_edition_mail_source(text, uuid) from public, anon, authenticated;
grant execute on function public.grovnews_edition_mail_source(text, uuid) to anon, authenticated;

-- ── 6.9 The GrovNews group: existing contacts of entitled users ────────────
--
-- Membership is recomputed, never hand-edited: in = linked to a user with an
-- active entitlement and an unblocked account; out = everyone else. No
-- contact is created. Consent and suppression are NOT decided here — they are
-- decided when the queue is written and again, per batch, by the worker.
create function public.grovnews_group_sync_core()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group uuid;
  v_added integer;
  v_removed integer;
begin
  insert into public.newsletter_groups (key, name, description, is_dynamic)
  values ('grovnews', 'GrovNews — subskrybenci',
          'Utrzymywana automatycznie przez GrovNews: kontakty użytkowników z aktywnym dostępem. Nie edytuj ręcznie.',
          false)
  on conflict (key) do nothing;
  select g.id into strict v_group from public.newsletter_groups g where g.key = 'grovnews';
  -- A dynamic group is resolved from its rules, not its members: mailing it
  -- would reach whoever the rules match, entitled or not. Refuse.
  if exists (select 1 from public.newsletter_groups g where g.id = v_group and g.is_dynamic) then
    raise exception 'grovnews_group_dynamic';
  end if;

  -- The address that links an unlinked contact is the CONFIRMED sign-in
  -- address (auth.users), never profiles.email, which its owner can edit.
  with entitled as (
    select distinct u.id as user_id, lower(u.email) as email
      from public.grovnews_entitlements e
      join auth.users u on u.id = e.user_id
     where e.status = 'ACTIVE' and e.starts_at <= now()
       and (e.expires_at is null or e.expires_at > now())
       and u.email is not null and u.email_confirmed_at is not null
       and not public.account_blocked(u.id)
  ), wanted as (
    select distinct c.id from public.newsletter_contacts c
      join entitled en on en.user_id = c.user_id or (c.user_id is null and c.email = en.email)
  ), removed as (
    delete from public.newsletter_group_members m
     where m.group_id = v_group and m.contact_id not in (select id from wanted)
    returning 1
  ), added as (
    insert into public.newsletter_group_members (group_id, contact_id)
    select v_group, w.id from wanted w
    on conflict do nothing
    returning 1
  )
  select (select count(*) from added), (select count(*) from removed) into v_added, v_removed;

  return jsonb_build_object('group_id', v_group, 'added', v_added, 'removed', v_removed);
end $$;

revoke all on function public.grovnews_group_sync_core() from public, anon, authenticated;

create function public.grovnews_group_sync(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_admin() or public.server_call_ok(p_token)) then raise exception 'forbidden'; end if;
  return public.grovnews_group_sync_core();
end $$;

revoke all on function public.grovnews_group_sync(text) from public, anon, authenticated;
grant execute on function public.grovnews_group_sync(text) to anon, authenticated;

-- ── 6.10 AUTOMATIC MODE ONLY: queue the day's mail ─────────────────────────
--
-- The one unattended door into the newsletter queue, and it opens only when
-- an admin switched GrovNews to AUTOMATIC. It writes exactly what the
-- existing enqueue writes — a campaign, its step, its links, its recipients —
-- in one transaction, and the existing tick and worker send it. Recipients use
-- the worker's own predicate (consent, not unsubscribed, not suppressed),
-- which the worker re-checks at send time anyway.
--
-- IDEMPOTENT: the edition row is locked and an edition that already has a
-- campaign returns it. The recipients' unique index (0094) is the second line.
-- NO RECIPIENTS → NO CAMPAIGN, and the edition is not marked as sent.
create function public.grovnews_edition_send(
  p_token text,
  p_edition_id uuid,
  p_subject text,
  p_preview text,
  p_body text,
  p_links text[],
  p_utm jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_edition public.grovnews_editions%rowtype;
  v_mode text;
  v_group uuid;
  v_campaign uuid;
  v_eligible integer;
  v_queued integer;
  v_bad integer;
  v_link text;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  select s.mode into v_mode from public.grovnews_settings s where s.id;
  if v_mode is distinct from 'AUTOMATIC' then raise exception 'not_automatic'; end if;

  select * into v_edition from public.grovnews_editions where id = p_edition_id for update;
  if not found then raise exception 'unknown_edition'; end if;
  if v_edition.campaign_id is not null then
    -- Queued already: a retry, nothing to do. An admin's DRAFT campaign is not
    -- a send — that is a failure the run must report, not a success.
    if exists (select 1 from public.newsletter_campaigns k where k.id = v_edition.campaign_id and k.status = 'draft') then
      raise exception 'edition_has_draft_campaign';
    end if;
    return jsonb_build_object('status', 'already_queued', 'campaign_id', v_edition.campaign_id);
  end if;
  if v_edition.status <> 'PUBLISHED' then raise exception 'edition_not_published'; end if;

  if length(btrim(coalesce(p_subject, ''))) not between 1 and 200
     or length(coalesce(p_preview, '')) > 300
     or length(btrim(coalesce(p_body, ''))) = 0 or length(p_body) > 400000 then
    raise exception 'invalid_mail';
  end if;

  -- Every post still published and live.
  select count(*) filter (where p.status <> 'PUBLISHED' or p.published_at > now()), count(*)
    into v_bad, v_eligible
    from public.grovnews_edition_posts ep join public.grovnews_posts p on p.id = ep.post_id
   where ep.edition_id = v_edition.id;
  if v_eligible = 0 or v_bad > 0 then raise exception 'edition_unpublished_posts'; end if;

  -- Every GrovNews article the mail links to — read from the BODY itself, not
  -- from the caller's list — is a published post of THIS edition.
  if exists (
    select 1 from regexp_matches(p_body, '/grovnews/([a-z0-9-]+)', 'g') m
     where not exists (
       select 1 from public.grovnews_edition_posts ep join public.grovnews_posts p on p.id = ep.post_id
        where ep.edition_id = v_edition.id and p.slug = m[1]
     )
  ) then
    raise exception 'foreign_link';
  end if;
  foreach v_link in array coalesce(p_links, '{}') loop
    if v_link !~* '^https://' or length(v_link) > 2000 then raise exception 'invalid_link'; end if;
  end loop;

  update public.grovnews_editions
     set email_subject = btrim(p_subject), email_preview = nullif(btrim(coalesce(p_preview, '')), ''),
         email_body = p_body, email_prepared_at = now()
   where id = v_edition.id;

  v_group := (public.grovnews_group_sync_core()->>'group_id')::uuid;

  select count(*) into v_eligible
    from public.newsletter_group_members m
    join public.newsletter_contacts c on c.id = m.contact_id
   where m.group_id = v_group
     and c.marketing_consent = true
     and c.unsubscribed_at is null
     and not exists (select 1 from public.newsletter_suppressions s where s.email = c.email);

  if v_eligible = 0 then
    update public.grovnews_editions set failure_reason = 'no_recipients' where id = v_edition.id;
    return jsonb_build_object('status', 'no_recipients', 'recipients', 0);
  end if;

  insert into public.newsletter_campaigns (name, kind, status, audience, track_opens, track_clicks, utm, started_at)
  values (left(v_edition.title, 160), 'one_off', 'sending',
          jsonb_build_object('include', jsonb_build_array(v_group), 'exclude', '[]'::jsonb),
          true, true,
          jsonb_strip_nulls(jsonb_build_object(
            'source', left(p_utm->>'source', 60), 'medium', left(p_utm->>'medium', 60),
            'campaign', left(p_utm->>'campaign', 60))),
          now())
  returning id into v_campaign;

  insert into public.newsletter_campaign_steps (campaign_id, step_index, variant, subject, preheader, editor, body_html)
  values (v_campaign, 0, 'A', btrim(p_subject), coalesce(btrim(p_preview), ''), 'html', p_body);

  insert into public.newsletter_links (campaign_id, url)
  select distinct v_campaign, u from unnest(coalesce(p_links, '{}')) u
  on conflict do nothing;

  insert into public.newsletter_recipients (campaign_id, step_index, variant, contact_id, email, status, send_after)
  select v_campaign, 0, 'A', c.id, c.email, 'pending', now()
    from public.newsletter_group_members m
    join public.newsletter_contacts c on c.id = m.contact_id
   where m.group_id = v_group
     and c.marketing_consent = true
     and c.unsubscribed_at is null
     and not exists (select 1 from public.newsletter_suppressions s where s.email = c.email)
  on conflict do nothing;
  get diagnostics v_queued = row_count;

  update public.grovnews_editions
     set campaign_id = v_campaign, status = 'QUEUED', queued_at = now(),
         email_recipients = v_queued, failure_reason = null
   where id = v_edition.id;

  return jsonb_build_object('status', 'queued', 'campaign_id', v_campaign, 'recipients', v_queued);
end $$;

revoke all on function public.grovnews_edition_send(text, uuid, text, text, text, text[], jsonb) from public, anon, authenticated;
grant execute on function public.grovnews_edition_send(text, uuid, text, text, text, text[], jsonb) to anon, authenticated;

-- ── 6.11 Editions follow their campaigns ───────────────────────────────────
--
-- QUEUED → SENT only when the newsletter closed the campaign AND at least one
-- message was accepted; a campaign that closed with every message failed, was
-- cancelled or was deleted makes the edition FAILED. Nothing here sends.
create function public.grovnews_editions_sync_core()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_changed integer := 0;
begin
  for r in
    select e.id, e.campaign_id, k.status as campaign_status, k.finished_at,
           exists (select 1 from public.newsletter_recipients x
                    where x.campaign_id = e.campaign_id and x.status = 'sent') as any_sent
      from public.grovnews_editions e
      left join public.newsletter_campaigns k on k.id = e.campaign_id
     where e.status = 'QUEUED'
     for update of e skip locked
  loop
    if r.campaign_id is null then
      update public.grovnews_editions set status = 'FAILED', failure_reason = 'campaign_deleted' where id = r.id;
      v_changed := v_changed + 1;
    elsif r.campaign_status = 'sent' and r.any_sent then
      update public.grovnews_editions set status = 'SENT', sent_at = coalesce(r.finished_at, now()) where id = r.id;
      v_changed := v_changed + 1;
    elsif r.campaign_status = 'sent' then
      update public.grovnews_editions set status = 'FAILED', failure_reason = 'all_failed' where id = r.id;
      v_changed := v_changed + 1;
    elsif r.campaign_status in ('cancelled', 'failed') then
      update public.grovnews_editions set status = 'FAILED', failure_reason = 'campaign_' || r.campaign_status where id = r.id;
      v_changed := v_changed + 1;
    end if;
  end loop;
  return v_changed;
end $$;

revoke all on function public.grovnews_editions_sync_core() from public, anon, authenticated;

create function public.grovnews_editions_sync(p_token text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_admin() or public.server_call_ok(p_token)) then raise exception 'forbidden'; end if;
  return public.grovnews_editions_sync_core();
end $$;

revoke all on function public.grovnews_editions_sync(text) from public, anon, authenticated;
grant execute on function public.grovnews_editions_sync(text) to anon, authenticated;

-- ── 6.12 The run ledger ────────────────────────────────────────────────────
--
-- claim: one daily row per Warsaw date, a six-minute lease so two
-- invocations never work the same day at once, a ceiling on attempts so a
-- day that keeps failing stops trying and says so.
create function public.grovnews_run_claim(p_token text, p_trigger text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Europe/Warsaw')::date;
  v_run public.grovnews_runs%rowtype;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;

  insert into public.grovnews_runs (kind, run_date, trigger)
  values ('DAILY', v_today, case when p_trigger = 'ADMIN' then 'ADMIN' else 'CRON' end)
  on conflict (run_date) where kind = 'DAILY' do nothing;

  select * into v_run from public.grovnews_runs where kind = 'DAILY' and run_date = v_today for update;
  if v_run.status in ('DONE', 'FAILED') then
    return jsonb_build_object('claimed', false, 'reason', lower(v_run.status), 'run_id', v_run.id);
  end if;
  if v_run.locked_until is not null and v_run.locked_until > now() then
    return jsonb_build_object('claimed', false, 'reason', 'busy', 'run_id', v_run.id);
  end if;
  if v_run.invocations >= 12 then
    update public.grovnews_runs
       set status = 'FAILED', finished_at = now(), locked_until = null,
           error = coalesce(error, 'too_many_attempts')
     where id = v_run.id;
    return jsonb_build_object('claimed', false, 'reason', 'gave_up', 'run_id', v_run.id);
  end if;

  update public.grovnews_runs
     set locked_until = now() + interval '6 minutes', invocations = invocations + 1
   where id = v_run.id
  returning * into v_run;

  return jsonb_build_object('claimed', true, 'run_id', v_run.id, 'stage', v_run.stage,
                            'stats', v_run.stats, 'run_date', v_run.run_date);
end $$;

revoke all on function public.grovnews_run_claim(text, text) from public, anon, authenticated;
grant execute on function public.grovnews_run_claim(text, text) to anon, authenticated;

create function public.grovnews_run_update(
  p_token text, p_run_id uuid, p_stage text, p_status text, p_stats jsonb, p_error text, p_release boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  update public.grovnews_runs
     set stage = coalesce(p_stage, stage),
         status = coalesce(p_status, status),
         stats = case when jsonb_typeof(p_stats) = 'object' then stats || p_stats else stats end,
         error = case when p_error is null then error else left(p_error, 300) end,
         locked_until = case when coalesce(p_release, false) or p_status in ('DONE', 'FAILED') then null else locked_until end,
         finished_at = case when p_status in ('DONE', 'FAILED') then now() else finished_at end
   where id = p_run_id and status = 'RUNNING';
end $$;

revoke all on function public.grovnews_run_update(text, uuid, text, text, jsonb, text, boolean) from public, anon, authenticated;
grant execute on function public.grovnews_run_update(text, uuid, text, text, jsonb, text, boolean) to anon, authenticated;

-- ── 6.13 Arrange a draft edition (admin) ───────────────────────────────────
--
-- The whole list in one transaction: which posts, in what order, which one
-- is featured. Positions are unique per edition, so reordering row by row
-- through the API would trip over itself; here the constraint is checked at
-- COMMIT (it is DEFERRABLE). The edition-posts guard still refuses anything
-- but a DRAFT.
create function public.grovnews_edition_arrange(p_edition_id uuid, p_post_ids uuid[], p_featured uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[] := coalesce(p_post_ids, '{}');
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if cardinality(v_ids) > 20 then raise exception 'too_many_posts'; end if;
  if (select count(distinct x) from unnest(v_ids) x) <> cardinality(v_ids) then raise exception 'duplicate_post'; end if;
  if exists (select 1 from unnest(v_ids) x where not exists (select 1 from public.grovnews_posts p where p.id = x)) then
    raise exception 'unknown_post';
  end if;
  delete from public.grovnews_edition_posts
   where edition_id = p_edition_id and not (post_id = any (v_ids));

  update public.grovnews_edition_posts ep
     set position = o.n, featured = (ep.post_id = p_featured)
    from unnest(v_ids) with ordinality o(id, n)
   where ep.edition_id = p_edition_id and ep.post_id = o.id
     and (ep.position <> o.n or ep.featured <> (ep.post_id = p_featured));

  insert into public.grovnews_edition_posts (edition_id, post_id, position, featured)
  select p_edition_id, o.id, o.n, o.id = p_featured
    from unnest(v_ids) with ordinality o(id, n)
   where not exists (select 1 from public.grovnews_edition_posts ep
                      where ep.edition_id = p_edition_id and ep.post_id = o.id);
end $$;

revoke all on function public.grovnews_edition_arrange(uuid, uuid[], uuid) from public, anon, authenticated;
grant execute on function public.grovnews_edition_arrange(uuid, uuid[], uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. WHAT A SUBSCRIBER SEES: the latest edition, published posts only
-- ═══════════════════════════════════════════════════════════════════════════
create function public.grovnews_current_edition()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_edition public.grovnews_editions%rowtype;
begin
  if not (public.is_admin() or public.grovnews_has_access()) then return null; end if;

  select * into v_edition from public.grovnews_editions e
   where e.status in ('PUBLISHED', 'QUEUED', 'SENT')
     and e.published_at is not null and e.published_at <= now()
     and e.edition_date > (now() at time zone 'Europe/Warsaw')::date - 3
   order by e.edition_date desc
   limit 1;
  if not found then return null; end if;

  return jsonb_build_object(
    'date', v_edition.edition_date,
    'title', v_edition.title,
    'intro', v_edition.intro,
    'posts', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'slug', p.slug, 'title', p.title,
                                          'excerpt', p.excerpt, 'featured', ep.featured,
                                          'read_minutes', p.estimated_read_minutes)
                       order by ep.position)
        from public.grovnews_edition_posts ep
        join public.grovnews_posts p on p.id = ep.post_id
       where ep.edition_id = v_edition.id
         and p.status = 'PUBLISHED' and p.published_at <= now()), '[]'::jsonb)
  );
end $$;

revoke all on function public.grovnews_current_edition() from public, anon;
grant execute on function public.grovnews_current_edition() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. THE DAILY SCHEDULE — its own pg_cron job, the newsletter's untouched
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Every ten minutes the tick (a) moves queued editions along with their
-- campaigns and (b) if the daily run is switched on, it is at or past the
-- configured Warsaw hour and today's run is neither finished nor in progress,
-- wakes /api/cron/grovnews — which does the work in bounded steps and resumes
-- on the next tick if it runs out of time.
--
-- NO NEW SECRET. The route authenticates with the dispatch token, which is
-- exactly the value the newsletter scheduler already keeps in the vault
-- (`grovbase.newsletter.worker_token`, written by provisionSchedulerAction
-- from dispatchToken()); the URL is that secret's origin. Re-provisioning the
-- newsletter (a rotated server key) therefore fixes both at once.
create function public.grovnews_cron_tick()
returns text
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_settings public.grovnews_settings%rowtype;
  v_local timestamp := now() at time zone 'Europe/Warsaw';
  v_run public.grovnews_runs%rowtype;
  v_url text;
  v_origin text;
  v_token text;
  v_fn text;
  v_request bigint;
begin
  perform public.grovnews_editions_sync_core();

  select * into v_settings from public.grovnews_settings where id;
  if not coalesce(v_settings.daily_enabled, false) then return 'disabled'; end if;
  if extract(hour from v_local)::integer < v_settings.run_hour then return 'not_due'; end if;

  select * into v_run from public.grovnews_runs where kind = 'DAILY' and run_date = v_local::date;
  if found then
    if v_run.status in ('DONE', 'FAILED') then return 'done'; end if;
    if v_run.locked_until is not null and v_run.locked_until > now() then return 'busy'; end if;
  end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'grovbase.newsletter.worker_url';
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'grovbase.newsletter.worker_token';
  v_origin := substring(btrim(coalesce(v_url, '')) from '^(https://[^/]+)');
  if v_origin is null or v_token is null or btrim(v_token) = '' then return 'not_configured'; end if;

  select n.nspname || '.' || p.proname into v_fn
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.proname = 'http_post' and n.nspname in ('net', 'extensions', 'public')
   order by case n.nspname when 'net' then 0 when 'extensions' then 1 else 2 end
   limit 1;
  if v_fn is null then return 'no_pg_net'; end if;

  execute format('select %s(url := $1, headers := $2, body := $3, timeout_milliseconds := $4)', v_fn)
  into v_request
  using v_origin || '/api/cron/grovnews',
        jsonb_build_object('Content-Type', 'application/json', 'x-grovnews-token', btrim(v_token)),
        '{}'::jsonb,
        5000;

  return 'posted:' || coalesce(v_request::text, 'unknown');
end $$;

revoke all on function public.grovnews_cron_tick() from public, anon, authenticated;

-- ── 8.1 Is it actually on? (admin, never a secret's value) ─────────────────
create function public.grovnews_scheduler_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, vault, extensions
as $$
declare
  v_cron boolean := to_regprocedure('cron.schedule(text,text,text)') is not null;
  v_job boolean := false;
  v_last jsonb := null;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if v_cron then
    begin
      execute 'select count(*) > 0 from cron.job where jobname = $1' into v_job using 'grovbase-grovnews-daily';
      execute $q$
        select jsonb_build_object('status', d.status, 'at', d.end_time, 'message', left(d.return_message, 200))
          from cron.job_run_details d join cron.job j on j.jobid = d.jobid
         where j.jobname = $1 order by d.start_time desc limit 1
      $q$ into v_last using 'grovbase-grovnews-daily';
    exception when others then
      v_last := null;
    end;
  end if;
  return jsonb_build_object(
    'pgCron', v_cron,
    'jobScheduled', v_job,
    'triggerConfigured',
      exists (select 1 from vault.decrypted_secrets where name = 'grovbase.newsletter.worker_url'
                and btrim(decrypted_secret) ~ '^https://')
      and exists (select 1 from vault.decrypted_secrets where name = 'grovbase.newsletter.worker_token'
                and coalesce(btrim(decrypted_secret), '') <> ''),
    'lastTick', v_last
  );
end $$;

revoke all on function public.grovnews_scheduler_status() from public, anon, authenticated;
grant execute on function public.grovnews_scheduler_status() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. The daily job may reach the configured AI provider
-- ═══════════════════════════════════════════════════════════════════════════
-- The body (0077) refuses without the dispatch token; only the grant changes.
grant execute on function public.provider_credential_read(text, uuid) to anon;

commit;

-- pg_cron, outside the transaction and idempotent, exactly like 0095: an
-- existing job of this name is replaced, and a project without pg_cron is
-- told so instead of failing the migration.
do $$
declare
  v_name constant text := 'grovbase-grovnews-daily';
  v_existing integer;
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise notice 'grovnews scheduler: pg_cron is not installed; the daily run then starts only from the admin panel.';
    return;
  end if;
  execute 'select count(*) from cron.job where jobname = $1' into v_existing using v_name;
  if v_existing > 0 then
    execute 'select cron.unschedule($1)' using v_name;
  end if;
  execute 'select cron.schedule($1, $2, $3)'
    using v_name, '*/10 * * * *', 'select public.grovnews_cron_tick();';
exception when others then
  raise notice 'grovnews scheduler: the job could not be scheduled (%). The daily run then starts only from the admin panel.', sqlerrm;
end $$;

-- ROLLBACK (manual, in this order):
--   select cron.unschedule('grovbase-grovnews-daily');
--   revoke execute on function public.provider_credential_read(text, uuid) from anon;
--   drop trigger grovnews_posts_edition_lock on public.grovnews_posts;
--   drop table public.grovnews_edition_posts, public.grovnews_editions, public.grovnews_runs,
--              public.grovnews_research_items, public.grovnews_sources, public.grovnews_settings cascade;
--   drop function public.grovnews_* (every function created above);
--   (the `grovnews` newsletter group, if created, is an ordinary static group)
