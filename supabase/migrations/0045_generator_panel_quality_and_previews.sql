-- GENERATOR PANEL: one GPT Image 2 with a quality parameter, and admin-
-- editable preview slots for the two session tiles.
--
-- Nothing here is destructive: no drops, no deletes, no row removed. The
-- split display rows stay active so history, existing concept cards and an
-- admin-pinned concept_model_id that point at them keep working — they are
-- only taken off the customer's model lists, where "GPT Image 2" now stands
-- alone. (They do not serve as quality fallbacks: a pinned row cannot honour
-- a different paid-for quality, so the fallback guard skips it.)

-- 1) GPT Image 2 declares the quality knob. The price per quality follows
--    what the split rows used to charge: the base table stays the "medium"
--    price, "high" is what the High row cost, "low" sits below. Admins tune
--    it in ai_models.metadata->'quality_pricing'.
update public.ai_models
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
  'qualities', jsonb_build_array('low', 'medium', 'high'),
  'quality_pricing', jsonb_build_object(
    'low',    jsonb_build_object('1K', 2, '2K', 4),
    'medium', jsonb_build_object('1K', 4, '2K', 6),
    'high',   jsonb_build_object('1K', 6, '2K', 8)
  )
)
where model_identifier = 'gpt-image-2'
  and name = 'GPT Image 2'
  and not (coalesce(metadata, '{}'::jsonb) ? 'qualities');

-- 2) The per-quality display rows leave the customer lists. They remain
--    active (history, admin pinning) and remain visible in admin.
update public.ai_models
set visible_managed = false, visible_custom = false
where name in ('GPT Image 2 High', 'GPT Image 1')
  and metadata ? 'quality';

-- 3) Session-tile preview slots. Empty by default: the tiles render a quiet
--    placeholder until the admin points these at real showcase material
--    (an https URL to a short mp4/webm or an image) from /admin/system.
insert into public.app_settings (key, value) values (
  'generator_ui',
  jsonb_build_object(
    'advertising_session_preview', '',
    'lifestyle_session_preview', ''
  )
) on conflict (key) do nothing;
