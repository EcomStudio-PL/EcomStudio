-- ============================================================================
-- 0125 — GROVNEWS, STAGE 5: source import + source health + ONE daily article
--        and ONE daily e-mail; the CMS gives up the `blog` slug
-- ============================================================================
--
-- ADDITIVE. New columns carry defaults, new functions are new names, and the
-- functions redefined below keep their signatures (callers do not change).
-- Nothing is dropped, no row is rewritten, no setting an admin chose is
-- changed: `mode`, `daily_enabled`, `run_hour`, the thresholds and
-- `max_topics` keep whatever value they have.
--
--   1. CMS          'blog' joins the reserved slugs (the static /blog route
--                   owns it, so a CMS page of that name could never be seen).
--   2. SOURCES      health: HEALTHY / DEGRADED / FAILED / UNSUPPORTED (and
--                   DISABLED, which is `enabled = false`, not a stored state),
--                   the last HTTP status, the type the URL really serves, the
--                   address it ends at after redirects, how many entries it
--                   listed and how many were new, a failure streak, and the
--                   moment of its first stored read (the "baseline").
--                   One failed read never makes a source FAILED, and nothing
--                   here ever switches a source off: `enabled` is the admin's.
--   3. IMPORT       grovnews_import_sources(): many sources in ONE statement,
--                   each row on its own savepoint; an existing URL is SKIPPED
--                   unless the admin explicitly asked to UPDATE.
--   4. SETTINGS     min_topics, lookback_hours, email_enabled.
--   5. ONE ARTICLE  a day's research becomes ONE post (the daily article)
--      PER DAY      carried by that day's edition — enforced by a unique index
--                   on the post's `daily_date` and by `article_post_id` being
--                   UNIQUE on the edition. A retry, a double click or two
--                   overlapping runs meet the index and get the first result.
--   6. ONE MAIL     the unattended send door refuses an edition that is not
--      PER DAY      today's, a mail with any link other than the published
--                   article, and any send while e-mail is switched off. One
--                   campaign per edition (0121) and one edition per date
--                   (0121) make it one campaign per date.
--
-- WHO CAN DO WHAT is unchanged: every table stays admin-only under RLS; the
-- unattended job proves itself with the dispatch token (server_call_ok); the
-- admin-only functions check is_admin() themselves.

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. CMS — `blog` is an application route, not a page slug
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.cms_slug_is_reserved(p_slug text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select lower(coalesce(p_slug, '')) = any (array[
    'api', 'auth', 'admin', 'login', 'register', 'logout',
    'home', 'dashboard', 'settings', 'generator', 'library', 'products',
    'prompts', 'history', 'credits', 'plan', 'tools', 'inspirations',
    'support', 'retusz', 'wideo', 'k', 'forgot-password', 'reset-password',
    'sitemap.xml', 'robots.txt', 'manifest.webmanifest', '_next', 'favicon.ico',
    'blog'
  ]);
$$;

-- The slug constraint (0085) is NOT VALID and re-checks a row on every UPDATE:
-- an existing page called `blog` would become impossible to edit or archive.
-- None exists; if one ever does, this migration stops instead of stranding it.
do $$
begin
  if exists (select 1 from public.cms_pages where lower(slug) = 'blog') then
    raise exception 'cms_page_blog_exists: rename the CMS page "blog" before applying 0125';
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. SOURCE HEALTH
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.grovnews_sources
  add column health_status        text check (health_status in ('HEALTHY', 'DEGRADED', 'FAILED', 'UNSUPPORTED')),
  add column consecutive_failures integer not null default 0 check (consecutive_failures between 0 and 100000),
  add column last_http_status     integer check (last_http_status between 100 and 599),
  add column detected_type        text check (detected_type in ('RSS', 'ATOM', 'PUBLIC_FEED', 'WEB_PAGE')),
  add column resolved_url         text check (resolved_url is null or (resolved_url ~* '^https://' and length(resolved_url) <= 2000)),
  add column last_items_count     integer check (last_items_count between 0 and 100000),
  add column last_new_items       integer check (last_new_items between 0 and 100000),
  add column baseline_at          timestamptz;

-- ── 2.1 The one place a source's health changes ────────────────────────────
--
-- A read that worked: HEALTHY when it listed something, DEGRADED when it
-- listed nothing. A read that failed:
--   · UNSUPPORTED when the site answers "not for you" — login, payment,
--     forbidden, legal block, robots.txt, bot protection, no adapter. GrovNews
--     never works around any of these; a human decides what to do;
--   · FAILED after three failures in a row, or at once for an address that
--     cannot work (not found, gone, no such host, refused by the SSRF guard,
--     not a readable format) when it has never worked;
--   · DEGRADED otherwise — one timeout, one 5xx, one 429 is not a verdict.
-- `enabled` is never touched here.
create function public.grovnews_source_health_core(
  p_source_id uuid, p_ok boolean, p_error text, p_http integer, p_detected text, p_resolved text,
  p_entries integer, p_new integer
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src public.grovnews_sources%rowtype;
  v_code text := lower(left(btrim(coalesce(p_error, '')), 80));
  v_http integer := p_http;
  v_fail integer;
  v_status text;
begin
  select * into v_src from public.grovnews_sources where id = p_source_id for update;
  if not found then raise exception 'unknown_source'; end if;

  if v_http is null and v_code ~ '^http_status_[1-5][0-9][0-9]$' then
    v_http := substr(v_code, 13, 3)::integer;
  end if;
  if v_http is not null and (v_http < 100 or v_http > 599) then v_http := null; end if;

  if coalesce(p_ok, false) then
    v_status := case when coalesce(p_entries, 0) > 0 then 'HEALTHY' else 'DEGRADED' end;
    update public.grovnews_sources
       set health_status = v_status,
           consecutive_failures = 0,
           last_checked_at = now(),
           last_success_at = now(),
           last_error = case when v_status = 'DEGRADED' then 'empty' end,
           last_http_status = coalesce(v_http, 200),
           detected_type = case when p_detected in ('RSS', 'ATOM', 'PUBLIC_FEED', 'WEB_PAGE') then p_detected else detected_type end,
           resolved_url = case when p_resolved ~* '^https://' and length(p_resolved) <= 2000 then p_resolved else resolved_url end,
           last_items_count = greatest(0, least(100000, coalesce(p_entries, 0))),
           last_new_items = case when p_new is null then last_new_items else greatest(0, least(100000, p_new)) end
     where id = p_source_id;
    return v_status;
  end if;

  v_fail := least(v_src.consecutive_failures + 1, 100000);
  v_status := case
    when v_code in ('robots', 'requires_access', 'bot_protection', 'adapter_unavailable',
                    'http_status_401', 'http_status_402', 'http_status_403', 'http_status_407', 'http_status_451')
      then 'UNSUPPORTED'
    when v_fail >= 3 then 'FAILED'
    when v_src.last_success_at is null
         and v_code in ('http_status_404', 'http_status_410', 'dns', 'forbidden_host', 'private_address',
                        'invalid_url', 'no_url', 'unrecognized_format', 'too_large', 'too_many_redirects')
      then 'FAILED'
    else 'DEGRADED' end;

  update public.grovnews_sources
     set health_status = v_status,
         consecutive_failures = v_fail,
         last_checked_at = now(),
         last_error = left(coalesce(nullif(v_code, ''), 'error'), 300),
         last_http_status = v_http
   where id = p_source_id;
  return v_status;
end $$;

revoke all on function public.grovnews_source_health_core(uuid, boolean, text, integer, text, text, integer, integer)
  from public, anon, authenticated;

-- ── 2.2 A health check (the admin's "Testuj", or the job) ─────────────────
create function public.grovnews_source_checked(p_token text, p_source_id uuid, p_result jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_http integer;
  v_entries integer;
begin
  if not (public.is_admin() or public.server_call_ok(p_token)) then raise exception 'forbidden'; end if;
  if p_result is null or jsonb_typeof(p_result) <> 'object' then raise exception 'invalid_result'; end if;
  if coalesce(p_result->>'http', '') ~ '^[0-9]{3}$' then v_http := (p_result->>'http')::integer; end if;
  if coalesce(p_result->>'entries', '') ~ '^[0-9]{1,6}$' then v_entries := (p_result->>'entries')::integer; end if;
  return public.grovnews_source_health_core(
    p_source_id,
    coalesce(p_result->>'ok', '') = 'true',
    left(coalesce(p_result->>'error', ''), 80),
    v_http,
    p_result->>'detected_type',
    left(coalesce(p_result->>'resolved_url', ''), 2000),
    v_entries,
    null);
end $$;

revoke all on function public.grovnews_source_checked(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.grovnews_source_checked(text, uuid, jsonb) to anon, authenticated;

-- ── 2.3 The daily read, now also keeping health and the first-read baseline ─
--
-- Same signature, same item rules as 0121 §6.3, plus:
--   · health goes through grovnews_source_health_core (one rule, two callers);
--   · THE FIRST STORED READ OF A SOURCE IS A BASELINE: what a page or feed
--     already lists when GrovNews first reads it is remembered (so it is not
--     "new" tomorrow) but never analysed — except entries dated in the last
--     48 hours, which are today's news. A freshly imported list of eighty
--     sources therefore does not turn into thousands of model calls.
create or replace function public.grovnews_ingest(
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
  v_reason text;
  v_published timestamptz;
  v_first boolean;
  v_inserted integer := 0;
  v_duplicates integer := 0;
  v_skipped integer := 0;
  v_stale integer := 0;
  v_entries integer := 0;
  v_id uuid;
  v_new jsonb := '[]'::jsonb;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  select * into v_source from public.grovnews_sources where id = p_source_id;
  if not found then raise exception 'unknown_source'; end if;

  if not coalesce(p_ok, false) then
    perform public.grovnews_source_health_core(p_source_id, false, coalesce(p_error, 'error'), null, null, null, null, null);
    return jsonb_build_object('inserted', 0, 'duplicates', 0, 'skipped', 0, 'stale', 0, 'items', '[]'::jsonb);
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    perform public.grovnews_source_health_core(p_source_id, true, null, null, null, null, 0, 0);
    return jsonb_build_object('inserted', 0, 'duplicates', 0, 'skipped', 0, 'stale', 0, 'items', '[]'::jsonb);
  end if;

  v_entries := jsonb_array_length(p_items);
  v_first := v_source.baseline_at is null;

  for v_item in select value from jsonb_array_elements(p_items) with ordinality e(value, n) where n <= 60 loop
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

    v_dup := null;
    if coalesce(v_item->>'duplicate_of', '') ~ '^[0-9a-f-]{36}$' then
      select i.id into v_dup from public.grovnews_research_items i where i.id = (v_item->>'duplicate_of')::uuid;
    end if;
    if v_dup is null then
      select i.id into v_dup from public.grovnews_research_items i
       where i.content_hash = v_item->>'hash' and i.duplicate_of is null
       order by i.discovered_at limit 1;
    end if;

    v_published := null;
    begin
      if coalesce(v_item->>'published_at', '') ~ '^\d{4}-\d{2}-\d{2}T' then
        v_published := (v_item->>'published_at')::timestamptz;
      end if;
    exception when others then
      v_published := null;
    end;

    v_reason := null;
    if v_dup is not null then
      v_status := 'DUPLICATE';
    elsif coalesce(v_item->>'stale', '') = 'true' then
      v_status := 'REJECTED'; v_reason := 'stale';
    elsif v_first and (v_published is null or v_published < now() - interval '48 hours') then
      v_status := 'REJECTED'; v_reason := 'baseline';
    else
      v_status := 'NEW';
    end if;

    begin
      insert into public.grovnews_research_items (
        source_id, canonical_url, normalized_url, source_title, source_excerpt, source_published_at,
        content_hash, title_norm, category_id, status, duplicate_of, review_reason, metadata
      ) values (
        p_source_id, v_item->>'url', v_item->>'nurl', btrim(left(v_item->>'title', 500)),
        left(coalesce(v_item->>'excerpt', ''), 2000), v_published,
        v_item->>'hash', left(coalesce(v_item->>'title_norm', ''), 500), v_source.category_id, v_status, v_dup,
        v_reason,
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
      v_new := v_new || jsonb_build_array(jsonb_build_object(
        'id', v_id, 'hash', v_item->>'hash', 'title', left(coalesce(v_item->>'title_norm', ''), 500)));
    end if;
    v_id := null;
  end loop;

  perform public.grovnews_source_health_core(p_source_id, true, null, null, null, null, v_entries, v_inserted);
  if v_first then
    update public.grovnews_sources set baseline_at = now() where id = p_source_id and baseline_at is null;
  end if;

  return jsonb_build_object('inserted', v_inserted, 'duplicates', v_duplicates, 'skipped', v_skipped,
                            'stale', v_stale, 'items', v_new, 'entries', v_entries, 'baseline', v_first);
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. BULK IMPORT (admin)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The rows arrive already parsed, validated, de-duplicated and TESTED by the
-- server action (which refuses anything that did not read successfully); this
-- checks every field again and decides each row against the table itself:
--   · the same URL (case-insensitively), or a URL this row resolves to, or a
--     row that resolves to this URL — is the SAME source: SKIPPED as a
--     duplicate, or UPDATED only when p_update_existing is true AND the app
--     marked the row as an update (the admin saw it as one). An update
--     changes what describes the source (name, category — a row naming none
--     keeps it —, priority, official), never how it is read (URL, type), its
--     language, nor whether it is on;
--   · anything else is inserted — only with the health the test just
--     measured, and only when that test READ something.
-- One statement, one transaction; every row on its own savepoint, so one bad
-- row is reported as failed without taking the others down.
create function public.grovnews_import_sources(p_rows jsonb, p_update_existing boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_n integer;
  v_url text;
  v_resolved text;
  v_name text;
  v_type text;
  v_cat uuid;
  v_prio integer;
  v_lang text;
  v_health text;
  v_existing uuid;
  v_id uuid;
  v_imported integer := 0;
  v_updated integer := 0;
  v_duplicate integer := 0;
  v_failed integer := 0;
  v_results jsonb := '[]'::jsonb;
  v_outcome text;
  v_error text;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'invalid_rows'; end if;
  if jsonb_array_length(p_rows) > 500 then raise exception 'too_many_rows'; end if;

  for v_row, v_n in select value, n from jsonb_array_elements(p_rows) with ordinality e(value, n) loop
    v_outcome := null; v_error := null; v_id := null; v_existing := null;
    begin
      v_url := btrim(coalesce(v_row->>'url', ''));
      v_resolved := nullif(btrim(coalesce(v_row->>'resolved_url', '')), '');
      v_name := btrim(coalesce(v_row->>'name', ''));
      v_type := v_row->>'type';
      v_prio := case when coalesce(v_row->>'priority', '') ~ '^[0-9]{1,3}$' then (v_row->>'priority')::integer end;
      v_lang := coalesce(v_row->>'language', 'pl');
      v_health := v_row->>'health_status';
      v_cat := null;
      if coalesce(v_row->>'category_id', '') ~ '^[0-9a-f-]{36}$' then
        select c.id into v_cat from public.grovnews_categories c where c.id = (v_row->>'category_id')::uuid;
        if v_cat is null then raise exception 'category'; end if;
      elsif coalesce(v_row->>'category_id', '') <> '' then
        raise exception 'category';
      end if;

      if length(v_name) not between 1 and 120 then raise exception 'name'; end if;
      if v_url !~* '^https://' or length(v_url) > 2000 then raise exception 'url'; end if;
      if v_resolved is not null and (v_resolved !~* '^https://' or length(v_resolved) > 2000) then v_resolved := null; end if;
      if v_prio is null or v_prio not between 0 and 100 then raise exception 'priority'; end if;
      if v_lang not in ('pl', 'en', 'de') then raise exception 'language'; end if;

      select s.id into v_existing from public.grovnews_sources s
       where s.url is not null
         and (lower(s.url) = lower(v_url)
              or (v_resolved is not null and lower(s.url) = lower(v_resolved))
              or (s.resolved_url is not null and lower(s.resolved_url) = lower(v_url))
              or (v_resolved is not null and s.resolved_url is not null and lower(s.resolved_url) = lower(v_resolved)))
       -- the source whose own address this is first (an UPDATE names it)
       order by (lower(s.url) = lower(v_url)) desc, s.created_at
       limit 1;

      if v_existing is not null then
        -- Only a row the admin was shown as an UPDATE (the app marks it) may
        -- change an existing source; any other match is a duplicate.
        if coalesce(p_update_existing, false) and v_row->'update' = 'true'::jsonb then
          update public.grovnews_sources
             set name = v_name, category_id = coalesce(v_cat, category_id), priority = v_prio,
                 official_source = coalesce((v_row->>'official')::boolean, official_source)
           where id = v_existing;
          v_outcome := 'updated'; v_id := v_existing;
        else
          v_outcome := 'duplicate'; v_id := v_existing;
        end if;
      else
        if v_type is null or v_type not in ('RSS', 'ATOM', 'PUBLIC_FEED', 'WEB_PAGE') then raise exception 'type'; end if;
        -- Only a source whose test READ something is imported: never a failed,
        -- unsupported or untested one.
        if v_health is distinct from 'HEALTHY' then raise exception 'not_healthy'; end if;
        insert into public.grovnews_sources (
          name, source_type, url, enabled, category_id, priority, official_source, language, created_by,
          health_status, last_checked_at, last_success_at, last_http_status, detected_type, resolved_url,
          last_items_count
        ) values (
          v_name, v_type, v_url, coalesce((v_row->>'enabled')::boolean, true), v_cat, v_prio,
          coalesce((v_row->>'official')::boolean, false), v_lang, auth.uid(),
          'HEALTHY', now(), now(),
          case when coalesce(v_row->>'http', '') ~ '^[1-5][0-9][0-9]$' then (v_row->>'http')::integer end,
          case when v_row->>'detected_type' in ('RSS', 'ATOM', 'PUBLIC_FEED', 'WEB_PAGE') then v_row->>'detected_type' end,
          v_resolved,
          case when coalesce(v_row->>'entries', '') ~ '^[0-9]{1,5}$' then (v_row->>'entries')::integer end
        )
        returning id into v_id;
        v_outcome := 'imported';
      end if;
    exception
      when unique_violation then
        v_outcome := 'duplicate'; v_error := null;
      when others then
        v_outcome := 'failed';
        v_error := case when sqlerrm in ('name', 'type', 'url', 'priority', 'language', 'category', 'not_healthy')
                        then sqlerrm else 'invalid' end;
    end;

    if v_outcome = 'imported' then v_imported := v_imported + 1;
    elsif v_outcome = 'updated' then v_updated := v_updated + 1;
    elsif v_outcome = 'duplicate' then v_duplicate := v_duplicate + 1;
    else v_failed := v_failed + 1;
    end if;
    v_results := v_results || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'index', v_n - 1, 'outcome', v_outcome, 'id', v_id, 'error', v_error)));
  end loop;

  return jsonb_build_object('imported', v_imported, 'updated', v_updated, 'duplicate', v_duplicate,
                            'failed', v_failed, 'results', v_results);
end $$;

revoke all on function public.grovnews_import_sources(jsonb, boolean) from public, anon, authenticated;
grant execute on function public.grovnews_import_sources(jsonb, boolean) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. SETTINGS
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.grovnews_settings
  -- Below this many valuable topics the article is still written, but it
  -- waits for a person — AUTOMATIC mode does not publish or send it.
  add column min_topics     integer not null default 3 check (min_topics between 1 and 10),
  -- How far back a story may be to count as today's news.
  add column lookback_hours integer not null default 36 check (lookback_hours between 12 and 168),
  -- AUTOMATIC mode sends the day's mail only while this is on.
  add column email_enabled  boolean not null default true;

-- The existing row keeps its max_topics; the new minimum defaults below it.
update public.grovnews_settings set min_topics = least(min_topics, max_topics) where min_topics > max_topics;

alter table public.grovnews_settings
  add constraint grovnews_settings_topics_range check (min_topics <= max_topics);

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. ONE DAILY ARTICLE
-- ═══════════════════════════════════════════════════════════════════════════

-- The article an edition carries. UNIQUE: an article belongs to one edition.
-- `daily` is the article's editorial record — its topics, each topic's
-- sources and confidence, the mail copy, why it waits for review. It lives on
-- the EDITION (admin-only), never on the post: a post's metadata is readable
-- by every subscriber (0120 §3), so it carries nothing but its date.
alter table public.grovnews_editions
  add column article_post_id uuid unique references public.grovnews_posts (id) on delete set null,
  add column daily jsonb check (daily is null or (jsonb_typeof(daily) = 'object' and length(daily::text) <= 200000));

-- ONE ARTICLE PER WARSAW DATE, whatever else goes wrong.
create unique index grovnews_posts_daily_date_key
  on public.grovnews_posts ((metadata->>'daily_date')) where metadata ? 'daily_date';

-- ── 5.1 An edition moves forward only over published posts (0121 §4.1),
--        and an article edition carries its article and nothing else ──────
create or replace function public.grovnews_editions_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_posts integer;
  v_unpublished integer;
  v_others integer;
begin
  if tg_op = 'UPDATE' and old.campaign_id is not null
     and new.campaign_id is not null and new.campaign_id <> old.campaign_id then
    raise exception 'grovnews_campaign_immutable' using errcode = '23514';
  end if;

  if new.status in ('READY', 'PUBLISHED', 'QUEUED', 'SENT')
     and (tg_op = 'INSERT' or new.status is distinct from old.status) then
    select count(*),
           count(*) filter (where p.status <> 'PUBLISHED' or p.published_at is null or p.published_at > now()
                                  or p.slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
           count(*) filter (where new.article_post_id is not null and p.id <> new.article_post_id)
      into v_posts, v_unpublished, v_others
      from public.grovnews_edition_posts ep
      join public.grovnews_posts p on p.id = ep.post_id
     where ep.edition_id = new.id;
    if v_posts = 0 then
      raise exception 'grovnews_edition_empty' using errcode = '23514';
    end if;
    if v_unpublished > 0 then
      raise exception 'grovnews_edition_unpublished_posts' using errcode = '23514';
    end if;
    if v_others > 0 then
      raise exception 'grovnews_edition_not_single_article' using errcode = '23514';
    end if;
  end if;

  if new.status = 'QUEUED' and (tg_op = 'INSERT' or old.status is distinct from 'QUEUED') then
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

-- ── 5.2 Topic selection: authority counts ──────────────────────────────────
--
-- Same daily room and thresholds as 0121 §6.6; the window is the admin's
-- lookback, and the order weighs the source as well as the story: importance
-- first, then relevance, then an official source, the source's priority and
-- how many OTHER sources reported the same story. Deterministic — no model.
create or replace function public.grovnews_select_top(p_token text)
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
      left join public.grovnews_sources s on s.id = i.source_id
     where i.status = 'ANALYZED'
       and i.discovered_at > now() - make_interval(hours => v_settings.lookback_hours)
       and coalesce(i.relevance_score, 0) >= v_settings.min_relevance
       and coalesce(i.importance_score, 0) >= v_settings.min_importance
     order by coalesce(i.importance_score, 0) * 2 + coalesce(i.relevance_score, 0)
              + case when coalesce(s.official_source, false) then 20 else 0 end
              + coalesce(s.priority, 50) / 5
              + 5 * least(3, (select count(distinct d.source_id) from public.grovnews_research_items d
                                where d.duplicate_of = i.id and d.source_id is not null
                                  and d.source_id is distinct from i.source_id)) desc,
              i.discovered_at desc
     limit v_room
     for update of i skip locked
  )
  update public.grovnews_research_items i
     set status = 'SELECTED', selected_at = now()
    from pick where i.id = pick.id;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ── 5.3 The day's topics, each with every source that reported it ────────
create function public.grovnews_daily_candidates(p_token text, p_date date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.grovnews_settings%rowtype;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if p_date is null then raise exception 'invalid_date'; end if;
  select * into v_settings from public.grovnews_settings where id;
  return coalesce((
    select jsonb_agg(to_jsonb(q) order by q.importance desc nulls last, q.relevance desc nulls last) from (
      select i.id, i.canonical_url as url, i.source_title as title, i.source_excerpt as excerpt,
             i.source_published_at as published_at, i.discovered_at, i.ai_title, i.ai_summary, i.ai_reason,
             i.relevance_score as relevance, i.importance_score as importance, i.sensitive, i.review_required,
             i.review_reason, c.slug as category,
             coalesce(s.name, '') as source_name, coalesce(s.official_source, false) as official,
             coalesce(s.priority, 50) as priority, coalesce(s.language, 'pl') as language,
             coalesce((select jsonb_agg(jsonb_build_object(
                        'id', d.id, 'url', d.canonical_url, 'title', d.source_title, 'excerpt', left(d.source_excerpt, 600),
                        'published_at', d.source_published_at, 'source', coalesce(ds.name, ''),
                        'official', coalesce(ds.official_source, false), 'priority', coalesce(ds.priority, 50),
                        'source_id', d.source_id,
                        -- its excerpt goes to the writer, so its doubts are the topic's
                        'flagged', d.review_required
                                   or ((d.sensitive or coalesce(dc.slug in ('prawo', 'podatki'), false))
                                       and not (v_settings.auto_publish_official_sensitive
                                                and coalesce(ds.official_source, false))))
                        order by coalesce(ds.official_source, false) desc, coalesce(ds.priority, 50) desc, d.discovered_at)
                        from public.grovnews_research_items d
                        left join public.grovnews_sources ds on ds.id = d.source_id
                        left join public.grovnews_categories dc on dc.id = d.category_id
                       where d.duplicate_of = i.id), '[]'::jsonb) as related,
             i.source_id
        from public.grovnews_research_items i
        left join public.grovnews_sources s on s.id = i.source_id
        left join public.grovnews_categories c on c.id = i.category_id
       where i.status = 'SELECTED' and i.post_id is null
         and (i.selected_at at time zone 'Europe/Warsaw')::date = p_date
       order by i.importance_score desc nulls last, i.relevance_score desc nulls last
       limit 10) q), '[]'::jsonb);
end $$;

revoke all on function public.grovnews_daily_candidates(text, date) from public, anon, authenticated;
grant execute on function public.grovnews_daily_candidates(text, date) to anon, authenticated;

-- ── 5.4 Write the day's article (and its edition) — once ──────────────────
--
-- ONE ARTICLE PER DATE: the edition row for the date is locked; an edition
-- that already has an article, or a post already stamped with this date,
-- returns that article instead of a second one. The items it is written from
-- become USED and point at it.
--
-- Whether it is published is decided HERE (like 0121 §6.7, per topic):
-- AUTOMATIC mode, the caller asked, nothing flagged for review, at least
-- `min_topics` topics, every topic above both thresholds, every topic either
-- from an official source or reported by two different sources, and law/tax
-- only on the item's OWN official source (and the admin's consent). A merged
-- or same-story report that is flagged for review, or is law/tax without its
-- own official source, holds the article too. Anything else stays a DRAFT.
create function public.grovnews_daily_article(
  p_token text, p_date date, p_item_ids uuid[], p_post jsonb, p_publish boolean, p_review_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.grovnews_settings%rowtype;
  v_edition public.grovnews_editions%rowtype;
  v_ids uuid[] := coalesce(p_item_ids, '{}');
  v_title text := btrim(coalesce(p_post->>'title', ''));
  v_excerpt text := btrim(coalesce(p_post->>'excerpt', ''));
  v_content text := coalesce(p_post->>'content', '');
  v_meta jsonb;
  v_daily jsonb;
  v_slug text;
  v_post uuid;
  v_post_status text;
  v_publish boolean;
  v_found integer;
  v_blocked integer;
  v_minutes integer;
  v_tags text[];
  v_existing public.grovnews_posts%rowtype;
  v_others integer;
  v_absorbed uuid[];
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if p_date is null then raise exception 'invalid_date'; end if;
  select * into v_settings from public.grovnews_settings where id;

  -- 1. Already written for this date? Return it.
  select * into v_edition from public.grovnews_editions where edition_date = p_date for update;
  if found and v_edition.article_post_id is not null then
    select * into v_existing from public.grovnews_posts where id = v_edition.article_post_id;
    return jsonb_build_object('post_id', v_existing.id, 'slug', v_existing.slug, 'status', v_existing.status,
                              'created', false, 'edition_id', v_edition.id, 'edition_status', v_edition.status,
                              'attached', true);
  end if;
  select * into v_existing from public.grovnews_posts where metadata->>'daily_date' = p_date::text;
  if found then
    return jsonb_build_object('post_id', v_existing.id, 'slug', v_existing.slug, 'status', v_existing.status,
                              'created', false, 'edition_id', v_edition.id, 'edition_status', v_edition.status,
                              'attached', false);
  end if;

  -- 2. The topics: 1..10 distinct items, every one still SELECTED and unused.
  if cardinality(v_ids) not between 1 and 10
     or (select count(distinct x) from unnest(v_ids) x) <> cardinality(v_ids) then
    raise exception 'invalid_items';
  end if;
  perform 1 from public.grovnews_research_items where id = any (v_ids) for update;
  select count(*) into v_found from public.grovnews_research_items
   where id = any (v_ids) and status = 'SELECTED' and post_id is null;
  if v_found <> cardinality(v_ids) then raise exception 'items_not_selected'; end if;
  -- Same-story reports merged into a topic ride with it: claimed with the
  -- article (so the story never comes back as a topic of its own), and a doubt
  -- about any of them is a doubt about the day.
  select coalesce(array_agg(distinct x::uuid), '{}') into v_absorbed
    from (select jsonb_array_elements_text(case when jsonb_typeof(p_post->'absorbed') = 'array'
                                                then p_post->'absorbed' else '[]'::jsonb end) x
           limit 50) a
   where x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and not (x::uuid = any (v_ids));
  perform 1 from public.grovnews_research_items where id = any (v_absorbed) for update;

  -- 3. The post itself.
  if length(v_title) not between 1 and 200 or length(v_excerpt) > 600 or length(v_content) > 200000
     or length(btrim(v_content)) = 0 or jsonb_typeof(coalesce(p_post->'sources', 'null'::jsonb)) <> 'array'
     or jsonb_array_length(p_post->'sources') > 60 then
    raise exception 'invalid_post';
  end if;
  -- The post's own metadata is its date and nothing else (subscribers can
  -- read it); the editorial record goes on the edition.
  v_meta := jsonb_build_object('daily_date', p_date::text);
  v_daily := case when jsonb_typeof(p_post->'daily') = 'object' then p_post->'daily' else '{}'::jsonb end;
  if length(v_daily::text) > 200000 then raise exception 'invalid_post'; end if;

  v_slug := lower(coalesce(p_post->>'slug', ''));
  if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(v_slug) > 110 then raise exception 'invalid_slug'; end if;
  while exists (select 1 from public.grovnews_posts p where p.slug = v_slug) loop
    v_slug := left(regexp_replace(v_slug, '-[0-9a-f]{6}$', ''), 110) || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 6);
  end loop;
  v_minutes := greatest(1, least(240, coalesce((p_post->>'read_minutes')::integer, 1)));
  select coalesce(array_agg(left(lower(btrim(t)), 40)) filter (where btrim(t) <> ''), '{}')
    into v_tags from (select jsonb_array_elements_text(coalesce(p_post->'tags', '[]'::jsonb)) t limit 20) x;

  -- 4. The publish decision, per topic.
  select count(*) into v_blocked
    from public.grovnews_research_items i
    left join public.grovnews_categories c on c.id = i.category_id
   where i.id = any (v_ids)
     and (i.review_required
          or coalesce(i.relevance_score, 0) < v_settings.min_relevance
          or coalesce(i.importance_score, 0) < v_settings.min_importance
          -- ONE UNOFFICIAL SOURCE ALWAYS NEEDS A HUMAN
          or not (exists (select 1 from public.grovnews_sources s where s.id = i.source_id and s.official_source)
                  or exists (select 1 from public.grovnews_research_items d
                              join public.grovnews_sources ds on ds.id = d.source_id and ds.official_source
                             where d.duplicate_of = i.id)
                  or exists (select 1 from public.grovnews_research_items d
                              where d.duplicate_of = i.id and d.source_id is not null
                                and d.source_id is distinct from i.source_id))
          -- LAW AND TAX: the item's OWN source official (a duplicate from an
          -- official site does not lend it authority — the 0121 rule), and
          -- the admin's consent
          or ((i.sensitive or coalesce(c.slug in ('prawo', 'podatki'), false))
              and not (v_settings.auto_publish_official_sensitive
                       and exists (select 1 from public.grovnews_sources s where s.id = i.source_id and s.official_source))));
  -- Merged reports, and every same-story report whose excerpt went to the
  -- writer: a review flag, or law/tax without its own official source and
  -- the admin's consent, holds the article. So does a merged report someone
  -- rejected or used while the article was being written.
  select v_blocked + count(*) into v_blocked
    from public.grovnews_research_items t
    left join public.grovnews_categories c on c.id = t.category_id
   where (t.id = any (v_absorbed) or t.duplicate_of = any (v_ids || v_absorbed))
     and ((t.id = any (v_absorbed) and not (t.status = 'SELECTED' and t.post_id is null))
          or t.review_required
          or ((t.sensitive or coalesce(c.slug in ('prawo', 'podatki'), false))
              and not (v_settings.auto_publish_official_sensitive
                       and exists (select 1 from public.grovnews_sources s where s.id = t.source_id and s.official_source))));

  v_publish := coalesce(p_publish, false)
    and v_settings.mode = 'AUTOMATIC'
    and nullif(btrim(coalesce(p_review_reason, '')), '') is null
    and cardinality(v_ids) >= v_settings.min_topics
    and v_blocked = 0;

  begin
    insert into public.grovnews_posts (
      slug, title, excerpt, content, category_id, tags, sources, estimated_read_minutes,
      language, status, published_at, metadata, created_by
    ) values (
      v_slug, v_title, v_excerpt, v_content, null, v_tags, p_post->'sources', v_minutes,
      case when p_post->>'language' in ('pl', 'en', 'de') then p_post->>'language' else 'pl' end,
      case when v_publish then 'PUBLISHED' else 'DRAFT' end,
      case when v_publish then now() end,
      v_meta,
      null
    ) returning id, status into v_post, v_post_status;
  exception when unique_violation then
    -- Another invocation wrote this date's article a moment ago: that one wins.
    select * into v_existing from public.grovnews_posts where metadata->>'daily_date' = p_date::text;
    if not found then raise; end if;
    return jsonb_build_object('post_id', v_existing.id, 'slug', v_existing.slug, 'status', v_existing.status,
                              'created', false, 'edition_id', v_edition.id, 'edition_status', v_edition.status,
                              'attached', v_edition.article_post_id is not distinct from v_existing.id);
  end;

  update public.grovnews_research_items set post_id = v_post, status = 'USED' where id = any (v_ids);
  update public.grovnews_research_items set post_id = v_post, status = 'USED'
   where id = any (v_absorbed) and status = 'SELECTED' and post_id is null;

  -- 5. The edition that carries it. An edition someone already built by hand
  --    for this date is not emptied: the article then waits, unattached, for
  --    a person (and nothing is sent).
  if v_edition.id is null then
    insert into public.grovnews_editions (edition_date, title, intro, status, auto_generated, generated_at)
    values (p_date, 'GrovNews — ' || to_char(p_date, 'DD.MM.YYYY'), left(v_excerpt, 1500), 'DRAFT', true, now())
    on conflict (edition_date) do nothing
    returning * into v_edition;
    if v_edition.id is null then
      select * into v_edition from public.grovnews_editions where edition_date = p_date for update;
    end if;
  end if;

  select count(*) into v_others from public.grovnews_edition_posts where edition_id = v_edition.id;
  if v_edition.status <> 'DRAFT' or v_others > 0 or v_edition.article_post_id is not null then
    return jsonb_build_object('post_id', v_post, 'slug', v_slug, 'status', v_post_status, 'created', true,
                              'edition_id', v_edition.id, 'edition_status', v_edition.status, 'attached', false);
  end if;

  insert into public.grovnews_edition_posts (edition_id, post_id, position, featured)
  values (v_edition.id, v_post, 1, true)
  on conflict (edition_id, post_id) do nothing;
  update public.grovnews_editions set article_post_id = v_post, daily = v_daily where id = v_edition.id
  returning * into v_edition;

  if v_publish then
    update public.grovnews_editions set status = 'READY' where id = v_edition.id;
    update public.grovnews_editions set status = 'PUBLISHED', published_at = now() where id = v_edition.id
    returning * into v_edition;
  end if;

  return jsonb_build_object('post_id', v_post, 'slug', v_slug, 'status', v_post_status, 'created', true,
                            'edition_id', v_edition.id, 'edition_status', v_edition.status, 'attached', true);
end $$;

revoke all on function public.grovnews_daily_article(text, date, uuid[], jsonb, boolean, text) from public, anon, authenticated;
grant execute on function public.grovnews_daily_article(text, date, uuid[], jsonb, boolean, text) to anon, authenticated;

-- ── 5.5 The Stage 2 builder leaves an article edition alone ───────────────
--
-- Same as 0121 §6.8, except: an edition that carries a daily article is
-- returned untouched, so "Zbuduj dzisiejsze wydanie" can never add a second
-- post to the day's article.
create or replace function public.grovnews_build_edition(p_token text, p_date date, p_published_only boolean)
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
  if found and (v_edition.status <> 'DRAFT' or v_edition.article_post_id is not null) then
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
      if v_edition.status <> 'DRAFT' or v_edition.article_post_id is not null then
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
       -- another day's article is never a topic of this edition
       and not (p.metadata ? 'daily_date')
     order by score desc, coalesce(p.published_at, p.created_at) desc
     limit greatest(v_room, 0)
  loop
    insert into public.grovnews_edition_posts (edition_id, post_id, position, featured)
    values (v_edition.id, r.id, v_next, v_next = 1)
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

-- ── 5.6 What the mail is written from: now with the article's record ──────
create or replace function public.grovnews_edition_mail_source(p_token text, p_edition_id uuid)
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
    'article_post_id', v_edition.article_post_id,
    'daily', v_edition.daily,
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

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. ONE DAILY MAIL — the unattended send door, tightened
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Everything 0121 §6.10 enforced still holds (AUTOMATIC only, one campaign per
-- edition, published posts only, the worker's consent predicate, no campaign
-- for nobody). Added:
--   · e-mail switched off in the settings → no send;
--   · only TODAY's edition (Warsaw) — a run that resumes late never mails an
--     old day;
--   · an article edition's mail links to the PUBLISHED article and to nothing
--     else: every href in the body is that article's address.
create or replace function public.grovnews_edition_send(
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
  v_settings public.grovnews_settings%rowtype;
  v_group uuid;
  v_campaign uuid;
  v_eligible integer;
  v_queued integer;
  v_bad integer;
  v_link text;
  v_slug text;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  select * into v_settings from public.grovnews_settings where id;
  if v_settings.mode is distinct from 'AUTOMATIC' then raise exception 'not_automatic'; end if;

  select * into v_edition from public.grovnews_editions where id = p_edition_id for update;
  if not found then raise exception 'unknown_edition'; end if;
  if v_edition.campaign_id is not null then
    if exists (select 1 from public.newsletter_campaigns k where k.id = v_edition.campaign_id and k.status = 'draft') then
      raise exception 'edition_has_draft_campaign';
    end if;
    return jsonb_build_object('status', 'already_queued', 'campaign_id', v_edition.campaign_id);
  end if;
  if not coalesce(v_settings.email_enabled, true) then raise exception 'email_disabled'; end if;
  if v_edition.edition_date <> (now() at time zone 'Europe/Warsaw')::date then raise exception 'edition_not_today'; end if;
  if v_edition.status <> 'PUBLISHED' then raise exception 'edition_not_published'; end if;

  if length(btrim(coalesce(p_subject, ''))) not between 1 and 200
     or length(coalesce(p_preview, '')) > 300
     or length(btrim(coalesce(p_body, ''))) = 0 or length(p_body) > 400000 then
    raise exception 'invalid_mail';
  end if;

  select count(*) filter (where p.status <> 'PUBLISHED' or p.published_at > now()), count(*)
    into v_bad, v_eligible
    from public.grovnews_edition_posts ep join public.grovnews_posts p on p.id = ep.post_id
   where ep.edition_id = v_edition.id;
  if v_eligible = 0 or v_bad > 0 then raise exception 'edition_unpublished_posts'; end if;

  if exists (
    select 1 from regexp_matches(p_body, '/grovnews/([a-z0-9-]+)', 'g') m
     where not exists (
       select 1 from public.grovnews_edition_posts ep join public.grovnews_posts p on p.id = ep.post_id
        where ep.edition_id = v_edition.id and p.slug = m[1]
     )
  ) then
    raise exception 'foreign_link';
  end if;

  if v_edition.article_post_id is not null then
    select p.slug into v_slug from public.grovnews_posts p
     where p.id = v_edition.article_post_id and p.status = 'PUBLISHED' and p.published_at <= now();
    if v_slug is null then raise exception 'edition_unpublished_posts'; end if;
    if exists (
      select 1 from regexp_matches(p_body, 'href\s*=\s*"([^"]*)"', 'gi') m
       where m[1] !~ ('^https://[^/"?#]+/grovnews/' || v_slug || '([?#][^"]*)?$')
    ) or not exists (
      select 1 from regexp_matches(p_body, 'href\s*=\s*"([^"]*)"', 'gi') m
    ) or p_body ~* '<[^>]*\mhref\s*=\s*[^"\s]'
      -- and no address in the visible text a mail client would turn into a link
      or regexp_replace(regexp_replace(p_body, '<[^>]*>', ' ', 'g'), '&amp;', '&', 'g')
         ~* '(https?://|\mwww\.|[[:alnum:]_-][.．。｡][a-z]{2,24}([^a-z]|$)|[[:alnum:]._%+-]@[[:alnum:]-])' then
      raise exception 'foreign_link';
    end if;
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

commit;

-- ROLLBACK (manual, in this order; the app of the previous release ignores
-- every column and function added here):
--   re-run the 0121 bodies of grovnews_ingest, grovnews_select_top,
--     grovnews_build_edition, grovnews_edition_mail_source,
--     grovnews_edition_send and grovnews_editions_guard, and the 0085 body of
--     cms_slug_is_reserved;
--   drop function public.grovnews_daily_article(text, date, uuid[], jsonb, boolean, text),
--     public.grovnews_daily_candidates(text, date), public.grovnews_import_sources(jsonb, boolean),
--     public.grovnews_source_checked(text, uuid, jsonb),
--     public.grovnews_source_health_core(uuid, boolean, text, integer, text, text, integer, integer);
--   drop index public.grovnews_posts_daily_date_key;
--   alter table public.grovnews_editions drop column article_post_id, drop column daily;
--   alter table public.grovnews_settings drop constraint grovnews_settings_topics_range,
--     drop column min_topics, drop column lookback_hours, drop column email_enabled;
--   alter table public.grovnews_sources drop column health_status, drop column consecutive_failures,
--     drop column last_http_status, drop column detected_type, drop column resolved_url,
--     drop column last_items_count, drop column last_new_items, drop column baseline_at;
