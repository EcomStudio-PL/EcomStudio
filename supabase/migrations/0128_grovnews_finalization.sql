-- ============================================================================
-- 0128 — GROVNEWS FINALIZATION: the AI choice, API sources with auth, the
--        publish / send hours, operator copies, and the recipient and
--        pipeline fixes found by the preflight
-- ============================================================================
--
-- ADDITIVE AND BEHAVIOUR-PRESERVING ON DEPLOY. Every new column is nullable or
-- carries a default that means "what happens today": no AI preference (the
-- platform's order), no publish or send hour (immediately after the previous
-- step), no operator addresses, no source auth. `daily_enabled`, `mode` and
-- every other setting an admin chose keep their values. Functions redefined
-- here keep their signatures, so no caller changes.
--
--   1. SETTINGS     ai_provider / ai_model (a preference inside the platform's
--                   existing AI stack — no key lives here), publish_hour,
--                   send_hour (Europe/Warsaw, NULL = right after the previous
--                   step), operator_emails (≤ 5 admin-configured addresses that
--                   receive a copy of the day's digest; never customers).
--   2. SOURCES      auth_kind none | bearer | header (+ auth_header) for API
--                   sources only. THE SECRET IS NOT IN THIS TABLE: it is a
--                   Supabase Vault secret named grovbase.grovnews_source.<id>
--                   (lib/server/secret-store), written by an admin and read by
--                   the server with the dispatch token.
--                   Health: `auth_failed` and `secret_missing` are refusals a
--                   human must fix (UNSUPPORTED), like a 401/403 already was.
--   3. ITEMS        research items remember their detected language.
--   4. DEDUPE       a new report is never merged into a REJECTED item
--                   (baseline / stale / expired): the story stays alive.
--   5. SELECTION    SELECTED items orphaned on an earlier day are released
--                   (back to ANALYZED/NEW within the lookback, else REJECTED
--                   'expired'), so they neither linger nor block anything.
--   6. RUNS         a RUNNING run of an earlier Warsaw date is closed as
--                   FAILED 'abandoned'; a run that reaches DONE drops a stale
--                   error; AUTOMATIC mode waits for publish_hour before the
--                   article is written and for send_hour before the mail — the
--                   tick keeps coming back until the run is DONE, and a wait
--                   costs no attempt.
--   7. RECIPIENTS   the address mailed is the verified sign-in address (a
--                   linked contact with another address is not eligible), and
--                   one person gets at most one copy.
--   8. THE MAIL     the digest may link to anchors of the day's article
--                   (…/grovnews/<slug>#tN); anything else is still refused.
--                   AUTOMATIC mail waits for send_hour here as well.
--
-- WHO CAN DO WHAT is unchanged: every table stays admin-only under RLS; the
-- unattended job proves itself with the dispatch token (server_call_ok).

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. SETTINGS
-- ═══════════════════════════════════════════════════════════════════════════

-- Operator addresses: at most five, distinct, lower-case, plausible.
create function public.grovnews_operator_emails_ok(p text[])
returns boolean
language sql
immutable
set search_path = public
as $$
  select p is not null
     and cardinality(p) <= 5
     and array_position(p, null) is null
     and (select count(distinct x) from unnest(p) x) = cardinality(p)
     and coalesce((select bool_and(length(x) <= 254
                                   and x ~ '^[a-z0-9._%+-]{1,64}@[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})*\.[a-z]{2,24}$')
                     from unnest(p) x), true);
$$;

alter table public.grovnews_settings
  -- A preference inside the platform's AI stack (lib/ai/engine/vision.ts):
  -- NULL = the platform's own order. Never a key.
  add column ai_provider text check (ai_provider is null or ai_provider in ('openai', 'google')),
  add column ai_model text check (ai_model is null or ai_model ~ '^[a-z0-9][a-z0-9.-]{0,79}$'),
  -- Europe/Warsaw hours; NULL = immediately after the previous step (the
  -- behaviour before this migration). AUTOMATIC mode only.
  add column publish_hour integer check (publish_hour is null or publish_hour between 0 and 23),
  add column send_hour integer check (send_hour is null or send_hour between 0 and 23),
  add column operator_emails text[] not null default '{}'::text[]
    constraint grovnews_settings_operator_emails_check check (public.grovnews_operator_emails_ok(operator_emails)),
  add constraint grovnews_settings_model_needs_provider check (ai_model is null or ai_provider is not null),
  -- Prepare ≤ publish ≤ send, within one Warsaw day.
  add constraint grovnews_settings_hours_order check (
    (publish_hour is null or publish_hour >= run_hour)
    and (send_hour is null or send_hour >= coalesce(publish_hour, run_hour)));

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. API SOURCES — how to authenticate (the secret itself is in the vault)
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.grovnews_sources
  add column auth_kind text not null default 'none' check (auth_kind in ('none', 'bearer', 'header')),
  -- The header an API key goes in (header kind only). Hop-by-hop, framing
  -- and identity headers can never be named: a key must not rewrite the
  -- request it rides on.
  add column auth_header text check (auth_header is null or (
    auth_header ~ '^[A-Za-z0-9-]{1,64}$'
    and lower(auth_header) not in ('host', 'cookie', 'set-cookie', 'content-length', 'content-type', 'content-encoding',
                                   'transfer-encoding', 'connection', 'keep-alive', 'te', 'trailer', 'upgrade', 'expect',
                                   'proxy-authorization', 'proxy-connection', 'user-agent', 'accept', 'accept-encoding',
                                   'accept-language', 'referer', 'origin', 'forwarded', 'x-forwarded-for', 'x-forwarded-host'))),
  add constraint grovnews_sources_auth_api_only check (auth_kind = 'none' or source_type = 'API'),
  add constraint grovnews_sources_auth_header_shape check ((auth_kind = 'header') = (auth_header is not null));

-- ── 2.1 Health: an API refusing OUR credential needs a human ───────────────
-- Same rule as 0125 §2.1, plus `auth_failed` (401/403 from an API we send a
-- credential to) and `secret_missing` (auth configured, no secret stored)
-- among the refusals that make a source UNSUPPORTED at once.
create or replace function public.grovnews_source_health_core(
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
    when v_code in ('robots', 'requires_access', 'bot_protection', 'adapter_unavailable', 'auth_failed', 'secret_missing',
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

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. RESEARCH ITEMS — the language each one is written in
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.grovnews_research_items
  add column language text check (language is null or language in ('pl', 'en', 'de'));

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. DEDUPE — a REJECTED item is never a merge target
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 4.1 The job's context: + how each API source authenticates; the dedupe
--        memory no longer holds rejected items ────────────────────────────────
create or replace function public.grovnews_job_context(p_token text)
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
               'official', s.official_source, 'language', s.language,
               'auth_kind', s.auth_kind, 'auth_header', s.auth_header)
             order by s.priority desc, s.name)
        from public.grovnews_sources s where s.enabled), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'slug', c.slug, 'name', c.name) order by c.sort_order)
        from public.grovnews_categories c where c.is_active), '[]'::jsonb),
    -- Dedupe memory: stories still alive. A report first seen during a
    -- source's baseline read (or gone stale / expired) is REJECTED; a fresh
    -- report of the same story must not be swallowed by it.
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'hash', r.content_hash, 'title', r.title_norm))
        from (select i.id, i.content_hash, i.title_norm
                from public.grovnews_research_items i
               where i.discovered_at > now() - interval '14 days' and i.duplicate_of is null
                 and i.status <> 'REJECTED'
               order by i.discovered_at desc
               limit 3000) r), '[]'::jsonb)
  );
