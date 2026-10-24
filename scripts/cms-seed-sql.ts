/**
 * Emit the SQL that seeds the public website, from lib/cms-seed.ts.
 *
 * The seed itself is TypeScript — reviewable, typed, and re-runnable from the
 * admin panel. This script prints the SAME content as SQL so it can be applied
 * once through the normal migration path, which is how the production database
 * is allowed to change. There is one source of the copy, not two.
 *
 * The emitted SQL follows the same two rules as the action:
 *   · a page that already exists keeps its title, slug, status and SEO;
 *   · sections are inserted ONLY into a page that has none.
 * So it can be applied twice and the second run does nothing.
 *
 *   npm run cms:seed-sql > /tmp/seed.sql
 *
 * RELEASE MODE — `npm run cms:seed-sql -- --release` prints migration 0148
 * (Public pages V1) instead: O nas and Kontakt are REPLACED with their seed
 * layout and PUBLISHED, the footer gets its links, headings and brand line,
 * and the contact form's topic list gains `question`. See releaseSql().
 */
import { ABOUT_V1, SEED_PAGES, SEED_GLOBALS, FOOTER_BRAND_LINE, FOOTER_HEADINGS, FOOTER_ITEMS } from "../lib/cms-seed";

/** Postgres string literal. Doubling the quote is the whole of the escaping
 *  rule, and JSON.stringify has already handled everything inside the JSON. */
const lit = (value: string) => `'${value.replace(/'/g, "''")}'`;
const json = (value: unknown) => `${lit(JSON.stringify(value))}::jsonb`;

const out: string[] = [];

out.push(`-- THE PUBLIC WEBSITE, SEEDED AS DRAFTS.
--
-- Generated from lib/cms-seed.ts by scripts/cms-seed-sql.ts. Do not edit by
-- hand: edit the TypeScript and regenerate, or the panel's own "Utwórz strony
-- startowe" button will disagree with this file.
--
-- NOTHING HERE PUBLISHES ANYTHING. Every page is created as a draft, the
-- homepage mode is not touched, and the waiting-list page stays the public
-- front door. A page that already exists is left alone; sections are added
-- only to a page that has none.`);

for (const page of SEED_PAGES) {
  out.push(`
-- ── ${page.title} (/${page.slug}) ──────────────────────────────────────────
insert into public.cms_pages (slug, title, status, kind, nav_group, nav_order, seo)
values (${lit(page.slug)}, ${lit(page.title)}, 'draft', 'standard',
        ${page.navGroup ? lit(page.navGroup) : "null"}, ${page.navOrder}, ${json(page.seo)})
on conflict (slug) do nothing;`);

  if (page.sections.length === 0) continue;

  const values = page.sections.map((section, i) => `    (${i}, ${lit(section.type)}, ${json(section.content)}, ${json(section.style ?? {})}, ${section.anchor ? lit(section.anchor) : "null"}, ${section.analyticsId ? lit(section.analyticsId) : "null"})`).join(",\n");

  if (page.replaceExisting) {
    // A marker unique to this layout: once it is present, the page has
    // already been rebuilt and both statements below become no-ops. Without
    // it, re-running would snapshot and rebuild on every application.
    const marker = page.sections.find((s) => s.analyticsId)?.analyticsId;
    // `b2`, not `b`: the DELETE below already binds `b` to the row being
    // deleted, and reusing the name inside the subquery would shadow it and
    // make the guard test the wrong row.
    const notSeeded = marker
      ? `and not exists (select 1 from public.cms_blocks b2 where b2.page_id = p.id and b2.analytics_id = ${lit(marker)})`
      : "";
    // KEEP WHAT IS BEING REPLACED. The outgoing draft becomes a numbered
    // version, so the previous layout stays one click away in Historia and
    // this migration destroys nothing.
    out.push(`
insert into public.cms_page_versions (page_id, version, snapshot, seo, reason, label)
select p.id,
       coalesce((select max(v.version) from public.cms_page_versions v where v.page_id = p.id), 0) + 1,
       coalesce(
         (select jsonb_agg(jsonb_build_object(
            'id', b.id, 'type', b.type, 'sort_order', b.sort_order,
            'visible', b.visible, 'content', b.content,
            'style', b.style, 'code', b.code,
            'analytics_id', b.analytics_id, 'anchor', b.anchor
          ) order by b.sort_order)
          from public.cms_blocks b where b.page_id = p.id),
         '[]'::jsonb),
       coalesce(p.seo, '{}'::jsonb),
       'manual',
       'poprzedni układ strony głównej'
from public.cms_pages p
where p.slug = ${lit(page.slug)}
  and exists (select 1 from public.cms_blocks b where b.page_id = p.id)
  ${notSeeded};

delete from public.cms_blocks b
using public.cms_pages p
where b.page_id = p.id and p.slug = ${lit(page.slug)}
  ${notSeeded};`);
  }

  out.push(`
insert into public.cms_blocks (page_id, sort_order, type, content, style, anchor, analytics_id)
select p.id, v.sort_order, v.type, v.content, v.style, v.anchor, v.analytics_id
from public.cms_pages p
cross join (values
${values}
) as v(sort_order, type, content, style, anchor, analytics_id)
where p.slug = ${lit(page.slug)}
  -- Only a page nobody has arranged yet. (For the homepage the delete above
  -- has just emptied it, so this is what makes the replace idempotent too.)
  and not exists (select 1 from public.cms_blocks b where b.page_id = p.id);`);
}

