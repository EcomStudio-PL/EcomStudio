# Security Audit — 2026-08-28

Method: 8 parallel code auditors (brand, secrets, XSS/redirect/CSRF,
authz/IDOR, credits, uploads, perf, logging/headers) + Supabase security &
performance advisors + manual read of every SECURITY DEFINER function +
live E2E on production (login, pages under CSP, admin gate, logout) +
dependency audit + full git-history secret scan (71 commits).

## Fixed during audits (2026-08-27/28)
- set_provider_health: was callable ANONYMOUSLY → platform-wide generation
  degradation possible. Now requires auth. (0036)
- log_activity: audit-row forgery into any workspace → membership/admin
  required. (0036)
- Blocked users could UNBLOCK THEMSELVES via direct PostgREST (trigger only
  guarded role) → guard extended to blocked/account_manager_id; verified
  biting in production. (0036)
- Billing bypass: tools idempotency key was client-supplied → expensive
  runs could ride a cheap charge. Key now server-derived hash. 
- anon EXECUTE revoked across definer RPCs; trigger fns revoked from all.
- Empty-MIME upload check bypass closed (tools/run).
- Open-redirect backslash variant rejected in all four guards.
- Security headers + CSP added (were absent entirely).
- Rate limits added: sign-in 10/min/IP, password reset 3/10min/IP.
- sharp bumped 0.34→0.35.4 (libvips CVE-2026-33327/28, 35590/91) — the
  copy that processes user uploads.

## Verified clean
XSS (zero raw-HTML rendering) · SQLi (PostgREST parameterized; no raw SQL
from input) · secrets (repo + full history: only .env.example ever tracked;
only the by-design publishable anon key in code) · uploads (private
buckets, folder-scoped RLS, traversal structurally impossible) · credits
(server pricing, FOR UPDATE ledger, refund replay guard) · CSRF (SameSite
=Lax, no state-changing GET, Origin checks) · logging (codes/messages only).

## Accepted / open
- get_active_provider_credential returns ciphertext to authenticated users
  (LOW; requires APP_ENCRYPTION_KEY secrecy). 
- set_provider_health callable by any authenticated user (LOW; bounded
  30-min cooldowns; legitimate path needs it).
- Next 15 bundle advisories (build-time postcss, unused bundled sharp) —
  wait for a calm Next 16 migration window.
- Supabase "leaked password protection" OFF — dashboard toggle (owner).
- RLS initplan / multiple-permissive-policy advisor warnings — perf-shape,
  not security; batch fix candidate before ~3 000 users.
