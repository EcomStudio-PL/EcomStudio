# Backend

- Route handlers under `app/api/*` (generate, concepts, prompts, tools,
  library/zip, search) — each derives the caller via `auth.getUser()` and
  scopes by workspace.
- Server actions under `app/actions/*` — customer actions use ctx helpers;
  admin actions call `requireAdmin()` which re-reads `profiles.role` per
  invocation.
- `lib/supabase/server.ts`: per-request memoized client (React cache) with
  PGRST303 clock-skew retry at the transport (see Authentication).
- `lib/server/crypto.ts`: AES-256-GCM for provider credentials and GrovBase
  prompts; key = env `APP_ENCRYPTION_KEY` (server-only).
- Rate limiting: fixed-window in-memory (`lib/server/rate-limit.ts`) on
  sign-in (10/min/IP) and password reset (3/10min/IP).
- Email: Resend REST in `lib/server/email.ts`; honest no-op when unset.
