# Security Register

| ID | Item | Sev | Status | Owner action |
|---|---|---|---|---|
| SR-1 | Leaked-password protection disabled | MED | OPEN | Supabase dashboard toggle |
| SR-2 | Provider credential ciphertext readable by authenticated | LOW | ACCEPTED | rotate APP_ENCRYPTION_KEY if ever exposed |
| SR-3 | set_provider_health writable by any authenticated user | LOW | ACCEPTED | narrow RPC if abused |
| SR-4 | Next 15 bundled postcss/sharp advisories | LOW (build-time/unused) | OPEN | Next 16 migration window |
| SR-5 | In-memory rate limits are per-lambda | LOW | ACCEPTED | move to durable store before ~3k users |
| SR-6 | No CAPTCHA on register | LOW | OPEN | enable Supabase captcha if signup abuse appears |
| SR-7 | Supabase auth email templates may still say EcomStudio | LOW | OPEN | dashboard review |
| SR-8 | RLS initplan/multi-permissive advisor warnings | PERF | OPEN | batch `(select auth.uid())` rewrite |
Closed this audit: anonymous provider-health writes, log-forgery,
self-unblock, tools billing bypass, missing headers/CSP, redirect backslash,
missing auth rate limits, vulnerable app-level sharp.
