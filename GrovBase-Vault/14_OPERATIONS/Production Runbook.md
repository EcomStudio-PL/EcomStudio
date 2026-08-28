# Production Runbook

## Health checks
- App: GET /login expect 200 + full security-header set.
- Auth: login with QA account (unblock first — see 13_TESTING/QA Strategy).
- DB: Supabase advisors (security + performance) after any DDL.
- Logs: Vercel runtime logs; watch for `profile.read`, `workspace.read`,
  `bootstrap`, `app.setup-missing`, `app-error` markers (deliberate,
  code+message only).

## Common incidents
- "Account not set up" screens → check PGRST303 in logs (clock skew) —
  transport retry should absorb; investigate if persistent.
- Generation failing "model overloaded" → check provider_health rows and
  admin providers page; deactivate/reroute.
- Costs spike → Incident Response in 04_SECURITY.

## Operator SQL crib
Unblock QA account (guard blocks direct writes — intended):
disable trigger profiles_role_guard → update → enable trigger.