end $$;

-- ── 4.2 The daily read: + the item's language; no merge into REJECTED ──────
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
      select i.id into v_dup from public.grovnews_research_items i
       where i.id = (v_item->>'duplicate_of')::uuid and i.status <> 'REJECTED';
    end if;
    if v_dup is null then
      select i.id into v_dup from public.grovnews_research_items i
       where i.content_hash = v_item->>'hash' and i.duplicate_of is null and i.status <> 'REJECTED'
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
        content_hash, title_norm, category_id, status, duplicate_of, review_reason, metadata, language
      ) values (
        p_source_id, v_item->>'url', v_item->>'nurl', btrim(left(v_item->>'title', 500)),
        left(coalesce(v_item->>'excerpt', ''), 2000), v_published,
        v_item->>'hash', left(coalesce(v_item->>'title_norm', ''), 500), v_source.category_id, v_status, v_dup,
        v_reason,
        case when jsonb_typeof(v_item->'metadata') = 'object' then v_item->'metadata' else '{}'::jsonb end,
        case when v_item->>'language' in ('pl', 'en', 'de') then v_item->>'language' else v_source.language end
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
-- 5. SELECTION — orphans of earlier days are released first
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Same selection as 0125 §5.2. Before it: a story SELECTED on an earlier
-- Warsaw day and never written up (the run never reached DRAFT, or the writer
-- dropped it) goes back to the pool while it is still within the lookback —
-- ANALYZED (or NEW when it was never analysed) — and is REJECTED 'expired'
-- otherwise. Nothing SELECTED lingers across days.
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

  update public.grovnews_research_items
     set status = case
                    when discovered_at <= now() - make_interval(hours => v_settings.lookback_hours) then 'REJECTED'
                    when analyzed_at is not null then 'ANALYZED'
                    else 'NEW' end,
         review_reason = case
                           when discovered_at <= now() - make_interval(hours => v_settings.lookback_hours)
                             then coalesce(review_reason, 'expired')
                           else review_reason end,
         selected_at = null
   where status = 'SELECTED' and post_id is null
     and selected_at is not null and (selected_at at time zone 'Europe/Warsaw')::date < v_today;

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

-- ── 5.1 The day's topics: + each report's language ───────────────────────
create or replace function public.grovnews_daily_candidates(p_token text, p_date date)
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
             coalesce(i.language, s.language, 'pl') as item_language,
             coalesce((select jsonb_agg(jsonb_build_object(
                        'id', d.id, 'url', d.canonical_url, 'title', d.source_title, 'excerpt', left(d.source_excerpt, 600),
                        'published_at', d.source_published_at, 'source', coalesce(ds.name, ''),
                        'official', coalesce(ds.official_source, false), 'priority', coalesce(ds.priority, 50),
                        'source_id', d.source_id,
                        'language', coalesce(d.language, ds.language, 'pl'),
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

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. RUNS — abandoned days closed, stale errors dropped, waits for the hours
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 6.1 claim ──────────────────────────────────────────────────────────────
-- As 0121 §6.12, plus:
--   · a RUNNING run of an earlier date can never finish its day any more (its
--     day's mail door refuses an old edition): it is closed as FAILED
--     'abandoned' instead of lingering;
--   · AUTOMATIC mode: at DRAFT before publish_hour, or at SEND before
--     send_hour, the run WAITS — not claimed, no attempt counted.
create or replace function public.grovnews_run_claim(p_token text, p_trigger text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.grovnews_settings%rowtype;
  v_local timestamp;
  v_today date;
  v_hour integer;
  v_run public.grovnews_runs%rowtype;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  select * into v_settings from public.grovnews_settings where id;
  v_local := now() at time zone coalesce(v_settings.timezone, 'Europe/Warsaw');
  v_today := v_local::date;
  v_hour := extract(hour from v_local)::integer;

  update public.grovnews_runs
     set status = 'FAILED', error = 'abandoned', finished_at = now(), locked_until = null
   where kind = 'DAILY' and status = 'RUNNING' and run_date < v_today;

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
  if v_settings.mode = 'AUTOMATIC' then
    if v_run.stage = 'DRAFT' and v_settings.publish_hour is not null and v_hour < v_settings.publish_hour then
      return jsonb_build_object('claimed', false, 'reason', 'waiting_publish', 'run_id', v_run.id);
    end if;
    if v_run.stage = 'SEND' and v_settings.send_hour is not null and v_hour < v_settings.send_hour then
      return jsonb_build_object('claimed', false, 'reason', 'waiting_send', 'run_id', v_run.id);
    end if;
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

-- ── 6.2 update: DONE clears an error an earlier invocation left ───────────
create or replace function public.grovnews_run_update(
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
         error = case when p_status = 'DONE' then null
                      when p_error is null then error
                      else left(p_error, 300) end,
         locked_until = case when coalesce(p_release, false) or p_status in ('DONE', 'FAILED') then null else locked_until end,
         finished_at = case when p_status in ('DONE', 'FAILED') then now() else finished_at end
   where id = p_run_id and status = 'RUNNING';
end $$;

-- ── 6.3 The tick: keeps coming back until the day's run is DONE ────────────
-- As 0121 §8, plus the abandoned-run close and the publish / send waits. The
-- local clock is the settings' timezone (the column is constrained to
-- Europe/Warsaw, so this is the same clock the rest of GrovNews uses).
create or replace function public.grovnews_cron_tick()
returns text
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_settings public.grovnews_settings%rowtype;
  v_local timestamp;
  v_hour integer;
  v_run public.grovnews_runs%rowtype;
  v_url text;
  v_origin text;
  v_token text;
  v_fn text;
  v_request bigint;
begin
  perform public.grovnews_editions_sync_core();

  select * into v_settings from public.grovnews_settings where id;
  v_local := now() at time zone coalesce(v_settings.timezone, 'Europe/Warsaw');
  v_hour := extract(hour from v_local)::integer;

  update public.grovnews_runs
     set status = 'FAILED', error = 'abandoned', finished_at = now(), locked_until = null
   where kind = 'DAILY' and status = 'RUNNING' and run_date < v_local::date;

  if not coalesce(v_settings.daily_enabled, false) then return 'disabled'; end if;
  if v_hour < v_settings.run_hour then return 'not_due'; end if;

  select * into v_run from public.grovnews_runs where kind = 'DAILY' and run_date = v_local::date;
  if found then
    if v_run.status in ('DONE', 'FAILED') then return 'done'; end if;
    if v_run.locked_until is not null and v_run.locked_until > now() then return 'busy'; end if;
    if v_settings.mode = 'AUTOMATIC' then
      if v_run.stage = 'DRAFT' and v_settings.publish_hour is not null and v_hour < v_settings.publish_hour then
        return 'waiting_publish';
      end if;
      if v_run.stage = 'SEND' and v_settings.send_hour is not null and v_hour < v_settings.send_hour then
        return 'waiting_send';
      end if;
    end if;
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

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. RECIPIENTS — the verified address, one copy per person
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Same question as 0122 §3 (which contacts belong to a person with access and
-- a CONFIRMED sign-in address), with two corrections:
--   · the contact's address must BE that confirmed sign-in address — a
--     contact linked to the user but carrying some other (unverified) address
--     is not eligible, because that other address is what would be mailed;
--   · ONE contact per person (the linked one first), so nobody can end up in
--     the audience twice.
-- Every caller (group sync, the send guard) keeps working unchanged.
create or replace function public.grovnews_eligible_contacts(p_contact_ids uuid[])
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (u.id) c.id
    from auth.users u
    join public.newsletter_contacts c
      on lower(c.email) = lower(u.email)
     and (c.user_id = u.id or c.user_id is null)
   where (p_contact_ids is null or c.id = any (p_contact_ids))
     and u.email is not null and u.email_confirmed_at is not null
     and public.grovnews_user_has_access(u.id)
   order by u.id, (c.user_id = u.id) desc nulls last, c.id;
$$;

-- ── 7.1 Operator copies: the admin-configured addresses, minus suppressed ──
create function public.grovnews_operator_recipients(p_token text)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_list text[];
begin
  if not (public.is_admin() or public.server_call_ok(p_token)) then raise exception 'forbidden'; end if;
  select coalesce(array_agg(e order by e), '{}'::text[]) into v_list
    from public.grovnews_settings s, unnest(s.operator_emails) e
   where s.id
     and not exists (select 1 from public.newsletter_suppressions x where lower(x.email) = lower(e));
  return coalesce(v_list, '{}'::text[]);
end $$;

revoke all on function public.grovnews_operator_recipients(text) from public, anon, authenticated;
grant execute on function public.grovnews_operator_recipients(text) to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. THE MAIL DOOR — anchors of the article, send_hour, one copy per address
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Everything 0125 §6 enforced still holds. Changed:
--   · an article edition's mail may link to the article AND to anchors of it
--     (#t1 … #t99, the topic sections); any other href is still refused, and
--     so is any query string (hrefs arrive untagged; tracking is added later);
--   · AUTOMATIC mail waits for send_hour (Europe/Warsaw): 'not_send_time';
--   · recipients are counted and queued once per address.
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
  if v_settings.send_hour is not null
     and extract(hour from now() at time zone 'Europe/Warsaw')::integer < v_settings.send_hour then
    raise exception 'not_send_time';
  end if;
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
       where m[1] !~ ('^https://[^/"?#]+/grovnews/' || v_slug || '(#t[1-9][0-9]?)?$')
    ) or not exists (
      select 1 from regexp_matches(p_body, 'href\s*=\s*"([^"]*)"', 'gi') m
    ) or p_body ~* '<[^>]*\mhref\s*=\s*[^"\s]'
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

  select count(distinct lower(c.email)) into v_eligible
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
  select v_campaign, 0, 'A', x.id, x.email, 'pending', now()
    from (
      select distinct on (lower(c.email)) c.id, c.email
        from public.newsletter_group_members m
        join public.newsletter_contacts c on c.id = m.contact_id
       where m.group_id = v_group
         and c.marketing_consent = true
         and c.unsubscribed_at is null
         and not exists (select 1 from public.newsletter_suppressions s where s.email = c.email)
       order by lower(c.email), c.id
    ) x
  on conflict do nothing;
  get diagnostics v_queued = row_count;

  update public.grovnews_editions
     set campaign_id = v_campaign, status = 'QUEUED', queued_at = now(),
         email_recipients = v_queued, failure_reason = null
   where id = v_edition.id;

  return jsonb_build_object('status', 'queued', 'campaign_id', v_campaign, 'recipients', v_queued);
end $$;

commit;

-- ROLLBACK (manual, in this order; the previous release's app ignores every
-- column and function added here):
--   re-run the 0125 bodies of grovnews_source_health_core, grovnews_ingest,
--     grovnews_select_top, grovnews_daily_candidates and grovnews_edition_send;
--   re-run the 0121 bodies of grovnews_job_context, grovnews_run_claim,
--     grovnews_run_update and grovnews_cron_tick;
--   re-run the 0122 body of grovnews_eligible_contacts;
--   drop function public.grovnews_operator_recipients(text);
--   alter table public.grovnews_research_items drop column language;
--   alter table public.grovnews_sources drop constraint grovnews_sources_auth_api_only,
--     drop constraint grovnews_sources_auth_header_shape, drop column auth_kind, drop column auth_header;
--   alter table public.grovnews_settings drop constraint grovnews_settings_model_needs_provider,
--     drop constraint grovnews_settings_hours_order, drop column ai_provider, drop column ai_model,
--     drop column publish_hour, drop column send_hour, drop column operator_emails;
--   drop function public.grovnews_operator_emails_ok(text[]);
--   (vault secrets named grovbase.grovnews_source.<id> may be removed with
--    public.secret_clear by an admin; nothing else references them)
