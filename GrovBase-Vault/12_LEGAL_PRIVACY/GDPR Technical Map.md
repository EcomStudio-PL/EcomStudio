# GDPR Technical Map (technical readiness, NOT legal certification)

## Technical controls in place
- Data isolation: workspace RLS on every table + storage path (verified).
- Access control: role-gated admin, DB-enforced; activity_logs with
  on_behalf_of for operator actions.
- Encryption in transit: HTTPS everywhere + HSTS. At rest: Supabase managed
  encryption; provider keys + GrovBase prompts additionally AES-256-GCM.
- Minimization: no analytics/tracking; cookies are auth (sb-*), ecs_locale,
  theme only; logs carry codes/messages, not content.
- Provider data flow: product images/prompts go server-side only to the
  ACTIVE image provider for a given generation; no client-side third-party
  calls.

## Gaps (technical)
- No self-service account deletion (see Right to Deletion below).
- No data export.
- No retention policy jobs (signed URLs expire, objects persist).
- No consent capture at registration (blocked on legal docs).

## Right to Deletion — current behavior + design
Today: no flow. Deleting auth user via dashboard would orphan workspace
rows (FKs mostly reference profiles/workspaces without cascade review).
Designed flow (needs owner approval before build): soft-block account →
30-day grace → definer RPC deletes storage objects (both buckets by
workspace prefix), generations/jobs/prompts/products rows, wallet+ledger
kept ANONYMIZED for accounting (legal question), profile row, auth user
last. Log the deletion in activity_logs under an operator id.

## Data export
Not implemented. Reasonable v1: ZIP of products.csv + generations metadata
json + storage objects (library ZIP endpoint already proves the pattern).
