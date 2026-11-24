-- GROVSHOT (24.11.2026): the card, the plan and the prompt modules run on
-- Opus 5.5 at medium effort — the setting the reference campaigns were made
-- with. Image generation (Nano Banana Pro) is not touched; no fallback model
-- is set (an unavailable Opus fails visibly instead of silently downgrading).
--
-- Opus' token price is already in ai_token_prices (nothing added here). The
-- order's text/vision spend cap goes from $1.50 to $3.00: at Opus' prices a
-- 10-shot order's text steps would sit at the old cap. Customer prices and
-- credits are unchanged. Orders already started keep the settings they pinned.
--
-- Rollback: set models.*.model back to "claude-sonnet-5-5" and
-- text_budget_usd back to 1.5 (Admin → GrovShot → Ustawienia, or SQL).

update public.app_settings
set value = jsonb_set(
      jsonb_set(coalesce(value, '{}'::jsonb), '{models}', jsonb_build_object(
        'card',   jsonb_build_object('provider', 'anthropic', 'model', 'claude-opus-5-5', 'effort', 'medium'),
        'plan',   jsonb_build_object('provider', 'anthropic', 'model', 'claude-opus-5-5', 'effort', 'medium'),
        'prompt', jsonb_build_object('provider', 'anthropic', 'model', 'claude-opus-5-5', 'effort', 'medium'))),
      '{text_budget_usd}', to_jsonb(greatest(coalesce((value->>'text_budget_usd')::numeric, 1.5), 3.0)))
where key = 'grovshot_shot';