out.push(`
-- ── The shared header and footer ─────────────────────────────────────────
-- Only a slot still holding its empty default is filled, so an edited header
-- is never overwritten.`);

for (const [slot, seed] of Object.entries(SEED_GLOBALS)) {
  out.push(`update public.cms_global_sections
set content = ${json(seed.content)},
    published_snapshot = ${json(seed.content)},
    visible = ${seed.visible},
    published_at = now(),
    updated_at = now()
where slot = ${lit(slot)} and content = '{}'::jsonb;`);
}

/**
 * PUBLIC PAGES V1 — the two pages the brief rebuilds, released.
 *
 * Per page, in ONE transaction (a DO block), and only while the page does not
 * already carry its new layout (the marker is the hero's analytics id, unique
 * to it — so applying this twice writes nothing the second time, and a page
 * an admin has since re-arranged keeps their work as long as that hero stays):
 *
 *   1. the outgoing draft is kept as a labelled version ("Przed Public pages
 *      V1"), so the previous page is one click away in Historia;
 *   2. its sections are replaced by the seed's;
 *   3. the menu group, order and SEO come from the seed; the page wears the
 *      site's own header and footer;
 *   4. it is PUBLISHED exactly the way lib/services/cms.ts publishPage does:
 *      the same snapshot shape (snapshotOf), written as a 'publish' version
 *      first and then as the page's published_snapshot.
 *
 * The footer is PATCHED, never replaced: links, headings and the brand line
 * are added only while it still holds no links of its own, and the tagline an
 * admin typed is kept.
 */
const RELEASE_SLUGS = ["o-nas", "kontakt"] as const;

const BLOCK_JSON = (alias: string) => `jsonb_build_object(
            'id', ${alias}.id, 'type', ${alias}.type, 'sort_order', ${alias}.sort_order,
            'visible', ${alias}.visible, 'content', ${alias}.content,
            'style', ${alias}.style, 'code', ${alias}.code,
            'analytics_id', ${alias}.analytics_id, 'anchor', ${alias}.anchor,
            'show_from', ${alias}.show_from, 'show_until', ${alias}.show_until,
            'audience', ${alias}.audience
          )`;

