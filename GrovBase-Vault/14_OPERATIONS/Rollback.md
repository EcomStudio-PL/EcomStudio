# Rollback

## App (minutes)
Option A: Vercel dashboard → previous READY deployment → promote to
production. Option B: redeploy from rollback pointer:
`rollback/prod-2026-08-28` (= 42425ed).

## Database
Migrations are forward-only and written backward-safe (additive or
hardening). To undo one, write a compensating migration — NEVER edit or
delete applied migration history, never restore over PROD casually.

## Full DR
Supabase backup restore (owner-verified tier) + promote matching app
deployment + re-check advisors. Practice on a scratch project first.
