-- Prompt generation must not depend on any single provider being healthy.
-- The engine now walks a chain of configured analysis providers, and these
-- columns record what actually happened so an operator can see when and why a
-- fallback was used. Customers never see any of it.
alter table public.prompt_sessions
  add column if not exists analysis_provider text,
  add column if not exists fallback_from text,
  add column if not exists fallback_reason text;

comment on column public.prompt_sessions.analysis_provider is
  'Provider that actually served the analysis/scene work for this session.';
comment on column public.prompt_sessions.fallback_from is
  'Provider that was skipped before the one that succeeded, when a fallback happened.';
comment on column public.prompt_sessions.fallback_reason is
  'Failure classification that triggered the fallback (quota, rate limit, auth, outage).';
