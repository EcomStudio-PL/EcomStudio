-- 0098 — "Zmiana twarzy modela" gets its row in the admin tool registry.
--
-- The fifth Moda tool, and the same reason 0081 existed for the first four:
-- `ai_tool_prompts.tool_key` is a foreign key onto `ai_tools`, and
-- `ai_save_tool_prompt` (0071) refuses with `unknown_tool` when no row exists.
-- This tool ships as "Wkrótce" and the ONLY way to activate it is for an
-- operator to write and publish its prompt in Admin → AI. Without the row that
-- procedure fails on its first step and the tile is permanently unreachable —
-- a button that does nothing, which this project treats as release-blocking.
--
-- The values mirror `fashion_change_person`, which is the same shape of tool:
-- GrovBase writes the whole instruction, the work is an edit of photographs the
-- seller uploaded, and the model is not the seller's choice.
--
-- NO `ai_tool_models` ROW, for the reason 0081 gives: lib/server/fashion.ts
-- resolves Nano Banana Pro by its API identifier, so a "primary model" recorded
-- here would be a control the runner ignores.
--
-- Idempotent and additive: no schema change, no RLS change, nothing removed.
-- Re-running it on a database that already has the row is a no-op.

insert into public.ai_tools (tool_key, service_slug, engine_mode, allow_model_choice, notes) values
  ('fashion_change_face', 'image_edit', 'grovbase', false, 'Moda — Zmiana twarzy modela')
on conflict (tool_key) do nothing;
