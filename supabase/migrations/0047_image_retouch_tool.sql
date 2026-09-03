-- RETUSZ ZDJĘĆ — the retouch tool's own settings row.
--
-- The tool runs on the existing generation pipeline (model registry →
-- provider adapter → usage ledger → storage), so it needs no new tables:
-- a retouch is a generation job carrying settings.operation = 'image_retouch',
-- which is how the tool lists its own results and how the cost log tells the
-- operation apart from a plain generation.
--
-- What it does need is a price the admin can move without a deploy. An empty
-- object means "charge what the model costs" (ai_models.pricing); setting
-- price_per_image charges that flat rate at every size, and price_1k /
-- price_2k / price_4k override one size each. The price is read server-side
-- on every request — the browser is only ever shown it.

insert into public.app_settings (key, value)
values ('retouch', '{}'::jsonb)
on conflict (key) do nothing;
