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
 */
import { SEED_PAGES, SEED_GLOBALS } from "../lib/cms-seed";

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

process.stdout.write(`${out.join("\n")}\n`);
