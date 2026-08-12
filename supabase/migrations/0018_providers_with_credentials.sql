-- Customer-side model list bug: lib/ai/router.ts checked which providers have
-- an active credential by selecting from ai_provider_credentials, but RLS
-- restricts that table to admins — so every normal customer saw "no models
-- available" in AI Studio even though generation itself worked.
-- This definer function exposes ONLY the provider ids that have an active
-- credential. No ciphertext, no iv, no auth tag, no base url: knowing that a
-- provider is configured reveals nothing secret.
create or replace function public.providers_with_credentials()
returns setof uuid
language sql security definer set search_path = public as $$
  select distinct c.provider_id
  from public.ai_provider_credentials c
  join public.ai_providers p on p.id = c.provider_id
  where c.active and p.active and auth.uid() is not null;
$$;
revoke execute on function public.providers_with_credentials() from public, anon;
grant execute on function public.providers_with_credentials() to authenticated;
