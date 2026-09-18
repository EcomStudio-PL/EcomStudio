-- NEWSLETTER — THE WAY BACK IN.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY THIS FILE EXISTS AT ALL
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The unsubscribe page offers "to była pomyłka — zapisz mnie z powrotem". That
-- affordance is not decoration: the page unsubscribes on the FIRST click, with
-- no confirmation screen, because RFC 8058 one-click and a mail client's native
-- "Unsubscribe" button demand it and because making somebody confirm twice is
-- how people reach for the spam button instead. The cost of one-click is the
-- occasional accident — a mis-tap, a link scanner, a forwarded newsletter — and
-- the way back in is what pays that cost. Without it, one-click is a trapdoor.
--
-- 0094 CANNOT PROVIDE THAT WAY BACK, and this was verified against the file
-- rather than assumed. Three separate walls, each of them correct on its own:
--
--   1. `newsletter_unsubscribe` returns `{status}` and nothing else. It never
--      hands back the address, so the page that just unsubscribed somebody does
--      not know who it unsubscribed.
--   2. `newsletter_contacts` is admin-only under RLS. An anonymous visitor
--      cannot look the address up from the token either — which is exactly the
--      property that makes an unsubscribe link safe to put in an email.
--   3. `newsletter_subscribe` answers 'suppressed' for any address on the
--      suppression list, and `newsletter_unsubscribe` ALWAYS writes one. So
--      even given the address, re-subscribing through the public function is a
--      no-op by design.
--
-- Point 3 is the important one, and it is not a bug to route around. The
-- suppression list is keyed on the ADDRESS precisely so that it survives the
-- contact being deleted and re-imported from somebody's CSV six months later;
-- if a form could lift it, it would not be a suppression list. What is missing
-- is not a hole in that wall but a door with a different key: the CONTACT
-- THEMSELVES, proving who they are with the unguessable token from their own
-- mail. app/actions/newsletter.ts already states this as settled policy at
-- `removeSuppressionAction` — "only they can re-subscribe" — and this function
-- is the thing that sentence has been describing all along.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT IT DELIBERATELY WILL NOT DO
-- ═══════════════════════════════════════════════════════════════════════════
--
-- IT LIFTS ONE SUPPRESSION AND ONLY ONE: reason = 'unsubscribed'. A row that
-- says 'bounced', 'complained' or 'blocked' is not the contact's to overrule,
-- and the difference matters far more than it looks:
--
--   · 'complained' means a mailbox provider told us this person pressed "report
--     spam". Mailing them again is the single fastest way to have the whole
--     sending domain blocklisted, and it would take the account e-mail and the
--     login codes down with the newsletter, because SMTP is one credential here.
--   · 'bounced' means the address does not accept mail. Re-subscribing it just
--     re-queues a message that will bounce again and damage the sender score.
--   · 'blocked' is an operator's own decision, and a link in an email may not
--     silently undo an operator.
--
-- Those three answer 'blocked' and change nothing. Lifting them stays what it
-- already is: a deliberate admin action in the panel.
--
-- IT DOES NOT ROTATE THE TOKEN. The same token has to keep working in a message
-- somebody opens in six months, and in the one they are reading right now.
--
-- IT WRITES NO EVENT ROW. `newsletter_events.event_type` is a closed check
-- constraint in 0094 with no 'resubscribed' value, and widening it would ripple
-- into lib/newsletter.ts's EVENT_TYPES, the contact timeline and the campaign
-- report for one row that is not campaign activity. The record of the act is
-- where it legally belongs instead — on the contact, as a fresh consent_at,
-- consent_source and consent_version, which is the same evidence a form signup
-- leaves and the same set the admin's contact screen already displays.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- APPLYING IT
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Additive: one function, no table touched, no policy changed, nothing in 0094
-- altered. Until it is applied, the unsubscribe page still unsubscribes exactly
-- as it should — only the "zapisz mnie z powrotem" button fails, and it fails
-- HONESTLY, telling the visitor it did not work rather than claiming it did.
-- DEV first, then PROD.

-- ── RESUBSCRIBE ────────────────────────────────────────────────────────────
--
-- Returns 'resubscribed' | 'unknown' | 'blocked'.
--
-- The token is the authorisation and the identity at once. It reads nothing
-- back out: an attacker holding a token can already unsubscribe that contact,
-- so being able to re-subscribe them grants no capability the anon surface did
-- not already have, and it still yields no address, no name and no list.
create or replace function public.newsletter_resubscribe(
  p_token uuid,
  p_consent_version text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contact record;
  v_reason text;
begin
  select id, email into v_contact from public.newsletter_contacts
    where unsubscribe_token = p_token;

  -- Same answer shape as newsletter_unsubscribe, and for the same reason: the
  -- caller must not be able to tell a token that never existed from one that
  -- did. The page prints one message for both.
  if v_contact.id is null then
    return jsonb_build_object('status', 'unknown');
  end if;

  select reason into v_reason from public.newsletter_suppressions
    where email = v_contact.email;

  -- See the header. Only the suppression this person caused is theirs to lift.
  if v_reason is not null and v_reason <> 'unsubscribed' then
    return jsonb_build_object('status', 'blocked');
  end if;

  delete from public.newsletter_suppressions
   where email = v_contact.email and reason = 'unsubscribed';

  -- A FRESH GRANT, DATED NOW. Not a restoration of the old one: the contact
  -- withdrew, and what makes them mailable again is the new affirmative act
  -- they have just performed, not the one they revoked. Dating this `now()`
  -- rather than preserving the original is the opposite of the rule used when
  -- consent was never withdrawn (where the FIRST date is the one with legal
  -- meaning and must never be overwritten) — the two cases are different acts.
  update public.newsletter_contacts set
    marketing_consent = true,
    consent_at = now(),
    consent_source = 'resubscribe_link',
    consent_version = left(coalesce(nullif(btrim(coalesce(p_consent_version, '')), ''), 'v1'), 40),
    unsubscribed_at = null,
    unsubscribe_reason = null
  where id = v_contact.id;

  -- Recipient rows this contact's unsubscribe cancelled stay cancelled. That
  -- mail was for a campaign that has since moved on, and quietly re-queueing a
  -- send somebody cancelled is not what "zapisz mnie z powrotem" asked for.

  return jsonb_build_object('status', 'resubscribed');
end $$;

revoke all on function public.newsletter_resubscribe(uuid, text) from public, anon, authenticated;
grant execute on function public.newsletter_resubscribe(uuid, text) to anon, authenticated;
