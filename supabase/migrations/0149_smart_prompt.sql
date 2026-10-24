-- INTELIGENTNY PROMPT — the "Twój prompt" helper in Stwórz zdjęcie.
--
-- The customer clicks, a cheap text model rewrites their own idea into a
-- precise photographic prompt, and the text lands in the SAME textarea, where
-- they can read and change it. Generate then sends exactly what is visible —
-- nothing is appended, nothing is hidden. This migration adds only what the
-- feature needs to be priced, switched and configured:
--
--   1. service_catalog 'smart_prompt' — the price (1 credit by default) and the
--      on/off switch. Read by usage_event_start, so the price a customer pays
--      is always the catalogue's, taken server-side; the request carries no
--      price at all. Editable in Admin → AI → Generator (and Admin → Usługi).
--   2. app_settings 'smart_prompt' — PRIVATE (app_setting_is_private): the text
--      model choice and an optional operator instruction. A customer never
--      reads the row; the server reads it through smart_prompt_config_read(),
--      gated by server_call_ok. Admins edit it (settings_admin_write).
--   3. smart_prompt_config_read(p_token) — that reader.
--
-- No table, no new ledger: the charge, the refund and the cost trace are the
-- existing usage_event_start / usage_event_fail / ai_provider_call_record.

-- 1 ─────────────────────────────────────────────────────────────────────────
insert into public.service_catalog
  (slug, name, category, service_type, unit, credits_cost, api_cost_usd_micros, min_margin_percent, enabled, sort_order, metadata)
values
  ('smart_prompt', 'Inteligentny prompt', 'generation', 'prompt', 'prompt', 1, 0, 50, true, 3,
   jsonb_build_object('note', 'One rewrite of the customer''s own prompt by a text model. Each click (a new version included) is one charge; a failed call is refunded.'))
on conflict (slug) do nothing;

-- 2 ─────────────────────────────────────────────────────────────────────────
create or replace function public.app_setting_is_private(p_key text)
returns boolean
language sql
immutable parallel safe
as $$
  select p_key in (
    'notifications',
    'login_security_dispatch',
    'auth_email_hook',
    'ai_background_presets',
    'thumbnail',
    'trial_watermark',
    'prelaunch',
    'smart_prompt'
  );
$$;

-- A small, cheap text model by default (OpenAI's own fallbacks still apply
-- when the id is retired). provider 'auto' = the planner chain (Admin → AI →
-- Modele), model '' = that provider's default, instruction '' = the built-in
-- server instruction.
insert into public.app_settings (key, value)
values ('smart_prompt', jsonb_build_object(
  'v', 1,
  'provider', 'openai',
  'model', 'gpt-5-mini',
  'instruction', ''
))
on conflict (key) do nothing;

-- 3 ─────────────────────────────────────────────────────────────────────────
create or replace function public.smart_prompt_config_read(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  return (select s.value from public.app_settings s where s.key = 'smart_prompt');
end $$;

revoke all on function public.smart_prompt_config_read(text) from public, anon;
grant execute on function public.smart_prompt_config_read(text) to authenticated;

comment on function public.smart_prompt_config_read(text) is
  'Inteligentny prompt settings (text model, operator instruction) for GrovBase''s own server only: gated by server_call_ok. The row itself is private (app_setting_is_private). Null when the row is missing — the feature is then unavailable.';
