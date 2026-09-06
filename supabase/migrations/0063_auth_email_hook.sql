-- ============================================================================
-- 0063 — AUTH E-MAIL DELIVERY LOG + WEBHOOK DEDUPE
--
-- Supabase's Send Email Hook hands GrovBase the token and lets GrovBase write
-- and send the message. Two things that flow needs from the database:
--
--  1. DEDUPE. A webhook is retried on any non-2xx and on a timeout, and the
--     delivery id (`webhook-id`) is stable across those retries. One row per
--     (webhook id, recipient) is therefore the mutex: whoever inserts it first
--     sends the mail, and a retry of an already-SENT delivery does nothing.
--     A retry of a FAILED one is allowed through — that is what a retry is for.
--
--  2. A LOG an operator can read. Who it went to, which action, which template
--     and version, the locale, the transport, and why it failed if it did.
--     Never the token, never the SMTP password, never the hook secret: the
--     token is the credential in that payload, and a log is not a place to
--     keep one.
--
-- The hook runs WITHOUT a user session (it is an unauthenticated POST from
-- Supabase, authenticated by its signature), so the writes go through
-- SECURITY DEFINER functions gated by the same dispatch token the notification
-- queue and the template lookup already use — holding the anon key is not
-- enough. Reading the log needs a real admin.
-- ============================================================================

create table if not exists public.auth_email_log (
  id uuid primary key default gen_random_uuid(),
  -- The Standard Webhooks delivery id. Stable across retries, which is the
  -- whole point; unique together with the recipient because ONE email_change
  -- delivery legitimately sends two messages to two different addresses.
  webhook_id text not null,
  recipient text not null,
  -- "signup" | "recovery" | "magiclink" | "invite" | "email_change" | …
  action text not null,
  template_key text not null,
  -- 'published' when an admin's template rendered it, 'builtin' when the
  -- shipped GrovBase template did. Never 'supabase' — that is the point.
  template_source text not null check (template_source in ('published', 'builtin')),
  template_version integer,
  locale text,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  transport text,
  failure_reason text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint auth_email_log_delivery unique (webhook_id, recipient)
);

create index if not exists auth_email_log_created_idx
  on public.auth_email_log (created_at desc);

alter table public.auth_email_log enable row level security;

-- Admins read; nobody writes through the API. Every write below is a
-- SECURITY DEFINER function.
drop policy if exists auth_email_log_admin_read on public.auth_email_log;
create policy auth_email_log_admin_read on public.auth_email_log
  for select to authenticated
  using (public.is_admin());

/**
 * Claim one delivery. Returns the row id when the caller should SEND, and
 * null when it should not (bad token, or this exact delivery already went
 * out). A previously failed attempt is reset to pending and handed back, so
 * Supabase's own retry is what recovers a transient SMTP failure.
 */
create or replace function public.auth_email_claim(
  p_token text,
  p_webhook_id text,
  p_recipient text,
  p_action text,
  p_template_key text,
  p_template_source text,
  p_template_version integer,
  p_locale text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
  v_id uuid;
  v_status text;
begin
  select value->>'dispatch_hash' into v_hash
    from public.app_settings where key = 'notifications';
  if v_hash is null or v_hash = '' then return null; end if;
  if encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') is distinct from v_hash then
    return null;
  end if;

  insert into public.auth_email_log (
    webhook_id, recipient, action, template_key,
    template_source, template_version, locale, status
  ) values (
    p_webhook_id, lower(trim(p_recipient)), p_action, p_template_key,
    p_template_source, p_template_version, p_locale, 'pending'
  )
  on conflict (webhook_id, recipient) do nothing
  returning id into v_id;

  if v_id is not null then return v_id; end if;

  -- Already claimed by an earlier attempt. Only a failure may be retried.
  select id, status into v_id, v_status
    from public.auth_email_log
   where webhook_id = p_webhook_id and recipient = lower(trim(p_recipient))
   for update;
  if v_status = 'failed' then
    update public.auth_email_log
       set status = 'pending', failure_reason = null,
           template_source = p_template_source, template_version = p_template_version
     where id = v_id;
    return v_id;
  end if;
  return null;
end;
$$;

/** Record how it went. Same token gate; nothing here accepts a token value. */
create or replace function public.auth_email_finish(
  p_token text,
  p_id uuid,
  p_status text,
  p_transport text,
  p_failure text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
begin
  select value->>'dispatch_hash' into v_hash
    from public.app_settings where key = 'notifications';
  if v_hash is null or v_hash = '' then return false; end if;
  if encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') is distinct from v_hash then
    return false;
  end if;
  if p_status not in ('sent', 'failed') then return false; end if;

  update public.auth_email_log
     set status = p_status,
         transport = left(coalesce(p_transport, ''), 40),
         -- Bounded, and it is the mail server's own words: safeError() has
         -- already scrubbed it on the way in.
         failure_reason = nullif(left(coalesce(p_failure, ''), 300), ''),
         sent_at = case when p_status = 'sent' then now() else sent_at end
   where id = p_id;
  return found;
end;
$$;

revoke execute on function public.auth_email_claim(text, text, text, text, text, text, integer, text) from public;
grant execute on function public.auth_email_claim(text, text, text, text, text, text, integer, text) to anon, authenticated;
revoke execute on function public.auth_email_finish(text, uuid, text, text, text) from public;
grant execute on function public.auth_email_finish(text, uuid, text, text, text) to anon, authenticated;
