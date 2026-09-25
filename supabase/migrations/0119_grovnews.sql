-- ============================================================================
-- 0119 — GROVNEWS, STAGE 1: categories, posts, entitlements
-- ============================================================================
--
-- A NEW, SELF-CONTAINED MODULE. Three new tables and one function; nothing
-- that exists is altered. The newsletter tables, the plans, the payments and
-- the credit ledger are not referenced by anything below.
--
--   grovnews_categories    the editorial taxonomy (admin-managed, one list)
--   grovnews_posts         the articles: DRAFT → PUBLISHED → ARCHIVED
--   grovnews_entitlements  who may read them — INDEPENDENT of the GrovBase
--                          plan: any plan (or none) plus GrovNews, or not
--
-- WHO CAN DO WHAT — enforced here, not in the UI:
--
--   posts         admin: everything. A customer: SELECT only, and only rows
--                 that are PUBLISHED, already published (published_at <= now)
--                 AND only while the caller holds an active entitlement. A
--                 draft or an archived post is invisible to every non-admin,
--                 entitled or not, through any path — page, API, raw REST.
--   entitlements  admin: everything. A customer: SELECT of their OWN rows
--                 only. There is no insert/update/delete policy for anyone
--                 but an admin, so a customer cannot create, extend, restore
--                 or re-label (PAID, LAUNCH_BONUS…) an entitlement — theirs or
--                 anyone else's.
--   categories    admin: everything. A customer: SELECT of active ones (the
--                 names are not premium content; the posts are).
--
-- `grovnews_has_access()` TAKES NO ARGUMENT, deliberately. A version taking a
-- user id would let any signed-in account ask "does <someone else> have
-- GrovNews?" (the reason 0051 keeps is_admin(uid) away from anon). It answers
-- for the caller only.
--
-- ACTIVE means: status ACTIVE, started, and not yet expired. `expires_at` NULL
-- is open-ended. Expiry is a moment in time, not a job: no cron has to run for
-- an entitlement to stop working, and status EXPIRED exists only so an admin
-- can end one explicitly.

begin;

-- ── 1. CATEGORIES ───────────────────────────────────────────────────────────
create table public.grovnews_categories (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique
              check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 60),
  name        text not null check (length(btrim(name)) between 1 and 80),
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index grovnews_categories_order_idx on public.grovnews_categories (sort_order, name);

create trigger grovnews_categories_touch before update on public.grovnews_categories
  for each row execute function public.touch_updated_at();

alter table public.grovnews_categories enable row level security;

create policy grovnews_categories_read on public.grovnews_categories
  for select to authenticated
  using (is_active or (select public.is_admin()));

create policy grovnews_categories_admin on public.grovnews_categories
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

insert into public.grovnews_categories (slug, name, sort_order) values
  ('allegro',       'Allegro',        10),
  ('olx',           'OLX',            20),
  ('amazon',        'Amazon',         30),
  ('e-commerce',    'E-commerce',     40),
  ('ai',            'AI',             50),
  ('marketing',     'Marketing',      60),
  ('prawo',         'Prawo',          70),
  ('podatki',       'Podatki',        80),
  ('import-i-hurt', 'Import i hurt',  90),
  ('logistyka',     'Logistyka',     100),
  ('marketplace',   'Marketplace',   110),
  ('trendy',        'Trendy',        120);

-- ── 2. ENTITLEMENTS ─────────────────────────────────────────────────────────
-- One row per (user, source): an admin grant and, later, a paid subscription
-- or a launch bonus can coexist, and access is "any of them is active".
create table public.grovnews_entitlements (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  status         text not null default 'ACTIVE'
                 check (status in ('ACTIVE', 'EXPIRED', 'REVOKED')),
  source         text not null default 'ADMIN_GRANT'
                 check (source in ('ADMIN_GRANT', 'LAUNCH_BONUS', 'PAID', 'PROMO')),
  starts_at      timestamptz not null default now(),
  expires_at     timestamptz,
  granted_by     uuid references auth.users (id) on delete set null,
  internal_note  text check (internal_note is null or length(internal_note) <= 1000),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint grovnews_entitlements_window_ok check (expires_at is null or expires_at > starts_at),
  constraint grovnews_entitlements_one_per_source unique (user_id, source)
);

create index grovnews_entitlements_user_idx on public.grovnews_entitlements (user_id);
create index grovnews_entitlements_expiry_idx on public.grovnews_entitlements (expires_at)
  where status = 'ACTIVE' and expires_at is not null;

create trigger grovnews_entitlements_touch before update on public.grovnews_entitlements
  for each row execute function public.touch_updated_at();

alter table public.grovnews_entitlements enable row level security;

create policy grovnews_entitlements_own_read on public.grovnews_entitlements
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

create policy grovnews_entitlements_admin on public.grovnews_entitlements
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ── 3. THE ACCESS QUESTION ──────────────────────────────────────────────────
create function public.grovnews_has_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.grovnews_entitlements e
    where e.user_id = auth.uid()
      and e.status = 'ACTIVE'
      and e.starts_at <= now()
      and (e.expires_at is null or e.expires_at > now())
  );
$$;

revoke all on function public.grovnews_has_access() from public, anon;
grant execute on function public.grovnews_has_access() to authenticated;

-- ── 4. POSTS ────────────────────────────────────────────────────────────────
create table public.grovnews_posts (
  id                      uuid primary key default gen_random_uuid(),
  slug                    text not null unique
                          check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 120),
  title                   text not null check (length(btrim(title)) between 1 and 200),
  excerpt                 text not null default '' check (length(excerpt) <= 600),
  content                 text not null default '' check (length(content) <= 200000),
  cover_url               text check (cover_url is null or cover_url ~* '^https://'),
  category_id             uuid references public.grovnews_categories (id) on delete set null,
  tags                    text[] not null default '{}' check (cardinality(tags) <= 20),
  language                text not null default 'pl' check (language in ('pl', 'en', 'de')),
  status                  text not null default 'DRAFT'
                          check (status in ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  published_at            timestamptz,
  estimated_read_minutes  integer not null default 1 check (estimated_read_minutes between 1 and 240),
  sources                 jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array'),
  email_summary           text check (email_summary is null or length(email_summary) <= 2000),
  seo_title               text check (seo_title is null or length(seo_title) <= 200),
  seo_description         text check (seo_description is null or length(seo_description) <= 400),
  metadata                jsonb not null default '{}'::jsonb,
  created_by              uuid references auth.users (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint grovnews_posts_published_is_dated check (status <> 'PUBLISHED' or published_at is not null)
);

create index grovnews_posts_feed_idx on public.grovnews_posts (published_at desc) where status = 'PUBLISHED';
create index grovnews_posts_status_idx on public.grovnews_posts (status, updated_at desc);
create index grovnews_posts_category_idx on public.grovnews_posts (category_id);

create trigger grovnews_posts_touch before update on public.grovnews_posts
  for each row execute function public.touch_updated_at();

alter table public.grovnews_posts enable row level security;

create policy grovnews_posts_entitled_read on public.grovnews_posts
  for select to authenticated
  using (
    (select public.is_admin())
    or (status = 'PUBLISHED' and published_at <= now() and (select public.grovnews_has_access()))
  );

create policy grovnews_posts_admin on public.grovnews_posts
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

commit;
