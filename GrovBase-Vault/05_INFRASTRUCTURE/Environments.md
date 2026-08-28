# Environments

| | DEV | PROD |
|---|---|---|
| Supabase | ezyhwkcrrysanbcbkzsq | orjkxijqpecnbzhxhfct |
| App | local `npm run dev` | Vercel ecomstudio-prod |

Env variable NAMES (values never documented): NEXT_PUBLIC_SUPABASE_URL,
NEXT_PUBLIC_SUPABASE_ANON_KEY, APP_ENCRYPTION_KEY, RESEND_API_KEY (optional,
email no-ops without it), EMAIL_FROM (optional), SITE_URL (optional).
`lib/supabase/config.ts` is env-first with a DEV publishable fallback.
