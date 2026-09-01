-- ============================================================
-- 0044 — GENERATION WITHOUT A PRODUCT CATALOGUE ENTRY
--
-- The generator stopped being a product catalogue: sellers drop today's
-- photos straight in (from a folder, a shop page, a supplier) and generate.
-- Nothing is saved as a product any more, so a concept row can no longer be
-- forced to point at one.
--
-- `generation_jobs.product_id` and `generations.product_id` were already
-- nullable; this only relaxes the last NOT NULL in the chain.
--
-- NON-DESTRUCTIVE: no table is dropped, no row is deleted, no existing
-- product or historical session is touched. Sessions that DO carry a
-- product (opened from the products page) keep working exactly as before.
-- ============================================================

alter table public.generated_prompts
  alter column product_id drop not null;
