# Domains

Canonical production host: **https://grovbase.com**

| Host | Role |
|---|---|
| `grovbase.com` | canonical — everything the app publishes points here |
| `www.grovbase.com` | 308 → `https://grovbase.com` (Vercel domain redirect) |
| `ecomstudio-prod.vercel.app` | legacy alias, 308 → `https://grovbase.com` |
| `ecomstudio-prod-hawk777s-projects.vercel.app` | Vercel internal alias |

The app never derives its own origin from the request host. `lib/site.ts` is
the single source: `NEXT_PUBLIC_SITE_URL` in production (set in the deployed
`.env.production`), the deployment URL on previews, `http://localhost:3000`
in development. Auth e-mail links, canonical tags, OpenGraph, the sitemap and
outgoing support mail all read it.

TODO (owner): verify the grovbase.com sending domain in Resend and set
`EMAIL_FROM` (the code falls back to `GrovBase <noreply@grovbase.com>`).
