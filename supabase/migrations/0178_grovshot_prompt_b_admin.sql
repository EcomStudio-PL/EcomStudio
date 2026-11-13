-- 0178 — GROVBASE SHOT: prompt B + references V2 for ADMINISTRATORS' orders only.
--
-- The 13.11.2026 fidelity diagnosis (PROD orders 0fb04563, 9053a8e7,
-- 293ad254): the reference photos reached Nano Banana Pro intact, but the
-- prompt around them re-described the product in words, carried flag rules
-- from other categories, named excluded objects and contradicted the size;
-- whole-product shots were also sent with photos of another state. Prompt B
-- (lib/grovshot-shot/prompt-b.ts) and references V2 (refs.ts) answer that.
--
-- Until a real A/B comparison confirms it, B runs only where an
-- administrator orders (settings.prompt.variant = "b_admin"); every
-- customer keeps prompt A. An order pins its variant when it starts.
-- Changing the setting back to "a" (admin panel → GrovBase Shot → Ustawienia)
-- restores A for new orders; nothing else changes.
--
-- Only the variant key is written; every other setting stays as it is.
-- Idempotent: an explicit choice already stored is never overwritten.
update public.app_settings
   set value = jsonb_set(value, '{prompt}', coalesce(value->'prompt', '{}'::jsonb) || jsonb_build_object('variant', 'b_admin'))
 where key = 'grovshot_shot'
   and coalesce(value->'prompt'->>'variant', '') = '';
