-- PROMPT ENGINE V3 — reference capacity.
--
-- The engine now selects 3-6 references per prompt (primary + role-assigned
-- supporting images) because every verified angle is fidelity the model would
-- otherwise invent. A model capped at 4 would silently drop the extra
-- references at generation time, so the image models that accept more inputs
-- are raised to 6. Admin-editable afterwards: this only lifts the ceiling for
-- models still sitting on the old default.
update public.ai_models
   set max_reference_images = 6
 where supports_reference_images = true
   and max_reference_images < 6
   and model_identifier in ('gpt-image-1', 'gemini-2.5-flash-image');
