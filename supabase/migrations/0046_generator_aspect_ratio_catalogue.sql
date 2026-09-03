-- FORMAT PICKER — a real catalogue instead of four bare ratios.
--
-- The panel now names every format ("Kwadrat 1:1", "Stories / Reels 9:16")
-- and draws its true proportion, so a seller who does not read ratios can
-- still choose the right crop. The list a model offers stays admin-managed:
-- this migration only widens the one engine whose adapter has a verified
-- mapping for every value.
--
-- OpenAI's image endpoint really renders three shapes plus "auto" — square,
-- portrait 2:3 and landscape 3:2 — so the extra formats are served at the
-- nearest of those. That is deliberate and DISCLOSED: the adapter declares
-- exactRatios, the router forwards it, and the picker marks the rest as
-- approximate rather than promising a crop the engine cannot draw. "auto"
-- is genuine here (OpenAI's own `size: "auto"`), which is why no other
-- provider is given it.
--
-- Google and fal rows are deliberately untouched: their adapters pass the
-- ratio through verbatim, so widening them would have to be verified
-- against a live key rather than assumed from documentation.

update public.ai_models
set supported_aspect_ratios = array[
      'auto', '1:1', '4:5', '5:4', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9'
    ]
where model_identifier in ('gpt-image-2', 'gpt-image-1')
  and provider_id in (select id from public.ai_providers where slug = 'openai');
