-- MODEL CHOICE + DUAL PRICING + PLANNER SPLIT.
--
-- 1. The customer now picks the IMAGE model (globally or per card), so a
--    concept card can carry a model override and every job records which
--    origin priced it (own prompt vs EcomStudio Prompt Engine).
-- 2. EcomStudio-engine generations carry an admin-configurable surcharge on
--    top of the model's base credit price. Seeded from billing config
--    (target ~10 PLN per engine image at the current credit value) — the
--    admin edits it later without a deploy; nothing is hardcoded in code.
-- 3. The scene PLANNER gets its own provider configuration, independent of
--    image models: primary provider + optional fallback (off by default).

alter table ai_models
  add column if not exists ecom_surcharge_credits integer not null default 0;

alter table generated_prompts
  add column if not exists prompt_origin text not null default 'ecomstudio',
  add column if not exists model_id uuid references ai_models(id) on delete set null;

alter table prompt_sessions
  add column if not exists mode text not null default 'engine';

alter table generation_jobs
  add column if not exists prompt_origin text,
  add column if not exists parent_job_id uuid references generation_jobs(id) on delete set null;

-- Planner configuration: OpenAI first (the funded account), fallback only
-- when the admin explicitly enables one.
update app_settings set value = value || jsonb_build_object(
  'planner_provider', 'openai',
  'planner_fallback', ''
) where key = 'generation';

-- Seed the EcomStudio surcharge so a full engine image lands near the target
-- price at the configured credit value: ceil(target_pln / pln_per_credit) -
-- base model credits. Admin-editable per model afterwards.
update app_settings set value = value || jsonb_build_object('ecom_target_pln', 10)
  where key = 'billing';

update ai_models set ecom_surcharge_credits = greatest(0,
  (select ceil(
      coalesce((value->>'ecom_target_pln')::numeric, 10) * 100.0
      / coalesce(nullif((value->>'price_per_100_credits')::numeric, 0), 19)
    ) from app_settings where key = 'billing')::int - credit_cost)
where type = 'image';