function releaseSql(): string {
  const parts: string[] = [];
  parts.push(`-- 0148 — PUBLIC PAGES V1: Kontakt, O nas and the site footer.
--
-- GENERATED from lib/cms-seed.ts by \`npm run cms:seed-sql -- --release\`. Do
-- not edit by hand: change the TypeScript and regenerate, so the panel's own
-- seed and this file can never disagree.
--
-- APPLY ONLY AFTER the Public pages V1 code is live: the two new section
-- types (page_hero, contact_hub) render as nothing in the previous renderer.
--
-- Rolling back: Strony WWW → O nas / Kontakt → Historia → "Przed Public pages
-- V1" restores the previous layout (Kontakt was a draft before this; O nas was
-- published). The topic list keeps 'question' — harmless to older code, which
-- never sends it.

-- ── 1. THE CONTACT FORM'S TOPICS ─────────────────────────────────────────
-- "Pytanie" joins the closed list (lib/cms-forms.ts CONTACT_TOPICS). The
-- function is 0086's — the same checks, limit and grants — with the one value
-- added; it is still the only way anon reaches contact_messages.
alter table public.contact_messages drop constraint if exists contact_messages_topic_check;
alter table public.contact_messages add constraint contact_messages_topic_check
  check (topic in ('question', 'sales', 'support', 'partnership', 'press', 'other'));

create or replace function public.submit_contact_message(
  p_topic text,
  p_name text,
  p_email text,
  p_message text,
  p_locale text default 'pl',
  p_source text default null,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_name text := trim(coalesce(p_name, ''));
  v_message text := trim(coalesce(p_message, ''));
  v_topic text := coalesce(nullif(trim(coalesce(p_topic, '')), ''), 'other');
  v_recent integer;
  v_id uuid;
begin
  if v_email !~ '^[^@\\s]+@[^@\\s.]+\\.[^@\\s]{2,}$' then
    return jsonb_build_object('status', 'invalid');
  end if;
  if length(v_message) < 5 or length(v_message) > 4000 then
    return jsonb_build_object('status', 'invalid');
  end if;
  if length(v_name) = 0 or length(v_name) > 120 then
    return jsonb_build_object('status', 'invalid');
  end if;
  if v_topic not in ('question', 'sales', 'support', 'partnership', 'press', 'other') then
    v_topic := 'other';
  end if;

  select count(*) into v_recent from public.contact_messages
    where email = v_email and created_at > now() - interval '1 hour';
  if v_recent >= 5 then
    return jsonb_build_object('status', 'rate_limited');
  end if;

  insert into public.contact_messages (topic, name, email, message, locale, source, metadata)
  values (
    v_topic, left(v_name, 120), left(v_email, 254), left(v_message, 4000),
    coalesce(nullif(p_locale, ''), 'pl'), left(coalesce(p_source, ''), 80),
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return jsonb_build_object('status', 'created', 'id', v_id);
end $$;

revoke all on function public.submit_contact_message(text, text, text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.submit_contact_message(text, text, text, text, text, text, jsonb)
  to anon, authenticated;`);

  for (const slug of RELEASE_SLUGS) {
    // 0148 released O nas V1. The seed has moved on to V2 (released by 0151,
    // --about-v2 below); this committed migration keeps generating V1.
    const page = slug === "o-nas" ? ABOUT_V1 : SEED_PAGES.find((p) => p.slug === slug);
    if (!page) throw new Error(`no seed page ${slug}`);
    const marker = page.sections[0]?.analyticsId;
    if (!marker) throw new Error(`${slug}: the first section needs an analyticsId (the release marker)`);
    const values = page.sections.map((section, i) => `      (${i}, ${lit(section.type)}, ${json(section.content)}, ${json(section.style ?? {})}, ${section.anchor ? lit(section.anchor) : "null"}, ${section.analyticsId ? lit(section.analyticsId) : "null"})`).join(",\n");
    parts.push(`
-- ── 2. ${page.title} (/${page.slug}) — replaced and published ───────────────
do $release$
declare
  v_page uuid;
  v_seo jsonb;
  v_snapshot jsonb;
begin
  insert into public.cms_pages (slug, title, status, kind)
  values (${lit(page.slug)}, ${lit(page.title)}, 'draft', 'standard')
  on conflict (slug) do nothing;
  select id into v_page from public.cms_pages where slug = ${lit(page.slug)};

  if exists (select 1 from public.cms_blocks b where b.page_id = v_page and b.analytics_id = ${lit(marker)}) then
    raise notice '${page.slug}: already on the Public pages V1 layout, nothing written';
    return;
  end if;

  -- 1. Keep what is being replaced.
  if exists (select 1 from public.cms_blocks b where b.page_id = v_page) then
    insert into public.cms_page_versions (page_id, version, snapshot, seo, reason, label)
    select v_page,
           coalesce((select max(v.version) from public.cms_page_versions v where v.page_id = v_page), 0) + 1,
           (select jsonb_agg(${BLOCK_JSON("b")} order by b.sort_order)
              from public.cms_blocks b where b.page_id = v_page),
           coalesce((select p.seo from public.cms_pages p where p.id = v_page), '{}'::jsonb),
           'manual',
           'Przed Public pages V1';
  end if;

  -- 2. The new sections.
  delete from public.cms_blocks where page_id = v_page;
  insert into public.cms_blocks (page_id, sort_order, type, content, style, anchor, analytics_id)
  select v_page, v.sort_order, v.type, v.content, v.style, v.anchor, v.analytics_id
  from (values
${values}
  ) as v(sort_order, type, content, style, anchor, analytics_id);

  -- 3. Menu group, SEO, the site's own chrome.
  v_seo := ${json(page.seo)};
  update public.cms_pages
     set nav_group = ${page.navGroup ? lit(page.navGroup) : "null"},
         nav_order = ${page.navOrder},
         seo = v_seo,
         header_mode = 'global',
         footer_mode = 'global',
         updated_at = now()
   where id = v_page;

  -- 4. Publish, as publishPage does: the version first, then the page.
  select jsonb_agg(${BLOCK_JSON("b")} order by b.sort_order)
    into v_snapshot
    from public.cms_blocks b where b.page_id = v_page;
  insert into public.cms_page_versions (page_id, version, snapshot, seo, reason, label)
  values (
    v_page,
    coalesce((select max(v.version) from public.cms_page_versions v where v.page_id = v_page), 0) + 1,
    v_snapshot, v_seo, 'publish', 'Public pages V1'
  );
  update public.cms_pages
     set published_snapshot = v_snapshot,
         status = 'published',
         published_at = now(),
         updated_at = now(),
         scheduled_at = null
   where id = v_page;
end $release$;`);
  }

  const patch = { subtitle: FOOTER_BRAND_LINE, items: FOOTER_ITEMS, fields: FOOTER_HEADINGS };
  parts.push(`
-- ── 3. THE FOOTER — links, column headings, brand line ────────────────────
-- Draft and published copy together (the footer has no separate draft today),
-- and only while neither holds links of its own: an admin's footer is theirs.
update public.cms_global_sections
   set content = coalesce(content, '{}'::jsonb) || ${json(patch)},
       published_snapshot = coalesce(published_snapshot, content, '{}'::jsonb) || ${json(patch)},
       published_at = now(),
       updated_at = now()
 where slot = 'footer'
   and coalesce(jsonb_array_length(content->'items'), 0) = 0
   and coalesce(jsonb_array_length(published_snapshot->'items'), 0) = 0;`);

  return `${parts.join("\n")}\n`;
}

