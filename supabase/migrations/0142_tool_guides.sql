-- 0142 — TOOL GUIDES: a per-tool tutorial and starter gallery, and which
-- tutorial each customer has already seen.
--
-- 1. tool_guides — one row per tool (admin key = ai_tools.tool_key): whether
--    the tutorial and the starter gallery are on, the tutorial version (an
--    admin raises it to show the tutorial to everyone again) and the admin's
--    copy per language. No row = the shipped default (lib/tool-guides.ts and
--    the dictionaries). Admins read and write it under RLS; nobody else
--    touches the table.
-- 2. tool_guides_published() — what a customer's screen may read: the two
--    switches, the version, and the copy of the parts that are switched on.
--    SECURITY DEFINER, three columns of presentation, no author, no draft.
-- 3. mark_tool_tutorial_seen(tool, version) — "this user has seen version N
--    of this tool's tutorial", kept where per-user preferences already live:
--    user_preferences.metadata.tool_tutorials = {<tool>: <version>}. ONE
--    statement merges the key, so two tabs marking two tools cannot lose one
--    another's mark. SECURITY INVOKER: the user's own row, by RLS
--    (prefs_all_own), exactly as the settings screen writes it.
--
-- Pictures are not stored here. They are media_slots rows (entity_type
-- 'tool', keys guide.<tool>.tutorial.<n> / guide.<tool>.starter.1), written
-- through media_slots_write and read through media_slots_resolve_v2 — the one
-- media library, unchanged.
--
-- PURELY ADDITIVE: two functions validating/reading, one table, one merge
-- function, policies and grants on the new objects only. Nothing that exists
-- today is altered. Presentation only: nothing here reaches a model, a
-- provider, a price or the credit ledger.
--
-- APPLY BEFORE THE CODE DEPLOY that uses it. The code treats a missing
-- function (PGRST202 / 42883) as "no saved guides" and shows the shipped ones.
--
-- ROLLBACK (manual, in this order): remove the functions
-- mark_tool_tutorial_seen and tool_guides_published, then the table
-- tool_guides, then the function tool_guide_content_ok. The tool_tutorials key
-- inside user_preferences.metadata and the media_slots rows whose key starts
-- with "guide." are inert without the code.

set local lock_timeout = '3s';

-- 1 ─────────────────────────────────────────────────────────────────────────
-- What admin-written guide copy may contain: an object of at most 64 KiB whose
-- every string is at most 2000 characters and passes content_text_ok (0141:
-- no markup brackets, no invisible, direction-changing or control characters).
create or replace function public.tool_guide_content_ok(c jsonb)
returns boolean
language sql
immutable
set search_path = public
as $fn$
  select c is null or (
    jsonb_typeof(c) = 'object'
    and octet_length(c::text) <= 65536
    and not exists (
      select 1
        from jsonb_path_query(c, 'lax $.**') as leaf(value)
       where jsonb_typeof(leaf.value) = 'string'
         and (length(leaf.value #>> '{}') > 2000
              or not public.content_text_ok(leaf.value #>> '{}'))
    )
  );
$fn$;

create table if not exists public.tool_guides (
  tool_key text primary key references public.ai_tools (tool_key) on delete cascade,
  tutorial_enabled boolean not null default true,
  starter_enabled boolean not null default true,
  tutorial_version integer not null default 1 check (tutorial_version between 1 and 1000000),
  -- {"tutorial": {"title": {pl,en,de}, "body": {...}, "steps": [{"title": {...}, "body": {...}, "art": "upload"}]},
  --  "starter":  {"title": {...}, "body": {...}}}
  -- null = the shipped default copy. Step n pairs with media slot guide.<tool>.tutorial.<n>.
  content jsonb check (public.tool_guide_content_ok(content)),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

comment on table public.tool_guides is
  'Per-tool tutorial and starter-gallery switches and copy. Presentation only: never sent to a model, a provider or a billing path. Admin-only under RLS; customers read through tool_guides_published().';

alter table public.tool_guides enable row level security;

do $policy$ begin
  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'tool_guides' and policyname = 'tool_guides_admin') then
    create policy tool_guides_admin on public.tool_guides
      for all to authenticated
      using ((select public.is_admin()))
      with check ((select public.is_admin()));
  end if;
end $policy$;

revoke all on public.tool_guides from anon;

-- 2 ─────────────────────────────────────────────────────────────────────────
create or replace function public.tool_guides_published()
returns table (
  tool_key text,
  tutorial_enabled boolean,
  starter_enabled boolean,
  tutorial_version integer,
  tutorial jsonb,
  starter jsonb
)
language sql
stable
security definer
set search_path = public
as $fn$
  select g.tool_key,
         g.tutorial_enabled,
         g.starter_enabled,
         g.tutorial_version,
         case when g.tutorial_enabled then g.content -> 'tutorial' end,
         case when g.starter_enabled then g.content -> 'starter' end
    from public.tool_guides g;
$fn$;

revoke all on function public.tool_guides_published() from public, anon, authenticated;
grant execute on function public.tool_guides_published() to anon, authenticated;

-- 3 ─────────────────────────────────────────────────────────────────────────
-- Keeps the HIGHEST version seen, so marking an old version never undoes a
-- newer one. A user without a preferences row (none on PROD today) gets an
-- empty one first; two first marks racing each other both land, because the
-- loser of the insert waits for the winner and then merges into its row.
-- A tool_tutorials value that is not an object is replaced (the key is this
-- feature's own); a stored version is clamped before the cast, so no value a
-- user wrote into their own row can make marking fail. Metadata that is not
-- an object at all is left untouched (the tutorial simply shows again).
create or replace function public.mark_tool_tutorial_seen(p_tool_key text, p_version integer)
returns void
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '42501'; end if;
  if p_tool_key is null or p_tool_key !~ '^[a-z][a-z_]{1,47}$' then raise exception 'bad_tool'; end if;
  if p_version is null or p_version not between 1 and 1000000 then raise exception 'bad_version'; end if;

  if not exists (select 1 from public.user_preferences where user_id = v_uid) then
    insert into public.user_preferences (user_id, metadata)
    values (v_uid, '{}'::jsonb)
    on conflict (user_id) do nothing;
  end if;

  update public.user_preferences
     set metadata = jsonb_set(
           coalesce(metadata, '{}'::jsonb),
           '{tool_tutorials}',
           (case when jsonb_typeof(metadata -> 'tool_tutorials') = 'object'
                 then metadata -> 'tool_tutorials' else '{}'::jsonb end)
             || jsonb_build_object(p_tool_key, greatest(
                  p_version,
                  case when jsonb_typeof(metadata -> 'tool_tutorials' -> p_tool_key) = 'number'
                       then least(greatest((metadata -> 'tool_tutorials' ->> p_tool_key)::numeric, 0), 1000000)::integer
                       else 0 end)),
           true)
   where user_id = v_uid
     and (metadata is null or jsonb_typeof(metadata) = 'object');
end;
$fn$;

revoke all on function public.mark_tool_tutorial_seen(text, integer) from public, anon;
grant execute on function public.mark_tool_tutorial_seen(text, integer) to authenticated;
