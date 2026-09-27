-- GEMINI IMAGE MODEL IDS — the ones Google actually serves under these names.
--
-- Verified against Google's own model list (GET /v1beta/models with the
-- production key, 2026-09-27):
--   gemini-3-pro-image            "Nano Banana Pro"   (generally available)
--   gemini-3-pro-image-preview    "Nano Banana Pro"   (the preview it replaced)
--   gemini-3.1-flash-image        "Nano Banana 2"
--
-- The catalogue had it the other way round since 0016: the row NAMED
-- "Nano Banana Pro" (the model Retusz and Moda run on) called the PREVIEW id,
-- while the row named "Nano Banana 2" called gemini-3-pro-image — i.e. it was
-- Nano Banana Pro under another name and a lower price. Both rows are fixed
-- IN PLACE, so nothing is duplicated and every reference by id (tool
-- assignments, job history, prices, visibility) stays exactly where it is:
--
--   · "Nano Banana 2" → gemini-3.1-flash-image (what that name means at Google)
--   · "Nano Banana Pro" → gemini-3-pro-image (GA)
--
-- The first update frees the id the second one takes — (provider_id,
-- model_identifier) is unique. Each update only touches a row still carrying
-- the old id, so re-applying this file is a no-op, and a database seeded
-- differently (DEV, a fresh project) is left alone.
--
-- app_settings.generation.provider_priority names models as
-- "provider:identifier"; its entries follow the rows they meant, in order.

do $$
declare
  v_google uuid;
  v_nb2 boolean := false;
  v_pro boolean := false;
  v_list jsonb;
  v_out jsonb := '[]'::jsonb;
  v_entry text;
begin
  select id into v_google from public.ai_providers where slug = 'google';
  if v_google is null then return; end if;

  -- 1. The row named "Nano Banana 2" gets Nano Banana 2's id.
  update public.ai_models
     set model_identifier = 'gemini-3.1-flash-image'
   where provider_id = v_google
     and model_identifier = 'gemini-3-pro-image'
     and display_name ilike 'Nano Banana 2%'
     and not exists (select 1 from public.ai_models x
                      where x.provider_id = v_google and x.model_identifier = 'gemini-3.1-flash-image');
  v_nb2 := found;

  -- 2. Nano Banana Pro moves from the preview to the generally available id.
  update public.ai_models
     set model_identifier = 'gemini-3-pro-image'
   where provider_id = v_google
     and model_identifier = 'gemini-3-pro-image-preview'
     and not exists (select 1 from public.ai_models x
                      where x.provider_id = v_google and x.model_identifier = 'gemini-3-pro-image');
  v_pro := found;

  -- 3. The priority list keeps pointing at the same rows, in the same order.
  select value->'provider_priority' into v_list from public.app_settings where key = 'generation';
  if (v_nb2 or v_pro) and jsonb_typeof(v_list) = 'array' then
    for v_entry in select jsonb_array_elements_text(v_list) loop
      if v_nb2 and v_entry = 'google:gemini-3-pro-image' then
        v_entry := 'google:gemini-3.1-flash-image';
      elsif v_pro and v_entry = 'google:gemini-3-pro-image-preview' then
        v_entry := 'google:gemini-3-pro-image';
      end if;
      if not v_out @> jsonb_build_array(v_entry) then
        v_out := v_out || jsonb_build_array(v_entry);
      end if;
    end loop;
    update public.app_settings
       set value = jsonb_set(value, '{provider_priority}', v_out)
     where key = 'generation';
  end if;
end $$;

-- ROLLBACK (manual, reverse order):
--   update ai_models set model_identifier = 'gemini-3-pro-image-preview'
--    where model_identifier = 'gemini-3-pro-image' and display_name ilike 'Nano Banana Pro%';
--   update ai_models set model_identifier = 'gemini-3-pro-image'
--    where model_identifier = 'gemini-3.1-flash-image' and display_name ilike 'Nano Banana 2%';
--   and restore generation.provider_priority from the admin panel.
