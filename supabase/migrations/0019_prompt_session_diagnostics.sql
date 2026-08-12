-- Admin observability for the prompt engine: when a session fails, staff need
-- to know WHERE it failed and how long it took, without any secret ever being
-- written down. The customer keeps seeing the plain localized message.
alter table public.prompt_sessions
  add column if not exists error_stage text,
  add column if not exists latency_ms int;

comment on column public.prompt_sessions.error_stage is 'Pipeline stage that failed: references | analysis | scenes | prompts | storage.';
