# Monitoring / Observability

## Today
Vercel runtime logs (server errors, our deliberate error markers) ·
Supabase logs (24 h window, edge/postgres) · advisors · admin economics
(real API cost per event) · provider_health table · activity_logs.

## Gaps (recommended minimum alerts before scale)
1. Error-rate alert on production functions (Vercel integration or log
   drain → alerting).
2. Daily provider-cost sum threshold (query usage_events; alert on X×
   baseline).
3. Failed-generation ratio per provider (usage_events status=failed).
4. Auth failures spike (sign-in 4xx surge).
5. Supabase DB CPU/connections (dashboard alerts).
No secrets in logs — verified; keep it that way.
