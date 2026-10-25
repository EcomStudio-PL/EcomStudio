-- 0155 — FAQ V1: ONE BASE OF QUESTIONS FOR /faq, /plany AND /o-nas.
--
-- Until now every page kept its own questions: /plany in the code's
-- dictionaries (components/plan/pricing-config.ts FAQ), /o-nas in its
-- about_faq section, /faq not at all (a published page with no sections).
-- This file gives them one source:
--
--   1. faq_categories — name (pl/en/de), stable slug, position, visibility,
--      and the Kontakt V2 topic a "Nie pomogło → Napisz do nas" link opens.
--   2. faq_items — stable id and slug, question and answer (pl/en/de; the
--      answer in the small format of lib/faq.ts: paragraphs, **bold**,
--      [links](/kontakt)), category, position, visibility, the pages it is
--      shown on (faq / plany / o-nas), "only while the premiere runs", a review
--      flag and note for the admin, the brief's proposed answer kept beside a
--      checked one, and the counts of "Pomogło" / "Nie pomogło".
--   3. faq_votes — one vote per question per browser (a salted hash of a
--      random cookie, never the cookie itself), with a salted IP hash for the
--      hourly limit. Written only through faq_vote(), behind the server token.
--   4. faq_public() — what a page may show, and ONLY that: visible items of
--      visible categories, not waiting for a review, whose Polish question and
--      answer are not empty and hold no [placeholder] (faq_text_ok). Definer:
--      a visitor has no privilege on the tables at all.
--   5. History in content_versions (target 'faq'), written by a trigger on
--      every insert, change and delete — the history the inline editor
--      already keeps — and faq_restore() to put any version back;
--      faq_reorder() moves a whole list at once and records it as one entry.
--   6. A snapshot of everything the import reads (faq_import_snapshots), then
--      the import: 7 categories, the 30 questions of the brief and the one old
--      /plany question the brief has no twin for (generated from
--      lib/faq-seed.ts), then the O nas questions the brief has no twin for,
--      copied from the live about_faq section as they read today.
--
-- NOTHING ON A PAGE CHANGES HERE. /plany keeps reading its dictionary until
-- the code that reads this base is deployed; /o-nas keeps its section's
-- questions; the Kontakt links, the /faq page's section, the footer entry and
-- the clean-up of about_faq are 0156, applied AFTER the deploy. So this file
-- can go first and the switch has no gap.
--
-- RE-RUNNABLE. Objects are created if missing or replaced; the import inserts
-- by import_key / slug with ON CONFLICT DO NOTHING, so a second run adds
-- nothing and never overwrites what an admin changed since.
--
-- RLS. faq_categories / faq_items: admin only (read and write) — the public
-- reads faq_public(). faq_votes: no policy, no privilege. Snapshots: admin
-- read. No anon privilege on any of the four tables.
--
-- ROLLBACK (manual, only before 0156; revert the app code first):
--   drop function public.faq_public(), public.faq_vote(text, text, text, text, boolean),
--     public.faq_reorder(text, uuid[], uuid), public.faq_restore(uuid);
--   drop table public.faq_votes, public.faq_items, public.faq_categories, public.faq_import_snapshots;
--   drop function public.faq_guard(), public.faq_history(), public.faq_text_ok(text),
--     public.faq_locale_ok(jsonb, integer), public.faq_pages_ok(text[]);
--   delete from public.content_versions where target = 'faq'; then restore
--   content_versions_target_check to ('text', 'slot', 'cms').
--
-- After apply, this read-only probe must return 0 rows and no error:
--   begin read only; set local role anon;
--   select count(*) from public.faq_items;   -- must FAIL (permission denied)
--   rollback;
-- and `select count(*) from public.faq_public()` as anon must return the
-- published questions only.

set local lock_timeout = '10s';

