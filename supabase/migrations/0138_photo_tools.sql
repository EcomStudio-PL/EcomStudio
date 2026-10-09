-- 0138 — THE FOUR PHOTO TOOLS: Usuń tło, Zmień kolor tła, Dodaj tło AI, Dodaj cień.
--
-- ADDITIVE ONLY. Nothing is dropped, no price (credits_cost) is touched, no
-- existing row loses a value it had. Safe to apply before or after the deploy
-- that uses it: the code reads every object below defensively (no ai_tools row
-- → no "Modele, API i koszty" tab; no presets row → no presets).
--
-- 1. REGISTRY ROWS. Each tool gets its own row in the tool registry, the way
--    tool_upscale / tool_expand already have one (0070), so it has its own
--    admin page with the execution path, costs and run history. engine_mode
--    'off': none of them has a prompt engine — Photoroom is called with
--    explicit parameters, not a template.
--
-- 2. THE COST SNAPSHOT, CORRECTED (cost, not price). tool_remove_bg carried
--    fal's 4000 µ$ from 0026; the tool now runs on Photoroom's Remove
--    Background API at $0.02. tool_white_bg was a free local tool (0); it now
--    makes one /v1/segment call when the photo is not already cut out. This
--    column is only the analytics fallback for a run with no provider trace —
--    credits_cost (the price an operator set) is left exactly as it is.
--
-- 3. THE "DODAJ TŁO AI" PRESETS, PRIVATE. The scene presets are GrovBase's own
--    prompt wording, so the row is added to app_setting_is_private (the 0107
--    denylist — the three keys it already names are kept verbatim) and read by
--    the server through a SECURITY DEFINER function gated by the server token,
--    exactly like provider credentials. Admins keep reading and writing it via
--    settings_admin_write.

-- 1 ─────────────────────────────────────────────────────────────────────────
insert into public.ai_tools (tool_key, service_slug, engine_mode)
values
  ('tool_remove_bg',     'tool_remove_bg',     'off'),
  ('tool_white_bg',      'tool_white_bg',      'off'),
  ('tool_ai_background', 'tool_ai_background', 'off'),
  ('tool_ai_shadow',     'tool_ai_shadow',     'off')
on conflict (tool_key) do nothing;

-- 2 ─────────────────────────────────────────────────────────────────────────
update public.service_catalog
   set api_cost_usd_micros = 20000
 where slug in ('tool_remove_bg', 'tool_white_bg')
   and api_cost_usd_micros is distinct from 20000;

-- 3 ─────────────────────────────────────────────────────────────────────────
create or replace function public.app_setting_is_private(p_key text)
returns boolean
language sql
immutable parallel safe
as $$
  select p_key in (
    'notifications',
    'login_security_dispatch',
    'auth_email_hook',
    'ai_background_presets'
  );
$$;

insert into public.app_settings (key, value)
values ('ai_background_presets', jsonb_build_object('v', 1, 'presets', jsonb_build_array(
  jsonb_build_object('key', 'studio_premium', 'enabled', true, 'expandPrompt', false,
    'label', jsonb_build_object('pl', 'Studio premium', 'en', 'Premium studio', 'de', 'Premium-Studio'),
    'prompt', 'premium photo studio, seamless soft grey backdrop, soft diffused key light, subtle reflection on a glossy surface, high-end commercial product photography'),
  jsonb_build_object('key', 'modern_interior', 'enabled', true, 'expandPrompt', false,
    'label', jsonb_build_object('pl', 'Nowoczesne wnętrze', 'en', 'Modern interior', 'de', 'Modernes Interieur'),
    'prompt', 'product standing on a light oak table in a modern minimalist living room, soft natural daylight from a large window, softly blurred background'),
  jsonb_build_object('key', 'nature', 'enabled', true, 'expandPrompt', false,
    'label', jsonb_build_object('pl', 'Natura', 'en', 'Nature', 'de', 'Natur'),
    'prompt', 'product on a natural stone surrounded by fresh green leaves and moss, soft morning sunlight, shallow depth of field'),
  jsonb_build_object('key', 'kitchen', 'enabled', true, 'expandPrompt', false,
    'label', jsonb_build_object('pl', 'Kuchnia', 'en', 'Kitchen', 'de', 'Küche'),
    'prompt', 'product on a white marble countertop in a bright modern kitchen, soft natural light, softly blurred kitchen in the background'),
  jsonb_build_object('key', 'bathroom', 'enabled', true, 'expandPrompt', false,
    'label', jsonb_build_object('pl', 'Łazienka', 'en', 'Bathroom', 'de', 'Badezimmer'),
    'prompt', 'product on a white marble shelf in an elegant bright bathroom, soft diffused light, calm spa atmosphere, softly blurred background'),
  jsonb_build_object('key', 'outdoor', 'enabled', true, 'expandPrompt', false,
    'label', jsonb_build_object('pl', 'Plener', 'en', 'Outdoor', 'de', 'Im Freien'),
    'prompt', 'product on a wooden table outdoors on a sunny day, green park softly blurred in the background, natural warm sunlight'),
  jsonb_build_object('key', 'minimal_studio', 'enabled', true, 'expandPrompt', false,
    'label', jsonb_build_object('pl', 'Minimalistyczne studio', 'en', 'Minimal studio', 'de', 'Minimalistisches Studio'),
    'prompt', 'minimalist studio set with a plain soft pastel background and a simple podium, clean composition, soft even lighting'),
  jsonb_build_object('key', 'luxury_ad', 'enabled', true, 'expandPrompt', false,
    'label', jsonb_build_object('pl', 'Luksusowa reklama', 'en', 'Luxury advertisement', 'de', 'Luxuswerbung'),
    'prompt', 'luxury advertising scene, product on a black marble pedestal, dramatic soft spotlight, dark elegant background with subtle gold accents')
)))
on conflict (key) do nothing;

create or replace function public.ai_background_presets_read(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  return coalesce(
    (select s.value from public.app_settings s where s.key = 'ai_background_presets'),
    '{}'::jsonb
  );
end $$;

revoke all on function public.ai_background_presets_read(text) from public, anon;
grant execute on function public.ai_background_presets_read(text) to authenticated;

comment on function public.ai_background_presets_read(text) is
  'Scene presets of "Dodaj tło AI" (prompts included) for GrovBase''s own server only: gated by server_call_ok. The row itself is private (app_setting_is_private).';
