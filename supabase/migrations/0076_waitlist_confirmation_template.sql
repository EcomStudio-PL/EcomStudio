-- THE WAITLIST CONFIRMATION BECOMES A TEMPLATE
--
-- It was the one message GrovBase sends that was not a message template. Its
-- subject and body lived in three columns on email_settings (0048) and were
-- edited on the "Kanały" screen, next to the SMTP host — so it was also the one
-- message with no preview, no draft, no version and no way to see what a
-- subscriber would actually receive before they received it.
--
-- It is `waitlist.confirmation:email` from here on, alongside
-- `waitlist.signup:email` — which is a DIFFERENT message and always was: that
-- one tells the operator somebody signed up, this one welcomes the person who
-- did. Keeping them as one entry would have meant one piece of copy addressed
-- to two audiences.
--
-- WHAT STAYS WHERE IT IS. `confirmation_enabled` is not moved: waitlist_subscribe
-- reads it inside the SECURITY DEFINER boundary when it decides whether to hand
-- the route a mail payload at all, and moving that decision out of the one
-- function that is a security boundary would buy nothing. The template studio
-- writes that column directly (setTemplateDeliveryAction) and shows it as the
-- message's own on/off switch, so the operator still sees one screen per
-- message. `confirmation_subject` / `confirmation_body` stay too, as the last
-- fallback the route uses if the template lookup is unavailable.

-- Carry over copy the operator actually wrote.
--
-- Only when it DIFFERS from what 0048 seeded: an untouched row already matches
-- the built-in default in lib/server/message-templates.ts, and seeding it would
-- put a "published v1" badge on a message nobody has ever edited — claiming a
-- decision the operator did not make. An already-existing row is never
-- overwritten.
insert into public.message_templates
  (key, event_type, channel, draft, published, published_version, published_at)
select
  'waitlist.confirmation:email', 'waitlist.confirmation', 'email',
  s.tpl, s.tpl, 1, now()
from (
  select jsonb_build_object(
    'subject',   e.confirmation_subject,
    -- 0048 stored no heading; the card needs one and this is the default the
    -- built-in template carries, so the rendered mail reads the same either way.
    'heading',   'Jesteś na liście',
    'body',      e.confirmation_body,
    'ctaLabel',  '',
    'ctaUrl',    '',
    'footer',    'GrovBase',
    'showLogo',  true,
    -- The field table is a dossier for the operator's own inbox — name, IP,
    -- device. A confirmation goes to the customer; it does not list them.
    'showFields', false,
    'showCta',   false
  ) as tpl
  from public.email_settings e
  where e.id
    and (
      e.confirmation_subject is distinct from 'Jesteś na liście GrovBase 🚀'
      or e.confirmation_body is distinct from
        'Dzięki za zapis. Damy Ci znać jako jednemu z pierwszych, gdy GrovBase wystartuje.'
    )
) s
on conflict (key) do nothing;

comment on column public.email_settings.confirmation_subject is
  'LEGACY FALLBACK. The live copy is message_templates waitlist.confirmation:email; this is what the waitlist route sends only if the template lookup is unavailable.';
comment on column public.email_settings.confirmation_body is
  'LEGACY FALLBACK. See confirmation_subject.';
comment on column public.email_settings.confirmation_enabled is
  'Whether the confirmation is sent at all. Read by waitlist_subscribe; written by the template studio (setTemplateDeliveryAction), shown there as the message own delivery switch.';
