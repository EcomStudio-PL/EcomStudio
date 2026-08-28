# Authentication

Supabase SSR cookie auth (`@supabase/ssr`), chunked `sb-*` cookies with
explicit attributes (`AUTH_COOKIE_OPTIONS`: path=/, SameSite=Lax, Secure in
prod, maxAge 1y). Login/logout are NATIVE form POSTs (303 + Set-Cookie) —
the only flow installed PWAs handle reliably.

## The two historical login bugs (do not reintroduce)
1. **Cookie attributes lost on auth redirects** — copying cookies as
   {name,value} dropped maxAge/secure and rewrote chunk deletions as
   persistent empty cookies. Fix: `lib/supabase/auth-route.ts` records
   Supabase's writes WITH options and replays them onto the redirect.
2. **PGRST303 "JWT issued at future"** — GoTrue mints the token on its
   clock, PostgREST validates on the DB clock; for ~1–2 s after login every
   read failed while getUser() succeeded → "account not set up" screens.
   Fix: transport-level retry (`lib/supabase/skew-retry.ts`) + a warm-up
   read inside the sign-in/callback redirect.

## Remember me
"Pozostań zalogowany" drops maxAge from every auth cookie (browser-session
login). The choice travels as the `ecs_persist` marker and is honored by all
three cookie writers: sign-in route, middleware refresh, browser-client
refresh. Marker absent → persistent (pre-feature behavior).

## Registration & verification
Rich signup (phone, acquisition, company + NIP checksum, consents) validated
in lib/auth-validation.ts on BOTH sides; profile data rides auth metadata and
the 0039 trigger copies it (length-capped) with server-stamped consent
timestamps. Email confirmation flow: check-inbox screen, 1/min resend,
unconfirmed-login mapping, /login?error=link for dead links. OAuth (PKCE)
implemented app-side, gated by NEXT_PUBLIC_AUTH_PROVIDERS.

## Guards
- Middleware refreshes sessions, carries refreshed cookies on redirects,
  no-store on authed HTML, guards protected prefixes.
- Pages redirect (never `return null`) when unauthenticated — blank-screen
  class of bugs eliminated.
- Redirect targets: must start "/", reject "//" and any backslash.
- Role changes / blocked / account_manager_id are trigger-guarded in DB.
