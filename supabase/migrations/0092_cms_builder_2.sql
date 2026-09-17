-- ─────────────────────────────────────────────────────────────────────────
-- CMS / PAGE BUILDER 2.0 — redirects, page options, per-section conditions
--
-- Everything here is ADDITIVE and idempotent. No existing column changes
-- meaning, no row is rewritten, no page changes its publish state, and the
-- waitlist page is not touched by any statement below.
--
-- Three things are added:
--
--   1. REDIRECTS as data. `/promocja` has to be able to point at whichever
--      landing is current without a deploy, which means the mapping lives in
--      a table and not in next.config. The table is tiny and read through a
--      cached definer function, so a redirect costs no query per request.
--   2. PAGE OPTIONS a landing needs: which header and footer it wears, and
--      the promotion window with what happens when it ends.
--   3. SECTION CONDITIONS: a window of dates, and who the section is for.
--      Both already had a home in `cms_blocks.style`; they get real columns
--      because the PUBLIC renderer has to filter on them and a jsonb probe
--      per block on every request is the wrong shape for that.
-- ─────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────
-- 1. REDIRECTS
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.cms_redirects (
  id uuid primary key default gen_random_uuid(),
  -- Stored normalised: leading slash, no trailing slash, no query, lower
  -- case. The unique index is what makes "duplicate source" impossible
  -- rather than merely discouraged.
  source text not null,
  target text not null,
  -- 301/308 are permanent and get cached by browsers forever, which is
  -- exactly what you do NOT want on a campaign you will re-point next month.
  -- 302/307 are the safe default for promotions.
  status_code integer not null default 307
    check (status_code in (301, 302, 307, 308)),
  enabled boolean not null default true,
  note text,
  hits integer not null default 0,
  last_hit_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null
);

create unique index if not exists cms_redirects_source_idx
  on public.cms_redirects (source);
create index if not exists cms_redirects_enabled_idx
  on public.cms_redirects (enabled) where enabled;

alter table public.cms_redirects enable row level security;

-- A redirect is public routing information — it has to be readable by the
-- anonymous request that is about to be redirected. Nothing in the row is
-- secret; `note` is admin prose and is not exposed by the reader below.
drop policy if exists "cms_redirects_read" on public.cms_redirects;
create policy "cms_redirects_read" on public.cms_redirects
  for select using (enabled);

drop policy if exists "cms_redirects_write" on public.cms_redirects;
create policy "cms_redirects_write" on public.cms_redirects
  for all using (public.is_admin()) with check (public.is_admin());

/**
 * The whole active redirect table, in one call, for the cached reader.
 *
 * SECURITY DEFINER so the anonymous client can read the routing table
 * without being granted the table itself, and so a disabled row never
 * leaves the database. It returns only what routing needs — no note, no
 * author, no counters.
 */
create or replace function public.cms_redirects_active()
returns table (source text, target text, status_code integer)
language sql
stable
security definer
set search_path = public
as $$
  select r.source, r.target, r.status_code
  from public.cms_redirects r
  where r.enabled
  order by r.source
$$;

-- Supabase re-grants EXECUTE to public by name on create, so the grant has to
-- be taken away and given back deliberately.
revoke all on function public.cms_redirects_active() from public, anon, authenticated;
grant execute on function public.cms_redirects_active() to anon, authenticated;

/**
 * Would this redirect create a loop?
 *
 * Walks the chain from `p_target` through the enabled rows (ignoring the row
 * being edited) and reports true if it comes back to `p_source`. Ten hops is
 * far past anything sane and stops a pre-existing cycle from hanging the
 * check.
 */
create or replace function public.cms_redirect_would_loop(
  p_source text, p_target text, p_ignore_id uuid default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  hop text := p_target;
  next_hop text;
  i integer := 0;
begin
  if p_source = p_target then return true; end if;
  loop
    i := i + 1;
    exit when i > 10;
    select r.target into next_hop
    from public.cms_redirects r
    where r.enabled and r.source = hop
      and (p_ignore_id is null or r.id <> p_ignore_id)
    limit 1;
    if next_hop is null then return false; end if;
    if next_hop = p_source then return true; end if;
    hop := next_hop;
  end loop;
  return true; -- ten hops without resolving is a loop in all but name
end $$;

revoke all on function public.cms_redirect_would_loop(text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.cms_redirect_would_loop(text, text, uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. PAGE OPTIONS — the chrome a landing wears, and its promotion window
-- ─────────────────────────────────────────────────────────────────────────

alter table public.cms_pages
  -- global | minimal | none. A campaign landing usually wants `minimal`, so
  -- the visitor has one thing to do; `none` is the full-screen offer.
  add column if not exists header_mode text not null default 'global',
  add column if not exists footer_mode text not null default 'global',
  -- { active, startAt, endAt, afterEndRedirect, code, campaignId }
  -- One object rather than six columns: it is read and written as a unit by
  -- one panel, and it is optional on every page.
  add column if not exists promo jsonb not null default '{}'::jsonb,
  -- Which starter layout built this page, so "duplicate as a new promo" and
  -- the page list can say what it is. Purely descriptive.
  add column if not exists template text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cms_pages_header_mode_check') then
    alter table public.cms_pages add constraint cms_pages_header_mode_check
      check (header_mode in ('global', 'minimal', 'none'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cms_pages_footer_mode_check') then
    alter table public.cms_pages add constraint cms_pages_footer_mode_check
      check (footer_mode in ('global', 'minimal', 'none'));
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. SECTION CONDITIONS — a window, and an audience
-- ─────────────────────────────────────────────────────────────────────────

alter table public.cms_blocks
  -- A promo banner that appears on the 17th and is gone on the 21st without
  -- anybody having to remember to take it down.
  add column if not exists show_from timestamptz,
  add column if not exists show_until timestamptz,
  -- everyone | anon | user. Deliberately three values and not a rules
  -- engine: "hide the register CTA from people who are already registered"
  -- is the whole requirement.
  add column if not exists audience text not null default 'everyone';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cms_blocks_audience_check') then
    alter table public.cms_blocks add constraint cms_blocks_audience_check
      check (audience in ('everyone', 'anon', 'user'));
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. SECTION TEMPLATES — "save this section, use it on the next page"
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.cms_templates (
  id uuid primary key default gen_random_uuid(),
  -- 'section' | 'page'. A section template is one block; a page template is
  -- an ordered list of them.
  kind text not null check (kind in ('section', 'page')),
  name text not null,
  -- For a section template: the block type, so the picker can group it.
  section_type text,
  -- The payload: one block, or an array of blocks. Same shape either way as
  -- what cms_blocks stores, so applying a template is a straight insert.
  payload jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null
);

create index if not exists cms_templates_kind_idx
  on public.cms_templates (kind, created_at desc);

alter table public.cms_templates enable row level security;

-- Admin-only both ways: a template is authoring material, never public.
drop policy if exists "cms_templates_admin" on public.cms_templates;
create policy "cms_templates_admin" on public.cms_templates
  for all using (public.is_admin()) with check (public.is_admin());
