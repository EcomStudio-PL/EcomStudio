# Technical Debt
- next lint deprecated & unconfigured → adopt ESLint flat config
- RLS initplan advisor batch fix (`(select auth.uid())`) — 26 policies
- In-memory rate limiter → durable (DB/Upstash) before ~3k users
- I18n dictionary (~70KB) serialized into every RSC payload → split per page
- Legacy internal identifiers (repo/Vercel names, prompt_origin enum) —
  leave unless a migration window makes renames safe
- Next 16 upgrade (clears bundled postcss/sharp advisories)
