-- ============================================================================
-- 0124 — GROVNEWS, STAGE 4: the public SEO layer (/blog)
-- ============================================================================
--
-- ONE NEW TABLE AND THREE READ FUNCTIONS. Nothing that exists is altered: the
-- premium posts, their access rule, the research tables, the editions, the
-- billing and the newsletter are not touched by anything below.
--
--   grovnews_public_articles   a PUBLIC article — a separate document an
--                              admin writes (by hand or from an AI draft) and
--                              publishes to /blog. It may be DERIVED from a
--                              premium post (source_grovnews_post_id), but it
--                              is never that post with the gate taken off:
--                              its text is its own column, edited on its own.
--
-- WHO CAN DO WHAT — enforced here, not in the UI:
--
--   the table     admin: everything (RLS). Nobody else reads it DIRECTLY —
--                 not a customer, not a subscriber, not an anonymous visitor.
--                 There is no customer or anon policy, and anon holds no
--                 table privilege at all.
--   the public    reads through three SECURITY DEFINER functions that return
--                 ONLY a published article (status PUBLISHED, published_at in
--                 the past) and ONLY the columns a page shows. A draft, an
--                 archived article, the internal note, the author, the link
--                 to the premium post it came from — none of it leaves the
--                 database through them. They read this table and the
--                 category names and NOTHING else: no premium post, no
--                 research item, no edition.
--
-- A premium post can have at most one public version (partial unique index),
-- so "Utwórz wersję publiczną SEO" opens the existing one instead of
-- producing a second article about the same thing.

begin;

