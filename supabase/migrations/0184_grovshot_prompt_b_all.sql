-- GROVSHOT (24.11.2026): every new order runs prompt B with references V2
-- (the scene-state references, the KB image rules, the plan gate) — until now
-- admins' orders only ("b_admin"). Orders already started keep their pinned
-- variant. Rollback: set prompt.variant back to "b_admin" (or "a").
update public.app_settings
set value = jsonb_set(coalesce(value, '{}'::jsonb), '{prompt,variant}', '"b"'::jsonb, true)
where key = 'grovshot_shot';
