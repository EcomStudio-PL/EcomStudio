# Backup and Recovery

## Current state (2026-08-28)
- Code: Git on GitHub (source of truth), rollback branch pointers.
- Deployments: Vercel immutable deployment history — promote any previous
  READY build.
- Database: Supabase managed backups — TIER NOT VERIFIED from tooling.
  Owner must confirm in dashboard: plan level, daily backup availability,
  PITR on/off.
- Storage: NO independent backup beyond Supabase's platform durability.
  Generated assets/product images have exactly one logical copy.
- Migrations: forward-only; rollback = compensating migration.
- Docs: this vault lives in the Git repo → backed up with code.

## RPO / RTO
UNDEFINED today. Recommended targets: RPO ≤ 24 h now (daily backups) →
≤ 15 min with PITR before real revenue; RTO ≤ 4 h. 

## Owner actions
1. Confirm Supabase plan + enable PITR (paid tier) before scale.
2. Schedule a periodic storage export (e.g. weekly bucket sync to external
   object storage) — assets are customers' paid deliverables.
3. Quarterly restore drill: restore backup to a scratch project, run the
   app against it, record time taken (that's your real RTO).
