-- 0169 — GALLERY PER TOOL: the mode a generation job was made in.
--
-- Before: a tool's gallery filtered by `settings->>'operation'`, which only
-- Retusz, Miniaturka and the Moda tools write. The studio (GrovBase Shot 1.0 +
-- Stwórz zdjęcie) and the category presets asked for the workspace's results
-- UNFILTERED, so they listed Retusz, Miniaturka and everything else.
--
-- Now every job carries `tool_mode`: the mode (tab) that made it, derived HERE
-- from fields only the server writes — never from a display name, a file name
-- or the image. A STORED GENERATED column: computed for every existing row
-- when it is added (the backfill, deterministic and repeatable), for every new
-- row, and again whenever `settings` changes; nobody can write it. The app's
-- one mapping (lib/gallery-tools.ts) turns a tool into its modes and the
-- gallery query filters `tool_mode in (…)` in the database, so pagination,
-- counts, favourites and the session tabs all stay inside the tool.
--
-- The rules, first match wins:
--   operation image_retouch            → retouch               (Retusz)
--   operation ecommerce_thumbnail      → ecommerce_thumbnail   (Miniaturka)
--   operation …_test                   → none (an admin's workflow test)
--   settings.slot.tool                 → that tool             (the route that took the request)
--   operation (a tool key)             → that tool             (Moda tools, Workflow ON runs)
--   engine grovshot_v2                 → prompts               (GrovBase Shot V2 orders)
--   prompt_origin custom               → generator             (Stwórz zdjęcie — the customer's own prompt)
--   a prompt session or engine concept → prompts               (GrovBase Shot 1.0)
--   anything else                      → none: the image stays in the library, in no tool's gallery.
--
-- Nothing else changes: no row is updated, no credit, ledger or payment
-- table is touched, no image is moved or copied.
--
-- ROLLBACK:
--   drop index if exists public.generation_jobs_ws_tool_mode_idx;
--   alter table public.generation_jobs drop column if exists tool_mode;
--   drop function if exists public.generation_tool_mode(jsonb, text, uuid, uuid);

create or replace function public.generation_tool_mode(p_settings jsonb, p_origin text, p_session uuid, p_prompt uuid)
returns text
language sql immutable parallel safe
set search_path = ''
as $$
  select case
    when p_settings->>'operation' = 'image_retouch' then 'retouch'
    when p_settings->>'operation' = 'ecommerce_thumbnail' then 'ecommerce_thumbnail'
    when p_settings->>'operation' ~ '_test$' then null
    when p_settings->'slot'->>'tool' ~ '^[a-z][a-z0-9_]{1,48}$' then p_settings->'slot'->>'tool'
    when p_settings->>'operation' ~ '^[a-z][a-z0-9_]{1,48}$' then p_settings->>'operation'
    when p_settings->>'engine' = 'grovshot_v2' then 'prompts'
    when p_origin = 'custom' then 'generator'
    when p_session is not null or p_prompt is not null then 'prompts'
    else null
  end
$$;
revoke all on function public.generation_tool_mode(jsonb, text, uuid, uuid) from public, anon;
grant execute on function public.generation_tool_mode(jsonb, text, uuid, uuid) to authenticated, service_role;

alter table public.generation_jobs
  add column if not exists tool_mode text
  generated always as (public.generation_tool_mode(settings, prompt_origin, prompt_session_id, prompt_id)) stored;

comment on column public.generation_jobs.tool_mode is
  'The mode (tab) that made this job — derived from server-written fields (0169). A tool''s gallery lists its modes (lib/gallery-tools.ts); null = library only.';

create index if not exists generation_jobs_ws_tool_mode_idx on public.generation_jobs (workspace_id, tool_mode);
