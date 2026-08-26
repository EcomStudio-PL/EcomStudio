-- Output resolution chosen in the generator toolbar.
--
-- Until now the concept pipeline always rendered at the model's first
-- supported resolution, so a seller could never ask for 2K/4K on the models
-- that offer it. The choice belongs to the session (every shot in one batch
-- is delivered at the same size), and the server still validates it against
-- the model's real capabilities before spending a credit.
alter table public.prompt_sessions
  add column if not exists resolution text;
