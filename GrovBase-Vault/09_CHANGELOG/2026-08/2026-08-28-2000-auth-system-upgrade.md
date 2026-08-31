# Change
Date: 2026-08-28 ~20:00 UTC
Author/agent: Claude (Claude Code session)
Type: Feature/Security — authentication system final upgrade

## Objective
Premium auth pages (login/register/forgot/reset/verify), real "Pozostań
zalogowany", rich registration (phone, acquisition, company + NIP checksum,
consents), email-verification flow, OAuth scaffold, PL/EN/DE.

## Before
Minimal login/register (name+email+password), always-persistent cookies,
raw error strings, no consents, no company data, no resend flow.

## Implementation
- Remember-me is REAL: @supabase/ssr force-reapplies its default maxAge
  over cookieOptions, so session-only cookies are enforced at the WRITE
  points via stripPersistence(); the choice travels as the ecs_persist
  marker cookie and is honored by ALL FIVE auth-cookie writers (sign-in
  route, callback route, middleware refresh, server-client refresh,
  browser-client refresh). Marker absent → persistent (existing
  behavior). Sign-out clears the marker.
- Registration: shared client/server validation (lib/auth-validation.ts —
  password rules, Polish NIP checksum, acquisition enum); profile data
  rides auth metadata; the 0039 trigger copies it into profiles with
  length caps and stamps consent timestamps server-side (now()).
- Verification: check-inbox screen with rate-limited resend (1/min);
  unconfirmed login maps to its own message + resend; expired/invalid
  links land on /login?error=link, never a blank page.
- Password reset: recovery-session check renders an honest expired-link
  card; new-password form with live rules; generic non-enumerating
  responses everywhere (request, resend, signUp errors).
- OAuth: full PKCE client path implemented, buttons gated by
  NEXT_PUBLIC_AUTH_PROVIDERS (probed Supabase: google+apple NOT enabled →
  buttons hidden until configured; checklist in the task report).
- Legal placeholder pages /regulamin + /polityka-prywatnosci (honest
  "in preparation" copy — no invented legal text) linked from consent.

## Files
lib/supabase/{config,client,middleware,auth-route}.ts,
app/auth/{sign-in,sign-out,callback}/route.ts, app/actions/auth.ts,
lib/auth-validation.ts, app/(auth)/** (layout + 4 pages),
components/auth/{password-field,password-rules,oauth-buttons,
reset-password-form}.tsx, app/{regulamin,polityka-prywatnosci}/page.tsx,
lib/i18n/dictionaries/*, lib/database.types.ts,
supabase/migrations/0039_registration_profile.sql.

## Database
Migrations: 0039 (applied to PROD). Tables: profiles +16 nullable/defaulted
columns; handle_new_user extended (same side effects, adds field copy +
consent stamps). RLS: unchanged (own-or-admin still covers the row).

## Environment
New OPTIONAL env NAME: NEXT_PUBLIC_AUTH_PROVIDERS (unset = no OAuth
buttons). No values documented.

## Security impact
Non-enumerating flows preserved and extended; signup rate limit 5/10min/IP,
resend 1/min; consent timestamps server-stamped; metadata length-capped in
the trigger; persistence marker carries no security authority (worst-case
tamper = cookie lifetime choice for your own session).

## Performance impact
None material (auth pages only).

## Tests
typecheck PASS, production build PASS; adversarial review workflow (4
dimensions + verification) and live production E2E — see task report.

## Git / Deployment / Rollback
Commits: 562b1a5 (auth system), 76a6c4d (map GoTrue email_address_invalid
to the email field), 977c43b (honest "too many attempts" message when the
built-in mailer quota 429s /signup). Production deployment:
dpl_FBseKnBagd6fy2aC3JCJ8arnN1cg → https://ecomstudio-prod.vercel.app.
Rollback: previous Vercel deployment; migration 0039 (+ welcome-credits
follow-up) is additive/backward-safe — old code runs against it.

## Result
Verified live on production (2026-08-31):
- Login PASS (wrong password → friendly error; unconfirmed → resend flow).
- Remember-me PASS both ways: ON → persistent sb-* cookies, marker "1";
  OFF → browser-session cookies (expires −1) + marker "0", preserved
  through a middleware-refresh reload.
- Registration PASS (company account): user created, all 16 profile
  fields + consent timestamps correct, welcome credits granted via
  get_welcome_credits() (25), role=user, confirmation gating ON →
  "Sprawdź swoją skrzynkę" + working resend. QA user removed afterwards.
- Diagnosis note: GoTrue's e-mail validation rejects reserved TLDs
  (.test) with email_address_invalid — now mapped to the e-mail field
  error (76a6c4d). Test addresses must use a real-MX domain.
- Forgot password → generic non-enumerating message PASS; /reset-password
  without recovery session → expired-link card PASS.
- Existing users preserved: 2 auth users, 1 admin, profiles consistent;
  e2e test account re-blocked after QA.
- OAuth google/apple: NOT enabled in Supabase (probed) — buttons hidden;
  configuration is an owner action (see Follow-up).

## Follow-up
Owner: enable Google/Apple in Supabase + set NEXT_PUBLIC_AUTH_PROVIDERS;
replace legal placeholder text with lawyer-approved documents.
