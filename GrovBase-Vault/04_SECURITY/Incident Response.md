# Incident Response

## Suspected data breach / cross-tenant access
1. Verify with RLS advisor + targeted queries (never guess).
2. If a policy is broken: hotfix migration restricting first — false
   lockout beats leakage; communicate after facts are established.
3. Preserve evidence: Vercel runtime logs, Supabase logs (24h window),
   activity_logs.

## Leaked secret
- APP_ENCRYPTION_KEY: rotate env in Vercel, re-encrypt
  ai_provider_credentials (admin re-enters keys), redeploy.
- Provider key: revoke at provider, re-enter in admin credentials.
- Supabase anon key: rotate in dashboard + update env; publishable by
  design, rotation is precaution.

## Runaway generation cost
1. Admin → providers: deactivate provider(s) (kill switch — router refuses).
2. Or service_catalog.maintenance_mode per tool; or set model inactive.
3. Inspect usage_events (actual_api_cost_usd_micros) for the anomaly.

## Auth outage
Check Vercel runtime logs for PGRST303/auth errors; Supabase status page;
the skew-retry masks small clock drift — a large drift shows as mass 401s.

## Rollback
See [[14_OPERATIONS/Rollback]].
