# EcomStudio — project guide for AI-assisted development

Production SaaS for e-commerce sellers: turn product reference photos into professional sales content (photos → prompts → AI generations → marketplace export). Product fidelity beats artistic creativity.

## Stack
Next.js 15 (App Router) · TypeScript strict · Tailwind (CSS vars, dark via `.dark`) · Supabase (Postgres + Auth + Storage, RLS everywhere) · Vercel. Stripe and AI providers come later.

## Environments
- Supabase DEV `ezyhwkcrrysanbcbkzsq` — active development.
- Supabase PROD `orjkxijqpecnbzhxhfct` — PROTECTED. Never run dev experiments, destructive SQL, or data mutations there without explicit permission. Schema changes reach PROD only via the migrations in `supabase/migrations/`.
- Connection config: `lib/supabase/config.ts` (env-first, DEV anon fallback). Anon/publishable keys are safe client-side; service-role keys must NEVER appear in frontend code or NEXT_PUBLIC vars.

## Architecture rules
- Business logic lives in `lib/services/*` and takes a `SupabaseClient` argument — transport-agnostic so a future React Native app can reuse it behind API routes. UI components stay thin.
- Server actions (`app/actions/*`) are thin wrappers: auth context → service call → `log_activity` → revalidate.
- AI: never couple to one vendor. `lib/ai/types.ts` defines `ImageProviderAdapter`; adapters register in `lib/ai/registry.ts`; `lib/ai/router.ts` resolves usable models (DB-active + adapter configured). No adapter is registered until real API keys exist — never fake generations; show honest "unavailable" states instead.
- Product Lock: every generation request carries `productLock.fidelityInstructions`. Preserve exact shape, proportions, colors, item count, buttons, ports, labels, accessories, materials, scale. `generations.product_match_score` / `quality_status` store fidelity checks.
- Credits: ledger-only. Balances change exclusively through `public.apply_credit_transaction()` (SECURITY DEFINER, revoked from clients). Never let users write wallets/transactions.
- Roles: `profiles.role` (user/admin) guarded by a DB trigger against self-escalation. Workspace roles in `workspace_members`. Admin/operator actions on customer data must call `log_activity` (supports `on_behalf_of`).
- i18n: PL (default), EN, DE. No hardcoded user-facing strings — everything through `lib/i18n/dictionaries/*.json` (`makeT` server-side, `useI18n` client-side). Locale = `ecs_locale` cookie + `user_preferences.locale`.
- Themes: light/dark/system via next-themes + CSS variables in `app/globals.css`.

## Development rules
1. Read existing code before changing it; reuse existing patterns; no parallel systems.
2. Small isolated upgrades; preserve working functionality; keep backwards compatibility.
3. DB changes = new migration file in `supabase/migrations/` applied via Supabase migrations (never ad-hoc prod SQL, never disable RLS).
4. No `any` / `@ts-ignore` / disabled checks to hide errors.
5. After meaningful changes run `npm run typecheck` and `npm run build`.
6. No fake functionality: unfinished features are visibly marked "coming soon / unavailable".
7. Vercel: preview deployments before production.

## Key data flow
product → product_images (Storage `product-images/{workspace_id}/{product_id}/…`) → generated_prompts (templates now, AI analysis later) → generation_jobs → generations (+ match score) → generation_assets → export (later).
