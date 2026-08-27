-- Rebrand: the app_settings "general" row was seeded with the old product
-- name. Data fix only — swap the app_name value where it still says
-- EcomStudio; a custom admin-set name is left alone.
update public.app_settings
set value = jsonb_set(value, '{app_name}', '"GrovBase"')
where key = 'general'
  and value->>'app_name' = 'EcomStudio';
