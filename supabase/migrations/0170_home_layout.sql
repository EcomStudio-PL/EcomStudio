-- 0170 — /HOME LAYOUT: sections and lists arranged in „Edytuj stronę”.
--
-- The signed-in start page (/home) draws its sections and lists from code
-- (lib/seller-home-config.ts). The visual editor now lets an admin hide and
-- reorder the sections and add / remove / hide / reorder the items of its
-- lists (lib/home-layout.ts). That arrangement is ONE document:
--
--   1. public.home_layout — one row (id 'home'), the document and who changed
--      it when. NO ROW = the code's default: the page exactly as before.
--      Admins may read the table; nobody may write it directly.
--   2. home_layout_published() — what the page reads (definer, the document
--      only, for any signed-in member).
--   3. home_layout_write(doc, base, action) — the only writer: an admin, a
--      compare-and-set on updated_at (two tabs cannot overwrite each other
--      silently), a size cap, and ONE history row in the editor's existing
--      history, public.content_versions (target 'layout', key 'home', the
--      whole document before and after) — so „Cofnij” restores a state, in
--      the database.
--   4. content_versions_target_check gains 'layout' (the same way 0155 added
--      'faq'); nothing in the table changes.
--
-- PURELY ADDITIVE: no row, table, policy or function that exists is dropped
-- or rewritten; no picture, slot, text or history row is touched. Re-runnable.
--
-- ROLLBACK (manual): drop function home_layout_write(jsonb, timestamptz, text),
-- home_layout_published(); drop table home_layout; delete from content_versions
-- where target = 'layout'; restore the target check to ('text','slot','cms','faq').

set local lock_timeout = '3s';

-- 1 ─────────────────────────────────────────────────────────────────────────
create table if not exists public.home_layout (
  id text primary key default 'home' check (id = 'home'),
  doc jsonb not null check (jsonb_typeof(doc) = 'object' and octet_length(doc::text) <= 200000),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
alter table public.home_layout enable row level security;

do $policy$ begin
  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'home_layout' and policyname = 'home_layout_admin_read') then
    create policy home_layout_admin_read on public.home_layout
      for select to authenticated
      using ((select public.is_admin()));
  end if;
end $policy$;
-- No INSERT / UPDATE / DELETE policy: home_layout_write() is the only door.
revoke insert, update, delete on public.home_layout from anon, authenticated;

-- 2 ─────────────────────────────────────────────────────────────────────────
create or replace function public.home_layout_published()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('doc', l.doc, 'updated_at', l.updated_at)
    from public.home_layout l where l.id = 'home';
$$;
revoke all on function public.home_layout_published() from public, anon;
grant execute on function public.home_layout_published() to authenticated;

-- 4 (before 3: the writer inserts target 'layout') ─────────────────────────
alter table public.content_versions drop constraint if exists content_versions_target_check;
alter table public.content_versions add constraint content_versions_target_check
  check (target in ('text', 'slot', 'cms', 'faq', 'layout'));

-- 3 ─────────────────────────────────────────────────────────────────────────
create or replace function public.home_layout_write(p_doc jsonb, p_base timestamptz, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.home_layout%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if not public.is_admin() then raise exception 'not_admin' using errcode = '42501'; end if;
  if p_action is null or p_action not in ('save', 'restore') then raise exception 'bad_action'; end if;
  if p_doc is null or jsonb_typeof(p_doc) <> 'object' or (p_doc->>'v') is distinct from '1'
     or octet_length(p_doc::text) > 200000 then
    raise exception 'bad_input';
  end if;

  select * into v_old from public.home_layout where id = 'home' for update;
  -- Compare-and-set: the editor sends the updated_at it last read (null when
  -- it read no row). Anything else is someone else's newer change.
  if found then
    if p_base is null or p_base is distinct from v_old.updated_at then
      raise exception 'conflict' using detail = v_old.updated_at::text;
    end if;
    if v_old.doc = p_doc then raise exception 'noop'; end if;
    update public.home_layout set doc = p_doc, updated_at = v_now, updated_by = auth.uid() where id = 'home';
  else
    if p_base is not null then raise exception 'conflict'; end if;
    insert into public.home_layout (id, doc, updated_at, updated_by) values ('home', p_doc, v_now, auth.uid());
  end if;

  insert into public.content_versions (target, key, locale, action, before, after, created_by)
  values ('layout', 'home', null, p_action,
          case when v_old.id is null then null else jsonb_build_object('doc', v_old.doc, 'updated_at', v_old.updated_at) end,
          jsonb_build_object('doc', p_doc, 'updated_at', v_now),
          auth.uid());
  return jsonb_build_object('updated_at', v_now);
end;
$$;
revoke all on function public.home_layout_write(jsonb, timestamptz, text) from public, anon;
grant execute on function public.home_layout_write(jsonb, timestamptz, text) to authenticated;

comment on table public.home_layout is
  '/home: the sections and lists an admin arranged in Edytuj stronę (lib/home-layout.ts). No row = the code default. Written only by home_layout_write(); history in content_versions (target layout).';
