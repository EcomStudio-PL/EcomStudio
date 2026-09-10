-- WAITLIST SIGNUP FIELDS: NO PHONE, ALWAYS A SURNAME.
--
-- 0055 seeded app_settings."registration" with three waitlist keys —
-- wl_first_name / wl_last_name / wl_phone. The pre-launch page collects a
-- mailing list, so the phone number was a field that cost signups and bought
-- nothing: there is nothing to call about before the product ships. The
-- application no longer reads or renders wl_phone at all, and the admin panel
-- no longer offers it, so the stored key is dead weight and is dropped here
-- rather than left behind to confuse the next person who reads the row.
--
-- The surname goes the other way. It was seeded 'hidden', which left a fresh
-- install asking for a first name only; the form is now Imię / Nazwisko /
-- e-mail, so a hidden surname is promoted to 'required'. A surname the admin
-- deliberately set to 'optional' is left exactly as it is — this migration
-- fixes the seeded default, it does not overrule a decision someone made.
--
-- The signup form's own phone field (key "phone") is untouched: that form
-- creates accounts and the number is useful there.

update public.app_settings
set value = (
      case
        when coalesce(value->>'wl_last_name', 'hidden') = 'hidden'
          then jsonb_set(value - 'wl_phone', '{wl_last_name}', '"required"'::jsonb)
        else value - 'wl_phone'
      end
    ),
    updated_at = now()
where key = 'registration'
  and value is not null
  and jsonb_typeof(value) = 'object'
  -- Only rows that would actually change, so re-running this costs nothing and
  -- no untouched deployment gets a new updated_at.
  and (value ? 'wl_phone' or coalesce(value->>'wl_last_name', 'hidden') = 'hidden');
