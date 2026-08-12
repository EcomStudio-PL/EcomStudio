-- Real economics need a real per-image cost. The generation path multiplies
-- ai_models.internal_cost_usd_micros by the images a provider actually
-- delivered, and that field was still 0 for every model, so every recorded
-- cost was honestly 0 and margins looked like 100%.
--
-- These are the providers' PUBLISHED list prices per image at 1024px, seeded
-- as a starting configuration only where an admin has not set a value. They
-- are fully editable in Admin -> Modele and should be reconciled against the
-- real invoice; nothing downstream ever overwrites an admin's number.
update public.ai_models set internal_cost_usd_micros = 42000
 where model_identifier = 'gpt-image-1'
   and coalesce(metadata->>'quality', 'medium') = 'medium'
   and internal_cost_usd_micros = 0;

update public.ai_models set internal_cost_usd_micros = 167000
 where model_identifier = 'gpt-image-1'
   and metadata->>'quality' = 'high'
   and internal_cost_usd_micros = 0;

update public.ai_models set internal_cost_usd_micros = 39000
 where model_identifier in ('gemini-2.5-flash-image', 'gemini-3-pro-image', 'gemini-3-pro-image-preview')
   and internal_cost_usd_micros = 0;

update public.ai_models set internal_cost_usd_micros = 40000
 where model_identifier = 'flux-pro-1.1'
   and internal_cost_usd_micros = 0;
