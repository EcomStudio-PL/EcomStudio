# Change
Date: 2026-08-28 ~10:00 UTC
Author/agent: Claude (Claude Code session)
Type: Feature/Security/Performance — release v1.0

## Objective
Complete EcomStudio→GrovBase rebrand with official logo assets; performance
optimization; defensive security audit + fixes; production readiness review.

## Before
App branded EcomStudio; no security headers/CSP; several definer RPCs
under-gated; duplicate per-request queries; client-supplied tools
idempotency key; blocked-user self-unblock possible.

## Implementation
Rebrand (assets in public/brand, single Brand component, all dictionaries,
metadata/manifest/icons); security (migration 0036 hardening + profiles
guard, headers+CSP, redirect backslash guards, auth rate limits, tools key
server-derived); performance (React cache dedupe, column trims, 0037 SQL
aggregate, batched signing, landing cache, 0038 index cleanup).

## Files
~45 files: components/layout/brand.tsx, app/layout.tsx, app/manifest.ts,
lib/i18n/dictionaries/*, next.config.mjs, lib/supabase/server.ts,
lib/services/{workspace,credits,admin,generator}.ts,
lib/server/{generation,rate-limit}.ts, app/api/tools/run/route.ts,
app/auth/*, app/actions/auth.ts, supabase/migrations/0035–0038, public/*.

## Database
Migrations: 0035, 0036, 0037, 0038 (applied to PROD).
Tables affected: app_settings (data), profiles (trigger), function grants.
RLS affected: no policy changes; definer functions hardened.

## Environment
No env variable names changed.

## Security impact
Fixes: anonymous provider-health writes; audit-log forgery; blocked-user
self-unblock; tools billing bypass; missing headers/CSP; redirect
backslash; missing auth rate limits.

## Performance impact
1 fewer wallet query on 8 pages and profile/workspace dedupe per request;
admin ledger scan → single SQL aggregate; 50–60-row lists stopped
transferring multi-KB blobs; landing (anon) serves CMS/plans from 5-min
cache. Live: login p50 ≈ 310 ms, landing warm ≈ 330 ms.

## Tests
typecheck, production build, test:concepts, test:tools, live E2E on prod
(login/pages/CSP-zero-violations/admin-gate/logout), header verification,
i18n parity check, brand sweep = 0 user-facing leftovers.

## Git
Commit before: 42828cd · after: 42425ed (+8015182 docs) · Branch:
claude/ecomstudio-extract-push-f8ceir → main.

## Deployment
Production: dpl_JtazAt8AvT9szMgCdokQULSQqAKx — READY.
Production URL: https://ecomstudio-prod.vercel.app

## Rollback
Redeploy 42828cd (previous READY deployment in Vercel) — migrations
0035–0038 are backward-compatible (additive/hardening) so old code runs
against the new DB.

## Result
PASS

## Follow-up
Owner: leaked-password toggle, Supabase email templates, GrovBase domain +
EMAIL_FROM, legal documents.
