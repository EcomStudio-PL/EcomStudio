-- 0172 — PREMIERA: CUSTOMERS SEE FOUR TOOLS
--
-- DATA ONLY. No table, column, policy or function changes: the existing
-- availability switchboard (feature_availability, migration 0060) and the
-- /tools layout (app_settings 'tools_layout') already express everything the
-- launch needs, so this only sets their values.
--
-- At launch a customer is offered exactly:
--   Generator GrovShot  (prompts, /prompts)
--   Miniaturka          (image_ecommerce + ecommerce_thumbnail, /k/ecommerce/thumbnail)
--   Packshot            (retouch, /narzedzia/packshot — formerly „Retusz zdjęć”)
--   Stwórz zdjęcie      (generator, /generator — a mode of the same generator)
-- Every other tool is switched to DISABLED: gone from every menu, list, the
-- home page, the hub and the search for customers, its direct URL answers 404
-- (FeatureGate) and its APIs 503 (featureBlockedForApi) — on the server.
-- Admins keep every screen (the gates let an admin through) and see each
-- hidden entry marked „Ukryte” / „Wyłączone”.
--
-- NOTHING IS DELETED: no generation, history, prompt, template or tool
-- configuration is touched; the rows keep their messages and windows. The old
-- e-commerce workflow „Packshot — czysty produkt na jednolitym tle”
-- (ecommerce_packshot, /k/ecommerce/packshot) is hidden, not merged with the
-- renamed Retusz (retouch) — two separate tools, two separate switches.
--
-- image_ecommerce stays ACTIVE (Miniaturka needs it) and is only taken out of
-- the menus as an entry of its own (hidden_from_menu).
--
-- Not touched on purpose: home, library, history, prompts, generator, retouch,
-- ecommerce_thumbnail, tools, inspirations, credits, support,
-- grovnews (its menu link is admin-only in code; the module is unchanged),
-- products (already DISABLED). An admin's manual settings on those stay.
--
-- The /tools layout: „Stwórz zdjęcie” (catalogue item `custom`) gets its
-- "menu" switch on, so the header list carries the four launch rows. No other
-- flag, section or order is changed.
--
-- BACKUP AND RESTORE. Before anything changes, the whole feature_availability
-- table and the `custom` flags are copied ONCE into app_settings
-- 'launch_visibility_backup_0172' (re-running the migration never overwrites
-- that first copy). To restore the pre-launch state:
--
--   delete from public.feature_availability;
--   insert into public.feature_availability
--     select * from jsonb_populate_recordset(null::public.feature_availability,
--       (select value->'feature_availability' from public.app_settings where key = 'launch_visibility_backup_0172'));
--   update public.app_settings
--      set value = jsonb_set(value, '{flags,custom}',
--            (select value->'tools_layout_custom' from public.app_settings where key = 'launch_visibility_backup_0172')),
--          updated_at = now()
--    where key = 'tools_layout'
--      and (select value->'tools_layout_custom' from public.app_settings where key = 'launch_visibility_backup_0172') is not null;
--
-- (Or switch tools back one by one in Admin → Narzędzia — the same rows.)
--
-- Idempotent: a second run sets the same values and keeps the first backup.

set local lock_timeout = '10s';

-- 1. The backup, taken once ─────────────────────────────────────────────────
insert into public.app_settings (key, value)
select 'launch_visibility_backup_0172', jsonb_build_object(
  'taken_at', now(),
  'migration', '0172_launch_tool_visibility',
  'feature_availability', coalesce((select jsonb_agg(to_jsonb(f) order by f.feature_key) from public.feature_availability f), '[]'::jsonb),
  'tools_layout_custom', (select s.value->'flags'->'custom' from public.app_settings s where s.key = 'tools_layout')
)
on conflict (key) do nothing;

-- 2. Every tool outside the launch four: DISABLED ─────────────────────────────
-- The keys are lib/features.ts FEATURE_REGISTRY entries (scripts/launch-
-- visibility-tests.ts checks this list against the registry and proves that a
-- customer is left with exactly the four launch tools).
insert into public.feature_availability as fa (feature_key, status, updated_at)
select k, 'DISABLED', now()
from unnest(array[
  -- Moda and its tools
  'image_moda',
  'fashion_ghost_mannequin', 'fashion_flat_lay', 'fashion_iron', 'fashion_change_person', 'fashion_change_face',
  -- E-commerce workflows other than Miniaturka (the category stays: Miniaturka lives in it)
  'ecommerce_packshot', 'ecommerce_context', 'ecommerce_set', 'ecommerce_scale',
  -- the categories without a launch tool
  'image_social', 'image_mailing', 'image_inne', 'image_matching',
  -- editing destinations and photo tools
  'editor', 'resize', 'compress',
  'tool_upscale', 'tool_expand', 'tool_watermark',
  'tool_remove_bg', 'tool_white_bg', 'tool_ai_background', 'tool_ai_shadow',
  'tool_relight', 'tool_beautify', 'tool_uncrop', 'tool_ghost_mannequin',
  -- the image preview's smart actions (Zmień format / rozmiar, Usuń tło, Usuń wybrane)
  'preview_actions',
  -- video (the „Wideo” menu disappears for customers while this is off)
  'video'
]) as k
on conflict (feature_key) do update
  set status = 'DISABLED', updated_at = now()
  where fa.status is distinct from 'DISABLED';

-- 3. The E-commerce CATEGORY stays open (Miniaturka lives in it: its route,
--    its API guard) but is no longer offered as an entry of its own — no
--    category card on the home page, no category hit in the search. Only
--    `hidden_from_menu`; its status (and any message) is left as it is.
insert into public.feature_availability as fa (feature_key, hidden_from_menu, updated_at)
values ('image_ecommerce', true, now())
on conflict (feature_key) do update
  set hidden_from_menu = true, updated_at = now()
  where fa.hidden_from_menu is distinct from true;

-- 4. „Stwórz zdjęcie” in the header menu ──────────────────────────────────────
update public.app_settings
   set value = jsonb_set(value, '{flags,custom,menu}', 'true'::jsonb, true),
       updated_at = now()
 where key = 'tools_layout'
   and value->'flags' ? 'custom'
   and (value->'flags'->'custom'->>'menu') is distinct from 'true';
