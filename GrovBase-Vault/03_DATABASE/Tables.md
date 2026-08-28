# Tables (functional groups)

Identity/tenancy: profiles (role, blocked — trigger-guarded), workspaces,
workspace_members, user_preferences.
Catalog: products, product_images.
Prompting: prompt_sessions (analysis, product_lock, resolution),
generated_prompts (ENCRYPTED prompt + iv + tag), prompt_templates (user),
prompt_blocks/system library (admin-only read).
Generation: generation_jobs, generations (+favorite, match score),
generation_assets, generation_feedback, tool_results.
Billing: credit_wallets, credit_transactions (ledger, balance_before/after),
usage_events (idempotency_key UNIQUE, credits_charged, refund_tx_id,
actual_api_cost_usd_micros), payments (ready, no PSP yet),
subscriptions, subscription_plans, credit_packages, service_catalog.
AI config: ai_providers, ai_models (pricing per resolution, surcharge,
internal cost), ai_provider_credentials (AES-GCM ciphertext),
provider_health, price history tables.
Platform: app_settings, feature_flags, activity_logs, notifications,
support threads/messages, cms_pages, media_assets, inspirations,
crm_notes, billing_profiles, search_queries.

Full column truth: `lib/database.types.ts` (generated) and migrations.