-- ── 1. THE TABLE ────────────────────────────────────────────────────────────
create table public.grovnews_public_articles (
  id                       uuid primary key default gen_random_uuid(),
  -- Provenance only. Admin-visible; never returned by the public functions.
  source_grovnews_post_id  uuid references public.grovnews_posts (id) on delete set null,
  slug                     text not null unique
                           check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 120),
  title                    text not null check (length(btrim(title)) between 1 and 200),
  excerpt                  text not null default '' check (length(excerpt) <= 600),
  -- Same plain-text-with-marks format as the premium posts (lib/grovnews.ts
  -- parseContent): rendered by React, never injected as HTML.
  content                  text not null default '' check (length(content) <= 200000),
  category_id              uuid references public.grovnews_categories (id) on delete set null,
  tags                     text[] not null default '{}' check (cardinality(tags) <= 20),
  cover_url                text check (cover_url is null or cover_url ~* '^https://'),
  cover_alt                text check (cover_alt is null or length(cover_alt) <= 300),
  seo_title                text check (seo_title is null or length(seo_title) <= 200),
  seo_description          text check (seo_description is null or length(seo_description) <= 400),
  -- Empty means "/blog/<slug>" — the article's own address.
  canonical_url            text check (canonical_url is null
                           or (canonical_url ~* '^https://' and length(canonical_url) <= 2000)),
  og_title                 text check (og_title is null or length(og_title) <= 200),
  og_description           text check (og_description is null or length(og_description) <= 400),
  -- [{q, a}] shown on the page; the FAQ schema is emitted only when it is.
  faq                      jsonb not null default '[]'::jsonb
                           check (jsonb_typeof(faq) = 'array' and jsonb_array_length(faq) <= 10),
  -- [{url, title}], https only (checked on write and again on render).
  sources                  jsonb not null default '[]'::jsonb
                           check (jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) <= 30),
  -- Other public articles to link to; one that is not published is skipped.
  related_slugs            text[] not null default '{}' check (cardinality(related_slugs) <= 6),
  language                 text not null default 'pl' check (language in ('pl', 'en', 'de')),
  schema_type              text not null default 'Article' check (schema_type in ('Article', 'NewsArticle')),
  noindex                  boolean not null default false,
  estimated_read_minutes   integer not null default 1 check (estimated_read_minutes between 1 and 240),
  status                   text not null default 'DRAFT'
                           check (status in ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  published_at             timestamptz,
  -- Admin prose. Never returned by the public functions.
  internal_note            text check (internal_note is null or length(internal_note) <= 2000),
  created_by               uuid references auth.users (id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint grovnews_public_articles_published_is_dated check (status <> 'PUBLISHED' or published_at is not null)
);

create unique index grovnews_public_articles_one_per_post
  on public.grovnews_public_articles (source_grovnews_post_id) where source_grovnews_post_id is not null;
create index grovnews_public_articles_feed_idx
  on public.grovnews_public_articles (published_at desc) where status = 'PUBLISHED';
create index grovnews_public_articles_status_idx
  on public.grovnews_public_articles (status, updated_at desc);
create index grovnews_public_articles_category_idx
  on public.grovnews_public_articles (category_id);

create trigger grovnews_public_articles_touch before update on public.grovnews_public_articles
  for each row execute function public.touch_updated_at();

alter table public.grovnews_public_articles enable row level security;

-- The client roles get exactly what the admin screens need; anon gets nothing.
revoke all on table public.grovnews_public_articles from anon, authenticated;
grant select, insert, update, delete on table public.grovnews_public_articles to authenticated;

create policy grovnews_public_articles_admin on public.grovnews_public_articles
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ── 2. THE PUBLIC READS ─────────────────────────────────────────────────────
-- Each one names its columns. Adding a column to the table does not add it to
-- a page: somebody has to add it HERE, on purpose.

-- The /blog list (optionally one category), newest first.
create function public.grovnews_public_feed(p_limit integer default 24, p_category text default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(s.card order by s.published_at desc, s.slug), '[]'::jsonb)
  from (
    select a.published_at, a.slug,
      jsonb_build_object(
        'slug', a.slug, 'title', a.title, 'excerpt', a.excerpt,
        'cover_url', a.cover_url, 'cover_alt', a.cover_alt,
        'published_at', a.published_at, 'read_minutes', a.estimated_read_minutes,
        'language', a.language,
        'category', case when c.id is null then null
                         else jsonb_build_object('slug', c.slug, 'name', c.name) end
      ) as card
    from public.grovnews_public_articles a
    left join public.grovnews_categories c on c.id = a.category_id and c.is_active
    where a.status = 'PUBLISHED' and a.published_at <= now()
      and (p_category is null or c.slug = p_category)
    order by a.published_at desc, a.slug
    limit least(greatest(coalesce(p_limit, 24), 1), 100)
  ) s;
$$;

-- One published article by slug, or null.
create function public.grovnews_public_article(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'slug', a.slug, 'title', a.title, 'excerpt', a.excerpt, 'content', a.content,
    'cover_url', a.cover_url, 'cover_alt', a.cover_alt,
    'tags', to_jsonb(a.tags), 'sources', a.sources, 'faq', a.faq,
    -- Only related articles that are themselves public, in the admin's order:
    -- the slug of a draft is not something a visitor may learn from here.
    'related_slugs', coalesce((
      select jsonb_agg(u.s order by u.ord)
      from unnest(a.related_slugs) with ordinality as u(s, ord)
      where exists (select 1 from public.grovnews_public_articles r
                    where r.slug = u.s and r.status = 'PUBLISHED' and r.published_at <= now())
    ), '[]'::jsonb),
    'seo_title', a.seo_title, 'seo_description', a.seo_description, 'canonical_url', a.canonical_url,
    'og_title', a.og_title, 'og_description', a.og_description,
    'noindex', a.noindex, 'language', a.language, 'schema_type', a.schema_type,
    'published_at', a.published_at, 'updated_at', a.updated_at, 'read_minutes', a.estimated_read_minutes,
    'category', case when c.id is null then null
                     else jsonb_build_object('slug', c.slug, 'name', c.name) end
  )
  from public.grovnews_public_articles a
  left join public.grovnews_categories c on c.id = a.category_id and c.is_active
  where a.slug = p_slug and a.status = 'PUBLISHED' and a.published_at <= now();
$$;

-- What the sitemap lists: published and indexable only.
create function public.grovnews_public_sitemap()
returns table (slug text, last_modified timestamptz, canonical_url text)
language sql
stable
security definer
set search_path = public
as $$
  select a.slug, greatest(a.updated_at, a.published_at), a.canonical_url
  from public.grovnews_public_articles a
  where a.status = 'PUBLISHED' and a.published_at <= now() and not a.noindex
  order by a.published_at desc
  limit 5000;
$$;

revoke all on function public.grovnews_public_feed(integer, text) from public;
revoke all on function public.grovnews_public_article(text) from public;
revoke all on function public.grovnews_public_sitemap() from public;
grant execute on function public.grovnews_public_feed(integer, text) to anon, authenticated;
grant execute on function public.grovnews_public_article(text) to anon, authenticated;
grant execute on function public.grovnews_public_sitemap() to anon, authenticated;

commit;
