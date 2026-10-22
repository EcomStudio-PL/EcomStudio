-- 0146 — LEGAL DOCUMENTS V1: the hash-guarded import of a legal document
-- into the CMS (the schema part; the four Polish texts arrive in 0147).
--
-- A legal document is an ordinary CMS page whose text lives in ONE `legal`
-- section's `doc` field (lib/legal/content.ts, lib/legal/docs.ts). This file
-- adds the two things a migration needs to put a 75 000-character text there
-- without changing a single character of it:
--
--  1. legal_document_sources — the text in PARTS of at most 20 000
--     characters, cut at line ends, so a migration can be applied in pieces
--     of ~20 KB. The parts are invisible to visitors (admin-only table) and
--     an UPSERT rewrites a part only when its body differs, so loading them
--     twice writes nothing.
--  2. legal_document_import() — glues the parts of (slug, locale, version)
--     back together and refuses (`legal_import_mismatch`) unless the count,
--     the number of characters and the sha256 of the UTF-8 bytes are exactly
--     what the caller states. Only then, in one transaction:
--       · the page row is locked (and created as a draft if missing);
--       · when the document is already in the draft AND in the published
--         snapshot with that sha256 → 'unchanged', and nothing is written;
--       · otherwise the current draft is kept as a 'manual' version first,
--         the page's `legal` section receives the document (the other
--         languages keep theirs, or get status "soon"), every other section
--         of the page is hidden — never removed — and the page is published
--         with a 'publish' version labelled with the text's sha256.
--     The old html/description of the section and the hidden sections stay
--     in the version rows, so Strony WWW → Historia can restore them.
--
-- WHO MAY CALL IT: nobody but the migration (the table owner). EXECUTE is
-- revoked from public, anon and authenticated, and the function is INVOKER,
-- so even a mistaken grant would run under the caller's own RLS.
--
-- Nothing here touches consents, the recorded consent versions, the inline
-- editor or any other page. Re-runnable: a second apply changes nothing.
--
-- ROLLBACK: the import only adds rows and publishes; Strony WWW → Historia
-- restores the version labelled "Przed importem: …" of each page. The table
-- and the function can stay unused; retiring them is a separate migration
-- (statements that remove objects are not allowed here by the PROD
-- connector gate).

set local lock_timeout = '3s';

-- 1 ─────────────────────────────────────────────────────────────────────────
-- THE PARTS. doc_key = the page slug; doc_version = the document's own
-- version label ("1.0"). Concatenated in `part` order they are the text, byte
-- for byte — the import proves it with the sha256 before using them.
create table if not exists public.legal_document_sources (
  doc_key text not null,
  locale text not null constraint legal_document_sources_locale_check check (locale in ('pl', 'en', 'de')),
  doc_version text not null,
  part integer not null constraint legal_document_sources_part_check check (part >= 1),
  body text not null,
  created_at timestamptz not null default now(),
  constraint legal_document_sources_pkey primary key (doc_key, locale, doc_version, part)
);

comment on table public.legal_document_sources is
  'Legal document texts in parts (<= 20 000 characters, cut at line ends), loaded by migrations and assembled by legal_document_import(), which checks count, characters and sha256 before writing the CMS. Admin-only read; nobody writes but migrations.';

-- Supabase grants every new table to anon and authenticated by default, so
-- the revoke is what makes "no access" true. Admins may read (to compare a
-- page with its source); nobody writes around the migrations.
alter table public.legal_document_sources enable row level security;
revoke all on table public.legal_document_sources from public, anon, authenticated;
grant select on table public.legal_document_sources to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = 'legal_document_sources' and policyname = 'legal_document_sources_admin_select') then
    create policy legal_document_sources_admin_select on public.legal_document_sources
      for select to authenticated using (public.is_admin());
  end if;
end $$;

-- 2 ─────────────────────────────────────────────────────────────────────────
-- THE IMPORT. Every check that can refuse runs BEFORE the first write, so a
-- refusal (or a part that has not arrived yet) changes nothing at all.
create or replace function public.legal_document_import(
  p_slug text, p_locale text, p_version text, p_effective date, p_title text,
  p_parts integer, p_chars integer, p_sha256 text
)
returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  v_text text;
  v_count integer;
  v_sha text;
  v_page public.cms_pages%rowtype;
  v_block public.cms_blocks%rowtype;
  v_has_block boolean;
  v_created boolean := false;
  v_doc jsonb;
  v_loc text;
  v_snap jsonb;
  v_version integer;
  v_now timestamptz := now();
