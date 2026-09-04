# Vercel

- Project: `ecomstudio-prod` (legacy internal name), team hawk777s-projects,
  region iad1, framework Next.js. NOT git-connected — every release goes
  through `deploy_to_vercel`, which clones `main` in its install step.
- Production URL: https://grovbase.com (custom domain; `www` and the
  legacy `ecomstudio-prod.vercel.app` both 308 to it)
- Deploy flow: `deploy_to_vercel` with installCommand that clones `main`
  and installs; two seed files (stub package.json + .env.production with
  NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
  APP_ENCRYPTION_KEY, NEXT_PUBLIC_SITE_URL — names only listed here, values live in Vercel).
- Rollback: Vercel keeps previous deployments — promote an earlier READY
  deployment, or redeploy from the rollback branch.
- Runtime: serverless functions (nodejs), maxDuration 120s on generation
  routes; sharp via serverExternalPackages.
