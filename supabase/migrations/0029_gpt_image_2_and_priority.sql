-- GPT IMAGE 2 + EDITABLE PROVIDER PRIORITY.
--
-- The production incident behind this: the concept router picked the first
-- reference-capable model by sort_order — Google's Nano Banana 2 — whose key
-- had an exhausted quota, while the funded OpenAI account was never tried.
-- The fix is data plus routing: the real current OpenAI image model exists
-- as a first-class row, and the order of engines is explicit, admin-editable
-- configuration instead of an accident of sort_order.

insert into ai_models (provider_id, name, display_name, model_identifier, active, sort_order,
  supports_reference_images, max_reference_images, supported_resolutions, credit_cost, pricing,
  internal_cost_usd_micros, supports_negative_prompt, badge, description)
select p.id, 'GPT Image 2', 'GPT Image 2', 'gpt-image-2', true, 5,
  true, 6, array['1K','2K'], 4, '{"1K":4,"2K":6}'::jsonb,
  40000, true, 'Zalecany', 'Najwyższa wierność produktu przy zdjęciach referencyjnych.'
from ai_providers p where p.slug='openai'
  and not exists (select 1 from ai_models where model_identifier='gpt-image-2');

-- The "GPT Image 2 High" display model was still pointing at gpt-image-1.
update ai_models set model_identifier='gpt-image-2' where name='GPT Image 2 High';

update app_settings set value = value || jsonb_build_object(
  'concept_model_id', (select id from ai_models where model_identifier='gpt-image-2' and name='GPT Image 2'),
  'provider_priority', jsonb_build_array('openai:gpt-image-2','google:gemini-3-pro-image','fal:flux-pro-1.1')
) where key='generation';
