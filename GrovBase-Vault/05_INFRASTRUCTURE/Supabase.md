# Supabase

- PROD `orjkxijqpecnbzhxhfct` (PROTECTED — no dev experiments), DEV
  `ezyhwkcrrysanbcbkzsq`.
- Auth: email/password; native-form cookie flow; email templates managed in
  DASHBOARD (check branding there — not in repo).
- Storage buckets: see [[03_DATABASE/Supabase Architecture]].
- Backups: tier/PITR NOT VERIFIED from tooling — owner must confirm plan
  level and enable PITR before scale (see
  [[14_OPERATIONS/Backup and Recovery]]).
- Env in app: NEXT_PUBLIC_SUPABASE_URL + publishable anon key (client-safe
  by design, RLS-enforced). No service-role key in app.