/**
 * O NAS V2 — `npm run cms:seed-sql -- --about-v2` prints migration 0151.
 *
 * The same four steps as releaseSql(), for one page, in one DO block:
 *   1. the outgoing page is kept as a labelled version ("Przed O nas V2");
 *   2. its sections are replaced by the nine about_* sections of the seed;
 *   3. its menu group, order and SEO come from the seed;
 *   4. it is published the way publishPage does (a 'publish' version, then
 *      the page's published_snapshot).
 * It runs once: a page that already has an `about_hero` section is left as
 * it is, so applying it twice — or after an admin has started editing V2 —
 * writes nothing. The V2 hero keeps the analytics id `about.hero`, which is
 * 0148's own marker, so 0148 can never put V1 back over it either.
 */
function aboutV2Sql(): string {
  const page = SEED_PAGES.find((p) => p.slug === "o-nas");
  if (!page || page.sections[0]?.type !== "about_hero") throw new Error("the seed's O nas is not V2");
  const values = page.sections.map((section, i) => `      (${i}, ${lit(section.type)}, ${json(section.content)}, ${json(section.style ?? {})}, ${section.anchor ? lit(section.anchor) : "null"}, ${section.analyticsId ? lit(section.analyticsId) : "null"})`).join(",\n");
  return `-- 0151 — O NAS V2: the about page as a product page (nine about_* sections).
--
-- GENERATED from lib/cms-seed.ts by \`npm run cms:seed-sql -- --about-v2\`. Do
-- not edit by hand: change the TypeScript and regenerate.
--
-- Content only: no table, no column, no function. The pictures are media
-- slots (about.*), empty until an admin fills them in "Edytuj stronę"; the
-- page draws neutral canvases until then. The sixth value and the questions
-- about photos and company details are switched OFF and hold placeholders —
-- the renderer never shows a "[…]" text, switched on or not.

do $about$
declare
  v_page uuid;
  v_seo jsonb;
  v_snapshot jsonb;
begin
  insert into public.cms_pages (slug, title, status, kind)
  values (${lit(page.slug)}, ${lit(page.title)}, 'draft', 'standard')
  on conflict (slug) do nothing;
  select id into v_page from public.cms_pages where slug = ${lit(page.slug)};

  if exists (select 1 from public.cms_blocks b where b.page_id = v_page and b.type = 'about_hero') then
    raise notice 'o-nas: already on the O nas V2 layout, nothing written';
    return;
  end if;

  -- 1. Keep what is being replaced.
  if exists (select 1 from public.cms_blocks b where b.page_id = v_page) then
    insert into public.cms_page_versions (page_id, version, snapshot, seo, reason, label)
    select v_page,
           coalesce((select max(v.version) from public.cms_page_versions v where v.page_id = v_page), 0) + 1,
           (select jsonb_agg(${BLOCK_JSON("b")} order by b.sort_order)
              from public.cms_blocks b where b.page_id = v_page),
           coalesce((select p.seo from public.cms_pages p where p.id = v_page), '{}'::jsonb),
           'manual',
           'Przed O nas V2';
  end if;

  -- 2. The new sections.
  delete from public.cms_blocks where page_id = v_page;
  insert into public.cms_blocks (page_id, sort_order, type, content, style, anchor, analytics_id)
  select v_page, v.sort_order, v.type, v.content, v.style, v.anchor, v.analytics_id
  from (values
${values}
  ) as v(sort_order, type, content, style, anchor, analytics_id);

  -- 3. Menu group, SEO, the site's own chrome.
  v_seo := ${json(page.seo)};
  update public.cms_pages
     set nav_group = ${page.navGroup ? lit(page.navGroup) : "null"},
         nav_order = ${page.navOrder},
         seo = v_seo,
         header_mode = 'global',
         footer_mode = 'global',
         updated_at = now()
   where id = v_page;

  -- 4. Publish, as publishPage does: the version first, then the page.
  select jsonb_agg(${BLOCK_JSON("b")} order by b.sort_order)
    into v_snapshot
    from public.cms_blocks b where b.page_id = v_page;
  insert into public.cms_page_versions (page_id, version, snapshot, seo, reason, label)
  values (
    v_page,
    coalesce((select max(v.version) from public.cms_page_versions v where v.page_id = v_page), 0) + 1,
    v_snapshot, v_seo, 'publish', 'O nas V2'
  );
  update public.cms_pages
     set published_snapshot = v_snapshot,
         status = 'published',
         published_at = now(),
         updated_at = now(),
         scheduled_at = null
   where id = v_page;
end $about$;
`;
}

process.stdout.write(
  process.argv.includes("--release") ? releaseSql()
    : process.argv.includes("--about-v2") ? aboutV2Sql()
    : `${out.join("\n")}\n`,
);
