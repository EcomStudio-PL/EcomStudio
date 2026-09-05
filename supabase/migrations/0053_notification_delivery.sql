-- NOTIFICATION DELIVERY — the outbox actually spends its retry budget.
--
-- 0052 gave notification_outbox an attempts ceiling (the claim refuses a row at
-- attempts >= 5) but nothing ever used it, and it handed out work before
-- Telegram was usable. Two consequences, both silent:
--
--   1. notification_dispatch_finish wrote the caller's status verbatim, so the
--      first transient Telegram failure — a 429, a 5xx, a 10s network timeout —
--      closed the row as 'failed' forever. The claim only ever looks at
--      'pending' rows, so nothing was ever retried and the budget was dead code.
--
--   2. notification_dispatch_claim handed out rows even when the Telegram
--      integration had no chat id or no bot token. The dispatcher closed each
--      one as 'skipped' (also terminal, also burning the dedupe key), so every
--      event queued while the admin was still halfway through the setup wizard
--      was eaten instead of waiting for the setup to finish.
--
-- Both functions are replaced whole below: CREATE OR REPLACE keeps the previous
-- body only for a function you do not replace, so the token check, the
-- search_path and the revoke/grant lines are repeated verbatim from 0052. The
-- file is re-runnable as it stands. No table, index or policy changes.

-- ── 1. The dispatcher's door ─────────────────────────────────────────────
-- Unchanged from 0052 apart from the "is Telegram configured at all" gate.
create or replace function public.notification_dispatch_claim(
  p_token text,
  p_limit integer default 10
) returns table (
  id uuid,
  event_type text,
  payload jsonb,
  dedupe_key text,
  attempts integer,
  created_at timestamptz,
  telegram_enabled boolean,
  telegram_config jsonb,
  bot_token_ciphertext jsonb
)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_hash text;
  v_limit integer := greatest(1, least(coalesce(p_limit, 10), 50));
begin
  select value->>'dispatch_hash' into v_hash
    from public.app_settings where key = 'notifications';

  if v_hash is null or v_hash = '' then
    return;
  end if;
  if encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') is distinct from v_hash then
    return;
  end if;

  -- Claiming is destructive: it spends an attempt, and the dispatcher then
  -- closes an undeliverable row as 'skipped', which burns the dedupe key for
  -- good. But "token saved, chat id not picked yet" is a NORMAL state of the
  -- setup wizard, not corruption. So hand out nothing until Telegram can
  -- actually be delivered to: the rows stay pending with attempts untouched,
  -- and the first drain after the admin finishes setup sends the backlog.
  if not exists (
    select 1 from public.integration_settings
     where type = 'telegram'
       and btrim(coalesce(config->>'chat_id', '')) <> ''
       -- The secret is the {c, i, t} envelope. A missing key and a JSON null
       -- both mean "no token", and jsonb_typeof answers for both at once.
       and jsonb_typeof(secrets->'bot_token') = 'object'
  ) then
    return;
  end if;

  return query
  with claimed as (
    update public.notification_outbox o
       set attempts = o.attempts + 1,
           claimed_at = now()
     where o.id in (
       select c.id
         from public.notification_outbox c
        -- A claim older than five minutes belonged to a serverless invocation
        -- that died mid-drain. Re-claiming it is how nothing gets stranded.
        where c.status = 'pending'
          and (c.claimed_at is null or c.claimed_at < now() - interval '5 minutes')
          and c.attempts < 5
        order by c.created_at
        limit v_limit
        for update skip locked
     )
    returning o.id, o.event_type, o.payload, o.dedupe_key, o.attempts, o.created_at
  )
  select c.id,
         c.event_type,
         c.payload,
         c.dedupe_key,
         c.attempts,
         c.created_at,
         coalesce(t.enabled, false),
         coalesce(t.config, '{}'::jsonb),
         t.secrets->'bot_token'
    from claimed c
    left join public.integration_settings t on t.type = 'telegram'
   order by c.created_at;
end;
$$;

revoke execute on function public.notification_dispatch_claim(text, integer) from public;
grant execute on function public.notification_dispatch_claim(text, integer) to anon, authenticated;

-- ── 2. Writing the outcome back ──────────────────────────────────────────
-- Unchanged from 0052 apart from the status expression in the UPDATE.
create or replace function public.notification_dispatch_finish(
  p_token text,
  p_id uuid,
  p_status text,
  p_error text default null
) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_hash text;
begin
  select value->>'dispatch_hash' into v_hash
    from public.app_settings where key = 'notifications';

  if v_hash is null or v_hash = '' then
    return;
  end if;
  if encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') is distinct from v_hash then
    return;
  end if;
  if p_status is null or p_status not in ('sent', 'failed', 'skipped') then
    return;
  end if;

  update public.notification_outbox
     -- A failed send is an attempt, not a verdict: 429s, 5xx and network
     -- timeouts all arrive here. Below the ceiling the row goes back to
     -- pending so the attempts budget the claim already enforces is the thing
     -- that decides when to give up — attempts was incremented at claim time
     -- and claimed_at is cleared in this same UPDATE, so the next drain picks
     -- the row straight back up. The fifth failure stays 'failed' because the
     -- claim would refuse it anyway. 'sent' and 'skipped' remain terminal:
     -- neither a delivered message nor a missing chat id improves on a retry.
     set status = case
           when p_status = 'failed' and notification_outbox.attempts < 5 then 'pending'
           else p_status
         end,
         last_error_safe = left(nullif(btrim(coalesce(p_error, '')), ''), 200),
         sent_at = case when p_status = 'sent' then now() else sent_at end,
         claimed_at = null
   where notification_outbox.id = p_id;
end;
$$;

revoke execute on function public.notification_dispatch_finish(text, uuid, text, text) from public;
grant execute on function public.notification_dispatch_finish(text, uuid, text, text) to anon, authenticated;
