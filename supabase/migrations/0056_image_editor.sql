-- IMAGE EDITOR — one catalogue row, and nothing else.
--
-- 0026 registered eight micro-tools, each doing one thing to one photo. The
-- editor is the ninth entry and the odd one out: instead of a single dial it
-- carries a whole state — crop, background, shadow, colour, transform — that
-- our own sharp pipeline bakes in ONE pass (lib/images/local.ts, composeEditor).
--
-- It is priced exactly like the other local tools, which is to say not at all:
--
--   credits_cost 0            — pixel work we do in our own runtime. No
--                               provider is called, no per-image fee exists, so
--                               charging for it would be inventing a cost.
--   api_cost_usd_micros 0     — nothing to reimburse.
--   min_margin_percent 0      — the margin rule guards against selling a paid
--                               API below cost; there is no cost to guard.
--
-- The row matters because toolCatalogue() joins on it: without it the service
-- lookup returns nothing, and while `enabled`/`maintenance_mode` then read as
-- "not switched off", the admin panel has no switch to turn the editor OFF with
-- when something goes wrong. That kill switch is the whole point of the row.
--
-- sort_order 19 puts the editor ahead of tool_upscale (20) — it is the front
-- door to the toolbox, not the ninth item in it — and leaves every existing
-- number untouched.
--
-- Idempotent by `on conflict (slug) do nothing`, exactly as 0026 wrote it: this
-- file must be safe to re-apply, and it must never overwrite a credits_cost or
-- an enabled flag an operator has since changed in the admin panel.
insert into public.service_catalog
  (slug, name, category, service_type, unit, credits_cost, api_cost_usd_micros, min_margin_percent, sort_order)
values
  ('tool_editor', 'Tool — editor', 'tools', 'image', 'image', 0, 0, 0, 19)
on conflict (slug) do nothing;
