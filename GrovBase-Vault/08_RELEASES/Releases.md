# Releases

## v1.0 — GrovBase rebrand + production hardening — 2026-08-28
- Commit: `42425ed` (+docs/sharp follow-ups on main)
- Deployment: dpl_JtazAt8AvT9szMgCdokQULSQqAKx (production, READY)
- DB migrations: 0035–0038 applied to PROD
- Rollback: branch `rollback/prod-2026-08-28` → `42425ed`; previous stable
  runtime was `42828cd` (mobile pass V3)
- Highlights: full rebrand + official logo system; security hardening
  (definer RPCs, profiles guard, headers/CSP, rate limits, billing-bypass
  fix); performance (request dedupe, column trims, SQL aggregate, batched
  signing, landing cache).

## Pre-1.0 (EcomStudio era)
Mobile pass V3 + auth root-cause fixes: `a27ca69`…`42828cd` (2026-08-27).
Earlier history: see git log.
