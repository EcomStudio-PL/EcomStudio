-- Production model verification (Image Engine V2 acceptance run):
--   • OpenAI (GPT Image 2 Medium/High) generates successfully → stays live and
--     now receives reference images through the images/edits endpoint.
--   • Google image models return quota 0 for this API key (billing not enabled
--     on the Google project) — the SAME key works for text/vision analysis.
--   • fal.ai rejects the stored key (401/403).
-- Models that cannot currently produce an image are deactivated so customers
-- never see a broken model; re-enable in Admin → Modele once the provider
-- account is funded/fixed. Nothing about pricing or history is rewritten.

-- Reference images are what carry the real product into the generation.
update public.ai_models
   set supports_reference_images = true,
       max_reference_images = greatest(max_reference_images, 4)
 where model_identifier = 'gpt-image-1';

-- gpt-image-1 tops out at 1536px, so a "4K" variant would be a promise the
-- endpoint cannot keep. High stays a genuine high-quality 2K tier.
update public.ai_models
   set pricing = '{"2K": 8}'::jsonb,
       supported_resolutions = '{2K}'::text[]
 where display_name = 'GPT Image 2 High';

update public.ai_models
   set active = false,
       metadata = metadata || jsonb_build_object(
         'unavailable_reason', 'provider_quota',
         'unavailable_note', 'Image quota is 0 for the stored Google API key — enable billing on the Google AI project, then re-activate.')
 where model_identifier in ('gemini-2.5-flash-image', 'gemini-3-pro-image-preview');

update public.ai_models
   set active = false,
       metadata = metadata || jsonb_build_object(
         'unavailable_reason', 'provider_auth',
         'unavailable_note', 'fal.ai rejects the stored key (401/403) — replace or fund the key, then re-activate.')
 where model_identifier = 'flux-pro-1.1';
