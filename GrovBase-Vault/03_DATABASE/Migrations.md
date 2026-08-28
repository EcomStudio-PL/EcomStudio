# Migrations

Forward-only SQL files in `supabase/migrations/`, applied to PROD via the
Supabase migration API. No down-migrations — rollback strategy is
compensating migrations (write a new one that reverses the change).

Landmarks:
- 0001–0005 core schema, functions, RLS, storage, grant hardening
- 0012 SaaS foundation (usage_events, payments, CMS, buckets)
- 0014/0015/0021 user generation RPCs + usage lifecycle (+ real API cost)
- 0016 model pricing config, prompt sessions, feedback
- 0027 concept engine + hidden-prompt encryption
- 0031 model choice/pricing/planner split
- 0033 generation favorites · 0034 session resolution
- 0035 app_name → GrovBase (data fix)
- 0036 definer-function hardening + profiles column guard  ← security
- 0037 generation_credits_total() + type index               ← perf
- 0038 drop duplicate generation_jobs index

Rule: never edit an applied migration; never ad-hoc SQL on PROD; never
disable RLS.
