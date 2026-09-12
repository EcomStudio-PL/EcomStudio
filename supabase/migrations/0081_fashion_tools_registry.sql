-- 0081 — the four Moda tools get their rows in the admin tool registry.
--
-- WHY THIS IS NOT OPTIONAL.
--
-- `ai_tool_prompts.tool_key` is a foreign key onto `ai_tools`, and
-- `ai_save_tool_prompt` (0071) refuses outright with `unknown_tool` when no row
-- exists. The four Moda tools ship as "Wkrótce" and the ONLY way to activate
-- one is for an operator to write and publish its prompt in Admin → AI. Without
-- the rows below that procedure fails on its first step, so the tools would be
-- four permanently unreachable tiles — a button that does nothing, which in this
-- project is a release blocker rather than a rough edge.
--
-- The values mirror `retouch`, which is the same shape of tool: GrovBase writes
-- the whole instruction (the seller contributes an optional hint, never the
-- prompt), the work is an edit of the seller's own photograph, and the model is
-- not the seller's choice.
--
-- NO `ai_tool_models` ROW. `lib/server/fashion.ts` resolves Nano Banana Pro by
-- its API identifier, so a "primary model" recorded here would be a control the
-- runner ignores — worse than no control. When that changes, this is where it
-- gets recorded.
--
-- Idempotent and additive: no schema change, no RLS change, nothing removed.

insert into public.ai_tools (tool_key, service_slug, engine_mode, allow_model_choice, notes) values
  ('fashion_ghost_mannequin', 'image_edit', 'grovbase', false, 'Moda — Niewidzialny manekin'),
  ('fashion_flat_lay',        'image_edit', 'grovbase', false, 'Moda — Leżący produkt'),
  ('fashion_iron',            'image_edit', 'grovbase', false, 'Moda — Wyprasuj'),
  ('fashion_change_person',   'image_edit', 'grovbase', false, 'Moda — Zmiana postaci')
on conflict (tool_key) do nothing;
