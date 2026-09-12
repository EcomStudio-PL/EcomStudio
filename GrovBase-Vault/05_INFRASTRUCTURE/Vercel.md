# Vercel

- Project: `ecomstudio-prod` (legacy internal name), team hawk777s-projects,
  framework Next.js. NOT git-connected — every release goes through
  `deploy_to_vercel`, which clones `main` in its install step.
- Production URL: https://grovbase.com (custom domain; `www` and the
  legacy `ecomstudio-prod.vercel.app` both 308 to it)
- Function region: **actually `iad1` (Washington DC), and that is a problem.**
  Supabase PROD runs in `eu-central-1` (Frankfurt), so every server-side query
  crosses the Atlantic and a single navigation makes five to seven of them in
  sequence. `vercel.json` declares `"regions": ["fra1"]` — but MEASURED, it has
  no effect on this account: two preview deployments, one with `vercel.json`
  only in the git clone and one with it in the uploaded payload, both came back
  READY reporting `regions: ["iad1"]`. The team plan is `hobby`, where the
  function region is the account default and cannot be overridden per project
  from `vercel.json`. The declaration is kept because it is inert and correct,
  and it will take effect if the plan changes — but moving the functions to
  Frankfurt today means changing it in Vercel Project Settings (Functions →
  region) or upgrading the plan. Do not report this latency fix as live until a
  deployment's `regions` actually reads `fra1`.
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
`.env.production`. `dpl_ENZ5PNTCwHM9WRNkXtgMFLSpqf44` (READY, live 22:20 UTC on
6 September 2026) is the last deployment known to carry the ORIGINAL key — the
captcha it saved at 22:28 the same evening decrypts, which is the proof.

**This recovery cannot be done from an agent session.** The Vercel MCP server
exposes no tool that reads or writes project environment variables, and reading
the value into a transcript would be exactly the leak the key exists to
prevent. It is a dashboard action, by a person:

> Vercel → project `ecomstudio-prod` → the deployment above → **Source** →
> `.env.production` → copy `APP_ENCRYPTION_KEY` → **Settings → Environment
> Variables → Production** → save → redeploy.

Put it at PROJECT level, not in the payload. That is rule 1 above, and it is
what stops this from recurring: a project-level value outranks the file, so no
future payload edit can drop it again.

Until it is back, the panel says so itself rather than guessing — Admin →
Kanały reads the key at render time and shows one of two banners: *no key on
the server* (the stored passwords are intact, retyping them fixes nothing) or
*the key does not match the stored secrets* (retyping them is exactly the fix).
The two used to be one message, and the one they shared said "not configured".
