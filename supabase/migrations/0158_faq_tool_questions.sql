-- 0158 — FAQ V1 ON A TOOL'S PAGE: a question can be assigned to tools.
--
-- Public Tools V1 shows three short questions under a tool's panel (only to
-- visitors, only while `public_tools` is on). They come from THE SAME base
-- as /faq, /plany and /o-nas (0155) — no second table of questions. A
-- question gets one more list next to `pages`: `tools`, the catalogue keys
-- of the tools it belongs to ("retouch", "remove_bg", "ecommerce.thumbnail"…;
-- lib/public-tools.ts PUBLIC_TOOLS is the list the editor offers).
--
-- A question shown only on a tool page (no page, one tool) is legitimate, so
-- faq_public() now returns a question that has a page OR a tool — and still
-- only when it is visible, reviewed, of a visible category, with no empty
-- text and no [placeholder] (faq_text_ok). It returns the new `tools` column;
-- the code that reads it ignores columns it does not know, so the FAQ V1
-- build keeps working before and after.
--
-- faq_restore() puts `tools` back too (a version saved before this file has
-- none, and restores as none).
--
-- RE-RUNNABLE. ROLLBACK (manual): restore faq_public() and faq_restore() from
-- 0155, then `alter table public.faq_items drop column tools;
-- drop function public.faq_tools_ok(text[]);`

set local lock_timeout = '10s';

-- Catalogue keys: lower case, digits, single `.`/`_` between words, each at
-- most once, at most 20 of them.
create or replace function public.faq_tools_ok(p text[])
returns boolean
language sql
immutable
set search_path = public
as $$
  select p is not null and cardinality(p) <= 20
    and not exists (select 1 from unnest(p) x
                     where x is null or length(x) > 60 or x !~ '^[a-z0-9]+([._][a-z0-9]+)*$')
    and cardinality(p) = (select count(distinct x) from unnest(p) x);
$$;

grant execute on function public.faq_tools_ok(text[]) to anon, authenticated;

alter table public.faq_items add column if not exists tools text[] not null default '{}'::text[];
alter table public.faq_items drop constraint if exists faq_items_tools_check;
alter table public.faq_items add constraint faq_items_tools_check check (public.faq_tools_ok(tools));

-- The return type gains a column, so the function is replaced, not altered.
drop function if exists public.faq_public();
create function public.faq_public()
returns table (
  slug text, category text, category_name jsonb, category_position integer, category_topic text,
  "position" integer, question jsonb, answer jsonb, pages text[], only_premiere boolean, tools text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select i.slug, c.slug, c.name, c.position, c.contact_topic,
         i.position, i.question, i.answer, i.pages, i.only_premiere, i.tools
    from public.faq_items i
    join public.faq_categories c on c.id = i.category_id
   where i.visible and not i.needs_review and c.visible
     and (cardinality(i.pages) > 0 or cardinality(i.tools) > 0)
     and public.faq_text_ok(i.question ->> 'pl')
     and public.faq_text_ok(i.answer ->> 'pl')
   order by c.position, c.slug, i.position, i.slug;
$$;

revoke all on function public.faq_public() from public;
grant execute on function public.faq_public() to anon, authenticated;
comment on function public.faq_public() is
  'FAQ V1: the questions a visitor may read — visible, reviewed, of a visible category, on a page or a tool (0158), no empty text and no [placeholder] in Polish.';

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
           tools = array(select jsonb_array_elements_text(coalesce(s -> 'tools', '[]'::jsonb))),
           only_premiere = coalesce((s ->> 'only_premiere')::boolean, false),
           needs_review = coalesce((s ->> 'needs_review')::boolean, false),
           review_note = s ->> 'review_note',
           draft_answer = case when jsonb_typeof(s -> 'draft_answer') = 'object' then s -> 'draft_answer' end
     where id = v_id;
  else
    perform set_config('faq.internal', 'on', true);
    insert into public.faq_items (
      id, slug, category_id, question, answer, position, visible, pages, tools, only_premiere, needs_review,
      review_note, draft_answer, helpful_count, unhelpful_count, import_key, created_at
    ) values (
      v_id, s ->> 'slug', (s ->> 'category_id')::uuid, s -> 'question', s -> 'answer',
      coalesce((select max(i.position) + 10 from public.faq_items i where i.category_id = (s ->> 'category_id')::uuid), 10),
      (s ->> 'visible')::boolean,
      array(select jsonb_array_elements_text(s -> 'pages')),
      array(select jsonb_array_elements_text(coalesce(s -> 'tools', '[]'::jsonb))),
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
