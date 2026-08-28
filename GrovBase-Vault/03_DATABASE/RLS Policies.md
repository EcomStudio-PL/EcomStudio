# RLS Policies — audit summary (2026-08-28)

Verdict: PASS. Multi-tenant isolation is enforced at the DB boundary; the
app adds `.eq("workspace_id", …)` as belt-and-suspenders.

| Area | Mechanism |
|---|---|
| profiles | select/update own or admin; trigger guards role/blocked/account_manager_id |
| workspaces / members | member-scoped select, manager/admin writes |
| products, product_images | is_workspace_member(workspace_id); images via EXISTS join to owning product |
| prompt_sessions, generated_prompts | member-scoped; GrovBase prompt text is ciphertext even to its owner |
| generation_jobs / generations / assets | member-scoped |
| credit_wallets / credit_transactions | member read; WRITES ONLY via apply_credit_transaction (revoked from clients) |
| usage_events | member read; UPDATE admin-only (users cannot flip status to fake refunds) |
| admin tables (ai_*, cms, plans, app_settings…) | is_admin() writes; reads as appropriate |
| storage.objects | per-op policies on foldername(name)[1]::uuid = member workspace |

SECURITY DEFINER surface (all internally validated, hardened in 0036):
apply_credit_transaction, charge_usage_credits, complete/fail/refund_usage_event,
set_generation_favorite, set_provider_health (auth required since 0036),
log_activity (membership/admin since 0036), admin_adjust_credits(_v2)
(is_admin), bootstrap_current_user, is_* helpers,
get_active_provider_credential (authenticated → ciphertext only; accepted
risk, plaintext needs server APP_ENCRYPTION_KEY).
