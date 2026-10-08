-- 0136 — /plany IS AN APPLICATION ROUTE NOW.
--
-- The public pricing page (app/plany) is a static route, so a CMS page with
-- the slug 'plany' could be created and then never be reachable. The editor
-- already refuses it (lib/services/cms.ts RESERVED); this makes the database
-- agree, the way 0127 reserved 'profile'.
--
-- 'cennik' is deliberately NOT added: /cennik is a 308 to /plany in
-- next.config.mjs, and PROD already holds a draft CMS row with that slug.
-- Reserving it would make that row violate cms_pages_slug_not_reserved on its
-- next write. The redirect wins over the CMS route either way.
--
-- Nothing else changes: credits, payments, policies and every other reserved
-- slug stay exactly as they are.

do $$
declare v_def text;
begin
  select pg_get_functiondef(to_regprocedure('public.cms_slug_is_reserved(text)')) into v_def;
  if v_def is not null and position('''plany''' in v_def) = 0 then
    -- Rebuilt from the live definition so every slug reserved so far stays
    -- reserved; only 'plany' is added to the list.
    execute replace(v_def, '''settings''', '''settings'', ''plany''');
  end if;
end $$;

-- ROLLBACK:
--   do $$ declare v_def text; begin
--     select pg_get_functiondef('public.cms_slug_is_reserved(text)'::regprocedure) into v_def;
--     execute replace(v_def, ', ''plany''', '');
--   end $$;
