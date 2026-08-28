# Threat Model

Assets: customer product images & generations, GrovBase prompt IP,
credit balances, provider API keys, admin surface, availability budget.

| Actor | Vector | Mitigation |
|---|---|---|
| Hostile authenticated user | direct PostgREST with anon key + own JWT | RLS everywhere; definer RPCs validate membership; column guards on profiles |
| Same | cost manipulation (client-sent price/model/res) | server recomputes from DB; overrides floored at base; validation against model rows |
| Same | double-spend races | FOR UPDATE ledger; unique idempotency keys |
| Same | refund replay | refund_tx_id + row lock; users cannot UPDATE usage_events |
| Same | cross-tenant storage access | folder-segment RLS on storage.objects |
| Anonymous attacker | credential stuffing / reset spam | IP rate limits; Supabase auth throttling; (enable leaked-password protection) |
| Same | provider-health poisoning | auth required since 0036 |
| XSS payload in user content | script injection | JSX escaping only, no raw HTML sinks, CSP blocks external scripts |
| Compromised dependency | supply chain | lean deps, npm audit in workflow, app-level sharp patched |
| Leaked APP_ENCRYPTION_KEY | prompt + provider-key exposure | server-only env; rotate = re-encrypt credentials + re-run sessions |
| Malicious/compromised admin | full data access | activity_logs (on_behalf_of), least admin count — organizational |
