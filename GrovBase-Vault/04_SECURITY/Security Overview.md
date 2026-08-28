# Security Overview

Posture: defense in depth — code-level checks + RLS at the DB boundary +
hardened definer RPCs + security headers/CSP + encrypted secrets at rest.
No service-role key exists in the application; nothing can bypass RLS.

Pillars:
1. Multi-tenancy: every table/storage path workspace-scoped by RLS.
2. Credits: single locked ledger writer, server-authoritative pricing,
   replay-guarded refunds, unique idempotency keys.
3. IP protection: GrovBase prompts AES-256-GCM encrypted, decrypted only
   server-side at the moment of provider dispatch.
4. Admin: DB role check per request at every boundary (layout, actions,
   API, RLS).
5. Headers: nosniff, Referrer-Policy, Permissions-Policy, XFO DENY, HSTS,
   CSP (verified live, zero violations in E2E).
6. Abuse: rate limits on auth endpoints; generation gated by credits +
   quantity clamps + per-charge cap (10 000).

See [[Security Audit]] for the latest full audit and
[[Security Register]] for open/accepted items.
