# Database

Environments: DEV `ezyhwkcrrysanbcbkzsq` (develop here) · PROD `orjkxijqpecnbzhxhfct` (protected; migrations only).

## Migrations (supabase/migrations/)
1. `core_schema` — enums + all tables (profiles, user_preferences, workspaces, workspace_members, products, product_images, prompt_templates, generated_prompts, ai_providers, ai_models, generation_jobs, generations, generation_assets, credit_wallets, credit_transactions, subscription_plans, subscriptions, payments, usage_logs, activity_logs).
2. `functions_and_triggers` — `is_admin`, `is_workspace_member`, `is_workspace_manager`, `apply_credit_transaction` (ledger, client-revoked), `log_activity`, `handle_new_user` (profile+prefs+workspace+wallet+25 bonus credits on signup), `prevent_role_escalation`, `touch_updated_at`.
3. `rls_policies` — RLS enabled on every table; workspace-member scoping; wallets/transactions/subscriptions/payments read-only for clients; admin passthrough via `is_admin()`.
4. `storage_and_seed` — buckets `product-images` (10 MB, images, private) and `generation-assets` (25 MB, private); storage policies scoped by first path segment = workspace_id; seeds: 4 plans, 3 providers + 3 models (inactive), 7 global prompt templates.
5. `harden_function_grants` — SECURITY DEFINER functions locked away from `anon`/API where not needed. Accepted advisor WARNs: `is_admin`/`is_workspace_member`/`is_workspace_manager`/`log_activity` stay executable by `authenticated` **by design** (RLS evaluation + append-only audit; they expose nothing beyond the caller's own booleans).

## Invariants
- Wallet balance ≥ 0, changed only via `apply_credit_transaction` (row lock, tx insert + balance update atomically).
- `profiles.role` can't be changed by non-admins (trigger).
- Storage object path = `{workspace_id}/{product_id}/{uuid}.{ext}`; policies parse segment 1.
- New auth user ⇒ full bootstrap in one trigger (idempotent per user).

## Rules
- Every schema change = new migration file (checked into repo) applied with `apply_migration`.
- Never disable RLS. Never grant table writes on wallets/transactions to clients.
- Regenerate `lib/database.types.ts` after schema changes.