-- shared predicates ─────────────────────────────────────────────────────────
-- A text a visitor may read: not empty, and no square bracket outside the
-- answer format's own links. "[DO POTWIERDZENIA]", "[X]", "[25]", "[data]",
-- "[nazwa firmy]" all fail. The same rule is lib/faq.ts faqTextOk (which, in
-- the browser's language, also caps a link's address at 500 characters —
-- Postgres caps a repetition count at 255, so the address here is unbounded
-- and the stricter TypeScript check wins).
create or replace function public.faq_text_ok(p text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p is not null and btrim(p) <> ''
    and regexp_replace(p, '\[[^\]\n]{1,200}\]\((https://|/|#|mailto:)[^)\s]+\)', '', 'g') !~ '[\[\]]';
$$;

-- A stored {pl, en, de} map: only those keys, string values, no markup or
-- invisible characters (content_text_ok, 0141), at most p_max characters.
create or replace function public.faq_locale_ok(p jsonb, p_max integer)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p is not null and jsonb_typeof(p) = 'object'
    and not exists (
      select 1 from jsonb_each(p) e
       where e.key not in ('pl', 'en', 'de')
          or jsonb_typeof(e.value) <> 'string'
          or length(e.value #>> '{}') > p_max
          or not public.content_text_ok(e.value #>> '{}'));
$$;

-- The pages an item may name, each at most once.
create or replace function public.faq_pages_ok(p text[])
returns boolean
language sql
immutable
set search_path = public
as $$
  select p is not null and p <@ array['faq', 'plany', 'o-nas']::text[]
    and cardinality(p) = (select count(distinct x) from unnest(p) x);
$$;

grant execute on function public.faq_text_ok(text) to anon, authenticated;
grant execute on function public.faq_locale_ok(jsonb, integer) to anon, authenticated;
grant execute on function public.faq_pages_ok(text[]) to anon, authenticated;

-- 1 ─────────────────────────────────────────────────────────────────────────
create table if not exists public.faq_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name jsonb not null default '{}'::jsonb,
  position integer not null default 0,
  visible boolean not null default true,
  contact_topic text not null default 'other',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  constraint faq_categories_slug_check check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 60),
  constraint faq_categories_name_check check (public.faq_locale_ok(name, 80) and public.faq_text_ok(name ->> 'pl')),
  constraint faq_categories_position_check check (position between 0 and 100000),
  constraint faq_categories_topic_check check (contact_topic in ('app', 'payments', 'technical', 'cooperation', 'other'))
);

-- 2 ─────────────────────────────────────────────────────────────────────────
create table if not exists public.faq_items (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  category_id uuid not null references public.faq_categories(id) on delete restrict,
  question jsonb not null default '{}'::jsonb,
  answer jsonb not null default '{}'::jsonb,
  position integer not null default 0,
  visible boolean not null default false,
  pages text[] not null default array['faq']::text[],
  only_premiere boolean not null default false,
  needs_review boolean not null default false,
  review_note text,
  draft_answer jsonb,
  helpful_count integer not null default 0,
  unhelpful_count integer not null default 0,
  import_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  constraint faq_items_slug_check check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 80),
  constraint faq_items_question_check check (public.faq_locale_ok(question, 300) and coalesce(btrim(question ->> 'pl'), '') <> ''),
  constraint faq_items_answer_check check (public.faq_locale_ok(answer, 4000)),
  constraint faq_items_draft_check check (draft_answer is null or public.faq_locale_ok(draft_answer, 4000)),
  constraint faq_items_pages_check check (public.faq_pages_ok(pages)),
  constraint faq_items_note_check check (review_note is null or (length(review_note) <= 1000 and public.content_text_ok(review_note))),
  constraint faq_items_position_check check (position between 0 and 100000),
  constraint faq_items_counts_check check (helpful_count >= 0 and unhelpful_count >= 0),
  constraint faq_items_import_check check (import_key is null or import_key ~ '^[a-z0-9-]{1,20}:[A-Za-z0-9-]{1,40}$')
);
create index if not exists faq_items_category_idx on public.faq_items (category_id, position);

-- 3 ─────────────────────────────────────────────────────────────────────────
create table if not exists public.faq_votes (
  item_id uuid not null references public.faq_items(id) on delete cascade,
  voter text not null check (voter ~ '^[0-9a-f]{64}$'),
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  helpful boolean not null,
  created_at timestamptz not null default now(),
  primary key (item_id, voter)
);
create index if not exists faq_votes_ip_recent_idx on public.faq_votes (ip_hash, created_at desc);

-- 6 (the snapshot table) ────────────────────────────────────────────────────
create table if not exists public.faq_import_snapshots (
  source text primary key check (length(source) between 1 and 80),
  data jsonb not null,
  taken_at timestamptz not null default now()
);

-- RLS ───────────────────────────────────────────────────────────────────────
alter table public.faq_categories enable row level security;
alter table public.faq_items enable row level security;
alter table public.faq_votes enable row level security;
alter table public.faq_import_snapshots enable row level security;

revoke all on table public.faq_categories from anon, authenticated;
revoke all on table public.faq_items from anon, authenticated;
revoke all on table public.faq_votes from anon, authenticated;
revoke all on table public.faq_import_snapshots from anon, authenticated;
grant select, insert, update, delete on table public.faq_categories to authenticated;
grant select, insert, update, delete on table public.faq_items to authenticated;
grant select on table public.faq_import_snapshots to authenticated;

drop policy if exists faq_categories_admin on public.faq_categories;
create policy faq_categories_admin on public.faq_categories for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists faq_items_admin on public.faq_items;
create policy faq_items_admin on public.faq_items for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists faq_import_snapshots_admin_read on public.faq_import_snapshots;
create policy faq_import_snapshots_admin_read on public.faq_import_snapshots for select to authenticated
  using (public.is_admin());

-- Timestamps, authorship, and the columns only the server may move ─────────
-- The vote counts and the import key change only inside faq_vote() and
-- faq_restore() (which set faq.internal); an admin's direct write keeps them.
-- Moving an item (position) or a vote is not an edit: updated_at — the base
-- the editor's compare-and-set checks — moves only when the content does.
create or replace function public.faq_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_internal boolean := coalesce(current_setting('faq.internal', true), '') = 'on';
  v_skip text[] := array['position', 'helpful_count', 'unhelpful_count', 'updated_at', 'updated_by'];
begin
  if tg_table_name = 'faq_items' and not v_internal then
    if tg_op = 'INSERT' then
      new.helpful_count := 0;
      new.unhelpful_count := 0;
      new.import_key := null;
    else
      new.helpful_count := old.helpful_count;
      new.unhelpful_count := old.unhelpful_count;
      new.import_key := old.import_key;
    end if;
  end if;
  if tg_op = 'INSERT' then
    if not v_internal then new.created_at := now(); end if;
    new.updated_at := now();
    new.updated_by := coalesce(auth.uid(), new.updated_by);
    return new;
  end if;
  new.created_at := old.created_at;
  if (to_jsonb(new) - v_skip) is distinct from (to_jsonb(old) - v_skip) then
    new.updated_at := now();
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  else
    new.updated_at := old.updated_at;
    new.updated_by := old.updated_by;
  end if;
  return new;
end $$;

drop trigger if exists faq_categories_guard on public.faq_categories;
create trigger faq_categories_guard before insert or update on public.faq_categories
  for each row execute function public.faq_guard();
drop trigger if exists faq_items_guard on public.faq_items;
create trigger faq_items_guard before insert or update on public.faq_items
  for each row execute function public.faq_guard();

-- 5 ─────────────────────────────────────────────────────────────────────────
alter table public.content_versions drop constraint if exists content_versions_target_check;
alter table public.content_versions add constraint content_versions_target_check
  check (target in ('text', 'slot', 'cms', 'faq'));

-- Every insert, change and delete of a category or an item, as the whole
-- row before and after (key faq:item:<id> / faq:category:<id>). A move or a
-- vote alone is not an entry; faq_reorder() writes its own.
create or replace function public.faq_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text := coalesce(nullif(current_setting('faq.action', true), ''),
                            case when tg_op = 'DELETE' then 'clear' else 'save' end);
  v_skip text[] := array['position', 'helpful_count', 'unhelpful_count', 'updated_at', 'updated_by'];
  v_kind text := case when tg_table_name = 'faq_items' then 'item' else 'category' end;
  v_id uuid;
begin
  if v_action not in ('save', 'restore', 'clear', 'bulk', 'external') then v_action := 'external'; end if;
  if tg_op = 'UPDATE' and (to_jsonb(new) - v_skip) is not distinct from (to_jsonb(old) - v_skip) then
    return null;
  end if;
  v_id := case when tg_op = 'DELETE' then old.id else new.id end;
  insert into public.content_versions (target, key, locale, action, before, after, created_by)
  values (
    'faq', 'faq:' || v_kind || ':' || v_id::text, null, v_action,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end,
    auth.uid()
  );
  return null;
end $$;

drop trigger if exists faq_categories_history on public.faq_categories;
create trigger faq_categories_history after insert or update or delete on public.faq_categories
  for each row execute function public.faq_history();
drop trigger if exists faq_items_history on public.faq_items;
create trigger faq_items_history after insert or update or delete on public.faq_items
  for each row execute function public.faq_history();

-- Supabase's default privileges grant EXECUTE to anon and authenticated by
-- name, so revoking from PUBLIC alone would leave them callable.
revoke all on function public.faq_guard() from public, anon, authenticated;
revoke all on function public.faq_history() from public, anon, authenticated;

-- 4 ─────────────────────────────────────────────────────────────────────────
create or replace function public.faq_public()
returns table (
  slug text, category text, category_name jsonb, category_position integer, category_topic text,
  "position" integer, question jsonb, answer jsonb, pages text[], only_premiere boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select i.slug, c.slug, c.name, c.position, c.contact_topic,
         i.position, i.question, i.answer, i.pages, i.only_premiere
    from public.faq_items i
    join public.faq_categories c on c.id = i.category_id
   where i.visible and not i.needs_review and c.visible
     and cardinality(i.pages) > 0
     and public.faq_text_ok(i.question ->> 'pl')
     and public.faq_text_ok(i.answer ->> 'pl')
   order by c.position, c.slug, i.position, i.slug;
$$;

revoke all on function public.faq_public() from public;
grant execute on function public.faq_public() to anon, authenticated;

-- "Czy to pomogło?" — one vote per question per browser. Only a question a
-- visitor can see takes a vote; 30 votes an hour per IP hash. 'already' for a
-- browser that voted before (the first vote stands).
create or replace function public.faq_vote(
  p_token text, p_slug text, p_voter text, p_ip_hash text, p_helpful boolean
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item uuid;
  v_recent integer;
  v_inserted integer;
begin
  if not public.server_call_ok(p_token) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_slug is null or length(p_slug) > 80 or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     or p_voter is null or p_voter !~ '^[0-9a-f]{64}$'
     or p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$'
     or p_helpful is null then
    return 'invalid';
  end if;
  select i.id into v_item
    from public.faq_items i join public.faq_categories c on c.id = i.category_id
   where i.slug = p_slug and i.visible and not i.needs_review and c.visible
     and public.faq_text_ok(i.question ->> 'pl') and public.faq_text_ok(i.answer ->> 'pl');
  if v_item is null then return 'not_found'; end if;

  perform pg_advisory_xact_lock(hashtextextended('faq.vote:' || p_ip_hash, 0));
  if exists (select 1 from public.faq_votes v where v.item_id = v_item and v.voter = p_voter) then
    return 'already';
  end if;
  select count(*) into v_recent from public.faq_votes v
   where v.ip_hash = p_ip_hash and v.created_at > now() - interval '1 hour';
  if v_recent >= 30 then return 'rate_limited'; end if;

  insert into public.faq_votes (item_id, voter, ip_hash, helpful)
  values (v_item, p_voter, p_ip_hash, p_helpful)
  on conflict do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then return 'already'; end if;

  perform set_config('faq.internal', 'on', true);
  update public.faq_items
     set helpful_count = helpful_count + case when p_helpful then 1 else 0 end,
         unhelpful_count = unhelpful_count + case when p_helpful then 0 else 1 end
   where id = v_item;
  perform set_config('faq.internal', '', true);
  return 'ok';
end $$;

revoke all on function public.faq_vote(text, text, text, text, boolean) from public;
grant execute on function public.faq_vote(text, text, text, text, boolean) to anon, authenticated;

-- A whole list in a new order: every category, or every item of one category
-- — exactly that set, or 'stale' (someone added or moved one meanwhile).
-- One history entry, faq:order:categories / faq:order:<category id>.
create or replace function public.faq_reorder(p_kind text, p_ids uuid[], p_category uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer := coalesce(cardinality(p_ids), 0);
  v_before jsonb;
  v_after jsonb;
begin
  if not public.is_admin() then raise exception 'not_allowed' using errcode = '42501'; end if;
  if v_n = 0 or v_n > 1000 or (select count(distinct x) from unnest(p_ids) x) <> v_n then
    raise exception 'bad_input';
  end if;
  if p_kind = 'categories' then
    if (select count(*) from public.faq_categories) <> v_n
       or exists (select 1 from unnest(p_ids) x where not exists (select 1 from public.faq_categories c where c.id = x)) then
      raise exception 'stale';
    end if;
    select jsonb_agg(c.slug order by c.position, c.slug) into v_before from public.faq_categories c;
    for i in 1..v_n loop
      update public.faq_categories set position = i * 10 where id = p_ids[i] and position <> i * 10;
    end loop;
    select jsonb_agg(c.slug order by c.position, c.slug) into v_after from public.faq_categories c;
    insert into public.content_versions (target, key, locale, action, before, after, created_by)
    values ('faq', 'faq:order:categories', null, 'bulk',
            jsonb_build_object('order', v_before), jsonb_build_object('order', v_after), auth.uid());
  elsif p_kind = 'items' then
    if p_category is null then raise exception 'bad_input'; end if;
    if (select count(*) from public.faq_items i where i.category_id = p_category) <> v_n
       or exists (select 1 from unnest(p_ids) x
                   where not exists (select 1 from public.faq_items i where i.id = x and i.category_id = p_category)) then
      raise exception 'stale';
    end if;
    select jsonb_agg(i.slug order by i.position, i.slug) into v_before from public.faq_items i where i.category_id = p_category;
    for i in 1..v_n loop
      update public.faq_items set position = i * 10 where id = p_ids[i] and position <> i * 10;
    end loop;
    select jsonb_agg(i.slug order by i.position, i.slug) into v_after from public.faq_items i where i.category_id = p_category;
    insert into public.content_versions (target, key, locale, action, before, after, created_by)
    values ('faq', 'faq:order:' || p_category::text, null, 'bulk',
            jsonb_build_object('order', v_before), jsonb_build_object('order', v_after), auth.uid());
  else
    raise exception 'bad_input';
  end if;
  return v_n;
end $$;

revoke all on function public.faq_reorder(text, uuid[], uuid) from public, anon;
grant execute on function public.faq_reorder(text, uuid[], uuid) to authenticated;

-- "Przywróć tę wersję": the row as it was after that change (for a delete,
-- as it was before it — the item comes back, with its votes). Its slug must
-- be free and its category must exist; the content passes the table's own
-- checks like any other write.
create or replace function public.faq_restore(p_version uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.content_versions%rowtype;
  s jsonb;
  v_id uuid;
begin
  if not public.is_admin() then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into v from public.content_versions where id = p_version and target = 'faq';
  if not found then raise exception 'not_found'; end if;
  s := coalesce(v.after, v.before);
  if s is null or jsonb_typeof(s) <> 'object' or (v.key not like 'faq:item:%' and v.key not like 'faq:category:%') then
    raise exception 'not_restorable';
  end if;
  v_id := (s ->> 'id')::uuid;
  perform set_config('faq.action', 'restore', true);

  if v.key like 'faq:category:%' then
    if exists (select 1 from public.faq_categories c where c.slug = s ->> 'slug' and c.id <> v_id) then raise exception 'slug_taken'; end if;
    if exists (select 1 from public.faq_categories c where c.id = v_id) then
      update public.faq_categories
         set slug = s ->> 'slug', name = s -> 'name', visible = (s ->> 'visible')::boolean,
             contact_topic = s ->> 'contact_topic'
       where id = v_id;
    else
      insert into public.faq_categories (id, slug, name, position, visible, contact_topic)
      values (v_id, s ->> 'slug', s -> 'name',
              coalesce((select max(c.position) + 10 from public.faq_categories c), 10),
              (s ->> 'visible')::boolean, s ->> 'contact_topic');
    end if;
    return jsonb_build_object('kind', 'category', 'id', v_id);
  end if;

  if not exists (select 1 from public.faq_categories c where c.id = (s ->> 'category_id')::uuid) then raise exception 'category_missing'; end if;
  if exists (select 1 from public.faq_items i where i.slug = s ->> 'slug' and i.id <> v_id) then raise exception 'slug_taken'; end if;
  if exists (select 1 from public.faq_items i where i.id = v_id) then
    update public.faq_items
       set slug = s ->> 'slug', category_id = (s ->> 'category_id')::uuid,
           question = s -> 'question', answer = s -> 'answer',
           visible = (s ->> 'visible')::boolean,
           pages = array(select jsonb_array_elements_text(s -> 'pages')),
           only_premiere = coalesce((s ->> 'only_premiere')::boolean, false),
           needs_review = coalesce((s ->> 'needs_review')::boolean, false),
           review_note = s ->> 'review_note',
           draft_answer = case when jsonb_typeof(s -> 'draft_answer') = 'object' then s -> 'draft_answer' end
     where id = v_id;
  else
    perform set_config('faq.internal', 'on', true);
    insert into public.faq_items (
      id, slug, category_id, question, answer, position, visible, pages, only_premiere, needs_review,
      review_note, draft_answer, helpful_count, unhelpful_count, import_key, created_at
    ) values (
      v_id, s ->> 'slug', (s ->> 'category_id')::uuid, s -> 'question', s -> 'answer',
      coalesce((select max(i.position) + 10 from public.faq_items i where i.category_id = (s ->> 'category_id')::uuid), 10),
      (s ->> 'visible')::boolean,
      array(select jsonb_array_elements_text(s -> 'pages')),
      coalesce((s ->> 'only_premiere')::boolean, false),
      coalesce((s ->> 'needs_review')::boolean, false),
      s ->> 'review_note',
      case when jsonb_typeof(s -> 'draft_answer') = 'object' then s -> 'draft_answer' end,
      greatest(coalesce((s ->> 'helpful_count')::integer, 0), 0),
      greatest(coalesce((s ->> 'unhelpful_count')::integer, 0), 0),
      case when exists (select 1 from public.faq_items i where i.import_key = s ->> 'import_key') then null else s ->> 'import_key' end,
      coalesce((s ->> 'created_at')::timestamptz, now())
    );
    perform set_config('faq.internal', '', true);
  end if;
  return jsonb_build_object('kind', 'item', 'id', v_id);
end $$;

revoke all on function public.faq_restore(uuid) from public, anon;
grant execute on function public.faq_restore(uuid) to authenticated;

comment on table public.faq_items is
  'FAQ V1: every question of /faq, /plany and /o-nas, once. Public read only through faq_public(); admin edits; history in content_versions (target faq).';
comment on function public.faq_public() is
  'FAQ V1: the questions a visitor may read — visible, reviewed, of a visible category, no empty text and no [placeholder] in Polish.';

-- 6 ─────────────────────────────────────────────────────────────────────────
-- What the import reads, as it is right now: kept even after 0156 changes the
-- pages, next to the page versions the CMS keeps anyway.
insert into public.faq_import_snapshots (source, data)
select 'o-nas:about_faq', jsonb_build_object(
  'draft', (select b.content from public.cms_blocks b join public.cms_pages p on p.id = b.page_id
             where p.slug = 'o-nas' and b.type = 'about_faq' order by b.sort_order limit 1),
  'published', (select e from public.cms_pages p, jsonb_array_elements(coalesce(p.published_snapshot, '[]'::jsonb)) e
                 where p.slug = 'o-nas' and e ->> 'type' = 'about_faq' limit 1))
on conflict (source) do nothing;

insert into public.faq_import_snapshots (source, data)
select 'kontakt:contact_page', jsonb_build_object(
  'draft', (select b.content -> 'tiles' from public.cms_blocks b join public.cms_pages p on p.id = b.page_id
             where p.slug = 'kontakt' and b.type = 'contact_page' order by b.sort_order limit 1),
  'published', (select e -> 'content' -> 'tiles' from public.cms_pages p, jsonb_array_elements(coalesce(p.published_snapshot, '[]'::jsonb)) e
                 where p.slug = 'kontakt' and e ->> 'type' = 'contact_page' limit 1))
on conflict (source) do nothing;

insert into public.faq_import_snapshots (source, data)
select 'faq:page', jsonb_build_object(
  'seo', p.seo, 'nav_group', p.nav_group, 'nav_order', p.nav_order, 'published', p.published_snapshot,
  'blocks', (select coalesce(jsonb_agg(to_jsonb(b) order by b.sort_order), '[]'::jsonb) from public.cms_blocks b where b.page_id = p.id))
  from public.cms_pages p where p.slug = 'faq'
on conflict (source) do nothing;

-- >>> generated by scripts/faq-seed-sql.ts from lib/faq-seed.ts — do not edit by hand
-- The 7 categories, the 30 questions of the brief and "Jak mogę kupić
-- dodatkowe kredyty?" from the old /plany FAQ — then the O nas questions the
-- brief has no twin for, read from the live about_faq section. One block, so
-- the flags below hold for every statement of the import. (The old /plany
-- answers were code, not data: they are in git, commit 330a367.)
do $faq$
declare
  v_about jsonb;
  v_item jsonb;
  v_n bigint;
  v_title text;
  v_slug text;
  v_cat text;
  v_after text;
  v_pos integer;
  v_known jsonb := '[{"title":"Czym różnicie się od innych narzędzi AI do zdjęć?","slug":"czym-roznicie-sie-od-innych-narzedzi","category":"pierwsze-kroki","after":"czy-grovbase-dziala-na-telefonie"},{"title":"Na jakich modelach AI pracujecie?","slug":"na-jakich-modelach-ai-pracujecie","category":"jakosc-i-wyniki","after":"rozdzielczosc-i-format-grafik"}]'::jsonb;
  v_mapped text[] := array['Czym jest GrovBase?', 'Co dzieje się z moimi zdjęciami?', 'Kto stoi za GrovBase?', 'Dane firmy']::text[];
begin
  -- The import may set the import key; its history entries read "external".
  perform set_config('faq.internal', 'on', true);
  perform set_config('faq.action', 'external', true);

  insert into public.faq_categories (slug, name, position, visible, contact_topic) values
    ('pierwsze-kroki', '{"pl":"Pierwsze kroki","en":"Getting started","de":"Erste Schritte"}'::jsonb, 10, true, 'app'),
    ('kredyty-i-plany', '{"pl":"Kredyty i plany","en":"Credits and plans","de":"Credits und Pläne"}'::jsonb, 20, true, 'payments'),
    ('platnosci-i-faktury', '{"pl":"Płatności i faktury","en":"Payments and invoices","de":"Zahlungen und Rechnungen"}'::jsonb, 30, true, 'payments'),
    ('jakosc-i-wyniki', '{"pl":"Jakość i wyniki","en":"Quality and results","de":"Qualität und Ergebnisse"}'::jsonb, 40, true, 'technical'),
    ('prawa-i-dane', '{"pl":"Prawa i dane","en":"Rights and data","de":"Rechte und Daten"}'::jsonb, 50, true, 'other'),
    ('konto-i-firma', '{"pl":"Konto i firma","en":"Account and company","de":"Konto und Unternehmen"}'::jsonb, 60, true, 'app'),
    ('nadchodzace-funkcje', '{"pl":"Nadchodzące funkcje","en":"Coming soon","de":"Demnächst"}'::jsonb, 70, true, 'other')
  on conflict (slug) do nothing;

  insert into public.faq_items (slug, category_id, question, answer, draft_answer, position, visible, pages,
                                only_premiere, needs_review, review_note, import_key)
  select v.slug, c.id, v.question, v.answer, v.draft, v.position, v.visible, v.pages,
         v.only_premiere, v.needs_review, v.note, v.import_key
    from (values
      ('czym-jest-grovbase', 'pierwsze-kroki', '{"pl":"Czym jest GrovBase?","en":"What is GrovBase?","de":"Was ist GrovBase?"}'::jsonb, '{"pl":"GrovBase to aplikacja do tworzenia zdjęć produktów dla sprzedawców internetowych: miniaturek na Allegro i inne marketplace’y, packshotów, retuszu i zdjęć odzieży. Wgrywasz zdjęcie produktu, wybierasz efekt i pobierasz gotową grafikę.","en":"GrovBase is an app that creates product photos for online sellers: thumbnails for Allegro and other marketplaces, packshots, retouching and clothing photos. You upload a photo of your product, choose an effect and download a finished image.","de":"GrovBase ist eine App, die Produktfotos für Online-Händler erstellt: Thumbnails für Allegro und andere Marktplätze, Packshots, Retusche und Bekleidungsfotos. Du lädst ein Foto deines Produkts hoch, wählst einen Effekt und lädst die fertige Grafik herunter."}'::jsonb, null::jsonb, 10, true, array['faq', 'o-nas']::text[], false, false, null::text, 'brief:01'),
      ('czy-musze-umiec-pisac-prompty', 'pierwsze-kroki', '{"pl":"Czy muszę umieć pisać prompty albo znać się na grafice?","en":"Do I need to know how to write prompts or understand graphic design?","de":"Muss ich Prompts schreiben können oder mich mit Grafik auskennen?"}'::jsonb, '{"pl":"Nie. Każde narzędzie ma gotowe ustawienia przygotowane przez grafika e-commerce. Wystarczy wgrać zdjęcie i kliknąć.","en":"No. Every tool comes with ready-made settings prepared by an e-commerce designer. Just upload a photo and click.","de":"Nein. Jedes Werkzeug hat fertige Einstellungen, die ein E-Commerce-Grafiker vorbereitet hat. Foto hochladen und klicken – mehr ist nicht nötig."}'::jsonb, null::jsonb, 20, true, array['faq']::text[], false, false, null::text, 'brief:02'),
      ('jakie-zdjecia-wgrywac', 'pierwsze-kroki', '{"pl":"Jakie zdjęcia najlepiej wgrywać?","en":"What photos work best?","de":"Welche Fotos eignen sich am besten?"}'::jsonb, '{"pl":"Najlepiej ostre zdjęcie, na którym widać cały produkt, przy dobrym świetle. Wystarczy zdjęcie z telefonu. Obsługujemy JPG, PNG, WebP i AVIF do 10 MB.","en":"A sharp photo that shows the whole product in good light works best. A phone photo is enough. We support JPG, PNG, WebP and AVIF up to 10 MB.","de":"Am besten ein scharfes Foto, auf dem das ganze Produkt bei gutem Licht zu sehen ist. Ein Handyfoto reicht. Wir unterstützen JPG, PNG, WebP und AVIF bis 10 MB."}'::jsonb, null::jsonb, 30, true, array['faq']::text[], false, false, null::text, 'brief:03'),
      ('ile-trwa-generowanie', 'pierwsze-kroki', '{"pl":"Ile trwa wygenerowanie grafiki?","en":"How long does it take to generate an image?","de":"Wie lange dauert das Erstellen einer Grafik?"}'::jsonb, '{"pl":"Zwykle od kilkudziesięciu sekund do kilku minut, w zależności od narzędzia i liczby zdjęć. Opcja Retusz AI wydłuża czas, bo każde zdjęcie jest najpierw poprawiane osobno.","en":"Usually from several dozen seconds to a few minutes, depending on the tool and the number of photos. The AI retouching option takes longer, because each photo is first improved separately.","de":"Meist zwischen einigen Dutzend Sekunden und ein paar Minuten, je nach Werkzeug und Anzahl der Fotos. Die Option KI-Retusche dauert länger, weil jedes Foto zuerst einzeln verbessert wird."}'::jsonb, null::jsonb, 40, true, array['faq']::text[], false, false, null::text, 'brief:04'),
      ('czy-grovbase-dziala-na-telefonie', 'pierwsze-kroki', '{"pl":"Czy GrovBase działa na telefonie?","en":"Does GrovBase work on a phone?","de":"Funktioniert GrovBase auf dem Handy?"}'::jsonb, '{"pl":"Tak, aplikacja działa w przeglądarce na komputerze i telefonie. Nie trzeba niczego instalować.","en":"Yes, the app runs in the browser on your computer and your phone. There is nothing to install.","de":"Ja, die App läuft im Browser auf Computer und Handy. Du musst nichts installieren."}'::jsonb, null::jsonb, 50, true, array['faq']::text[], false, false, null::text, 'brief:05'),
      ('jak-dzialaja-kredyty', 'kredyty-i-plany', '{"pl":"Jak działają kredyty?","en":"How do credits work?","de":"Wie funktionieren Credits?"}'::jsonb, '{"pl":"Każda generacja kosztuje określoną liczbę kredytów, widoczną przy narzędziu przed kliknięciem. Kredyty dostajesz co miesiąc w ramach planu, a w razie potrzeby możesz je doładować.","en":"Every generation costs a set number of credits, shown next to the tool before you click. You get credits every month with your plan, and you can top them up whenever you need.","de":"Jede Generierung kostet eine bestimmte Anzahl Credits, die beim Werkzeug angezeigt wird, bevor du klickst. Credits bekommst du jeden Monat mit deinem Plan, und bei Bedarf kannst du sie aufladen."}'::jsonb, null::jsonb, 10, true, array['faq', 'plany']::text[], false, false, null::text, 'brief:06'),
      ('ile-obrazow-moge-wygenerowac', 'kredyty-i-plany', '{"pl":"Ile obrazów mogę wygenerować?","en":"How many images can I generate?","de":"Wie viele Bilder kann ich generieren?"}'::jsonb, '{"pl":"To zależy od narzędzia i jakości: koszt każdej generacji widzisz w kredytach, zanim ją uruchomisz, więc łatwo przeliczysz swój plan. Generowanie wideo jest w przygotowaniu i nie jest jeszcze dostępne.","en":"It depends on the tool and the quality: you see the credit cost of each generation before you run it, so it is easy to work out what your plan covers. Video generation is in preparation and not available yet.","de":"Das hängt vom Tool und der Qualität ab: Die Credit-Kosten jeder Generierung siehst du, bevor du sie startest, so kannst du deinen Plan leicht umrechnen. Die Videogenerierung ist in Vorbereitung und noch nicht verfügbar."}'::jsonb, '{"pl":"To zależy od narzędzia. Przykładowo miniaturka kosztuje [X] kredytów, więc w planie PRO (1 200 kredytów) zrobisz ok. [Y] miniaturek miesięcznie. Przeliczenia dla każdego planu znajdziesz w cenniku."}'::jsonb, 20, true, array['faq', 'plany']::text[], false, false, 'Import FAQ V1: widoczna jest dotychczasowa, sprawdzona odpowiedź z cennika (/plany). Propozycja z briefu czeka na wartości [X] i [Y]; limit planu PRO (1 200 kredytów miesięcznie) jest zgodny z konfiguracją planów.', 'brief:07'),
      ('czy-kredyty-przechodza-na-kolejny-miesiac', 'kredyty-i-plany', '{"pl":"Czy niewykorzystane kredyty przechodzą na kolejny miesiąc?","en":"Do unused credits roll over to the next month?","de":"Werden ungenutzte Credits in den nächsten Monat übernommen?"}'::jsonb, '{"pl":"[DO POTWIERDZENIA]"}'::jsonb, null::jsonb, 30, false, array['faq', 'plany']::text[], false, false, 'Do uzupełnienia: odpowiedź z briefu to [DO POTWIERDZENIA].', 'brief:08'),
      ('czy-kredyty-z-doladowania-wygasaja', 'kredyty-i-plany', '{"pl":"Czy kredyty z doładowania wygasają?","en":"Do top-up credits expire?","de":"Verfallen aufgeladene Credits?"}'::jsonb, '{"pl":"Nie. Kredyty z doładowania nie wygasają i są dostępne od razu po zakupie, dopóki masz aktywny plan.","en":"No. Top-up credits never expire and are available right after purchase, as long as you have an active plan.","de":"Nein. Aufgeladene Credits verfallen nicht und stehen direkt nach dem Kauf zur Verfügung, solange du einen aktiven Plan hast."}'::jsonb, null::jsonb, 40, false, array['faq', 'plany']::text[], false, true, 'Wymaga weryfikacji: aktywny plan jest w kodzie warunkiem ZAKUPU doładowania, ale wydawanie kredytów nie jest blokowane, gdy plan wygaśnie — zdanie „dopóki masz aktywny plan” nie zostało potwierdzone. Kredyty trafiają na konto po potwierdzeniu płatności.', 'brief:09'),
      ('zwrot-kredytow-za-nieudana-generacje', 'kredyty-i-plany', '{"pl":"Czy dostanę kredyty z powrotem, jeśli generacja się nie uda?","en":"Do I get my credits back if a generation fails?","de":"Bekomme ich meine Credits zurück, wenn eine Generierung fehlschlägt?"}'::jsonb, '{"pl":"[DO POTWIERDZENIA]"}'::jsonb, null::jsonb, 50, false, array['faq']::text[], false, false, 'Do uzupełnienia: odpowiedź z briefu to [DO POTWIERDZENIA]. Dla porządku: w kodzie kredyty za nieudaną generację wracają na konto automatycznie (to samo mówiła dotychczasowa odpowiedź „Jak działają kredyty?” w cenniku).', 'brief:10'),
      ('czy-moge-wyprobowac-za-darmo', 'kredyty-i-plany', '{"pl":"Czy mogę wypróbować GrovBase za darmo?","en":"Can I try GrovBase for free?","de":"Kann ich GrovBase kostenlos testen?"}'::jsonb, '{"pl":"Tak. Po rejestracji dostajesz [25] darmowych kredytów. Grafiki z darmowych kredytów mają znak wodny, który możesz usunąć po wybraniu dowolnego planu."}'::jsonb, null::jsonb, 60, false, array['faq', 'plany']::text[], false, false, 'Do uzupełnienia: liczba kredytów [25] (plan Free ma dziś 25 kredytów miesięcznie) i potwierdzenie zasad znaku wodnego (znak wodny wersji próbnej jest włączony w ustawieniach).', 'brief:11'),
      ('jak-dziala-cena-premierowa', 'kredyty-i-plany', '{"pl":"Jak działa cena premierowa?","en":"How does the launch price work?","de":"Wie funktioniert der Startpreis?"}'::jsonb, '{"pl":"Jeśli kupisz plan przed końcem oferty, zachowasz jego cenę premierową przy kolejnych odnowieniach — dopóki nie anulujesz subskrypcji lub nie zmienisz planu. Po zakończeniu oferty nowe subskrypcje mają cenę regularną.","en":"If you buy a plan before the offer ends, you keep its launch price on every renewal — until you cancel the subscription or change the plan. After the offer ends, new subscriptions are at the regular price.","de":"Wenn du einen Plan vor Ende des Angebots kaufst, behältst du seinen Startpreis bei jeder Verlängerung — bis du das Abo kündigst oder den Plan wechselst. Nach Ende des Angebots gilt für neue Abos der reguläre Preis."}'::jsonb, '{"pl":"Jeśli wykupisz plan do [data], zachowujesz cenę premierową tak długo, jak masz aktywny plan. Cena zmienia się dopiero po anulowaniu lub zmianie planu."}'::jsonb, 70, true, array['faq', 'plany']::text[], true, false, 'Import FAQ V1: widoczna jest dotychczasowa, sprawdzona odpowiedź z cennika (/plany). Pokazywana tylko w trakcie premiery, jak dotąd. Propozycja z briefu czeka na [data].', 'brief:12'),
      ('czy-moge-zmienic-plan', 'kredyty-i-plany', '{"pl":"Czy po zakupie mogę zmienić plan?","en":"Can I change my plan after buying?","de":"Kann ich meinen Plan nach dem Kauf ändern?"}'::jsonb, '{"pl":"Samodzielna zmiana planu w panelu nie jest jeszcze dostępna. Napisz do nas, a przeprowadzimy zmianę — albo anuluj obecny plan i po zakończeniu opłaconego okresu wybierz nowy.","en":"Changing your plan yourself in the panel is not available yet. Write to us and we will make the switch — or cancel your current plan and choose a new one once the paid period ends.","de":"Ein selbstständiger Planwechsel im Panel ist noch nicht verfügbar. Schreib uns, und wir stellen den Plan um — oder kündige den aktuellen Plan und wähle nach Ende des bezahlten Zeitraums einen neuen."}'::jsonb, '{"pl":"Tak, w każdej chwili w ustawieniach konta. [DO POTWIERDZENIA: kiedy zmiana wchodzi w życie i jak rozliczana jest różnica]"}'::jsonb, 80, true, array['faq', 'plany']::text[], false, false, 'Import FAQ V1: widoczna jest dotychczasowa, sprawdzona odpowiedź z cennika (/plany). Propozycja z briefu („Tak, w każdej chwili w ustawieniach konta”) jest sprzeczna z kodem: samodzielna zmiana planu w panelu nie jest dostępna.', 'brief:13'),
      ('jak-kupic-dodatkowe-kredyty', 'kredyty-i-plany', '{"pl":"Jak mogę kupić dodatkowe kredyty?","en":"How can I buy extra credits?","de":"Wie kann ich zusätzliche Credits kaufen?"}'::jsonb, '{"pl":"Doładowania są dostępne dla aktywnych planów płatnych: w sekcji „Doładuj kredyty” wybierz pakiet albo własną liczbę kredytów. Kredyty z doładowania nie wygasają i trafiają na konto po potwierdzeniu płatności.","en":"Top-ups are available on active paid plans: in “Top up credits”, choose a pack or a custom amount of credits. Top-up credits never expire and reach your account once the payment is confirmed.","de":"Aufladungen gibt es für aktive bezahlte Pläne: Wähle unter „Credits aufladen“ ein Paket oder eine eigene Anzahl Credits. Aufgeladene Credits verfallen nicht und landen nach Bestätigung der Zahlung auf deinem Konto."}'::jsonb, null::jsonb, 90, true, array['faq', 'plany']::text[], false, false, 'Pytanie z dotychczasowego cennika, którego nie ma w briefie — zachowane bez zmian (link „Jak kupić dodatkowe kredyty?” na stronie Kontakt).', 'plany:topups'),
      ('metody-platnosci', 'platnosci-i-faktury', '{"pl":"Z jakich metod płatności mogę skorzystać?","en":"Which payment methods can I use?","de":"Welche Zahlungsmethoden kann ich nutzen?"}'::jsonb, '{"pl":"Płatności obsługuje Stripe. Plan opłacisz kartą płatniczą, a jednorazowe doładowania także BLIKiem. Formularz płatności pokazuje metody dostępne na Twoim urządzeniu, w tym portfele takie jak Apple Pay czy Google Pay.","en":"Payments are handled by Stripe. You pay for a plan by card, and one-off top-ups also with BLIK. The payment form shows the methods available on your device, including wallets such as Apple Pay or Google Pay.","de":"Zahlungen laufen über Stripe. Einen Plan bezahlst du per Karte, einmalige Aufladungen auch mit BLIK. Das Zahlungsformular zeigt die auf deinem Gerät verfügbaren Methoden, darunter Wallets wie Apple Pay oder Google Pay."}'::jsonb, '{"pl":"[DO POTWIERDZENIA]"}'::jsonb, 10, true, array['faq', 'plany']::text[], false, false, 'Import FAQ V1: widoczna jest dotychczasowa, sprawdzona odpowiedź z cennika (/plany). Odpowiedź z briefu to [DO POTWIERDZENIA].', 'brief:14'),
      ('czy-otrzymam-fakture-vat', 'platnosci-i-faktury', '{"pl":"Czy otrzymam fakturę VAT?","en":"Will I get a VAT invoice?","de":"Bekomme ich eine Rechnung mit MwSt.?"}'::jsonb, '{"pl":"Tak. Fakturę wystawiamy automatycznie po każdej płatności. Dane do faktury, w tym NIP, uzupełnisz w ustawieniach konta.","en":"Yes. We issue an invoice automatically after every payment. You can add your invoice details, including your tax ID, in your account settings.","de":"Ja. Nach jeder Zahlung stellen wir automatisch eine Rechnung aus. Deine Rechnungsdaten, einschließlich der USt-IdNr., trägst du in den Kontoeinstellungen ein."}'::jsonb, null::jsonb, 20, false, array['faq']::text[], false, true, 'Wymaga weryfikacji: w ustawieniach konta nie ma pola na dane do faktury ani NIP, a w kodzie nie znaleziono automatycznego wystawiania faktur VAT.', 'brief:15'),
      ('czy-subskrypcja-odnawia-sie-automatycznie', 'platnosci-i-faktury', '{"pl":"Czy subskrypcja odnawia się automatycznie?","en":"Does the subscription renew automatically?","de":"Verlängert sich das Abo automatisch?"}'::jsonb, '{"pl":"Tak — plan odnawia się co miesiąc, a po każdej opłaconej płatności dodajemy kredyty z planu. Subskrypcję anulujesz w panelu płatności Stripe: plan działa do końca opłaconego okresu, a kredyty zostają na koncie.","en":"Yes — the plan renews every month, and after each paid payment we add the plan''s credits. You cancel in the Stripe billing portal: the plan stays active until the end of the paid period, and your credits stay in your account.","de":"Ja — der Plan verlängert sich jeden Monat, und nach jeder bezahlten Zahlung schreiben wir die Credits des Plans gut. Du kündigst im Stripe-Zahlungsportal: Der Plan bleibt bis zum Ende des bezahlten Zeitraums aktiv, und deine Credits bleiben auf dem Konto."}'::jsonb, '{"pl":"Tak, plan odnawia się automatycznie co miesiąc lub co rok, zależnie od wybranego rozliczenia. Możesz go anulować w każdej chwili w ustawieniach konta."}'::jsonb, 30, true, array['faq', 'plany']::text[], false, false, 'Import FAQ V1: widoczna jest dotychczasowa, sprawdzona odpowiedź z cennika (/plany). Propozycja z briefu wymaga weryfikacji: rozliczenie roczne nie jest dziś w sprzedaży (żaden plan nie ma ceny rocznej), a anulowanie odbywa się w panelu płatności Stripe, otwieranym z ustawień konta.', 'brief:16'),
      ('jak-anulowac-subskrypcje', 'platnosci-i-faktury', '{"pl":"Jak anulować subskrypcję?","en":"How do I cancel my subscription?","de":"Wie kündige ich mein Abo?"}'::jsonb, '{"pl":"W ustawieniach konta, w zakładce Plan. Po anulowaniu plan działa do końca opłaconego okresu.","en":"In your account settings, on the Plan tab. After you cancel, your plan stays active until the end of the paid period.","de":"In den Kontoeinstellungen im Tab „Plan“. Nach der Kündigung bleibt dein Plan bis zum Ende des bezahlten Zeitraums aktiv."}'::jsonb, null::jsonb, 40, false, array['faq']::text[], false, true, 'Wymaga weryfikacji: w ustawieniach konta nie ma zakładki „Plan” (są: Profil, Konto i bezpieczeństwo, Subskrypcje, Preferencje); anulowanie odbywa się w panelu płatności Stripe.', 'brief:17'),
      ('czy-istnieje-mozliwosc-zwrotu', 'platnosci-i-faktury', '{"pl":"Czy istnieje możliwość zwrotu?","en":"Can I get a refund?","de":"Gibt es eine Rückerstattung?"}'::jsonb, '{"pl":"Każdą prośbę o zwrot płatności rozpatrujemy indywidualnie — napisz do nas przez stronę kontaktu. Kredyty za generacje, które się nie udały, wracają na konto automatycznie.","en":"We review every refund request individually — write to us through the contact page. Credits for generations that failed go back to your account automatically.","de":"Jede Anfrage auf Rückerstattung prüfen wir einzeln — schreib uns über die Kontaktseite. Credits für fehlgeschlagene Generierungen gehen automatisch auf dein Konto zurück."}'::jsonb, '{"pl":"[DO POTWIERDZENIA – zgodnie z regulaminem]"}'::jsonb, 50, true, array['faq', 'plany']::text[], false, false, 'Import FAQ V1: widoczna jest dotychczasowa, sprawdzona odpowiedź z cennika (/plany). Odpowiedź z briefu to [DO POTWIERDZENIA – zgodnie z regulaminem].', 'brief:18'),
      ('czy-produkt-bedzie-wygladal-jak-prawdziwy', 'jakosc-i-wyniki', '{"pl":"Czy produkt na grafice będzie wyglądał jak prawdziwy?","en":"Will the product in the image look like the real one?","de":"Sieht das Produkt auf der Grafik aus wie das echte?"}'::jsonb, '{"pl":"Na tym zależy nam najbardziej: kształt, kolor i detale produktu mają zostać zachowane. AI może jednak czasem zmienić drobny element, np. napis na opakowaniu, dlatego przed wystawieniem oferty zawsze sprawdź grafikę.","en":"That is what matters to us most: the product''s shape, colour and details should be preserved. AI can still sometimes change a small element, such as the text on a package, so always check the image before you publish a listing.","de":"Darauf legen wir am meisten Wert: Form, Farbe und Details des Produkts sollen erhalten bleiben. Die KI kann aber manchmal ein kleines Element verändern, etwa die Schrift auf einer Verpackung – prüfe die Grafik deshalb immer, bevor du ein Angebot einstellst."}'::jsonb, null::jsonb, 10, true, array['faq']::text[], false, false, null::text, 'brief:19'),
      ('co-jesli-wynik-mi-sie-nie-podoba', 'jakosc-i-wyniki', '{"pl":"Co zrobić, jeśli wynik mi się nie podoba?","en":"What if I don''t like the result?","de":"Was tun, wenn mir das Ergebnis nicht gefällt?"}'::jsonb, '{"pl":"Wygeneruj grafikę ponownie lub spróbuj innego zdjęcia wejściowego – często lepsze światło lub ostrość robią dużą różnicę. Jeśli problem się powtarza, napisz do nas i podaj ID generacji.","en":"Generate the image again or try a different input photo – better light or focus often makes a big difference. If the problem keeps coming back, write to us and include the generation ID.","de":"Erstelle die Grafik erneut oder probiere ein anderes Ausgangsfoto – besseres Licht oder mehr Schärfe machen oft einen großen Unterschied. Wenn das Problem bleibt, schreib uns und gib die Generierungs-ID an."}'::jsonb, null::jsonb, 20, true, array['faq']::text[], false, false, null::text, 'brief:20'),
      ('czy-grafiki-nadaja-sie-na-allegro', 'jakosc-i-wyniki', '{"pl":"Czy grafiki nadają się na Allegro i inne marketplace’y?","en":"Are the images suitable for Allegro and other marketplaces?","de":"Eignen sich die Grafiken für Allegro und andere Marktplätze?"}'::jsonb, '{"pl":"Narzędzia są przygotowane z myślą o wymaganiach marketplace’ów, np. kwadratowy format i czyste tło. Zasady poszczególnych platform się zmieniają, dlatego przed wystawieniem oferty sprawdź aktualny regulamin platformy.","en":"The tools are designed with marketplace requirements in mind, such as a square format and a clean background. Each platform''s rules change, so check its current terms before you publish a listing.","de":"Die Werkzeuge sind auf die Anforderungen von Marktplätzen ausgelegt, etwa ein quadratisches Format und ein sauberer Hintergrund. Die Regeln der einzelnen Plattformen ändern sich, prüfe deshalb vor dem Einstellen eines Angebots die aktuellen Bedingungen der Plattform."}'::jsonb, null::jsonb, 30, true, array['faq']::text[], false, false, null::text, 'brief:21'),
      ('rozdzielczosc-i-format-grafik', 'jakosc-i-wyniki', '{"pl":"W jakiej rozdzielczości i formacie pobiorę grafiki?","en":"In what resolution and format can I download the images?","de":"In welcher Auflösung und welchem Format lade ich die Grafiken herunter?"}'::jsonb, '{"pl":"[DO POTWIERDZENIA: rozdzielczość i formaty]"}'::jsonb, null::jsonb, 40, false, array['faq']::text[], false, false, 'Do uzupełnienia: rozdzielczość i formaty.', 'brief:22'),
      ('czy-moge-uzywac-grafik-komercyjnie', 'prawa-i-dane', '{"pl":"Czy mogę używać grafik komercyjnie?","en":"Can I use the images commercially?","de":"Darf ich die Grafiken kommerziell nutzen?"}'::jsonb, '{"pl":"Tak, grafiki wygenerowane w płatnym planie możesz wykorzystywać w swoich ofertach, sklepie i reklamach. [DO POTWIERDZENIA: zakres zgodny z regulaminem]"}'::jsonb, null::jsonb, 10, false, array['faq']::text[], false, false, 'Do uzupełnienia: zakres zgodny z regulaminem.', 'brief:23'),
      ('co-dzieje-sie-z-moimi-zdjeciami', 'prawa-i-dane', '{"pl":"Co dzieje się z moimi zdjęciami?","en":"What happens to my photos?","de":"Was passiert mit meinen Fotos?"}'::jsonb, '{"pl":"[DO POTWIERDZENIA: przechowywanie, okres usuwania, przekazywanie dostawcom modeli]"}'::jsonb, null::jsonb, 20, false, array['faq', 'o-nas']::text[], false, false, 'Do uzupełnienia: przechowywanie, okres usuwania, przekazywanie dostawcom modeli.', 'brief:24'),
      ('czy-zdjecia-sa-uzywane-do-trenowania-ai', 'prawa-i-dane', '{"pl":"Czy moje zdjęcia są używane do trenowania AI?","en":"Are my photos used to train AI?","de":"Werden meine Fotos zum Trainieren von KI verwendet?"}'::jsonb, '{"pl":"[DO POTWIERDZENIA]"}'::jsonb, null::jsonb, 30, false, array['faq', 'o-nas']::text[], false, false, 'Do uzupełnienia: odpowiedź z briefu to [DO POTWIERDZENIA].', 'brief:25'),
      ('jak-usunac-konto', 'konto-i-firma', '{"pl":"Jak usunąć konto?","en":"How do I delete my account?","de":"Wie lösche ich mein Konto?"}'::jsonb, '{"pl":"[DO POTWIERDZENIA: w ustawieniach konta lub przez kontakt]"}'::jsonb, null::jsonb, 10, false, array['faq']::text[], false, false, 'Do uzupełnienia: w ustawieniach konta czy przez kontakt.', 'brief:26'),
      ('czy-moge-dodac-wspolpracownikow', 'konto-i-firma', '{"pl":"Czy mogę dodać do konta współpracowników?","en":"Can I add collaborators to my account?","de":"Kann ich meinem Konto Mitarbeitende hinzufügen?"}'::jsonb, '{"pl":"Praca zespołowa jest w przygotowaniu i będzie dostępna w planach PRO i Business.","en":"Team collaboration is in preparation and will be available on the PRO and Business plans.","de":"Teamarbeit ist in Vorbereitung und wird in den Plänen PRO und Business verfügbar sein."}'::jsonb, null::jsonb, 20, false, array['faq']::text[], false, true, 'Wymaga weryfikacji: konfiguracja planów przewiduje miejsca w zespole także w planie Starter (Starter 2, PRO 5, Business bez limitu — wszystkie oznaczone „wkrótce”).', 'brief:27'),
      ('kto-stoi-za-grovbase', 'konto-i-firma', '{"pl":"Kto stoi za GrovBase?","en":"Who is behind GrovBase?","de":"Wer steht hinter GrovBase?"}'::jsonb, '{"pl":"GrovBase tworzą Jakub, grafik e-commerce z ponad pięcioletnim doświadczeniem, i Marcel, który od ponad sześciu lat projektuje i buduje sklepy internetowe.","en":"GrovBase is made by Jakub, an e-commerce designer with more than five years of experience, and Marcel, who has been designing and building online shops for more than six years.","de":"GrovBase wird von Jakub entwickelt, einem E-Commerce-Grafiker mit mehr als fünf Jahren Erfahrung, und von Marcel, der seit über sechs Jahren Onlineshops konzipiert und baut."}'::jsonb, null::jsonb, 30, true, array['faq', 'o-nas']::text[], false, false, null::text, 'brief:28'),
      ('dane-firmy', 'konto-i-firma', '{"pl":"Dane firmy","en":"Company details","de":"Firmendaten"}'::jsonb, '{"pl":"[nazwa firmy], [adres], NIP [numer]"}'::jsonb, null::jsonb, 40, false, array['faq', 'o-nas']::text[], false, false, 'Do uzupełnienia: nazwa firmy, adres, NIP.', 'brief:29'),
      ('kiedy-pojawi-sie-generowanie-wideo', 'nadchodzace-funkcje', '{"pl":"Kiedy pojawi się generowanie wideo?","en":"When will video generation be available?","de":"Wann kommt die Videogenerierung?"}'::jsonb, '{"pl":"Pracujemy nad tym. Na stronie głównej aplikacji kliknij „Powiadom mnie” przy wideo – damy znać, gdy będzie gotowe.","en":"We are working on it. On the app''s home page, click “Notify me” next to video – we will let you know when it is ready.","de":"Wir arbeiten daran. Klicke auf der Startseite der App bei Video auf „Benachrichtigen“ – wir sagen dir Bescheid, sobald sie fertig ist."}'::jsonb, null::jsonb, 10, true, array['faq']::text[], false, false, null::text, 'brief:30')
    ) as v(slug, category, question, answer, draft, position, visible, pages, only_premiere, needs_review, note, import_key)
    join public.faq_categories c on c.slug = v.category
  on conflict do nothing;

  -- O nas: every question of the PUBLISHED about_faq section that is not one
  -- of the brief's, with the words it has today. A known one goes to its
  -- category and place; one an admin added goes to the first category.
  select e -> 'content' into v_about
    from public.cms_pages p, jsonb_array_elements(coalesce(p.published_snapshot, '[]'::jsonb)) e
   where p.slug = 'o-nas' and e ->> 'type' = 'about_faq'
   limit 1;
  if v_about is not null and jsonb_typeof(v_about -> 'items') = 'array' then
    for v_item, v_n in select x.value, x.ordinality from jsonb_array_elements(v_about -> 'items') with ordinality x loop
      v_title := btrim(coalesce(v_item -> 'title' ->> 'pl', ''));
      continue when v_title = '' or v_title = any(v_mapped);
      v_slug := null; v_cat := null; v_after := null;
      select k ->> 'slug', k ->> 'category', k ->> 'after' into v_slug, v_cat, v_after
        from jsonb_array_elements(v_known) k where k ->> 'title' = v_title limit 1;
      if v_slug is null then
        v_slug := left(trim(both '-' from regexp_replace(
                    lower(translate(v_title, 'ąćęłńóśźżĄĆĘŁŃÓŚŹŻ', 'acelnoszzacelnoszz')), '[^a-z0-9]+', '-', 'g')), 70);
        v_slug := coalesce(nullif(trim(both '-' from v_slug), ''), 'pytanie');
        if exists (select 1 from public.faq_items i where i.slug = v_slug and i.import_key is distinct from 'o-nas:' || (v_n - 1)) then
          v_slug := v_slug || '-' || v_n;
        end if;
        v_cat := 'pierwsze-kroki';
      end if;
      v_pos := coalesce(
        (select i.position + 5 from public.faq_items i where i.slug = v_after),
        (select max(i.position) + 10 from public.faq_items i join public.faq_categories c on c.id = i.category_id where c.slug = v_cat),
        10);
      insert into public.faq_items (slug, category_id, question, answer, position, visible, pages, review_note, import_key)
      select v_slug, c.id,
             (select coalesce(jsonb_object_agg(t.key, t.value), '{}'::jsonb)
                from jsonb_each(case when jsonb_typeof(v_item -> 'title') = 'object' then v_item -> 'title' else '{}'::jsonb end) t
               where t.key in ('pl', 'en', 'de') and jsonb_typeof(t.value) = 'string' and btrim(t.value #>> '{}') <> ''),
             (select coalesce(jsonb_object_agg(t.key, t.value), '{}'::jsonb)
                from jsonb_each(case when jsonb_typeof(v_item -> 'description') = 'object' then v_item -> 'description' else '{}'::jsonb end) t
               where t.key in ('pl', 'en', 'de') and jsonb_typeof(t.value) = 'string' and btrim(t.value #>> '{}') <> ''),
             v_pos,
             not coalesce((v_item ->> 'hidden')::boolean, false),
             array['faq', 'o-nas']::text[],
             'Import FAQ V1: pytanie ze strony O nas, którego nie ma w briefie — przeniesione z jego bieżącą treścią.',
             'o-nas:' || (v_n - 1)
        from public.faq_categories c where c.slug = v_cat
      on conflict do nothing;
    end loop;
  end if;

  perform set_config('faq.internal', '', true);
  perform set_config('faq.action', '', true);
end $faq$;
-- <<< generated
