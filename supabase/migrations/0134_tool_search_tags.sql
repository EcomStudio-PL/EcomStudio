-- 0134 — ADMIN-EDITABLE SEARCH TAGS FOR TOOLS.
--
-- Extra phrases that find a tool in the global search ("obróbka zdjęć",
-- "packshot" → Retusz zdjęć). METADATA ONLY: they never reach a prompt, a
-- model, a provider or a request, and they never change availability —
-- the client still filters with menuVisible() BEFORE matching.
--
-- Backward-compatible: a new column with default '{}' — every existing row
-- keeps its current behaviour, nothing else in ai_tools changes.
--
-- ai_tools stays admin-only under RLS. Visitors read ONLY the tags, through
-- a definer function returning (tool_key, search_tags) for tools that have
-- some — no other column is exposed.

alter table public.ai_tools
  add column if not exists search_tags text[] not null default '{}';

-- ≤ 30 tags, no NULL and no empty entries. The per-tag length (≤ 60) and the
-- case/diacritic de-duplication are enforced by the save action
-- (normaliseSearchTags); the total length cap here backs that up.
alter table public.ai_tools drop constraint if exists ai_tools_search_tags_check;
alter table public.ai_tools add constraint ai_tools_search_tags_check check (
  cardinality(search_tags) <= 30
  and array_position(search_tags, null) is null
  and array_position(search_tags, '') is null
  and char_length(array_to_string(search_tags, '|')) <= 2000
);

comment on column public.ai_tools.search_tags is
  'Admin search aliases for the global tool search. Search metadata only — never sent to AI.';

create or replace function public.tool_search_tags()
returns table (tool_key text, search_tags text[])
language sql stable security definer set search_path = public as $$
  select t.tool_key, t.search_tags
    from public.ai_tools t
   where cardinality(t.search_tags) > 0;
$$;
revoke all on function public.tool_search_tags() from public, anon, authenticated;
grant execute on function public.tool_search_tags() to anon, authenticated;
