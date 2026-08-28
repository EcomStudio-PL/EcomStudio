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

## Guards
- Middleware refreshes sessions, carries refreshed cookies on redirects,
  no-store on authed HTML, guards protected prefixes.
- Pages redirect (never `return null`) when unauthenticated — blank-screen
  class of bugs eliminated.
- Redirect targets: must start "/", reject "//" and any backslash.
- Role changes / blocked / account_manager_id are trigger-guarded in DB.