begin
  -- 0. The arguments. The limits are lib/legal/content.ts's (MAX_LEGAL_CHARS,
  -- MAX_LEGAL_VERSION), so an imported document is one the editor accepts.
  if p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'legal_import_bad_args: slug %', coalesce(p_slug, 'null');
  end if;
  if p_locale is null or p_locale not in ('pl', 'en', 'de') then
    raise exception 'legal_import_bad_args: locale %', coalesce(p_locale, 'null');
  end if;
  if p_version is null or btrim(p_version) = '' or btrim(p_version) <> p_version or char_length(p_version) > 32 then
    raise exception 'legal_import_bad_args: version %', coalesce(p_version, 'null');
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception 'legal_import_bad_args: title';
  end if;
  if p_parts is null or p_parts < 1 or p_chars is null or p_chars < 1 or p_chars > 1000000 then
    raise exception 'legal_import_bad_args: parts % chars %', p_parts, p_chars;
  end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'legal_import_bad_args: sha256';
  end if;

  -- a. The text, from its parts 1..p_parts, proven before it is used.
  select string_agg(s.body, '' order by s.part), count(*)
    into v_text, v_count
    from public.legal_document_sources s
    where s.doc_key = p_slug and s.locale = p_locale and s.doc_version = p_version
      and s.part between 1 and p_parts;
  if v_count <> p_parts then
    raise exception 'legal_import_mismatch: % (%) v%: % of % parts present', p_slug, p_locale, p_version, v_count, p_parts;
  end if;
  -- (null-safe: no text at all must never slip through as "no difference")
  if char_length(v_text) is distinct from p_chars then
    raise exception 'legal_import_mismatch: % (%) v%: % characters, expected %', p_slug, p_locale, p_version, char_length(v_text), p_chars;
  end if;
  v_sha := encode(extensions.digest(convert_to(v_text, 'UTF8'), 'sha256'), 'hex');
  if v_sha is distinct from p_sha256 then
    raise exception 'legal_import_mismatch: % (%) v%: sha256 %, expected %', p_slug, p_locale, p_version, v_sha, p_sha256;
  end if;
  -- normalizeLegalText's two rules: an editor save of a text with a CR or a
  -- leading BOM would change it, so such a text is not "the stored text".
  if strpos(v_text, chr(13)) > 0 or left(v_text, 1) = chr(65279) then
    raise exception 'legal_import_mismatch: % (%) v%: line endings or BOM not normalised', p_slug, p_locale, p_version;
  end if;

  -- b. The page, locked. A missing one is created as a draft in the footer's
  -- legal group (navOrder of lib/legal/docs.ts); an existing one keeps its
  -- title, menu place and SEO.
  select * into v_page from public.cms_pages where slug = p_slug for update;
  if not found then
    insert into public.cms_pages (slug, title, status, kind, nav_group, nav_order, seo)
    values (p_slug, p_title, 'draft', 'standard', 'legal',
            case p_slug when 'regulamin' then 10 when 'polityka-prywatnosci' then 20
                        when 'polityka-cookies' then 30 when 'umowa-powierzenia-danych' then 40 else 100 end,
            jsonb_build_object('pl', jsonb_build_object('title', p_title)))
    on conflict (slug) do nothing;
    v_created := found;
    select * into v_page from public.cms_pages where slug = p_slug for update;
  end if;
  if v_page.kind <> 'standard' then
    raise exception 'legal_import_page_kind: % is a % page', p_slug, v_page.kind;
  end if;

  -- c. The section that holds the document: the first `legal` one that
  -- already has a doc, else the first `legal` one, else a new one. Every
  -- section of the page is locked, so the snapshots below are consistent.
  perform 1 from public.cms_blocks where page_id = v_page.id for update;
  select * into v_block from public.cms_blocks b
    where b.page_id = v_page.id and b.type = 'legal'
    order by (jsonb_typeof(b.content -> 'doc') is not distinct from 'object') desc, b.sort_order, b.created_at, b.id
    limit 1;
  v_has_block := found;

  -- d. Already there — in the draft (the text itself, not only its label)
  -- and in the published snapshot: nothing to do, nothing written.
  if v_has_block
     and v_block.content -> 'doc' -> p_locale ->> 'sha256' = p_sha256
     and v_block.content -> 'doc' -> p_locale ->> 'version' = p_version
     and encode(extensions.digest(convert_to(coalesce(v_block.content -> 'doc' -> p_locale ->> 'text', ''), 'UTF8'), 'sha256'), 'hex') = p_sha256
     and v_page.status = 'published'
     and jsonb_typeof(v_page.published_snapshot) = 'array'
     and exists (
       select 1 from jsonb_array_elements(v_page.published_snapshot) e
       where e ->> 'id' = v_block.id::text
         and e -> 'content' -> 'doc' -> p_locale ->> 'sha256' = p_sha256
         and encode(extensions.digest(convert_to(coalesce(e -> 'content' -> 'doc' -> p_locale ->> 'text', ''), 'UTF8'), 'sha256'), 'hex') = p_sha256)
  then
    return jsonb_build_object('status', 'unchanged', 'page_id', v_page.id, 'block_id', v_block.id,
      'chars', p_chars, 'sha256', p_sha256, 'version', p_version);
  end if;

  -- e. The draft as it is now, kept first (the shape of lib/services/cms.ts
  -- snapshotOf), so the old sections can be restored from Historia.
  if exists (select 1 from public.cms_blocks where page_id = v_page.id) then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', b.id, 'type', b.type, 'sort_order', b.sort_order, 'visible', b.visible,
             'content', b.content, 'style', coalesce(b.style, '{}'::jsonb), 'code', coalesce(b.code, '{}'::jsonb),
             'analytics_id', b.analytics_id, 'anchor', b.anchor,
             'show_from', b.show_from, 'show_until', b.show_until, 'audience', coalesce(b.audience, 'everyone')
           ) order by b.sort_order, b.created_at, b.id), '[]'::jsonb)
      into v_snap
      from public.cms_blocks b where b.page_id = v_page.id;
    select coalesce(max(version), 0) + 1 into v_version from public.cms_page_versions where page_id = v_page.id;
    insert into public.cms_page_versions (page_id, version, snapshot, seo, reason, label)
    values (v_page.id, v_version, v_snap, coalesce(v_page.seo, '{}'::jsonb), 'manual',
            format('Przed importem: %s v%s (%s)', p_title, p_version, p_locale));
  end if;

  -- f. The document. This language is replaced as a whole; the others keep
  -- what they have, or start as "soon" (lib/legal/content.ts emptyLocaleDoc).
  v_doc := case when v_has_block and jsonb_typeof(v_block.content -> 'doc') = 'object'
                then v_block.content -> 'doc' else '{}'::jsonb end;
  foreach v_loc in array array['pl', 'en', 'de'] loop
    if v_loc <> p_locale and jsonb_typeof(v_doc -> v_loc) is distinct from 'object' then
      v_doc := v_doc || jsonb_build_object(v_loc, jsonb_build_object(
        'status', 'soon', 'text', '', 'version', '', 'effective', null));
    end if;
  end loop;
  v_doc := v_doc || jsonb_build_object(p_locale, jsonb_build_object(
    'status', 'active', 'text', v_text, 'version', p_version,
    'effective', to_char(p_effective, 'YYYY-MM-DD'), 'sha256', v_sha, 'chars', p_chars));

  -- A legal document is shown to everybody, always: no window, no audience.
  if v_has_block then
    update public.cms_blocks
      set content = jsonb_build_object('doc', v_doc), visible = true,
          show_from = null, show_until = null, audience = 'everyone', updated_at = v_now
      where id = v_block.id
      returning * into v_block;
  else
    insert into public.cms_blocks (page_id, type, sort_order, visible, content, style)
    values (v_page.id, 'legal',
            coalesce((select min(b.sort_order) - 1 from public.cms_blocks b where b.page_id = v_page.id), 0),
            true, jsonb_build_object('doc', v_doc), '{"base":{"width":"narrow"}}'::jsonb)
    returning * into v_block;
  end if;

  -- g. Every other section of the page is hidden, never removed.
  update public.cms_blocks set visible = false, updated_at = v_now
    where page_id = v_page.id and id <> v_block.id and visible;

  -- h. Publish, as publishPage does: the version row first, then the page.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b.id, 'type', b.type, 'sort_order', b.sort_order, 'visible', b.visible,
           'content', b.content, 'style', coalesce(b.style, '{}'::jsonb), 'code', coalesce(b.code, '{}'::jsonb),
           'analytics_id', b.analytics_id, 'anchor', b.anchor,
           'show_from', b.show_from, 'show_until', b.show_until, 'audience', coalesce(b.audience, 'everyone')
         ) order by b.sort_order, b.created_at, b.id), '[]'::jsonb)
    into v_snap
    from public.cms_blocks b where b.page_id = v_page.id;
  select coalesce(max(version), 0) + 1 into v_version from public.cms_page_versions where page_id = v_page.id;
  insert into public.cms_page_versions (page_id, version, snapshot, seo, reason, label)
  values (v_page.id, v_version, v_snap, coalesce(v_page.seo, '{}'::jsonb), 'publish',
          format('Import: %s v%s (%s) sha256 %s', p_title, p_version, p_locale, left(v_sha, 12)));
  update public.cms_pages
    set published_snapshot = v_snap, status = 'published', published_at = v_now,
        updated_at = v_now, scheduled_at = null
    where id = v_page.id;

  -- i.
  return jsonb_build_object('status', 'imported', 'page_id', v_page.id, 'block_id', v_block.id,
    'chars', p_chars, 'sha256', v_sha, 'version', p_version,
    'page_created', v_created, 'published_version', v_version);
end;
$$;

comment on function public.legal_document_import(text, text, text, date, text, integer, integer, text) is
  'Imports one language of one legal document from legal_document_sources into its CMS page and publishes it. Refuses (legal_import_mismatch, nothing written) unless parts, characters and sha256 match; returns status unchanged (nothing written) when the draft and the published page already hold that text. Migrations only.';

revoke all on function public.legal_document_import(text, text, text, date, text, integer, integer, text)
  from public, anon, authenticated;
