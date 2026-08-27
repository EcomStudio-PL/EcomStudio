-- Advisor cleanup: generation_jobs carried two identical indexes; one is
-- pure write overhead. Keep the earlier name, drop the twin.
drop index if exists public.generation_jobs_ws_created_idx;
