# Vercel

- Project: `ecomstudio-prod` (legacy internal name), team hawk777s-projects,
  framework Next.js. NOT git-connected — every release goes through
  `deploy_to_vercel`, which clones `main` in its install step.
- Production URL: https://grovbase.com (custom domain; `www` and the
  legacy `ecomstudio-prod.vercel.app` both 308 to it)
- Function region: `fra1`, set in `vercel.json`. It used to be the account
  default `iad1` (Washington DC) while Supabase PROD runs in `eu-central-1`
  (Frankfurt), so every server-side query crossed the Atlantic and a single
  navigation makes five to seven of them. Keep the functions in the same
  continent as the database.
- Deploy flow: `deploy_to_vercel` with installCommand that clones `main`
  and installs; two seed files (stub package.json + .env.production with
  NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
  APP_ENCRYPTION_KEY, NEXT_PUBLIC_SITE_URL — names only listed here, values live in Vercel).
- Rollback: Vercel keeps previous deployments — promote an earlier READY
  deployment, or redeploy from the rollback branch.
- Runtime: serverless functions (nodejs), maxDuration 120s on generation
  routes; sharp via serverExternalPackages.

## The seed file is a live wire — read this before editing the payload

Because the project is not git-connected, that hand-written `.env.production`
is the ONLY source of server environment for production. Anything left out of
it does not fall back to something safer; it is simply absent at runtime.

This has already cost one outage. A deploy went out with `APP_ENCRYPTION_KEY`
dropped from the payload and `NEXT_PUBLIC_APP_ENV` (which nothing in this repo
reads) in its place. Nothing failed loudly: `integrationsEncryptionAvailable()`
just started answering false, `readIntegrationSecrets` returned an empty bag
before it ever looked at the stored ciphertext, and the admin panel reported
"Poczta nie została jeszcze skonfigurowana" for a mailbox that was fully
configured and whose credentials were sitting intact in the database.

Two rules follow.

1. **Durable server secrets belong in Vercel Project Settings → Environment
   Variables (Production), not in the payload file.** Next.js never lets a
   `.env` file overwrite a variable that is already in `process.env` — see
   `processEnv` in `@next/env`, which only fills gaps — so a project-level
   value outranks the file and survives any future payload edit. The payload
   should be for per-deploy overrides only.

2. **Never change the key without also re-entering the credentials.** Every
   admin-stored secret (mailbox password, Telegram bot token, Turnstile secret,
   AI provider keys) is AES-256-GCM ciphertext written under whatever key was
   live at the time. A *different* 64-hex key is not a recovery — it decrypts
   nothing and the panel will ask for all of them again. Recovering the
   ORIGINAL value is what avoids that.

If the key is ever lost again, an older deployment's uploaded source files are
the first place to look: the Vercel dashboard shows a deployment's Source tab,
and any deployment from before the payload changed still carries the working
`.env.production`.
