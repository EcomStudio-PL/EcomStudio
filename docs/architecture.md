# Architecture

## Layers
1. **UI** — `app/**` (App Router) + `components/**`. Server components fetch data; small client components handle interactivity. No business rules in components.
2. **Actions** — `app/actions/*`: authenticated entrypoints for mutations (web transport). Thin: resolve user/workspace → call service → audit log → revalidate.
3. **Services** — `lib/services/*`: all domain logic, parameterized by `SupabaseClient`. A future mobile app consumes the same services through REST/RPC routes without rewrites.
4. **Data** — Supabase Postgres with RLS as the real authorization layer; Storage for images; SQL functions for invariants (credit ledger, signup bootstrap, role guard).

## Multi-tenancy
`workspaces` own products, wallets, jobs, generations. Access = membership in `workspace_members` (helper fns `is_workspace_member/manager`, SECURITY DEFINER, used inside policies). Global admin = `profiles.role='admin'` via `is_admin()`.

## AI provider abstraction
- `ImageProviderAdapter` interface (`lib/ai/types.ts`): `isConfigured()` + `generate(model, request)`.
- Registry (`lib/ai/registry.ts`): adapters keyed by `ai_providers.slug`. Empty until real keys exist.
- Router (`lib/ai/router.ts`): usable model = DB `active` AND provider `active` AND adapter registered AND configured.
- DB catalog: `ai_providers`, `ai_models` (credit_cost, aspect ratios, capabilities). Admin toggles activation; users never see fake availability.
- `GenerationRequest.productLock.fidelityInstructions` is mandatory — the fidelity contract travels with every request; results are scored into `generations.product_match_score` (regeneration loop later).

## Credits
Append-only ledger `credit_transactions` + cached `credit_wallets.balance`, mutated ONLY by `apply_credit_transaction()` (row-locked, non-negative, revoked from anon/authenticated). Clients read; server-side/admin flows write. Future Stripe webhooks call the same function with type `subscription`/`topup`.

## i18n & themes
Cookie-driven locale (`ecs_locale`, default `pl`), dictionaries in `lib/i18n/dictionaries/`. `next-themes` class strategy + CSS variables (`--bg`, `--ink`, `--accent`, …).

## Mobile-readiness checklist (already honored)
- services are transport-agnostic; auth is standard Supabase (works in Expo);
- storage paths and signed URLs are client-independent;
- no browser-only APIs inside `lib/**` (except explicit "use client" UI helpers);
- responsive layout + bottom mobile nav; touch-sized targets.
