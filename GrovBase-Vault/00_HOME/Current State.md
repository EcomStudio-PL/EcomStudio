# Current State

Last updated: 2026-08-31

| Item | Value |
|---|---|
| Production version | v1.1 (auth system final upgrade) |
| Production commit | `76a6c4d` (deployment dpl_EKrSToLeWcJSYgtaoPqXjxYvrLLe) |
| Rollback reference | branch `rollback/prod-2026-08-28` → `42425ed` |
| Production URL | https://ecomstudio-prod.vercel.app |
| Vercel project | ecomstudio-prod (legacy name, kept — internal id) |
| Supabase PROD | project ref `orjkxijqpecnbzhxhfct` |
| Supabase DEV | project ref `ezyhwkcrrysanbcbkzsq` |
| Repo | github.com/EcomStudio-PL/EcomStudio, branch `main` (mirror of `claude/ecomstudio-extract-push-f8ceir`) |
| DB migrations applied | 0001 – 0039 (+ welcome-credits follow-up to 0039) |

## Active major features
Auth (Supabase, native form POST) · workspace multi-tenancy · products +
reference images · prompt engine (encrypted GrovBase prompts) · concept
board · generation pipeline with provider routing/fallback · credit ledger ·
image tools (8) · library/favorites · plans page · admin panel (CRM, models,
providers, credentials, CMS, economics) · PWA · i18n PL/EN/DE · dark/light.

## Authentication status
STABLE, upgraded 2026-08-31: real remember-me (session vs persistent
cookies via ecs_persist marker at all five cookie-write points), rich
registration (phone, acquisition source, company + NIP checksum, consent
timestamps, welcome credits), e-mail verification flow with rate-limited
resend, non-enumerating password reset, OAuth PKCE scaffold (buttons
hidden until google/apple are enabled in Supabase). Verified live —
see the 2026-08-28 auth changelog entry. Historical root causes fixed
earlier: cookie attributes lost on auth redirects (2026-08-27) and
PGRST303 JWT clock-skew after sign-in (2026-08-27).
See [[02_ARCHITECTURE/Authentication]].

## Active AI providers
Configured via admin panel + encrypted credentials in DB. Adapters exist for
OpenAI, Google/Gemini, FAL; image utilities for Stability, Clipdrop,
PhotoRoom, remove.bg. Active status is data (ai_providers.active), not code.

## Known issues / accepted risks
- npm advisories inside Next 15's own bundle (build-time postcss, unused
  bundled sharp) — clears with Next 16 major; app-level sharp patched.
- `get_active_provider_credential` returns ciphertext to any authenticated
  user (AES-256-GCM; plaintext requires server-only APP_ENCRYPTION_KEY).
  Accepted by design, depends on key secrecy.
- No legal documents (Privacy Policy / ToS) — owner action, see
  [[12_LEGAL_PRIVACY/Legal Checklist]].
- Supabase backup tier/PITR NOT VERIFIED from this environment.

## Latest audit
2026-08-28 full production audit — see [[04_SECURITY/Security Audit]] and
the changelog entry of the same date.

## Latest release
[[08_RELEASES/Releases|v1.0 — GrovBase rebrand + hardening]] (2026-08-28).
